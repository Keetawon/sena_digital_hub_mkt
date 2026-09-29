-- Local uploads and reusable project assets. Bytes are validated/stored by the API;
-- SQL owns registry identity, rights decisions, bindings and access eligibility.
-- Legacy synthetic SVG registry rows intentionally keep nullable upload metadata.
begin;

insert into hub.asset_roles(code) values ('floor_plan'),('brochure');
alter table hub.assets
  add column asset_type text check (asset_type in ('image','document')),
  add column storage_bucket text check (storage_bucket='local-originals'),
  add column storage_path text,
  add column checksum text check (checksum ~ '^[0-9a-f]{64}$'),
  add column file_size bigint check (file_size between 1 and 10485760),
  add column width integer check (width>0),
  add column height integer check (height>0),
  add column language text check (language='th'),
  add column owner_id uuid,
  add column provenance text check (provenance='upload'),
  add column source_system text check (source_system='hub-local'),
  add column rights_notes text,
  add column reviewed_by uuid,
  add column reviewed_at timestamptz,
  add column review_reason text;
create unique index live_asset_checksum on hub.assets(checksum) where deleted_at is null and checksum is not null;

create function hub.register_uploaded_asset(metadata jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actor uuid; a hub.assets; asset_uuid uuid := gen_random_uuid(); extension text; reused boolean;
begin
  actor := hub.require_actor(array['editor','publisher']);
  if jsonb_typeof(metadata) is distinct from 'object' or exists (select 1 from jsonb_object_keys(metadata) k
    where k not in ('original_filename','mime_type','storage_path','checksum','file_size','asset_type','width','height','language')) then
    raise exception 'Only validated upload metadata may be registered' using errcode='42501';
  end if;
  a := jsonb_populate_record(null::hub.assets,metadata);
  extension := case a.mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'image/webp' then 'webp' when 'application/pdf' then 'pdf' end;
  if extension is null or coalesce(btrim(a.original_filename),'')='' or length(a.original_filename)>255
    or a.checksum is null or a.checksum !~ '^[0-9a-f]{64}$'
    or a.storage_path is distinct from a.checksum || '.' || extension
    or a.file_size is null or a.file_size not between 1 and 10485760
    or a.asset_type is distinct from (case when extension='pdf' then 'document' else 'image' end)
    or (extension<>'pdf' and (a.width is null or a.height is null or a.width<=0 or a.height<=0))
    or (extension='pdf' and (a.width is not null or a.height is not null))
    or coalesce(a.language,'th')<>'th' then
    raise exception 'Invalid local upload metadata' using errcode='23514';
  end if;
  -- The upload writer uses this same transaction lock while installing bytes.
  perform pg_advisory_xact_lock(hashtextextended(a.checksum,0));
  insert into hub.assets(id,original_filename,mime_type,public_url,rights_status,asset_type,storage_bucket,
    storage_path,checksum,file_size,width,height,language,owner_id,provenance,source_system)
  values(asset_uuid,a.original_filename,a.mime_type,'/v1/assets/' || asset_uuid::text || '/file','pending',
    a.asset_type,'local-originals',a.storage_path,a.checksum,a.file_size,a.width,a.height,
    coalesce(a.language,'th'),actor,'upload','hub-local')
  on conflict (checksum) where deleted_at is null and checksum is not null do nothing
  returning * into a;
  reused := not found;
  if reused then
    -- A separate statement sees a concurrent uploader's committed winner under
    -- READ COMMITTED. Never UPDATE the winner: its rights and timestamps are intact.
    select * into a from hub.assets where checksum=metadata->>'checksum' and deleted_at is null;
  end if;
  return jsonb_build_object('asset',to_jsonb(a),'reused',reused);
end $$;

create function hub.list_assets() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  return (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id),'[]'::jsonb)
    from hub.assets a where a.deleted_at is null);
end $$;

