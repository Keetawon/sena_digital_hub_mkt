begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint,source_record)
values('CACHE-TEST','โครงการทดสอบแคช',now(),'synthetic-cache','{"ProjectStatus":2,"isDeleted":false}');
set constraints hub.refresh_progress_at_commit immediate;
do $$ declare before_stamp timestamptz; v jsonb; begin
  select refreshed_at,source into before_stamp,v from hub.project_progress_cache where rem_project_id='CACHE-TEST';
  if before_stamp is null or v#>>'{source_review,status_raw}'<>'2' then raise exception 'Source cache missing'; end if;
  if exists(select 1 from jsonb_array_elements(v#>'{readiness,recommended}') e where e->>'field' like 'models.%.match_status') then raise exception 'Source model list leaked'; end if;
  perform set_config('role','viewer',true); perform * from hub.progress_rows(); perform set_config('role','none',true);
  if (select refreshed_at from hub.project_progress_cache where rem_project_id='CACHE-TEST')<>before_stamp then raise exception 'Ordinary read recomputed readiness'; end if;
  update staging.rem_projects set source_record='{"ProjectStatus":3,"isDeleted":false}' where rem_project_id='CACHE-TEST';
  if (select source#>>'{source_review,status_raw}' from hub.project_progress_cache where rem_project_id='CACHE-TEST')<>'3' then raise exception 'Import did not refresh'; end if;
  update hub.project_progress_cache set valid_until=now()-interval '1 second' where rem_project_id='CACHE-TEST';
  perform set_config('role','viewer',true); perform * from hub.progress_rows(); perform set_config('role','none',true);
  if (select valid_until from hub.project_progress_cache where rem_project_id='CACHE-TEST')<=now() then raise exception 'Expired cache not refreshed'; end if;
end $$;
insert into hub.projects(rem_project_id,public_name) values('CACHE-TEST','{"th":"ทดสอบ"}');
update hub.projects set slug='cache-test',latitude=13.7563,longitude=100.5018 where rem_project_id='CACHE-TEST';
do $$ declare cached jsonb; actual jsonb; begin
  select summary->'checklist' into cached from hub.project_progress_cache where rem_project_id='CACHE-TEST';
  select hub.snapshot_readiness(hub.draft_payload(id)) into actual from hub.projects where rem_project_id='CACHE-TEST';
  if cached->'required' is distinct from actual->'required' or cached->'percent' is distinct from actual->'percent' then raise exception 'Save cache diverged from publication gate'; end if;
  if (select summary->>'new_from_rem' from hub.project_progress_cache where rem_project_id='CACHE-TEST')<>'false' then raise exception 'Hub creation not reflected'; end if;
end $$;
set local role service_consumer;
do $$ begin
  begin perform * from hub.progress_inputs(); raise exception 'Consumer cache access'; exception when insufficient_privilege then null; end;
end $$;
rollback;
