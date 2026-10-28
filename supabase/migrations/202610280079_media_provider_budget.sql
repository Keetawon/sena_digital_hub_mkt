-- H5a/H5c: existing roles only. TEST application is held for the combined release.
begin;
alter table hub.media_jobs drop constraint media_jobs_status_check;
alter table hub.media_jobs add constraint media_jobs_status_check check(
 status in ('queued','running','done','failed','superseded') or status='budget_exhausted' and kind='image_suggestion');
alter table hub.media_jobs drop constraint media_jobs_error_code_check;
alter table hub.media_jobs add constraint media_jobs_error_code_check check(error_code in
 ('source_changed','permission_revoked','provider_unavailable','provider_error','invalid_result','manual_required','file_unavailable','budget_exhausted'));
alter table hub.media_jobs add constraint media_image_budget_error check(error_code is distinct from 'budget_exhausted' or kind='image_suggestion');

create function hub.media_budget_blocked() returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from hub.media_jobs where kind='image_suggestion' and status='budget_exhausted'
  and error_code='budget_exhausted' and completed_at>=date_trunc('month',current_timestamp at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok')
$$;

create function hub.provider_budget_event(agent text,code text) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;begin
 if agent is null or code is null or agent not in ('media','knowledge') or code not in ('project_spend_limit_exceeded','organization_spend_limit_exceeded','insufficient_quota') then
  raise exception 'Invalid provider event' using errcode='23514';end if;
 if agent='media' then
  if current_setting('role')<>'hub_media_worker' then raise exception 'Worker role required' using errcode='42501';end if;
 else actor:=hub.require_permission('knowledge','view');end if;
 insert into audit.change_log(actor,database_role,table_name,operation,before_row,after_row,reason)
 values(actor,current_setting('role'),'hub.provider_budget','INSERT',null,
  jsonb_build_object('agent',agent,'state','budget_exhausted','code',code),'provider_spend_limit');
end $$;

create function hub.media_budget_exhausted(job_uuid uuid,lease uuid,code text) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j hub.media_jobs;begin
 if current_setting('role')<>'hub_media_worker' then raise exception 'Worker role required' using errcode='42501';end if;
 select * into j from hub.media_jobs where id=job_uuid for update;
 if not found or j.kind<>'image_suggestion' or j.status<>'running' or j.lease_token is distinct from lease then
  raise exception 'Image lease changed' using errcode='40001';end if;
 perform hub.provider_budget_event('media',code);
 update hub.media_jobs set status='budget_exhausted',error_code='budget_exhausted',lease_token=null,lease_expires=null,
  completed_at=clock_timestamp() where kind='image_suggestion' and (status='queued' or id=job_uuid);
 return 'budget_exhausted';
end $$;

-- A later individual request still sees the provider block until the next month.
do $$ declare d text;signature text;begin
 d:=pg_get_functiondef('hub.media_job_request(text,text,uuid,integer)'::regprocedure);
 d:=replace(d,'insert into hub.media_jobs(project_id,kind,subject_id,source_revision,requested_by)',
  'if kind_name=''image_suggestion'' and hub.media_budget_blocked() then return jsonb_build_object(''status'',''budget_exhausted'');end if;
   insert into hub.media_jobs(project_id,kind,subject_id,source_revision,requested_by)');execute d;
 foreach signature in array array['hub.media_claim()','hub.website_media_claim(uuid[])'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  d:=replace(d,E'\n loop',E'\n if hub.media_budget_blocked() then return null;end if;\n loop');execute d;
 end loop;
end $$;
revoke all on function hub.media_budget_blocked(),hub.provider_budget_event(text,text),hub.media_budget_exhausted(uuid,uuid,text) from public;
grant execute on function hub.media_budget_blocked() to hub_app,hub_media_worker;
grant execute on function hub.provider_budget_event(text,text) to hub_app,hub_media_worker;
grant execute on function hub.media_budget_exhausted(uuid,uuid,text) to hub_media_worker;
commit;
