-- Staff-only reviewed DW snapshots and conservative, explicit draft prefills.
begin;

create table staging.dw_projects (
  rem_project_id text primary key references staging.rem_projects,
  source_relation text not null default 'gold.dim_project' check (source_relation='gold.dim_project'),
  source_record jsonb not null check (jsonb_typeof(source_record)='object'
    and source_record->>'project_id' is not null and source_record->>'project_id'=rem_project_id),
  source_snapshot_at timestamptz not null,
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  model_groups jsonb not null default '[]' check (jsonb_typeof(model_groups)='array'),
  provenance jsonb not null check (jsonb_typeof(provenance)='object')
);
revoke all on staging.dw_projects from public,admin,editor,publisher,viewer,service_consumer;
create trigger audit_dw_projects after insert or update or delete on staging.dw_projects
  for each row execute function audit.record_change();
comment on table staging.dw_projects is
  'Actual reviewed gold.dim_project snapshots only. Never populate from a reconstructed REM relay or sample presented as Gold. Staff defaults do not imply publication approval.';

alter table hub.projects drop constraint projects_name_source_check;
alter table hub.projects add constraint projects_name_source_check
  check (name_source in ('rem_default','dw_default','unset','marketing_override'));
alter table hub.projects alter column name_source set default 'unset';

create function hub.gold_project_source(rem_id text) returns jsonb
language sql stable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('record',source_record,'source_relation',source_relation,
    'source_snapshot_at',source_snapshot_at,'source_fingerprint',source_fingerprint,'provenance',provenance,
    'model_groups',model_groups,'model_source_relation','gold.dim_project_model')
  from staging.dw_projects where rem_project_id=rem_id
$$;

create function hub.gold_project_defaults(rem_id text) returns jsonb
language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare r jsonb; names jsonb; addresses jsonb := '{}'; defaults jsonb; locale text;
  suffix text; address_text text; lat text; lon text;
begin
  select source_record into r from staging.dw_projects where rem_project_id=rem_id;
  if not found or r->>'project_identity_conflict'='true' then return '{}'; end if;
  names := jsonb_strip_nulls(jsonb_build_object(
    'th',nullif(btrim(r->>'commercial_project_name'),''),
    'en',nullif(btrim(r->>'commercial_project_name_eng'),'')));
  foreach locale in array array['th','en'] loop
    suffix := case when locale='en' then '_eng' else '' end;
    -- DW has one postcode, shared by both languages. Preserve component text;
    -- no inferred administrative prefixes or name-only full-address fallback.
    address_text := concat_ws(' ',nullif(btrim(r->>('moo'||suffix)),''),
      nullif(btrim(r->>('soi'||suffix)),''),nullif(btrim(r->>('road'||suffix)),''),
      nullif(btrim(r->>('subdistrict'||suffix)),''),nullif(btrim(r->>('district'||suffix)),''),
      nullif(btrim(r->>('province'||suffix)),''),nullif(btrim(r->>'postcode'),''));
    if address_text<>'' then addresses := addresses || jsonb_build_object(locale,address_text); end if;
  end loop;
  defaults := jsonb_build_object('public_name',names,'address',addresses);
  lat := btrim(r->>'latitude'); lon := btrim(r->>'longitude');
  if r->>'has_valid_coordinates' is distinct from 'false'
    and lat ~ '^[+-]?[0-9]+([.][0-9]+)?$' and lon ~ '^[+-]?[0-9]+([.][0-9]+)?$' then
    if lat::numeric between -90 and 90 and lon::numeric between -180 and 180 then
      defaults := defaults || jsonb_build_object('latitude',lat::numeric,'longitude',lon::numeric);
    end if;
  end if;
  return defaults;
end $$;

create or replace function hub.create_project_from_rem(rem_id text) returns uuid
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; project_uuid uuid; defaults jsonb;
begin
  actor := hub.require_actor(array['editor','publisher']);
  if not exists(select 1 from staging.rem_projects where rem_project_id=rem_id) then
    raise exception 'REM project not found' using errcode='P0002';
  end if;
  defaults := hub.gold_project_defaults(rem_id);
  insert into hub.projects(rem_project_id,public_name,name_source,address,latitude,longitude)
    values(rem_id,coalesce(defaults->'public_name','{}'),
      case when coalesce(defaults->'public_name','{}')<>'{}'::jsonb then 'dw_default' else 'unset' end,
      coalesce(defaults->'address','{}'),(defaults->>'latitude')::numeric,(defaults->>'longitude')::numeric)
    returning id into project_uuid;
  insert into hub.model_types(project_id,rem_project_id,rem_model_id,public_name)
    select project_uuid,rem_project_id,rem_model_id,jsonb_build_object('th',model_name_rem)
    from staging.rem_models where rem_project_id=rem_id;
  return project_uuid;
end $$;

