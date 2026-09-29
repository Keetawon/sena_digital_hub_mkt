-- First local SENA residential slice. No live REM, promotions, AI or storage ingestion.
-- Apply as the migration owner. The API login must be NOINHERIT, with only
-- membership in the four NOLOGIN roles below; every request uses SET LOCAL ROLE.
begin;

create schema hub;
create schema public_api;
create schema staging;
create schema audit;
create schema internal;
create schema rag;

do $$
declare role_name text;
begin
  foreach role_name in array array['editor','publisher','viewer','service_consumer'] loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format('create role %I nologin noinherit', role_name);
    end if;
  end loop;
end $$;

revoke all on schema hub, public_api, staging, audit, internal, rag from public;
alter default privileges in schema hub revoke execute on functions from public;
alter default privileges in schema audit revoke execute on functions from public;

create table staging.rem_projects (
  rem_project_id text primary key,
  project_name_rem text not null,
  source_updated_at timestamptz not null,
  source_snapshot_at timestamptz not null default now(),
  source_fingerprint text not null
);
create table staging.rem_models (
  rem_project_id text not null references staging.rem_projects,
  rem_model_id text not null,
  model_name_rem text not null,
  source_updated_at timestamptz not null,
  source_fingerprint text not null,
  primary key (rem_project_id, rem_model_id)
);

create table hub.projects (
  id uuid primary key default gen_random_uuid(),
  public_project_id text not null unique default ('prj_' || replace(gen_random_uuid()::text, '-', '')),
  rem_project_id text not null unique references staging.rem_projects,
  public_name jsonb not null default '{}' check (jsonb_typeof(public_name) = 'object'),
  name_source text not null default 'rem_default' check (name_source in ('rem_default','marketing_override')),
  slug text not null default '',
  address jsonb not null default '{}' check (jsonb_typeof(address) = 'object'),
  latitude numeric check (latitude between -90 and 90),
  longitude numeric check (longitude between -180 and 180),
  ad_disclaimer jsonb not null default '{}' check (jsonb_typeof(ad_disclaimer) = 'object'),
  meta_title jsonb not null default '{}' check (jsonb_typeof(meta_title) = 'object'),
  meta_description jsonb not null default '{}' check (jsonb_typeof(meta_description) = 'object'),
  effective_from timestamptz,
  effective_to timestamptz,
  published_version_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null default nullif(current_setting('app.actor_id', true), '')::uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null default nullif(current_setting('app.actor_id', true), '')::uuid,
  deleted_at timestamptz,
  unique (id, rem_project_id),
  check (effective_to is null or effective_from is null or effective_to > effective_from)
);
create unique index projects_slug_unique on hub.projects(slug) where slug <> '' and deleted_at is null;

create table hub.model_types (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  rem_project_id text not null,
  rem_model_id text not null,
  public_model_id text not null unique default ('mdl_' || replace(gen_random_uuid()::text, '-', '')),
  public_name jsonb not null default '{}' check (jsonb_typeof(public_name) = 'object'),
  bedrooms numeric check (bedrooms >= 0),
  bathrooms numeric check (bathrooms >= 0),
  usable_area_sqm numeric check (usable_area_sqm > 0),
  parking_spaces integer check (parking_spaces >= 0),
  match_status text not null default 'SUGGESTED' check (match_status in ('SUGGESTED','CONFIRMED','REJECTED')),
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null default nullif(current_setting('app.actor_id', true), '')::uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null default nullif(current_setting('app.actor_id', true), '')::uuid,
  deleted_at timestamptz,
  foreign key (project_id, rem_project_id) references hub.projects(id, rem_project_id),
  foreign key (rem_project_id, rem_model_id) references staging.rem_models,
  unique (project_id, rem_model_id),
  check (match_status <> 'CONFIRMED' or (verified_by is not null and verified_at is not null))
);

