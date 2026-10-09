begin;

-- Phase 2: content commands use table-backed permissions even when called
-- through a legacy role. The new role has no unguarded mutation privileges.
create role hub_app nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
do $$ begin
 if exists(select 1 from pg_roles where rolname='hub_runtime') then
  grant hub_app to hub_runtime with admin false,inherit false,set true;
 end if;
end $$;
grant usage on schema hub to hub_app;
grant execute on function hub.can(text,text),hub.can_special(text,text),hub.permission_actor() to hub_app;

create function hub.require_permission(tab text,level text) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.can(tab,level) then raise exception 'Permission denied' using errcode='42501'; end if;
 return hub.permission_actor();
end $$;
create function hub.require_special(tab text,action text) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.can_special(tab,action) then raise exception 'Permission denied' using errcode='42501'; end if;
 return hub.permission_actor();
end $$;
create function hub.can_upload_asset() returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select hub.can('projects','edit') or hub.can('brands','edit') or hub.can('knowledge','edit') or hub.can('knowledge','approve')
$$;
create function hub.require_asset_upload() returns uuid language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.can_upload_asset() then raise exception 'Permission denied' using errcode='42501'; end if;
 return hub.permission_actor();
end $$;

-- Monotonic binding history: even physical removal of a binding cannot restore
-- the uploader exception. Only server code writes this field.
alter table hub.assets add column first_bound_at timestamptz;
-- Begin historical asset binding backfill.
-- Schema maintenance is not a human asset edit. Preserve editor/timestamp fields,
-- keep the audit trigger enabled, and attribute the backfill to no human actor.
-- The ALTER TABLE lock and transaction prevent an application write in between.
alter table hub.assets disable trigger touch;
do $$ declare prior_actor text:=current_setting('app.actor_id',true);
 prior_reason text:=current_setting('app.change_reason',true); begin
perform set_config('app.actor_id','',true);
perform set_config('app.change_reason','Phase 2 migration: historical asset binding backfill',true);
update hub.assets a set first_bound_at=now() where exists(select 1 from hub.entity_assets b where b.asset_id=a.id)
 or exists(select 1 from hub.brand_assets b where b.asset_id=a.id)
 or exists(select 1 from hub.commercial_type_assets b where b.asset_id=a.id)
 or exists(select 1 from hub.knowledge_asset_links b where b.asset_id=a.id)
 or exists(select 1 from hub.entity_versions v where jsonb_path_exists(v.payload,'$.**.assets[*].id ? (@ == $asset)',jsonb_build_object('asset',a.id::text)))
 or exists(select 1 from hub.brand_versions v where jsonb_path_exists(v.payload,'$.assets[*].id ? (@ == $asset)',jsonb_build_object('asset',a.id::text)));
perform set_config('app.actor_id',coalesce(prior_actor,''),true);
perform set_config('app.change_reason',coalesce(prior_reason,''),true);
end $$;
alter table hub.assets enable trigger touch;
-- The rights/cache trigger queues work on this table. Drain it before the RLS
-- ALTER TABLE statements below, then restore its normal deferred behavior.
set constraints hub.refresh_progress_at_commit immediate;
set constraints hub.refresh_progress_at_commit deferred;
-- End historical asset binding backfill.
create function hub.remember_asset_binding() returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $$
begin
 update hub.assets set first_bound_at=clock_timestamp() where id=new.asset_id and first_bound_at is null;
 return new;
end $$;
create trigger remember_asset_binding after insert or update of asset_id on hub.entity_assets
 for each row execute function hub.remember_asset_binding();
create trigger remember_asset_binding after insert or update of asset_id on hub.brand_assets
 for each row execute function hub.remember_asset_binding();
create trigger remember_asset_binding after insert or update of asset_id on hub.commercial_type_assets
 for each row execute function hub.remember_asset_binding();
create trigger remember_asset_binding after insert or update of asset_id on hub.knowledge_asset_links
 for each row execute function hub.remember_asset_binding();

