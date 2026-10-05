-- Private source evidence; existing content, RLS and publication readiness stay intact.
begin;
alter table staging.rem_projects add column first_seen_at timestamptz;
alter table staging.rem_models add column first_seen_at timestamptz;

create table staging.project_intake_evidence (
  id bigint generated always as identity primary key,
  manifest_sha256 text not null references staging.intake_batches,
  kind text not null check(kind in ('projects','models','gold_projects','gold_models')),
  rem_project_id text not null,
  source_id text not null,
  outcome text not null check(outcome in ('new','baseline','changed','missing','deleted')),
  record jsonb,
  previous_record jsonb,
  recorded_at timestamptz not null default now(),
  unique(manifest_sha256,kind,rem_project_id,source_id)
);
create index project_intake_latest on staging.project_intake_evidence(rem_project_id,kind,source_id,id desc);
create trigger immutable_project_intake_evidence before update or delete on staging.project_intake_evidence
  for each row execute function hub.reject_version_change();
create table staging.project_intake_receipts (
  manifest_sha256 text primary key references staging.intake_batches,
  outcomes jsonb not null,
  imported_at timestamptz not null default now()
);
create trigger immutable_project_intake_receipts before update or delete on staging.project_intake_receipts
  for each row execute function hub.reject_version_change();
revoke all on staging.project_intake_evidence,staging.project_intake_receipts from public,admin,editor,publisher,viewer,service_consumer,online_staff,agency;
revoke all on sequence staging.project_intake_evidence_id_seq from public,admin,editor,publisher,viewer,service_consumer,online_staff,agency;

-- Safe staff metadata only: no Gold prices, unit counts or original payload dumps.
create function hub.project_source_review(rem_id text) returns jsonb
language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare r jsonb; code text; deleted jsonb; flags jsonb; exceptions jsonb; latest_hash text;
begin
  select record into r from staging.project_intake_evidence
    where kind='projects' and rem_project_id=rem_id order by id desc limit 1;
  if r is null then select source_record into r from staging.rem_projects where rem_project_id=rem_id; end if;
  code := case when r ? 'ProjectStatus' then r->>'ProjectStatus' else r->>'project_status' end;
  deleted := case when r ? 'isDeleted' then r->'isDeleted' else coalesce(r->'is_deleted','null'::jsonb) end;
  select manifest_sha256 into latest_hash from staging.project_intake_receipts order by imported_at desc,manifest_sha256 desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('code',e->>'issue_code','keys',e->'keys') order by e->>'exception_key'),'[]') into exceptions
    from staging.intake_batches b cross join lateral jsonb_array_elements(b.datasets->'exceptions') e
    where b.manifest_sha256=latest_hash and coalesce(e#>>'{keys,ProjectID}',e#>>'{keys,project_id}')=rem_id;
  select coalesce(jsonb_agg(distinct outcome) filter(where outcome in ('changed','missing','deleted')),'[]') into flags
    from (select distinct on(kind,source_id) outcome from staging.project_intake_evidence
          where rem_project_id=rem_id order by kind,source_id,id desc) recent;
  return jsonb_build_object('status_raw',code,'status_label',case code when '0' then 'พรีเซล' when '1' then 'กำลังก่อสร้าง' when '2' then 'พร้อมอยู่' when '3' then 'ปิดโครงการ' else 'ไม่ทราบสถานะ' end,
    'is_deleted',deleted,'default_scope',coalesce(deleted='false'::jsonb and code in ('0','1','2'),false),
    'flags',flags,'exceptions',exceptions,
    'brand_binding_allowed',not exists(select 1 from jsonb_array_elements(exceptions) e where e->>'code'='PROJECT_BRAND_MISSING')
      and exists(select 1 from staging.rem_projects p join staging.rem_brands b using(rem_brand_id) where p.rem_project_id=rem_id and b.is_deleted=false),
    'gold_prefill_allowed',not exists(select 1 from jsonb_array_elements(exceptions) e where e->>'code'='GOLD_PROJECT_IDENTITY_OR_GROUP_CONFLICT'),
    'first_import_only',(select count(*)<=1 from staging.project_intake_receipts));
end $$;
revoke all on function hub.project_source_review(text) from public,admin,editor,publisher,viewer,service_consumer;

alter function hub.gold_project_defaults(text) rename to gold_project_defaults_before_project_intake;
create function hub.gold_project_defaults(rem_id text) returns jsonb
language sql stable set search_path=pg_catalog,pg_temp as $$
  select case when (hub.project_source_review(rem_id)->>'gold_prefill_allowed')::boolean
    and not exists(select 1 from staging.dw_projects where rem_project_id=rem_id and
      (source_record->>'project_group_conflict'='true' or source_record->>'project_identity_conflict'='true'))
    then hub.gold_project_defaults_before_project_intake(rem_id) else '{}'::jsonb end
$$;
revoke all on function hub.gold_project_defaults(text) from public,admin,editor,publisher,viewer,service_consumer;

create or replace function hub.list_rem_projects() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'rem_project_id',s.rem_project_id,'project_name_rem',s.project_name_rem,
    'rem_brand_id',s.rem_brand_id,'rem_company_id',s.rem_company_id,'brand_name_rem',b.brand_name_rem,'company_name_rem',c.company_name_rem,
    'source_updated_at',s.source_updated_at,'source_snapshot_at',s.source_snapshot_at,'source_fingerprint',s.source_fingerprint,
    'source_record',s.source_record,'intake_manifest_sha256',s.intake_manifest_sha256,'first_seen_at',s.first_seen_at,
    'mirror_imported_at',(select min(i.imported_at) from staging.intake_batches i where i.manifest_sha256=s.intake_manifest_sha256
      or i.datasets->'projects'->'rows' @> jsonb_build_array(jsonb_build_object('record',jsonb_build_object('project_id',s.rem_project_id)))),
    'source_review',hub.project_source_review(s.rem_project_id),
    'model_count',(select count(*) from staging.rem_models m where m.rem_project_id=s.rem_project_id),
    'public_project_id',p.public_project_id,'gold_source',hub.gold_project_source(s.rem_project_id)) order by s.rem_project_id),'[]')
    from staging.rem_projects s left join hub.projects p using(rem_project_id)
    left join staging.rem_brands b using(rem_brand_id) left join staging.rem_companies c using(rem_company_id));
