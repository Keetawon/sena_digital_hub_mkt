-- Ordinary local databases must keep the canonical guard and storage contract.
begin;
do $$ begin
 if current_database()<>'sena_hub_local' or inet_server_addr() is distinct from '127.0.0.1'::inet or inet_server_port()<>55432 then
  raise exception 'H1 local regression is restricted to the existing local TEST database';
 end if;
 if hub.hosted_test_profile() then raise exception 'Local database must not become hosted TEST';end if;
 if exists(select 1 from pg_policies where policyname='hosted_residential_function_owner') then
  raise exception 'Hosted owner policies must not be added to canonical local databases';
 end if;
 if not exists(select 1 from pg_proc where oid='ads.require_issuance()'::regprocedure and exists(select 1 from unnest(proconfig) c where c like 'app.ads_test_issuing=%')) then
  raise exception 'Canonical local 0014 guard was changed';
 end if;
end $$;
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000099',true);
select set_config('app.hub_environment','hosted-test',true);
select hub.residential_environment();
do $$ begin
 begin
  perform hub.register_uploaded_asset('{"storage_bucket":"hub-test-assets","storage_provider":"supabase"}'::jsonb);
  raise exception 'Local caller accepted forged hosted storage';
 exception when insufficient_privilege then null;end;
end $$;
rollback;