create function hub.can_read_asset(asset_uuid uuid) returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from hub.assets a where a.id=asset_uuid and a.deleted_at is null and (
  (a.provenance='upload' and a.owner_id=hub.permission_actor() and a.first_bound_at is null and hub.can_upload_asset())
  or (hub.can('projects','view') and (
   exists(select 1 from hub.entity_assets b join hub.projects p on p.id=b.project_id
    where b.asset_id=a.id and b.deleted_at is null and p.deleted_at is null
    and (b.model_id is null or exists(select 1 from hub.model_types m where m.id=b.model_id and m.project_id=p.id and m.deleted_at is null)))
   or exists(select 1 from hub.commercial_type_assets b join hub.commercial_types t on t.id=b.commercial_type_id
    join hub.projects p on p.id=b.project_id where b.asset_id=a.id and b.deleted_at is null
    and t.project_id=p.id and t.deleted_at is null and p.deleted_at is null)
   or exists(select 1 from hub.projects p join hub.entity_versions v on v.id=p.published_version_id and v.project_id=p.id
    where p.deleted_at is null and (jsonb_path_exists(v.payload,'$.assets[*].id ? (@ == $asset)',jsonb_build_object('asset',a.id::text))
     or jsonb_path_exists(v.payload,'$.commercial_types[*].assets[*].id ? (@ == $asset)',jsonb_build_object('asset',a.id::text))))))
  or (hub.can('brands','view') and (
   exists(select 1 from hub.brand_assets b join hub.brands t on t.id=b.brand_id
    where b.asset_id=a.id and b.deleted_at is null and t.deleted_at is null)
   or exists(select 1 from hub.brands b join hub.brand_versions v on v.id=b.published_version_id and v.brand_id=b.id
    where b.deleted_at is null and jsonb_path_exists(v.payload,'$.assets[*].id ? (@ == $asset)',jsonb_build_object('asset',a.id::text)))
   or exists(select 1 from hub.projects p join hub.entity_versions v on v.id=p.published_version_id and v.project_id=p.id
    where p.deleted_at is null and jsonb_path_exists(v.payload,'$.brand.assets[*].id ? (@ == $asset)',jsonb_build_object('asset',a.id::text)))))
  or (hub.can('knowledge','view') and exists(select 1 from hub.knowledge_asset_links b where b.asset_id=a.id))
 ))
$$;
create function hub.require_asset_access(asset_uuid uuid) returns void language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.can_read_asset(asset_uuid) then raise exception 'Asset not found' using errcode='P0002'; end if;
end $$;

revoke all on function hub.require_permission(text,text),hub.require_special(text,text),hub.can_upload_asset(),
 hub.require_asset_upload(),hub.remember_asset_binding(),hub.can_read_asset(uuid),hub.require_asset_access(uuid) from public;
grant execute on function hub.can_read_asset(uuid) to hub_app,editor,publisher,viewer,admin;
-- Cleanup must see registration existence even if visibility changes between a
-- COMMIT and its acknowledgement. This boolean never leaves the server.
create function hub.asset_registered_for_cleanup(p_checksum text) returns boolean language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_asset_upload();
 return exists(select 1 from hub.assets where checksum=p_checksum);
end $$;
revoke all on function hub.asset_registered_for_cleanup(text) from public;
grant execute on function hub.asset_registered_for_cleanup(text) to hub_app;

-- The reviewed replacement set includes private renamed implementations. Their
-- ACLs stay private; changing SET ROLE cannot bypass the permission guard.
-- Replace only the old role check, preserving all validation/locking/commands.
do $$
declare rule record; f record; replacement text; definition text; matched integer;
begin
 for rule in select * from (values
  ('projects','view',array['list_rem_projects','list_rem_models','project_detail','project_detail_before_commercial_types',
   'project_detail_before_demo','project_detail_before_facilities','project_detail_before_gold_preview',
   'project_readiness','progress_inputs','progress_rows','source_project_readiness']),
  ('projects','edit',array['create_project_from_rem','patch_project','patch_model','confirm_model','add_model_from_rem',
   'update_model','review_model','prefill_project_from_dw','assign_project_brand','assign_project_brand_before_project_intake',
   'bind_asset','bind_scoped_asset','unbind_scoped_asset','lock_commercial_project','save_project_facility']),
  ('projects','approve',array['publish_project','withdraw_project','rollback_project','rollback_project_before_readiness_levels']),
  ('brands','view',array['list_rem_brands','list_brands','brand_detail_before_completeness','brand_versions','brand_completeness','list_brand_requests']),
  ('brands','edit',array['update_brand_draft','bind_brand_asset','unbind_brand_asset','confirm_brand_source_names','request_brand']),
  ('brands','approve',array['publish_brand','withdraw_brand','rollback_brand']),
  ('brands','brands.manage_catalog',array['create_brand_from_rem','brand_bulk_preview','brand_bulk_create','resolve_brand_request']),
  ('knowledge','approve',array['review_asset'])
 ) as r(tab,level,names) loop
  matched:=0;
  replacement:=format('hub.%I(%L,%L)',case when rule.level like '%.%' then 'require_special' else 'require_permission' end,rule.tab,rule.level);
  for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='hub' and p.proname=any(rule.names) loop
   definition:=pg_get_functiondef(f.oid);
   if definition !~ 'hub.require_actor\(array\[[^]]*\]\)' then raise exception 'Missing reviewed guard: %',f.proname; end if;
   execute regexp_replace(definition,'hub.require_actor\(array\[[^]]*\]\)',replacement,'g');
   matched:=matched+1;
  end loop;
  if matched<>cardinality(rule.names) then raise exception 'Incomplete content guard set: %/%',rule.tab,rule.level; end if;
 end loop;
