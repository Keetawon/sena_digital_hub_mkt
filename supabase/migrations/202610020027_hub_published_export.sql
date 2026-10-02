-- DW projections of current, consumer-eligible immutable publications only.
begin;
create schema hub_export;
revoke all on schema hub_export from public;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='hub_export_owner') then
    create role hub_export_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;
grant usage on schema hub_export,public_api,hub to hub_export_owner;
grant select(public_brand_id,version_id,payload,published_at) on public_api.brands to hub_export_owner;
grant select(public_project_id,payload,published_at) on public_api.projects to hub_export_owner;
grant select(public_project_id,published_version_id) on hub.projects to hub_export_owner;
create policy published_export_pointer on hub.projects for select to hub_export_owner
  using(published_version_id is not null and deleted_at is null);

create view hub_export.brand_published with(security_barrier=true) as
select b.payload->>'rem_brand_id' as rem_brand_id,b.public_brand_id,
  b.payload#>>'{public_name,th}' as public_name_th,b.payload#>>'{public_name,en}' as public_name_en,
  b.payload->>'slug' as slug,b.version_id as published_version_id,b.published_at,
  array(select distinct logo->>'asset_role'
    from jsonb_array_elements(coalesce(b.payload->'assets','[]')) logo
    where logo->>'asset_role' in ('logo_primary','logo_white','logo_mono','favicon') order by 1) as logo_roles_present
from public_api.brands b;

create view hub_export.project_published with(security_barrier=true) as
select p.payload->>'rem_project_id' as rem_project_id,p.public_project_id,
  p.payload#>>'{public_name,th}' as public_name_th,p.payload#>>'{public_name,en}' as public_name_en,
  p.payload->>'slug' as slug,anchor.published_version_id,p.published_at,
  -- Project publication freezes its chosen brand's logos; later brand edits do not replace them.
  array(select distinct logo->>'asset_role'
    from jsonb_array_elements(coalesce(p.payload#>'{brand,assets}','[]')) logo
    where logo->>'asset_role' in ('logo_primary','logo_white','logo_mono','favicon') order by 1) as logo_roles_present
from public_api.projects p join hub.projects anchor using(public_project_id);

alter view hub_export.brand_published owner to hub_export_owner;
alter view hub_export.project_published owner to hub_export_owner;
grant usage on schema hub_export to ads_export_reader;
grant select on hub_export.brand_published,hub_export.project_published to ads_export_reader;
comment on schema hub_export is 'DW source hub; current eligible frozen publications, extracted together in REPEATABLE READ READ ONLY. No drafts, asset locators/files or rights evidence.';
comment on column hub_export.project_published.logo_roles_present is 'Sorted distinct logo roles in the brand snapshot frozen by this project publication, not current draft/live brand bindings.';
commit;
