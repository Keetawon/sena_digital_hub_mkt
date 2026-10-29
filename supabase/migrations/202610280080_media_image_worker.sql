-- H5a/H5e: image-only leases, bounded spend and a read-only private image broker.
begin;
create table hub.media_ai_settings (
 singleton boolean primary key default true check(singleton),
 monthly_cap_usd numeric(12,6) not null default 0 check(monthly_cap_usd between 0 and 5),
 model text not null default 'gpt-5.4-mini-2026-03-17',
 input_usd_per_million numeric not null default 0.75,
 cached_input_usd_per_million numeric not null default 0.075,
 output_usd_per_million numeric not null default 4.50,
 price_effective_date date not null default '2026-10-28',
 max_input_tokens integer not null default 48000 check(max_input_tokens=48000),
 max_output_tokens integer not null default 3500 check(max_output_tokens=3500),
 provider_configured boolean not null default false,worker_seen_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),created_by uuid,
 updated_at timestamptz not null default clock_timestamp(),updated_by uuid,
 check(model='gpt-5.4-mini-2026-03-17' and input_usd_per_million=0.75 and cached_input_usd_per_million=0.075 and output_usd_per_million=4.50)
);
alter table hub.media_ai_settings enable row level security;
alter table hub.media_ai_settings force row level security;
do $$ begin execute format('create policy media_ai_owner on hub.media_ai_settings to %I using(true) with check(true)',current_user);end $$;
create trigger media_ai_audit after insert or update or delete on hub.media_ai_settings for each row execute function audit.record_change();
create trigger media_ai_touch before update on hub.media_ai_settings for each row execute function hub.touch_record();
insert into hub.media_ai_settings(singleton) values(true);
do $$ begin
 if current_database()='postgres' and hub.hosted_test_profile() then
  update hub.media_ai_settings set monthly_cap_usd=5;
 end if;
end $$;

alter table hub.media_jobs add column budget_month date;
alter table hub.media_jobs add column reserved_usd numeric(12,6) not null default 0 check(reserved_usd>=0);
alter table hub.media_jobs add column charged_usd numeric(12,6) not null default 0 check(charged_usd>=0);
alter table hub.media_jobs add column provider_attempted boolean not null default false;
alter table hub.media_jobs add column available_after timestamptz not null default '-infinity';
alter table hub.media_jobs add constraint media_image_spend_only check(kind='image_suggestion' or
 (budget_month is null and reserved_usd=0 and charged_usd=0 and not provider_attempted));

-- A lease is an ephemeral credential. New audit entries never contain it.
create function hub.media_job_audit() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 insert into audit.change_log(actor,database_role,table_name,operation,before_row,after_row,reason)
 values(nullif(current_setting('app.actor_id',true),'')::uuid,current_setting('role'),'hub.media_jobs',tg_op,
  case when tg_op<>'INSERT' then to_jsonb(old)-'lease_token' end,
  case when tg_op<>'DELETE' then to_jsonb(new)-'lease_token' end,nullif(current_setting('app.change_reason',true),''));
 return coalesce(new,old);
end $$;
drop trigger media_audit on hub.media_jobs;
create trigger media_audit after insert or update or delete on hub.media_jobs for each row execute function hub.media_job_audit();

create function hub.media_budget_totals() returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('cap_usd',s.monthly_cap_usd,'spent_usd',coalesce(j.spent,0),
  'reserved_usd',coalesce(j.reserved,0),'remaining_usd',greatest(0,s.monthly_cap_usd-coalesce(j.spent,0)-coalesce(j.reserved,0)),
  'ceiling_usd',ceil((s.max_input_tokens*s.input_usd_per_million+s.max_output_tokens*s.output_usd_per_million))/1000000,
  'provider_configured',s.provider_configured and s.worker_seen_at>clock_timestamp()-interval '90 seconds',
  'model',s.model,'max_input_tokens',s.max_input_tokens,'max_output_tokens',s.max_output_tokens)
 from hub.media_ai_settings s left join lateral(
  select sum(case when provider_attempted then charged_usd else 0 end) spent,
   sum(case when not provider_attempted and status='running' then reserved_usd else 0 end) reserved
  from hub.media_jobs where kind='image_suggestion' and budget_month=date_trunc('month',current_timestamp at time zone 'Asia/Bangkok')::date
 ) j on true where singleton