end $$;

-- Wrappers which validated before delegating must also deny before validation.
do $$ declare name text; f regprocedure; definition text; begin
 foreach name in array array['bind_model_asset','unbind_model_asset','create_commercial_types',
  'update_commercial_type','bind_commercial_asset','unbind_commercial_asset'] loop
  select p.oid into f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and p.proname=name;
  definition:=pg_get_functiondef(f);
  execute regexp_replace(definition,'\mbegin\M','begin perform hub.require_permission(''projects'',''edit'');','i');
 end loop;
end $$;

-- Asset reads are filtered inside the SD function as well as by caller RLS.
create or replace function hub.list_assets() returns jsonb language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id),'[]'::jsonb)
 from hub.assets a where hub.can_read_asset(a.id)
$$;
do $$ declare name text; f regprocedure; definition text; begin
 foreach name in array array['asset_detail','asset_file'] loop
  f:=format('hub.%I(uuid)',name)::regprocedure;
  definition:=pg_get_functiondef(f);
  execute regexp_replace(definition,'perform hub.require_actor\(array\[[^]]*\]\);','perform hub.require_asset_access(asset_uuid);');
 end loop;
 definition:=pg_get_functiondef('hub.register_uploaded_asset(jsonb)'::regprocedure);
 definition:=replace(definition,'hub.require_actor(array[''editor'',''publisher''])','hub.require_asset_upload()');
 definition:=replace(definition,'return jsonb_build_object(''asset'',to_jsonb(a),''reused'',reused);',
  'perform hub.require_asset_access(a.id); return jsonb_build_object(''asset'',to_jsonb(a),''reused'',reused);');
 execute definition;
 -- Guard before a binding exists: otherwise the attacker could create the very
 -- row which makes an inaccessible asset readable.
 foreach name in array array['bind_asset','bind_scoped_asset','bind_brand_asset','bind_commercial_asset','review_asset'] loop
  select p.oid into f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and p.proname=name;
  definition:=pg_get_functiondef(f);
  execute regexp_replace(definition,'\mbegin\M', 'begin perform hub.require_asset_access('||
   case when name='bind_commercial_asset' then '(metadata->>''asset_id'')::uuid' else 'asset_uuid' end||');','i');
 end loop;
end $$;

-- Existing public feeds/exports run as their technical owner and retain the
-- public payload. Application SELECT is forced through the capability policy.
do $$ declare rule record; tablename text; begin
 for rule in select * from (values
  ('projects',array['projects','model_types','entity_assets','entity_versions','commercial_types','commercial_type_sources',
   'commercial_type_assets','facility_taxonomy','project_facilities','project_progress_cache','project_progress_dirty']),
  ('brands',array['brands','brand_versions','brand_assets','brand_requests','brand_bulk_runs'])
 ) as r(tab,tables) loop
  foreach tablename in array rule.tables loop
   execute format('alter table hub.%I enable row level security',tablename);
   execute format('alter table hub.%I force row level security',tablename);
   execute format('create policy content_owner on hub.%I to %I using(true) with check(true)',tablename,current_user);
   execute format('create policy content_app_read on hub.%I for select to hub_app using(hub.can(%L,''view''))',tablename,rule.tab);
   execute format('create policy content_permission on hub.%I as restrictive to hub_app,editor,publisher,viewer,admin,online_staff,agency using(hub.can(%L,''view'')) with check(false)',tablename,rule.tab);
  end loop;
 end loop;
 alter table hub.assets force row level security;
 execute format('create policy content_owner on hub.assets to %I using(true) with check(true)',current_user);
 create policy content_app_read on hub.assets for select to hub_app using(hub.can_read_asset(id));
 create policy content_permission on hub.assets as restrictive to hub_app,editor,publisher,viewer,admin,online_staff,agency
  using(hub.can_read_asset(id)) with check(false);
end $$;
grant select on hub.projects,hub.model_types,hub.entity_assets,hub.commercial_types,hub.commercial_type_sources,
 hub.commercial_type_assets,hub.facility_taxonomy,hub.project_facilities,hub.brands,hub.brand_versions,hub.brand_assets,
 hub.brand_requests,hub.assets,hub.asset_roles to hub_app;

