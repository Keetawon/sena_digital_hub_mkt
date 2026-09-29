-- Residential brands are independent of the company recorded on each REM project.
-- Source mirrors remain read-only; projects freeze an explicitly published brand.
begin;

do $$ begin
  if not exists(select 1 from pg_roles where rolname='admin') then create role admin nologin noinherit; end if;
end $$;
create or replace function hub.require_actor(allowed_roles text[]) returns uuid
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare actor uuid; role_name text := current_setting('role');
begin
  if not (role_name=any(allowed_roles) or (role_name='admin' and 'editor'=any(allowed_roles))) then
    raise exception 'Role is not permitted' using errcode='42501';
  end if;
  actor := nullif(current_setting('app.actor_id',true),'')::uuid;
  if actor is null then raise exception 'Actor is required' using errcode='42501'; end if;
  return actor;
end $$;

create table staging.rem_brands (
  rem_brand_id text primary key, brand_name_rem text not null, brand_name_en_rem text,
  is_deleted boolean not null default false, source_updated_at timestamptz not null,
  source_snapshot_at timestamptz not null default now(), source_fingerprint text not null
);
create table staging.rem_companies (
  rem_company_id text primary key, company_name_rem text not null, company_name_en_rem text,
  is_deleted boolean not null default false, source_updated_at timestamptz not null,
  source_snapshot_at timestamptz not null default now(), source_fingerprint text not null
);
-- Preserve unresolved source identifiers. A mirror is evidence, not an approved mapping.
alter table staging.rem_projects add column rem_brand_id text, add column rem_company_id text;
create table hub.brands (
  id uuid primary key default gen_random_uuid(),
  public_brand_id text not null unique default ('brd_' || replace(gen_random_uuid()::text,'-','')),
  rem_brand_id text not null unique references staging.rem_brands,
  public_name jsonb not null default '{}' check (jsonb_typeof(public_name)='object'),
  description jsonb not null default '{}' check (jsonb_typeof(description)='object'),
  slug text not null default '', status text not null default 'active' check (status in ('active','inactive')),
  published_version_id uuid,
  created_at timestamptz not null default now(), created_by uuid not null default nullif(current_setting('app.actor_id',true),'')::uuid,
  updated_at timestamptz not null default clock_timestamp(), updated_by uuid not null default nullif(current_setting('app.actor_id',true),'')::uuid,
  deleted_at timestamptz
);
create unique index brand_slug_unique on hub.brands(slug) where slug<>'' and deleted_at is null;
alter table hub.projects add column brand_id uuid references hub.brands;
create table hub.brand_versions (
  id uuid primary key default gen_random_uuid(), brand_id uuid not null references hub.brands,
  version_no integer not null check (version_no>0), payload jsonb not null,
  published_at timestamptz not null default clock_timestamp(), publisher uuid not null,
  change_reason text not null check (btrim(change_reason)<>''), unique(brand_id,version_no), unique(brand_id,id)
);
alter table hub.brands add constraint published_brand_version_same_brand
  foreign key(id,published_version_id) references hub.brand_versions(brand_id,id);
