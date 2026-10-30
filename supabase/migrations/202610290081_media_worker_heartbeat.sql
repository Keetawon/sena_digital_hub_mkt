-- H5i: heartbeat status is separate from audited budget configuration.
begin;
create table hub.media_worker_status (
 singleton boolean primary key default true check(singleton),
 provider_configured boolean not null default false,
 worker_seen_at timestamptz
);
alter table hub.media_worker_status enable row level security;
alter table hub.media_worker_status force row level security;
do $$ begin execute format('create policy media_worker_status_owner on hub.media_worker_status to %I using(true) with check(true)',current_user);end $$;
insert into hub.media_worker_status select singleton,provider_configured,worker_seen_at from hub.media_ai_settings;
create or replace function hub.media_worker_heartbeat(configured boolean) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare previous boolean;begin
 if current_setting('role')<>'hub_media_worker' then raise exception 'Worker role required' using errcode='42501';end if;
 select provider_configured into strict previous from hub.media_worker_status where singleton for update;
 update hub.media_worker_status set provider_configured=configured,worker_seen_at=clock_timestamp() where singleton;
 if previous is distinct from configured then
  insert into audit.change_log(database_role,table_name,operation,before_row,after_row,reason)
  values(current_setting('role'),'hub.media_worker_status','UPDATE',jsonb_build_object('provider_configured',previous),
   jsonb_build_object('provider_configured',configured),'provider_configuration_changed');
 end if;
end $$;
create or replace function hub.media_budget_totals() returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('cap_usd',s.monthly_cap_usd,'spent_usd',coalesce(j.spent,0),
  'reserved_usd',coalesce(j.reserved,0),'remaining_usd',greatest(0,s.monthly_cap_usd-coalesce(j.spent,0)-coalesce(j.reserved,0)),
  'ceiling_usd',ceil((s.max_input_tokens*s.input_usd_per_million+s.max_output_tokens*s.output_usd_per_million))/1000000,
  'provider_configured',w.provider_configured and w.worker_seen_at>clock_timestamp()-interval '90 seconds',
  'model',s.model,'max_input_tokens',s.max_input_tokens,'max_output_tokens',s.max_output_tokens)
 from hub.media_ai_settings s join hub.media_worker_status w using(singleton) left join lateral(
  select sum(case when provider_attempted then charged_usd else 0 end) spent,
   sum(case when not provider_attempted and status='running' then reserved_usd else 0 end) reserved
  from hub.media_jobs where kind='image_suggestion' and budget_month=date_trunc('month',current_timestamp at time zone 'Asia/Bangkok')::date
 ) j on true where s.singleton
$$;
alter table hub.media_ai_settings drop column provider_configured,drop column worker_seen_at;
commit;