-- Only current public brand payloads may escape through the consumer API.
-- Internal project projections without Brands V contain a name, not brand data.
create function hub.asset_permission_projection(payload jsonb) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare result jsonb; key text; value jsonb;
begin
 if jsonb_typeof(payload)='array' then
  select coalesce(jsonb_agg(hub.asset_permission_projection(item)),'[]') into result from jsonb_array_elements(payload) item;
  return result;
 end if;
 if jsonb_typeof(payload) is distinct from 'object' then return payload; end if;
 result:='{}';
 for key,value in select * from jsonb_each(payload) loop
  if key='assets' and jsonb_typeof(value)='array' then
   select coalesce(jsonb_agg(item),'[]') into value from jsonb_array_elements(value) item
    where hub.can_read_asset((item->>'id')::uuid);
  elsif key in ('brand','commercial_types','models') then value:=hub.asset_permission_projection(value);
  end if;
  result:=result||jsonb_build_object(key,value);
 end loop;
 return result;
end $$;
revoke all on function hub.asset_permission_projection(jsonb) from public;
-- Raw historical rows are selectable only if every embedded asset is visible.
-- Projected RPCs preserve history while dropping hidden assets from the payload.
create function hub.snapshot_assets_visible(payload jsonb) returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$ select hub.asset_permission_projection(payload)=payload $$;
revoke all on function hub.snapshot_assets_visible(jsonb) from public;
grant execute on function hub.snapshot_assets_visible(jsonb) to hub_app,editor,publisher,viewer,admin;
create policy content_snapshot_assets on hub.entity_versions as restrictive to hub_app,editor,publisher,viewer,admin
 using(hub.snapshot_assets_visible(payload)) with check(false);
create policy content_snapshot_assets on hub.brand_versions as restrictive to hub_app,editor,publisher,viewer,admin
 using(hub.snapshot_assets_visible(payload)) with check(false);
create function hub.project_permission_projection(payload jsonb) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 payload:=hub.asset_permission_projection(payload);
 if payload is null or jsonb_typeof(payload)<>'object' or hub.can('brands','view') then return payload; end if;
 return (payload-'brand'-'brand_summary'-'brand_version_id') || jsonb_build_object(
   'brand',case when payload->'brand' is null then null else jsonb_build_object('public_name',payload#>'{brand,public_name}') end,
   'brand_summary',case when payload->'brand_summary' is null then null else jsonb_build_object('public_name',payload#>'{brand_summary,public_name}') end);
end
$$;
revoke all on function hub.project_permission_projection(jsonb) from public;
create function hub.project_versions(project_uuid uuid) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('projects','view');
 return (select coalesce(jsonb_agg(row order by (row->>'version_no')::integer desc),'[]') from
  (select jsonb_build_object('version_id',id,'version_no',version_no,'payload',hub.project_permission_projection(payload),
   'published_at',published_at,'publisher',publisher,'change_reason',change_reason) row
   from hub.entity_versions where project_id=project_uuid order by version_no desc limit 100) versions);
end $$;
revoke all on function hub.project_versions(uuid) from public;
grant execute on function hub.project_versions(uuid) to hub_app,editor,publisher,viewer,admin;
-- Raw snapshots contain cross-tab data. Authorized callers use the projection.
create policy content_snapshot_brands on hub.entity_versions as restrictive
 to hub_app,editor,publisher,viewer,admin using(hub.can('brands','view')) with check(false);
create or replace function hub.project_detail(public_id text) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare payload jsonb; rem_id text;
begin
 perform hub.require_permission('projects','view');
 payload:=hub.project_detail_before_project_intake(public_id);
 rem_id:=payload#>>'{source,rem_project_id}';
 return hub.project_permission_projection(jsonb_set(payload,'{source}',payload->'source'||jsonb_build_object(
  'source_review',hub.project_source_review(rem_id),
  'first_seen_at',(select first_seen_at from staging.rem_projects where rem_project_id=rem_id))));
end $$;

create or replace function hub.brand_detail(public_id text) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
 perform hub.require_permission('brands','view');
 result:=hub.asset_permission_projection(hub.brand_detail_before_completeness(public_id));
 if not hub.can('projects','view') then
  result:=jsonb_set(result,'{projects}',(select coalesce(jsonb_agg(jsonb_build_object(
   'public_project_id',p->'public_project_id','public_name',p->'public_name')),'[]')
   from jsonb_array_elements(result->'projects') p));
 end if;
 return result||(select jsonb_build_object('unconfirmed_source_names',b.unconfirmed_source_names,
  'source_name_provenance',b.source_name_provenance,'updated_by',b.updated_by) from hub.brands b where b.public_brand_id=public_id);
end $$;

create or replace function hub.brand_versions(brand_uuid uuid) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('brands','view');
 if not exists(select 1 from hub.brands where id=brand_uuid and deleted_at is null) then
  raise exception 'Brand not found' using errcode='P0002';
 end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('version_id',id,'version_no',version_no,'published_at',published_at,
  'publisher',publisher,'change_reason',change_reason,'payload',hub.asset_permission_projection(payload)) order by version_no desc),'[]')
  from hub.brand_versions where brand_id=brand_uuid);
