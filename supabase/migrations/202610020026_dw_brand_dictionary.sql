-- Complete reviewed dictionaries retain blank names and unknown deletion evidence.
-- Real data is loaded only by the pinned localhost importer, never this migration.
begin;
alter table staging.rem_brands alter column brand_name_rem drop not null,
  alter column is_deleted drop not null;
comment on column staging.rem_brands.is_deleted is 'Three-state source deletion: false=active flag, true=deleted, null=unknown and ineligible.';

create or replace function hub.list_rem_brands() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  return (select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object(
    'public_brand_id',b.public_brand_id,
    'deletion_status',case when s.is_deleted is false then 'active' when s.is_deleted is true then 'deleted' else 'unknown' end,
    'residential_project_count',coalesce((s.source_record->>'residential_project_count')::int,
      (select count(*) from staging.rem_projects p where p.rem_brand_id=s.rem_brand_id)),
    'non_deleted_residential_project_count',(s.source_record->>'non_deleted_residential_project_count')::int,
    'exception_codes',coalesce((select jsonb_agg(e->>'issue_code' order by e->>'issue_code')
      from staging.intake_batches batch,jsonb_array_elements(coalesce(batch.datasets->'exceptions','[]')) e
      where batch.manifest_sha256=s.intake_manifest_sha256 and e->'brand_ids' ? s.rem_brand_id),'[]')
    ) order by s.rem_brand_id),'[]')
    from staging.rem_brands s left join hub.brands b using(rem_brand_id));
end $$;

create or replace function hub.create_brand_from_rem(source_brand_id text) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare brand_uuid uuid;
begin
  perform hub.require_actor(array['admin']);
  -- Marketing fields start empty; source labels are never public-name authority.
  insert into hub.brands(rem_brand_id)
    select rem_brand_id from staging.rem_brands
    where rem_brand_id=source_brand_id and is_deleted is false returning id into brand_uuid;
  if not found then raise exception 'Active REM brand not found' using errcode='P0002'; end if;
  return brand_uuid;
end $$;
commit;
