-- Reuse the asset library and publication gates; a model binding keeps its
-- project-scoped identity. Building/floor-specific variants are a later feature.
begin;

insert into hub.asset_roles(code) values ('master_plan'),('model_image'),('structural_plan');
alter table hub.model_types add constraint model_project_identity unique(project_id,id);
alter table hub.entity_assets add column model_id uuid,
  add constraint asset_model_same_project foreign key(project_id,model_id) references hub.model_types(project_id,id),
  add constraint asset_scope_role check (
    (model_id is null and asset_role in ('hero','thumbnail','master_plan','floor_plan','brochure'))
    or (model_id is not null and asset_role in ('model_image','floor_plan','structural_plan')));
drop index hub.one_primary_asset;
create unique index one_primary_asset on hub.entity_assets(project_id,asset_role)
  where model_id is null and is_primary and deleted_at is null;
create unique index one_primary_model_asset on hub.entity_assets(model_id,asset_role)
  where model_id is not null and is_primary and deleted_at is null;

create function hub.project_asset_payload(project_uuid uuid, include_rejected boolean default false) returns jsonb
language sql stable set search_path = pg_catalog, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'binding_id',ea.id,'asset_role',ea.asset_role,'is_primary',ea.is_primary,
    'public_model_id',m.public_model_id,'alt_text',ea.alt_text,'display_order',ea.display_order,
    'public_url',a.public_url,'original_filename',a.original_filename,'mime_type',a.mime_type,
    'rights_status',a.rights_status,'effective_from',ea.effective_from,'effective_to',ea.effective_to)
    order by ea.display_order,ea.id),'[]'::jsonb)
  from hub.entity_assets ea join hub.assets a on a.id=ea.asset_id
  left join hub.model_types m on m.id=ea.model_id and m.project_id=ea.project_id
  where ea.project_id=project_uuid and ea.deleted_at is null
    and (ea.model_id is null or (m.deleted_at is null and (include_rejected or m.match_status<>'REJECTED')))
$$;