end $$;

create function hub.progress_permission_projection(c hub.project_progress_cache) returns hub.project_progress_cache
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if jsonb_typeof(c.record)='object' then
  c.record:=jsonb_set(c.record,'{detail}',hub.project_permission_projection(c.record->'detail'));
  c.record:=jsonb_set(c.record,'{live_payload}',coalesce(hub.project_permission_projection(c.record->'live_payload'),'null'));
  if jsonb_typeof(c.record->'live_assets')='array' then
   c.record:=jsonb_set(c.record,'{live_assets}',(select coalesce(jsonb_agg(a),'[]')
    from jsonb_array_elements(c.record->'live_assets') a where hub.can_read_asset((a->>'id')::uuid)));
  end if;
 end if;
 if not hub.can('brands','view') then
  c.brand_logo:=null;
  c.summary:=c.summary-'brand_logo';
 end if;
 if not hub.can('knowledge','view') then
  c.knowledge:='{}';
  c.summary:=c.summary-'knowledge';
 end if;
 if c.thumbnail is not null and not hub.can_read_asset((c.thumbnail->>'id')::uuid) then
  c.thumbnail:=null; c.summary:=c.summary-'thumbnail';
 end if;
 return c;
end $$;
revoke all on function hub.progress_permission_projection(hub.project_progress_cache) from public;
create or replace function hub.progress_inputs() returns setof hub.project_progress_cache
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('projects','view');
 perform hub.refresh_project_progress(array(select rem_project_id from hub.project_progress_dirty union
  select rem_project_id from hub.project_progress_cache where valid_until<=now()));
 return query select (hub.progress_permission_projection(c)).* from hub.project_progress_cache c order by rem_project_id;
end $$;
create or replace function hub.progress_rows(detail_id text default null) returns table(summary jsonb)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('projects','view');
 return query select (case when detail_id is not null then c.summary else
  jsonb_set(c.summary,'{checklist}',(c.summary->'checklist')-'required'-'recommended') end)
  || jsonb_build_object('age_days',case when c.summary->>'first_seen_at' is not null then
   greatest(0,floor(extract(epoch from now()-(c.summary->>'first_seen_at')::timestamptz)/86400)) end)
 from hub.progress_inputs() c where detail_id is null or c.rem_project_id=detail_id
 order by (c.summary#>>'{checklist,ready}')::boolean desc,(c.summary#>>'{checklist,percent}')::integer desc,c.rem_project_id;
end $$;

-- Explicit callable surface for the base role; renamed/private implementations
-- are never granted, even though their bodies also contain checks.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='hub' and p.proname=any(array[
  'list_rem_projects','list_rem_models','project_detail','project_readiness','progress_inputs','progress_rows','source_project_readiness',
  'create_project_from_rem','patch_project','add_model_from_rem','update_model','review_model','prefill_project_from_dw',
  'assign_project_brand','bind_project_asset','unbind_project_asset','bind_model_asset','unbind_model_asset',
  'create_commercial_types','update_commercial_type','bind_commercial_asset','unbind_commercial_asset','save_project_facility',
  'publish_project','withdraw_project','rollback_project','list_rem_brands','list_brands','brand_detail','brand_versions',
  'brand_completeness','list_brand_requests','update_brand_draft','bind_brand_asset','unbind_brand_asset',
  'confirm_brand_source_names','request_brand','publish_brand','withdraw_brand','rollback_brand',
  'create_brand_from_rem','brand_bulk_preview','brand_bulk_create','resolve_brand_request',
  'list_assets','asset_detail','asset_file','register_uploaded_asset','review_asset'
 ]) loop execute format('grant execute on function %s to hub_app',f.signature); end loop;
end $$;

-- Shared callers (release, knowledge, assistant, export) migrate in later
-- phases. Do not advertise independently editable tabs before those gates.
commit;
