-- Staged REM selection and explicit human model review. No source synchronization.
-- Admin metadata is added only to project_detail, never to frozen public payloads.
begin;

alter table staging.rem_models add column source_snapshot_at timestamptz not null default now();
alter table hub.model_types
  add column match_method text not null default 'ID' check (match_method = 'ID'),
  add column match_confidence numeric not null default 1 check (match_confidence = 1);

create function hub.list_rem_projects() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'rem_project_id',s.rem_project_id,'project_name_rem',s.project_name_rem,
    'source_updated_at',s.source_updated_at,'source_snapshot_at',s.source_snapshot_at,
    'source_fingerprint',s.source_fingerprint,
    'model_count',(select count(*) from staging.rem_models m where m.rem_project_id=s.rem_project_id),
    'public_project_id',p.public_project_id) order by s.rem_project_id),'[]'::jsonb)
    from staging.rem_projects s left join hub.projects p on p.rem_project_id=s.rem_project_id);
end $$;

create function hub.list_rem_models(project_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare source_id text;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  select rem_project_id into source_id from hub.projects where id=project_uuid and deleted_at is null;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'rem_model_id',s.rem_model_id,'model_name_rem',s.model_name_rem,
    'source_updated_at',s.source_updated_at,'source_snapshot_at',s.source_snapshot_at,
    'source_fingerprint',s.source_fingerprint,'public_model_id',m.public_model_id)
    order by s.rem_model_id),'[]'::jsonb)
    from staging.rem_models s left join hub.model_types m
      on m.project_id=project_uuid and m.rem_model_id=s.rem_model_id
    where s.rem_project_id=source_id);
end $$;

-- Rejection excludes a source model from the next release without hiding the
-- decision from editors. Existing versions are immutable and retain their models;
-- public_api.projects still checks those mappings for current rejection.
create or replace function hub.draft_payload(project_uuid uuid) returns jsonb
language sql stable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'id',p.id,'public_project_id',p.public_project_id,'rem_project_id',p.rem_project_id,
    'public_name',p.public_name,'name_source',p.name_source,'slug',p.slug,'address',p.address,
    'latitude',p.latitude,'longitude',p.longitude,'ad_disclaimer',p.ad_disclaimer,
    'meta_title',p.meta_title,'meta_description',p.meta_description,
    'effective_from',p.effective_from,'effective_to',p.effective_to,
    'source',jsonb_build_object('rem_project_id',s.rem_project_id,'project_name_rem',s.project_name_rem,
      'source_updated_at',s.source_updated_at,'source_snapshot_at',s.source_snapshot_at),
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
  where p.id=project_uuid and p.deleted_at is null
$$;

create or replace function hub.project_detail(public_id text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare project_uuid uuid; payload jsonb; admin_models jsonb;
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
  return payload || jsonb_build_object('models',admin_models) ||
    (select jsonb_build_object('updated_at',p.updated_at,'published_version_id',p.published_version_id,
      'readiness',hub.snapshot_readiness(payload)) from hub.projects p where p.id=project_uuid);
end $$;

create function hub.add_model_from_rem(project_uuid uuid, source_model_id text,
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
  insert into hub.model_types(project_id,rem_project_id,rem_model_id,public_name)
    select p.id,s.rem_project_id,s.rem_model_id,jsonb_build_object('th',s.model_name_rem)
    from staging.rem_models s where s.rem_project_id=p.rem_project_id and s.rem_model_id=source_model_id;
  if not found then raise exception 'REM model not found for project' using errcode='P0002'; end if;
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;

create function hub.update_model(project_uuid uuid, model_public_id text, changes jsonb,
  expected_project_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare p hub.projects; m hub.model_types; edited hub.model_types;
begin
  perform hub.require_actor(array['editor','publisher']);
  if jsonb_typeof(changes) is distinct from 'object' or exists (select 1 from jsonb_object_keys(changes) k
    where k not in ('public_name','bedrooms','bathrooms','usable_area_sqm','parking_spaces')) then
    raise exception 'Only draft model fields may be changed' using errcode='42501';
  end if;
  select * into p from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if expected_project_updated_at is null or p.updated_at<>expected_project_updated_at then
    raise exception 'Draft changed; reload before saving' using errcode='40001';
  end if;
  select * into m from hub.model_types
    where project_id=project_uuid and public_model_id=model_public_id and deleted_at is null for update;
  if not found then raise exception 'Model not found for project' using errcode='P0002'; end if;
  edited := jsonb_populate_record(m,changes);
  update hub.model_types set public_name=edited.public_name,bedrooms=edited.bedrooms,bathrooms=edited.bathrooms,
    usable_area_sqm=edited.usable_area_sqm,parking_spaces=edited.parking_spaces where id=m.id;
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;

create function hub.review_model(project_uuid uuid, model_public_id text,
  expected_project_updated_at timestamptz, decision text, reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare p hub.projects; actor uuid; previous_reason text;
begin
  actor := hub.require_actor(array['editor','publisher']);
  if decision is null or decision not in ('CONFIRMED','REJECTED') or coalesce(btrim(reason),'')='' then
    raise exception 'Human decision and reason are required' using errcode='23514';
  end if;
  select * into p from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if expected_project_updated_at is null or p.updated_at<>expected_project_updated_at then
    raise exception 'Draft changed; reload before saving' using errcode='40001';
  end if;
  previous_reason := current_setting('app.change_reason',true);
  perform set_config('app.change_reason',reason,true);
  update hub.model_types set match_status=decision,
    verified_by=case when decision='CONFIRMED' then actor end,
    verified_at=case when decision='CONFIRMED' then clock_timestamp() end
    where project_id=project_uuid and public_model_id=model_public_id and deleted_at is null;
  if not found then raise exception 'Model not found for project' using errcode='P0002'; end if;
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  perform set_config('app.change_reason',coalesce(previous_reason,''),true);
  return hub.project_detail(p.public_project_id);
end $$;

-- Source records are exposed only by guarded staff functions. Legacy writes have
-- no expected timestamp, so remove their application grants rather than leave a bypass.
revoke usage on schema staging from editor,publisher,viewer;
revoke all on all tables in schema staging from editor,publisher,viewer;
revoke execute on function hub.patch_model(uuid,jsonb),hub.confirm_model(uuid) from editor,publisher;
revoke all on function hub.list_rem_projects(),hub.list_rem_models(uuid),
  hub.add_model_from_rem(uuid,text,timestamptz),hub.update_model(uuid,text,jsonb,timestamptz),
  hub.review_model(uuid,text,timestamptz,text,text) from public,editor,publisher,viewer,service_consumer;
grant execute on function hub.list_rem_projects(),hub.list_rem_models(uuid) to editor,publisher,viewer;
grant execute on function hub.add_model_from_rem(uuid,text,timestamptz),
  hub.update_model(uuid,text,jsonb,timestamptz),hub.review_model(uuid,text,timestamptz,text,text) to editor,publisher;

commit;
