-- K3: private FAQ composition and derived tasks. Existing evidence is preserved.
begin;
alter table hub.content_gaps
 add column state text not null default 'open' check(state in ('open','in_progress','resolved')),
 add column assignee uuid,
 add column occurrences integer not null default 1 check(occurrences>0),
 add column last_seen timestamptz not null default clock_timestamp(),
 add column question_key text references hub.faq_questions,
 add column resolved_by_faq_id uuid references hub.faqs,
 add column missing_fact_keys text[] not null default '{}',
 add column revision integer not null default 1,
 add column updated_at timestamptz not null default clock_timestamp(),
 add column updated_by uuid default nullif(current_setting('app.actor_id',true),'')::uuid;
create unique index faq_fact_gap_identity on hub.content_gaps(project_id,question_key)
 where gap_code='FAQ_FACT_MISSING' and question_key is not null;
create trigger faq_gap_touch before update on hub.content_gaps for each row execute function hub.touch_record();
create policy faq_gap_sources on hub.content_gaps as restrictive to hub_app,editor,publisher,viewer,admin,online_staff,agency
 using(question_key is null or hub.can('projects','view')) with check(false);

create function hub.faq_project_form(project_uuid uuid) returns text
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select case when count(*)=count(product_form) and count(distinct product_form)=1 then min(product_form) end
 from hub.commercial_types where project_id=project_uuid and deleted_at is null
$$;

create function hub.faq_rule_projects(rule jsonb,kind text,ref text) returns text[]
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare predicate record;result text[];begin
 if rule is null or jsonb_typeof(rule)<>'object' or kind is null or ref is null or kind not in ('corporate','brand','project_group','programme') then
  raise exception 'Invalid applicability rule or scope' using errcode='23514';end if;
 if kind='corporate' and ref<>'sena'
  or kind='brand' and not exists(select 1 from hub.brands where public_brand_id=ref and deleted_at is null)
  or kind='project_group' and not exists(select 1 from staging.dw_project_groups where project_group_id=ref)
  or kind='programme' and ref not in ('LIVNEX','LIVNEX_GOLD','RENTNEX','RENTNEX_BENEFIT','RENTNEX_INVEST') then
  raise exception 'Unknown applicability scope' using errcode='23514';end if;
 for predicate in select * from jsonb_each(rule) loop
  if predicate.key not in ('brand_ids','product_forms','group_ids') or jsonb_typeof(predicate.value)<>'array' then
   raise exception 'Unknown applicability predicate' using errcode='23514';end if;
  if jsonb_array_length(predicate.value) not between 1 and 100
   or exists(select 1 from jsonb_array_elements(predicate.value) x where jsonb_typeof(x)<>'string')
   or (select count(*)<>count(distinct value) from jsonb_array_elements(predicate.value)) then
   raise exception 'Applicability values must be distinct bounded references' using errcode='23514';end if;
  if predicate.key='brand_ids' and exists(select 1 from jsonb_array_elements_text(predicate.value) x where not exists(select 1 from hub.brands where public_brand_id=x and deleted_at is null))
   or predicate.key='group_ids' and exists(select 1 from jsonb_array_elements_text(predicate.value) x where not exists(select 1 from staging.dw_project_groups where project_group_id=x))
   or predicate.key='product_forms' and exists(select 1 from jsonb_array_elements_text(predicate.value) x where x not in ('condominium','house','townhome','other')) then
   raise exception 'Unknown applicability reference' using errcode='23514';end if;
 end loop;
 if rule='{}' then return '{}';end if;
 select coalesce(array_agg(p.rem_project_id order by p.rem_project_id),'{}') into result
 from hub.projects p left join hub.brands b on b.id=p.brand_id
 left join staging.dw_projects d using(rem_project_id)
 where p.deleted_at is null
  and (not rule?'brand_ids' or rule->'brand_ids' ? b.public_brand_id)
  and (not rule?'product_forms' or rule->'product_forms' ? hub.faq_project_form(p.id))
  and (not rule?'group_ids' or rule->'group_ids' ? (d.source_record->>'rem_project_group_id'))
  and (kind<>'brand' or b.public_brand_id=ref)
  and (kind<>'project_group' or d.source_record->>'rem_project_group_id'=ref)
  and (kind<>'programme' or exists(select 1 from hub.project_programmes x where x.project_id=p.id and upper(x.programme_key)=ref and x.participating and x.state='approved'));
 return result;
