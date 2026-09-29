-- Reviewed local pilot evidence. This is not a recurring REM/DW synchronization.
-- Raw source datetimes have an unverified timezone: keep normalized timestamps
-- null until verified, and retain the source values separately from extraction time.
begin;

create table staging.intake_batches (
  manifest_sha256 text primary key check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  datasets jsonb not null check (jsonb_typeof(datasets) = 'object'),
  imported_at timestamptz not null default now()
);
create trigger immutable_intake_batches before update or delete on staging.intake_batches
  for each row execute function hub.reject_version_change();
revoke all on staging.intake_batches from public,admin,editor,publisher,viewer,service_consumer;

alter table staging.rem_projects
  alter column source_updated_at drop not null,
  add column source_record jsonb check (jsonb_typeof(source_record) = 'object'),
  add column intake_manifest_sha256 text references staging.intake_batches(manifest_sha256);
alter table staging.rem_models
  alter column source_updated_at drop not null,
  add column source_record jsonb check (jsonb_typeof(source_record) = 'object'),
  add column intake_manifest_sha256 text references staging.intake_batches(manifest_sha256);
alter table staging.rem_brands
  alter column source_updated_at drop not null,
  add column source_record jsonb check (jsonb_typeof(source_record) = 'object'),
  add column intake_manifest_sha256 text references staging.intake_batches(manifest_sha256);
alter table staging.rem_companies
  alter column source_updated_at drop not null,
  add column source_record jsonb check (jsonb_typeof(source_record) = 'object'),
  add column intake_manifest_sha256 text references staging.intake_batches(manifest_sha256);

comment on table staging.intake_batches is
  'Immutable reviewed intake evidence; datasets retains all five original parsed dataset documents, including the model-type dictionary. No business approval is implied.';
comment on column staging.rem_projects.source_updated_at is
  'Normalized source modification time only when its timezone is verified; otherwise null. Raw values remain in source_record, extraction time in source_snapshot_at.';
comment on column staging.rem_models.source_updated_at is
  'Normalized source modification time only when its timezone is verified; otherwise null. Raw values remain in source_record, extraction time in source_snapshot_at.';
comment on column staging.rem_brands.source_updated_at is
  'Normalized source modification time only when its timezone is verified; otherwise null. Raw values remain in source_record, extraction time in source_snapshot_at.';
comment on column staging.rem_companies.source_updated_at is
  'Normalized source modification time only when its timezone is verified; otherwise null. Raw values remain in source_record, extraction time in source_snapshot_at.';

create or replace function hub.list_rem_projects() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'rem_project_id',s.rem_project_id,'project_name_rem',s.project_name_rem,
    'rem_brand_id',s.rem_brand_id,'rem_company_id',s.rem_company_id,'brand_name_rem',b.brand_name_rem,'company_name_rem',c.company_name_rem,
    'source_updated_at',s.source_updated_at,'source_snapshot_at',s.source_snapshot_at,'source_fingerprint',s.source_fingerprint,
    'source_record',s.source_record,'intake_manifest_sha256',s.intake_manifest_sha256,
    'model_count',(select count(*) from staging.rem_models m where m.rem_project_id=s.rem_project_id),
    'public_project_id',p.public_project_id) order by s.rem_project_id),'[]')
    from staging.rem_projects s left join hub.projects p using(rem_project_id)
    left join staging.rem_brands b using(rem_brand_id) left join staging.rem_companies c using(rem_company_id));
end $$;

create or replace function hub.list_rem_models(project_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare source_id text;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  select rem_project_id into source_id from hub.projects where id=project_uuid and deleted_at is null;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'rem_model_id',s.rem_model_id,'model_name_rem',s.model_name_rem,
    'source_updated_at',s.source_updated_at,'source_snapshot_at',s.source_snapshot_at,
    'source_fingerprint',s.source_fingerprint,'public_model_id',m.public_model_id,
    'source_record',s.source_record,'intake_manifest_sha256',s.intake_manifest_sha256)
    order by s.rem_model_id),'[]'::jsonb)
    from staging.rem_models s left join hub.model_types m
      on m.project_id=project_uuid and m.rem_model_id=s.rem_model_id
    where s.rem_project_id=source_id);
end $$;

-- Publication snapshots retain their original source shape. Raw intake evidence
-- is appended only by staff detail functions, never by a publishable payload.
create or replace function hub.brand_draft_payload(brand_uuid uuid) returns jsonb
language sql stable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object('id',b.id,'public_brand_id',b.public_brand_id,'rem_brand_id',b.rem_brand_id,
    'public_name',b.public_name,'description',b.description,'slug',b.slug,'status',b.status,
    'source',to_jsonb(s)-'source_record'-'intake_manifest_sha256','assets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'binding_id',ba.id,'asset_role',ba.asset_role,'is_primary',ba.is_primary,
      'alt_text',ba.alt_text,'display_order',ba.display_order,'public_url',a.public_url,
      'original_filename',a.original_filename,'mime_type',a.mime_type,'rights_status',a.rights_status,
      'effective_from',ba.effective_from,'effective_to',ba.effective_to) order by ba.display_order,ba.id)
      from hub.brand_assets ba join hub.assets a on a.id=ba.asset_id where ba.brand_id=b.id and ba.deleted_at is null),'[]'))
  from hub.brands b join staging.rem_brands s using(rem_brand_id) where b.id=brand_uuid and b.deleted_at is null
