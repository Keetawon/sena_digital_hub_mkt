-- Translation is a private draft workflow, never publication or approval.
begin;
create role hub_translation_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema hub to hub_translation_worker;
create table hub.translation_glossary (
 term_key text primary key check(term_key ~ '^[a-z0-9_.-]{1,150}$'),
 term jsonb not null, status text not null default 'proposed' check(status in ('proposed','active','retired')),
 revision integer not null default 1, version_author uuid, approved_by uuid, approved_at timestamptz
);
create table hub.content_translations (
 id uuid primary key default gen_random_uuid(), owner_type text not null, owner_key text not null,
 field_key text not null references hub.field_catalog, source_tab text not null, scope_id text not null,
 row_ref jsonb not null, th_text text not null, th_sha256 text not null, th_version integer not null default 1,
 en_from_th_version integer, reviewed_en text, machine_en text, entered_en text,
 translation_state text not null check(translation_state in ('missing','machine','reviewed','stale')),
 reviewed_by uuid, reviewed_at timestamptz, revision integer not null default 1,
 unique(owner_type,owner_key,field_key)
);
create table hub.translation_jobs (
 id uuid primary key default gen_random_uuid(), translation_id uuid not null references hub.content_translations,
 th_version integer not null, th_sha256 text not null, requested_by uuid not null,
 status text not null default 'queued' check(status in ('queued','running','done','failed','superseded')),
 attempts integer not null default 0, lease_token uuid, lease_expires timestamptz,
 error_code text check(error_code in ('provider_unavailable','provider_error','invalid_translation','source_changed','permission_revoked')),
 draft_en text, model text, completed_at timestamptz, unique(translation_id,th_version)
);
alter table hub.project_selling_points add column editors uuid[] not null default '{}';
alter table hub.faq_versions add column translations jsonb not null default '{}';
alter table hub.content_section_versions add column translations jsonb not null default '{}';

