-- Disposable DB only; fake hosted provenance is rolled back, never installed.
begin;
set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$ begin
 begin
  perform hub.register_uploaded_asset('{"storage_bucket":"r2-test-content","storage_provider":"r2"}');
  raise exception 'Local caller accepted hosted R2 metadata';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
create schema hub_deployment;
create table hub_deployment.target(project_ref text,environment text,profile text,source text);
insert into hub_deployment.target values('eqlrtevwpyboplljgowo','hosted-test','hosted-test-settings-v1','sena-hub-supabase-test-v2');
set local role hub_app;
do $$ declare metadata jsonb; result jsonb;
begin
 if (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) then raise exception 'Privileged test actor';end if;
 metadata:=jsonb_build_object('original_filename','synthetic-r2.png','mime_type','image/png','checksum',repeat('f',64),
  'storage_path',repeat('f',64)||'.png','file_size',100,'asset_type','image','width',10,'height',10,'language','th',
  'storage_bucket','r2-test-content','storage_provider','r2');
 begin
  perform hub.register_uploaded_asset(metadata||'{"storage_provider":"supabase"}'::jsonb);
  raise exception 'Mismatched storage provider accepted';
 exception when check_violation then null;end;
 result:=hub.register_uploaded_asset(metadata);
 if result->'asset'->>'storage_bucket'<>'r2-test-content' or result->'asset'->>'source_system'<>'hub-hosted-test' then
  raise exception 'R2 metadata was not retained';end if;
 perform set_config('test.r2_asset_id',result->'asset'->>'id',true);
 if hub.asset_file((result->'asset'->>'id')::uuid) is null then raise exception 'Uploader cannot see own unbound file';end if;
 if (hub.register_uploaded_asset(metadata)->>'reused')::boolean is not true then raise exception 'R2 replay is not deduplicated';end if;
end $$;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
do $$ begin
 begin
  perform hub.asset_file(current_setting('test.r2_asset_id')::uuid);
  raise exception 'Unbound upload leaked to another account';
 exception when insufficient_privilege or no_data_found then null;end;
end $$;
reset role;
update hub.user_account set status='SUSPENDED' where id='00000000-0000-0000-0000-000000000001';
set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$ begin
 begin
  perform hub.asset_file(current_setting('test.r2_asset_id')::uuid);
  raise exception 'Suspended uploader kept access';
 exception when insufficient_privilege or no_data_found then null;end;
end $$;
rollback;