create table hub.asset_roles (code text primary key);
insert into hub.asset_roles values ('hero'), ('thumbnail');
create table hub.assets (
  id uuid primary key default gen_random_uuid(),
  original_filename text not null,
  mime_type text not null,
  public_url text not null,
  rights_status text not null check (rights_status in ('pending','approved','revoked')),
  effective_from timestamptz,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null default nullif(current_setting('app.actor_id', true), '')::uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null default nullif(current_setting('app.actor_id', true), '')::uuid,
  deleted_at timestamptz,
  check (effective_to is null or effective_from is null or effective_to > effective_from)
);
create table hub.entity_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hub.projects,
  asset_id uuid not null references hub.assets,
  asset_role text not null references hub.asset_roles,
  is_primary boolean not null default true,
  alt_text jsonb not null default '{}' check (jsonb_typeof(alt_text) = 'object'),
  display_order integer not null default 0,
  effective_from timestamptz,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null default nullif(current_setting('app.actor_id', true), '')::uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null default nullif(current_setting('app.actor_id', true), '')::uuid,
  deleted_at timestamptz,
  check (effective_to is null or effective_from is null or effective_to > effective_from)
);
create unique index one_primary_asset on hub.entity_assets(project_id, asset_role)
  where is_primary and deleted_at is null;

create table hub.entity_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hub.projects,
  version_no integer not null check (version_no > 0),
  payload jsonb not null,
  published_at timestamptz not null default clock_timestamp(),
  publisher uuid not null,
  change_reason text not null check (btrim(change_reason) <> ''),
  unique (project_id, version_no),
  unique (project_id, id)
);
alter table hub.projects add constraint published_version_same_project
  foreign key (id, published_version_id) references hub.entity_versions(project_id, id);

create table audit.change_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor uuid,
  database_role text not null,
  table_name text not null,
  operation text not null,
  before_row jsonb,
  after_row jsonb,
  reason text
);

create function hub.require_actor(allowed_roles text[]) returns uuid
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare actor uuid;
begin
  if not (current_setting('role') = any(allowed_roles)) then
    raise exception 'Role is not permitted' using errcode = '42501';
  end if;
  actor := nullif(current_setting('app.actor_id', true), '')::uuid;
  if actor is null then raise exception 'Actor is required' using errcode = '42501'; end if;
  return actor;
end $$;

create function audit.record_change() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into audit.change_log(actor, database_role, table_name, operation, before_row, after_row, reason)
  values (nullif(current_setting('app.actor_id', true), '')::uuid, current_setting('role'),
    tg_table_schema || '.' || tg_table_name, tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    nullif(current_setting('app.change_reason', true), ''));
  return coalesce(new, old);
end $$;
create function hub.touch_record() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := nullif(current_setting('app.actor_id', true), '')::uuid;
  return new;
end $$;
create function hub.reject_version_change() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'Published versions are immutable' using errcode = '23514';
end $$;
create trigger immutable_versions before update or delete on hub.entity_versions
  for each row execute function hub.reject_version_change();

do $$
declare table_name text;
begin
  foreach table_name in array array['projects','model_types','assets','entity_assets'] loop
    execute format('create trigger touch before update on hub.%I for each row execute function hub.touch_record()', table_name);
    execute format('create trigger audit_write after insert or update or delete on hub.%I for each row execute function audit.record_change()', table_name);
    execute format('alter table hub.%I enable row level security', table_name);
    execute format('create policy staff_read on hub.%I for select to editor,publisher,viewer using (true)', table_name);
  end loop;
end $$;
create trigger audit_versions after insert on hub.entity_versions for each row execute function audit.record_change();
alter table hub.entity_versions enable row level security;
create policy staff_read on hub.entity_versions for select to editor,publisher,viewer using (true);