do $$ declare name text; predicate text; begin
 foreach name in array array['translation_glossary','content_translations','translation_jobs'] loop
  execute format('alter table hub.%I add column created_at timestamptz not null default clock_timestamp(),
   add column created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,
   add column updated_at timestamptz not null default clock_timestamp(),
   add column updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid',name);
  execute format('alter table hub.%I enable row level security',name);
  execute format('alter table hub.%I force row level security',name);
  execute format('create policy content_owner on hub.%I to %I using(true) with check(true)',name,current_user);
  predicate:=case when name='translation_glossary' then 'hub.can(''knowledge'',''view'')'
   when name='content_translations' then 'hub.can(source_tab,''view'')'
   else 'exists(select 1 from hub.content_translations t where t.id=translation_id and hub.can(t.source_tab,''view''))' end;
  execute format('create policy content_read on hub.%I for select to hub_app using(%s)',name,predicate);
  execute format('grant select on hub.%I to hub_app',name);
  execute format('create trigger content_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',name);
  execute format('create trigger content_touch before update on hub.%I for each row execute function hub.touch_record()',name);
 end loop;
end $$;

-- Facility names are a controlled starting glossary proposal. No English name
-- is invented for non_dee; Q75 stays pending until its owner supplies one.
insert into hub.translation_glossary(term_key,term)
 select 'facility.'||code,jsonb_build_object('th',name_th,'en',name_en) from hub.facility_taxonomy;
insert into hub.translation_glossary(term_key,term) values
 ('feature.non_dee','{"th":"นอนดี","en":""}'),('unit.sqm','{"th":"ตารางเมตร","en":"square metres"}'),
 ('unit.sq_wah','{"th":"ตารางวา","en":"square wah"}');
update hub.field_catalog set validation=validation||'{"ai_translation":true}'::jsonb where field_key='project.ad_disclaimer';

create function hub.translation_allowed(key text) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select key=any(array['project.public_name','project.address','project.ad_disclaimer','project.meta_title','project.meta_description',
  'brand.public_name','brand.description','facility.description','section.project_intro','section.selling_summary','section.concept_name',
  'section.concept_detail','section.location_summary','section.corporate_intro','section.corporate_services','selling_point.title','selling_point.detail',
  'building.name','faq.question','faq.alt_questions','faq.short_answer','faq.detail','question.question_template','question.alt_questions'])
  and exists(select 1 from hub.field_catalog where field_key=key and status='active' and source_policy='mkt'
   and 'en'=any(locales_required) and validation->>'ai_translation'='true')
$$;
create function hub.translation_source_allowed(kind text,owner text) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select case when kind='question' then exists(select 1 from hub.faq_questions where question_key=owner
  and topic not in ('commercial_terms','investment_context','buying_process'))
 when kind='faq' then exists(select 1 from hub.faqs f join lateral
  (select question_key from hub.faq_versions where faq_id=f.id order by version_no desc limit 1) v on true
  left join hub.faq_questions q on q.question_key=v.question_key where f.id=owner::uuid
   and coalesce(q.topic,f.topic) not in ('commercial_terms','investment_context','buying_process'))
 else kind in ('project','brand','facility','section','selling_point','building') end
$$;
create function hub.sync_content_translation(kind text,owner text,key text,tab text,scope text,ref jsonb,value jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare previous hub.content_translations; text_th text; digest text; next_id uuid; source_changed boolean; actor uuid;
begin
 if jsonb_typeof(value)<>'object' then return; end if;
 text_th:=coalesce(value->>'th',''); digest:=encode(sha256(convert_to(text_th,'UTF8')),'hex'); actor:=hub.permission_actor();
 select * into previous from hub.content_translations where owner_type=kind and owner_key=owner and field_key=key for update;
 source_changed:=previous.id is null or previous.th_sha256<>digest;
 next_id:=coalesce(previous.id,gen_random_uuid());
 insert into hub.content_translations(id,owner_type,owner_key,field_key,source_tab,scope_id,row_ref,th_text,th_sha256,translation_state,entered_en)
 values(next_id,kind,owner,key,tab,scope,ref,text_th,digest,'missing',value->>'en')
 on conflict(owner_type,owner_key,field_key) do update set row_ref=excluded.row_ref,th_text=excluded.th_text,th_sha256=excluded.th_sha256,
  entered_en=excluded.entered_en,th_version=hub.content_translations.th_version+case when source_changed then 1 else 0 end,
  machine_en=case when source_changed then null else hub.content_translations.machine_en end,
  translation_state=case when source_changed then case when hub.content_translations.reviewed_en is null then 'missing' else 'stale' end
   when hub.content_translations.reviewed_en is not null and coalesce(value->>'en','')=hub.content_translations.reviewed_en
    and hub.content_translations.en_from_th_version=hub.content_translations.th_version then 'reviewed'
   when hub.content_translations.translation_state='reviewed' then 'stale' else hub.content_translations.translation_state end,
  revision=hub.content_translations.revision+1;
 if source_changed then
  -- Older jobs self-supersede at claim/finish. Never lock a job while holding
  -- its source row: the worker locks jobs before source metadata.
  if btrim(text_th)<>'' and actor is not null and hub.can(tab,'edit') and hub.translation_allowed(key) and hub.translation_source_allowed(kind,owner) then
   insert into hub.translation_jobs(translation_id,th_version,th_sha256,requested_by)
    select id,th_version,th_sha256,actor from hub.content_translations where id=next_id;
  end if;
 end if;
end $$;

create function hub.track_content_translation() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare data jsonb:=to_jsonb(new); previous jsonb:='{}'; kind text; owner text; tab text; scope text; ref jsonb; key text; column_name text; keys text[];
begin
 if tg_op='UPDATE' then previous:=to_jsonb(old); end if;
 if tg_table_name='projects' then kind:='project';owner:=data->>'id';tab:='projects';scope:=data->>'public_project_id';keys:=array['public_name','address','ad_disclaimer','meta_title','meta_description'];ref:=jsonb_build_object('id',owner);
 elsif tg_table_name='brands' then kind:='brand';owner:=data->>'id';tab:='brands';scope:=data->>'public_brand_id';keys:=array['public_name','description'];ref:=jsonb_build_object('id',owner);
 elsif tg_table_name in ('project_facilities','project_buildings','project_selling_points') then
  tab:='projects';select public_project_id into scope from hub.projects where id=(data->>'project_id')::uuid;
  if tg_table_name='project_facilities' then kind:='facility';owner:=(data->>'project_id')||':'||(data->>'facility_code');keys:=array['description'];ref:=jsonb_build_object('project_id',data->'project_id','facility_code',data->'facility_code');
  elsif tg_table_name='project_buildings' then kind:='building';owner:=(data->>'project_id')||':'||(data->>'building_key');keys:=array['name'];ref:=jsonb_build_object('project_id',data->'project_id','building_key',data->'building_key');
  else kind:='selling_point';owner:=data->>'point_key';keys:=array['title','detail'];ref:=jsonb_build_object('project_id',data->'project_id','point_key',data->'point_key','revision',data->'revision');end if;
 elsif tg_table_name='content_section_versions' then
  if data->>'section_key' is null then return new; end if;
  kind:='section';owner:=data->>'section_id';keys:=array[data->>'section_key'];ref:=jsonb_build_object('id',data->'id');
  select hub.content_scope_tab(scope_type),scope_id into tab,scope from hub.content_sections where id=owner::uuid;
 elsif tg_table_name='faq_versions' then kind:='faq';owner:=data->>'faq_id';tab:='knowledge';scope:=owner;keys:=array['question','alt_questions','short_answer','detail'];ref:=jsonb_build_object('id',data->'id');
 elsif tg_table_name='faq_questions' then kind:='question';owner:=data->>'question_key';tab:='knowledge';scope:=owner;keys:=array['question_template','alt_questions'];ref:=jsonb_build_object('question_key',owner);
 else raise exception 'Unsupported translation source' using errcode='23514'; end if;
 foreach key in array keys loop
  column_name:=case when kind='section' then 'body' else key end;
  if tg_op='UPDATE' and data->column_name is not distinct from previous->column_name then continue; end if;
  perform hub.sync_content_translation(kind,owner,case when kind='section' then key else kind||'.'||key end,tab,scope,ref,coalesce(data->column_name,'{}'));
 end loop;
 return new;
end $$;
do $$ declare name text; begin
 foreach name in array array['projects','brands','project_facilities','project_buildings','project_selling_points','content_section_versions','faq_versions','faq_questions'] loop
  execute format('create trigger content_translation after insert or update on hub.%I for each row execute function hub.track_content_translation()',name);
 end loop;
end $$;

create function hub.translation_editable(t hub.content_translations) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if t.owner_type='faq' then return exists(select 1 from hub.faq_versions v join hub.faqs f on f.id=v.faq_id
  where v.id=(t.row_ref->>'id')::uuid and v.state='DRAFT' and coalesce(f.draft_version_id,v.id)=v.id);
 elsif t.owner_type='section' then return exists(select 1 from hub.content_section_versions v join hub.content_sections s on s.id=v.section_id
  where v.id=(t.row_ref->>'id')::uuid and v.state='DRAFT' and coalesce(s.draft_version_id,v.id)=v.id);
 elsif t.owner_type='selling_point' then return exists(select 1 from hub.project_selling_points where point_key=t.owner_key::uuid
  and revision=(t.row_ref->>'revision')::integer and state='DRAFT');
 elsif t.owner_type='question' then return exists(select 1 from hub.faq_questions where question_key=t.owner_key and status='proposed');
 end if;
 return t.owner_type in ('project','brand','facility','building');
end $$;
create function hub.content_translation_list(tab text,scope text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission(tab,'view');
 return coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('editable',hub.translation_editable(t),'job',
  (select jsonb_build_object('status',status,'error_code',error_code,'model',model,'completed_at',completed_at) from hub.translation_jobs where translation_id=t.id and th_version=t.th_version)) order by field_key)
  from hub.content_translations t where source_tab=tab and scope_id=scope),'[]');
