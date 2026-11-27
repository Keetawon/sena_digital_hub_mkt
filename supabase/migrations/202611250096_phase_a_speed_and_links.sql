-- Migration 0096: Phase A deep SQL speedup, index coverage, and row edit link fix
-- 1. Replaces miswired '/faq?tab=publication' review_href on project rows
--    with direct project data editor href ('/website/project/<ref>?tab=data') in
--    hub.workspace_tree and clears the redundant top-of-page link in hub.workspace_page.
-- 2. Adds missing B-tree and GIN indexes on audit.change_log, hub.asset_links,
--    hub.entity_assets, hub.commercial_type_assets, hub.brand_assets,
--    hub.knowledge_asset_links, hub.asset_upload_sources, hub.media_links,
--    hub.assets, hub.content_translations, hub.content_review_versions,
--    hub.entity_versions, hub.brand_versions, and staging.dw_projects.
-- 3. Hoists per-call scope checks in hub.content_project_rows, hub.content_brand_rows,
--    and hub.content_rem_project_rows.
-- 4. Eliminates full-table JSONB scans in hub.web_source, hub.content_workflow_source,
--    hub.content_asset_bindings, hub.can_read_asset_before_media,
--    hub.content_asset_scope_allowed, hub.media_checklist_before_scopes,
--    hub.project_media_before_scopes, hub.project_content_readiness_before_media,
--    hub.workspace_page, hub.content_history, hub.content_workflow_read,
--    hub.content_workflow_items, hub.workspace_content_tasks, and hub.publication_queue_read.
-- 5. Adds lightweight hub.list_project_summaries() for fast dropdowns.

begin;

-- 1. High-impact missing indexes
create index if not exists change_log_table_id_idx
  on audit.change_log (table_name, id desc);
create index if not exists change_log_table_occurred_idx
  on audit.change_log (table_name, occurred_at desc, id desc);
create index if not exists change_log_after_row_gin
  on audit.change_log using gin (after_row jsonb_path_ops);
create index if not exists change_log_before_row_gin
  on audit.change_log using gin (before_row jsonb_path_ops);

create index if not exists asset_links_asset_id_idx
  on hub.asset_links (asset_id) where deleted_at is null;
create index if not exists asset_links_promotion_target_idx
  on hub.asset_links (target_type, target_key) where target_type = 'promotion' and deleted_at is null;
create index if not exists entity_assets_asset_id_idx
  on hub.entity_assets (asset_id) where deleted_at is null;
create index if not exists commercial_type_assets_asset_id_idx
  on hub.commercial_type_assets (asset_id) where deleted_at is null;
create index if not exists commercial_type_assets_project_id_idx
  on hub.commercial_type_assets (project_id) where deleted_at is null;
create index if not exists brand_assets_asset_id_idx
  on hub.brand_assets (asset_id) where deleted_at is null;
create index if not exists knowledge_asset_links_asset_id_idx
  on hub.knowledge_asset_links (asset_id);
create index if not exists asset_upload_sources_asset_id_idx
  on hub.asset_upload_sources (asset_id);
create index if not exists media_links_thumbnail_asset_id_idx
  on hub.media_links (thumbnail_asset_id) where thumbnail_asset_id is not null;
create index if not exists media_links_project_id_idx
  on hub.media_links (project_id);
create index if not exists assets_unbound_owner_idx
  on hub.assets (owner_id) where first_bound_at is null and deleted_at is null;
create index if not exists assets_legal_document_idx
  on hub.assets (id) where media_category = 'legal_document' and deleted_at is null;
create index if not exists content_translations_row_ref_gin
  on hub.content_translations using gin (row_ref jsonb_path_ops);
create index if not exists content_translations_owner_lookup_idx
  on hub.content_translations (owner_type, owner_key, field_key);
create index if not exists content_review_versions_approved_idx
  on hub.content_review_versions (kind, state)
  where state = 'APPROVED' and staged_invalidated_at is null and approved_by is not null;
create index if not exists entity_versions_payload_gin
  on hub.entity_versions using gin (payload jsonb_path_ops);
create index if not exists brand_versions_payload_gin
  on hub.brand_versions using gin (payload jsonb_path_ops);
create index if not exists dw_projects_group_id_idx
  on staging.dw_projects ((source_record->>'rem_project_group_id'))
  where (source_record->>'rem_project_group_id') is not null;
create index if not exists faqs_scope_lookup_idx
  on hub.faqs (scope_type, scope_id)
  where state <> 'WITHDRAWN';

-- 2. Hoist per-call scope check in row-set helpers so unrestricted staff readers
--    do not re-run advisory lock + account/scope queries once per table row.
create or replace function hub.content_project_rows(tab text)
returns setof hub.projects
language plpgsql
volatile security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  actor uuid;
  moment timestamptz;
begin
  perform hub.content_scope_lock();
  if tab not in ('projects', 'brands', 'knowledge', 'promotions', 'releases') or not hub.can(tab, 'view') then
    return;
  end if;
  if hub.content_unrestricted(tab, 'view') then
    return query select p.* from hub.projects p where p.rem_project_id is not null;
    return;
  end if;
  actor := hub.permission_actor();
  moment := hub.content_scope_now();
  return query
    select p.* from hub.projects p
    where hub.content_account_project_allowed(actor, tab, 'view', p.rem_project_id, moment);
end $function$;

create or replace function hub.content_rem_project_rows(tab text)
returns setof staging.rem_projects
language plpgsql
volatile security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  actor uuid;
  moment timestamptz;
begin
  perform hub.content_scope_lock();
  if tab not in ('projects', 'brands', 'knowledge', 'promotions', 'releases') or not hub.can(tab, 'view') then
    return;
  end if;
  if hub.content_unrestricted(tab, 'view') then
    return query select p.* from staging.rem_projects p where p.rem_project_id is not null;
    return;
  end if;
  actor := hub.permission_actor();
  moment := hub.content_scope_now();
  return query
    select p.* from staging.rem_projects p
    where hub.content_account_project_allowed(actor, tab, 'view', p.rem_project_id, moment);
end $function$;

create or replace function hub.content_brand_rows(tab text)
returns setof hub.brands
language plpgsql
volatile security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  perform hub.content_scope_lock();
  if tab not in ('projects', 'brands', 'knowledge', 'promotions', 'releases') or not hub.can(tab, 'view') then
    return;
  end if;
  if hub.content_unrestricted(tab, 'view') then
    return query select b.* from hub.brands b;
    return;
  end if;
  return query
    select b.* from hub.brands b
    where hub.content_project_set_allowed(tab, 'view', hub.content_scope_projects('brand', b.public_brand_id));
end $function$;

-- 3. Optimize hub.web_source: use typed primary/unique key index seeks before @> check.
create or replace function hub.web_source(table_name text, identity jsonb)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  result jsonb;
begin
  if table_name not in (
    'projects', 'model_types', 'web_pages', 'brands', 'assets', 'entity_assets', 'brand_assets', 'asset_links',
    'commercial_types', 'commercial_type_versions', 'commercial_type_assets',
    'project_prices', 'project_price_versions', 'project_disclosures', 'project_sales_terms',
    'project_programmes', 'project_progress', 'project_commercial_versions', 'project_facts',
    'project_buildings', 'project_selling_points', 'content_sections', 'content_section_versions',
    'faqs', 'faq_versions', 'faq_questions', 'contacts', 'project_features', 'feature_catalog',
    'project_facilities', 'facility_taxonomy', 'project_places', 'solar_estimates',
    'media_links', 'media_link_targets', 'articles', 'article_versions', 'article_links',
    'field_catalog', 'content_translations', 'businesses'
  ) or jsonb_typeof(identity) is distinct from 'object' or identity = '{}' then
    raise exception 'Invalid website source' using errcode = '23514';
  end if;

  if table_name = 'businesses' and identity ? 'code' then
    select to_jsonb(t) into strict result from hub.businesses t
    where t.code = (identity->>'code') and to_jsonb(t) @> identity;
  elsif table_name = 'faq_questions' and identity ? 'question_key' then
    select to_jsonb(t) into strict result from hub.faq_questions t
    where t.question_key = (identity->>'question_key') and to_jsonb(t) @> identity;
  elsif table_name = 'feature_catalog' and identity ? 'code' then
    select to_jsonb(t) into strict result from hub.feature_catalog t
    where t.code = (identity->>'code') and to_jsonb(t) @> identity;
  elsif table_name = 'facility_taxonomy' and identity ? 'code' then
    select to_jsonb(t) into strict result from hub.facility_taxonomy t
    where t.code = (identity->>'code') and to_jsonb(t) @> identity;
  elsif table_name = 'field_catalog' and identity ? 'field_key' then
    select to_jsonb(t) into strict result from hub.field_catalog t
    where t.field_key = (identity->>'field_key') and to_jsonb(t) @> identity;
  elsif table_name = 'project_buildings' and identity ? 'project_id' and identity ? 'building_key' then
    select to_jsonb(t) into strict result from hub.project_buildings t
    where t.project_id = (identity->>'project_id')::uuid and t.building_key = (identity->>'building_key') and to_jsonb(t) @> identity;
  elsif table_name = 'project_facilities' and identity ? 'project_id' and identity ? 'facility_code' then
    select to_jsonb(t) into strict result from hub.project_facilities t
    where t.project_id = (identity->>'project_id')::uuid and t.facility_code = (identity->>'facility_code') and to_jsonb(t) @> identity;
  elsif table_name = 'project_selling_points' and identity ? 'project_id' and identity ? 'point_key' then
    select to_jsonb(t) into strict result from hub.project_selling_points t
    where t.project_id = (identity->>'project_id')::uuid and t.point_key = (identity->>'point_key')::uuid and to_jsonb(t) @> identity;
  elsif table_name not in (
    'businesses', 'faq_questions', 'feature_catalog', 'facility_taxonomy',
    'field_catalog', 'project_buildings', 'project_facilities', 'project_selling_points'
  ) and identity ? 'id' then
    execute format('select to_jsonb(t) from hub.%I t where t.id = $1 and to_jsonb(t) @> $2', table_name)
      into strict result using (identity->>'id')::uuid, identity;
  else
    execute format('select to_jsonb(t) from hub.%I t where to_jsonb(t) @> $1', table_name)
      into strict result using identity;
  end if;
  return result;
exception
  when no_data_found or invalid_text_representation then
    return null;
end $function$;