-- One SELECT captures project fields and children in one MVCC snapshot.
create function hub.draft_payload(project_uuid uuid) returns jsonb
language sql stable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'public_project_id', p.public_project_id, 'rem_project_id', p.rem_project_id,
    'public_name', p.public_name, 'name_source', p.name_source, 'slug', p.slug, 'address', p.address,
    'latitude', p.latitude, 'longitude', p.longitude, 'ad_disclaimer', p.ad_disclaimer,
    'meta_title', p.meta_title, 'meta_description', p.meta_description,
    'effective_from', p.effective_from, 'effective_to', p.effective_to,
    'source', jsonb_build_object('rem_project_id', s.rem_project_id, 'project_name_rem', s.project_name_rem,
      'source_updated_at', s.source_updated_at, 'source_snapshot_at', s.source_snapshot_at),
    'models', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'public_model_id', m.public_model_id, 'rem_model_id', m.rem_model_id,
      'public_name', m.public_name, 'bedrooms', m.bedrooms, 'bathrooms', m.bathrooms,
      'usable_area_sqm', m.usable_area_sqm, 'parking_spaces', m.parking_spaces,
      'match_status', m.match_status) order by m.public_model_id)
      from hub.model_types m where m.project_id = p.id and m.deleted_at is null), '[]'),
    'assets', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'binding_id', ea.id, 'asset_role', ea.asset_role, 'is_primary', ea.is_primary,
      'alt_text', ea.alt_text, 'display_order', ea.display_order, 'public_url', a.public_url,
      'original_filename', a.original_filename, 'mime_type', a.mime_type,
      'rights_status', a.rights_status, 'effective_from', ea.effective_from, 'effective_to', ea.effective_to)
      order by ea.display_order, ea.id)
      from hub.entity_assets ea join hub.assets a on a.id = ea.asset_id
      where ea.project_id = p.id and ea.deleted_at is null), '[]'))
  from hub.projects p join staging.rem_projects s using (rem_project_id)
  where p.id = project_uuid and p.deleted_at is null
$$;

