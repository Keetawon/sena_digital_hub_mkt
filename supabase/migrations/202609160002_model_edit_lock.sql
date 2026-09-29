-- Serialize partial model edits with project publication and other child edits.
-- Read the editable row AFTER obtaining the shared project lock: reading it before
-- waiting could restore stale values from a concurrent editor's committed change.
begin;
create or replace function hub.patch_model(model_uuid uuid, changes jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare project_uuid uuid; m hub.model_types; edited hub.model_types;
begin
  perform hub.require_actor(array['editor','publisher']);
  if jsonb_typeof(changes) is distinct from 'object' or exists (select 1 from jsonb_object_keys(changes) k
    where k not in ('public_name','bedrooms','bathrooms','usable_area_sqm','parking_spaces')) then
    raise exception 'Only draft model fields may be changed' using errcode='42501';
  end if;
  select project_id into project_uuid from hub.model_types where id=model_uuid and deleted_at is null;
  if project_uuid is null then raise exception 'Model not found' using errcode='P0002'; end if;
  perform 1 from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  select * into m from hub.model_types where id=model_uuid and deleted_at is null for update;
  if not found then raise exception 'Model not found' using errcode='P0002'; end if;
  edited := jsonb_populate_record(m,changes);
  update hub.model_types set public_name=edited.public_name,bedrooms=edited.bedrooms,bathrooms=edited.bathrooms,
    usable_area_sqm=edited.usable_area_sqm,parking_spaces=edited.parking_spaces where id=model_uuid;
  update hub.projects set updated_at=clock_timestamp() where id=project_uuid;
end $$;
revoke execute on function hub.patch_model(uuid,jsonb) from public;
grant execute on function hub.patch_model(uuid,jsonb) to editor,publisher;
commit;
