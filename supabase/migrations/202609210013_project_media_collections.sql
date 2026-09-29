-- Project media roles are ordered collections. Keep brand/logo replacement and
-- canonical model behavior unchanged. Existing draft and published rows are not
-- rewritten; all changes go through the revision-locked project media functions.
begin;

create unique index live_project_asset_binding on hub.entity_assets(project_id,asset_role,asset_id)
  where model_id is null and deleted_at is null;

create or replace function hub.bind_scoped_asset(project_uuid uuid, model_public_id text, asset_uuid uuid,
  role_name text, alternative_text jsonb, expected_project_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare p hub.projects; a hub.assets; model_uuid uuid; primary_binding boolean;
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
  if exists(select 1 from hub.entity_assets where project_id=p.id
      and model_id is not distinct from model_uuid and asset_id=a.id and asset_role=role_name and deleted_at is null) then
    -- Replayed project uploads are harmless: keep the existing caption/order and
    -- revision. A stale request was already rejected under the project lock.
    if model_uuid is null then return hub.project_detail(p.public_project_id); end if;
    raise exception 'Asset already bound to this scope and role' using errcode='23505';
  end if;
  -- Keep the legacy first-image marker used by hero/thumbnail readiness. Plans
  -- remain ordered collections; adding an image never replaces another binding.
  primary_binding := model_uuid is null and role_name in ('hero','thumbnail','brochure')
    and not exists(select 1 from hub.entity_assets where project_id=p.id and model_id is null
      and asset_role=role_name and is_primary and deleted_at is null);
  insert into hub.entity_assets(project_id,model_id,asset_id,asset_role,alt_text,is_primary,display_order)
    select p.id,model_uuid,a.id,role_name,alternative_text,primary_binding,coalesce(max(display_order),-1)+1
    from hub.entity_assets where project_id=p.id and model_id is not distinct from model_uuid and deleted_at is null;
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;

create or replace function hub.unbind_scoped_asset(project_uuid uuid, model_public_id text, binding_uuid uuid,
  expected_project_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare p hub.projects; model_uuid uuid; removed_role text; removed_primary boolean;
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
    where id=binding_uuid and project_id=p.id and model_id is not distinct from model_uuid and deleted_at is null
    returning asset_role,is_primary into removed_role,removed_primary;
  if not found then raise exception 'Binding not found for this scope' using errcode='P0002'; end if;
  if model_uuid is null and removed_primary then
    update hub.entity_assets set is_primary=true where id=(
      select id from hub.entity_assets where project_id=p.id and model_id is null
        and asset_role=removed_role and deleted_at is null order by display_order,id limit 1);
  end if;
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;

commit;