create function hub.bind_scoped_asset(project_uuid uuid, model_public_id text, asset_uuid uuid,
  role_name text, alternative_text jsonb, expected_project_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare p hub.projects; a hub.assets; model_uuid uuid; singleton boolean;
begin
  perform hub.require_actor(array['editor','publisher']);
  if role_name is null
    or (model_public_id is null and role_name not in ('hero','thumbnail','master_plan','floor_plan','brochure'))
    or (model_public_id is not null and role_name not in ('model_image','floor_plan','structural_plan'))
    or jsonb_typeof(alternative_text) is distinct from 'object'
    or jsonb_typeof(alternative_text->'th') is distinct from 'string'
    or coalesce(btrim(alternative_text->>'th'),'')='' then
    raise exception 'Asset scope, role and Thai alternative text are required' using errcode='23514';
  end if;
  select * into p from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if expected_project_updated_at is null or p.updated_at<>expected_project_updated_at then
    raise exception 'Draft changed; reload before saving' using errcode='40001';
  end if;
  if model_public_id is not null then
    select id into model_uuid from hub.model_types
      where project_id=p.id and public_model_id=model_public_id and deleted_at is null for update;
    if not found then raise exception 'Model not found for project' using errcode='P0002'; end if;
  end if;
  select * into a from hub.assets where id=asset_uuid and deleted_at is null;
  if not found then raise exception 'Asset not found' using errcode='P0002'; end if;
  if (role_name='brochure' and a.mime_type<>'application/pdf')
    or (role_name in ('hero','thumbnail','model_image') and a.mime_type not like 'image/%')
    or (role_name in ('master_plan','floor_plan','structural_plan') and a.mime_type not like 'image/%' and a.mime_type<>'application/pdf') then
    raise exception 'Asset type does not match the selected role' using errcode='23514';
  end if;
  singleton := model_uuid is null and role_name in ('hero','thumbnail','brochure');
  if singleton then
    update hub.entity_assets set deleted_at=clock_timestamp()
      where project_id=p.id and model_id is null and asset_role=role_name and is_primary and deleted_at is null;
  elsif exists(select 1 from hub.entity_assets where project_id=p.id
      and model_id is not distinct from model_uuid and asset_id=a.id and asset_role=role_name and deleted_at is null) then
    raise exception 'Asset already bound to this scope and role' using errcode='23505';
  end if;
  insert into hub.entity_assets(project_id,model_id,asset_id,asset_role,alt_text,is_primary,display_order)
    select p.id,model_uuid,a.id,role_name,alternative_text,singleton,coalesce(max(display_order),-1)+1
    from hub.entity_assets where project_id=p.id and model_id is not distinct from model_uuid and deleted_at is null;
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;

create or replace function hub.bind_project_asset(project_uuid uuid, asset_uuid uuid, role_name text,
  alternative_text jsonb, expected_project_updated_at timestamptz) returns jsonb
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select hub.bind_scoped_asset(project_uuid,null,asset_uuid,role_name,alternative_text,expected_project_updated_at)
$$;

create function hub.bind_model_asset(project_uuid uuid, model_public_id text, asset_uuid uuid, role_name text,
  alternative_text jsonb, expected_project_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if model_public_id is null then raise exception 'Model is required' using errcode='23514'; end if;
  return hub.bind_scoped_asset(project_uuid,model_public_id,asset_uuid,role_name,alternative_text,expected_project_updated_at);
end $$;

create function hub.unbind_scoped_asset(project_uuid uuid, model_public_id text, binding_uuid uuid,
  expected_project_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare p hub.projects; model_uuid uuid;
begin
  perform hub.require_actor(array['editor','publisher']);
  select * into p from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if expected_project_updated_at is null or p.updated_at<>expected_project_updated_at then
    raise exception 'Draft changed; reload before saving' using errcode='40001';
  end if;
  if model_public_id is not null then
    select id into model_uuid from hub.model_types
      where project_id=p.id and public_model_id=model_public_id and deleted_at is null for update;
    if not found then raise exception 'Model not found for project' using errcode='P0002'; end if;
  end if;
  update hub.entity_assets set deleted_at=clock_timestamp()
    where id=binding_uuid and project_id=p.id and model_id is not distinct from model_uuid and deleted_at is null;
  if not found then raise exception 'Binding not found for this scope' using errcode='P0002'; end if;
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;

create or replace function hub.unbind_project_asset(project_uuid uuid, binding_uuid uuid,
  expected_project_updated_at timestamptz) returns jsonb
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select hub.unbind_scoped_asset(project_uuid,null,binding_uuid,expected_project_updated_at)
$$;

create function hub.unbind_model_asset(project_uuid uuid, model_public_id text, binding_uuid uuid,
  expected_project_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if model_public_id is null then raise exception 'Model is required' using errcode='23514'; end if;
  return hub.unbind_scoped_asset(project_uuid,model_public_id,binding_uuid,expected_project_updated_at);
end $$;

revoke all on function hub.project_asset_payload(uuid,boolean),hub.bind_scoped_asset(uuid,text,uuid,text,jsonb,timestamptz),
  hub.unbind_scoped_asset(uuid,text,uuid,timestamptz),hub.bind_model_asset(uuid,text,uuid,text,jsonb,timestamptz),
  hub.unbind_model_asset(uuid,text,uuid,timestamptz) from public,editor,publisher,viewer,admin,service_consumer;
grant execute on function hub.bind_model_asset(uuid,text,uuid,text,jsonb,timestamptz),
  hub.unbind_model_asset(uuid,text,uuid,timestamptz) to editor,publisher,admin;

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
    'assets',hub.project_asset_payload(p.id))
  from hub.projects p join staging.rem_projects s using (rem_project_id)
  left join staging.rem_companies c on c.rem_company_id=s.rem_company_id
  left join staging.rem_brands bs on bs.rem_brand_id=s.rem_brand_id
  left join public_api.brands bv on bv.id=p.brand_id
  where p.id=project_uuid and p.deleted_at is null
$$;


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
    into admin_assets from jsonb_array_elements(hub.project_asset_payload(project_uuid,true)) item
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
