-- W7: marketing-copy proposals only. No live provider and no content write.
-- Depends on W6's closed require_content_translation_scope(uuid,text) guard.
begin;
alter table hub.field_catalog add column ai_writing_enabled boolean not null default false;

create function hub.writing_aid_field_safe(key text) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(key=any(array[
  'project.meta_title','project.meta_description','brand.description',
  'section.project_intro','section.selling_summary','section.concept_name','section.concept_detail',
  'section.location_summary','section.corporate_intro','section.corporate_services',
  'selling_point.title','selling_point.detail','faq.question','faq.alt_questions','faq.short_answer','faq.detail',
  'facility.description','commercial_type.description','commercial_type.highlights',
  'article.title','article.excerpt','article.seo_title','article.seo_description'
 ]) and exists(select 1 from hub.field_catalog where field_key=key
  and source_policy='mkt' and value_kind in ('text','rich','list')),false)
$$;

-- Every existing/new field remains off until an explicit authorized registry
-- save opts it in. The finite safe allowlist above is a hard veto, not a seed.

create or replace function hub.save_content_field(key text,expected integer,changes jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare prior hub.field_catalog; edited hub.field_catalog; begin
 perform hub.require_field_admin();
 select * into prior from hub.field_catalog where field_key=key for update;
 if not found then raise exception 'Field not found' using errcode='P0002'; end if;
 if prior.revision is distinct from expected then raise exception 'Field changed' using errcode='40001'; end if;
 if jsonb_typeof(changes) is distinct from 'object' or exists(select 1 from jsonb_object_keys(changes) k where k not in
  ('label','help','sort','owner_role','required_for','review_every_days','status','faq_question_keys','ai_writing_enabled')) then
  raise exception 'Invalid field changes' using errcode='23514'; end if;
 if changes ? 'ai_writing_enabled' and jsonb_typeof(changes->'ai_writing_enabled') is distinct from 'boolean' then
  raise exception 'Boolean writing eligibility required' using errcode='23514'; end if;
 edited:=jsonb_populate_record(prior,changes);
 if exists(select 1 from jsonb_each_text(edited.required_for) where value not in ('required','recommended','optional')) then
  raise exception 'Invalid requirement' using errcode='23514'; end if;
 if edited.ai_writing_enabled and not hub.writing_aid_field_safe(key) then
  raise exception 'Field is excluded from writing assistance' using errcode='23514'; end if;
 update hub.field_catalog set label=edited.label,help=edited.help,sort=edited.sort,owner_role=edited.owner_role,
  required_for=edited.required_for,review_every_days=edited.review_every_days,status=edited.status,
  faq_question_keys=edited.faq_question_keys,ai_writing_enabled=edited.ai_writing_enabled,revision=revision+1 where field_key=key;
 return (select to_jsonb(f) from hub.field_catalog f where field_key=key);
end $$;
-- content_fields() already projects to_jsonb(field_catalog), including the flag.

create table hub.writing_ai_settings (
 singleton boolean primary key default true check(singleton),
 monthly_cap_usd numeric(12,6) not null default 0 check(monthly_cap_usd between 0 and 10000),
 request_ceiling_usd numeric(12,6) not null default 0 check(request_ceiling_usd between 0 and 100),
 blocked_month date,
 provider_mode text not null default 'stub' check(provider_mode='stub'),
 model text not null default 'stub-writing-v1' check(model='stub-writing-v1')
);
create table hub.writing_ai_requests (
 id uuid primary key,
 translation_id uuid not null references hub.content_translations,
 source_revision integer not null check(source_revision>0),
 language text not null check(language in ('th','en')),
 mode text not null check(mode in ('draft','proofread','shorten')),
 context jsonb not null default '[]' check(jsonb_typeof(context)='array' and jsonb_array_length(context)<=8),
 requested_by uuid not null,
 status text not null check(status in ('running','done','failed','budget_exhausted')),
 error_code text check(error_code in ('provider_error','invalid_output','source_changed','permission_revoked','budget_exhausted')),
 model text not null default 'stub-writing-v1' check(model='stub-writing-v1'),
 synthetic boolean not null default true check(synthetic),
 input_tokens integer not null default 0 check(input_tokens=0),
 output_tokens integer not null default 0 check(output_tokens=0),
 elapsed_ms integer check(elapsed_ms between 0 and 600000),
 budget_month date not null,
 reserved_usd numeric(12,6) not null default 0 check(reserved_usd>=0),
 charged_usd numeric(12,6) not null default 0 check(charged_usd>=0 and charged_usd<=reserved_usd),
 completed_at timestamptz
);
create index writing_ai_budget_month on hub.writing_ai_requests(budget_month);
create index writing_ai_actor_source on hub.writing_ai_requests(requested_by,translation_id);

-- Operational usage metadata only; raw inputs/proposals never enter a table or
-- the existing audit stream. No new content-history or logging system.
do $$ declare name text; begin
 foreach name in array array['writing_ai_settings','writing_ai_requests'] loop
  execute format('alter table hub.%I add column created_at timestamptz not null default clock_timestamp(),
   add column created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,
   add column updated_at timestamptz not null default clock_timestamp(),
   add column updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid',name);
  execute format('alter table hub.%I enable row level security',name);
  execute format('alter table hub.%I force row level security',name);
  execute format('create policy writing_owner on hub.%I to %I using(true) with check(true)',name,current_user);
  execute format('create trigger writing_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',name);
  execute format('create trigger writing_touch before update on hub.%I for each row execute function hub.touch_record()',name);
 end loop;
end $$;
insert into hub.writing_ai_settings(singleton) values(true);

create function hub.writing_aid_source(translation uuid,required_level text) returns hub.content_translations
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare t hub.content_translations; actor uuid; scope_kind text; scope_ref text; begin
 if required_level is null or required_level not in ('view','edit') then
  raise exception 'Writing permits only source view or edit' using errcode='42501'; end if;
 actor:=hub.permission_actor();
 if not exists(select 1 from hub.user_account where id=actor and status='ACTIVE'
  and hub_role not in ('agency','service_consumer') and agency_code is null) then
  raise exception 'Internal active account required' using errcode='42501'; end if;
 select * into t from hub.content_translations where id=translation;
 if not found then raise exception 'Writing source not found' using errcode='P0002'; end if;
 if t.source_tab not in ('projects','brands','knowledge') then
  raise exception 'Writing source excluded' using errcode='42501'; end if;
 perform hub.require_permission(t.source_tab,required_level);
 -- Mandatory W6 object guard, including shared FAQ/article applicability.
 -- Never replace a missing guard with a tab-only fallback.
 perform hub.require_content_translation_scope(translation,required_level);
 if t.owner_type='section' then
  select scope_type,scope_id into scope_kind,scope_ref from hub.content_sections where id=t.owner_key::uuid;
  perform hub.content_scope_access(scope_kind,scope_ref,required_level);
 elsif t.source_tab in ('projects','brands') then
  perform hub.content_scope_access(case t.source_tab when 'projects' then 'project' else 'brand' end,t.scope_id,required_level);
 end if;
 return t;
end $$;

create function hub.writing_aid_allowed(t hub.content_translations) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select hub.writing_aid_field_safe(t.field_key)
  and exists(select 1 from hub.field_catalog where field_key=t.field_key and status='active' and ai_writing_enabled)
  and hub.translation_source_allowed(t.owner_type,t.owner_key)
  -- Topic/source policy remains a hard veto even if the registry flag is true.
  and (t.owner_type<>'faq' or exists(select 1 from hub.faq_versions v
   join hub.faqs f on f.id=v.faq_id left join hub.faq_questions q on q.question_key=v.question_key
   where v.id=(t.row_ref->>'id')::uuid and coalesce(q.topic,f.topic) in
    ('identity','brand','design','location','transport','nearby','facilities','parking_security',
     'unit_types','sustainability','technology','construction_progress')
   and v.answer_kind='text' and cardinality(v.fact_keys)=0))
  and (t.owner_type<>'article' or exists(select 1 from hub.articles a
   where a.id=(t.row_ref->>'article_id')::uuid and a.category in
    ('identity','brand','design','location','transport','nearby','facilities','parking_security',
     'unit_types','sustainability','technology','construction_progress')))
$$;

create function hub.writing_aid_budget() returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('month',m.budget_month,'cap_usd',s.monthly_cap_usd,'spent_usd',coalesce(j.spent,0),
  'remaining_usd',greatest(0,s.monthly_cap_usd-coalesce(j.spent,0)),
  'ceiling_usd',s.request_ceiling_usd,'model',s.model,'synthetic',true,
  'status',case when s.blocked_month=m.budget_month or coalesce(j.spent,0)+s.request_ceiling_usd>s.monthly_cap_usd
   then 'budget_exhausted' else 'available' end)
 from hub.writing_ai_settings s cross join lateral
  (select date_trunc('month',current_timestamp at time zone 'Asia/Bangkok')::date as budget_month) m
 left join lateral(select sum(charged_usd) spent from hub.writing_ai_requests where budget_month=m.budget_month) j on true
 where singleton
$$;

create function hub.writing_aid_input(translation uuid,expected integer,locale text,operation text,context_fields jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare t hub.content_translations; c hub.content_translations; item jsonb; source_text text; before_text text; maximum integer; begin
 t:=hub.writing_aid_source(translation,'edit');
 if t.revision is distinct from expected then raise exception 'Writing source changed' using errcode='40001'; end if;
 if not hub.writing_aid_allowed(t) or not hub.translation_editable(t) then
  raise exception 'Writing source is not an eligible draft' using errcode='42501'; end if;
 if locale is null or locale not in ('th','en') or operation is null or operation not in ('draft','proofread','shorten')
  or jsonb_typeof(context_fields) is distinct from 'array' then raise exception 'Invalid writing request' using errcode='23514'; end if;
 if jsonb_array_length(context_fields)>8 or operation<>'draft' and context_fields<>'[]'::jsonb then
  raise exception 'Context belongs only to draft mode' using errcode='23514'; end if;
 if exists(select 1 from jsonb_array_elements(context_fields) x where jsonb_typeof(x)<>'object'
  or x-array['translation_id','expected_revision']<>'{}'::jsonb
  or not x ?& array['translation_id','expected_revision'] or jsonb_typeof(x->'expected_revision')<>'number') then
  raise exception 'Invalid writing context reference' using errcode='23514'; end if;
 if (select count(distinct x->>'translation_id') from jsonb_array_elements(context_fields) x)<>jsonb_array_length(context_fields)
  or exists(select 1 from jsonb_array_elements(context_fields) x where x->>'translation_id'=translation::text) then
  raise exception 'Duplicate writing context' using errcode='23514'; end if;
 before_text:=case locale when 'th' then t.th_text else coalesce(t.entered_en,'') end;
 source_text:=before_text;
 for item in select value from jsonb_array_elements(context_fields) loop
  c:=hub.writing_aid_source((item->>'translation_id')::uuid,'view');
  if c.revision is distinct from (item->>'expected_revision')::integer then raise exception 'Writing context changed' using errcode='40001'; end if;
  if not hub.writing_aid_allowed(c) then raise exception 'Writing context excluded' using errcode='42501'; end if;
  source_text:=concat_ws(E'\n',nullif(source_text,''),nullif(case locale when 'th' then c.th_text else coalesce(c.entered_en,'') end,''));
 end loop;
 if btrim(source_text)='' or char_length(source_text)>12000 then raise exception 'Writing input is empty or too long' using errcode='23514'; end if;
 select least(12000,coalesce((validation->>'max_length')::integer,12000)) into maximum from hub.field_catalog where field_key=t.field_key;
 return jsonb_build_object('input_text',source_text,'before',before_text,'max_length',maximum,
  'source',jsonb_build_object('translation_id',t.id,'revision',t.revision,'th_version',t.th_version,
   'owner_type',t.owner_type,'owner_key',t.owner_key,'field_key',t.field_key,'row_ref',t.row_ref));
end $$;

create function hub.writing_aid_state(translation uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare t hub.content_translations; begin
 t:=hub.writing_aid_source(translation,'view');
 return jsonb_build_object('translation_id',t.id,'revision',t.revision,'eligible',hub.writing_aid_allowed(t),
  'editable',hub.translation_editable(t),'budget',hub.writing_aid_budget(),'requests',coalesce((
   -- Ten minutes is a recovery observation window, not an execution timeout.
   -- Keep the physical row and charge; a late finish still rechecks authority.
   select jsonb_agg(to_jsonb(q)||case when q.status='running'
    and q.created_at < statement_timestamp()-interval '10 minutes'
    then jsonb_build_object('status','ambiguous') else '{}'::jsonb end
    order by q.created_at desc,q.id) from
    (select r.* from hub.writing_ai_requests r where translation_id=translation and requested_by=hub.permission_actor()
     and hub.writing_aid_request_visible(r)
     order by created_at desc,id limit 10) q),'[]'));
end $$;

create function hub.writing_aid_request_visible(q hub.writing_ai_requests) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare item jsonb; begin
 if q.requested_by is distinct from hub.permission_actor() then return false; end if;
 perform hub.writing_aid_source(q.translation_id,'view');
 for item in select value from jsonb_array_elements(q.context) loop
  perform hub.writing_aid_source((item->>'translation_id')::uuid,'view');
 end loop;
 return true;
 exception when insufficient_privilege or no_data_found then return false;
end $$;

create function hub.writing_aid_begin(translation uuid,expected integer,locale text,operation text,request_uuid uuid,context_fields jsonb default '[]') returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; input jsonb; previous hub.writing_ai_requests; budget jsonb; charge numeric; begin
 -- Every writing command takes scope before budget/usage locks. Admission may
 -- wait for the cap, so resolve source revisions and expiry only after that wait.
 perform hub.content_scope_lock();
 -- ponytail: a short global admission lock serializes the monthly cap. The
 -- provider runs after commit, so no network work holds a database lock.
 perform pg_advisory_xact_lock(hashtextextended('writing_monthly_budget',0));
 input:=hub.writing_aid_input(translation,expected,locale,operation,context_fields);
 actor:=hub.permission_actor();
 if request_uuid is null then raise exception 'Request identity required' using errcode='23514'; end if;
 select * into previous from hub.writing_ai_requests where id=request_uuid;
 if found then
  if previous.requested_by is distinct from actor then raise exception 'Request belongs to another actor' using errcode='42501'; end if;
  if previous.translation_id<>translation or previous.source_revision<>expected or previous.language<>locale
   or previous.mode<>operation or previous.context<>context_fields then raise exception 'Request identity reused' using errcode='40001'; end if;
  return to_jsonb(previous)||jsonb_build_object('replayed',true,'status',
   case when previous.status='running' and previous.created_at < statement_timestamp()-interval '10 minutes'
    then 'ambiguous' else previous.status end);
 end if;
 budget:=hub.writing_aid_budget();
 charge:=case when budget->>'status'='budget_exhausted' then 0 else (budget->>'ceiling_usd')::numeric end;
 -- Charge the entire bounded reservation before starting. An ambiguous result
 -- never releases it or automatically retries. The local stub costs zero;
 -- positive synthetic fixture ceilings exercise admission without a live call.
 insert into hub.writing_ai_requests(id,translation_id,source_revision,language,mode,context,requested_by,status,error_code,
  budget_month,reserved_usd,charged_usd,completed_at)
 values(request_uuid,translation,expected,locale,operation,context_fields,actor,
  case when budget->>'status'='budget_exhausted' then 'budget_exhausted' else 'running' end,
  case when budget->>'status'='budget_exhausted' then 'budget_exhausted' end,
  (budget->>'month')::date,charge,charge,case when budget->>'status'='budget_exhausted' then clock_timestamp() end)
 returning * into previous;
 if previous.status='budget_exhausted' then return to_jsonb(previous); end if;
 return input||jsonb_build_object('status','ready','id',request_uuid,'synthetic',true,'model',previous.model);
end $$;

create function hub.writing_aid_finish(request_uuid uuid,error text,elapsed integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare q hub.writing_ai_requests; code text:=error; begin
 perform hub.content_scope_lock();
 if error='budget_exhausted' then
  perform pg_advisory_xact_lock(hashtextextended('writing_monthly_budget',0));
 end if;
 select * into q from hub.writing_ai_requests where id=request_uuid for update;
 if not found or q.requested_by is distinct from nullif(current_setting('app.actor_id',true),'')::uuid then
  raise exception 'Writing request unavailable' using errcode='42501'; end if;
 if elapsed is null or elapsed not between 0 and 600000 or code is not null and code not in
  ('provider_error','invalid_output','budget_exhausted') then raise exception 'Invalid writing outcome' using errcode='23514'; end if;
 -- Recheck all source/object/context authority and revisions immediately before
 -- the API may return text. Revocation cannot release a stale proposal.
 begin
  perform hub.writing_aid_input(q.translation_id,q.source_revision,q.language,q.mode,q.context);
 exception when insufficient_privilege then code:='permission_revoked';
  when serialization_failure or no_data_found or check_violation then code:='source_changed';
 end;
 if q.status<>'running' then
  if code in ('permission_revoked','source_changed') then raise exception 'Writing request no longer accessible' using errcode='42501'; end if;
  return to_jsonb(q)||jsonb_build_object('replayed',true);
 end if;
 if error='budget_exhausted' then
  update hub.writing_ai_settings set blocked_month=greatest(blocked_month,q.budget_month) where singleton;
 end if;
 update hub.writing_ai_requests set status=case when code='budget_exhausted' then 'budget_exhausted'
   when code is null then 'done' else 'failed' end,error_code=code,elapsed_ms=elapsed,completed_at=clock_timestamp()
  where id=request_uuid returning * into q;
 return to_jsonb(q);
end $$;

revoke all on hub.writing_ai_settings,hub.writing_ai_requests from public,hub_app;
revoke all on function hub.writing_aid_field_safe(text),hub.writing_aid_source(uuid,text),
 hub.writing_aid_allowed(hub.content_translations),hub.writing_aid_budget(),
 hub.writing_aid_input(uuid,integer,text,text,jsonb),hub.writing_aid_state(uuid),
 hub.writing_aid_request_visible(hub.writing_ai_requests),
 hub.writing_aid_begin(uuid,integer,text,text,uuid,jsonb),hub.writing_aid_finish(uuid,text,integer) from public;
grant execute on function hub.writing_aid_state(uuid),hub.writing_aid_begin(uuid,integer,text,text,uuid,jsonb),
 hub.writing_aid_finish(uuid,text,integer) to hub_app;
commit;