create function hub.prefill_project_from_dw(project_uuid uuid, expected_updated_at timestamptz, expected_fingerprint text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; source staging.dw_projects; defaults jsonb; changes jsonb := '{}';
  field_name text; locale text; path text[]; current_value jsonb; candidate jsonb;
  merged jsonb; edited boolean; legacy_name boolean; rem_name text;
begin
  perform hub.require_actor(array['editor','publisher']);
  select * into p from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if expected_updated_at is null or p.updated_at<>expected_updated_at then
    raise exception 'Draft changed; reload before prefilling' using errcode='40001';
  end if;
  select * into source from staging.dw_projects where rem_project_id=p.rem_project_id for share;
  if not found then raise exception 'Reviewed gold.dim_project snapshot not available' using errcode='P0002'; end if;
  if expected_fingerprint is null or source.source_fingerprint<>expected_fingerprint then
    raise exception 'DW snapshot changed; review current defaults' using errcode='40001';
  end if;
  defaults := hub.gold_project_defaults(p.rem_project_id);
  select project_name_rem into rem_name from staging.rem_projects where rem_project_id=p.rem_project_id;
  legacy_name := p.name_source='rem_default' and p.public_name=jsonb_build_object('th',rem_name);
  foreach field_name in array array['public_name','address'] loop
    merged := to_jsonb(p)->field_name;
    foreach locale in array array['th','en'] loop
      path := array[field_name,locale];
      current_value := to_jsonb(p)#>path;
      candidate := defaults#>path;
      -- Audit history protects values an editor deliberately cleared, including
      -- edits made before this migration. No extra mutable edit-tracking state.
      select exists(select 1 from audit.change_log a where a.table_name='hub.projects'
        and a.after_row->>'id'=p.id::text and a.before_row is not null
        and a.before_row#>path is distinct from a.after_row#>path) into edited;
      if candidate is not null and candidate<>'null'::jsonb and not edited
        and (coalesce(btrim(current_value#>>'{}'),'')='' or (field_name='public_name' and legacy_name)) then
        merged := merged || jsonb_build_object(locale,candidate);
      end if;
    end loop;
    if merged is distinct from to_jsonb(p)->field_name then changes := changes || jsonb_build_object(field_name,merged); end if;
  end loop;
  if p.latitude is null and p.longitude is null and defaults ? 'latitude' and defaults ? 'longitude' then
    select exists(select 1 from audit.change_log a where a.table_name='hub.projects'
      and a.after_row->>'id'=p.id::text and a.before_row is not null
      and (a.before_row->'latitude' is distinct from a.after_row->'latitude'
        or a.before_row->'longitude' is distinct from a.after_row->'longitude')) into edited;
    if not edited then
      changes := changes || jsonb_build_object('latitude',defaults->'latitude','longitude',defaults->'longitude');
    end if;
  end if;
  if changes<>'{}'::jsonb then
    perform set_config('app.change_reason','Apply reviewed gold.dim_project defaults: '||source.source_fingerprint,true);
    update hub.projects set
      public_name=coalesce(changes->'public_name',public_name),address=coalesce(changes->'address',address),
      latitude=coalesce((changes->>'latitude')::numeric,latitude),
      longitude=coalesce((changes->>'longitude')::numeric,longitude),
      name_source=case when changes ? 'public_name' and name_source<>'marketing_override' then 'dw_default' else name_source end
      where id=p.id;
  end if;
  return hub.project_detail(p.public_project_id);
end $$;

revoke all on function hub.gold_project_source(text),hub.gold_project_defaults(text),
  hub.prefill_project_from_dw(uuid,timestamptz,text) from public,admin,editor,publisher,viewer,service_consumer;
grant execute on function hub.prefill_project_from_dw(uuid,timestamptz,text) to editor,publisher,admin;

-- Staff serializers are replaced below; publishable draft_payload remains unchanged.
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
    'public_project_id',p.public_project_id,'gold_source',hub.gold_project_source(s.rem_project_id)) order by s.rem_project_id),'[]')
    from staging.rem_projects s left join hub.projects p using(rem_project_id)
    left join staging.rem_brands b using(rem_brand_id) left join staging.rem_companies c using(rem_company_id));
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
  return payload || jsonb_build_object('models',admin_models,'assets',admin_assets,
    'gold_source',hub.gold_project_source((select rem_project_id from hub.projects where id=project_uuid))) ||
    (select jsonb_build_object('updated_at',p.updated_at,'published_version_id',p.published_version_id,
      'publication_available',exists(select 1 from public_api.projects live where live.public_project_id=p.public_project_id),
      'readiness',hub.snapshot_readiness(payload),
      'brand_summary',(select jsonb_build_object('id',b.id,'public_brand_id',b.public_brand_id,'rem_brand_id',b.rem_brand_id,
        'public_name',b.public_name,'status',b.status,'publication_available',exists(select 1 from public_api.brands where id=b.id))
        from hub.brands b where b.id=p.brand_id and b.deleted_at is null)) from hub.projects p where p.id=project_uuid);
end $$;

commit;