end $$;
create function hub.review_content_translation(translation uuid,expected integer,source_version integer,english text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare t hub.content_translations; actor uuid; col text; table_name text; condition text; limit_chars integer; point hub.project_selling_points;
begin
 select * into t from hub.content_translations where id=translation;
 if not found then raise exception 'Translation not found' using errcode='P0002'; end if;
 actor:=hub.require_permission(t.source_tab,'edit');
 -- Lock the same identity/row first as ordinary saves. This avoids reversing
 -- the editor's row -> translation lock order during a concurrent EN review.
 if t.owner_type='project' then perform 1 from hub.projects where id=t.owner_key::uuid for update;
 elsif t.owner_type='brand' then perform 1 from hub.brands where id=t.owner_key::uuid for update;
 elsif t.owner_type='faq' then
  perform 1 from hub.faqs where id=t.owner_key::uuid for update;
  perform 1 from hub.faq_versions where id=(t.row_ref->>'id')::uuid for update;
 elsif t.owner_type='section' then
  perform 1 from hub.content_sections where id=t.owner_key::uuid for update;
  perform 1 from hub.content_section_versions where id=(t.row_ref->>'id')::uuid for update;
 elsif t.owner_type in ('facility','building','selling_point') then
  perform 1 from hub.projects where id=(t.row_ref->>'project_id')::uuid for update;
 elsif t.owner_type='question' then perform 1 from hub.faq_questions where question_key=t.owner_key for update;
 end if;
 select * into t from hub.content_translations where id=translation for update;
 if t.revision is distinct from expected or t.th_version is distinct from source_version then raise exception 'Thai source or translation changed' using errcode='40001'; end if;
 if not hub.translation_editable(t) then raise exception 'Submitted translation is immutable; create another draft' using errcode='23514'; end if;
 select coalesce((validation->>'max_length')::integer,12000) into limit_chars from hub.field_catalog where field_key=t.field_key;
 if btrim(coalesce(english,''))='' or char_length(english)>limit_chars then raise exception 'Invalid English translation' using errcode='23514'; end if;
 -- The same placeholder/number multiset must survive manual review as well as
 -- provider validation. No invented financial values can enter via translation.
 if (select coalesce(array_agg(m[1] order by m[1]),'{}') from regexp_matches(t.th_text,'(\{[a-zA-Z_][a-zA-Z0-9_.]*\}|[0-9๐-๙]+(?:[.,][0-9๐-๙]+)*)','g') m)
  is distinct from (select coalesce(array_agg(m[1] order by m[1]),'{}') from regexp_matches(english,'(\{[a-zA-Z_][a-zA-Z0-9_.]*\}|[0-9๐-๙]+(?:[.,][0-9๐-๙]+)*)','g') m) then
  raise exception 'Placeholders and numbers must be preserved' using errcode='23514'; end if;
 col:=case when t.owner_type='section' then 'body' else split_part(t.field_key,'.',2) end;
 if t.owner_type in ('project','brand','faq','section') then
  table_name:=case t.owner_type when 'project' then 'projects' when 'brand' then 'brands' when 'faq' then 'faq_versions' else 'content_section_versions' end;
  execute format('update hub.%I set %I=jsonb_set(%I,''{en}'',to_jsonb($1::text),true) where id=$2',table_name,col,col) using english,(t.row_ref->>'id')::uuid;
  if t.owner_type in ('faq','section') then
   execute format('update hub.%I set editors=array(select distinct unnest(editors||$1::uuid[])) where id=$2',table_name) using array[actor],(t.row_ref->>'id')::uuid;
   if t.owner_type='faq' then update hub.faqs set revision=revision+1 where id=t.owner_key::uuid;
   else update hub.content_sections set revision=revision+1 where id=t.owner_key::uuid; end if;
  end if;
 elsif t.owner_type='facility' then update hub.project_facilities set description=jsonb_set(description,'{en}',to_jsonb(english),true)
  where project_id=(t.row_ref->>'project_id')::uuid and facility_code=t.row_ref->>'facility_code';
 elsif t.owner_type='building' then update hub.project_buildings set name=jsonb_set(name,'{en}',to_jsonb(english),true),revision=revision+1
  where project_id=(t.row_ref->>'project_id')::uuid and building_key=t.row_ref->>'building_key';
 elsif t.owner_type='selling_point' then
  select * into point from hub.project_selling_points where project_id=(t.row_ref->>'project_id')::uuid and point_key=t.owner_key::uuid
   order by revision desc limit 1;
  if point.revision is distinct from (t.row_ref->>'revision')::integer then raise exception 'Selling point changed' using errcode='40001'; end if;
  point:=jsonb_populate_record(point,jsonb_build_object(col,jsonb_set(to_jsonb(point)->col,'{en}',to_jsonb(english),true)));
  insert into hub.project_selling_points(project_id,point_key,revision,title,detail,icon_code,linked_feature_code,linked_fact_keys,sort,state,ai_exposure,editors)
   values(point.project_id,point.point_key,point.revision+1,point.title,point.detail,point.icon_code,point.linked_feature_code,point.linked_fact_keys,point.sort,'DRAFT',point.ai_exposure,
    array(select distinct e from unnest(point.editors||array[point.created_by,actor]) e where e is not null));
 elsif t.owner_type='question' then
  execute format('update hub.faq_questions set %I=jsonb_set(%I,''{en}'',to_jsonb($1::text),true),revision=revision+1,version_author=$2 where question_key=$3',col,col) using english,actor,t.owner_key;
  insert into hub.faq_question_versions(question_key,revision,payload) select question_key,revision,to_jsonb(q) from hub.faq_questions q where question_key=t.owner_key;
 else raise exception 'Unsupported translation target' using errcode='23514'; end if;
 update hub.content_translations set reviewed_en=english,en_from_th_version=th_version,translation_state='reviewed',reviewed_by=actor,reviewed_at=clock_timestamp(),revision=revision+1 where id=translation;
 return (select to_jsonb(c) from hub.content_translations c where id=translation);
end $$;

create function hub.retry_content_translation(translation uuid,expected integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare t hub.content_translations; actor uuid; job hub.translation_jobs; begin
 select * into t from hub.content_translations where id=translation;
 if not found then raise exception 'Translation not found' using errcode='P0002'; end if;
 actor:=hub.require_permission(t.source_tab,'edit');
 -- Match the worker lock order: job before translation. Ordinary text saves
 -- do not touch an existing job, so a concurrent edit can safely supersede it.
 select * into job from hub.translation_jobs where translation_id=translation and th_version=t.th_version for update;
 select * into t from hub.content_translations where id=translation for update;
 if t.revision is distinct from expected then raise exception 'Translation changed' using errcode='40001'; end if;
 if job.id is null or job.status<>'failed' or job.th_version<>t.th_version or not hub.translation_editable(t) or not hub.translation_allowed(t.field_key) or not hub.translation_source_allowed(t.owner_type,t.owner_key) then
  raise exception 'Only a failed current draft can be retried' using errcode='23514'; end if;
 update hub.translation_jobs set status='queued',requested_by=actor,attempts=0,error_code=null,completed_at=null,lease_token=null,lease_expires=null where id=job.id;
 update hub.content_translations set revision=revision+1 where id=translation;
 return jsonb_build_object('status','queued');
end $$;

create function hub.glossary_read() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin perform hub.require_permission('knowledge','view');return coalesce((select jsonb_agg(to_jsonb(g) order by term_key) from hub.translation_glossary g),'[]');end $$;
create function hub.save_glossary(key text,expected integer,terms jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; prior hub.translation_glossary; begin
 actor:=hub.require_permission('knowledge','edit');
 perform pg_advisory_xact_lock(hashtextextended('glossary:'||key,0));
 select * into prior from hub.translation_glossary where term_key=key for update;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'Glossary changed' using errcode='40001'; end if;
 if not hub.content_locales(terms,300,true) then raise exception 'Invalid glossary terms' using errcode='23514'; end if;
 insert into hub.translation_glossary(term_key,term,version_author) values(key,terms,actor)
 on conflict(term_key) do update set term=excluded.term,status='proposed',version_author=actor,approved_by=null,approved_at=null,revision=hub.translation_glossary.revision+1;
 return (select to_jsonb(g) from hub.translation_glossary g where term_key=key);
end $$;
create function hub.approve_glossary(key text,expected integer,decision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; prior hub.translation_glossary; begin
 actor:=hub.require_permission('knowledge','approve');
 select * into prior from hub.translation_glossary where term_key=key for update;
 if not found then raise exception 'Glossary term not found' using errcode='P0002'; end if;
 if prior.revision is distinct from expected then raise exception 'Glossary changed' using errcode='40001'; end if;
 if prior.version_author=actor then raise exception 'The version editor cannot approve it' using errcode='42501'; end if;
 if decision not in ('active','retired') or decision='active' and btrim(coalesce(prior.term->>'en',''))='' then raise exception 'Reviewed English term required' using errcode='23514'; end if;
 update hub.translation_glossary set status=decision,approved_by=actor,approved_at=clock_timestamp(),revision=revision+1 where term_key=key;
 return (select to_jsonb(g) from hub.translation_glossary g where term_key=key);
end $$;

create function hub.translation_requester_allowed(p_account uuid,p_tab text) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from hub.user_account a join hub.account_permission p on p.account_id=a.id join hub.permission_catalog c on c.tab=p.tab
  where a.id=p_account and a.status='ACTIVE' and a.hub_role in ('editor','publisher','viewer','admin','online_staff')
   and p.tab=p_tab and p.can_view and p.can_edit and c.rollout_state='MIGRATED' and c.guards_ready)
$$;
create function hub.claim_translation(p_translation uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j hub.translation_jobs; t hub.content_translations; lease uuid; begin
 loop
  select * into j from hub.translation_jobs where (p_translation is null or translation_id=p_translation)
   and (status='queued' or status='running' and lease_expires<clock_timestamp())
   order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  select * into t from hub.content_translations where id=j.translation_id for update;
  if t.th_version<>j.th_version or t.th_sha256<>j.th_sha256 or not hub.translation_allowed(t.field_key) or not hub.translation_source_allowed(t.owner_type,t.owner_key) or not hub.translation_editable(t) then
   update hub.translation_jobs set status='superseded',error_code='source_changed',lease_token=null,lease_expires=null where id=j.id;continue;
  end if;
  if not hub.translation_requester_allowed(j.requested_by,t.source_tab) then
   update hub.translation_jobs set status='failed',error_code='permission_revoked',lease_token=null,lease_expires=null where id=j.id;continue;
  end if;
  if j.attempts>=3 then update hub.translation_jobs set status='failed',error_code='provider_error',lease_token=null,lease_expires=null where id=j.id;continue;end if;
  lease:=gen_random_uuid();
  update hub.translation_jobs set status='running',attempts=attempts+1,lease_token=lease,lease_expires=clock_timestamp()+interval '120 seconds' where id=j.id;
  return jsonb_build_object('id',j.id,'lease_token',lease,'text',t.th_text,'field_key',t.field_key,
   'max_length',(select coalesce((validation->>'max_length')::integer,12000) from hub.field_catalog where field_key=t.field_key),
   'glossary',coalesce((select jsonb_agg(term order by char_length(term->>'th') desc,term_key) from hub.translation_glossary where status='active'),'[]'));
 end loop;
end $$;
create function hub.finish_translation(job uuid,lease uuid,english text,model_name text,error text) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j hub.translation_jobs; t hub.content_translations; begin
 select * into j from hub.translation_jobs where id=job for update;
 if not found or j.status<>'running' or j.lease_token is distinct from lease or j.lease_expires<clock_timestamp() then raise exception 'Translation lease changed' using errcode='40001'; end if;
 select * into t from hub.content_translations where id=j.translation_id for update;
 if t.th_version<>j.th_version or t.th_sha256<>j.th_sha256 or not hub.translation_allowed(t.field_key) or not hub.translation_source_allowed(t.owner_type,t.owner_key) or not hub.translation_editable(t) then
  update hub.translation_jobs set status='superseded',error_code='source_changed',lease_token=null,lease_expires=null where id=job;return 'superseded';end if;
 if error is not null then
  update hub.translation_jobs set status='failed',error_code=error,lease_token=null,lease_expires=null,completed_at=clock_timestamp() where id=job;return 'failed';end if;
 if btrim(coalesce(english,''))='' or char_length(english)>(select coalesce((validation->>'max_length')::integer,12000) from hub.field_catalog where field_key=t.field_key)
  or btrim(coalesce(model_name,''))='' then raise exception 'Invalid translation output' using errcode='23514';end if;
 if (select coalesce(array_agg(m[1] order by m[1]),'{}') from regexp_matches(t.th_text,'(\{[a-zA-Z_][a-zA-Z0-9_.]*\}|[0-9๐-๙]+(?:[.,][0-9๐-๙]+)*)','g') m)
  is distinct from (select coalesce(array_agg(m[1] order by m[1]),'{}') from regexp_matches(english,'(\{[a-zA-Z_][a-zA-Z0-9_.]*\}|[0-9๐-๙]+(?:[.,][0-9๐-๙]+)*)','g') m) then
  raise exception 'Placeholders and numbers must be preserved' using errcode='23514'; end if;
 if not hub.translation_requester_allowed(j.requested_by,t.source_tab) then
  update hub.translation_jobs set status='failed',error_code='permission_revoked',lease_token=null,lease_expires=null,completed_at=clock_timestamp() where id=job;return 'failed';end if;
 update hub.translation_jobs set status='done',draft_en=english,model=model_name,completed_at=clock_timestamp(),lease_token=null,lease_expires=null where id=job;
 update hub.content_translations set machine_en=english,translation_state=case when reviewed_en is null then 'machine' else translation_state end,revision=revision+1 where id=t.id;
 return 'done';
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub'
  and p.proname=any(array['translation_allowed','translation_source_allowed','sync_content_translation','track_content_translation','translation_editable','content_translation_list',
   'review_content_translation','retry_content_translation','glossary_read','save_glossary','approve_glossary','translation_requester_allowed','claim_translation','finish_translation']) loop
  execute format('revoke all on function %s from public',f.signature);
  if f.proname in ('content_translation_list','review_content_translation','retry_content_translation','glossary_read','save_glossary','approve_glossary') then execute format('grant execute on function %s to hub_app',f.signature); end if;
  if f.proname in ('claim_translation','finish_translation') then execute format('grant execute on function %s to hub_translation_worker',f.signature); end if;
 end loop;
end $$;
commit;