$$;
create function hub.media_worker_heartbeat(configured boolean) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if current_setting('role')<>'hub_media_worker' then raise exception 'Worker role required' using errcode='42501';end if;
 update hub.media_ai_settings set provider_configured=configured,worker_seen_at=clock_timestamp() where singleton;
end $$;
create function hub.media_ai_state(public_id text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin perform hub.media_project(public_id,'view');return hub.media_budget_totals()||jsonb_build_object('budget_exhausted',hub.media_budget_blocked());end $$;

-- Existing permissions and entry point; a request never confirms metadata or rights.
create or replace function hub.media_job_request(public_id text,kind_name text,subject uuid,expected integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j hub.media_jobs;previous hub.media_jobs;state text;budget jsonb;begin
 j.project_id:=hub.media_project(public_id,'edit');j.kind:=kind_name;j.subject_id:=subject;j.source_revision:=expected;j.requested_by:=hub.permission_actor();
 if kind_name is null or kind_name not in ('image_suggestion','clip_metadata','clip_check') then raise exception 'Invalid media job' using errcode='23514';end if;
 if not hub.media_job_allowed(j) then raise exception 'Media source is unavailable or not eligible' using errcode='42501';end if;
 if kind_name='image_suggestion' then
  perform pg_advisory_xact_lock(hashtextextended('media_image_request:'||subject::text,0));
  select * into previous from hub.media_jobs where kind=kind_name and subject_id=subject and source_revision=expected
   order by (status in ('queued','running')) desc,created_at desc,id desc limit 1;
  if found and previous.status in ('queued','running') then state:=previous.status;
  elsif exists(select 1 from hub.assets where id=subject and (ai_suggestion->>'source_revision')::integer=expected) then state:='done';
  else
   budget:=hub.media_budget_totals();
   if not (budget->>'provider_configured')::boolean then state:='not_configured';
   elsif hub.media_budget_blocked() or (budget->>'remaining_usd')::numeric<(budget->>'ceiling_usd')::numeric then state:='budget_exhausted';
   end if;
  end if;
 end if;
 if state is null then
  insert into hub.media_jobs(project_id,kind,subject_id,source_revision,requested_by) values(j.project_id,j.kind,j.subject_id,j.source_revision,j.requested_by)
   on conflict(kind,subject_id,source_revision) where status in ('queued','running') do nothing returning * into previous;
  state:='queued';
 end if;
 insert into audit.change_log(actor,database_role,table_name,operation,after_row)
 values(j.requested_by,current_setting('role'),'hub.media_ai_request','INSERT',jsonb_build_object('asset_id',subject,'kind',kind_name,'source_revision',expected,'state',state));
 return jsonb_build_object('status',state);
end $$;

create function hub.media_image_claim(approved_jobs uuid[] default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j hub.media_jobs;a hub.assets;budget jsonb;lease uuid;context jsonb;ceiling numeric;begin
 if current_setting('role')<>'hub_media_worker' then raise exception 'Worker role required' using errcode='42501';end if;
 if approved_jobs is not null and (cardinality(approved_jobs) not between 1 and 5000 or array_position(approved_jobs,null) is not null) then
  raise exception 'Approved image jobs required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('media_monthly_budget',0));
 update hub.media_jobs set status='queued',lease_token=null,lease_expires=null,reserved_usd=0
  where kind='image_suggestion' and status='running' and lease_expires<clock_timestamp() and not provider_attempted and attempts=0
   and (approved_jobs is null or id=any(approved_jobs));
 update hub.media_jobs set status='failed',error_code='provider_error',lease_token=null,lease_expires=null,completed_at=clock_timestamp()
  where kind='image_suggestion' and status='running' and lease_expires<clock_timestamp() and (provider_attempted or attempts>0)
   and (approved_jobs is null or id=any(approved_jobs));
 budget:=hub.media_budget_totals();
 if not (budget->>'provider_configured')::boolean then return null;end if;
 ceiling:=(budget->>'ceiling_usd')::numeric;
 if hub.media_budget_blocked() or (budget->>'remaining_usd')::numeric<ceiling then
  update hub.media_jobs set status='budget_exhausted',error_code='budget_exhausted',completed_at=clock_timestamp(),lease_token=null,lease_expires=null
   where kind='image_suggestion' and status='queued';
  return null;
 end if;
 loop
  select * into j from hub.media_jobs where kind='image_suggestion' and (approved_jobs is null or id=any(approved_jobs))
   and (status='queued' and available_after<=clock_timestamp() or status='running' and lease_expires<clock_timestamp())
   order by created_at,id for update skip locked limit 1;
  if not found then return null;end if;
  if j.provider_attempted or j.attempts>0 then
   update hub.media_jobs set status='failed',error_code='provider_error',lease_token=null,lease_expires=null where id=j.id;continue;
  end if;
  if not hub.media_job_allowed(j) then
   update hub.media_jobs set status='superseded',error_code='source_changed',lease_token=null,lease_expires=null,reserved_usd=0 where id=j.id;continue;
  end if;
  if approved_jobs is not null and not exists(select 1 from hub.website_asset_suggestions where asset_id=j.subject_id and project_id=j.project_id and status='pending') then
   raise exception 'Approved website source required' using errcode='23514';end if;
  select * into a from hub.assets where id=j.subject_id;
  context:=jsonb_build_object('chosen_category',a.media_category,
   'categories',array_remove(array_remove(hub.media_categories(),'legal_document'),'brochure'),
   'tags',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'label',label,'tag_group',tag_group,'allowed_categories',allowed_categories) order by code),'[]') from hub.media_tags where status='active'),
   'facilities',(select coalesce(jsonb_agg(jsonb_build_object('code',f.facility_code,'name',t.name_th) order by f.facility_code),'[]') from hub.project_facilities f join hub.facility_taxonomy t on t.code=f.facility_code where f.project_id=j.project_id and f.status in ('present','planned')),
   'commercial_types',(select coalesce(jsonb_agg(jsonb_build_object('key',id,'name',public_name) order by id),'[]') from hub.commercial_types where project_id=j.project_id and deleted_at is null),
   'buildings',(select coalesce(jsonb_agg(jsonb_build_object('key',building_key,'name',name) order by building_key),'[]') from hub.project_buildings where project_id=j.project_id));
  if exists(select 1 from hub.website_asset_suggestions where asset_id=a.id and project_id=j.project_id) then context:=context-'chosen_category';end if;
  if octet_length(context::text)>32768 then
   update hub.media_jobs set status='failed',error_code='invalid_result',completed_at=clock_timestamp() where id=j.id;continue;
  end if;
  lease:=gen_random_uuid();
  update hub.media_jobs set status='running',lease_token=lease,lease_expires=clock_timestamp()+interval '180 seconds',
   budget_month=date_trunc('month',current_timestamp at time zone 'Asia/Bangkok')::date,reserved_usd=ceiling where id=j.id;
  return jsonb_build_object('id',j.id,'kind',j.kind,'lease_token',lease,'model',budget->>'model','context',context,
   'file',jsonb_build_object('mime_type',a.mime_type,'checksum',a.checksum,'storage_path',a.storage_path,'file_size',a.file_size,
    'storage_bucket',a.storage_bucket,'source_system',a.source_system,'storage_provider',case a.storage_bucket when 'local-originals' then 'local' when 'r2-test-content' then 'r2' else 'hosted' end));
 end loop;