end $$;

create function hub.faq_applicability_preview(rule jsonb,kind text,ref text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare ids text[];begin
 perform hub.require_permission('knowledge','view');perform hub.require_permission('projects','view');
 ids:=hub.faq_rule_projects(rule,kind,ref);
 return jsonb_build_object('project_ids',ids,'digest',encode(sha256(convert_to(to_jsonb(ids)::text,'UTF8')),'hex'),
  'projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.rem_project_id,'public_id',p.public_project_id,'name',p.public_name) order by p.rem_project_id)
   from hub.projects p where p.rem_project_id=any(ids) and p.deleted_at is null),'[]'),
  'unresolved_forms',case when rule?'product_forms' then coalesce((select jsonb_agg(jsonb_build_object('id',p.rem_project_id,'name',p.public_name) order by p.rem_project_id)
   from hub.projects p left join hub.brands b on b.id=p.brand_id left join staging.dw_projects d using(rem_project_id)
   where p.deleted_at is null and hub.faq_project_form(p.id) is null
    and (kind<>'brand' or b.public_brand_id=ref) and (not rule?'brand_ids' or rule->'brand_ids' ? b.public_brand_id)
    and (kind<>'project_group' or d.source_record->>'rem_project_group_id'=ref)
    and (not rule?'group_ids' or rule->'group_ids' ? (d.source_record->>'rem_project_group_id'))
    and (kind<>'programme' or exists(select 1 from hub.project_programmes x where x.project_id=p.id and upper(x.programme_key)=ref and x.participating and x.state='approved'))),'[]') else '[]'::jsonb end,
  'frozen',false);
end $$;

create function hub.faq_fact_keys(keys text[]) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select keys is not null and not exists(select 1 from unnest(keys) k where not exists(
  select 1 from hub.field_catalog where field_key=k and status='active' and (section='facts' and entity='project' or field_key='price.amount')))
$$;