create function hub.asset_detail(asset_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare result jsonb;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  select to_jsonb(a) into result from hub.assets a where a.id=asset_uuid and a.deleted_at is null;
  if result is null then raise exception 'Asset not found' using errcode='P0002'; end if;
  return result;
end $$;

create function hub.review_asset(asset_uuid uuid, expected_updated_at timestamptz, decision text,
  rights_notes text, effective_from timestamptz, effective_to timestamptz, reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actor uuid; a hub.assets; previous_reason text;
begin
  actor := hub.require_actor(array['publisher']);
  if decision is null or decision not in ('approved','revoked') or coalesce(btrim(reason),'')=''
    or (decision='approved' and coalesce(btrim(rights_notes),'')='')
    or (effective_from is not null and effective_to is not null and effective_to<=effective_from)
    or (decision='approved' and effective_to<=clock_timestamp()) then
    raise exception 'Rights decision, notes and validity must be complete' using errcode='23514';
  end if;
  select * into a from hub.assets where id=asset_uuid and deleted_at is null for update;
  if not found then raise exception 'Asset not found' using errcode='P0002'; end if;
  if expected_updated_at is null or a.updated_at<>expected_updated_at then
    raise exception 'Asset changed; reload before reviewing' using errcode='40001';
  end if;
  previous_reason := current_setting('app.change_reason',true);
  perform set_config('app.change_reason',reason,true);
  update hub.assets set rights_status=decision,rights_notes=review_asset.rights_notes,
    effective_from=review_asset.effective_from,effective_to=review_asset.effective_to,
    reviewed_by=actor,reviewed_at=clock_timestamp(),review_reason=reason where id=asset_uuid;
  perform set_config('app.change_reason',coalesce(previous_reason,''),true);
  return hub.asset_detail(asset_uuid);
end $$;

create function hub.bind_project_asset(project_uuid uuid, asset_uuid uuid, role_name text,
  alternative_text jsonb, expected_project_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare p hub.projects; a hub.assets;
begin
  perform hub.require_actor(array['editor','publisher']);
  if role_name is null or role_name not in ('hero','thumbnail','floor_plan','brochure')
    or jsonb_typeof(alternative_text) is distinct from 'object'
    or jsonb_typeof(alternative_text->'th') is distinct from 'string'
    or coalesce(btrim(alternative_text->>'th'),'')='' then
    raise exception 'Asset role and Thai alternative text are required' using errcode='23514';
  end if;
  select * into p from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if expected_project_updated_at is null or p.updated_at<>expected_project_updated_at then
    raise exception 'Draft changed; reload before saving' using errcode='40001';
  end if;
  select * into a from hub.assets where id=asset_uuid and deleted_at is null;
  if not found then raise exception 'Asset not found' using errcode='P0002'; end if;
  if (role_name='brochure' and a.mime_type<>'application/pdf')
    or (role_name in ('hero','thumbnail') and a.mime_type not like 'image/%')
    or (role_name='floor_plan' and a.mime_type not like 'image/%' and a.mime_type<>'application/pdf') then
    raise exception 'Asset type does not match the selected role' using errcode='23514';
  end if;
  update hub.entity_assets set deleted_at=clock_timestamp()
    where project_id=p.id and asset_role=role_name and is_primary and deleted_at is null;
  insert into hub.entity_assets(project_id,asset_id,asset_role,alt_text) values(p.id,a.id,role_name,alternative_text);
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;

create function hub.unbind_project_asset(project_uuid uuid, binding_uuid uuid,
  expected_project_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare p hub.projects;
begin
  perform hub.require_actor(array['editor','publisher']);
  select * into p from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if expected_project_updated_at is null or p.updated_at<>expected_project_updated_at then
    raise exception 'Draft changed; reload before saving' using errcode='40001';
  end if;
  update hub.entity_assets set deleted_at=clock_timestamp()
    where id=binding_uuid and project_id=p.id and deleted_at is null;
  if not found then raise exception 'Binding not found for project' using errcode='P0002'; end if;
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;

create function hub.asset_file(asset_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare result jsonb;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  select jsonb_build_object('id',a.id,'storage_bucket',a.storage_bucket,'storage_path',a.storage_path,
    'mime_type',a.mime_type,'original_filename',a.original_filename,'checksum',a.checksum,'file_size',a.file_size)
    into result from hub.assets a where a.id=asset_uuid and a.deleted_at is null and a.storage_path is not null;
  if result is null then raise exception 'File not found' using errcode='P0002'; end if;
  return result;
end $$;

create function public_api.asset_file(asset_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare result jsonb;
begin
  perform hub.require_actor(array['service_consumer']);
  select jsonb_build_object('id',a.id,'storage_bucket',a.storage_bucket,'storage_path',a.storage_path,
    'mime_type',a.mime_type,'original_filename',a.original_filename,'checksum',a.checksum,'file_size',a.file_size)
    into result from hub.assets a where a.id=asset_uuid and a.deleted_at is null and a.storage_path is not null
      and exists(select 1 from public_api.projects p, jsonb_array_elements(p.payload->'assets') item
        where item->>'id'=a.id::text);
  if result is null then raise exception 'File not found' using errcode='P0002'; end if;
  return result;
end $$;

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
      'readiness',hub.snapshot_readiness(payload)) from hub.projects p where p.id=project_uuid);
end $$;

revoke execute on function hub.bind_asset(uuid,uuid,text,jsonb) from editor,publisher;
revoke all on function hub.register_uploaded_asset(jsonb),hub.list_assets(),hub.asset_detail(uuid),
  hub.review_asset(uuid,timestamptz,text,text,timestamptz,timestamptz,text),
  hub.bind_project_asset(uuid,uuid,text,jsonb,timestamptz),hub.unbind_project_asset(uuid,uuid,timestamptz),
  hub.asset_file(uuid),public_api.asset_file(uuid) from public,editor,publisher,viewer,service_consumer;
grant execute on function hub.list_assets(),hub.asset_detail(uuid),hub.asset_file(uuid) to editor,publisher,viewer;
grant execute on function hub.register_uploaded_asset(jsonb),hub.bind_project_asset(uuid,uuid,text,jsonb,timestamptz),
  hub.unbind_project_asset(uuid,uuid,timestamptz) to editor,publisher;
grant execute on function hub.review_asset(uuid,timestamptz,text,text,timestamptz,timestamptz,text) to publisher;
grant execute on function public_api.asset_file(uuid) to service_consumer;

commit;