insert into hub.asset_roles(code) values ('logo_primary'),('logo_white'),('logo_mono'),('favicon');
create table hub.brand_assets (
  id uuid primary key default gen_random_uuid(), brand_id uuid not null references hub.brands,
  asset_id uuid not null references hub.assets, asset_role text not null references hub.asset_roles,
  is_primary boolean not null default true, alt_text jsonb not null default '{}' check(jsonb_typeof(alt_text)='object'),
  display_order integer not null default 0, effective_from timestamptz, effective_to timestamptz,
  created_at timestamptz not null default now(), created_by uuid not null default nullif(current_setting('app.actor_id',true),'')::uuid,
  updated_at timestamptz not null default clock_timestamp(), updated_by uuid not null default nullif(current_setting('app.actor_id',true),'')::uuid,
  deleted_at timestamptz,
  check (effective_to is null or effective_from is null or effective_to>effective_from)
);
create unique index one_primary_brand_asset on hub.brand_assets(brand_id,asset_role) where is_primary and deleted_at is null;
create table hub.brand_requests (
  id uuid primary key default gen_random_uuid(), requested_name text not null check(btrim(requested_name)<>''),
  rem_brand_id text, reason text not null check(btrim(reason)<>''),
  status text not null default 'open' check(status in ('open','resolved','rejected')),
  brand_id uuid references hub.brands, resolution_reason text,
  created_at timestamptz not null default now(), created_by uuid not null default nullif(current_setting('app.actor_id',true),'')::uuid,
  updated_at timestamptz not null default clock_timestamp(), updated_by uuid not null default nullif(current_setting('app.actor_id',true),'')::uuid,
  deleted_at timestamptz,
  check ((status='resolved' and brand_id is not null) or (status<>'resolved' and brand_id is null))
);
do $$ declare table_name text; begin
  foreach table_name in array array['brands','brand_assets','brand_requests'] loop
    execute format('create trigger touch before update on hub.%I for each row execute function hub.touch_record()',table_name);
    execute format('create trigger audit_write after insert or update or delete on hub.%I for each row execute function audit.record_change()',table_name);
    execute format('alter table hub.%I enable row level security',table_name);
    execute format('create policy staff_read on hub.%I for select to admin,editor,publisher,viewer using (true)',table_name);
  end loop;
  foreach table_name in array array['projects','model_types','assets','entity_assets','entity_versions'] loop
    execute format('alter policy staff_read on hub.%I to admin,editor,publisher,viewer',table_name);
  end loop;
end $$;
create trigger immutable_brand_versions before update or delete on hub.brand_versions for each row execute function hub.reject_version_change();
create trigger audit_brand_versions after insert on hub.brand_versions for each row execute function audit.record_change();
alter table hub.brand_versions enable row level security;
create policy staff_read on hub.brand_versions for select to admin,editor,publisher,viewer using(true);

create function hub.brand_draft_payload(brand_uuid uuid) returns jsonb
language sql stable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object('id',b.id,'public_brand_id',b.public_brand_id,'rem_brand_id',b.rem_brand_id,
    'public_name',b.public_name,'description',b.description,'slug',b.slug,'status',b.status,
    'source',to_jsonb(s),'assets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'binding_id',ba.id,'asset_role',ba.asset_role,'is_primary',ba.is_primary,
      'alt_text',ba.alt_text,'display_order',ba.display_order,'public_url',a.public_url,
      'original_filename',a.original_filename,'mime_type',a.mime_type,'rights_status',a.rights_status,
      'effective_from',ba.effective_from,'effective_to',ba.effective_to) order by ba.display_order,ba.id)
      from hub.brand_assets ba join hub.assets a on a.id=ba.asset_id where ba.brand_id=b.id and ba.deleted_at is null),'[]'))
  from hub.brands b join staging.rem_brands s using(rem_brand_id) where b.id=brand_uuid and b.deleted_at is null
