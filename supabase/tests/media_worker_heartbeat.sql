begin;
do $$declare before_count bigint; begin
  if (select count(*) from hub.media_worker_status) <> 1 then raise exception 'worker status singleton missing'; end if;
  if exists(select 1 from pg_trigger where tgrelid='hub.media_worker_status'::regclass and not tgisinternal) then
    raise exception 'worker status must have no audit or touch trigger';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid='hub.media_worker_status'::regclass) then
    raise exception 'worker status must FORCE RLS';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='hub' and table_name='media_ai_settings'
    and column_name in ('provider_configured','worker_seen_at')) then raise exception 'heartbeat still shares audited settings'; end if;
  update hub.media_worker_status set provider_configured=false,worker_seen_at=null;
  select count(*) into before_count from audit.change_log;
  perform set_config('role','hub_media_worker',true);
  for i in 1..100 loop perform hub.media_worker_heartbeat(false); end loop;
  perform set_config('role','none',true);
  if (select count(*) from audit.change_log) <> before_count then raise exception 'idle heartbeat audit flood'; end if;
  if (select worker_seen_at is null from hub.media_worker_status) then raise exception 'heartbeat not recorded'; end if;
  perform set_config('role','hub_media_worker',true);
  perform hub.media_worker_heartbeat(true);
  perform set_config('role','none',true);
  if (select count(*) from audit.change_log) <> before_count+1 then raise exception 'configuration flip must audit exactly once'; end if;
  if not exists(select 1 from audit.change_log where table_name='hub.media_worker_status'
    and database_role='hub_media_worker' and reason='provider_configuration_changed'
    and before_row='{"provider_configured":false}'::jsonb and after_row='{"provider_configured":true}'::jsonb) then
    raise exception 'configuration flip audit missing';
  end if;
  perform set_config('role','hub_media_worker',true);
  if not (hub.media_budget_totals()->>'provider_configured')::boolean then raise exception 'budget uses old status'; end if;
  begin
    update hub.media_worker_status set provider_configured=false;
    raise exception 'worker bypassed heartbeat';
  exception when insufficient_privilege then null; end;
  perform set_config('role','none',true);
end $$;
rollback;