end $$;

alter function hub.project_detail(text) rename to project_detail_before_project_intake;
revoke all on function hub.project_detail_before_project_intake(text) from public,admin,editor,publisher,viewer,service_consumer;
create function hub.project_detail(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare payload jsonb; rem_id text;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  payload := hub.project_detail_before_project_intake(public_id);
  rem_id := payload#>>'{source,rem_project_id}';
  return jsonb_set(payload,'{source}',payload->'source'||jsonb_build_object('source_review',hub.project_source_review(rem_id),
    'first_seen_at',(select first_seen_at from staging.rem_projects where rem_project_id=rem_id)));
end $$;
revoke all on function hub.project_detail(text) from public,admin,editor,publisher,viewer,service_consumer;
grant execute on function hub.project_detail(text) to admin,editor,publisher,viewer;

-- Keep the existing role/stale-write checks; also guard latest missing-brand evidence.
alter function hub.assign_project_brand(uuid,uuid,timestamptz) rename to assign_project_brand_before_project_intake;
revoke all on function hub.assign_project_brand_before_project_intake(uuid,uuid,timestamptz) from public,admin,editor,publisher,viewer,service_consumer;
create function hub.assign_project_brand(project_uuid uuid,brand_uuid uuid,expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher']);
  if exists(select 1 from hub.projects p where p.id=project_uuid and
    not (hub.project_source_review(p.rem_project_id)->>'brand_binding_allowed')::boolean) then
    raise exception 'ต้นทางไม่มีแบรนด์ที่ใช้งานได้ จึงยังผูกแบรนด์ไม่ได้' using errcode='23514';
  end if;
  return hub.assign_project_brand_before_project_intake(project_uuid,brand_uuid,expected_updated_at);
end $$;
revoke all on function hub.assign_project_brand(uuid,uuid,timestamptz) from public,admin,editor,publisher,viewer,service_consumer;
grant execute on function hub.assign_project_brand(uuid,uuid,timestamptz) to admin,editor,publisher;
commit;