$$;
create function hub.brand_snapshot_readiness(payload jsonb) returns jsonb
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare missing jsonb := '[]'; item jsonb;
begin
  if jsonb_typeof(payload#>'{public_name,th}') is distinct from 'string' or coalesce(btrim(payload#>>'{public_name,th}'),'')='' then
    missing := missing || '[{"field":"public_name.th","message":"กรอกชื่อแบรนด์ภาษาไทย"}]';
  end if;
  if jsonb_typeof(payload#>'{description,th}') is distinct from 'string' or coalesce(btrim(payload#>>'{description,th}'),'')='' then
    missing := missing || '[{"field":"description.th","message":"กรอกคำอธิบายแบรนด์ภาษาไทย"}]';
  end if;
  if coalesce(payload->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    missing := missing || '[{"field":"slug","message":"ระบุ slug เป็นตัวอักษรอังกฤษพิมพ์เล็ก ตัวเลข และขีดกลาง"}]';
  end if;
  if payload->>'status' is distinct from 'active' then
    missing := missing || '[{"field":"status","message":"เปิดใช้งานแบรนด์ก่อนเผยแพร่"}]';
  end if;
  if not exists(select 1 from staging.rem_brands s where s.rem_brand_id=payload->>'rem_brand_id' and not s.is_deleted) then
    missing := missing || '[{"field":"source.rem_brand_id","message":"ตรวจสอบแบรนด์ต้นทางที่ยังใช้งานได้"}]';
  end if;
  if not exists(select 1 from jsonb_array_elements(coalesce(payload->'assets','[]')) logo
    where logo->>'asset_role'='logo_primary' and (logo->>'is_primary')::boolean) then
    missing := missing || '[{"field":"assets.logo_primary","message":"เลือกโลโก้หลัก"}]';
  end if;
  for item in select value from jsonb_array_elements(coalesce(payload->'assets','[]')) loop
    if jsonb_typeof(item#>'{alt_text,th}') is distinct from 'string' or coalesce(btrim(item#>>'{alt_text,th}'),'')='' then
      missing := missing || jsonb_build_array(jsonb_build_object('field','assets.'||(item->>'id')||'.alt_text','message','กรอกคำอธิบายภาพภาษาไทย'));
    end if;
    if not exists(select 1 from hub.assets a where a.id=(item->>'id')::uuid and a.deleted_at is null
      and a.mime_type like 'image/%' and a.rights_status='approved'
      and (a.effective_from is null or a.effective_from<=now()) and (a.effective_to is null or a.effective_to>now()))
      or (item->>'effective_from')::timestamptz>now() or (item->>'effective_to')::timestamptz<=now() then
      missing := missing || jsonb_build_array(jsonb_build_object('field','assets.'||(item->>'id')||'.rights','message','โลโก้ยังไม่ได้รับอนุมัติหรือสิทธิ์ใช้งานหมดอายุ'));
    end if;
  end loop;
  return jsonb_build_object('ready',jsonb_array_length(missing)=0,'missing',missing,'percent',greatest(0,100-jsonb_array_length(missing)*10));
end $$;

create view public_api.brands with(security_barrier=true) as
select b.public_brand_id,b.id,v.id as version_id,v.version_no,v.payload,v.published_at,v.publisher,
  (v.payload#>>'{source,source_updated_at}')::timestamptz as source_updated_at
from hub.brands b join hub.brand_versions v on v.id=b.published_version_id and v.brand_id=b.id
join staging.rem_brands s on s.rem_brand_id=b.rem_brand_id
where b.deleted_at is null and not s.is_deleted and v.payload->>'status'='active'
  and not exists(select 1 from jsonb_array_elements(v.payload->'assets') item left join hub.assets a on a.id=(item->>'id')::uuid
    where a.id is null or a.deleted_at is not null or a.rights_status<>'approved'
      or a.effective_from>now() or a.effective_to<=now()
      or (item->>'effective_from')::timestamptz>now() or (item->>'effective_to')::timestamptz<=now());

create function hub.brand_detail(public_id text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare b hub.brands; payload jsonb; admin_assets jsonb; linked_projects jsonb;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  select * into b from hub.brands where public_brand_id=public_id and deleted_at is null;
  if not found then raise exception 'Brand not found' using errcode='P0002'; end if;
  payload := hub.brand_draft_payload(b.id);
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
create function hub.list_brands() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  return (select coalesce(jsonb_agg(hub.brand_detail(public_brand_id) order by public_brand_id),'[]') from hub.brands where deleted_at is null);
end $$;
create function hub.list_rem_brands() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  return (select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('public_brand_id',b.public_brand_id) order by s.rem_brand_id),'[]')
    from staging.rem_brands s left join hub.brands b using(rem_brand_id));
end $$;
create function hub.create_brand_from_rem(source_brand_id text) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare brand_uuid uuid;
begin
  perform hub.require_actor(array['admin']);
  insert into hub.brands(rem_brand_id,public_name)
    select rem_brand_id,jsonb_strip_nulls(jsonb_build_object('th',brand_name_rem,'en',brand_name_en_rem))
    from staging.rem_brands where rem_brand_id=source_brand_id and not is_deleted returning id into brand_uuid;
  if not found then raise exception 'Active REM brand not found' using errcode='P0002'; end if;
  return brand_uuid;
end $$;
create function hub.update_brand_draft(brand_uuid uuid, patch jsonb, expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare b hub.brands; edited hub.brands;
begin
  perform hub.require_actor(array['editor']);
  if jsonb_typeof(patch) is distinct from 'object' or exists(select 1 from jsonb_object_keys(patch) k
    where k not in ('public_name','description','slug','status')) then
    raise exception 'Only brand marketing fields may be changed' using errcode='42501';
  end if;
  select * into b from hub.brands where id=brand_uuid and deleted_at is null for update;
  if not found then raise exception 'Brand not found' using errcode='P0002'; end if;
  if expected_updated_at is null or b.updated_at<>expected_updated_at then raise exception 'Brand changed; reload before saving' using errcode='40001'; end if;
  edited := jsonb_populate_record(b,patch);
  update hub.brands set public_name=edited.public_name,description=edited.description,slug=edited.slug,status=edited.status where id=b.id;
  return hub.brand_detail(b.public_brand_id);
end $$;
create function hub.brand_versions(brand_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  if not exists(select 1 from hub.brands where id=brand_uuid and deleted_at is null) then raise exception 'Brand not found' using errcode='P0002'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('version_id',id,'version_no',version_no,'published_at',published_at,
    'publisher',publisher,'change_reason',change_reason) order by version_no desc),'[]') from hub.brand_versions where brand_id=brand_uuid);
end $$;
create function hub.publish_brand(brand_uuid uuid, reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actor uuid; payload jsonb; readiness jsonb; version_uuid uuid; version_number integer;
begin
  actor := hub.require_actor(array['publisher']);
  if coalesce(btrim(reason),'')='' then raise exception 'Reason required' using errcode='23514'; end if;
  perform 1 from hub.brands where id=brand_uuid and deleted_at is null for update;
  if not found then raise exception 'Brand not found' using errcode='P0002'; end if;
  payload := hub.brand_draft_payload(brand_uuid); readiness := hub.brand_snapshot_readiness(payload);
  if not (readiness->>'ready')::boolean then raise exception 'Brand is not ready to publish' using errcode='23514',detail=readiness::text; end if;
  perform set_config('app.change_reason',reason,true);
  select coalesce(max(version_no),0)+1 into version_number from hub.brand_versions where brand_id=brand_uuid;
  insert into hub.brand_versions(brand_id,version_no,payload,publisher,change_reason) values(brand_uuid,version_number,payload,actor,reason) returning id into version_uuid;
  update hub.brands set published_version_id=version_uuid where id=brand_uuid;
  return version_uuid;
end $$;
create function hub.withdraw_brand(brand_uuid uuid, reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform hub.require_actor(array['publisher']);
  if coalesce(btrim(reason),'')='' then raise exception 'Reason required' using errcode='23514'; end if;
  perform set_config('app.change_reason',reason,true);
  update hub.brands set published_version_id=null where id=brand_uuid and deleted_at is null;
  if not found then raise exception 'Brand not found' using errcode='P0002'; end if;
end $$;
create function hub.rollback_brand(brand_uuid uuid, version_uuid uuid, reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare payload jsonb; readiness jsonb;
begin
  perform hub.require_actor(array['publisher']);
  if coalesce(btrim(reason),'')='' then raise exception 'Reason required' using errcode='23514'; end if;
  perform 1 from hub.brands where id=brand_uuid and deleted_at is null for update;
  if not found then raise exception 'Brand not found' using errcode='P0002'; end if;
  select v.payload into payload from hub.brand_versions v where v.id=version_uuid and v.brand_id=brand_uuid;
  if payload is null then raise exception 'Version not found for brand' using errcode='P0002'; end if;
  readiness := hub.brand_snapshot_readiness(payload);
  if not (readiness->>'ready')::boolean then raise exception 'Brand version is no longer eligible' using errcode='23514',detail=readiness::text; end if;
  perform set_config('app.change_reason',reason,true);
  update hub.brands set published_version_id=version_uuid where id=brand_uuid;
end $$;

create function hub.bind_brand_asset(brand_uuid uuid, asset_uuid uuid, role_name text,
  alt_text jsonb, expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare b hub.brands;
begin
  perform hub.require_actor(array['editor']);
  if role_name is null or role_name not in ('logo_primary','logo_white','logo_mono','favicon')
    or jsonb_typeof(alt_text) is distinct from 'object' or jsonb_typeof(alt_text->'th') is distinct from 'string'
    or coalesce(btrim(alt_text->>'th'),'')='' then raise exception 'Logo role and Thai alternative text required' using errcode='23514'; end if;
  select * into b from hub.brands where id=brand_uuid and deleted_at is null for update;
  if not found then raise exception 'Brand not found' using errcode='P0002'; end if;
  if expected_updated_at is null or b.updated_at<>expected_updated_at then raise exception 'Brand changed; reload before saving' using errcode='40001'; end if;
  if not exists(select 1 from hub.assets where id=asset_uuid and deleted_at is null) then raise exception 'Asset not found' using errcode='P0002'; end if;
  if not exists(select 1 from hub.assets where id=asset_uuid and mime_type like 'image/%') then raise exception 'Logo must be an image' using errcode='23514'; end if;
  update hub.brand_assets set deleted_at=clock_timestamp() where brand_id=b.id and asset_role=role_name and is_primary and deleted_at is null;
  insert into hub.brand_assets(brand_id,asset_id,asset_role,alt_text) values(b.id,asset_uuid,role_name,alt_text);
  update hub.brands set updated_at=clock_timestamp() where id=b.id;
  return hub.brand_detail(b.public_brand_id);
end $$;
create function hub.unbind_brand_asset(brand_uuid uuid, binding_uuid uuid, expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare b hub.brands;
begin
  perform hub.require_actor(array['editor']);
  select * into b from hub.brands where id=brand_uuid and deleted_at is null for update;
  if not found then raise exception 'Brand not found' using errcode='P0002'; end if;
  if expected_updated_at is null or b.updated_at<>expected_updated_at then raise exception 'Brand changed; reload before saving' using errcode='40001'; end if;
  update hub.brand_assets set deleted_at=clock_timestamp() where id=binding_uuid and brand_id=b.id and deleted_at is null;
  if not found then raise exception 'Binding not found for brand' using errcode='P0002'; end if;
  update hub.brands set updated_at=clock_timestamp() where id=b.id;
  return hub.brand_detail(b.public_brand_id);
end $$;
create function hub.assign_project_brand(project_uuid uuid, brand_uuid uuid, expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare p hub.projects; source_brand_id text; b hub.brands;
begin
  perform hub.require_actor(array['editor','publisher']);
  select * into p from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if expected_updated_at is null or p.updated_at<>expected_updated_at then raise exception 'Draft changed; reload before saving' using errcode='40001'; end if;
  select * into b from hub.brands where id=brand_uuid and deleted_at is null;
  if not found then raise exception 'Brand not found' using errcode='P0002'; end if;
  select rem_brand_id into source_brand_id from staging.rem_projects where rem_project_id=p.rem_project_id;
  if source_brand_id is null or source_brand_id<>b.rem_brand_id or not exists(
    select 1 from staging.rem_brands where rem_brand_id=source_brand_id and not is_deleted) then
    raise exception 'Brand must match the active REM project brand' using errcode='23514';
  end if;
  update hub.projects set brand_id=b.id where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;

create function hub.request_brand(requested_name text, source_brand_id text, reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare r hub.brand_requests;
begin
  perform hub.require_actor(array['editor']);
  if coalesce(btrim(requested_name),'')='' or coalesce(btrim(reason),'')=''
    or (source_brand_id is not null and btrim(source_brand_id)='') then raise exception 'Request name and reason required' using errcode='23514'; end if;
  perform set_config('app.change_reason',reason,true);
  insert into hub.brand_requests(requested_name,rem_brand_id,reason) values(requested_name,source_brand_id,reason) returning * into r;
  return to_jsonb(r);
end $$;
create function hub.list_brand_requests() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  return (select coalesce(jsonb_agg(to_jsonb(r) order by created_at desc,id),'[]') from hub.brand_requests r where deleted_at is null);
end $$;
create function hub.resolve_brand_request(request_uuid uuid, brand_uuid uuid, decision text,
  reason text, expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare r hub.brand_requests;
begin
  perform hub.require_actor(array['admin']);
  if decision is null or decision not in ('resolved','rejected') or coalesce(btrim(reason),'')=''
    or (decision='resolved' and brand_uuid is null) or (decision='rejected' and brand_uuid is not null) then
    raise exception 'Resolution and reason required' using errcode='23514';
  end if;
  select * into r from hub.brand_requests where id=request_uuid and deleted_at is null for update;
  if not found then raise exception 'Brand request not found' using errcode='P0002'; end if;
  if expected_updated_at is null or r.updated_at<>expected_updated_at then raise exception 'Request changed; reload before saving' using errcode='40001'; end if;
  if r.status<>'open' then raise exception 'Request already resolved' using errcode='23514'; end if;
  if decision='resolved' and not exists(select 1 from hub.brands b join staging.rem_brands s using(rem_brand_id)
    where b.id=brand_uuid and b.deleted_at is null and not s.is_deleted and (r.rem_brand_id is null or r.rem_brand_id=b.rem_brand_id)) then
    raise exception 'Resolution must reference the requested source brand' using errcode='23514';
  end if;
  perform set_config('app.change_reason',reason,true);
  update hub.brand_requests set status=decision,brand_id=brand_uuid,resolution_reason=resolve_brand_request.reason where id=r.id returning * into r;
  return to_jsonb(r);
end $$;

create or replace function hub.list_rem_projects() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'rem_project_id',s.rem_project_id,'project_name_rem',s.project_name_rem,
    'rem_brand_id',s.rem_brand_id,'rem_company_id',s.rem_company_id,'brand_name_rem',b.brand_name_rem,'company_name_rem',c.company_name_rem,
    'source_updated_at',s.source_updated_at,'source_snapshot_at',s.source_snapshot_at,'source_fingerprint',s.source_fingerprint,
    'model_count',(select count(*) from staging.rem_models m where m.rem_project_id=s.rem_project_id),
    'public_project_id',p.public_project_id) order by s.rem_project_id),'[]')
    from staging.rem_projects s left join hub.projects p using(rem_project_id)
    left join staging.rem_brands b using(rem_brand_id) left join staging.rem_companies c using(rem_company_id));
end $$;

-- Preserve existing project fields while freezing the selected brand version.

create or replace function hub.draft_payload(project_uuid uuid) returns jsonb
language sql stable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'id',p.id,'public_project_id',p.public_project_id,'rem_project_id',p.rem_project_id,
    'brand_id',p.brand_id,'brand_version_id',bv.version_id,
    'brand',bv.payload || jsonb_build_object('brand_version_id',bv.version_id,'version_no',bv.version_no,'published_at',bv.published_at,'publisher',bv.publisher),
    'public_name',p.public_name,'name_source',p.name_source,'slug',p.slug,'address',p.address,
    'latitude',p.latitude,'longitude',p.longitude,'ad_disclaimer',p.ad_disclaimer,
    'meta_title',p.meta_title,'meta_description',p.meta_description,
    'effective_from',p.effective_from,'effective_to',p.effective_to,
    'source',jsonb_build_object('rem_project_id',s.rem_project_id,'project_name_rem',s.project_name_rem,
      'source_updated_at',s.source_updated_at,'source_snapshot_at',s.source_snapshot_at,
      'rem_brand_id',s.rem_brand_id,'rem_company_id',s.rem_company_id,'brand_name_rem',bs.brand_name_rem,'company_name_rem',c.company_name_rem),
    'models',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'public_model_id',m.public_model_id,'rem_model_id',m.rem_model_id,
      'public_name',m.public_name,'bedrooms',m.bedrooms,'bathrooms',m.bathrooms,
      'usable_area_sqm',m.usable_area_sqm,'parking_spaces',m.parking_spaces,
      'match_status',m.match_status) order by m.public_model_id)
      from hub.model_types m where m.project_id=p.id and m.deleted_at is null and m.match_status<>'REJECTED'),'[]'),
    'assets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'binding_id',ea.id,'asset_role',ea.asset_role,'is_primary',ea.is_primary,
      'alt_text',ea.alt_text,'display_order',ea.display_order,'public_url',a.public_url,
      'original_filename',a.original_filename,'mime_type',a.mime_type,
      'rights_status',a.rights_status,'effective_from',ea.effective_from,'effective_to',ea.effective_to)
      order by ea.display_order,ea.id)
      from hub.entity_assets ea join hub.assets a on a.id=ea.asset_id
      where ea.project_id=p.id and ea.deleted_at is null),'[]'))
  from hub.projects p join staging.rem_projects s using (rem_project_id)
  left join staging.rem_companies c on c.rem_company_id=s.rem_company_id
  left join staging.rem_brands bs on bs.rem_brand_id=s.rem_brand_id
  left join public_api.brands bv on bv.id=p.brand_id
  where p.id=project_uuid and p.deleted_at is null