end $$;

create function hub.media_image_lease(job_uuid uuid,lease uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j hub.media_jobs;a hub.assets;begin
 select * into j from hub.media_jobs where id=job_uuid;
 if not found or j.kind<>'image_suggestion' or j.status<>'running' or j.lease_token is distinct from lease
  or j.lease_expires<clock_timestamp() or j.provider_attempted or not hub.media_job_allowed(j) then return null;end if;
 select * into a from hub.assets where id=j.subject_id;
 return jsonb_build_object('mime_type',a.mime_type,'checksum',a.checksum,'storage_path',a.storage_path,'file_size',a.file_size,
  'storage_bucket',a.storage_bucket,'source_system',a.source_system);
end $$;
create function hub.media_image_fetch_audit(job_uuid uuid,outcome text) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if current_setting('role')<>'hub_app' or outcome not in ('ok','denied','unavailable') then raise exception 'Invalid image fetch audit' using errcode='42501';end if;
 insert into audit.change_log(database_role,table_name,operation,after_row)
 values(current_setting('role'),'hub.media_image_fetch','INSERT',jsonb_build_object('job_id',job_uuid,'outcome',outcome));
end $$;
create function hub.media_image_begin(job_uuid uuid,lease uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j hub.media_jobs;begin
 if current_setting('role')<>'hub_media_worker' then raise exception 'Worker role required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('media_monthly_budget',0));
 select * into j from hub.media_jobs where id=job_uuid for update;
 if not found or j.kind<>'image_suggestion' or j.status<>'running' or j.lease_token is distinct from lease or j.lease_expires<clock_timestamp()
  or j.provider_attempted or j.attempts>0 or not hub.media_job_allowed(j) then return false;end if;
 if j.budget_month<>date_trunc('month',current_timestamp at time zone 'Asia/Bangkok')::date then
  update hub.media_jobs set status='queued',lease_token=null,lease_expires=null,reserved_usd=0 where id=j.id;return false;end if;
 update hub.media_jobs set provider_attempted=true,attempts=1,charged_usd=reserved_usd where id=j.id;
 return true;
end $$;
create function hub.media_image_wait(job_uuid uuid,lease uuid) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if current_setting('role')<>'hub_media_worker' then raise exception 'Worker role required' using errcode='42501';end if;
 update hub.media_jobs set status='queued',lease_token=null,lease_expires=null,reserved_usd=0,available_after=clock_timestamp()+interval '30 seconds'
  where id=job_uuid and kind='image_suggestion' and status='running' and lease_token=lease and not provider_attempted and attempts=0;
 if not found then raise exception 'Image lease changed' using errcode='40001';end if;return 'queued';
end $$;

-- Keep local clip checks compatible. The dedicated hosted login can never enter that path.
alter function hub.media_claim() rename to media_clip_claim_legacy;
revoke all on function hub.media_clip_claim_legacy() from public,hub_app,hub_media_worker;
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.media_clip_claim_legacy()'::regprocedure);
 d:=replace(d,'where status=''queued'' or status=''running'' and lease_expires<clock_timestamp()',
  'where kind<>''image_suggestion'' and (status=''queued'' or status=''running'' and lease_expires<clock_timestamp())');execute d;
end $$;
create function hub.media_claim() returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare job jsonb;begin
 if hub.media_budget_blocked() then return null;end if;
 job:=hub.media_image_claim(null);if job is not null then return job;end if;
 if session_user='hub_media_worker_login' or current_database()='postgres' and hub.hosted_test_profile() then return null;end if;
 return hub.media_clip_claim_legacy();
end $$;
create or replace function hub.website_media_claim(approved_jobs uuid[]) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if approved_jobs is null then raise exception 'Approved image jobs required' using errcode='23514';end if;
 return hub.media_image_claim(approved_jobs);
end $$;

alter function hub.media_finish(uuid,uuid,jsonb,text,text) rename to media_finish_legacy;
revoke all on function hub.media_finish_legacy(uuid,uuid,jsonb,text,text) from public,hub_app,hub_media_worker;
create function hub.media_image_finish(job_uuid uuid,lease uuid,result jsonb,model_name text,error text,usage jsonb) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j hub.media_jobs;s hub.media_ai_settings;state text;cost numeric;begin
 if current_setting('role')<>'hub_media_worker' then raise exception 'Worker role required' using errcode='42501';end if;
 select * into j from hub.media_jobs where id=job_uuid for update;
 if not found or j.kind<>'image_suggestion' or j.status<>'running' or j.lease_token is distinct from lease or not j.provider_attempted then
  raise exception 'Image provider lease changed' using errcode='40001';end if;
 select * into s from hub.media_ai_settings where singleton;
 if model_name is distinct from s.model then raise exception 'Image model changed' using errcode='23514';end if;
 if usage is not null then
  if jsonb_typeof(usage) is distinct from 'object' or not usage ?& array['input_tokens','output_tokens','cached_input_tokens']
   or exists(select 1 from jsonb_each(usage) t(k,v) where k not in ('input_tokens','output_tokens','cached_input_tokens')
    or jsonb_typeof(v)<>'number' or v::text !~ '^[0-9]+$' or (v::text)::numeric>10000000)
   or (usage->>'cached_input_tokens')::numeric>(usage->>'input_tokens')::numeric then raise exception 'Invalid provider usage' using errcode='23514';end if;
  cost:=ceil(((usage->>'input_tokens')::numeric-(usage->>'cached_input_tokens')::numeric)*s.input_usd_per_million
   +(usage->>'cached_input_tokens')::numeric*s.cached_input_usd_per_million+(usage->>'output_tokens')::numeric*s.output_usd_per_million)/1000000;
 else cost:=j.reserved_usd;end if;
 update hub.media_jobs set provider_usage=usage,charged_usd=cost where id=j.id;
 state:=hub.media_finish_legacy(job_uuid,lease,result,model_name,error);return state;
end $$;
create function hub.media_finish(job_uuid uuid,lease uuid,result jsonb,model_name text,error text) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if exists(select 1 from hub.media_jobs where id=job_uuid and kind='image_suggestion') then
  return hub.media_image_finish(job_uuid,lease,result,model_name,error,null);
 end if;
 if session_user='hub_media_worker_login' or current_database()='postgres' and hub.hosted_test_profile() then
  raise exception 'Image-only worker' using errcode='42501';end if;
 return hub.media_finish_legacy(job_uuid,lease,result,model_name,error);
end $$;
create or replace function hub.website_media_finish(job_uuid uuid,lease uuid,result jsonb,model_name text,error text,usage jsonb) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin return hub.media_image_finish(job_uuid,lease,result,model_name,error,usage);end $$;

-- No new capability or actor grant. Only existing runtime/worker roles execute bounded RPCs.
create or replace function hub.media_jobs_read(public_id text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare project_uuid uuid;begin project_uuid:=hub.media_project(public_id,'view');
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'subject_id',subject_id,'source_revision',source_revision,
  'status',status,'error_code',error_code,'created_at',created_at,'completed_at',completed_at) order by created_at desc),'[]')
  from (select * from hub.media_jobs where project_id=project_uuid and (kind<>'image_suggestion' or hub.can_read_asset(subject_id)) order by created_at desc limit 100) jobs);
end $$;

revoke all on function hub.media_budget_totals(),hub.media_worker_heartbeat(boolean),hub.media_ai_state(text),hub.media_job_audit(),
 hub.media_image_claim(uuid[]),hub.media_image_lease(uuid,uuid),hub.media_image_fetch_audit(uuid,text),hub.media_image_begin(uuid,uuid),
 hub.media_image_wait(uuid,uuid),hub.media_image_finish(uuid,uuid,jsonb,text,text,jsonb),hub.media_claim(),hub.media_finish(uuid,uuid,jsonb,text,text) from public;
grant execute on function hub.media_ai_state(text),hub.media_image_lease(uuid,uuid),hub.media_image_fetch_audit(uuid,text) to hub_app;
grant execute on function hub.media_worker_heartbeat(boolean),hub.media_image_claim(uuid[]),hub.media_image_begin(uuid,uuid),
 hub.media_image_wait(uuid,uuid),hub.media_image_finish(uuid,uuid,jsonb,text,text,jsonb),hub.media_claim(),hub.media_finish(uuid,uuid,jsonb,text,text),hub.media_budget_totals() to hub_media_worker;
commit;