-- Extend Phase 2 functions without changing the Phase 4 intake implementation.
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.save_faq(uuid,integer,jsonb)'::regprocedure);
 d:=replace(d,'hub.content_fact_keys','hub.faq_fact_keys');
 d:=replace(d,'if coalesce(edited.applicability_rule,''{}'')<>''{}'' then raise exception ''Rule resolution is not enabled yet; select explicit phases'' using errcode=''23514''; end if;',
  'if coalesce(edited.applicability_rule,''{}'')<>''{}'' then
   perform hub.require_permission(''projects'',''view'');
   edited.applies_to_project_ids:=hub.faq_rule_projects(edited.applicability_rule,kind,ref);
  end if;');
 d:=replace(d,'coalesce(edited.applies_to_project_ids,''{}''),''{}'',edited.review_due',
  'coalesce(edited.applies_to_project_ids,''{}''),coalesce(edited.applicability_rule,''{}''),edited.review_due');
 if strpos(d,'hub.faq_rule_projects')=0 then raise exception 'FAQ rule extension did not match';end if;execute d;
 d:=pg_get_functiondef('hub.submit_faq(uuid,integer)'::regprocedure);
 d:=replace(d,'if f.scope_type<>''corporate'' and',
  'if v.applicability_rule<>''{}'' then
   perform hub.require_permission(''projects'',''view'');
   if v.applies_to_project_ids is distinct from hub.faq_rule_projects(v.applicability_rule,f.scope_type,f.scope_id) then
    raise exception ''Applicability changed; save and preview again'' using errcode=''40001'';end if;
  end if;
  if f.scope_type<>''corporate'' and');execute d;
 d:=pg_get_functiondef('hub.save_faq_question(text,integer,jsonb)'::regprocedure);
 execute replace(d,'hub.content_fact_keys','hub.faq_fact_keys');
end $$;

create function hub.faq_fact_slot(project_uuid uuid,key text,locale text,unit_public_id text,published_only boolean) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare f hub.project_facts;catalog hub.field_catalog;price jsonb;value jsonb;shown text;unit_label text;stamp date;
 today date:=(current_timestamp at time zone 'Asia/Bangkok')::date;exposure text;basis jsonb:='{}';fallback boolean:=false;
 rem jsonb;left_slot jsonb;right_slot jsonb;extra_slot jsonb;amount numeric;begin
 select * into catalog from hub.field_catalog where field_key=key and status='active';
 if not found or not hub.faq_fact_keys(array[key]) then return jsonb_build_object('available',false,'reason','unknown_field','field_key',key);end if;
 if key='price.amount' then
  select x into price from jsonb_array_elements(hub.project_current_prices(project_uuid)) x
   where (unit_public_id is null and x->>'kind'='starting') or (unit_public_id is not null and x->>'public_commercial_type_id'=unit_public_id)
   order by case when x->>'kind'='unit_type' then 0 else 1 end,(x->>'amount')::numeric,x->>'public_price_id' limit 1;
  if price is null then return jsonb_build_object('available',false,'reason','missing_or_expired_price','field_key',key);end if;
  select case when 'web_only' in (price->>'ai_exposure',x.ai_exposure,c.ai_exposure) then 'web_only' else 'open' end into exposure
   from hub.project_prices x join hub.commercial_types c on c.id=x.commercial_type_id where x.public_price_id=price->>'public_price_id';
  return price||jsonb_build_object('available',true,'field_key',key,'value',price->'amount','text',trim_scale((price->>'amount')::numeric)::text||case when locale='en' then ' THB' else ' บาท' end,
   'as_of',price->'valid_from','ai_exposure',exposure,'is_fallback_locale',locale='en' and (nullif(price#>>'{basis,en}','') is null or nullif(price#>>'{condition_text,en}','') is null));
 end if;
 select x.* into f from hub.project_facts x join hub.projects p on p.id=x.project_id where x.project_id=project_uuid and x.fact_key=key
  and x.grain in ('project','phase:'||p.rem_project_id) order by (x.grain<>'project') desc limit 1;
 if found then
  if f.ai_exposure='internal' then return jsonb_build_object('available',false,'reason','internal','field_key',key);end if;
  if f.as_of is null or f.as_of>today or f.valid_to<today or catalog.review_every_days is not null and f.as_of+catalog.review_every_days<today then
   return jsonb_build_object('available',false,'reason','expired_or_undated','field_key',key);end if;
  if published_only and f.approved_by is null then return jsonb_build_object('available',false,'reason','unapproved','field_key',key);end if;
  value:=coalesce(to_jsonb(f.value_number),to_jsonb(f.value_bool),to_jsonb(f.value_date),f.value_list,f.value_text);
  shown:=case when f.value_number is not null then trim_scale(f.value_number)::text
   when f.value_bool is not null then case when f.value_bool then case when locale='en' then 'Yes' else 'มี' end else case when locale='en' then 'No' else 'ไม่มี' end end
   when f.value_date is not null then f.value_date::text when f.value_text is not null then coalesce(nullif(f.value_text->>locale,''),f.value_text->>'th') else f.value_list::text end;
  fallback:=f.value_text is not null and nullif(f.value_text->>locale,'') is null and locale<>'th';
  stamp:=f.as_of;exposure:=f.ai_exposure;basis:=f.basis;
 else
  -- Derived/REM values are private preview evidence until a page review has
  -- captured an approved fact. Unknown inputs never become zero or absence.
  if published_only then return jsonb_build_object('available',false,'reason','missing_approved_fact','field_key',key);end if;
  rem:=hub.content_rem_values(project_uuid);exposure:=catalog.default_ai_exposure;
  if key in ('project.parking_pct_regular','project.parking_pct_total') then
   left_slot:=hub.faq_fact_slot(project_uuid,'project.parking_regular',locale,null,false);
   right_slot:=hub.faq_fact_slot(project_uuid,'project.unit_total',locale,null,false);
   if key='project.parking_pct_total' then extra_slot:=hub.faq_fact_slot(project_uuid,'project.parking_tandem',locale,null,false);end if;
   if not coalesce((left_slot->>'available')::boolean,false) or not coalesce((right_slot->>'available')::boolean,false)
    or coalesce((right_slot->>'value')::numeric,0)<=0 or extra_slot is not null and not coalesce((extra_slot->>'available')::boolean,false) then
    return jsonb_build_object('available',false,'reason','missing_dependency','field_key',key);end if;
   amount:=round(((left_slot->>'value')::numeric+coalesce((extra_slot->>'value')::numeric,0))/(right_slot->>'value')::numeric*100,2);
   stamp:=least((left_slot->>'as_of')::date,(right_slot->>'as_of')::date,(extra_slot->>'as_of')::date);
   if 'web_only' in (left_slot->>'ai_exposure',right_slot->>'ai_exposure',extra_slot->>'ai_exposure') then exposure:='web_only';end if;
  elsif key in ('project.building_count','project.floors_max') then
   select case when count(*) filter(where ai_exposure='internal')>0 then null when key='project.building_count' then nullif(count(*),0) when count(*) filter(where floors_above is null)=0 then max(floors_above) end,
    (max(updated_at) at time zone 'Asia/Bangkok')::date,case when bool_or(ai_exposure='web_only') then 'web_only' else exposure end
    into amount,stamp,exposure from hub.project_buildings where project_id=project_uuid;
  elsif key='project.phase_count' and nullif(rem->>'group_id','') is not null then
   select count(*),(min(source_snapshot_at) at time zone 'Asia/Bangkok')::date into amount,stamp
    from staging.dw_projects where source_record->>'rem_project_group_id'=rem->>'group_id';
  elsif key='project.project_status' then
   shown:=rem->>'project_status';value:=to_jsonb(shown);stamp:=(rem->>'as_of')::timestamptz::date;fallback:=locale='en';
  end if;
  if amount is not null then value:=to_jsonb(amount);shown:=trim_scale(amount)::text;end if;
 end if;
 if shown is null or btrim(shown)='' or stamp is null or exposure='internal' then return jsonb_build_object('available',false,'reason','missing','field_key',key);end if;
 unit_label:=coalesce(f.unit,catalog.unit);
 if locale='th' then unit_label:=case unit_label when 'THB/sqm/month' then 'บาท/ตร.ม./เดือน' when 'THB/sq_wah/month' then 'บาท/ตร.ว./เดือน'
  when 'THB/sqm' then 'บาท/ตร.ม.' when 'THB/sq_wah' then 'บาท/ตร.ว.' when 'THB/unit' then 'บาท/ยูนิต'
  when 'percent' then '%' when 'sq_wah' then 'ตร.ว.' else unit_label end;
 elsif unit_label='percent' then unit_label:='%';end if;
 return jsonb_build_object('available',true,'field_key',key,'value',value,'text',shown||case when nullif(unit_label,'') is not null then ' '||unit_label else '' end,
  'as_of',stamp,'valid_to',f.valid_to,'ai_exposure',exposure,'basis',basis,'is_fallback_locale',fallback,
  'disclaimer',case when key='project.rental_yield_gross_pct' then case when locale='en' then 'Estimate, not guaranteed' else 'ประมาณการ ไม่รับประกัน' end end);
end $$;

create function hub.faq_clean_text(value text) returns text
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select btrim(regexp_replace(regexp_replace(coalesce(value,''),'^[[:space:]]*(คำตอบ[[:space:]]*:|Answer[[:space:]]*:)[[:space:]]*','','i'),
  '(^|\n)[[:space:]]*(กลับหน้าหลัก|กลับขึ้นด้านบน|อ่านเพิ่มเติม|ดูทั้งหมด|Back to top|Read more)[[:space:]]*(\n|$)','\1','gi'))
$$;

create function hub.faq_lint(answer text,detail text,project_name text,brand_name text,keys text[],kind text) returns jsonb
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare issues jsonb:='[]';without_slots text;begin
 if btrim(coalesce(answer,''))='' or char_length(answer)>300 then issues:=issues||'"short_answer_length"'::jsonb;end if;
 if position(coalesce(nullif(project_name,''),chr(1)) in coalesce(answer,''))=0
  and position(coalesce(nullif(brand_name,''),chr(1)) in coalesce(answer,''))=0 then issues:=issues||'"name_required"'::jsonb;end if;
 if answer ~ '^[[:space:]]*(คำถาม|ถามว่า|Question|Q:)' then issues:=issues||'"direct_answer_required"'::jsonb;end if;
 without_slots:=regexp_replace(replace(replace(coalesce(answer,'')||' '||coalesce(detail,''),coalesce(nullif(project_name,''),chr(1)),''),coalesce(nullif(brand_name,''),chr(1)),''),'\{[^{}]+\}','','g');
 if cardinality(keys)>0 and without_slots ~ '[0-9๐-๙]' then issues:=issues||'"use_fact_slots_for_numbers"'::jsonb;end if;
 if kind in ('fact','auto') and cardinality(keys)=0 then issues:=issues||'"fact_keys_required"'::jsonb;end if;
 return issues;
end $$;

create function hub.faq_sync_gap(project_uuid uuid,key text,faq_uuid uuid,missing text[]) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare rem_id text;owner_name text;begin
 select rem_project_id into rem_id from hub.projects where id=project_uuid;
 if cardinality(missing)>0 then
  select string_agg(distinct owner_role,', ' order by owner_role) into owner_name from hub.field_catalog where field_key=any(missing);
  insert into hub.content_gaps(project_id,gap_code,question_key,missing_fact_keys,suggested_owner)
  values(rem_id,'FAQ_FACT_MISSING',key,missing,coalesce(owner_name,'Marketing'))
  on conflict(project_id,question_key) where gap_code='FAQ_FACT_MISSING' and question_key is not null
  do update set missing_fact_keys=excluded.missing_fact_keys,suggested_owner=excluded.suggested_owner,
   state=case when hub.content_gaps.state='resolved' then 'open' else hub.content_gaps.state end,
   resolved_by_faq_id=null,occurrences=hub.content_gaps.occurrences+1,last_seen=clock_timestamp(),revision=hub.content_gaps.revision+1;
 else
  update hub.content_gaps set state='resolved',resolved_by_faq_id=faq_uuid,missing_fact_keys='{}',revision=revision+1
   where project_id=rem_id and question_key=key and gap_code='FAQ_FACT_MISSING' and state<>'resolved';
 end if;
end $$;

create function hub.compose_project_faq(project_uuid uuid,locale text,unit_public_id text,published_only boolean,record_gaps boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects;q hub.faq_questions;chosen record;candidate record;form text;brand_ref text;brand_name text;project_name text;group_ref text;unit_uuid uuid;
 today date:=(current_timestamp at time zone 'Asia/Bangkok')::date;cells jsonb:='[]';items jsonb:='[]';hidden jsonb:='[]';conflicts jsonb:='[]';cell jsonb;
 candidates jsonb;top_rank integer;chosen_count integer;phase_ids text[];keys text[];missing text[];slots jsonb;slot jsonb;key text;
 question_text text;answer_text text;detail_text text;answer_template text;detail_template text;lint jsonb;state text;reason text;exposure text;stamp date;
 fallback boolean;changed boolean;blocked boolean:=false;legacy jsonb;begin
 if locale not in ('th','en') or locale is null then raise exception 'Unsupported FAQ locale' using errcode='23514';end if;
 select * into p from hub.projects where id=project_uuid and deleted_at is null;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 if unit_public_id is not null then
  select id into unit_uuid from hub.commercial_types where project_id=p.id and public_commercial_type_id=unit_public_id and deleted_at is null;
  if not found then raise exception 'Unit type does not belong to this project' using errcode='P0002';end if;
 end if;
 form:=case when unit_uuid is null then hub.faq_project_form(p.id) else (select product_form from hub.commercial_types where id=unit_uuid) end;
 group_ref:=hub.content_rem_values(p.id)->>'group_id';
 project_name:=coalesce(nullif(p.public_name->>locale,''),p.public_name->>'th');
 select public_brand_id,coalesce(nullif(public_name->>locale,''),public_name->>'th') into brand_ref,brand_name from hub.brands where id=p.brand_id and deleted_at is null;
 for q in select * from hub.faq_questions where status<>'retired' and (is_core or exists(select 1 from hub.faq_versions v where v.question_key=faq_questions.question_key)) order by web_sort,question_key loop
  cell:=jsonb_build_object('question_key',q.question_key,'question_label',coalesce(q.question_template->>locale,q.question_template->>'th'));
  if cardinality(q.property_types)>0 and (form is null or not form=any(q.property_types)) then
   cells:=cells||jsonb_build_array(cell||jsonb_build_object('state',case when form is null then 'hold' else 'not_applicable' end,'reason',case when form is null then 'unknown_property_form' else 'property_type' end));continue;
  end if;
  if q.status<>'approved' then cells:=cells||jsonb_build_array(cell||jsonb_build_object('state','hold','reason','question_not_approved'));continue;end if;
  candidates:='[]';top_rank:=0;
  for candidate in select f.scope_type,f.scope_id,v.*,
   case f.scope_type when 'unit_type' then 6 when 'project' then 5 when 'project_group' then 4 when 'programme' then 3 when 'brand' then 2 else 1 end rank
   from hub.faqs f join lateral (select * from hub.faq_versions x where x.faq_id=f.id
    and (not published_only or x.id=f.published_version_id and x.state='PUBLISHED') order by x.version_no desc limit 1) v on true
   where v.question_key=q.question_key and v.state<>'WITHDRAWN' and f.state<>'WITHDRAWN'
    and (f.scope_type='unit_type' and f.scope_id=unit_uuid::text or f.scope_type='project' and f.scope_id=p.rem_project_id
     or f.scope_type='project_group' and f.scope_id=group_ref or f.scope_type='programme'
     or f.scope_type='brand' and f.scope_id=brand_ref or f.scope_type='corporate' and q.show_on_project_pages)
   order by rank desc,f.id loop
   phase_ids:=case when not published_only and candidate.applicability_rule<>'{}' then hub.faq_rule_projects(candidate.applicability_rule,candidate.scope_type,candidate.scope_id) else candidate.applies_to_project_ids end;
   if not(p.rem_project_id=any(phase_ids) or candidate.scope_type='corporate' and cardinality(phase_ids)=0 and candidate.applicability_rule='{}') then continue;end if;
   if candidate.rank>top_rank then top_rank:=candidate.rank;candidates:='[]';end if;
   if candidate.rank=top_rank then candidates:=candidates||jsonb_build_array(to_jsonb(candidate)||jsonb_build_object('resolved_project_ids',phase_ids));end if;
  end loop;
  chosen_count:=jsonb_array_length(candidates);
  if chosen_count>1 then
   blocked:=true;conflicts:=conflicts||jsonb_build_array(jsonb_build_object('question_key',q.question_key,'faq_ids',(select jsonb_agg(x->'faq_id') from jsonb_array_elements(candidates) x)));
   cells:=cells||jsonb_build_array(cell||jsonb_build_object('state','hold','reason','same_level_conflict','count',chosen_count));continue;
  elsif chosen_count=0 then
   select jsonb_build_object('cluster_id',c.id,'state',hub.faq_intake_state(c.id)->>'state','holds',c.holds) into legacy
    from staging.faq_clusters c where c.suggested_question_key=q.question_key and p.rem_project_id=any(c.project_ids)
    and hub.faq_intake_state(c.id)->>'state' in ('open','held','question_proposed') order by c.sort_key limit 1;
   state:=case when legacy is null then 'missing' when legacy->>'state'='held' or jsonb_array_length(legacy->'holds')>0 then 'hold' else 'legacy_candidate' end;
   cells:=cells||jsonb_build_array(cell||jsonb_build_object('state',state,'legacy',legacy));continue;
  end if;
  select * into chosen from jsonb_to_record(candidates->0) as x(faq_id uuid,id uuid,version_no integer,scope_type text,scope_id text,state text,
   question jsonb,short_answer jsonb,detail jsonb,answer_kind text,fact_keys text[],applies_to_project_ids text[],resolved_project_ids text[],
   applicability_rule jsonb,review_due date,effective_to date,ai_exposure text);
  cell:=cell||jsonb_build_object('faq_id',chosen.faq_id,'version_id',chosen.id,'version_no',chosen.version_no,'scope_type',chosen.scope_type,'inherited',top_rank<5);
  reason:=case when chosen.ai_exposure='internal' or q.ai_exposure='internal' then 'internal' when chosen.effective_to<today then 'answer_expired' when chosen.review_due<today then 'review_due' end;
  if reason is not null then
   hidden:=hidden||jsonb_build_array(cell||jsonb_build_object('reason',reason));cells:=cells||jsonb_build_array(cell||jsonb_build_object('state','hold','reason',reason));continue;
  end if;
  question_text:=hub.faq_clean_text(coalesce(nullif(chosen.question->>locale,''),chosen.question->>'th'));
  answer_template:=hub.faq_clean_text(coalesce(nullif(chosen.short_answer->>locale,''),chosen.short_answer->>'th'));
  detail_template:=hub.faq_clean_text(coalesce(nullif(chosen.detail->>locale,''),chosen.detail->>'th'));
  fallback:=locale<>'th' and (nullif(chosen.question->>locale,'') is null or nullif(chosen.short_answer->>locale,'') is null);
  question_text:=replace(replace(question_text,'{project}',coalesce(project_name,'')),'{brand}',coalesce(brand_name,''));
  answer_template:=replace(replace(answer_template,'{project}',coalesce(project_name,'')),'{brand}',coalesce(brand_name,''));
  detail_template:=replace(replace(detail_template,'{project}',coalesce(project_name,'')),'{brand}',coalesce(brand_name,''));
  keys:=array(select distinct k from unnest(chosen.fact_keys||q.fact_keys) k order by k);
  lint:=hub.faq_lint(answer_template,detail_template,project_name,brand_name,keys,chosen.answer_kind);
  if q.question_key in ('project_availability','project_installments') and (chosen.answer_kind<>'handoff' or answer_template !~* '(Sales|ฝ่ายขาย|ทีมขาย|สำนักงานขาย)') then lint:=lint||'"sales_handoff_required"'::jsonb;end if;
  answer_text:=answer_template;detail_text:=detail_template;slots:='[]';missing:='{}';stamp:=null;
  exposure:=case when 'web_only' in (chosen.ai_exposure,q.ai_exposure) then 'web_only' else 'open' end;
  foreach key in array keys loop
   slot:=hub.faq_fact_slot(p.id,key,locale,unit_public_id,published_only);slots:=slots||jsonb_build_array(slot);
   if not coalesce((slot->>'available')::boolean,false) then missing:=array_append(missing,key);continue;end if;
   if position('{'||split_part(key,'.',2)||'}' in answer_template||detail_template)=0 and position('{'||key||'}' in answer_template||detail_template)=0 then lint:=lint||to_jsonb('unused_fact_slot:'||key);end if;
   answer_text:=replace(replace(answer_text,'{'||key||'}',slot->>'text'),'{'||split_part(key,'.',2)||'}',slot->>'text');
   detail_text:=replace(replace(detail_text,'{'||key||'}',slot->>'text'),'{'||split_part(key,'.',2)||'}',slot->>'text');
   stamp:=least(stamp,(slot->>'as_of')::date);fallback:=fallback or coalesce((slot->>'is_fallback_locale')::boolean,false);
   if slot->>'ai_exposure'='web_only' then exposure:='web_only';end if;
  end loop;
  if record_gaps and cardinality(keys)>0 then perform hub.faq_sync_gap(p.id,q.question_key,chosen.faq_id,missing);end if;
  if cardinality(missing)>0 then
   hidden:=hidden||jsonb_build_array(cell||jsonb_build_object('reason','missing_fact','missing_fact_keys',missing));
   cells:=cells||jsonb_build_array(cell||jsonb_build_object('state','waiting_for_fact','missing_fact_keys',missing));continue;
  end if;
  if answer_text||detail_text||question_text ~ '\{[^{}]+\}' then lint:=lint||'"unknown_fact_slot"'::jsonb;end if;
  if char_length(answer_text)>300 then lint:=lint||'"resolved_answer_too_long"'::jsonb;end if;
  changed:=chosen.applicability_rule<>'{}' and chosen.applies_to_project_ids is distinct from chosen.resolved_project_ids;
  if changed then lint:=lint||'"applicability_changed"'::jsonb;end if;
  if jsonb_array_length(lint)>0 then blocked:=true;end if;
  state:=case when jsonb_array_length(lint)>0 then 'hold' when chosen.state='PUBLISHED' then case when top_rank<5 then 'inherited' else 'published' end else 'draft' end;
  cell:=cell||jsonb_build_object('state',state,'lint',lint,'applies_to_project_ids',chosen.resolved_project_ids,'applicability_changed',changed);
  cells:=cells||jsonb_build_array(cell);
  items:=items||jsonb_build_array(cell||jsonb_build_object('question',question_text,'short_answer',answer_text,'detail',detail_text,
   'answer_kind',chosen.answer_kind,'as_of',stamp,'as_of_label',case when stamp is not null then case when locale='en' then 'Information as of ' else 'ข้อมูล ณ ' end||stamp::text end,
   'facts',slots,'ai_exposure',exposure,'is_fallback_locale',fallback));
 end loop;
 return jsonb_build_object('project',jsonb_build_object('public_id',p.public_project_id,'rem_project_id',p.rem_project_id,'name',p.public_name),
  'mode',case when published_only then 'PUBLISHED_CONTENT' else 'PRIVATE_DRAFT' end,'locale',locale,'items',items,'hidden',hidden,'cells',cells,'conflicts',conflicts,'ready',not blocked);
end $$;

create function hub.faq_composition(public_id text,locale text default 'th',unit_public_id text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare project_uuid uuid;begin
 perform hub.require_permission('knowledge','view');perform hub.require_permission('projects','view');
 select id into project_uuid from hub.projects where public_project_id=public_id and deleted_at is null;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 return hub.compose_project_faq(project_uuid,locale,unit_public_id,false,true);
end $$;

create function hub.faq_coverage(public_id text default null,page_offset integer default 0,page_size integer default 25) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects;preview jsonb;rows jsonb:='[]';total integer;questions jsonb;begin
 perform hub.require_permission('knowledge','view');perform hub.require_permission('projects','view');
 if page_offset is null or page_offset not between 0 and 100000 or page_size is null or page_size not between 1 and 100 then
  raise exception 'Invalid coverage page' using errcode='23514';end if;
 select count(*) into total from hub.projects where deleted_at is null and (public_id is null or public_project_id=public_id);
 select coalesce(jsonb_agg(jsonb_build_object('question_key',question_key,'label',question_template,'status',status) order by web_sort,question_key),'[]') into questions
  from hub.faq_questions where is_core and status<>'retired';
 for p in select * from hub.projects where deleted_at is null and (public_id is null or public_project_id=public_id) order by public_project_id offset page_offset limit page_size loop
  preview:=hub.compose_project_faq(p.id,'th',null,false,true);
  rows:=rows||jsonb_build_array(jsonb_build_object('project',preview->'project','ready',preview->'ready','cells',coalesce((select jsonb_agg(x) from jsonb_array_elements(preview->'cells') x
   where exists(select 1 from hub.faq_questions where question_key=x->>'question_key' and is_core)),'[]')));
 end loop;
 return jsonb_build_object('questions',questions,'rows',rows,'total',total,'offset',page_offset,
  'next_offset',case when page_offset+page_size<total then page_offset+page_size end,'mode','PRIVATE_DRAFT');
end $$;

create function hub.faq_gaps(public_id text default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('knowledge','view');perform hub.require_permission('projects','view');
 return coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('public_project_id',p.public_project_id,'project_name',p.public_name,'question_label',q.question_template) order by g.last_seen desc,g.id)
  from (select * from hub.content_gaps where gap_code='FAQ_FACT_MISSING' and question_key is not null
   and (public_id is null or project_id=(select rem_project_id from hub.projects where public_project_id=public_id and deleted_at is null)) order by last_seen desc,id limit 100) g
  join hub.projects p on p.rem_project_id=g.project_id and p.deleted_at is null join hub.faq_questions q on q.question_key=g.question_key),'[]');
end $$;

create function hub.faq_gap_update(gap uuid,expected integer,next_state text,assign_self boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;prior hub.content_gaps;begin
 actor:=hub.require_permission('knowledge','edit');perform hub.require_permission('projects','view');
 select * into prior from hub.content_gaps where id=gap and gap_code='FAQ_FACT_MISSING' and question_key is not null for update;
 if not found then raise exception 'FAQ task not found' using errcode='P0002';end if;
 if prior.revision is distinct from expected then raise exception 'FAQ task changed' using errcode='40001';end if;
 if next_state is null or next_state not in ('open','in_progress','resolved') then raise exception 'Invalid task state' using errcode='23514';end if;
 if prior.assignee is not null and prior.assignee<>actor then raise exception 'This task is assigned to another person' using errcode='42501';end if;
 if next_state='resolved' and cardinality(prior.missing_fact_keys)>0 then raise exception 'Refresh the FAQ preview to verify repaired facts first' using errcode='23514';end if;
 update hub.content_gaps set state=next_state,assignee=case when assign_self is null then assignee when assign_self then actor end,revision=revision+1 where id=gap;
 return (select to_jsonb(g) from hub.content_gaps g where id=gap);
end $$;

do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and p.proname=any(array[
  'faq_project_form','faq_rule_projects','faq_applicability_preview','faq_fact_keys','faq_fact_slot','faq_clean_text','faq_lint','faq_sync_gap','compose_project_faq',
  'faq_composition','faq_coverage','faq_gaps','faq_gap_update']) loop execute format('revoke all on function %s from public',f);end loop;
end $$;
grant execute on function hub.faq_applicability_preview(jsonb,text,text),hub.faq_composition(text,text,text),hub.faq_coverage(text,integer,integer),
 hub.faq_gaps(text),hub.faq_gap_update(uuid,integer,text,boolean) to hub_app;
comment on function hub.compose_project_faq(uuid,text,text,boolean,boolean) is 'Private K3 composition. Phase 8 owns publication, frozen applicability and public projection.';
commit;