$$;

create or replace function hub.snapshot_readiness(payload jsonb) returns jsonb
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
  if not exists(select 1 from hub.projects p join staging.rem_projects s using(rem_project_id)
    join hub.brands b on b.id=(snapshot_readiness.payload->>'brand_id')::uuid
    join hub.brand_versions v on v.id=(snapshot_readiness.payload->>'brand_version_id')::uuid and v.brand_id=b.id
    join public_api.brands current_brand on current_brand.id=b.id
    where p.id=(snapshot_readiness.payload->>'id')::uuid and b.rem_brand_id=s.rem_brand_id
      and v.payload->>'rem_brand_id'=b.rem_brand_id)
    or not (hub.brand_snapshot_readiness(payload->'brand')->>'ready')::boolean then
    missing := missing || '[{"field":"brand_id","message":"เลือกแบรนด์ที่ตรงกับ REM และเผยแพร่แบรนด์พร้อมโลโก้ที่มีสิทธิ์ใช้งาน"}]';
  end if;
  return jsonb_build_object('ready', jsonb_array_length(missing)=0, 'missing', missing,
    'percent', greatest(0, 100 - jsonb_array_length(missing)*10));
end $$;

create or replace view public_api.projects with (security_barrier=true) as
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
      or (old_asset->>'effective_to')::timestamptz<=now())
  and exists(select 1 from public_api.brands b join hub.brand_versions old_brand on old_brand.brand_id=b.id
    where b.id=(v.payload->>'brand_id')::uuid and old_brand.id=(v.payload->>'brand_version_id')::uuid)
  and exists(select 1 from staging.rem_projects source_project where source_project.rem_project_id=p.rem_project_id
    and source_project.rem_brand_id=v.payload#>>'{brand,rem_brand_id}')
  and not exists(select 1 from jsonb_array_elements(v.payload#>'{brand,assets}') old_logo
    left join hub.assets a on a.id=(old_logo->>'id')::uuid
    where a.id is null or a.deleted_at is not null or a.rights_status<>'approved'
      or a.effective_from>now() or a.effective_to<=now()
      or (old_logo->>'effective_from')::timestamptz>now()
      or (old_logo->>'effective_to')::timestamptz<=now());

create or replace function hub.project_detail(public_id text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare project_uuid uuid; payload jsonb; admin_models jsonb; admin_assets jsonb;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  select id into project_uuid from hub.projects where public_project_id=public_id and deleted_at is null;
  if project_uuid is null then raise exception 'Project not found' using errcode='P0002'; end if;
  payload := hub.draft_payload(project_uuid);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'public_model_id',m.public_model_id,'rem_model_id',m.rem_model_id,
    'public_name',m.public_name,'bedrooms',m.bedrooms,'bathrooms',m.bathrooms,
    'usable_area_sqm',m.usable_area_sqm,'parking_spaces',m.parking_spaces,'match_status',m.match_status,
    'model_name_rem',s.model_name_rem,'source_updated_at',s.source_updated_at,
    'source_snapshot_at',s.source_snapshot_at,'source_fingerprint',s.source_fingerprint,
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

create or replace function public_api.asset_file(asset_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare result jsonb;
begin
  perform hub.require_actor(array['service_consumer']);
  select jsonb_build_object('id',a.id,'storage_bucket',a.storage_bucket,'storage_path',a.storage_path,
    'mime_type',a.mime_type,'original_filename',a.original_filename,'checksum',a.checksum,'file_size',a.file_size)
    into result from hub.assets a where a.id=asset_uuid and a.deleted_at is null and a.storage_path is not null
      and exists(select 1 from (
        select item->>'id' as asset_id from public_api.brands b,jsonb_array_elements(b.payload->'assets') item
        union all
        select item->>'id' from public_api.projects p,jsonb_array_elements(p.payload->'assets') item
        union all
        select item->>'id' from public_api.projects p,jsonb_array_elements(p.payload#>'{brand,assets}') item
      ) eligible where eligible.asset_id=a.id::text);
  if result is null then raise exception 'File not found' using errcode='P0002'; end if;
  return result;
end $$;

revoke all on all functions in schema hub from public;
revoke all on staging.rem_brands,staging.rem_companies,hub.brands,hub.brand_versions,hub.brand_assets,hub.brand_requests
  from public,admin,editor,publisher,viewer,service_consumer;
grant usage on schema hub to admin;
grant select on hub.projects,hub.model_types,hub.assets,hub.entity_assets,hub.asset_roles,hub.entity_versions to admin;
grant select on hub.brands,hub.brand_versions,hub.brand_assets,hub.brand_requests to admin,editor,publisher,viewer;
grant select on public_api.brands to service_consumer;
grant execute on function hub.project_detail(text),hub.project_readiness(uuid),hub.list_rem_projects(),hub.list_rem_models(uuid),
  hub.create_project_from_rem(text),hub.patch_project(uuid,jsonb,timestamptz),hub.add_model_from_rem(uuid,text,timestamptz),
  hub.update_model(uuid,text,jsonb,timestamptz),hub.review_model(uuid,text,timestamptz,text,text),
  hub.register_uploaded_asset(jsonb),hub.list_assets(),hub.asset_detail(uuid),hub.asset_file(uuid),
  hub.bind_project_asset(uuid,uuid,text,jsonb,timestamptz),hub.unbind_project_asset(uuid,uuid,timestamptz) to admin;
grant execute on function hub.brand_detail(text),hub.list_brands(),hub.list_rem_brands(),hub.brand_versions(uuid),hub.list_brand_requests()
  to admin,editor,publisher,viewer;
grant execute on function hub.create_brand_from_rem(text),hub.resolve_brand_request(uuid,uuid,text,text,timestamptz) to admin;
grant execute on function hub.update_brand_draft(uuid,jsonb,timestamptz),hub.bind_brand_asset(uuid,uuid,text,jsonb,timestamptz),
  hub.unbind_brand_asset(uuid,uuid,timestamptz),hub.request_brand(text,text,text) to editor,admin;
grant execute on function hub.assign_project_brand(uuid,uuid,timestamptz) to editor,admin,publisher;
grant execute on function hub.publish_brand(uuid,text),hub.withdraw_brand(uuid,text),hub.rollback_brand(uuid,uuid,text) to publisher;

commit;