$$;

create or replace function hub.brand_detail(public_id text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare b hub.brands; payload jsonb; admin_assets jsonb; linked_projects jsonb;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  select * into b from hub.brands where public_brand_id=public_id and deleted_at is null;
  if not found then raise exception 'Brand not found' using errcode='P0002'; end if;
  payload := hub.brand_draft_payload(b.id);
  payload := jsonb_set(payload,'{source}',(payload->'source') || (
    select jsonb_build_object('source_record',s.source_record,'intake_manifest_sha256',s.intake_manifest_sha256)
    from staging.rem_brands s where s.rem_brand_id=b.rem_brand_id));
  select coalesce(jsonb_agg(to_jsonb(a)||item||jsonb_build_object('asset_effective_from',a.effective_from,'asset_effective_to',a.effective_to)
    order by (item->>'display_order')::int,item->>'binding_id'),'[]') into admin_assets
    from jsonb_array_elements(payload->'assets') item join hub.assets a on a.id=(item->>'id')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'public_project_id',p.public_project_id,'public_name',p.public_name,
    'source',jsonb_build_object('rem_project_id',p.rem_project_id,'rem_company_id',s.rem_company_id,'company_name_rem',c.company_name_rem))
    order by p.public_project_id),'[]') into linked_projects from hub.projects p join staging.rem_projects s using(rem_project_id)
    left join staging.rem_companies c using(rem_company_id) where p.brand_id=b.id and p.deleted_at is null;
  return payload || jsonb_build_object('updated_at',b.updated_at,'published_version_id',b.published_version_id,
    'publication_available',exists(select 1 from public_api.brands where id=b.id),
    'readiness',hub.brand_snapshot_readiness(payload),'assets',admin_assets,'projects',linked_projects);
end $$;

create or replace function hub.project_detail(public_id text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare project_uuid uuid; payload jsonb; admin_models jsonb; admin_assets jsonb;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  select id into project_uuid from hub.projects where public_project_id=public_id and deleted_at is null;
  if project_uuid is null then raise exception 'Project not found' using errcode='P0002'; end if;
  payload := hub.draft_payload(project_uuid);
  payload := jsonb_set(payload,'{source}',(payload->'source') || (
    select jsonb_build_object('source_record',s.source_record,'intake_manifest_sha256',s.intake_manifest_sha256)
    from hub.projects p join staging.rem_projects s using(rem_project_id) where p.id=project_uuid));
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'public_model_id',m.public_model_id,'rem_model_id',m.rem_model_id,
    'public_name',m.public_name,'bedrooms',m.bedrooms,'bathrooms',m.bathrooms,
    'usable_area_sqm',m.usable_area_sqm,'parking_spaces',m.parking_spaces,'match_status',m.match_status,
    'model_name_rem',s.model_name_rem,'source_updated_at',s.source_updated_at,
    'source_snapshot_at',s.source_snapshot_at,'source_fingerprint',s.source_fingerprint,
    'source_record',s.source_record,'intake_manifest_sha256',s.intake_manifest_sha256,
    'match_method',m.match_method,'match_confidence',m.match_confidence,
    'verified_by',m.verified_by,'verified_at',m.verified_at,'updated_at',m.updated_at)
    order by m.public_model_id),'[]'::jsonb) into admin_models
  from hub.model_types m
  join staging.rem_models s on s.rem_project_id=m.rem_project_id and s.rem_model_id=m.rem_model_id
  where m.project_id=project_uuid and m.deleted_at is null;
  select coalesce(jsonb_agg(to_jsonb(a) || item || jsonb_build_object(
      'asset_effective_from',a.effective_from,'asset_effective_to',a.effective_to)
      order by (item->>'display_order')::int,item->>'binding_id'),'[]'::jsonb)
    into admin_assets from jsonb_array_elements(payload->'assets') item
    join hub.assets a on a.id=(item->>'id')::uuid;
  return payload || jsonb_build_object('models',admin_models,'assets',admin_assets) ||
    (select jsonb_build_object('updated_at',p.updated_at,'published_version_id',p.published_version_id,
      'publication_available',exists(select 1 from public_api.projects live where live.public_project_id=p.public_project_id),
      'readiness',hub.snapshot_readiness(payload),
      'brand_summary',(select jsonb_build_object('id',b.id,'public_brand_id',b.public_brand_id,'rem_brand_id',b.rem_brand_id,
        'public_name',b.public_name,'status',b.status,'publication_available',exists(select 1 from public_api.brands where id=b.id))
        from hub.brands b where b.id=p.brand_id and b.deleted_at is null)) from hub.projects p where p.id=project_uuid);
end $$;

-- CREATE OR REPLACE preserves existing guarded staff grants. list_rem_brands()
-- already returns mirror fields, and list_brands() delegates to brand_detail().
commit;