create function hub.snapshot_readiness(payload jsonb) returns jsonb
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare missing jsonb := '[]'; item jsonb; field_name text; role_name text;
begin
  foreach field_name in array array['public_name','address','ad_disclaimer'] loop
    if coalesce(btrim(payload #>> array[field_name,'th']), '') = '' then
      missing := missing || jsonb_build_array(jsonb_build_object('field',field_name || '.th','message','กรอกข้อมูลภาษาไทย'));
    end if;
  end loop;
  if coalesce(payload->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    missing := missing || '[{"field":"slug","message":"ระบุ slug เป็นตัวอักษรอังกฤษพิมพ์เล็ก ตัวเลข และขีดกลาง"}]';
  end if;
  foreach field_name in array array['latitude','longitude'] loop
    if payload->>field_name is null then
      missing := missing || jsonb_build_array(jsonb_build_object('field',field_name,'message','ระบุพิกัด'));
    end if;
  end loop;
  if (payload->>'effective_to')::timestamptz <= now() then
    missing := missing || '[{"field":"effective_to","message":"ข้อมูลหมดอายุแล้ว"}]';
  end if;
  if jsonb_array_length(coalesce(payload->'models','[]')) = 0 then
    missing := missing || '[{"field":"models","message":"เลือกแบบจาก REM อย่างน้อยหนึ่งแบบ"}]';
  end if;
  for item in select value from jsonb_array_elements(coalesce(payload->'models','[]')) loop
    if coalesce(item->>'match_status','') <> 'CONFIRMED' or not exists (
      select 1 from hub.model_types m where m.id = (item->>'id')::uuid
        and m.project_id = (payload->>'id')::uuid and m.rem_model_id = item->>'rem_model_id'
        and m.match_status = 'CONFIRMED' and m.deleted_at is null) then
      missing := missing || jsonb_build_array(jsonb_build_object('field','models.' || (item->>'id') || '.match_status','message','ยืนยันการจับคู่แบบกับ REM'));
    end if;
    if coalesce(btrim(item#>>'{public_name,th}'),'') = '' or item->>'bedrooms' is null
      or item->>'bathrooms' is null or coalesce((item->>'usable_area_sqm')::numeric,0) <= 0 then
      missing := missing || jsonb_build_array(jsonb_build_object('field','models.' || (item->>'id') || '.specifications','message','กรอกชื่อไทย ห้องนอน ห้องน้ำ และพื้นที่ใช้สอย'));
    end if;
  end loop;
  foreach role_name in array array['hero','thumbnail'] loop
    if not exists (select 1 from jsonb_array_elements(coalesce(payload->'assets','[]')) a
      where a->>'asset_role' = role_name and (a->>'is_primary')::boolean) then
      missing := missing || jsonb_build_array(jsonb_build_object('field','assets.' || role_name,'message','เลือกรูป ' || role_name));
    end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(payload->'assets','[]')) loop
    if not exists (select 1 from hub.assets a where a.id = (item->>'id')::uuid
      and a.rights_status = 'approved' and a.deleted_at is null
      and (a.effective_from is null or a.effective_from <= now())
      and (a.effective_to is null or a.effective_to > now()))
      or (item->>'effective_from')::timestamptz > now() or (item->>'effective_to')::timestamptz <= now() then
      missing := missing || jsonb_build_array(jsonb_build_object('field','assets.' || (item->>'id') || '.rights','message','รูปยังไม่ได้รับอนุมัติหรือสิทธิ์ใช้งานหมดอายุ'));
    end if;
  end loop;
  return jsonb_build_object('ready', jsonb_array_length(missing)=0, 'missing', missing,
    'percent', greatest(0, 100 - jsonb_array_length(missing)*10));
end $$;

create function hub.project_readiness(project_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare payload jsonb;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  payload := hub.draft_payload(project_uuid);
  if payload is null then raise exception 'Project not found' using errcode='P0002'; end if;
  return hub.snapshot_readiness(payload);
end $$;
create function hub.project_detail(public_id text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare project_uuid uuid; payload jsonb;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  select id into project_uuid from hub.projects where public_project_id=public_id and deleted_at is null;
  if project_uuid is null then raise exception 'Project not found' using errcode='P0002'; end if;
  payload := hub.draft_payload(project_uuid);
  return payload || (select jsonb_build_object('updated_at', p.updated_at,
    'published_version_id', p.published_version_id, 'readiness', hub.snapshot_readiness(payload))
    from hub.projects p where p.id=project_uuid);
end $$;

create function hub.create_project_from_rem(rem_id text) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actor uuid; project_uuid uuid;
begin
  actor := hub.require_actor(array['editor','publisher']);
  if not exists (select 1 from staging.rem_projects where rem_project_id=rem_id) then
    raise exception 'REM project not found' using errcode='P0002';
  end if;
  insert into hub.projects(rem_project_id,public_name)
    select rem_project_id,jsonb_build_object('th',project_name_rem) from staging.rem_projects where rem_project_id=rem_id
    returning id into project_uuid;
  insert into hub.model_types(project_id,rem_project_id,rem_model_id,public_name)
    select project_uuid,rem_project_id,rem_model_id,jsonb_build_object('th',model_name_rem)
    from staging.rem_models where rem_project_id=rem_id;
  return project_uuid;
end $$;

create function hub.patch_project(project_uuid uuid, changes jsonb, expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare p hub.projects; edited hub.projects;
begin
  perform hub.require_actor(array['editor','publisher']);
  if jsonb_typeof(changes) <> 'object' or exists (select 1 from jsonb_object_keys(changes) k
    where k not in ('public_name','slug','address','latitude','longitude','ad_disclaimer','meta_title','meta_description','effective_from','effective_to')) then
    raise exception 'Only draft marketing fields may be changed' using errcode='42501';
  end if;
  select * into p from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if expected_updated_at is null or p.updated_at <> expected_updated_at then
    raise exception 'Draft changed; reload before saving' using errcode='40001';
  end if;
  edited := jsonb_populate_record(p,changes);
  update hub.projects set public_name=edited.public_name, slug=edited.slug, address=edited.address,
    latitude=edited.latitude, longitude=edited.longitude, ad_disclaimer=edited.ad_disclaimer,
    meta_title=edited.meta_title, meta_description=edited.meta_description,
    effective_from=edited.effective_from,effective_to=edited.effective_to,
    name_source=case when changes ? 'public_name' then 'marketing_override' else p.name_source end
    where id=project_uuid;
  return hub.project_detail(p.public_project_id);
end $$;

create function hub.patch_model(model_uuid uuid, changes jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare m hub.model_types; edited hub.model_types;
begin
  perform hub.require_actor(array['editor','publisher']);
  if jsonb_typeof(changes) <> 'object' or exists (select 1 from jsonb_object_keys(changes) k
    where k not in ('public_name','bedrooms','bathrooms','usable_area_sqm','parking_spaces')) then
    raise exception 'Only draft model fields may be changed' using errcode='42501';
  end if;
  select * into m from hub.model_types where id=model_uuid and deleted_at is null;
  if not found then raise exception 'Model not found' using errcode='P0002'; end if;
  perform 1 from hub.projects where id=m.project_id and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  edited := jsonb_populate_record(m,changes);
  update hub.model_types set public_name=edited.public_name,bedrooms=edited.bedrooms,bathrooms=edited.bathrooms,
    usable_area_sqm=edited.usable_area_sqm,parking_spaces=edited.parking_spaces where id=model_uuid;
  update hub.projects set updated_at=clock_timestamp() where id=m.project_id;
end $$;
create function hub.confirm_model(model_uuid uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare project_uuid uuid; actor uuid;
begin
  actor := hub.require_actor(array['editor','publisher']);
  select project_id into project_uuid from hub.model_types where id=model_uuid and deleted_at is null;
  if project_uuid is null then raise exception 'Model not found' using errcode='P0002'; end if;
  perform 1 from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  update hub.model_types set match_status='CONFIRMED',verified_by=actor,verified_at=clock_timestamp() where id=model_uuid;
  update hub.projects set updated_at=clock_timestamp() where id=project_uuid;
end $$;
create function hub.bind_asset(project_uuid uuid, asset_uuid uuid, role_name text, alternative_text jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher']);
  perform 1 from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if not exists (select 1 from hub.assets where id=asset_uuid and deleted_at is null) then
    raise exception 'Asset not found' using errcode='P0002';
  end if;
  update hub.entity_assets set deleted_at=clock_timestamp()
    where project_id=project_uuid and asset_role=role_name and is_primary and deleted_at is null;
  insert into hub.entity_assets(project_id,asset_id,asset_role,alt_text)
    values(project_uuid,asset_uuid,role_name,alternative_text);
  update hub.projects set updated_at=clock_timestamp() where id=project_uuid;
end $$;

create function hub.publish_project(project_uuid uuid, reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actor uuid; payload jsonb; readiness jsonb; version_uuid uuid; version_number integer;
begin
  actor := hub.require_actor(array['publisher']);
  if coalesce(btrim(reason),'')='' then raise exception 'Reason required' using errcode='23514'; end if;
  perform 1 from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  payload := hub.draft_payload(project_uuid);
  readiness := hub.snapshot_readiness(payload);
  if not (readiness->>'ready')::boolean then
    raise exception 'Project is not ready to publish' using errcode='23514', detail=readiness::text;
  end if;
  perform set_config('app.change_reason',reason,true);
  select coalesce(max(version_no),0)+1 into version_number from hub.entity_versions where project_id=project_uuid;
  insert into hub.entity_versions(project_id,version_no,payload,publisher,change_reason)
    values(project_uuid,version_number,payload,actor,reason) returning id into version_uuid;
  update hub.projects set published_version_id=version_uuid where id=project_uuid;
  return version_uuid;
end $$;
create function hub.withdraw_project(project_uuid uuid, reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform hub.require_actor(array['publisher']);
  if coalesce(btrim(reason),'')='' then raise exception 'Reason required' using errcode='23514'; end if;
  perform set_config('app.change_reason',reason,true);
  update hub.projects set published_version_id=null where id=project_uuid and deleted_at is null;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
end $$;
create function hub.rollback_project(project_uuid uuid, version_uuid uuid, reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare payload jsonb; readiness jsonb;
begin
  perform hub.require_actor(array['publisher']);
  if coalesce(btrim(reason),'')='' then raise exception 'Reason required' using errcode='23514'; end if;
  perform 1 from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  select v.payload into payload from hub.entity_versions v where v.id=version_uuid and v.project_id=project_uuid;
  if payload is null then raise exception 'Version not found for project' using errcode='P0002'; end if;
  readiness := hub.snapshot_readiness(payload);
  if not (readiness->>'ready')::boolean then
    raise exception 'Version is no longer eligible' using errcode='23514', detail=readiness::text;
  end if;
  perform set_config('app.change_reason',reason,true);
  update hub.projects set published_version_id=version_uuid where id=project_uuid;
end $$;

-- Editorial fields are read only from the immutable version. Current rights and
-- mapping revocation are safety controls: a stale snapshot cannot re-authorize them.
create view public_api.projects with (security_barrier=true) as
select p.public_project_id, v.payload, v.version_no, v.published_at, v.publisher,
  (v.payload#>>'{source,source_updated_at}')::timestamptz as source_updated_at
from hub.projects p join hub.entity_versions v on v.id=p.published_version_id and v.project_id=p.id
where p.deleted_at is null
  and ((v.payload->>'effective_from')::timestamptz is null or (v.payload->>'effective_from')::timestamptz <= now())
  and ((v.payload->>'effective_to')::timestamptz is null or (v.payload->>'effective_to')::timestamptz > now())
  and not exists (
    select 1 from jsonb_array_elements(v.payload->'models') old_model
    left join hub.model_types m on m.id=(old_model->>'id')::uuid
    where m.id is null or m.project_id<>p.id or m.rem_model_id<>old_model->>'rem_model_id'
      or m.deleted_at is not null or m.match_status<>'CONFIRMED')
  and not exists (
    select 1 from jsonb_array_elements(v.payload->'assets') old_asset
    left join hub.assets a on a.id=(old_asset->>'id')::uuid
    where a.id is null or a.deleted_at is not null or a.rights_status<>'approved'
      or a.effective_from>now() or a.effective_to<=now()
      or (old_asset->>'effective_from')::timestamptz>now()
      or (old_asset->>'effective_to')::timestamptz<=now());

revoke all on all tables in schema hub,staging,audit,internal,rag from public,editor,publisher,viewer,service_consumer;
revoke all on all functions in schema hub,audit from public,editor,publisher,viewer,service_consumer;
grant usage on schema hub,staging to editor,publisher,viewer;
grant select on hub.projects,hub.model_types,hub.assets,hub.entity_assets,hub.asset_roles,hub.entity_versions to editor,publisher,viewer;
grant select on staging.rem_projects,staging.rem_models to editor,publisher,viewer;
grant usage on schema public_api to service_consumer;
grant select on public_api.projects to service_consumer;
grant execute on function hub.project_detail(text),hub.project_readiness(uuid) to editor,publisher,viewer;
grant execute on function hub.create_project_from_rem(text),hub.patch_project(uuid,jsonb,timestamptz),
  hub.patch_model(uuid,jsonb),hub.confirm_model(uuid),hub.bind_asset(uuid,uuid,text,jsonb) to editor,publisher;
grant execute on function hub.publish_project(uuid,text),hub.withdraw_project(uuid,text),hub.rollback_project(uuid,uuid,text) to publisher;

commit;