-- 4. Optimize asset binding & permission checks with GIN-indexable @> containment
--    and fast-path view check for unrestricted staff readers.
create or replace function hub.content_asset_bindings(asset uuid)
returns table(tab text, project_ids text[])
language sql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select 'projects', array[p.rem_project_id]
  from hub.entity_assets b join hub.projects p on p.id = b.project_id
  where b.asset_id = asset and b.deleted_at is null and p.deleted_at is null
  union all
  select 'projects', array[p.rem_project_id]
  from hub.commercial_type_assets b join hub.projects p on p.id = b.project_id
  where b.asset_id = asset and b.deleted_at is null and p.deleted_at is null
  union all
  select 'brands', hub.content_scope_projects('brand', b.public_brand_id)
  from hub.brand_assets ba join hub.brands b on b.id = ba.brand_id
  where ba.asset_id = asset and ba.deleted_at is null and b.deleted_at is null
  union all
  select case when l.target_type = 'promotion' then 'promotions' else 'projects' end, array[p.rem_project_id]
  from hub.asset_links l join hub.projects p on p.id = l.project_id
  where l.asset_id = asset and l.deleted_at is null and p.deleted_at is null
  union all
  select 'knowledge', coalesce(r.applies_to_project_ids, c.project_ids)
  from hub.knowledge_asset_links l
  join staging.knowledge_candidates c on c.id = l.candidate_id
  left join hub.knowledge_reviews r on r.candidate_id = c.id
  where l.asset_id = asset
  union all
  select 'projects', array[p.rem_project_id]
  from hub.projects p join hub.entity_versions v on v.id = p.published_version_id and v.project_id = p.id
  where p.deleted_at is null and (
    v.payload @> jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', asset::text)))
    or v.payload @> jsonb_build_object('commercial_types', jsonb_build_array(jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', asset::text)))))
  )
  union all
  select 'brands', hub.content_scope_projects('brand', b.public_brand_id)
  from hub.brands b join hub.brand_versions v on v.id = b.published_version_id and v.brand_id = b.id
  where b.deleted_at is null and v.payload @> jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', asset::text)))
  union all
  select 'brands', hub.content_scope_projects('brand', b.public_brand_id)
  from hub.projects p
  join hub.entity_versions v on v.id = p.published_version_id
  join hub.brands b on b.id = p.brand_id
  where p.deleted_at is null and b.deleted_at is null
    and v.payload @> jsonb_build_object('brand', jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', asset::text))))
$function$;

create or replace function hub.content_asset_scope_allowed(asset uuid, level text)
returns boolean
language plpgsql
volatile security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  a hub.assets;
  b record;
  seen boolean := false;
begin
  select * into a from hub.assets where id = asset and deleted_at is null;
  if not found then return false; end if;

  if level = 'view' and a.media_category is distinct from 'legal_document' then
    perform hub.content_scope_lock();
    if hub.content_unrestricted('projects', 'view') and (
      exists (select 1 from hub.asset_links l join hub.projects p on p.id = l.project_id where l.asset_id = asset and l.target_type <> 'promotion' and l.deleted_at is null and p.deleted_at is null)
      or exists (select 1 from hub.entity_assets ea join hub.projects p on p.id = ea.project_id where ea.asset_id = asset and ea.deleted_at is null and p.deleted_at is null)
      or exists (select 1 from hub.commercial_type_assets ca join hub.projects p on p.id = ca.project_id where ca.asset_id = asset and ca.deleted_at is null and p.deleted_at is null)
    ) then
      return true;
    end if;
  end if;

  for b in
    select tab, array_agg(distinct id) filter (where id is not null) ids
    from hub.content_asset_bindings(asset) x
    left join lateral unnest(x.project_ids) id on true
    group by tab
  loop
    seen := true;
    if level = 'view' then
      if hub.content_project_set_allowed(b.tab, 'view', coalesce(b.ids, '{}')) then
        if a.media_category is distinct from 'legal_document' or b.tab = 'projects' and (
          hub.content_project_set_allowed('projects', 'edit', b.ids)
          or hub.content_project_set_allowed('projects', 'approve', b.ids)
        ) then
          return true;
        end if;
      end if;
    elsif not hub.content_project_set_allowed(b.tab, level, coalesce(b.ids, '{}')) then
      return false;
    end if;
  end loop;
  if seen then return level in ('edit', 'approve'); end if;
  return a.provenance = 'upload' and a.owner_id = hub.permission_actor() and a.first_bound_at is null and
    case when level = 'view' then hub.can_upload_asset() else hub.can('projects', level) or hub.can('brands', level) or hub.can('knowledge', level) end;
end $function$;

create or replace function hub.can_read_asset_before_media(asset_uuid uuid)
returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select exists (
    select 1 from hub.assets a
    where a.id = asset_uuid and a.deleted_at is null and hub.content_asset_scope_allowed(a.id, 'view') and (
      (a.provenance = 'upload' and a.owner_id = hub.permission_actor() and a.first_bound_at is null and hub.can_upload_asset())
      or (hub.can('projects', 'view') and (
        exists (
          select 1 from hub.entity_assets b join hub.projects p on p.id = b.project_id
          where b.asset_id = a.id and b.deleted_at is null and p.deleted_at is null
            and (b.model_id is null or exists (select 1 from hub.model_types m where m.id = b.model_id and m.project_id = p.id and m.deleted_at is null))
        )
        or exists (
          select 1 from hub.commercial_type_assets b
          join hub.commercial_types t on t.id = b.commercial_type_id
          join hub.projects p on p.id = b.project_id
          where b.asset_id = a.id and b.deleted_at is null and t.project_id = p.id and t.deleted_at is null and p.deleted_at is null
        )
        or exists (
          select 1 from hub.projects p join hub.entity_versions v on v.id = p.published_version_id and v.project_id = p.id
          where p.deleted_at is null and (
            v.payload @> jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', a.id::text)))
            or v.payload @> jsonb_build_object('commercial_types', jsonb_build_array(jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', a.id::text)))))
          )
        )
      ))
      or (hub.can('brands', 'view') and (
        exists (
          select 1 from hub.brand_assets b join hub.brands t on t.id = b.brand_id
          where b.asset_id = a.id and b.deleted_at is null and t.deleted_at is null
        )
        or exists (
          select 1 from hub.brands b join hub.brand_versions v on v.id = b.published_version_id and v.brand_id = b.id
          where b.deleted_at is null and v.payload @> jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', a.id::text)))
        )
        or exists (
          select 1 from hub.projects p join hub.entity_versions v on v.id = p.published_version_id and v.project_id = p.id
          where p.deleted_at is null and v.payload @> jsonb_build_object('brand', jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', a.id::text))))
        )
      ))
      or (hub.can('knowledge', 'view') and exists (select 1 from hub.knowledge_asset_links b where b.asset_id = a.id))
    )
  )
$function$;

create or replace function hub.can_read_asset(asset_uuid uuid)
returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select exists (
    select 1 from hub.assets a
    where a.id = asset_uuid and a.deleted_at is null
      and (
        not exists (select 1 from hub.asset_upload_sources where asset_id = a.id and processing_class = 'private_exact')
        or a.provenance = 'upload' and a.owner_id = hub.permission_actor() and a.first_bound_at is null and hub.can_upload_asset()
        or exists (
          select 1 from hub.content_asset_bindings(a.id) binding
          where binding.tab = 'projects'
            and (hub.content_project_set_allowed('projects', 'edit', binding.project_ids)
                 or hub.content_project_set_allowed('projects', 'approve', binding.project_ids))
        )
      )
      and hub.content_asset_scope_allowed(a.id, 'view')
      and (a.media_category is distinct from 'legal_document' or hub.can('projects', 'edit') or hub.can('projects', 'approve'))
      and (
        exists (
          select 1 from hub.asset_links l join hub.projects p on p.id = l.project_id
          where l.asset_id = a.id and l.deleted_at is null and p.deleted_at is null
            and hub.media_target(l.project_id, l.target_type, l.target_key, 'view')
        )
        or (hub.can('projects', 'view') and exists (
          select 1 from hub.media_links c join hub.projects p on p.id = c.project_id
          where c.thumbnail_asset_id = a.id and c.state <> 'WITHDRAWN' and p.deleted_at is null
        ))
        or (a.provenance = 'upload' and a.owner_id = hub.permission_actor() and a.first_bound_at is null and hub.can_upload_asset())
        or (hub.can('projects', 'view') and (
          exists (
            select 1 from hub.entity_assets b join hub.projects p on p.id = b.project_id
            where b.asset_id = a.id and b.deleted_at is null and p.deleted_at is null
              and (b.model_id is null or exists (select 1 from hub.model_types m where m.id = b.model_id and m.project_id = p.id and m.deleted_at is null))
          )
          or exists (
            select 1 from hub.commercial_type_assets b
            join hub.commercial_types t on t.id = b.commercial_type_id
            join hub.projects p on p.id = b.project_id
            where b.asset_id = a.id and b.deleted_at is null and t.project_id = p.id and t.deleted_at is null and p.deleted_at is null
          )
          or exists (
            select 1 from hub.projects p join hub.entity_versions v on v.id = p.published_version_id and v.project_id = p.id
            where p.deleted_at is null and (
              v.payload @> jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', a.id::text)))
              or v.payload @> jsonb_build_object('commercial_types', jsonb_build_array(jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', a.id::text)))))
            )
          )
        ))
        or (hub.can('brands', 'view') and (
          exists (
            select 1 from hub.brand_assets b join hub.brands t on t.id = b.brand_id
            where b.asset_id = a.id and b.deleted_at is null and t.deleted_at is null
          )
          or exists (
            select 1 from hub.brands b join hub.brand_versions v on v.id = b.published_version_id and v.brand_id = b.id
            where b.deleted_at is null and v.payload @> jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', a.id::text)))
          )
          or exists (
            select 1 from hub.projects p join hub.entity_versions v on v.id = p.published_version_id and v.project_id = p.id
            where p.deleted_at is null and v.payload @> jsonb_build_object('brand', jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', a.id::text))))
          )
        ))
        or (hub.can('knowledge', 'view') and exists (select 1 from hub.knowledge_asset_links b where b.asset_id = a.id))
      )
  )
$function$;

-- 5. Fix miswired review_href AND speed up hub.workspace_tree & hub.workspace_page
--    (GIN @> operator on staging.knowledge_candidates.project_ids + lazy faq_references).
do $$
declare
  d text;
begin
  d := replace(pg_get_functiondef('hub.workspace_tree(text,text,text,text,integer)'::regprocedure), chr(13), '');
  d := hub.content_definition_replace(
    d,
    'faq_refs:=case when hub.can(''knowledge'',''view'') then hub.faq_references() else ''{}''::jsonb end;',
    'faq_refs:=case when hub.can(''knowledge'',''view'') and (not hub.content_unrestricted(''projects'',''view'') or not hub.content_unrestricted(''brands'',''view'')) then hub.faq_references() else ''{}''::jsonb end;'
  );
  d := hub.content_definition_replace(
    d,
    '''review_href'',case when kind=''project'' and not faq_only and grouping=''unconfirmed'' and hub.can(''knowledge'',''view'') then ''/faq?tab=publication'' end',
    '''review_href'',case when kind=''project'' and not faq_only and (hub.can(''projects'',''view'') or hub.can(''knowledge'',''view'')) then ''/website/project/''||ref||''?tab=data'' end'
  );
  execute d;

  d := replace(pg_get_functiondef('hub.workspace_page(text,text,text)'::regprocedure), chr(13), '');
  d := hub.content_definition_replace(
    d,
    'where p.rem_project_id=any(k.project_ids)',
    'where k.project_ids @> array[p.rem_project_id]'
  );
  d := hub.content_definition_replace(
    d,
    '''review_href'',case when group_ref is null and hub.can(''knowledge'',''view'') then ''/faq?tab=publication'' end',
    '''review_href'',null::text'
  );
  execute d;
end $$;

-- 6. Optimize hub.content_history: use GIN-indexed UNION branches for project/brand
--    tables instead of scanning all 25k+ TOASTed rows of audit.change_log.
create or replace function hub.content_history(kind text, ref text, before_id bigint default null::bigint, page_size integer default 50)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  rows jsonb;
  faq_scope jsonb;
  target_project_ids uuid[] := '{}';
  target_asset_ids uuid[] := '{}';
  target_brand_id uuid;
  target_brand_ref text;
  project_tables constant text[] := array[
    'hub.model_types', 'hub.entity_assets', 'hub.commercial_types', 'hub.commercial_type_sources',
    'hub.commercial_type_assets', 'hub.commercial_type_versions', 'hub.project_facts',
    'hub.project_buildings', 'hub.project_selling_points', 'hub.project_facilities',
    'hub.project_features', 'hub.solar_estimates', 'hub.project_places', 'hub.project_prices',
    'hub.project_price_versions', 'hub.project_disclosures', 'hub.project_sales_terms',
    'hub.project_programmes', 'hub.project_progress', 'hub.project_commercial_versions',
    'hub.website_text_decision', 'hub.asset_links', 'hub.media_links', 'hub.media_link_targets'
  ];
  shared_tables constant text[] := array[
    'hub.content_review_versions', 'hub.translation_glossary', 'hub.publication_releases',
    'hub.web_publications', 'hub.publication_release_members', 'hub.web_pages', 'hub.web_changes',
    'hub.entity_versions', 'hub.businesses', 'hub.brand_business', 'hub.contacts',
    'hub.content_sections', 'hub.content_section_versions', 'hub.faqs', 'hub.faq_versions',
    'hub.faq_sources', 'hub.faq_intake_decisions', 'hub.faq_questions', 'hub.faq_question_versions',
    'hub.content_gaps', 'hub.articles', 'hub.article_versions', 'hub.article_links',
    'hub.public_promotions', 'hub.promotion_reviews', 'hub.promotion_versions',
    'hub.entity_aliases', 'hub.knowledge_fact_candidates'
  ];
begin
  if not hub.content_scope_allowed(kind, ref, 'view') then
    perform hub.workspace_faq_scope_access(kind, ref);
  end if;
  if page_size is null or page_size not between 1 and 100 or before_id <= 0 then
    raise exception 'Invalid history page' using errcode = '23514';
  end if;

  if kind = 'project' then
    if hub.content_scope_allowed('project', ref, 'view') then
      target_project_ids := hub.workspace_projects('project', ref);
    else
      faq_scope := hub.workspace_faq_scope_access('project', ref);
      select coalesce(array_agg((x->>'id')::uuid), '{}') into target_project_ids
      from jsonb_array_elements(coalesce(faq_scope->'projects', '[]'::jsonb)) x;
    end if;
    if cardinality(target_project_ids) = 0 then
      select coalesce(array_agg(p.id), '{}') into target_project_ids
      from hub.projects p where p.public_project_id = ref and p.deleted_at is null;
    end if;
    select p.brand_id, b.public_brand_id into target_brand_id, target_brand_ref
    from hub.projects p left join hub.brands b on b.id = p.brand_id and b.deleted_at is null
    where p.id = any(target_project_ids) limit 1;
    select coalesce(array_agg(distinct x.asset_id), '{}') into target_asset_ids
    from (
      select asset_id from hub.entity_assets where project_id = any(target_project_ids) and deleted_at is null
      union
      select asset_id from hub.asset_links where project_id = any(target_project_ids) and deleted_at is null
      union
      select asset_id from hub.commercial_type_assets where project_id = any(target_project_ids) and deleted_at is null
      union
      select asset_id from hub.brand_assets where target_brand_id is not null and brand_id = target_brand_id and deleted_at is null
    ) x where x.asset_id is not null;

    select coalesce(jsonb_agg(item order by id desc), '[]') into rows
    from (
      with candidate_ids as (
        select a.id from unnest(target_project_ids) pid
        join audit.change_log a on a.table_name = 'hub.projects' and a.after_row @> jsonb_build_object('id', pid::text)
        where before_id is null or a.id < before_id
        union
        select a.id from unnest(target_project_ids) pid
        join audit.change_log a on a.table_name = 'hub.projects' and a.before_row @> jsonb_build_object('id', pid::text)
        where before_id is null or a.id < before_id
        union
        select a.id from unnest(target_project_ids) pid
        join audit.change_log a on a.table_name = any(project_tables) and a.after_row @> jsonb_build_object('project_id', pid::text)
        where before_id is null or a.id < before_id
        union
        select a.id from unnest(target_project_ids) pid
        join audit.change_log a on a.table_name = any(project_tables) and a.before_row @> jsonb_build_object('project_id', pid::text)
        where before_id is null or a.id < before_id
        union
        select a.id from unnest(target_asset_ids) aid
        join audit.change_log a on a.table_name = 'hub.assets' and (a.after_row @> jsonb_build_object('id', aid::text) or a.before_row @> jsonb_build_object('id', aid::text))
        where before_id is null or a.id < before_id
        union
        select a.id from unnest(target_asset_ids) aid
        join audit.change_log a on a.table_name in ('hub.asset_media_tags', 'hub.knowledge_asset_links')
          and (a.after_row @> jsonb_build_object('asset_id', aid::text) or a.before_row @> jsonb_build_object('asset_id', aid::text))
        where before_id is null or a.id < before_id
        union
        select a.id from audit.change_log a
        where target_brand_id is not null and a.table_name = 'hub.brands'
          and (a.after_row @> jsonb_build_object('id', target_brand_id::text) or a.before_row @> jsonb_build_object('id', target_brand_id::text))
          and (before_id is null or a.id < before_id)
        union
        select a.id from audit.change_log a
        where target_brand_id is not null and a.table_name in ('hub.brand_versions', 'hub.brand_assets')
          and (a.after_row @> jsonb_build_object('brand_id', target_brand_id::text) or a.before_row @> jsonb_build_object('brand_id', target_brand_id::text))
          and (before_id is null or a.id < before_id)
        union
        select a.id from audit.change_log a
        where a.table_name = 'hub.content_translations' and (before_id is null or a.id < before_id)
          and (
            a.after_row @> jsonb_build_object('scope_id', ref)
            or a.before_row @> jsonb_build_object('scope_id', ref)
            or (target_brand_ref is not null and (a.after_row @> jsonb_build_object('scope_id', target_brand_ref) or a.before_row @> jsonb_build_object('scope_id', target_brand_ref)))
            or a.after_row @> '{"owner_type":"faq"}'::jsonb or a.before_row @> '{"owner_type":"faq"}'::jsonb
            or a.after_row @> '{"owner_type":"section"}'::jsonb or a.before_row @> '{"owner_type":"section"}'::jsonb
            or a.after_row @> '{"owner_type":"article"}'::jsonb or a.before_row @> '{"owner_type":"article"}'::jsonb
          )
        union
        select a.id from unnest(shared_tables) st(tname)
        join audit.change_log a on a.table_name = st.tname
        where before_id is null or a.id < before_id
      )
      select l.id, hub.workspace_history_event(l, c) item
      from (select id from candidate_ids order by id desc) cid
      join audit.change_log l on l.id = cid.id
      join lateral (
        select distinct on (x->>'kind', x->>'ref') x c
        from hub.workspace_history_contexts(l.table_name, coalesce(l.after_row, l.before_row)) x
        where hub.workspace_history_matches(x, kind, ref)
        limit 1
      ) contexts on true
      where hub.workspace_history_visible(l)
      order by l.id desc
      limit page_size + 1
    ) events;
  else
    select coalesce(jsonb_agg(item order by id desc), '[]') into rows
    from (
      select l.id, hub.workspace_history_event(l, c) item
      from audit.change_log l
      join lateral (
        select distinct on (x->>'kind', x->>'ref') x c
        from hub.workspace_history_contexts(l.table_name, coalesce(l.after_row, l.before_row)) x
        where hub.workspace_history_matches(x, kind, ref)
        limit 1
      ) contexts on true
      where (before_id is null or l.id < before_id)
        and l.table_name like 'hub.%'
        and l.table_name not in (
          'hub.website_asset_suggestions', 'hub.translation_jobs', 'hub.field_catalog',
          'hub.asset_upload_sources', 'hub.asset_upload_evidence', 'hub.media_jobs',
          'hub.facility_taxonomy', 'hub.feature_catalog', 'hub.media_tags',
          'hub.media_requirements', 'hub.contact_domains'
        )
        and (kind <> 'brand' or l.table_name <> all(project_tables || array['hub.projects']))
        and hub.workspace_history_visible(l)
      order by l.id desc
      limit page_size + 1
    ) events;
  end if;

  return jsonb_build_object(
    'items', case when jsonb_array_length(rows) > page_size then rows - (jsonb_array_length(rows) - 1) else rows end,
    'next_cursor', case when jsonb_array_length(rows) > page_size then rows->(page_size - 1)->>'audit_id' end
  );
end $function$;

-- 7. Optimize hub.media_checklist_before_scopes: split OR into indexed UNION ALL
--    and materialize bound assets + tags once per project instead of per rule/floor.
create or replace function hub.media_checklist_before_scopes(public_id text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  project_uuid uuid;
  project_label text;
  result jsonb;
begin
  project_uuid := hub.media_project(public_id, 'view');
  select coalesce(public_name->>'th', 'โครงการนี้') into project_label from hub.projects where id = project_uuid;
  with contexts as materialized (
    select 'project'::text per, 'project'::text kind, project_uuid::text key, project_label label, null::integer floor
    union all
    select 'facility_present', 'facility', f.facility_code, t.name_th, null
    from hub.project_facilities f
    join hub.facility_taxonomy t on t.code = f.facility_code
    where f.project_id = project_uuid and f.status = 'present'
    union all
    select 'commercial_type', 'commercial_type', id::text, public_name->>'th', null
    from hub.commercial_types
    where project_id = project_uuid and deleted_at is null
    union all
    select 'type_storey', 'commercial_type', t.id::text, (t.public_name->>'th') || ' ชั้น ' || f::text, f
    from hub.commercial_types t
    cross join lateral generate_series(1, case when t.storeys is not null then least(t.storeys, 200) end) f
    where t.project_id = project_uuid and t.deleted_at is null and t.product_form in ('house', 'townhome')
    union all
    select 'building_floor', 'building_floor', b.building_key, (b.name->>'th') || ' ชั้น ' || f::text, f
    from hub.project_buildings b
    cross join lateral generate_series(1, case when b.floors_above is not null then least(b.floors_above, 200) end) f
    where b.project_id = project_uuid and not f = any(b.skip_floors)
    union all
    select 'active_promotion', 'promotion', promo.id::text, promo.title->>'th', null
    from hub.public_promotions promo
    where promo.starts_at <= now() and promo.ends_at > now() and hub.can('promotions', 'view')
      and exists (select 1 from hub.promotion_target_projects(promo.id) scope where scope.id = project_uuid)
    union all
    select 'under_construction', 'project', project_uuid::text, project_label, null
    where exists (
      select 1 from hub.projects p
      join staging.dw_projects s on s.rem_project_id = p.rem_project_id
      where p.id = project_uuid
        and lower(s.source_record->>'project_status_detail') in ('under_construction', 'construction', 'กำลังก่อสร้าง', 'อยู่ระหว่างก่อสร้าง')
    )
  ),
  raw_bindings as (
    select asset_id, target_type kind, target_key key, usage, floor_from, floor_to, effective_from, effective_to, room_tag
    from hub.asset_links
    where project_id = project_uuid and deleted_at is null
      and (target_type <> 'promotion' or hub.media_target(project_id, target_type, target_key, 'view'))
    union all
    select l.asset_id, l.target_type kind, l.target_key key, l.usage, l.floor_from, l.floor_to, l.effective_from, l.effective_to, l.room_tag
    from hub.asset_links l
    where l.target_type = 'promotion' and l.project_id <> project_uuid and l.deleted_at is null
      and exists (select 1 from hub.promotion_target_projects(l.target_key::uuid) scope where scope.id = project_uuid)
      and hub.media_target(l.project_id, l.target_type, l.target_key, 'view')
    union all
    select asset_id, 'project', project_uuid::text, asset_role, null, null, effective_from, effective_to, null
    from hub.entity_assets
    where project_id = project_uuid and model_id is null and deleted_at is null
      and (asset_role not in ('hero', 'thumbnail') or is_primary)
    union all
    select asset_id, 'commercial_type', commercial_type_id::text,
      case asset_role when 'floor_plan' then 'unit_plan' when 'model_image' then 'interior' else asset_role end,
      floor_number, floor_number, null, null, room_tag
    from hub.commercial_type_assets
    where project_id = project_uuid and deleted_at is null
  ),
  bound_assets as materialized (
    select
      b.asset_id, b.kind, b.key, b.usage, b.floor_from, b.floor_to, b.room_tag,
      a.media_category, a.metadata_state, a.taken_at,
      coalesce((select array_agg(mt.tag_code) from hub.asset_media_tags mt where mt.asset_id = a.id), '{}'::text[]) as asset_tags
    from raw_bindings b
    join hub.assets a on a.id = b.asset_id
    where a.deleted_at is null
      and a.media_category is distinct from 'legal_document'
      and a.rights_status = 'approved'
      and (a.effective_from is null or a.effective_from <= now())
      and (a.effective_to is null or a.effective_to > now())
      and (b.effective_from is null or b.effective_from <= now())
      and (b.effective_to is null or b.effective_to > now())
  ),
  counts as (
    select
      r.rule_key, r.label, r.media_category, r.usage, r.tags, r.min_count, r.target_count, r.blocks_publish,
      c.kind, c.key, c.label context_label, c.floor,
      (
        select count(distinct b.asset_id)
        from bound_assets b
        where b.kind = c.kind and b.key = c.key
          and (b.media_category is null or b.metadata_state = 'confirmed' or r.blocks_publish)
          and (r.media_category is null or b.media_category = r.media_category or b.media_category is null and b.usage = r.media_category)
          and (r.usage is null or b.usage = r.usage)
          and (c.floor is null or c.floor between b.floor_from and coalesce(b.floor_to, b.floor_from))
          and (r.max_age_days is null or b.taken_at between current_date - r.max_age_days and current_date)
          and not exists (
            select 1 from unnest(r.tags) t(code)
            where t.code is distinct from b.room_tag and not (t.code = any(b.asset_tags))
          )
      ) as count
    from hub.media_requirements r
    join contexts c on c.per = r.per
    where r.status = 'active'
  ),
  items as (
    select to_jsonb(c) || jsonb_build_object(
      'complete', count >= target_count,
      'minimum_met', count >= min_count,
      'context', jsonb_build_object(
        'target_type', kind, 'target_key', key, 'floor_from', floor, 'floor_to', floor,
        'media_category', media_category, 'usage', coalesce(usage, 'gallery'), 'tags', tags
      )
    ) item
    from counts c
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(item order by item->>'rule_key', item->>'key', item->>'floor'), '[]'),
    'required_missing', count(*) filter (where (item->>'blocks_publish')::boolean and not (item->>'minimum_met')::boolean),
    'recommended_score', coalesce(round(100.0 * sum(least((item->>'count')::numeric / (item->>'target_count')::numeric, 1)) / nullif(count(*), 0)), 0)
  ) into result
  from items;

  return result || jsonb_build_object(
    'broken_links', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'link_status', link_status)), '[]')
      from hub.media_links
      where project_id = project_uuid and state <> 'WITHDRAWN' and link_status <> 'ok'
    ),
    'unknown_coverage', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', 'building_floor', 'key', building_key, 'label', name)), '[]')
      from hub.project_buildings
      where project_id = project_uuid and (floors_above is null or floors_above > 200)
    ) || (
      select coalesce(jsonb_agg(jsonb_build_object('kind', 'type_storey', 'key', id, 'label', public_name)), '[]')
      from hub.commercial_types
      where project_id = project_uuid and deleted_at is null and product_form in ('house', 'townhome') and (storeys is null or storeys > 200)
    )
  );
end $function$;

-- 8. Optimize hub.project_media_before_scopes: narrow to project-linked or own-unbound
--    asset IDs via indexed union before evaluating hub.can_read_asset(a.id).
create or replace function hub.project_media_before_scopes(public_id text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  p hub.projects;
  actor uuid := hub.permission_actor();
begin
  select * into p from hub.projects where id = hub.media_project(public_id, 'view');
  return jsonb_build_object(
    'project', jsonb_build_object('id', p.id, 'public_project_id', p.public_project_id, 'name', p.public_name, 'updated_at', p.updated_at),
    'categories', hub.media_categories(),
    'tags', hub.media_tags_read(),
    'requirements', hub.media_requirements_read(),
    'checklist', hub.media_checklist(public_id),
    'assets', (
      with candidate_ids as materialized (
        select asset_id from hub.asset_links where project_id = p.id and deleted_at is null
        union
        select asset_id from hub.entity_assets where project_id = p.id and deleted_at is null
        union
        select asset_id from hub.commercial_type_assets where project_id = p.id and deleted_at is null
        union
        select id as asset_id from hub.assets where owner_id = actor and first_bound_at is null and deleted_at is null
      )
      select coalesce(jsonb_agg(
        to_jsonb(a) || jsonb_build_object('tags', (select coalesce(jsonb_agg(tag_code), '[]') from hub.asset_media_tags where asset_id = a.id))
        order by a.created_at desc
      ), '[]')
      from candidate_ids c
      join hub.assets a on a.id = c.asset_id
      where a.deleted_at is null and hub.can_read_asset(a.id)
    ),
    'links', (
      select coalesce(jsonb_agg(to_jsonb(l) order by l.sort, l.id), '[]')
      from hub.asset_links l
      where project_id = p.id and deleted_at is null
        and hub.media_target(project_id, target_type, target_key, 'view')
        and hub.can_read_asset(asset_id)
    ),
    'clips', (
      select coalesce(jsonb_agg(
        to_jsonb(c) || jsonb_build_object(
          'visible', c.link_status = 'ok' and c.state <> 'WITHDRAWN',
          'targets', (
            select coalesce(jsonb_agg(to_jsonb(t)), '[]')
            from hub.media_link_targets t
            where media_link_id = c.id and hub.media_target(t.project_id, t.target_type, t.target_key, 'view')
          )
        ) order by c.sort, c.id
      ), '[]')
      from hub.media_links c
      where project_id = p.id
    ),
    'context', jsonb_build_object(
      'features', (
        select coalesce(jsonb_agg(jsonb_build_object('key', f.id, 'label', c.label, 'status', f.status) order by f.feature_code, f.id), '[]')
        from hub.project_features f join hub.feature_catalog c on c.code = f.feature_code where f.project_id = p.id
      ),
      'places', (
        select coalesce(jsonb_agg(jsonb_build_object('key', id, 'label', name, 'status', status) order by sort, id), '[]')
        from hub.project_places where project_id = p.id
      ),
      'facilities', (
        select coalesce(jsonb_agg(jsonb_build_object('key', f.facility_code, 'label', jsonb_build_object('th', t.name_th, 'en', t.name_en), 'status', f.status)), '[]')
        from hub.project_facilities f join hub.facility_taxonomy t on t.code = f.facility_code
        where f.project_id = p.id and f.status in ('present', 'planned')
      ),
      'commercial_types', (
        select coalesce(jsonb_agg(jsonb_build_object('key', id, 'label', public_name, 'storeys', storeys)), '[]')
        from hub.commercial_types where project_id = p.id and deleted_at is null
      ),
      'buildings', (
        select coalesce(jsonb_agg(jsonb_build_object('key', building_key, 'label', name, 'floors_above', floors_above, 'skip_floors', skip_floors)), '[]')
        from hub.project_buildings where project_id = p.id
      ),
      'promotions', (
        select coalesce(jsonb_agg(jsonb_build_object('key', id, 'label', title, 'starts_at', starts_at, 'ends_at', ends_at)), '[]')
        from hub.public_promotions promo
        where hub.can('promotions', 'view')
          and exists (select 1 from hub.promotion_target_projects(promo.id) scope where scope.id = p.id)
      ),
      'selling_points', (
        select coalesce(jsonb_agg(jsonb_build_object('key', point_key, 'label', title)), '[]')
        from hub.project_selling_points s
        where project_id = p.id and state <> 'WITHDRAWN'
          and revision = (select max(v.revision) from hub.project_selling_points v where v.project_id = s.project_id and v.point_key = s.point_key)
      )
    )
  );
end $function$;

-- 9. Optimize hub.content_workflow_source: typed PK seek + GIN @> containment + single asset check.
create or replace function hub.content_workflow_source(kind text, identity jsonb, level text default 'view'::text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  row_data jsonb;
  table_name text := hub.content_workflow_table(kind);
  tab text;
  scope text;
  project uuid;
  tabs text[];
  required_tab text;
begin
  if identity is distinct from hub.content_workflow_identity(kind, identity) then
    raise exception 'Invalid content identity' using errcode = '23514';
  end if;
  if kind = 'question' then
    select to_jsonb(t) into strict row_data from hub.faq_questions t where t.question_key = identity->>'question_key';
  elsif kind = 'glossary' then
    select to_jsonb(t) into strict row_data from hub.translation_glossary t where t.term_key = identity->>'term_key';
  elsif kind = 'facility' then
    select to_jsonb(t) into strict row_data from hub.project_facilities t
    where t.project_id = (identity->>'project_id')::uuid and t.facility_code = identity->>'facility_code';
  elsif kind = 'building' then
    select to_jsonb(t) into strict row_data from hub.project_buildings t
    where t.project_id = (identity->>'project_id')::uuid and t.building_key = identity->>'building_key';
  elsif kind = 'selling_point' then
    select to_jsonb(t) into strict row_data from hub.project_selling_points t
    where t.project_id = (identity->>'project_id')::uuid and t.point_key = (identity->>'point_key')::uuid
    order by t.revision desc limit 1;
  else
    execute format('select to_jsonb(t) from hub.%I t where t.id = $1', table_name)
      into strict row_data using (identity->>'id')::uuid;
  end if;

  if row_data is null or row_data->>'deleted_at' is not null then
    raise exception 'Content not found' using errcode = 'P0002';
  end if;
  scope := row_data->>'scope_type';
  tab := case
    when kind in ('faq', 'article', 'question', 'glossary', 'page_config') then 'knowledge'
    when kind in ('brand', 'brand_asset') or scope = 'brand' then 'brands'
    when kind = 'promotion' then 'promotions'
    when kind in ('article', 'question', 'glossary') or kind in ('faq', 'section', 'contact') and scope is distinct from 'project' then 'knowledge'
    else 'projects'
  end;
  if kind = 'asset' then
    perform hub.require_asset_access((row_data->>'id')::uuid);
    select coalesce(array_agg(name order by name), '{}') into tabs from (values
      ('projects',
        exists (select 1 from hub.entity_assets where asset_id = (row_data->>'id')::uuid and deleted_at is null)
        or exists (select 1 from hub.commercial_type_assets where asset_id = (row_data->>'id')::uuid and deleted_at is null)
        or exists (select 1 from hub.asset_links where asset_id = (row_data->>'id')::uuid and deleted_at is null)
        or exists (
          select 1 from hub.projects p join hub.entity_versions v on v.id = p.published_version_id
          where p.deleted_at is null and (
            v.payload @> jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', row_data->>'id')))
            or v.payload @> jsonb_build_object('commercial_types', jsonb_build_array(jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', row_data->>'id')))))
          )
        )
      ),
      ('brands',
        exists (select 1 from hub.brand_assets where asset_id = (row_data->>'id')::uuid and deleted_at is null)
        or exists (
          select 1 from hub.brands b join hub.brand_versions v on v.id = b.published_version_id
          where b.deleted_at is null and v.payload @> jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('id', row_data->>'id')))
        )
      ),
      ('knowledge', exists (select 1 from hub.knowledge_asset_links where asset_id = (row_data->>'id')::uuid)),
      ('promotions', exists (select 1 from hub.asset_links where asset_id = (row_data->>'id')::uuid and target_type = 'promotion' and deleted_at is null))
    ) sources(name, owns) where owns;
    if cardinality(tabs) = 0 then
      select array[name] into tabs from unnest(array['projects', 'brands', 'knowledge']) name where hub.can(name, level) limit 1;
    end if;
    if level = 'view' then
      select name into tab from unnest(tabs) name where hub.can(name, 'view') limit 1;
    else
      foreach required_tab in array coalesce(tabs, '{}') loop perform hub.require_permission(required_tab, level); end loop;
      tab := tabs[1];
    end if;
    if tab is null then raise exception 'Asset source permission required' using errcode = '42501'; end if;
  else
    perform hub.require_permission(tab, level);
    tabs := array[tab];
  end if;
  if kind = 'promotion' then perform hub.promotion_scope_access((row_data->>'id')::uuid, level); end if;
  if kind in ('section', 'contact') then perform hub.content_scope_access(scope, row_data->>'scope_id', level); end if;
  project := case when kind = 'project' then (row_data->>'id')::uuid else (row_data->>'project_id')::uuid end;
  if project is not null and not exists (select 1 from hub.projects where id = project and deleted_at is null) then
    raise exception 'Content not found' using errcode = 'P0002';
  end if;
  if kind in ('project_asset', 'brand_asset', 'type_asset', 'asset_context') then
    perform hub.require_asset_access((row_data->>'asset_id')::uuid);
  end if;
  if kind in ('asset_context', 'media_target') and not hub.media_target(project, row_data->>'target_type', row_data->>'target_key', level) then
    raise exception 'Content target is unavailable' using errcode = '42501';
  end if;
  if kind in ('model', 'unit_type', 'price', 'disclosure', 'sales_term', 'programme', 'progress') then
    row_data := row_data || jsonb_build_object('_form_updated_at', (select updated_at from hub.projects where id = project));
  end if;
  perform hub.require_content_source(table_name, row_data, tab, level);
  return row_data || jsonb_build_object('_tab', tab, '_tabs', tabs, '_staged_values', hub.content_workflow_staged_values(kind, row_data));
exception
  when no_data_found or invalid_text_representation then
    raise exception 'Content not found' using errcode = 'P0002';
end $function$;

-- 10. Optimize hub.content_workflow_read & hub.content_workflow_items:
--     short-circuit non-submittable items during batch enumeration before running
--     edit/approve/author/history queries.
create or replace function hub.content_workflow_read_core(kind text, identity jsonb, include_history boolean default true)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  source jsonb;
  version jsonb;
  state text;
  history jsonb := '[]'::jsonb;
  old_values jsonb;
  new_values jsonb;
  drift boolean;
  may_approve boolean := false;
  may_edit boolean := false;
  may_submit boolean := false;
  may_withdraw boolean := false;
  may_save_approve boolean := false;
  authors uuid[] := '{}';
  current_actor uuid := hub.permission_actor();
  target_table text;
  ver_table text;
  ver_fk_val jsonb;
begin
  source := hub.content_workflow_source(kind, identity, 'view');
  version := hub.content_workflow_version(kind, identity, source);
  old_values := coalesce(nullif(version#>'{payload,_staged_values}', 'null'), nullif(version->'staged_evidence', 'null'), '{}') - '_disclosure_sources';
  new_values := case
    when kind = 'disclosure' and version is not null then
      hub.content_workflow_staged_values(kind, source || jsonb_build_object('_disclosure_sources', version#>'{staged_evidence,_disclosure_sources}'))
    else coalesce(source->'_staged_values', '{}')
  end - '_disclosure_sources';
  drift := old_values is distinct from new_values or version->>'staged_invalidated_at' is not null;
  state := upper(coalesce(
    case when kind = 'question' and source->>'review_state' in ('IN_REVIEW', 'RETURNED') then source->>'review_state' end,
    version->>'state',
    case when kind = 'question' then case source->>'status' when 'approved' then 'APPROVED' when 'retired' then 'WITHDRAWN' else 'DRAFT' end end,
    'DRAFT'
  ));
  if upper(coalesce(version->>'state', '')) <> 'IN_REVIEW' and version ? 'source_hash'
     and version->>'source_hash' is distinct from hub.web_hash(hub.content_workflow_payload(kind, source - '_tab')) then
    state := 'DRAFT';
  end if;

  if not include_history then
    if kind = 'promotion' or not (state = 'DRAFT' or (version is not null and drift)) then
      return jsonb_build_object('can_submit', false, 'state', state, 'needs_reapproval', version is not null and drift);
    end if;
    begin
      perform hub.content_workflow_source(kind, identity, 'edit');
      may_edit := true;
    exception when insufficient_privilege or no_data_found then null;
    end;
    may_submit := may_edit and case
      when kind in ('faq', 'section', 'article', 'selling_point') then state = 'DRAFT'
      when kind = 'question' then source->>'status' = 'proposed' and source->>'review_state' <> 'IN_REVIEW'
      when kind = 'unit_type' then source->>'status' = 'draft'
      when kind in ('price', 'disclosure', 'sales_term', 'programme', 'progress') then source->>'state' = 'draft'
      else (state <> 'APPROVED' or drift) and not exists (
        select 1 from hub.content_review_versions r
        where r.kind = content_workflow_read_core.kind and r.identity = content_workflow_read_core.identity and r.state = 'IN_REVIEW'
      )
    end;
    if not coalesce(may_submit, false) then
      return jsonb_build_object('can_submit', false, 'state', state, 'needs_reapproval', version is not null and drift);
    end if;
    return hub.content_exposure(kind, source, case when kind in ('faq', 'section', 'article') then version end) || jsonb_build_object(
      'kind', kind, 'identity', identity, 'source_tab', source->>'_tab', 'expected_hash', hub.content_workflow_hash(source),
      'source_revision', case kind when 'asset' then source->'media_revision' when 'promotion' then source->'draft_revision' else source->'revision' end,
      'source_updated_at', case when kind in ('model', 'unit_type', 'price', 'disclosure', 'sales_term', 'programme', 'progress') then
        (select to_jsonb(p.updated_at) from hub.projects p where p.id = (source->>'project_id')::uuid) else source->'updated_at' end,
      'state', state, 'needs_reapproval', version is not null and drift,
      'can_edit', may_edit, 'can_submit', true, 'source_tabs', source->'_tabs'
    );
  end if;

  begin
    perform hub.content_workflow_source(kind, identity, 'approve');
    may_approve := true;
  exception when insufficient_privilege or no_data_found then null;
  end;
  begin
    perform hub.content_workflow_source(kind, identity, 'edit');
    may_edit := true;
  exception when insufficient_privilege or no_data_found then null;
  end;
  authors := case
    when kind = 'selling_point' then hub.content_workflow_authors(kind, identity, source)
    when version ? 'editors' then array(select jsonb_array_elements_text(version->'editors')::uuid)
    else hub.content_workflow_authors(kind, identity, source)
  end;
  may_submit := may_edit and kind <> 'promotion' and case
    when kind in ('faq', 'section', 'article', 'selling_point') then state = 'DRAFT'
    when kind = 'question' then source->>'status' = 'proposed' and source->>'review_state' <> 'IN_REVIEW'
    when kind = 'unit_type' then source->>'status' = 'draft'
    when kind in ('price', 'disclosure', 'sales_term', 'programme', 'progress') then source->>'state' = 'draft'
    else (state <> 'APPROVED' or drift) and not exists (
      select 1 from hub.content_review_versions r
      where r.kind = content_workflow_read_core.kind and r.identity = content_workflow_read_core.identity and r.state = 'IN_REVIEW'
    )
  end;
  may_withdraw := case
    when kind = 'faq' and state = 'DRAFT' then may_edit and current_actor = any(authors)
    when kind in ('faq', 'section') then may_approve and state in ('DRAFT', 'IN_REVIEW', 'APPROVED')
    when kind = 'article' then may_approve and source->>'approved_version_id' is not null
    when kind in ('unit_type', 'price', 'disclosure', 'sales_term', 'programme', 'progress') then may_approve and state = 'APPROVED'
    when kind = 'selling_point' then may_approve and state = 'IN_REVIEW'
    when kind = 'question' then may_approve and source->>'status' in ('proposed', 'approved')
    when kind = 'promotion' then false
    else may_approve and state in ('IN_REVIEW', 'APPROVED')
  end;
  may_save_approve := may_edit and may_approve and kind <> 'promotion';
  if kind = 'asset' then
    may_save_approve := may_save_approve and hub.can('projects', 'edit') and exists (
      select 1 from hub.projects p
      where p.deleted_at is null
        and hub.content_scope_allowed('project', p.public_project_id, 'edit')
        and (
          exists (select 1 from hub.entity_assets a where a.project_id = p.id and a.asset_id = (source->>'id')::uuid and a.deleted_at is null)
          or exists (select 1 from hub.asset_links a where a.project_id = p.id and a.asset_id = (source->>'id')::uuid and a.deleted_at is null)
        )
    );
  end if;

  target_table := 'hub.' || hub.content_workflow_table(kind);
  if kind in ('faq', 'section', 'article', 'unit_type', 'price', 'disclosure', 'sales_term', 'programme', 'progress') then
    ver_table := case kind
      when 'faq' then 'hub.faq_versions'
      when 'section' then 'hub.content_section_versions'
      when 'article' then 'hub.article_versions'
      when 'unit_type' then 'hub.commercial_type_versions'
      when 'price' then 'hub.project_price_versions'
      else 'hub.project_commercial_versions'
    end;
    ver_fk_val := jsonb_build_object(
      case kind
        when 'faq' then 'faq_id'
        when 'section' then 'section_id'
        when 'article' then 'article_id'
        when 'unit_type' then 'commercial_type_id'
        when 'price' then 'price_id'
        else 'record_id'
      end,
      identity->'id'
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'operation', operation, 'actor', actor, 'occurred_at', occurred_at,
    'state', coalesce(after_row->>'state', after_row->>'status'),
    'reason', coalesce(after_row->>'decision_reason', reason),
    'self_approval', after_row->'self_approval',
    'staged_evidence', case when may_approve and after_row->>'staged_invalidated_at' is not null then
      jsonb_build_object(
        'approved', coalesce(after_row#>'{payload,_staged_values}', after_row->'staged_evidence') - '_disclosure_sources',
        'current', (after_row->'staged_current_values') - '_disclosure_sources'
      )
    end
  ) order by occurred_at desc), '[]')
  into history
  from (
    select * from (
      select distinct on (id) * from (
        (select * from audit.change_log a where a.table_name = target_table and a.after_row @> identity order by a.occurred_at desc limit 50)
        union all
        (select * from audit.change_log a where a.table_name = target_table and a.before_row @> identity order by a.occurred_at desc limit 50)
        union all
        (select * from audit.change_log a where a.table_name = 'hub.content_review_versions' and a.after_row @> jsonb_build_object('kind', kind, 'identity', identity) order by a.occurred_at desc limit 50)
        union all
        (select * from audit.change_log a where ver_table is not null and a.table_name = ver_table and a.after_row @> ver_fk_val order by a.occurred_at desc limit 50)
      ) candidates
      order by id
    ) deduped
    order by occurred_at desc
    limit 50
  ) records;

  return hub.content_exposure(kind, source, case when kind in ('faq', 'section', 'article') then version end) || jsonb_build_object(
    'exposure_target', nullif(hub.publication_workflow_descriptor(kind, identity)->'target', 'null'::jsonb) - 'version' || jsonb_build_object('field', 'ai_exposure'),
    'kind', kind, 'identity', identity, 'source_tab', source->>'_tab', 'expected_hash', hub.content_workflow_hash(source),
    'source_revision', case kind when 'asset' then source->'media_revision' when 'promotion' then source->'draft_revision' else source->'revision' end,
    'source_updated_at', case when kind in ('model', 'unit_type', 'price', 'disclosure', 'sales_term', 'programme', 'progress') then
      (select to_jsonb(p.updated_at) from hub.projects p where p.id = (source->>'project_id')::uuid) else source->'updated_at' end,
    'state', state, 'version_id', version->'id', 'version_no', coalesce(version->'version_no', version->'revision'),
    'approved_by', version->'approved_by', 'approved_at', version->'approved_at', 'decision_reason', version->'decision_reason',
    'self_approval', coalesce(version->'self_approval', 'false'),
    'history', history, 'needs_reapproval', version is not null and drift,
    'staged_evidence', case when may_approve then jsonb_build_object('approved', old_values, 'current', new_values) end,
    'can_edit', may_edit, 'can_approve', may_approve and kind <> 'promotion' and state = 'IN_REVIEW' and not drift,
    'can_submit', coalesce(may_submit, false), 'can_return', may_approve and kind <> 'promotion' and state = 'IN_REVIEW',
    'can_withdraw', coalesce(may_withdraw, false), 'can_save_approve', may_save_approve,
    'approval_requires_reason', may_approve and current_actor = any(authors), 'source_tabs', source->'_tabs'
  );
end $function$;

revoke all on function hub.content_workflow_read_core(text, jsonb, boolean) from public, hub_app, admin, editor, publisher, viewer, online_staff, agency, service_consumer;

create or replace function hub.content_workflow_read(kind text, identity jsonb)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select hub.content_workflow_read_core(kind, identity, true);
$function$;

create or replace function hub.content_workflow_items(level text, ref text, phase text default null::text, after_key text default null::text, page_size integer default 50)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  p hub.projects;
  brand uuid;
  unit_id uuid;
  source_view boolean := false;
  project_view boolean := false;
  faq_scope jsonb;
  scope_phase text;
  scope_ref text := ref;
  item record;
  metadata jsonb;
  descriptor jsonb;
  target jsonb;
  exp_target jsonb;
  items jsonb := '[]';
  cursor jsonb;
  after_item text;
  last_item text;
  has_more boolean := false;
begin
  if level is null or level not in ('corporate', 'business', 'brand', 'project', 'programme', 'project_group', 'unit_type')
     or ref is null or length(ref) not between 1 and 200 or page_size is null or page_size not between 1 and 100
     or length(coalesce(phase, '')) > 200 or length(coalesce(after_key, '')) > 8192
     or phase is not null and level not in ('project', 'unit_type') then
    raise exception 'Invalid saved-item query' using errcode = '23514';
  end if;
  source_view := hub.content_scope_allowed(level, ref, 'view');
  if source_view and level in ('project', 'unit_type') then p := hub.workspace_phase(level, ref, phase); end if;
  begin
    faq_scope := hub.workspace_faq_scope_access(level, ref, phase, 'view');
  exception when insufficient_privilege or no_data_found then faq_scope := null;
  end;
  if not source_view and faq_scope is null then perform hub.content_scope_access(level, ref, 'view'); end if;
  if p.id is null and level in ('project', 'unit_type') and faq_scope is not null then
    select * into p from hub.projects where id = (faq_scope#>>'{selected,id}')::uuid;
  end if;
  if level in ('project', 'unit_type') then
    if p.id is null then raise exception 'Saved-item phase not found' using errcode = 'P0002'; end if;
    scope_phase := p.rem_project_id;
    project_view := hub.content_scope_allowed('project', p.public_project_id, 'view');
  end if;
  if level = 'project' then scope_ref := p.public_project_id;
  elsif level = 'brand' then select id into brand from hub.brands where public_brand_id = ref and deleted_at is null;
  elsif level = 'unit_type' then select id into unit_id from hub.commercial_types where id::text = ref and project_id = p.id and deleted_at is null;
  end if;
  if after_key is not null then
    begin
      cursor := convert_from(decode(after_key, 'hex'), 'UTF8')::jsonb;
    exception when data_exception then raise exception 'Invalid saved-item cursor' using errcode = '23514';
    end;
    if jsonb_typeof(cursor) is distinct from 'object' or cursor - array['level', 'ref', 'phase', 'key'] <> '{}'
       or cursor->>'level' is distinct from level or cursor->>'ref' is distinct from ref
       or cursor->>'phase' is distinct from scope_phase or jsonb_typeof(cursor->'key') is distinct from 'string'
       or length(cursor->>'key') not between 1 and 800 then
      raise exception 'Saved-item cursor belongs to another scope' using errcode = '23514';
    end if;
    after_item := cursor->>'key';
  end if;

  for item in
    with own_bindings as materialized (
      select 'project_asset'::text kind, to_jsonb(a) value, a.asset_id from hub.entity_assets a
      where project_view and level = 'project' and a.project_id = p.id and a.deleted_at is null
      union all select 'type_asset', to_jsonb(a), a.asset_id from hub.commercial_type_assets a
      where project_view and a.project_id = p.id and a.deleted_at is null and (level = 'project' or level = 'unit_type' and a.commercial_type_id = unit_id)
      union all select 'asset_context', to_jsonb(a), a.asset_id from hub.asset_links a
      where project_view and a.project_id = p.id and a.deleted_at is null and (level = 'project' or level = 'unit_type' and a.target_type = 'commercial_type' and a.target_key = unit_id::text)
      union all select 'brand_asset', to_jsonb(a), a.asset_id from hub.brand_assets a
      where source_view and level = 'brand' and a.brand_id = brand and a.deleted_at is null
    ), own_clips as materialized (
      select m.* from hub.media_links m
      where project_view and m.project_id = p.id and m.state <> 'WITHDRAWN'
        and (level = 'project' or level = 'unit_type' and exists (
          select 1 from hub.media_link_targets t where t.media_link_id = m.id and t.target_type = 'commercial_type' and t.target_key = unit_id::text
        ))
    ), own_asset_ids as (
      select asset_id from own_bindings where asset_id is not null
      union
      select thumbnail_asset_id as asset_id from own_clips where thumbnail_asset_id is not null
    ), candidates as (
      select 'project'::text kind, to_jsonb(x) value from hub.projects x where project_view and level = 'project' and x.id = p.id and x.deleted_at is null
      union all select 'brand', to_jsonb(x) from hub.brands x where source_view and level = 'brand' and x.id = brand and x.deleted_at is null
      union all select 'model', to_jsonb(x) from hub.model_types x where project_view and level = 'project' and x.project_id = p.id and x.deleted_at is null and x.match_status <> 'REJECTED'
      union all select 'section', to_jsonb(x) from hub.content_sections x where source_view
        and (x.scope_type = level or level = 'project_group' and x.scope_type = 'rem_project_group') and x.scope_id = scope_ref
      union all select 'contact', to_jsonb(x) from hub.contacts x where source_view and x.scope_type = level and x.scope_id = scope_ref
      union all select 'faq', to_jsonb(x) from hub.faqs x where faq_scope is not null
        and (x.scope_type = level or level = 'project_group' and x.scope_type = 'rem_project_group')
        and x.scope_id = case when level = 'project' then p.rem_project_id else ref end
      union all select 'selling_point', to_jsonb(x) from (
        select distinct on (point_key) * from hub.project_selling_points
        where project_view and level = 'project' and project_id = p.id order by point_key, revision desc
      ) x
      union all select 'fact', to_jsonb(x) from hub.project_facts x where project_view and level = 'project' and x.project_id = p.id
      union all select 'building', to_jsonb(x) from hub.project_buildings x where project_view and level = 'project' and x.project_id = p.id
      union all select 'facility', to_jsonb(x) from hub.project_facilities x where project_view and level = 'project' and x.project_id = p.id
      union all select 'feature', to_jsonb(x) from hub.project_features x where project_view and level = 'project' and x.project_id = p.id
      union all select 'place', to_jsonb(x) from hub.project_places x where project_view and level = 'project' and x.project_id = p.id
      union all select 'solar', to_jsonb(x) from hub.solar_estimates x where project_view and level = 'project' and x.project_id = p.id and x.state <> 'withdrawn'
      union all select 'unit_type', to_jsonb(x) from hub.commercial_types x where project_view and x.project_id = p.id and x.deleted_at is null
        and (level = 'project' or level = 'unit_type' and x.id = unit_id)
      union all select 'price', to_jsonb(x) from hub.project_prices x where project_view and x.project_id = p.id
        and (level = 'project' or level = 'unit_type' and x.commercial_type_id = unit_id)
      union all select 'disclosure', to_jsonb(x) from hub.project_disclosures x where project_view and level = 'project' and x.project_id = p.id
      union all select 'sales_term', to_jsonb(x) from hub.project_sales_terms x where project_view and level = 'project' and x.project_id = p.id
      union all select 'programme', to_jsonb(x) from hub.project_programmes x where project_view and level = 'project' and x.project_id = p.id
      union all select 'progress', to_jsonb(x) from hub.project_progress x where project_view and level = 'project' and x.project_id = p.id
      union all select kind, value from own_bindings
      union all select 'asset', to_jsonb(x) from own_asset_ids ids join hub.assets x on x.id = ids.asset_id where x.deleted_at is null
      union all select 'media_link', to_jsonb(x) from own_clips x
      union all select 'media_target', to_jsonb(x) from hub.media_link_targets x join own_clips m on m.id = x.media_link_id
        where level = 'project' or level = 'unit_type' and x.target_type = 'commercial_type' and x.target_key = unit_id::text
    ), identified as (
      select kind, hub.content_workflow_identity(kind, value) identity from candidates
    ) select kind, identity, kind || ':' || identity::text key from identified order by key
  loop
    if after_item is not null and item.key <= after_item then continue; end if;
    begin
      metadata := hub.content_workflow_read_core(item.kind, item.identity, false);
      if not coalesce((metadata->>'can_submit')::boolean, false)
         or not (metadata->>'state' = 'DRAFT' or coalesce((metadata->>'needs_reapproval')::boolean, false)) then
        continue;
      end if;
      if jsonb_array_length(items) = page_size then has_more := true; exit; end if;
      descriptor := hub.publication_workflow_descriptor(item.kind, item.identity);
      target := descriptor->'target';
      exp_target := nullif(target, 'null'::jsonb) - 'version' || jsonb_build_object('field', 'ai_exposure');
      if target is not null and target <> 'null'::jsonb then
        target := target || jsonb_build_object('level', level, 'id', ref, 'phase', scope_phase);
      end if;
      items := items || jsonb_build_array(jsonb_build_object(
        'kind', item.kind, 'identity', item.identity,
        'expected_hash', metadata->'expected_hash', 'source_revision', metadata->'source_revision', 'source_updated_at', metadata->'source_updated_at',
        'ai_exposure', metadata->'ai_exposure', 'exposure_policy', metadata->'exposure_policy',
        'exposure_editor', metadata->'exposure_editor', 'exposure_target', exp_target,
        'state', metadata->'state', 'can_submit', metadata->'can_submit', 'can_edit', metadata->'can_edit',
        'source_tab', metadata->'source_tab', 'source_tabs', metadata->'source_tabs',
        'label', descriptor->'label', 'target', target, 'href', null
      ));
      last_item := item.key;
    exception when insufficient_privilege or no_data_found then continue;
    end;
  end loop;

  return jsonb_build_object(
    'scope', jsonb_build_object('level', level, 'id', ref, 'phase', scope_phase),
    'items', items,
    'next_cursor', case when has_more then encode(convert_to(jsonb_build_object('level', level, 'ref', ref, 'phase', scope_phase, 'key', last_item)::text, 'UTF8'), 'hex') end
  );
end $function$;

-- 11. Optimize hub.workspace_content_tasks: materialize hub.workspace_native_rows()
--     once per call instead of inside the per-version loop, and skip pure DRAFT rows
--     before evaluating approve permissions and audit author scans.
create or replace function hub.workspace_content_tasks(bud text default null::text, brand text default null::text)
returns setof jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  actor text := hub.workspace_require()::text;
  can_publish_web boolean := hub.can_special('knowledge', 'knowledge.publish_web');
  native_all jsonb;
  r jsonb;
  source jsonb;
  version jsonb;
  identity jsonb;
  kind text;
  state text;
  context jsonb;
  scope_type text;
  scope_id text;
  category text;
  base jsonb;
  dependency jsonb;
  native jsonb;
  can_review boolean;
  drift boolean;
  phases text[];
  table_name text;
  dependency_identity jsonb;
  authors jsonb;
begin
  return query select x from hub.publication_expiry_tasks(bud, brand) x where x->>'category' in ('expiring', 'review_due');
  select coalesce(jsonb_agg(n), '[]'::jsonb) into native_all from hub.workspace_native_rows() n;

  for r in
    select n || jsonb_build_object('kind', case n->>'kind' when 'construction_progress' then 'progress' else n->>'kind' end)
    from jsonb_array_elements(native_all) n
    where n->>'kind' in ('section', 'faq', 'unit_type', 'price', 'disclosure', 'sales_term', 'programme', 'construction_progress', 'article', 'question', 'promotion')
      and (n->>'kind' = 'promotion' or n->>'state' <> 'DRAFT' or exists (
        select 1 from hub.content_review_versions cv
        where cv.kind = (case n->>'kind' when 'construction_progress' then 'progress' else n->>'kind' end)
          and cv.identity = (case when n->>'kind' = 'question' then jsonb_build_object('question_key', n->>'item_id') else jsonb_build_object('id', n->>'item_id') end)
      ))
    union all
    select jsonb_build_object('kind', v.kind, 'identity', v.identity, 'version', to_jsonb(v))
    from (select distinct on (cv.kind, cv.identity) cv.* from hub.content_review_versions cv order by cv.kind, cv.identity, cv.version_no desc) v
    where v.state <> 'DRAFT'
    union all
    select jsonb_build_object('kind', 'selling_point', 'identity', hub.content_workflow_identity('selling_point', to_jsonb(p)), 'version', to_jsonb(p))
    from (select distinct on (project_id, point_key) * from hub.project_selling_points order by project_id, point_key, revision desc) p
    where p.state not in ('DRAFT', 'WITHDRAWN')
  loop
    begin
      kind := r->>'kind'; native := null;
      identity := case when r ? 'item_id' then case kind when 'question' then jsonb_build_object('question_key', r->>'item_id') else jsonb_build_object('id', r->>'item_id') end else r->'identity' end;
      source := hub.content_workflow_source(kind, identity, 'view');
      version := hub.content_workflow_version(kind, identity, source);
      if version is null and r->>'state' = 'RETURNED' then version := r->'version'; end if;
      if version is null then continue; end if;
      state := upper(coalesce(
        case when kind = 'question' then source->>'review_state' end,
        version->>'state',
        case when kind = 'question' and source->>'status' = 'approved' then 'APPROVED' end,
        'DRAFT'
      ));
      if version ? 'source_hash' and hub.content_workflow_payload(kind, version->'payload') - '_staged_values'
         is distinct from hub.content_workflow_payload(kind, source) - '_staged_values' then
        continue;
      end if;
      if upper(coalesce(source->>'state', source->>'status', '')) in ('WITHDRAWN', 'RETIRED') then continue; end if;
      if r ? 'context' then
        native := r;
      elsif kind in ('section', 'faq', 'unit_type', 'price', 'disclosure', 'sales_term', 'programme',
                     'construction_progress', 'article', 'question', 'glossary', 'asset', 'solar', 'promotion') then
        select n into native from jsonb_array_elements(native_all) n
        where n->>'kind' = kind and n->>'item_id' = coalesce(source->>'id', source->>'term_key') limit 1;
      end if;
      if state = 'DRAFT' and not (kind = 'promotion' and native->>'state' = 'IN_REVIEW') then continue; end if;
      context := coalesce(native->'context', hub.publication_task_context(kind, source));
      if context is null then continue; end if;
      scope_type := coalesce(native->>'scope_type', context->>'scope_type');
      scope_id := coalesce(native->>'scope_id', context->>'scope_id');
      phases := array(select jsonb_array_elements_text(coalesce(native->'phases', '[]')));
      if not hub.workspace_scope_matches_tab(scope_type, scope_id, phases, bud, brand, source->>'_tab') then continue; end if;
      drift := version->>'staged_invalidated_at' is not null or (
        (coalesce(nullif(version#>'{payload,_staged_values}', 'null'), nullif(version->'staged_evidence', 'null'), '{}') - '_disclosure_sources')
        is distinct from ((case when kind = 'disclosure' then hub.content_workflow_staged_values(kind, source || jsonb_build_object('_disclosure_sources', version#>'{staged_evidence,_disclosure_sources}')) else coalesce(source->'_staged_values', '{}') end) - '_disclosure_sources')
      );
      can_review := false;
      if state = 'IN_REVIEW' or (state = 'APPROVED' and drift) or kind = 'promotion' then
        begin
          perform hub.content_workflow_source(kind, identity, 'approve');
          can_review := true;
        exception when insufficient_privilege or no_data_found then can_review := false;
        end;
      end if;
      authors := '[]'::jsonb;
      if state = 'RETURNED' or kind = 'promotion' then
        authors := case when kind = 'selling_point' then to_jsonb(hub.content_workflow_authors(kind, identity, source)) else coalesce(version->'editors', to_jsonb(hub.content_workflow_authors(kind, identity, source))) end;
      end if;
      if kind = 'promotion' then
        authors := coalesce(source->'editors', '[]') || coalesce(native->'reviewers', '[]');
        can_review := can_review and not (authors ? actor);
        if state = 'DRAFT' and native->>'state' = 'IN_REVIEW' then state := 'IN_REVIEW'; end if;
      end if;
      category := case
        when state = 'RETURNED' and authors ? actor then 'returned'
        when can_review and (state = 'IN_REVIEW' or state = 'APPROVED' and drift) then 'approval'
      end;
      if category is null and state = 'APPROVED' and not drift and can_publish_web then
        begin
          perform hub.publication_actor();
          if kind = 'promotion' then
            perform hub.publication_promotion_check((source->>'id')::uuid, (source->>'draft_revision')::integer, hub.promotion_payload((source->>'id')::uuid));
            if not exists (
              select 1 from hub.public_promotions p join hub.promotion_versions v on v.id = p.published_version_id
              where p.id = (source->>'id')::uuid and v.draft_revision = (source->>'draft_revision')::integer
            ) then category := 'publish'; end if;
          else
            table_name := case kind
              when 'faq' then 'faq_versions' when 'section' then 'content_section_versions' when 'article' then 'article_versions'
              when 'unit_type' then 'commercial_type_versions' when 'price' then 'project_price_versions'
              when 'disclosure' then 'project_commercial_versions' when 'sales_term' then 'project_commercial_versions'
              when 'programme' then 'project_commercial_versions' when 'progress' then 'project_commercial_versions'
              else hub.content_workflow_table(kind)
            end;
            dependency_identity := case
              when table_name in ('faq_versions', 'content_section_versions', 'article_versions', 'commercial_type_versions', 'project_price_versions', 'project_commercial_versions') then jsonb_build_object('id', version->>'id')
              when kind = 'selling_point' then identity || jsonb_build_object('revision', source->'revision')
              else identity
            end;
            dependency := hub.web_dependency(table_name, dependency_identity, source->>'_tab');
            perform hub.publication_dependency_check(dependency, true, true);
            if (native is null or coalesce((native->>'ready')::boolean, false) and coalesce((native->>'current_material')::boolean, false))
               and hub.publication_task_native_ready(kind, source, version) and not hub.publication_task_published(dependency) then
              category := 'publish';
            end if;
          end if;
        exception when insufficient_privilege or no_data_found or check_violation or serialization_failure then category := null;
        end;
      end if;
      if category is null then continue; end if;
      base := jsonb_build_object(
        'kind', case when kind = 'progress' then 'construction_progress' else kind end,
        'item_id', coalesce(r->>'item_id', source->>'id', source->>'point_key', source->>'question_key', source->>'term_key', source->>'building_key', source->>'facility_code'),
        'version_id', case when kind not in ('question', 'promotion') then version->'id' end,
        'version_no', coalesce(version->'version_no', version->'revision', source->'draft_revision'),
        'source_tab', source->>'_tab', 'scope_type', scope_type, 'scope_id', scope_id,
        'label', coalesce(native->'label', source->'public_name', source->'label', source->'title', source->'name', jsonb_build_object('th', coalesce(source->>'fact_key', source->>'building_key', source->>'facility_code', source->>'page_key', kind))),
        'state', state, 'identity', identity, 'expected_hash', hub.content_workflow_hash(source), 'needs_reapproval', drift,
        'context', context || jsonb_strip_nulls(jsonb_build_object('version', case when kind not in ('question', 'promotion') then version->'id' end, 'revision', coalesce(version->'version_no', version->'revision', source->'draft_revision'))),
        'decision_reason', coalesce(version->'decision_reason', source->'decision_reason', source->'return_reason')
      );
      return next base || jsonb_build_object('id', category || ':' || kind || ':' || hub.web_hash(identity) || ':' || coalesce(version->>'id', version->>'revision', source->>'draft_revision'), 'category', category);
    exception when insufficient_privilege or no_data_found then continue;
    end;
  end loop;
end $function$;

-- 12. Optimize hub.publication_queue_read: skip building full residential_payload
--     for draft projects/brands that have no APPROVED certificate in content_review_versions.
create or replace function hub.publication_queue_read()
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  page hub.web_pages;
  candidate record;
  prepared jsonb;
  source jsonb;
  payload jsonb;
  readiness jsonb;
  items jsonb := '[]';
  previous jsonb;
begin
  perform hub.require_permission('knowledge', 'view');
  for page in select * from hub.web_pages p where hub.publication_page_visible(p) order by page_key loop
    prepared := hub.publication_enrich(hub.web_compose(page));
    select v.payload into previous from hub.entity_versions v where id = page.published_version_id;
    readiness := hub.publication_sanitize(prepared, previous, false);
    if (readiness->>'accepted')::integer > 0 then
      items := items || jsonb_build_array(
        jsonb_build_object(
          'system', 'web', 'page_key', page.page_key, 'items', readiness->'outcomes',
          'previous_version_id', page.published_version_id, 'hash', hub.web_hash(prepared)
        ) || hub.publication_workflow_descriptor('page_config', jsonb_build_object('id', page.id))
      );
    end if;
  end loop;

  for candidate in
    select 'brand'::text as entity_type, b.id as entity_id, b.public_brand_id as public_id,
           b.updated_at as expected_updated_at, null::integer as expected_revision, b.published_version_id as expected_published_version_id
    from hub.brands b
    where b.deleted_at is null
      and exists (
        select 1 from hub.content_review_versions v
        where v.kind = 'brand' and v.identity = jsonb_build_object('id', b.id::text)
          and v.state = 'APPROVED' and v.staged_invalidated_at is null and v.approved_by is not null
      )
    union all
    select 'project'::text, p.id, p.public_project_id, p.updated_at, null::integer, p.published_version_id
    from hub.projects p
    where p.deleted_at is null
      and exists (
        select 1 from hub.content_review_versions v
        where v.kind = 'project' and v.identity = jsonb_build_object('id', p.id::text)
          and v.state = 'APPROVED' and v.staged_invalidated_at is null and v.approved_by is not null
      )
    union all
    select 'promotion'::text, pr.id, pr.code, pr.updated_at, pr.draft_revision, pr.published_version_id
    from hub.public_promotions pr
    order by 1, 3
  loop
    begin
      source := hub.content_workflow_source(candidate.entity_type, jsonb_build_object('id', candidate.entity_id), 'view');
      if candidate.entity_type = 'promotion' then
        payload := hub.promotion_payload(candidate.entity_id);
        readiness := hub.promotion_readiness(payload);
        if source->'returned_revision' = source->'draft_revision' or not (readiness->>'ready')::boolean then
          continue;
        end if;
      else
        payload := hub.residential_payload(candidate.entity_type, candidate.entity_id, false);
        for prepared in select * from jsonb_array_elements(hub.publication_legacy_dependencies(candidate.entity_type, candidate.entity_id, payload)) loop
          perform hub.publication_dependency_check(prepared, false, true);
        end loop;
      end if;
      items := items || jsonb_build_array(
        jsonb_build_object(
          'system', 'release',
          'entity_type', candidate.entity_type,
          'entity_id', candidate.entity_id,
          'public_id', candidate.public_id,
          'expected_updated_at', case when candidate.entity_type <> 'promotion' then candidate.expected_updated_at end,
          'expected_revision', candidate.expected_revision,
          'expected_published_version_id', candidate.expected_published_version_id
        ) || hub.publication_workflow_descriptor(candidate.entity_type, jsonb_build_object('id', candidate.entity_id))
      );
    exception when insufficient_privilege or check_violation or serialization_failure or no_data_found then
      null;
    end;
  end loop;

  return jsonb_build_object(
    'items', items,
    'web_history', hub.web_workspace()->'publications',
    'release_history', hub.release_read(null)->'items',
    'can_publish', hub.can_special('knowledge', 'knowledge.publish_web')
  );
end $function$;

-- 13. Set-based hub.project_content_readiness_before_media & pushed-down
--     hub.workspace_missing_fact_cells so hub.workspace_home runs in sub-second time.
create or replace function hub.project_content_readiness_before_media(public_id text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  p hub.projects;
  p_json jsonb;
  form text;
  rem jsonb;
  units numeric;
  regular numeric;
  tandem numeric;
  buildings integer;
  floors integer;
  phases integer;
  computed jsonb;
  today date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  points integer;
  items jsonb;
begin
  perform hub.content_scope_access('project', public_id, 'view');
  select * into p from hub.projects where public_project_id = public_id and deleted_at is null;
  p_json := to_jsonb(p);
  select case when count(distinct product_form) = 1 then min(product_form) end into form
  from hub.commercial_types where project_id = p.id and deleted_at is null;

  rem := hub.content_rem_values(p.id);
  select
    max(value_number) filter (where fact_key = 'project.unit_total'),
    max(value_number) filter (where fact_key = 'project.parking_regular'),
    max(value_number) filter (where fact_key = 'project.parking_tandem')
  into units, regular, tandem
  from hub.project_facts
  where project_id = p.id and grain = 'project'
    and fact_key in ('project.unit_total', 'project.parking_regular', 'project.parking_tandem');

  select nullif(count(*), 0), case when count(*) filter (where floors_above is null) = 0 then max(floors_above) end
  into buildings, floors
  from hub.project_buildings where project_id = p.id;

  if nullif(rem->>'group_id', '') is not null then
    select count(*) into phases from staging.dw_projects where (source_record->>'rem_project_group_id') = (rem->>'group_id');
  end if;

  computed := jsonb_build_object(
    'phase_count', phases,
    'building_count', buildings,
    'floors_max', floors,
    'parking_pct_regular', round(regular / nullif(units, 0) * 100, 2),
    'parking_pct_total', round((regular + tandem) / nullif(units, 0) * 100, 2)
  );

  with active_sections as materialized (
    select s.section_key, s.id, v.body
    from hub.content_sections s
    join lateral (select body from hub.content_section_versions where section_id = s.id order by version_no desc limit 1) v on true
    where s.scope_type = 'project' and s.scope_id = public_id and s.state <> 'WITHDRAWN'
  ),
  active_facts as materialized (
    select fact_key, as_of, valid_to
    from hub.project_facts
    where project_id = p.id and grain = 'project'
  ),
  current_points as materialized (
    select * from (
      select distinct on (point_key) * from hub.project_selling_points
      where project_id = p.id order by point_key, revision desc
    ) cp where cp.state <> 'WITHDRAWN'
  ),
  part1 as (
    select
      row_number() over (order by fc.entity, fc.section, fc.sort, fc.field_key) as ord,
      jsonb_build_object(
        'field_key', fc.field_key,
        'label', fc.label,
        'required', (
          coalesce(fc.required_for->>form, fc.required_for->>'all', 'optional') = 'required'
          or (form is null and exists (select 1 from jsonb_each_text(fc.required_for) where value = 'required'))
        ),
        'complete', coalesce(
          case
            when fc.entity = 'section' then
              sec.id is not null and hub.translation_complete('section', sec.id::text, fc.field_key, sec.body)
            when fc.section = 'facts' then
              case
                when fc.source_policy = 'computed' then
                  computed->split_part(fc.field_key, '.', 2) is not null and computed->split_part(fc.field_key, '.', 2) <> 'null'::jsonb
                when fc.source_policy = 'rem' then
                  nullif(rem->>'project_status', '') is not null
                else
                  af.fact_key is not null and af.as_of is not null
                  and (af.valid_to is null or af.valid_to >= today)
                  and (fc.review_every_days is null or af.as_of + fc.review_every_days >= today)
              end
            else
              case
                when 'en' = any(fc.locales_required) then
                  hub.translation_complete('project', p.id::text, fc.field_key, p_json->split_part(fc.field_key, '.', 2))
                else
                  btrim(coalesce((p_json->split_part(fc.field_key, '.', 2))->>'th', '')) <> ''
              end
          end,
          false
        ),
        'owner_role', fc.owner_role,
        'review_every_days', fc.review_every_days,
        'surfaces', fc.surfaces
      ) as item
    from hub.field_catalog fc
    left join active_sections sec on fc.entity = 'section' and sec.section_key = fc.field_key
    left join active_facts af on fc.entity = 'project' and fc.section = 'facts' and af.fact_key = fc.field_key
    where fc.status = 'active' and fc.entity in ('project', 'section') and fc.field_key not like 'section.corporate_%'
  ),
  part2 as (
    select 100000 as ord, jsonb_build_object(
      'field_key', 'selling_point.count',
      'label', '{"th":"จุดขาย 3–6 ข้อ"}'::jsonb,
      'required', true,
      'complete', (select count(*) from current_points) between 3 and 6
    ) as item
  ),
  part3 as (
    select
      200000 + row_number() over (order by cp.point_key, fc.field_key) as ord,
      jsonb_build_object(
        'field_key', fc.field_key,
        'point_key', cp.point_key,
        'label', fc.label,
        'required', coalesce(fc.required_for->>'all', 'optional') = 'required',
        'complete', coalesce(hub.translation_complete('selling_point', cp.point_key::text, fc.field_key, to_jsonb(cp)->split_part(fc.field_key, '.', 2)), false)
      ) as item
    from current_points cp
    cross join hub.field_catalog fc
    where fc.entity = 'selling_point' and fc.status = 'active' and 'en' = any(fc.locales_required)
  ),
  part4 as (
    select
      300000 + row_number() over (order by b.building_key) as ord,
      jsonb_build_object(
        'field_key', fc.field_key,
        'building_key', b.building_key,
        'label', jsonb_build_object('th', coalesce(b.name->>'th', 'อาคาร') || ' · ชื่อและภาษาอังกฤษ'),
        'required', fc.required_for->>'all' = 'required',
        'complete', coalesce(hub.translation_complete('building', p.id::text || ':' || b.building_key, fc.field_key, b.name), false)
      ) as item
    from hub.project_buildings b
    join hub.field_catalog fc on fc.field_key = 'building.name' and fc.status = 'active'
    where b.project_id = p.id
  ),
  all_parts as (
    select ord, item from part1
    union all select ord, item from part2
    union all select ord, item from part3
    union all select ord, item from part4
  )
  select coalesce(jsonb_agg(item order by ord), '[]'::jsonb) into items from all_parts;

  return jsonb_build_object(
    'items', items,
    'ready', not exists (select 1 from jsonb_array_elements(items) i where (i->>'required')::boolean and not (i->>'complete')::boolean),
    'required_missing', (select count(*) from jsonb_array_elements(items) i where (i->>'required')::boolean and not (i->>'complete')::boolean),
    'recommended_complete', (select count(*) from jsonb_array_elements(items) i where not (i->>'required')::boolean and (i->>'complete')::boolean),
    'mode', 'PRIVATE_DRAFT',
    'published', false,
    'product_form', form
  );
end $function$;

create or replace function hub.workspace_missing_fact_cells(project_uuid uuid, unit_public_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  _p hub.projects;
  _unit_uuid uuid;
  _form text;
  _brand_ref text;
  _group_ref text;
  _today date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  _cells jsonb := '[]'::jsonb;
  _winner_list jsonb := '[]'::jsonb;
  _needed_keys text[] := '{}'::text[];
  _avail_map jsonb := '{}'::jsonb;
  _key text;
  _slot jsonb;
  _missing text[];
  _q_rec jsonb;
begin
  select * into _p from hub.projects where id = project_uuid and deleted_at is null;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  if unit_public_id is not null then
    select id into _unit_uuid from hub.commercial_types
    where project_id = _p.id and public_commercial_type_id = unit_public_id and deleted_at is null;
    if not found then
      raise exception 'Unit type does not belong to this project' using errcode = 'P0002';
    end if;
  end if;

  _form := case when _unit_uuid is null then hub.faq_project_form(_p.id)
                else (select product_form from hub.commercial_types where id = _unit_uuid) end;
  _group_ref := hub.content_rem_values(_p.id)->>'group_id';
  select public_brand_id into _brand_ref from hub.brands where id = _p.brand_id and deleted_at is null;

  with candidate_faqs as (
    select f.id as faq_id, f.scope_type, f.scope_id, f.state as faq_state
    from hub.faqs f
    where f.state <> 'WITHDRAWN'
      and (
        (f.scope_type = 'unit_type' and _unit_uuid is not null and f.scope_id = _unit_uuid::text)
        or (f.scope_type = 'project' and f.scope_id = _p.rem_project_id)
        or (f.scope_type = 'project_group' and _group_ref is not null and f.scope_id = _group_ref)
        or (f.scope_type = 'programme')
        or (f.scope_type = 'brand' and _brand_ref is not null and f.scope_id = _brand_ref)
        or (f.scope_type = 'corporate')
        or (f.scope_type = 'business' and hub.business_project_matches(f.scope_id, _p.rem_project_id))
      )
  ),
  active_candidates as (
    select
      cf.faq_id, cf.scope_type, cf.scope_id, cf.faq_state,
      v.id as version_id, v.version_no, v.question_key, v.state as version_state,
      v.fact_keys, v.applies_to_project_ids, v.applicability_rule,
      v.review_due, v.effective_to, v.ai_exposure,
      hub.faq_scope_rank(cf.scope_type) as rank
    from candidate_faqs cf
    join lateral (
      select * from hub.faq_versions x where x.faq_id = cf.faq_id order by x.version_no desc limit 1
    ) v on v.state <> 'WITHDRAWN'
  ),
  eligible_questions as (
    select
      qk.question_key, qk.question_template, qk.ai_exposure as q_ai_exposure,
      qk.fact_keys as q_fact_keys, qk.show_on_project_pages, qk.web_sort
    from hub.faq_questions qk
    where qk.status = 'approved'
      and (cardinality(qk.property_types) > 0 and (_form is null or not _form = any(qk.property_types))) is not true
  ),
  resolved_candidates as materialized (
    select
      eq.question_key, eq.question_template, eq.q_ai_exposure, eq.q_fact_keys, eq.web_sort,
      c.faq_id, c.version_id, c.version_no, c.scope_type, c.rank,
      c.fact_keys as c_fact_keys, c.review_due, c.effective_to, c.ai_exposure as c_ai_exposure,
      c.applicability_rule,
      case
        when c.applicability_rule is not null and c.applicability_rule <> '{}'::jsonb
        then hub.faq_rule_projects(c.applicability_rule, c.scope_type, c.scope_id)
        else c.applies_to_project_ids
      end as phase_ids
    from eligible_questions eq
    join active_candidates c on c.question_key = eq.question_key
    where (c.scope_type <> 'corporate' or eq.show_on_project_pages)
  ),
  matched_candidates as (
    select
      rc.question_key, rc.question_template, rc.q_ai_exposure, rc.q_fact_keys, rc.web_sort,
      rc.faq_id, rc.version_id, rc.version_no, rc.scope_type, rc.rank,
      rc.c_fact_keys, rc.review_due, rc.effective_to, rc.c_ai_exposure
    from resolved_candidates rc
    where ((_p.rem_project_id = any(rc.phase_ids))
       or (rc.scope_type = 'corporate' and cardinality(rc.phase_ids) = 0 and rc.applicability_rule = '{}'::jsonb)) is distinct from false
  ),
  ranked as (
    select
      mc.*,
      max(mc.rank) over (partition by mc.question_key) as max_rank,
      count(*) over (partition by mc.question_key, mc.rank) as rank_count
    from matched_candidates mc
  ),
  winners as (
    select *
    from ranked
    where rank = max_rank and rank_count = 1
      and (c_ai_exposure is distinct from 'internal')
      and (q_ai_exposure is distinct from 'internal')
      and (effective_to is null or effective_to >= _today)
      and (review_due is null or review_due >= _today)
  ),
  winner_keys as (
    select
      w.question_key,
      w.question_template->>'th' as question_label,
      w.web_sort,
      array(
        select distinct u.k
        from unnest(coalesce(w.c_fact_keys, '{}'::text[]) || coalesce(w.q_fact_keys, '{}'::text[])) as u(k)
        order by u.k
      ) as keys
    from winners w
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'question_key', wk.question_key,
      'question_label', wk.question_label,
      'web_sort', wk.web_sort,
      'combined_keys', to_jsonb(wk.keys)
    ) order by wk.web_sort, wk.question_key
  ), '[]'::jsonb)
  into _winner_list
  from winner_keys wk
  where cardinality(wk.keys) > 0;

  if jsonb_array_length(_winner_list) = 0 then
    return jsonb_build_object('cells', '[]'::jsonb);
  end if;

  select coalesce(array_agg(distinct elem.k order by elem.k), '{}'::text[])
  into _needed_keys
  from (
    select jsonb_array_elements_text(w->'combined_keys') as k
    from jsonb_array_elements(_winner_list) w
  ) elem;

  foreach _key in array _needed_keys loop
    _slot := hub.faq_fact_slot(_p.id, _key, 'th', unit_public_id, false);
    _avail_map := _avail_map || jsonb_build_object(jsonb_build_array(_key)::text, coalesce((_slot->>'available')::boolean, false));
  end loop;

  for _q_rec in select value from jsonb_array_elements(_winner_list) loop
    _missing := '{}'::text[];
    for _key in select jsonb_array_elements_text(_q_rec->'combined_keys') loop
      if not coalesce((_avail_map->>(jsonb_build_array(_key)::text))::boolean, false) then
        _missing := array_append(_missing, _key);
      end if;
    end loop;
    if cardinality(_missing) > 0 then
      _cells := _cells || jsonb_build_array(jsonb_build_object(
        'question_key', _q_rec->>'question_key',
        'question_label', _q_rec->>'question_label',
        'state', 'waiting_for_fact',
        'missing_fact_keys', to_jsonb(_missing)
      ));
    end if;
  end loop;

  return jsonb_build_object('cells', _cells);
end $function$;

-- 14. Fast off-page required_missing summary for hub.workspace_home + lightweight project summaries
create or replace function hub.project_required_missing_summary(public_id text)
returns integer
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  project_uuid uuid;
  content_missing integer;
  media_missing integer;
begin
  perform hub.content_scope_access('project', public_id, 'view');
  select id into project_uuid from hub.projects where public_project_id = public_id and deleted_at is null;
  content_missing := (hub.project_content_readiness_before_media(public_id)->>'required_missing')::integer;
  with active_blocking_rules as materialized (
    select * from hub.media_requirements where status = 'active' and blocks_publish
  ),
  contexts as materialized (
    select 'project'::text per, 'project'::text kind, project_uuid::text key, null::integer floor
    where exists (select 1 from active_blocking_rules where per = 'project')
    union all
    select 'facility_present', 'facility', f.facility_code, null
    from hub.project_facilities f
    where exists (select 1 from active_blocking_rules where per = 'facility_present')
      and f.project_id = project_uuid and f.status = 'present'
    union all
    select 'commercial_type', 'commercial_type', id::text, null
    from hub.commercial_types
    where exists (select 1 from active_blocking_rules where per = 'commercial_type')
      and project_id = project_uuid and deleted_at is null
    union all
    select 'type_storey', 'commercial_type', t.id::text, f
    from hub.commercial_types t
    cross join lateral generate_series(1, case when t.storeys is not null then least(t.storeys, 200) end) f
    where exists (select 1 from active_blocking_rules where per = 'type_storey')
      and t.project_id = project_uuid and t.deleted_at is null and t.product_form in ('house', 'townhome')
    union all
    select 'building_floor', 'building_floor', b.building_key, f
    from hub.project_buildings b
    cross join lateral generate_series(1, case when b.floors_above is not null then least(b.floors_above, 200) end) f
    where exists (select 1 from active_blocking_rules where per = 'building_floor')
      and b.project_id = project_uuid and not f = any(b.skip_floors)
    union all
    select 'active_promotion', 'promotion', promo.id::text, null
    from hub.public_promotions promo
    where exists (select 1 from active_blocking_rules where per = 'active_promotion')
      and promo.starts_at <= now() and promo.ends_at > now() and hub.can('promotions', 'view')
      and exists (select 1 from hub.promotion_target_projects(promo.id) scope where scope.id = project_uuid)
    union all
    select 'under_construction', 'project', project_uuid::text, null
    where exists (select 1 from active_blocking_rules where per = 'under_construction')
      and exists (
        select 1 from hub.projects p join staging.dw_projects s on s.rem_project_id = p.rem_project_id
        where p.id = project_uuid
          and lower(s.source_record->>'project_status_detail') in ('under_construction', 'construction', 'กำลังก่อสร้าง', 'อยู่ระหว่างก่อสร้าง')
      )
  ),
  raw_bindings as (
    select asset_id, target_type kind, target_key key, usage, floor_from, floor_to, effective_from, effective_to, room_tag
    from hub.asset_links
    where project_id = project_uuid and deleted_at is null
      and (target_type <> 'promotion' or hub.media_target(project_id, target_type, target_key, 'view'))
    union all
    select l.asset_id, l.target_type kind, l.target_key key, l.usage, l.floor_from, l.floor_to, l.effective_from, l.effective_to, l.room_tag
    from hub.asset_links l
    where l.target_type = 'promotion' and l.project_id <> project_uuid and l.deleted_at is null
      and exists (select 1 from active_blocking_rules where per = 'active_promotion')
      and exists (select 1 from hub.promotion_target_projects(l.target_key::uuid) scope where scope.id = project_uuid)
      and hub.media_target(l.project_id, l.target_type, l.target_key, 'view')
    union all
    select asset_id, 'project', project_uuid::text, asset_role, null, null, effective_from, effective_to, null
    from hub.entity_assets
    where project_id = project_uuid and model_id is null and deleted_at is null
      and (asset_role not in ('hero', 'thumbnail') or is_primary)
    union all
    select asset_id, 'commercial_type', commercial_type_id::text,
      case asset_role when 'floor_plan' then 'unit_plan' when 'model_image' then 'interior' else asset_role end,
      floor_number, floor_number, null, null, room_tag
    from hub.commercial_type_assets
    where project_id = project_uuid and deleted_at is null
  ),
  bound_assets as materialized (
    select
      b.asset_id, b.kind, b.key, b.usage, b.floor_from, b.floor_to, b.room_tag,
      a.media_category, a.taken_at,
      coalesce((select array_agg(mt.tag_code) from hub.asset_media_tags mt where mt.asset_id = a.id), '{}'::text[]) as asset_tags
    from raw_bindings b
    join hub.assets a on a.id = b.asset_id
    where a.deleted_at is null
      and a.media_category is distinct from 'legal_document'
      and a.rights_status = 'approved'
      and (a.effective_from is null or a.effective_from <= now())
      and (a.effective_to is null or a.effective_to > now())
      and (b.effective_from is null or b.effective_from <= now())
      and (b.effective_to is null or b.effective_to > now())
  )
  select count(*) into media_missing
  from active_blocking_rules r
  join contexts c on c.per = r.per
  where (
    select count(distinct b.asset_id)
    from bound_assets b
    where b.kind = c.kind and b.key = c.key
      and (r.media_category is null or b.media_category = r.media_category or b.media_category is null and b.usage = r.media_category)
      and (r.usage is null or b.usage = r.usage)
      and (c.floor is null or c.floor between b.floor_from and coalesce(b.floor_to, b.floor_from))
      and (r.max_age_days is null or b.taken_at between current_date - r.max_age_days and current_date)
      and not exists (
        select 1 from unnest(r.tags) t(code)
        where t.code is distinct from b.room_tag and not (t.code = any(b.asset_tags))
      )
  ) < r.min_count;

  perform hub.content_scope_access('project', public_id, 'view');
  return coalesce(content_missing, 0) + coalesce(media_missing, 0);
end $function$;

revoke all on function hub.project_required_missing_summary(text) from public, hub_app, admin, editor, publisher, viewer, online_staff, agency, service_consumer;

do $$
declare
  d text;
begin
  d := replace(pg_get_functiondef('hub.workspace_home(text,text,integer,integer,text,uuid)'::regprocedure), chr(13), '');
  d := hub.content_definition_replace(
    d,
    'readiness:=hub.project_content_readiness(p.public_project_id)-''items'';',
    'readiness:=jsonb_build_object(''required_missing'',hub.project_required_missing_summary(p.public_project_id));'
  );
  execute d;
end $$;

create or replace function hub.list_project_summaries()
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  perform hub.require_permission('projects', 'view');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'public_project_id', p.public_project_id,
      'rem_project_id', p.rem_project_id,
      'public_name', p.public_name,
      'source_name', s.project_name_rem,
      'brand_id', p.brand_id
    ) order by p.public_project_id)
    from hub.content_project_rows('projects') p
    left join staging.rem_projects s on s.rem_project_id = p.rem_project_id
    where p.deleted_at is null and hub.content_scope_allowed('project', p.public_project_id, 'view')
  ), '[]'::jsonb);
end $function$;

revoke all on function hub.list_project_summaries() from public, admin, editor, publisher, viewer, online_staff, agency, service_consumer;
grant execute on function hub.list_project_summaries() to hub_app;

-- 11. Deny machine service_consumer accounts from human self-profile/avatar RPCs
do $$
declare
  fn text;
  d text;
begin
  foreach fn in array array[
    'hub.update_own_profile(jsonb)',
    'hub.set_own_avatar(text,text,text,integer)',
    'hub.clear_own_avatar()'
  ] loop
    d := replace(pg_get_functiondef(fn::regprocedure), chr(13), '');
    d := hub.content_definition_replace(
      d,
      'if not found or a.anonymised_at is not null then',
      'if not found or a.anonymised_at is not null or coalesce(a.hub_role, '''') = ''service_consumer'' then'
    );
    execute d;
  end loop;
  d := replace(pg_get_functiondef('hub.read_avatar_metadata(uuid)'::regprocedure), chr(13), '');
  d := hub.content_definition_replace(
    d,
    'if not found or me.anonymised_at is not null then',
    'if not found or me.anonymised_at is not null or coalesce(me.hub_role, '''') = ''service_consumer'' then'
  );
  execute d;
end $$;

commit;
