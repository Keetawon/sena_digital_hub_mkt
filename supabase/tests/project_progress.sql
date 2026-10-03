begin;
insert into staging.intake_batches(manifest_sha256,manifest,datasets,imported_at) values
  (repeat('d',64),'{}','{"projects":{"rows":[{"record":{"project_id":"PROGRESS-0007"}}]}}','2026-09-01T00:00:00Z'),
  (repeat('e',64),'{}','{"projects":{"rows":[{"record":{"project_id":"PROGRESS-0007"}}]}}','2026-10-01T00:00:00Z');
insert into staging.rem_projects(rem_project_id,project_name_rem,source_snapshot_at,source_fingerprint,source_record,intake_manifest_sha256)
values('PROGRESS-0007','Synthetic receipt date test','2026-08-01T00:00:00Z','progress-fixture','{"is_deleted":false}',repeat('e',64));

do $$
declare role_name text;
begin
  foreach role_name in array array['editor','publisher','viewer','admin'] loop
    if not has_function_privilege(role_name,'hub.list_rem_projects()','EXECUTE') then raise exception 'Existing staff ACL lost: %',role_name; end if;
    if has_table_privilege(role_name,'staging.intake_batches','SELECT') then raise exception 'Private intake became readable: %',role_name; end if;
  end loop;
  if has_function_privilege('service_consumer','hub.list_rem_projects()','EXECUTE') then raise exception 'Consumer gained source access'; end if;
end $$;
set local role viewer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true),set_config('app.actor_role','viewer',true);
do $$
declare row jsonb;
begin
  select value into row from jsonb_array_elements(hub.list_rem_projects()) where value->>'rem_project_id'='PROGRESS-0007';
  if (row->>'mirror_imported_at')::timestamptz <> '2026-09-01T00:00:00Z' then raise exception 'Must use earliest immutable receipt, not snapshot/current receipt'; end if;
  if row->'first_seen_at' <> 'null'::jsonb then raise exception 'Unknown first seen must remain unknown'; end if;
  if row->'source_record' <> '{"is_deleted":false}'::jsonb then raise exception 'Source changed during read'; end if;
end $$;
rollback;
