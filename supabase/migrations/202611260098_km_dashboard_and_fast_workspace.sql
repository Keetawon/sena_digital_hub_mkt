-- Migration 0098: Fast workspace/history/promotion projections + Personal Dashboard & KM Card summaries
-- 1. Eliminates O(N*M) full-table scans in hub.workspace_promotion_rows (banner lookup),
--    hub.workspace_native_rows_before_scopes (asset expiry prefilter & single promotion readiness),
--    and hub.content_history (GIN-targeted candidate_ids across all entity kinds).
-- 2. Enables 'data' tab on 'programme' and 'project_group' in hub.workspace_page when caller has knowledge.view.
-- 3. Adds additive summary fields for the Personal Action Dashboard (hub.workspace_home: task_counts,
--    scope_summary, project card metrics/cover_image) and the 4 Modern Visual KM Card Hubs
--    (hub.brand_completeness, hub.progress_rows, hub.workspace_tree scope_summaries) without changing
--    any function signature, ACL, or existing response keys.

begin;

-- 1. Supporting indexes for fast card cover-photo & scope summary lookups
create index if not exists entity_assets_project_cover_idx
  on hub.entity_assets (project_id, asset_role, is_primary desc)
  where deleted_at is null and model_id is null;

create index if not exists asset_links_project_cover_idx
  on hub.asset_links (project_id, usage, sort, id)
  where deleted_at is null;

create index if not exists content_sections_scope_active_idx
  on hub.content_sections (scope_type, scope_id)
  where state <> 'WITHDRAWN';

create index if not exists contacts_scope_lookup_idx
  on hub.contacts (scope_type, scope_id);

-- 2. Fix hub.workspace_promotion_rows: indexed banner candidate lookup + materialized live_promos
create or replace function hub.workspace_promotion_rows(kind text, ref text, phase text)
returns setof jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  selected hub.projects;
  projects uuid[];
  brand uuid;
begin
  perform hub.require_permission('promotions', 'view');
  if kind is null or kind not in ('project', 'brand', 'project_group', 'corporate') or kind <> 'project' and phase is not null then
    raise exception 'Invalid promotion page context' using errcode = '22023';
  end if;
  perform hub.content_scope_access(kind, ref, 'view');
  perform hub.require_permission('projects', 'view');
  if kind = 'project' then
    selected := hub.workspace_phase(kind, ref, phase);
    if selected.id is null then raise exception 'Project phase not found' using errcode = 'P0002'; end if;
    projects := array[selected.id];
  else
    select id into brand from hub.brands where public_brand_id = ref and deleted_at is null;
    projects := hub.workspace_projects(kind, ref);
  end if;

  return query
  with live_promos as materialized (
    select live.promotion_id, live.project_id, live.payload
    from public_api.promotions live
    where live.project_id = any(projects)
  ),
  scoped as materialized (
    select
      p.*,
      v.payload as published,
      hub.promotion_payload(p.id) as draft,
      exists (select 1 from hub.promotion_target_projects(p.id) s where s.id = any(projects)) as draft_applies,
      exists (
        select 1 from hub.projects x
        where x.id = any(projects)
          and coalesce(v.payload->'target_project_ids', jsonb_build_array(v.payload->>'public_project_id')) ? x.public_project_id
      ) as published_applies,
      exists (select 1 from live_promos live where live.promotion_id = p.id) as active,
      exists (select 1 from hub.promotion_versions old where old.promotion_id = p.id) as was_published
    from hub.public_promotions p
    left join hub.promotion_versions v on v.id = p.published_version_id
    where hub.promotion_scope_visible(p.id)
  ),
  included as (
    select s.*, case when active then published else draft end as display
    from scoped s
    where draft_applies or published_applies or owning_brand_id = brand
      or kind = 'project_group' and owning_project_group_id = ref
      or kind = 'corporate' and promotion_tier in ('campaign', 'corporate')
  )
  select jsonb_build_object(
    'id', s.id, 'code', s.code, 'title', s.display->'title',
    'project_id', s.project_id, 'owning_brand_id', s.owning_brand_id, 'owning_project_group_id', s.owning_project_group_id,
    'promotion_tier', s.promotion_tier, 'applies_via', s.promotion_tier,
    'can_edit', hub.content_source_allowed('public_promotions', to_jsonb(s), 'promotions', 'edit'),
    'benefit_items', coalesce(s.display->'benefit_items', '[]'), 'highlight_badge', coalesce(s.display->'highlight_badge', '{}'),
    'benefit_type', s.display->'benefit_type', 'benefit_value', s.display->'benefit_value', 'benefit_unit', s.display->'benefit_unit',
    'draft_revision', s.draft_revision,
    'draft_applies', s.draft_applies, 'published_applies', s.published_applies,
    'draft_project_ids', s.draft->'target_project_ids',
    'published_project_ids', case when s.published is null then '[]'::jsonb else
      coalesce(s.published->'target_project_ids', jsonb_build_array(s.published->>'public_project_id')) end,
    'scope_count', jsonb_array_length(coalesce(s.display->'target_project_ids', jsonb_build_array(s.display->>'public_project_id'))),
    'source', jsonb_build_object(
      'kind', case when s.owning_brand_id is not null then 'brand'
        when jsonb_array_length(coalesce(s.display->'target_project_ids', jsonb_build_array(s.display->>'public_project_id'))) = 1 and s.project_id = selected.id then 'project' else 'shared' end,
      'brand_id', b.public_brand_id, 'label', b.public_name
    ),
    'starts_at', s.display->'starts_at', 'ends_at', s.display->'ends_at',
    'booking_from', s.display->'booking_from', 'booking_to', s.display->'booking_to',
    'transfer_from', s.display->'transfer_from', 'transfer_to', s.display->'transfer_to', 'audience', s.display->'audience',
    'group', case
      when s.active then 'active'
      when (s.display->>'ends_at')::timestamptz <= now() then 'expired'
      when exists (select 1 from hub.promotion_reviews r where r.promotion_id = s.id and r.review_revision = s.draft_revision) then 'in_review'
      else 'draft'
    end,
    'publication_state', case
      when s.active then 'active'
      when s.published is not null and (s.published->>'ends_at')::timestamptz <= now() then 'expired'
      when s.published is not null and (s.published->>'starts_at')::timestamptz > now() then 'scheduled'
      when s.published is not null then 'unavailable'
      when s.was_published then 'withdrawn'
      else 'draft'
    end,
    'review_lanes', (
      select coalesce(jsonb_agg(jsonb_build_object('type', r.review_type, 'decision', r.decision) order by r.review_type), '[]')
      from (
        select distinct on (review_type) review_type, decision
        from hub.promotion_reviews
        where promotion_id = s.id and review_revision = s.draft_revision
        order by review_type, event_seq desc
      ) r
    ),
    'banner', (
      select jsonb_build_object('asset_id', a.id, 'rights_status', a.rights_status, 'caption', a.caption)
      from (
        select (frozen->>'id')::uuid as asset_id
        from jsonb_array_elements(case when s.active then coalesce(s.published->'banners', '[]') else '[]'::jsonb end) frozen
        where (frozen->>'id') ~ '^[0-9a-fA-F-]{36}$'
        union
        select l.asset_id
        from hub.asset_links l
        where not s.active and l.target_type = 'promotion' and l.target_key = s.id::text and l.usage = 'banner' and l.deleted_at is null
      ) cand
      join hub.assets a on a.id = cand.asset_id
      where a.deleted_at is null and hub.can_read_asset(a.id)
      order by (a.rights_status = 'approved') desc, a.id
      limit 1
    ),
    'ending_soon', s.active and (s.published->>'ends_at')::timestamptz <= now() + interval '7 days',
    'banner_missing', s.active and not exists (
      select 1 from live_promos live
      where live.promotion_id = s.id and jsonb_array_length(coalesce(live.payload->'banners', '[]')) > 0
    )
  )
  from included s
  left join hub.brands b on b.id = s.owning_brand_id;
end $function$;

-- 3. Fix hub.workspace_native_rows_before_scopes: materialize expiring asset/binding rows FIRST
--    before calling PL/pgSQL ACL helpers across 3,500+ non-expiring asset_links, and evaluate promotion_payload once.
create or replace function hub.workspace_native_rows_before_scopes()
returns setof jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  with raw_expiring_links as materialized (
    select l.asset_id, l.id as binding_id, l.project_id, l.target_type, l.target_key, l.usage, l.floor_from, l.floor_to, l.effective_to
    from hub.asset_links l
    join hub.assets a on a.id = l.asset_id and a.deleted_at is null
    where l.deleted_at is null and (a.effective_to is not null or l.effective_to is not null)
  ),
  raw_expiring_entity as materialized (
    select l.asset_id, l.id as binding_id, l.project_id, l.asset_role, l.effective_to
    from hub.entity_assets l
    join hub.assets a on a.id = l.asset_id and a.deleted_at is null
    where l.deleted_at is null and (a.effective_to is not null or l.effective_to is not null)
  ),
  raw_expiring_brand as materialized (
    select l.asset_id, l.id as binding_id, l.brand_id, l.asset_role, l.effective_to
    from hub.brand_assets l
    join hub.assets a on a.id = l.asset_id and a.deleted_at is null
    where l.deleted_at is null and (a.effective_to is not null or l.effective_to is not null)
  ),
  raw_expiring_unit as materialized (
    select l.asset_id, l.id as binding_id, l.project_id, l.commercial_type_id, l.asset_role
    from hub.commercial_type_assets l
    join hub.assets a on a.id = l.asset_id and a.deleted_at is null
    where l.deleted_at is null and a.effective_to is not null
  ),
  media(asset_id, binding_id, tab, kind, ref, expires_at, context, phases) as (
    select l.asset_id, l.binding_id, 'projects', 'project', p.public_project_id, l.effective_to,
      hub.workspace_context('project', p.public_project_id) || jsonb_build_object('target_type', l.target_type, 'target_key', l.target_key, 'usage', l.usage, 'floor_from', l.floor_from, 'floor_to', l.floor_to),
      array[p.rem_project_id]
    from raw_expiring_links l
    join hub.projects p on p.id = l.project_id and p.deleted_at is null
    where hub.content_scope_allowed('project', p.public_project_id, 'view')
      and hub.media_target(p.id, l.target_type, l.target_key, 'view')
    union all
    select l.asset_id, l.binding_id, 'projects', 'project', p.public_project_id, l.effective_to,
      hub.workspace_context('project', p.public_project_id) || jsonb_build_object('usage', l.asset_role),
      array[p.rem_project_id]
    from raw_expiring_entity l
    join hub.projects p on p.id = l.project_id and p.deleted_at is null
    where hub.content_scope_allowed('project', p.public_project_id, 'view')
    union all
    select l.asset_id, l.binding_id, 'brands', 'brand', b.public_brand_id, l.effective_to,
      hub.workspace_context('brand', b.public_brand_id) || jsonb_build_object('usage', l.asset_role),
      '{}'::text[]
    from raw_expiring_brand l
    join hub.brands b on b.id = l.brand_id and b.deleted_at is null
    where hub.content_scope_allowed('brand', b.public_brand_id, 'view')
    union all
    select l.asset_id, l.binding_id, 'projects', 'project', p.public_project_id, null::timestamptz,
      hub.workspace_context('project', p.public_project_id) || jsonb_build_object('unit_type', t.public_commercial_type_id, 'usage', l.asset_role),
      array[p.rem_project_id]
    from raw_expiring_unit l
    join hub.projects p on p.id = l.project_id and p.deleted_at is null
    join hub.commercial_types t on t.id = l.commercial_type_id and t.deleted_at is null
    where hub.content_scope_allowed('project', p.public_project_id, 'view')
  ), rows(kind, item_id, source_tab, scope_type, scope_id, label, version, context, table_name, identity, owner_type, owner_key, ready, current_material, phases) as (
    select 'section', s.id::text, hub.content_scope_tab(s.scope_type), s.scope_type, s.scope_id, coalesce(f.label, s.title), to_jsonb(v),
      hub.workspace_context(s.scope_type, s.scope_id) || jsonb_build_object('tab', 'narrative', 'field', s.section_key, 'item', s.id),
      'content_section_versions', jsonb_build_object('id', v.id), 'section', s.id::text, true, true, v.applies_to_project_ids
    from hub.content_sections s
    join hub.content_section_versions v on v.id = s.draft_version_id
    left join hub.field_catalog f on f.field_key = s.section_key
    where s.state <> 'WITHDRAWN' and hub.section_visible(s.id) and hub.content_scope_allowed(s.scope_type, s.scope_id, 'view')
    union all
    select 'faq', f.id::text, 'knowledge', f.scope_type, f.scope_id, v.question, to_jsonb(v),
      hub.workspace_context(f.scope_type, f.scope_id) || jsonb_build_object('tab', 'faq', 'faq', f.id, 'question', v.question_key, 'item', f.id),
      'faq_versions', jsonb_build_object('id', v.id), 'faq', f.id::text,
      not exists (select 1 from hub.faq_sources fs join hub.knowledge_reviews kr on kr.candidate_id = fs.candidate_id where fs.faq_id = f.id and kr.decision <> 'accepted'),
      true, case when v.applicability_rule <> '{}' then hub.faq_rule_projects(v.applicability_rule, f.scope_type, f.scope_id) else v.applies_to_project_ids end
    from hub.content_faq_rows() f
    join hub.faq_versions v on v.id = f.draft_version_id
    where f.state <> 'WITHDRAWN' and hub.content_source_allowed('faqs',to_jsonb(f),'knowledge')
    union all
    select 'unit_type', t.id::text, 'projects', 'project', p.public_project_id, v.payload->'public_name', to_jsonb(v),
      hub.workspace_context('project', p.public_project_id) || jsonb_build_object('tab', 'unit-types', 'unit_type', t.public_commercial_type_id, 'item', t.id),
      'commercial_type_versions', jsonb_build_object('id', v.id), 'commercial_type', t.id::text,
      (hub.unit_type_readiness(t.id)->>'ready')::boolean, v.payload = hub.unit_type_snapshot(t.id), array[p.rem_project_id]
    from hub.commercial_types t
    join hub.projects p on p.id = t.project_id
    join lateral (select x.* from hub.commercial_type_versions x where x.commercial_type_id = t.id order by revision desc limit 1) v
      on v.revision = t.revision or v.state = 'returned' and t.status = 'draft' and t.revision = v.revision + 1
    where t.deleted_at is null and t.status <> 'withdrawn' and hub.content_scope_allowed('project', p.public_project_id, 'view')
    union all
    select 'price', r.id::text, 'projects', 'project', p.public_project_id, coalesce(v.payload->'display_text', jsonb_build_object('th', v.payload->>'public_price_id')), to_jsonb(v),
      hub.workspace_context('project', p.public_project_id) || jsonb_build_object('tab', 'prices', 'unit_type', (select public_commercial_type_id from hub.commercial_types where id = r.commercial_type_id and deleted_at is null), 'item', r.id, 'field', 'price.amount'),
      'project_price_versions', jsonb_build_object('id', v.id), 'price', r.id::text,
      (hub.project_price_readiness(r.id)->>'ready')::boolean, v.payload = hub.project_price_snapshot(r.id), array[p.rem_project_id]
    from hub.project_prices r
    join hub.projects p on p.id = r.project_id
    join lateral (select x.* from hub.project_price_versions x where x.price_id = r.id order by revision desc limit 1) v
      on v.revision = r.revision or v.state = 'returned' and r.state = 'draft' and r.revision = v.revision + 1
    where r.state <> 'withdrawn' and hub.content_scope_allowed('project', p.public_project_id, 'view')
    union all
    select hub.project_commercial_entity(v.kind), v.record_id::text, 'projects', 'project', p.public_project_id,
      coalesce(nullif(v.payload->'legal_project_name', '{}'), nullif(v.payload->'conditions', '{}'), nullif(v.payload->'basis', '{}'), jsonb_build_object('th', coalesce(v.payload->>'programme_key', v.payload->>'component', v.payload->>'public_content_id'))), to_jsonb(v),
      hub.workspace_context('project', p.public_project_id) || jsonb_build_object('tab', v.kind, 'item', v.record_id, 'field', hub.project_commercial_entity(v.kind) || '.' || case v.kind when 'disclosures' then 'legal_project_name' when 'sales-terms' then 'conditions' when 'programmes' then 'programme_key' else 'percent' end),
      'project_commercial_versions', jsonb_build_object('id', v.id), hub.project_commercial_entity(v.kind), v.record_id::text,
      (hub.project_commercial_readiness(v.kind, v.record_id)->>'ready')::boolean, v.payload = hub.project_commercial_snapshot(v.kind, v.record_id), array[p.rem_project_id]
    from hub.project_commercial_versions v
    join hub.projects p on p.id = v.project_id
    cross join lateral (select hub.web_source(hub.project_commercial_table(v.kind), jsonb_build_object('id', v.record_id)) value) r
    where not exists (select 1 from hub.project_commercial_versions later where later.kind = v.kind and later.record_id = v.record_id and later.revision > v.revision)
      and r.value->>'state' <> 'withdrawn'
      and ((r.value->>'revision')::integer = v.revision or v.state = 'returned' and r.value->>'state' = 'draft' and (r.value->>'revision')::integer = v.revision + 1)
      and hub.content_scope_allowed('project', p.public_project_id, 'view')
    union all
    select 'article', a.id::text, 'knowledge', 'article', a.id::text, v.title, to_jsonb(v), jsonb_build_object('article', a.id, 'item', a.id, 'field', 'article.title'),
      'article_versions', jsonb_build_object('id', v.id), 'article', a.id::text, hub.article_reference_issues(v.id) = '[]', true,
      array(select p.rem_project_id from hub.article_links l join hub.projects p on l.kind = 'project' and p.public_project_id = l.ref where l.version_id = v.id and p.deleted_at is null)
    from hub.content_article_rows() a
    join hub.article_versions v on v.id = a.draft_version_id
    where hub.can('knowledge', 'view') and a.state <> 'WITHDRAWN'
      and not exists (select 1 from hub.article_links l where l.version_id = v.id and not hub.article_reference_allowed(l.kind, l.ref))
    union all
    select 'question', q.question_key, 'knowledge', 'question', q.question_key, q.question_template,
      to_jsonb(q) || jsonb_build_object('version_no', q.revision, 'state', upper(q.status), 'editors', jsonb_build_array(q.version_author)),
      jsonb_build_object('tab', 'bank', 'question', q.question_key, 'field', 'faq_question.question_template'),
      'faq_questions', jsonb_build_object('question_key', q.question_key), 'faq_question', q.question_key, true, true, '{}'::text[]
    from hub.faq_questions q where q.status <> 'retired' and hub.can('knowledge', 'view')
    union all
    select 'glossary', g.term_key, 'knowledge', 'glossary', g.term_key, g.term,
      to_jsonb(g) || jsonb_build_object('version_no', g.revision, 'state', upper(g.status), 'editors', jsonb_build_array(g.version_author)),
      jsonb_build_object('tab', 'glossary', 'term', g.term_key, 'item', g.term_key, 'field', 'glossary.term'),
      null::text, null::jsonb, 'glossary', g.term_key, true, true, '{}'::text[]
    from hub.translation_glossary g where g.status <> 'retired' and hub.can('knowledge', 'view')
    union all
    select 'asset', a.id::text || ':' || m.binding_id::text, m.tab, m.kind, m.ref,
      coalesce(nullif(a.caption, '{}'), nullif(a.alt_text, '{}'), jsonb_build_object('th', a.original_filename)),
      jsonb_build_object('state', 'MEDIA', 'version_no', a.updated_at::text, 'effective_to', least(a.effective_to, m.expires_at)),
      m.context || jsonb_build_object('tab', 'media', 'item', a.id, 'binding', m.binding_id, 'field', case when a.effective_to is not null and (m.expires_at is null or a.effective_to <= m.expires_at) then 'asset.effective_to' else 'binding.effective_to' end, 'media_category', a.media_category),
      'assets', jsonb_build_object('id', a.id), 'asset', a.id::text, true, true, m.phases
    from media m
    join hub.assets a on a.id = m.asset_id
    where a.deleted_at is null and least(a.effective_to, m.expires_at) is not null and hub.can_read_asset(a.id)
    union all
    select 'solar', s.id::text, 'projects', 'project', p.public_project_id, s.usage_profile, to_jsonb(s) || jsonb_build_object('version_no', s.revision),
      hub.workspace_context('project', p.public_project_id) || jsonb_build_object('tab', 'features', 'item', s.id, 'field', 'solar_estimate.usage_profile'),
      'solar_estimates', jsonb_build_object('id', s.id), 'solar_estimate', s.id::text, s.as_of <= (current_timestamp at time zone 'Asia/Bangkok')::date, true, array[p.rem_project_id]
    from hub.solar_estimates s
    join hub.projects p on p.id = s.project_id
    where s.state <> 'withdrawn' and hub.content_scope_allowed('project', p.public_project_id, 'view')
    union all
    select 'promotion', p.id::text, 'promotions',
      case when p.promotion_tier in ('campaign', 'corporate') then 'corporate' else p.promotion_tier end,
      coalesce(pr.public_project_id, b.public_brand_id, p.owning_project_group_id, 'sena'),
      p.title,
      to_jsonb(p) || jsonb_build_object(
        'version_no', p.draft_revision,
        'state', case
          when prd.ready then 'APPROVED'
          when exists (select 1 from hub.promotion_reviews where promotion_id = p.id and review_revision = p.draft_revision) then 'IN_REVIEW'
          else 'DRAFT'
        end,
        'approved_by', null,
        'approvers', coalesce((
          select jsonb_agg(reviewed_by)
          from (
            select distinct on (review_type) reviewed_by, decision
            from hub.promotion_reviews
            where promotion_id = p.id and review_revision = p.draft_revision
            order by review_type, event_seq desc
          ) decisions where decision = 'APPROVED'
        ), '[]')
      ),
      hub.workspace_context(
        case when p.promotion_tier in ('campaign', 'corporate') then 'corporate' else p.promotion_tier end,
        coalesce(pr.public_project_id, b.public_brand_id, p.owning_project_group_id, 'sena')
      ) || jsonb_build_object('promotion', p.id, 'item', p.id, 'tab', 'promotions', 'field', 'promotion.title'),
      null::text, null::jsonb, 'promotion', p.id::text, prd.ready, true,
      array(select target.rem_project_id from hub.promotion_target_projects(p.id) tp join hub.projects target on target.id = tp.id)
    from hub.content_promotion_rows() p
    left join hub.projects pr on pr.id = p.project_id
    left join hub.brands b on b.id = p.owning_brand_id
    cross join lateral (select (hub.promotion_readiness(hub.promotion_payload(p.id))->>'ready')::boolean as ready) prd
    where hub.promotion_scope_visible(p.id)
      and (p.promotion_tier in ('campaign', 'corporate', 'project_group')
           or p.project_id is not null and pr.deleted_at is null
           or p.owning_brand_id is not null and b.deleted_at is null)
  )
  select to_jsonb(r) || jsonb_build_object(
    'state', upper(r.version->>'state'),
    'version_id', case when r.kind in ('promotion', 'solar', 'question', 'glossary', 'asset') then null else r.version->>'id' end,
    'version_no', case when r.kind = 'asset' then null else coalesce(r.version->'version_no', r.version->'revision') end,
    'editors', coalesce(r.version->'editors', '[]'),
    'reviewers', coalesce((select jsonb_agg(distinct x) from jsonb_path_query(r.version, '$.translations.**.reviewed_by') x where x <> 'null'), '[]') ||
      coalesce((
        select jsonb_agg(distinct t.reviewed_by)
        from hub.content_translations t
        where r.current_material and t.owner_type = r.owner_type and t.owner_key = r.owner_key
          and t.translation_state = 'reviewed' and t.en_from_th_version = t.th_version and t.reviewed_by is not null
      ), '[]'),
    'approvers', coalesce(r.version->'approvers', case when r.version->>'approved_by' is not null then jsonb_build_array(r.version->'approved_by') else '[]'::jsonb end),
    'expires_on', case when r.kind <> 'asset' then coalesce(r.version->'effective_to', r.version#>'{payload,valid_to}', r.version#>'{payload,effective_to}') end,
    'expires_at', case when r.kind = 'promotion' then r.version->'ends_at' when r.kind = 'asset' then r.version->'effective_to' end,
    'review_due', r.version->'review_due'
  )
  from rows r
$function$;

-- 4a. Fix hub.workspace_history_contexts: use lightweight promotion_scope_access instead of full promotion_read
do $$
declare
  d text;
begin
  d := replace(pg_get_functiondef('hub.workspace_history_contexts(text,jsonb)'::regprocedure), chr(13), '');
  if position('perform hub.promotion_read(subject,''{}'');' in d) > 0 then
    d := hub.content_definition_replace(
      d,
      'perform hub.promotion_read(subject,''{}'');',
      'perform hub.promotion_scope_access(subject,''view'');'
    );
    execute d;
  end if;
end $$;

-- 4b. Fix hub.content_history: GIN-indexed candidate_ids + descending early-exit loop (evaluates only page_size+1 rows)
create or replace function hub.content_history(kind text, ref text, before_id bigint default null::bigint, page_size integer default 50)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  rows jsonb := '[]'::jsonb;
  cand_ids bigint[] := '{}';
  ev audit.change_log;
  ctx jsonb;
  faq_scope jsonb;
  target_project_ids uuid[] := '{}';
  target_public_ids text[] := '{}';
  target_rem_ids text[] := '{}';
  target_asset_ids uuid[] := '{}';
  target_brand_id uuid;
  target_brand_ref text;
  target_section_ids text[] := '{}';
  target_contact_ids text[] := '{}';
  target_faq_ids text[] := '{}';
  target_promo_ids text[] := '{}';
  target_review_item_ids text[] := '{}';
  small_shared_tables text[];
  project_tables constant text[] := array[
    'hub.model_types', 'hub.entity_assets', 'hub.commercial_types', 'hub.commercial_type_sources',
    'hub.commercial_type_assets', 'hub.commercial_type_versions', 'hub.project_facts',
    'hub.project_buildings', 'hub.project_selling_points', 'hub.project_facilities',
    'hub.project_features', 'hub.solar_estimates', 'hub.project_places', 'hub.project_prices',
    'hub.project_price_versions', 'hub.project_disclosures', 'hub.project_sales_terms',
    'hub.project_programmes', 'hub.project_progress', 'hub.project_commercial_versions',
    'hub.website_text_decision', 'hub.asset_links', 'hub.media_links', 'hub.media_link_targets'
  ];
begin
  if not hub.content_scope_allowed(kind, ref, 'view') then
    perform hub.workspace_faq_scope_access(kind, ref);
  end if;
  if page_size is null or page_size not between 1 and 100 or before_id <= 0 then
    raise exception 'Invalid history page' using errcode = '23514';
  end if;

  small_shared_tables := array[
    'hub.publication_releases', 'hub.web_publications', 'hub.publication_release_members',
    'hub.web_pages', 'hub.web_changes', 'hub.articles', 'hub.article_versions', 'hub.article_links',
    'hub.entity_aliases', 'hub.knowledge_fact_candidates', 'hub.faq_intake_decisions'
  ];

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

    select
      coalesce(array_agg(distinct p.public_project_id), '{}'),
      coalesce(array_agg(distinct p.rem_project_id), '{}')
    into target_public_ids, target_rem_ids
    from hub.projects p where p.id = any(target_project_ids);

    select p.brand_id, b.public_brand_id into target_brand_id, target_brand_ref
    from hub.projects p left join hub.brands b on b.id = p.brand_id and b.deleted_at is null
    where p.id = any(target_project_ids) limit 1;

    select coalesce(array_agg(pr.id::text), '{}') into target_promo_ids
    from hub.public_promotions pr
    where pr.project_id = any(target_project_ids)
       or (target_brand_id is not null and pr.owning_brand_id = target_brand_id)
       or pr.all_active_projects
       or exists (select 1 from jsonb_array_elements(coalesce(pr.targets, '[]'::jsonb)) t where t->>'type' in ('project', 'brand', 'project_group'));

    select coalesce(array_agg(distinct x.asset_id), '{}') into target_asset_ids
    from (
      select asset_id from hub.entity_assets where project_id = any(target_project_ids) and deleted_at is null
      union
      select asset_id from hub.asset_links where project_id = any(target_project_ids) and deleted_at is null
      union
      select asset_id from hub.commercial_type_assets where project_id = any(target_project_ids) and deleted_at is null
    ) x where x.asset_id is not null;

    select coalesce(array_agg(s.id::text), '{}') into target_section_ids
    from hub.content_sections s
    where s.scope_type = 'project' and (s.scope_id = any(target_public_ids) or s.scope_id = any(target_rem_ids));

    select coalesce(array_agg(c.id::text), '{}') into target_contact_ids
    from hub.contacts c
    where c.scope_type = 'project' and c.scope_id = any(target_public_ids);

    select coalesce(array_agg(f.id::text), '{}') into target_faq_ids
    from hub.faqs f
    where (f.scope_type = 'project' and f.scope_id = any(target_rem_ids))
       or (f.scope_type = 'unit_type' and exists (
            select 1 from hub.commercial_types ct where ct.project_id = any(target_project_ids) and ct.id::text = f.scope_id
          ));

    select coalesce(array_agg(distinct x.item_id), '{}') into target_review_item_ids
    from (
      select pid::text as item_id from unnest(target_project_ids) pid
      union select target_brand_id::text where target_brand_id is not null
      union select sid from unnest(target_section_ids) sid
      union select cid from unnest(target_contact_ids) cid
      union select fid from unnest(target_faq_ids) fid
      union select id::text from hub.commercial_types where project_id = any(target_project_ids)
      union select id::text from hub.project_prices where project_id = any(target_project_ids)
      union select id::text from hub.project_disclosures where project_id = any(target_project_ids)
      union select id::text from hub.project_sales_terms where project_id = any(target_project_ids)
      union select id::text from hub.project_programmes where project_id = any(target_project_ids)
      union select id::text from hub.project_progress where project_id = any(target_project_ids)
      union select id::text from hub.project_facts where project_id = any(target_project_ids)
      union select id::text from hub.project_features where project_id = any(target_project_ids)
      union select id::text from hub.project_places where project_id = any(target_project_ids)
      union select id::text from hub.solar_estimates where project_id = any(target_project_ids)
    ) x where x.item_id is not null;

    with candidate_ids as (
      select a.id from unnest(target_project_ids) pid
      join audit.change_log a on a.table_name || '' = 'hub.projects' and a.after_row @> jsonb_build_object('id', pid::text)
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_project_ids) pid
      join audit.change_log a on a.table_name || '' = 'hub.projects' and a.before_row @> jsonb_build_object('id', pid::text)
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_project_ids) pid
      join audit.change_log a on (a.table_name || '') = any(project_tables || array['hub.entity_versions'])
        and a.after_row @> jsonb_build_object('project_id', pid::text)
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_project_ids) pid
      join audit.change_log a on (a.table_name || '') = any(project_tables || array['hub.entity_versions'])
        and a.before_row @> jsonb_build_object('project_id', pid::text)
      where before_id is null or a.id < before_id
      union
      select a.id from audit.change_log a
      where a.table_name = 'hub.entity_versions' and (a.after_row @> '{"entity_type":"web_page"}'::jsonb or a.before_row @> '{"entity_type":"web_page"}'::jsonb)
        and (before_id is null or a.id < before_id)
      union
      select a.id from unnest(target_asset_ids) aid
      join audit.change_log a on a.table_name || '' = 'hub.assets' and a.after_row @> jsonb_build_object('id', aid::text)
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_asset_ids) aid
      join audit.change_log a on a.table_name || '' = 'hub.assets' and a.before_row @> jsonb_build_object('id', aid::text)
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_asset_ids) aid
      join audit.change_log a on (a.table_name || '') in ('hub.asset_media_tags', 'hub.knowledge_asset_links')
        and a.after_row @> jsonb_build_object('asset_id', aid::text)
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_asset_ids) aid
      join audit.change_log a on (a.table_name || '') in ('hub.asset_media_tags', 'hub.knowledge_asset_links')
        and a.before_row @> jsonb_build_object('asset_id', aid::text)
      where before_id is null or a.id < before_id
      union
      select a.id from audit.change_log a
      where target_brand_id is not null and a.table_name || '' = 'hub.brands'
        and (a.after_row @> jsonb_build_object('id', target_brand_id::text) or a.before_row @> jsonb_build_object('id', target_brand_id::text))
        and (before_id is null or a.id < before_id)
      union
      select a.id from audit.change_log a
      where target_brand_id is not null and (a.table_name || '') in ('hub.brand_versions', 'hub.brand_assets', 'hub.brand_business')
        and (a.after_row @> jsonb_build_object('brand_id', target_brand_id::text) or a.before_row @> jsonb_build_object('brand_id', target_brand_id::text))
        and (before_id is null or a.id < before_id)
      union
      select a.id from unnest(target_public_ids) pub_id
      join audit.change_log a on a.table_name || '' = 'hub.contacts'
        and (a.after_row @> jsonb_build_object('scope_id', pub_id) or a.before_row @> jsonb_build_object('scope_id', pub_id))
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_section_ids) sid
      join audit.change_log a on a.table_name || '' = 'hub.content_sections'
        and (a.after_row @> jsonb_build_object('id', sid) or a.before_row @> jsonb_build_object('id', sid))
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_section_ids) sid
      join audit.change_log a on a.table_name || '' = 'hub.content_section_versions'
        and (a.after_row @> jsonb_build_object('section_id', sid) or a.before_row @> jsonb_build_object('section_id', sid))
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_faq_ids) fid
      join audit.change_log a on a.table_name || '' = 'hub.faqs'
        and (a.after_row @> jsonb_build_object('id', fid) or a.before_row @> jsonb_build_object('id', fid))
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_faq_ids) fid
      join audit.change_log a on (a.table_name || '') in ('hub.faq_versions', 'hub.faq_sources')
        and (a.after_row @> jsonb_build_object('faq_id', fid) or a.before_row @> jsonb_build_object('faq_id', fid))
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_rem_ids) rem_id
      join audit.change_log a on a.table_name || '' = 'hub.content_gaps'
        and (a.after_row @> jsonb_build_object('project_id', rem_id) or a.before_row @> jsonb_build_object('project_id', rem_id))
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_public_ids) pub_id
      join audit.change_log a on a.table_name || '' = 'hub.content_translations' and a.after_row @> jsonb_build_object('scope_id', pub_id)
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_public_ids) pub_id
      join audit.change_log a on a.table_name || '' = 'hub.content_translations' and a.before_row @> jsonb_build_object('scope_id', pub_id)
      where before_id is null or a.id < before_id
      union
      select a.id from audit.change_log a
      where target_brand_ref is not null and a.table_name || '' = 'hub.content_translations'
        and (a.after_row @> jsonb_build_object('scope_id', target_brand_ref) or a.before_row @> jsonb_build_object('scope_id', target_brand_ref))
        and (before_id is null or a.id < before_id)
      union
      select a.id from unnest(target_section_ids || target_faq_ids) ok
      join audit.change_log a on a.table_name || '' = 'hub.content_translations' and a.after_row @> jsonb_build_object('owner_key', ok)
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_section_ids || target_faq_ids) ok
      join audit.change_log a on a.table_name || '' = 'hub.content_translations' and a.before_row @> jsonb_build_object('owner_key', ok)
      where before_id is null or a.id < before_id
      union
      select a.id from audit.change_log a
      where a.table_name || '' = 'hub.content_translations'
        and (a.after_row @> '{"owner_type":"article"}'::jsonb or a.before_row @> '{"owner_type":"article"}'::jsonb)
        and (before_id is null or a.id < before_id)
      union
      select a.id from unnest(target_review_item_ids) rid
      join audit.change_log a on a.table_name || '' = 'hub.content_review_versions'
        and a.after_row @> jsonb_build_object('identity', jsonb_build_object('id', rid))
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_review_item_ids) rid
      join audit.change_log a on a.table_name || '' = 'hub.content_review_versions'
        and a.before_row @> jsonb_build_object('identity', jsonb_build_object('id', rid))
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_project_ids) pid
      join audit.change_log a on a.table_name || '' = 'hub.content_review_versions'
        and a.after_row @> jsonb_build_object('identity', jsonb_build_object('project_id', pid::text))
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_project_ids) pid
      join audit.change_log a on a.table_name || '' = 'hub.content_review_versions'
        and a.before_row @> jsonb_build_object('identity', jsonb_build_object('project_id', pid::text))
      where before_id is null or a.id < before_id
      union
      select a.id from audit.change_log a
      where a.table_name || '' = 'hub.content_review_versions'
        and (a.after_row @> '{"kind":"page_config"}'::jsonb or a.after_row @> '{"kind":"article"}'::jsonb)
        and (before_id is null or a.id < before_id)
      union
      select a.id from unnest(target_promo_ids) prid
      join audit.change_log a on a.table_name in ('hub.public_promotions', 'hub.promotion_reviews', 'hub.promotion_versions')
        and (a.after_row @> jsonb_build_object('id', prid) or a.before_row @> jsonb_build_object('id', prid)
             or a.after_row @> jsonb_build_object('promotion_id', prid) or a.before_row @> jsonb_build_object('promotion_id', prid))
      where before_id is null or a.id < before_id
      union
      select a.id from audit.change_log a
      where a.table_name in ('hub.public_promotions', 'hub.promotion_versions')
        and exists (
          select 1 from unnest(target_public_ids) pub_id
          where a.after_row#>'{payload,target_project_ids}' ? pub_id or a.before_row#>'{payload,target_project_ids}' ? pub_id
             or a.after_row->'resolved_project_ids' ? pub_id or a.before_row->'resolved_project_ids' ? pub_id
        )
        and (before_id is null or a.id < before_id)
      union
      select a.id from audit.change_log a
      where a.table_name in ('hub.content_sections', 'hub.content_section_versions', 'hub.faqs', 'hub.faq_versions', 'hub.faq_sources')
        and exists (
          select 1 from unnest(target_rem_ids) rem_id
          where a.after_row->'applies_to_project_ids' ? rem_id or a.before_row->'applies_to_project_ids' ? rem_id
        )
        and (before_id is null or a.id < before_id)
      union
      select a.id from unnest(small_shared_tables) st(tname)
      join audit.change_log a on a.table_name = st.tname
      where before_id is null or a.id < before_id
    )
    select coalesce(array_agg(distinct id order by id desc), '{}') into cand_ids from candidate_ids;
  else
    if kind = 'brand' then
      select b.id into target_brand_id from hub.brands b where b.public_brand_id = ref and b.deleted_at is null;
      if target_brand_id is not null then
        select coalesce(array_agg(distinct ba.asset_id), '{}') into target_asset_ids
        from hub.brand_assets ba where ba.brand_id = target_brand_id and ba.deleted_at is null and ba.asset_id is not null;
        select coalesce(array_agg(pr.id::text), '{}') into target_promo_ids
        from hub.public_promotions pr where pr.owning_brand_id = target_brand_id;
      end if;
    end if;

    select coalesce(array_agg(s.id::text), '{}') into target_section_ids
    from hub.content_sections s
    where (s.scope_type = kind or kind = 'project_group' and s.scope_type = 'rem_project_group')
      and s.scope_id = ref;

    select coalesce(array_agg(c.id::text), '{}') into target_contact_ids
    from hub.contacts c
    where c.scope_type = kind and c.scope_id = ref;

    select coalesce(array_agg(f.id::text), '{}') into target_faq_ids
    from hub.faqs f
    where (f.scope_type = kind or kind = 'project_group' and f.scope_type = 'rem_project_group')
      and f.scope_id = ref;

    select coalesce(array_agg(distinct x.item_id), '{}') into target_review_item_ids
    from (
      select target_brand_id::text as item_id where target_brand_id is not null
      union select ba.id::text from hub.brand_assets ba where target_brand_id is not null and ba.brand_id = target_brand_id
      union select aid::text from unnest(target_asset_ids) aid
      union select sid from unnest(target_section_ids) sid
      union select cid from unnest(target_contact_ids) cid
      union select fid from unnest(target_faq_ids) fid
    ) x where x.item_id is not null;

    with candidate_ids as (
      select a.id from audit.change_log a
      where kind = 'brand' and target_brand_id is not null and a.table_name = 'hub.brands'
        and (a.after_row @> jsonb_build_object('id', target_brand_id::text) or a.before_row @> jsonb_build_object('id', target_brand_id::text))
        and (before_id is null or a.id < before_id)
      union
      select a.id from audit.change_log a
      where kind = 'brand' and target_brand_id is not null and a.table_name in ('hub.brand_versions', 'hub.brand_assets', 'hub.brand_business')
        and (a.after_row @> jsonb_build_object('brand_id', target_brand_id::text) or a.before_row @> jsonb_build_object('brand_id', target_brand_id::text))
        and (before_id is null or a.id < before_id)
      union
      select a.id from unnest(target_asset_ids) aid
      join audit.change_log a on kind = 'brand' and a.table_name in ('hub.assets', 'hub.asset_media_tags', 'hub.knowledge_asset_links')
        and (a.after_row @> jsonb_build_object('id', aid::text) or a.before_row @> jsonb_build_object('id', aid::text)
             or a.after_row @> jsonb_build_object('asset_id', aid::text) or a.before_row @> jsonb_build_object('asset_id', aid::text))
      where before_id is null or a.id < before_id
      union
      select a.id from audit.change_log a
      where kind = 'business' and a.table_name in ('hub.businesses', 'hub.brand_business')
        and (before_id is null or a.id < before_id)
      union
      select a.id from audit.change_log a
      where a.table_name = 'hub.contacts'
        and (a.after_row @> jsonb_build_object('scope_type', kind, 'scope_id', ref)
             or a.before_row @> jsonb_build_object('scope_type', kind, 'scope_id', ref))
        and (before_id is null or a.id < before_id)
      union
      select a.id from unnest(target_section_ids) sid
      join audit.change_log a on a.table_name = 'hub.content_sections'
        and (a.after_row @> jsonb_build_object('id', sid) or a.before_row @> jsonb_build_object('id', sid))
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_section_ids) sid
      join audit.change_log a on a.table_name = 'hub.content_section_versions'
        and (a.after_row @> jsonb_build_object('section_id', sid) or a.before_row @> jsonb_build_object('section_id', sid))
      where before_id is null or a.id < before_id
      union
      select a.id from audit.change_log a
      where a.table_name = 'hub.content_sections'
        and (a.after_row @> jsonb_build_object('scope_id', ref) or a.before_row @> jsonb_build_object('scope_id', ref))
        and (before_id is null or a.id < before_id)
      union
      select a.id from unnest(target_faq_ids) fid
      join audit.change_log a on a.table_name = 'hub.faqs'
        and (a.after_row @> jsonb_build_object('id', fid) or a.before_row @> jsonb_build_object('id', fid))
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(target_faq_ids) fid
      join audit.change_log a on a.table_name in ('hub.faq_versions', 'hub.faq_sources')
        and (a.after_row @> jsonb_build_object('faq_id', fid) or a.before_row @> jsonb_build_object('faq_id', fid))
      where before_id is null or a.id < before_id
      union
      select a.id from audit.change_log a
      where a.table_name = 'hub.faqs'
        and (a.after_row @> jsonb_build_object('scope_id', ref) or a.before_row @> jsonb_build_object('scope_id', ref))
        and (before_id is null or a.id < before_id)
      union
      select a.id from audit.change_log a
      where kind = 'corporate' and a.table_name in ('hub.faq_questions', 'hub.faq_question_versions', 'hub.translation_glossary')
        and (before_id is null or a.id < before_id)
      union
      select a.id from audit.change_log a
      where a.table_name = 'hub.content_translations'
        and (a.after_row @> jsonb_build_object('scope_id', ref) or a.before_row @> jsonb_build_object('scope_id', ref))
        and (before_id is null or a.id < before_id)
      union
      select a.id from unnest(target_section_ids || target_faq_ids) ok
      join audit.change_log a on a.table_name = 'hub.content_translations'
        and (a.after_row @> jsonb_build_object('owner_key', ok) or a.before_row @> jsonb_build_object('owner_key', ok))
      where before_id is null or a.id < before_id
      union
      select a.id from audit.change_log a
      where kind = 'corporate' and a.table_name = 'hub.content_translations'
        and (a.after_row @> '{"owner_type":"article"}'::jsonb or a.before_row @> '{"owner_type":"article"}'::jsonb
             or a.after_row @> '{"owner_type":"question"}'::jsonb or a.before_row @> '{"owner_type":"question"}'::jsonb)
        and (before_id is null or a.id < before_id)
      union
      select a.id from unnest(target_review_item_ids) rid
      join audit.change_log a on a.table_name = 'hub.content_review_versions'
        and (a.after_row @> jsonb_build_object('identity', jsonb_build_object('id', rid))
             or a.before_row @> jsonb_build_object('identity', jsonb_build_object('id', rid)))
      where before_id is null or a.id < before_id
      union
      select a.id from audit.change_log a
      where kind = 'corporate' and a.table_name = 'hub.content_review_versions'
        and (a.after_row @> '{"kind":"question"}'::jsonb or a.after_row @> '{"kind":"glossary"}'::jsonb
             or a.after_row @> '{"kind":"article"}'::jsonb or a.after_row @> '{"kind":"page_config"}'::jsonb)
        and (before_id is null or a.id < before_id)
      union
      select a.id from audit.change_log a
      where kind <> 'corporate' and a.table_name = 'hub.content_review_versions'
        and a.after_row @> '{"kind":"page_config"}'::jsonb
        and (before_id is null or a.id < before_id)
      union
      select a.id from audit.change_log a
      where a.table_name = 'hub.entity_versions'
        and (a.after_row @> '{"entity_type":"web_page"}'::jsonb or a.before_row @> '{"entity_type":"web_page"}'::jsonb)
        and (before_id is null or a.id < before_id)
      union
      select a.id from unnest(target_promo_ids) prid
      join audit.change_log a on kind = 'brand' and a.table_name in ('hub.public_promotions', 'hub.promotion_reviews', 'hub.promotion_versions')
        and (a.after_row @> jsonb_build_object('id', prid) or a.before_row @> jsonb_build_object('id', prid)
             or a.after_row @> jsonb_build_object('promotion_id', prid) or a.before_row @> jsonb_build_object('promotion_id', prid))
      where before_id is null or a.id < before_id
      union
      select a.id from unnest(small_shared_tables) st(tname)
      join audit.change_log a on a.table_name = st.tname
      where before_id is null or a.id < before_id
    )
    select coalesce(array_agg(distinct id order by id desc), '{}') into cand_ids from candidate_ids;
  end if;

  -- Stream candidate rows in descending audit order and stop immediately once page_size + 1 visible events match!
  for ev in
    select * from audit.change_log l
    where l.id = any(cand_ids)
    order by l.id desc
  loop
    ctx := null;
    select x into ctx
    from (
      select distinct on (x->>'kind', x->>'ref') x
      from hub.workspace_history_contexts(ev.table_name, coalesce(ev.after_row, ev.before_row)) x
      where hub.workspace_history_matches(x, kind, ref)
    ) matched
    limit 1;
    if ctx is not null and hub.workspace_history_visible(ev) then
      rows := rows || jsonb_build_array(hub.workspace_history_event(ev, ctx));
      exit when jsonb_array_length(rows) > page_size;
    end if;
  end loop;

  return jsonb_build_object(
    'items', case when jsonb_array_length(rows) > page_size then rows - (jsonb_array_length(rows) - 1) else rows end,
    'next_cursor', case when jsonb_array_length(rows) > page_size then rows->(page_size - 1)->>'audit_id' end
  );
end $function$;

-- 4c. Fix hub.workspace_content_tasks: O(1) native lookup + precomputed published dependency set + skip non-actionable APPROVED rows
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
  native_map jsonb := '{}'::jsonb;
  published_set jsonb := '{}'::jsonb;
  published_version_ids jsonb := '{}'::jsonb;
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
  dep_key text;
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
  select coalesce(jsonb_object_agg(
    (case n->>'kind' when 'construction_progress' then 'progress' else n->>'kind' end) || ':' || coalesce(n->>'item_id', ''),
    n || jsonb_build_object('kind', case n->>'kind' when 'construction_progress' then 'progress' else n->>'kind' end)
  ), '{}'::jsonb) into native_map
  from jsonb_array_elements(native_all) n;

  if can_publish_web then
    with all_deps as materialized (
      select d from hub.web_pages p join hub.entity_versions v on v.id = p.published_version_id cross join lateral hub.web_dependencies(v.payload) d
      union all select d from hub.projects p join hub.entity_versions v on v.id = p.published_version_id
        cross join lateral jsonb_array_elements(coalesce(v.review_evidence->'dependencies', '[]')) d
      union all select d from hub.brands b join hub.brand_versions v on v.id = b.published_version_id
        cross join lateral jsonb_array_elements(coalesce(v.review_evidence->'dependencies', '[]')) d
      union all select d from hub.public_promotions p join hub.promotion_versions v on v.id = p.published_version_id
        cross join lateral jsonb_array_elements(coalesce(v.review_evidence->'dependencies', '[]')) d
    )
    select
      coalesce((select jsonb_object_agg(k, true) from (
        select distinct coalesce(d->>'table', '') || '|' || coalesce((d->'identity')::text, '') || '|' || coalesce(d#>>'{approval,version_id}', '') || '|' || coalesce(d->>'hash', '') as k
        from all_deps
      ) keys), '{}'::jsonb),
      coalesce((select jsonb_object_agg(vid, true) from (
        select distinct d#>>'{approval,version_id}' as vid from all_deps where d#>>'{approval,version_id}' is not null
      ) vids), '{}'::jsonb)
    into published_set, published_version_ids;
  end if;

  for r in
    select n || jsonb_build_object('kind', case n->>'kind' when 'construction_progress' then 'progress' else n->>'kind' end)
    from jsonb_array_elements(native_all) n
    where n->>'kind' in ('section', 'faq', 'unit_type', 'price', 'disclosure', 'sales_term', 'programme', 'construction_progress', 'article', 'question', 'promotion')
      and (n->>'kind' = 'promotion' or n->>'state' not in ('DRAFT', 'PUBLISHED') or exists (
        select 1 from hub.content_review_versions cv
        where cv.kind = (case n->>'kind' when 'construction_progress' then 'progress' else n->>'kind' end)
          and cv.identity = (case when n->>'kind' = 'question' then jsonb_build_object('question_key', n->>'item_id') else jsonb_build_object('id', n->>'item_id') end)
      ))
    union all
    select jsonb_build_object('kind', v.kind, 'identity', v.identity, 'version', to_jsonb(v))
    from (select distinct on (cv.kind, cv.identity) cv.* from hub.content_review_versions cv order by cv.kind, cv.identity, cv.version_no desc) v
    where v.state <> 'DRAFT'
      and not (native_map ? (v.kind || ':' || coalesce(v.identity->>'id', v.identity->>'question_key', '')))
      and not (
        v.state = 'APPROVED'
        and (
          not (hub.can('projects', 'approve') or hub.can('brands', 'approve') or hub.can('knowledge', 'approve'))
          or (
            v.staged_invalidated_at is null
            and v.kind not in ('project', 'brand', 'disclosure', 'fact', 'building')
            and coalesce(nullif(v.payload->'_staged_values', 'null'::jsonb), '{}'::jsonb) - '_disclosure_sources' = '{}'::jsonb
          )
        )
        and (
          not can_publish_web
          or v.approved_by::text = actor
          or actor::uuid = any(coalesce(v.editors, '{}'::uuid[]))
          or v.payload->>'ai_exposure' = 'internal'
          or published_version_ids ? (v.id::text)
        )
      )
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
        native := native_map->(kind || ':' || coalesce(source->>'id', source->>'term_key', source->>'question_key', ''));
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
            dep_key := coalesce(dependency->>'table', '') || '|' || coalesce((dependency->'identity')::text, '') || '|' || coalesce(dependency#>>'{approval,version_id}', '') || '|' || coalesce(dependency->>'hash', '');
            if not (published_set ? dep_key) then
              perform hub.publication_dependency_check(dependency, true, true);
              if (native is null or coalesce((native->>'ready')::boolean, false) and coalesce((native->>'current_material')::boolean, false))
                 and hub.publication_task_native_ready(kind, source, version) then
                category := 'publish';
              end if;
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

-- 5. Enable 'data' tab on programme and project_group in hub.workspace_page when caller has knowledge.view
do $$
declare
  d text;
begin
  d := replace(pg_get_functiondef('hub.workspace_page(text,text,text)'::regprocedure), chr(13), '');
  if position('if kind in (''project'',''brand'',''business'',''corporate'') then tabs:=tabs||''"data"''::jsonb;end if;' in d) > 0 then
    d := hub.content_definition_replace(
      d,
      'if kind in (''project'',''brand'',''business'',''corporate'') then tabs:=tabs||''"data"''::jsonb;end if;',
      'if kind in (''project'',''brand'',''business'',''corporate'') or kind in (''programme'',''project_group'') and hub.can(''knowledge'',''view'') then tabs:=tabs||''"data"''::jsonb;end if;'
    );
    execute d;
  end if;
end $$;

-- 6. Enrich hub.workspace_home with task_counts, scope_summary, and visual card fields for bounded projects
create or replace function hub.workspace_home(
  bud text default null::text,
  brand text default null::text,
  page_offset integer default 0,
  page_size integer default 25,
  task_kind text default null::text,
  selected_gap uuid default null::uuid
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  actor uuid;
  projects jsonb := '[]';
  tasks jsonb := '[]';
  p record;
  r record;
  faq_scope record;
  item jsonb;
  readiness jsonb;
  preview jsonb;
  context jsonb;
  category text;
  task_id text;
  deadline date;
  today date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  selected jsonb;
  total integer;
  missing_projects integer := 0;
  task_total integer;
  task_counts jsonb;
  brand_groups jsonb := '[]';
  bud_groups jsonb;
  cover jsonb;
  blogo jsonb;
  u_count integer;
  f_count integer;
  pr_count integer;
begin
  actor := hub.workspace_require();
  if page_offset is null or page_size is null or page_offset not between 0 and 100000 or page_size not between 1 and 100 or length(bud) > 200 or length(brand) > 128
     or task_kind is not null and task_kind not in ('returned', 'approval', 'publish', 'expiring', 'fact_missing', 'review_due', 'unanswered') then
    raise exception 'Invalid workspace filters' using errcode = '23514';
  end if;

  for p in
    select x.*, b.public_brand_id, b.public_name as brand_name, bu.rem_bu_id, bu.rem_bu_code, bu.rem_bu_name, bu.source_snapshot_at
    from hub.content_project_rows('projects') x
    left join hub.content_brand_rows('brands') b on b.id = x.brand_id and hub.content_scope_allowed('brand', b.public_brand_id, 'view')
    left join hub.workspace_project_bu() bu on bu.project_id = x.id
    where x.deleted_at is null
      and hub.content_scope_allowed('project', x.public_project_id, 'view')
      and (bud is null or bu.rem_bu_id = bud)
      and (brand is null or b.public_brand_id = brand)
    order by x.public_project_id
  loop
    if jsonb_array_length(projects) < page_offset or jsonb_array_length(projects) >= page_offset + page_size then
      readiness := jsonb_build_object('required_missing', hub.project_required_missing_summary(p.public_project_id));
      cover := null; blogo := null; u_count := null; f_count := null; pr_count := null;
    else
      readiness := hub.workspace_project_readiness(p.public_project_id);
      select jsonb_build_object('id', top_cand.id, 'public_url', top_cand.public_url) into cover
      from (
        select cand.id, cand.public_url, row_number() over (order by cand.prio, cand.sec, cand.ord, cand.id) as rnk
        from (
          select a.id, a.public_url, case ea.asset_role when 'hero' then 1 else 2 end as prio, (not ea.is_primary)::int as sec, ea.display_order as ord
          from hub.entity_assets ea join hub.assets a on a.id = ea.asset_id
          where ea.project_id = p.id and ea.model_id is null and ea.deleted_at is null and a.deleted_at is null
            and ea.asset_role in ('hero', 'thumbnail') and a.mime_type like 'image/%' and a.media_category is distinct from 'legal_document'
          union all
          select a.id, a.public_url,
            case
              when al.usage = 'hero' then 3
              when a.media_category = 'exterior' then 4
              when a.media_category = 'facility' then 5
              when a.media_category = 'interior' then 6
              else 7
            end as prio,
            0 as sec, al.sort as ord
          from hub.asset_links al join hub.assets a on a.id = al.asset_id
          where al.project_id = p.id and al.deleted_at is null and a.deleted_at is null
            and a.mime_type like 'image/%'
            and coalesce(a.media_category, '') not in ('floor_plan', 'unit_plan', 'map', 'master_plan', 'legal_document', 'promotion_ad')
        ) cand
        order by cand.prio, cand.sec, cand.ord, cand.id
        limit 3
      ) top_cand
      where hub.can_read_asset(top_cand.id)
      order by top_cand.rnk
      limit 1;

      if p.brand_id is not null and p.public_brand_id is not null then
        select jsonb_build_object('id', a.id, 'public_url', a.public_url) into blogo
        from hub.brand_assets ba join hub.assets a on a.id = ba.asset_id
        where ba.brand_id = p.brand_id and ba.deleted_at is null and a.deleted_at is null
          and ba.asset_role = 'logo_primary' and ba.is_primary and a.mime_type like 'image/%'
          and hub.can_read_asset(a.id)
        limit 1;
      else
        blogo := null;
      end if;

      select count(*) into u_count from hub.commercial_types ct where ct.project_id = p.id and ct.deleted_at is null and ct.status <> 'withdrawn';
      f_count := case when hub.can('knowledge', 'view') then (
        select count(*) from hub.faqs fq where fq.scope_type = 'project' and fq.scope_id = p.rem_project_id and fq.state <> 'WITHDRAWN'
      ) else 0 end;
      pr_count := case when hub.can('promotions', 'view') then (
        select count(*) from hub.public_promotions pr
        where (pr.project_id = p.id or pr.owning_brand_id = p.brand_id or pr.all_active_projects)
          and pr.ends_at > now() and hub.promotion_scope_visible(pr.id)
      ) else 0 end;
    end if;

    if coalesce((readiness->>'required_missing')::integer, 0) > 0 then
      missing_projects := missing_projects + 1;
    end if;

    projects := projects || jsonb_build_array(jsonb_build_object(
      'ref', p.public_project_id,
      'name', p.public_name,
      'rem_project_id', p.rem_project_id,
      'published', p.published_version_id is not null,
      'cover_image', cover,
      'brand_logo', blogo,
      'unit_type_count', u_count,
      'faq_count', f_count,
      'promotion_count', pr_count,
      'brand', case when p.public_brand_id is not null then jsonb_build_object('ref', p.public_brand_id, 'name', p.brand_name) end,
      'bud', case when p.rem_bu_id is not null then jsonb_build_object('id', p.rem_bu_id, 'code', p.rem_bu_code, 'name', p.rem_bu_name, 'as_of', p.source_snapshot_at) end,
      'readiness', readiness
    ));

    if hub.can('knowledge', 'view') then
      for faq_scope in
        select null::uuid id, null::text public_id
        union all
        select t.id, t.public_commercial_type_id from hub.commercial_types t
        where t.project_id = p.id and t.deleted_at is null and t.status <> 'withdrawn'
      loop
        preview := hub.workspace_missing_fact_cells(p.id, faq_scope.public_id);
        for item in select value from jsonb_array_elements(coalesce(preview->'cells', '[]')) where value->>'state' = 'waiting_for_fact' loop
          for r in select value field_key from jsonb_array_elements_text(coalesce(item->'missing_fact_keys', '[]')) loop
            context := hub.workspace_context('project', p.public_project_id)
              || jsonb_build_object('tab', case when r.field_key = 'price.amount' then 'prices' else 'facts' end, 'field', r.field_key, 'question', item->>'question_key')
              || jsonb_strip_nulls(jsonb_build_object('unit_type', faq_scope.public_id));
            select context || jsonb_strip_nulls(jsonb_build_object('grain', f.grain, 'item', f.id, 'phase', case when f.grain like 'phase:%' then substr(f.grain, 7) end)) into context
            from (select 1) seed
            left join lateral (
              select x.id, x.grain from hub.project_facts x
              where x.project_id = p.id and x.fact_key = r.field_key and x.grain in ('project', 'phase:' || p.rem_project_id)
              order by (x.grain <> 'project') desc limit 1
            ) f on true;
            task_id := 'fact:' || p.public_project_id || ':' || (item->>'question_key') || ':' || r.field_key || ':' || case when r.field_key = 'price.amount' then coalesce(faq_scope.id::text, 'project') else 'project' end;
            if not exists (select 1 from jsonb_array_elements(tasks) existing where existing->>'id' = task_id) then
              tasks := tasks || jsonb_build_array(jsonb_build_object(
                'id', task_id,
                'category', 'fact_missing',
                'kind', case when r.field_key = 'price.amount' then 'price' else 'fact' end,
                'label', jsonb_build_object('th', item->>'question_label'),
                'project', p.public_project_id,
                'project_name', p.public_name,
                'context', context
              ));
            end if;
          end loop;
        end loop;
      end loop;
    end if;

    for r in select f.id, f.fact_key, f.grain, f.valid_to, f.as_of, c.review_every_days, c.label from hub.project_facts f join hub.field_catalog c on c.field_key = f.fact_key where f.project_id = p.id loop
      context := hub.workspace_context('project', p.public_project_id) || jsonb_strip_nulls(jsonb_build_object('tab', 'facts', 'field', r.fact_key, 'item', r.id, 'grain', r.grain,
        'phase', case when r.grain like 'phase:%' then substr(r.grain, 7) end, 'building', case when r.grain like 'building:%' then substr(r.grain, 10) end));
      for category, deadline in select 'expiring', r.valid_to union all select 'review_due', r.as_of + r.review_every_days loop
        if deadline <= today + 30 then
          tasks := tasks || jsonb_build_array(jsonb_build_object(
            'id', category || ':fact:' || r.id, 'category', category, 'kind', 'fact', 'item_id', r.id,
            'label', r.label, 'project', p.public_project_id, 'project_name', p.public_name,
            'due', deadline, 'overdue', deadline < today, 'context', context
          ));
        end if;
      end loop;
    end loop;
  end loop;

  select tasks || coalesce(jsonb_agg(t), '[]') into tasks from hub.workspace_content_tasks(bud, brand) t;

  if hub.can('knowledge', 'view') then
    for r in
      select g.*, gp.public_project_id, gp.public_name
      from hub.content_gap_rows() g
      join hub.content_project_rows('projects') gp on gp.rem_project_id = g.project_id
      where g.gap_code = 'NO_ANSWER' and g.state <> 'resolved' and (g.assignee is null or g.assignee = actor)
        and gp.deleted_at is null and hub.content_scope_allowed('project', gp.public_project_id, 'view')
        and (g.id = selected_gap or hub.workspace_scope_matches('project', gp.public_project_id, array[gp.rem_project_id], bud, brand))
    loop
      item := jsonb_build_object(
        'id', 'gap:' || r.id, 'category', 'unanswered', 'kind', 'gap', 'item_id', r.id,
        'label', r.public_name, 'project', r.public_project_id,
        'question_text_available', false,
        'context', hub.workspace_context('project', r.public_project_id) || jsonb_strip_nulls(jsonb_build_object('tab', 'faq', 'gap', r.id, 'question', r.question_key)),
        'occurrences', r.occurrences, 'last_seen', r.last_seen
      );
      if r.id = selected_gap then selected := item; end if;
      if hub.workspace_scope_matches('project', r.public_project_id, array[r.project_id], bud, brand) then
        tasks := tasks || jsonb_build_array(item);
      end if;
    end loop;
  end if;

  for r in
    select b.* from hub.content_brand_rows('brands') b
    where b.deleted_at is null and hub.content_scope_allowed('brand', b.public_brand_id, 'view')
      and (brand is null or b.public_brand_id = brand)
      and (bud is null or exists (select 1 from jsonb_array_elements(projects) x where x#>>'{brand,ref}' = b.public_brand_id))
    order by b.public_brand_id
  loop
    readiness := hub.workspace_brand_readiness(r.public_brand_id);
    brand_groups := brand_groups || jsonb_build_array(jsonb_build_object(
      'ref', r.public_brand_id, 'name', r.public_name, 'readiness', readiness,
      'required_missing', readiness->'required_missing',
      'projects', (select count(*) from jsonb_array_elements(projects) x where x#>>'{brand,ref}' = r.public_brand_id),
      'project_required_missing', (select coalesce(sum((x#>>'{readiness,required_missing}')::integer), 0) from jsonb_array_elements(projects) x where x#>>'{brand,ref}' = r.public_brand_id)
    ));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'projects', n, 'required_missing', missing) order by id), '[]') into bud_groups
  from (
    select x#>>'{bud,id}' id, x#>>'{bud,code}' code, x#>>'{bud,name}' name, count(*) n, sum((x#>>'{readiness,required_missing}')::integer) missing
    from jsonb_array_elements(projects) x where x->'bud' <> 'null'::jsonb
    group by x#>>'{bud,id}', x#>>'{bud,code}', x#>>'{bud,name}'
  ) grouped;

  select jsonb_build_object(
    'all', count(*),
    'returned', count(*) filter (where x->>'category' = 'returned'),
    'approval', count(*) filter (where x->>'category' = 'approval'),
    'publish', count(*) filter (where x->>'category' = 'publish'),
    'expiring', count(*) filter (where x->>'category' = 'expiring'),
    'review_due', count(*) filter (where x->>'category' = 'review_due'),
    'fact_missing', count(*) filter (where x->>'category' = 'fact_missing'),
    'unanswered', count(*) filter (where x->>'category' = 'unanswered')
  ) into task_counts
  from jsonb_array_elements(tasks) x;

  total := jsonb_array_length(projects);
  select coalesce(jsonb_agg(value), '[]') into projects
  from (select value from jsonb_array_elements(projects) with ordinality order by ordinality offset page_offset limit page_size) bounded;

  select count(*) into task_total from jsonb_array_elements(tasks) x where task_kind is null or x->>'category' = task_kind;
  select coalesce(jsonb_agg(value), '[]') into tasks
  from (
    select value from jsonb_array_elements(tasks)
    where task_kind is null or value->>'category' = task_kind
    order by case value->>'category' when 'returned' then 0 when 'approval' then 1 when 'publish' then 2 else 3 end, value->>'due', value->>'id'
    offset page_offset limit page_size
  ) bounded;

  return jsonb_build_object(
    'projects', projects,
    'project_total', total,
    'tasks', tasks,
    'task_total', task_total,
    'task_counts', task_counts,
    'scope_summary', jsonb_build_object(
      'unrestricted_projects', hub.content_unrestricted('projects', 'view'),
      'visible_projects', total,
      'missing_projects', missing_projects
    ),
    'selected_gap', selected,
    'brands', brand_groups,
    'buds', bud_groups,
    'offset', page_offset,
    'limit', page_size,
    'as_of', current_timestamp
  );
end $function$;

-- 7. Enrich hub.brand_completeness() with description_th, slug, faq_count, and promotion_count for Brand Cards
create or replace function hub.brand_completeness()
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  rows jsonb := '[]';
  s jsonb;
  b hub.brands;
  payload jsonb;
  ready jsonb;
  changed boolean;
  available boolean;
  checks jsonb;
  row_status text;
  can_know boolean := hub.can('knowledge', 'view');
  can_promo boolean := hub.can('promotions', 'view');
begin
  perform hub.require_permission('brands', 'view');
  for s in select value from jsonb_array_elements(hub.brand_registration_rows()) loop
    select * into b from hub.content_brand_rows('brands') where rem_brand_id = s->>'rem_brand_id' and deleted_at is null;
    if not found then
      rows := rows || jsonb_build_array(s || jsonb_build_object(
        'status', 'not_created', 'name_th', s->>'source_name_th', 'name_en', s->>'source_name_en',
        'description_th', null, 'slug', null, 'faq_count', 0, 'promotion_count', 0,
        'readiness', jsonb_build_object('ready', false, 'percent', 0, 'missing', '[]'::jsonb),
        'checks', '{}'::jsonb, 'optional_logos', '[]'::jsonb, 'updated_at', null, 'updated_by', null
      ));
      continue;
    end if;
    payload := hub.brand_draft_payload(b.id);
    ready := hub.brand_snapshot_readiness(payload);
    available := exists (select 1 from public_api.brands where id = b.id);
    changed := b.published_version_id is null or hub.brand_review_content(payload) is distinct from (
      select hub.brand_review_content(v.payload) from hub.brand_versions v where v.id = b.published_version_id
    );
    row_status := case when available and changed then 'published_changes' when available then 'published' when (ready->>'ready')::boolean then 'ready' else 'missing_data' end;
    checks := jsonb_build_object(
      'name_th_confirmed', nullif(btrim(b.public_name->>'th'), '') is not null and not ('th' = any(b.unconfirmed_source_names)),
      'description', not exists (select 1 from jsonb_array_elements(ready->'missing') m where m->>'field' = 'description.th'),
      'slug', not exists (select 1 from jsonb_array_elements(ready->'missing') m where m->>'field' = 'slug'),
      'primary_logo', not exists (select 1 from jsonb_array_elements(ready->'missing') m where m->>'field' = 'assets.logo_primary'),
      'logo_rights', jsonb_array_length(payload->'assets') > 0 and not exists (select 1 from jsonb_array_elements(ready->'missing') m where m->>'field' like 'assets.%.rights')
    );
    rows := rows || jsonb_build_array(s || jsonb_build_object(
      'id', b.id, 'public_brand_id', b.public_brand_id, 'status', row_status,
      'name_th', b.public_name->>'th', 'name_en', b.public_name->>'en',
      'description_th', nullif(btrim(b.description->>'th'), ''),
      'slug', nullif(btrim(b.slug), ''),
      'faq_count', case when can_know then (
        select count(*) from hub.faqs fq where fq.scope_type = 'brand' and fq.scope_id = b.public_brand_id and fq.state <> 'WITHDRAWN'
      ) else 0 end,
      'promotion_count', case when can_promo then (
        select count(*) from hub.public_promotions pr where pr.owning_brand_id = b.id and pr.ends_at > now() and hub.promotion_scope_visible(pr.id)
      ) else 0 end,
      'readiness', ready, 'checks', checks,
      'unconfirmed_source_names', b.unconfirmed_source_names,
      'publication_available', available, 'has_unpublished_changes', changed,
      'optional_logos', (select coalesce(jsonb_agg(distinct a->>'asset_role' order by a->>'asset_role'), '[]') from jsonb_array_elements(payload->'assets') a where a->>'asset_role' in ('logo_white', 'logo_mono', 'favicon')),
      'updated_at', b.updated_at, 'updated_by', b.updated_by, 'published_version_id', b.published_version_id
    ));
  end loop;
  select coalesce(jsonb_agg(r order by case when r->>'status' = 'not_created' then 100 else jsonb_array_length(r#>'{readiness,missing}') end desc, r->>'rem_brand_id'), '[]') into rows
  from jsonb_array_elements(rows) r;
  return jsonb_build_object('rows', rows, 'counts', jsonb_build_object(
    'total', jsonb_array_length(rows),
    'missing_data', (select count(*) from jsonb_array_elements(rows) r where r->>'status' <> 'not_created' and not (r#>>'{readiness,ready}')::boolean),
    'ready', (select count(*) from jsonb_array_elements(rows) r where r->>'status' <> 'not_created' and (r#>>'{readiness,ready}')::boolean and (not (r->>'publication_available')::boolean or (r->>'has_unpublished_changes')::boolean)),
    'published', (select count(*) from jsonb_array_elements(rows) r where (r->>'publication_available')::boolean),
    'published_changes', (select count(*) from jsonb_array_elements(rows) r where r->>'status' = 'published_changes'),
    'not_created', (select count(*) from jsonb_array_elements(rows) r where r->>'status' = 'not_created')
  ));
end $function$;

-- 8. Enrich hub.progress_rows with cover_image, card metrics, 4-pillar indicators, and group KM/FAQ counts
create or replace function hub.progress_rows(detail_id text default null::text)
returns table(summary jsonb)
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  can_know boolean := hub.can('knowledge', 'view');
  can_promo boolean := hub.can('promotions', 'view');
begin
  perform hub.require_permission('projects', 'view');
  return query
  with base_inputs as materialized (
    select c.* from hub.progress_inputs() c
    where detail_id is null or c.rem_project_id = detail_id
  ),
  visible_projects as materialized (
    select p.id, p.public_project_id, p.rem_project_id, p.brand_id
    from hub.content_project_rows('projects') p
    where p.deleted_at is null
      and (detail_id is null or p.rem_project_id = detail_id)
  ),
  project_covers as materialized (
    select vp.rem_project_id,
      (
        select jsonb_build_object('id', top_cand.id, 'public_url', top_cand.public_url)
        from (
          select cand.id, cand.public_url, row_number() over (order by cand.prio, cand.sec, cand.ord, cand.id) as rnk
          from (
            select a.id, a.public_url, case ea.asset_role when 'hero' then 1 else 2 end as prio, (not ea.is_primary)::int as sec, ea.display_order as ord
            from hub.entity_assets ea join hub.assets a on a.id = ea.asset_id
            where ea.project_id = vp.id and ea.model_id is null and ea.deleted_at is null and a.deleted_at is null
              and ea.asset_role in ('hero', 'thumbnail') and a.mime_type like 'image/%' and a.media_category is distinct from 'legal_document'
            union all
            select a.id, a.public_url,
              case
                when al.usage = 'hero' then 3
                when a.media_category = 'exterior' then 4
                when a.media_category = 'facility' then 5
                when a.media_category = 'interior' then 6
                else 7
              end as prio,
              0 as sec, al.sort as ord
            from hub.asset_links al join hub.assets a on a.id = al.asset_id
            where al.project_id = vp.id and al.deleted_at is null and a.deleted_at is null
              and a.mime_type like 'image/%'
              and coalesce(a.media_category, '') not in ('floor_plan', 'unit_plan', 'map', 'master_plan', 'legal_document', 'promotion_ad')
          ) cand
          order by cand.prio, cand.sec, cand.ord, cand.id
          limit 3
        ) top_cand
        where hub.can_read_asset(top_cand.id)
        order by top_cand.rnk
        limit 1
      ) as cover_image
    from visible_projects vp
  ),
  unit_stats as materialized (
    select ct.project_id, count(*)::integer as unit_count, min(ct.product_form) as product_form
    from hub.commercial_types ct
    join visible_projects vp on vp.id = ct.project_id
    where ct.deleted_at is null and ct.status <> 'withdrawn'
    group by ct.project_id
  ),
  price_stats as materialized (
    select distinct on (pr.project_id)
      pr.project_id,
      coalesce(nullif(btrim(pr.display_text->>'th'), ''), case when pr.amount is not null then to_char(round(pr.amount / 1000000.0, 2), 'FM999990.00') || ' ลบ.' end) as starting_price_text
    from hub.project_prices pr
    join visible_projects vp on vp.id = pr.project_id
    where pr.state <> 'withdrawn'
    order by pr.project_id, (pr.kind = 'starting') desc, pr.amount asc nulls last, pr.id
  ),
  km_stats as materialized (
    select cs.scope_id as public_project_id, count(*)::integer as section_count
    from hub.content_sections cs
    where cs.scope_type = 'project' and cs.state <> 'WITHDRAWN'
    group by cs.scope_id
  ),
  faq_stats as materialized (
    select fq.scope_id as rem_project_id, count(*)::integer as faq_count
    from hub.faqs fq
    where can_know and fq.scope_type = 'project' and fq.state <> 'WITHDRAWN'
    group by fq.scope_id
  ),
  group_km_stats as materialized (
    select cs.scope_id as group_id, count(*)::integer as km_count
    from hub.content_sections cs
    where can_know and cs.scope_type in ('project_group', 'rem_project_group') and cs.state <> 'WITHDRAWN'
    group by cs.scope_id
  ),
  group_faq_stats as materialized (
    select fq.scope_id as group_id, count(*)::integer as faq_count
    from hub.faqs fq
    where can_know and fq.scope_type in ('project_group', 'rem_project_group') and fq.state <> 'WITHDRAWN'
    group by fq.scope_id
  ),
  visible_promos as materialized (
    select pr.id, pr.project_id, pr.owning_brand_id, pr.owning_project_group_id, pr.all_active_projects
    from hub.public_promotions pr
    where can_promo and pr.ends_at > now() and hub.promotion_scope_visible(pr.id)
  )
  select
    (case when detail_id is not null then c.summary else
      jsonb_set(c.summary, '{checklist}', (c.summary->'checklist') - 'required' - 'recommended')
    end)
    || jsonb_build_object(
      'age_days', case when c.summary->>'first_seen_at' is not null then
        greatest(0, floor(extract(epoch from now() - (c.summary->>'first_seen_at')::timestamptz) / 86400))
      end,
      'cover_image', coalesce(nullif(c.summary->'thumbnail', 'null'::jsonb), pc.cover_image),
      'unit_type_count', coalesce(us.unit_count, (c.summary->>'confirmed_models')::integer, 0),
      'product_form', us.product_form,
      'starting_price_text', ps.starting_price_text,
      'km_section_count', coalesce(ks.section_count, 0),
      'faq_count', coalesce(fs.faq_count, 0),
      'promotion_count', case when vp.id is not null and can_promo then (
        select count(*)::integer from visible_promos pr
        where pr.project_id = vp.id or pr.owning_brand_id = vp.brand_id
           or (c.summary->>'marketing_project_group_id' is not null and pr.owning_project_group_id = c.summary->>'marketing_project_group_id')
           or pr.all_active_projects
      ) else 0 end,
      'group_km_count', coalesce(gks.km_count, 0),
      'group_faq_count', coalesce(gfs.faq_count, 0),
      'group_promotion_count', case when c.summary->>'marketing_project_group_id' is not null and can_promo then (
        select count(*)::integer from visible_promos pr
        where pr.owning_project_group_id = c.summary->>'marketing_project_group_id'
      ) else 0 end,
      'pillars', jsonb_build_object(
        'km', coalesce(ks.section_count, 0) > 0,
        'units', coalesce(us.unit_count, 0) > 0 or coalesce((c.summary->>'confirmed_models')::integer, 0) > 0,
        'media', (nullif(c.summary->'thumbnail', 'null'::jsonb) is not null or pc.cover_image is not null),
        'faq', coalesce(fs.faq_count, 0) > 0
      )
    )
  from base_inputs c
  left join visible_projects vp on vp.rem_project_id = c.rem_project_id
  left join project_covers pc on pc.rem_project_id = c.rem_project_id
  left join unit_stats us on us.project_id = vp.id
  left join price_stats ps on ps.project_id = vp.id
  left join km_stats ks on ks.public_project_id = vp.public_project_id
  left join faq_stats fs on fs.rem_project_id = c.rem_project_id
  left join group_km_stats gks on gks.group_id = c.summary->>'marketing_project_group_id'
  left join group_faq_stats gfs on gfs.group_id = c.summary->>'marketing_project_group_id'
  order by (c.summary#>>'{checklist,ready}')::boolean desc, (c.summary#>>'{checklist,percent}')::integer desc, c.rem_project_id;
end $function$;

-- 9. Add top-level scope_summaries to hub.workspace_tree when parent_kind is null
create or replace function hub.workspace_tree(
  parent_kind text default null::text,
  parent_ref text default null::text,
  query text default ''::text,
  after_key text default null::text,
  page_size integer default 50
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  rows jsonb;
  programmes jsonb := '[]';
  scope_summaries jsonb := '{}'::jsonb;
  faq_refs jsonb;
begin
  if page_size is null or page_size not between 1 and 100 or length(coalesce(query, '')) > 200
     or (parent_kind is null) <> (parent_ref is null) or length(coalesce(after_key, '')) > 220 then
    raise exception 'Invalid tree query' using errcode = '23514';
  end if;
  if not (hub.can('projects', 'view') or hub.can('brands', 'view') or hub.can('knowledge', 'view')) then
    raise exception 'Content view required' using errcode = '42501';
  end if;
  if parent_kind is not null and not hub.content_scope_allowed(parent_kind, parent_ref, 'view') then
    perform hub.workspace_faq_scope_access(parent_kind, parent_ref);
  end if;

  faq_refs := case
    when hub.can('knowledge', 'view') and (not hub.content_unrestricted('projects', 'view') or not hub.content_unrestricted('brands', 'view'))
    then hub.faq_references()
    else '{}'::jsonb
  end;

  with groups as materialized (select * from hub.workspace_confirmed_groups()),
  nodes as (
    select 'corporate' kind, 'sena' ref, hub.workspace_name('corporate', 'sena') name, null::text parent_type, null::text parent_id, 0 phases, 'unconfirmed' grouping, false faq_only, 'sena' code
    where hub.content_scope_allowed('corporate', 'sena', 'view')
    union all
    select 'business', code, label, 'corporate', 'sena', 0, 'unconfirmed', false, code
    from hub.businesses where hub.content_scope_allowed('business', code, 'view')
    union all
    select 'brand', b.public_brand_id, b.public_name,
      case when hub.content_scope_allowed('business', m.business_code, 'view') then 'business'
           when hub.content_scope_allowed('corporate', 'sena', 'view') then 'corporate' end,
      case when hub.content_scope_allowed('business', m.business_code, 'view') then m.business_code
           when hub.content_scope_allowed('corporate', 'sena', 'view') then 'sena' end,
      0, 'unconfirmed', false, b.rem_brand_id
    from hub.brands b left join hub.brand_business m on m.brand_id = b.id
    where b.deleted_at is null and hub.content_scope_allowed('brand', b.public_brand_id, 'view')
    union all
    select 'project', p.public_project_id, p.public_name,
      case when hub.content_scope_allowed('brand', b.public_brand_id, 'view') then 'brand' end,
      case when hub.content_scope_allowed('brand', b.public_brand_id, 'view') then b.public_brand_id end,
      coalesce(cardinality(g.members), 1),
      case when g.anchor is null then 'unconfirmed' else 'confirmed' end,
      false, p.rem_project_id
    from hub.projects p left join hub.brands b on b.id = p.brand_id left join groups g on g.anchor = p.public_project_id
    where p.deleted_at is null and hub.content_scope_allowed('project', p.public_project_id, 'view')
      and not exists (select 1 from groups x where p.id = any(x.members) and x.anchor <> p.public_project_id)
    union all
    select 'project', p.public_project_id, jsonb_build_object('th', x->>'name'), null, null, 0, 'unconfirmed', true, p.rem_project_id
    from hub.projects p join lateral jsonb_array_elements(faq_refs->'projects') x on x->>'id' = p.rem_project_id
    where p.deleted_at is null and not hub.content_scope_allowed('project', p.public_project_id, 'view')
      and hub.workspace_faq_scope_allowed('project', p.public_project_id, 'view')
    union all
    select 'brand', b.public_brand_id, jsonb_build_object('th', x->>'name'),
      case when hub.content_scope_allowed('business', m.business_code, 'view') then 'business' end,
      case when hub.content_scope_allowed('business', m.business_code, 'view') then m.business_code end,
      0, 'unconfirmed', true, b.public_brand_id
    from hub.brands b left join hub.brand_business m on m.brand_id = b.id
    join lateral jsonb_array_elements(faq_refs->'brands') x on x->>'id' = b.public_brand_id
    where b.deleted_at is null and not hub.content_scope_allowed('brand', b.public_brand_id, 'view')
      and hub.workspace_faq_scope_allowed('brand', b.public_brand_id, 'view')
  ),
  filtered as (
    select n.*, kind || ':' || ref key from nodes n
    where (parent_kind is null and (coalesce(query, '') <> '' or parent_type is null) or parent_type = parent_kind and parent_id = parent_ref)
      and (coalesce(query, '') = '' or position(lower(query) in lower(coalesce(name->>'th', '') || ' ' || coalesce(name->>'en', '') || ' ' || ref || ' ' || coalesce(code, ''))) > 0)
      and (after_key is null or kind || ':' || ref > after_key)
    order by kind || ':' || ref
    limit page_size + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', key, 'kind', kind, 'ref', ref, 'name', name, 'code', code, 'faq_only', faq_only,
    'target', hub.workspace_target(kind, ref, case when faq_only then 'faq' else 'overview' end),
    'parent', case when parent_type is not null then jsonb_build_object('kind', parent_type, 'ref', parent_id) end,
    'has_children', coalesce(query, '') = '' and exists (select 1 from nodes child where child.parent_type = filtered.kind and child.parent_id = filtered.ref),
    'visible_phase_count', phases,
    'grouping', jsonb_build_object(
      'state', grouping,
      'group_ref', case when grouping = 'confirmed' then ref end,
      'review_href', case when kind = 'project' and not faq_only and (hub.can('projects', 'view') or hub.can('knowledge', 'view')) then '/website/project/' || ref || '?tab=data' end
    )
  ) order by key), '[]') into rows from filtered;

  if parent_kind is null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', 'programme:' || x, 'kind', 'programme', 'ref', x, 'name', hub.workspace_name('programme', x),
      'target', hub.workspace_target('programme', x, 'overview'), 'parent', null, 'has_children', false,
      'visible_phase_count', (
        select count(*) from hub.content_project_rows('projects') p
        where p.deleted_at is null and exists (
          select 1 from hub.project_programmes pp
          where pp.project_id = p.id and upper(pp.programme_key) = x and pp.participating
        )
      ),
      'grouping', jsonb_build_object('state', 'unconfirmed', 'group_ref', null)
    ) order by x), '[]') into programmes
    from unnest(array['LIVNEX', 'LIVNEX_GOLD', 'RENTNEX', 'RENTNEX_BENEFIT', 'RENTNEX_INVEST']) x
    where hub.content_scope_allowed('programme', x, 'view')
      and (coalesce(query, '') = '' or position(lower(query) in lower(x || ' ' || coalesce(hub.workspace_name('programme', x)->>'th', ''))) > 0);

    if hub.can('knowledge', 'view') then
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into scope_summaries
      from (
        select 'corporate:sena' as k, jsonb_build_object(
          'section_count', (select count(*) from hub.content_sections where scope_type = 'corporate' and scope_id = 'sena' and state <> 'WITHDRAWN'),
          'faq_count', (select count(*) from hub.faqs where scope_type = 'corporate' and scope_id = 'sena' and state <> 'WITHDRAWN'),
          'contact_count', (select count(*) from hub.contacts where scope_type = 'corporate' and scope_id = 'sena'),
          'promotion_count', case when hub.can('promotions', 'view') then (
            select count(*) from hub.public_promotions pr where pr.promotion_tier in ('campaign', 'corporate') and pr.ends_at > now() and hub.promotion_scope_visible(pr.id)
          ) else 0 end,
          'project_count', (select count(*) from hub.content_project_rows('projects') where deleted_at is null)
        ) as v
        where hub.content_scope_allowed('corporate', 'sena', 'view')
        union all
        select 'programme:' || x, jsonb_build_object(
          'section_count', (select count(*) from hub.content_sections where scope_type = 'programme' and scope_id = x and state <> 'WITHDRAWN'),
          'faq_count', (select count(*) from hub.faqs where scope_type = 'programme' and scope_id = x and state <> 'WITHDRAWN'),
          'contact_count', 0,
          'promotion_count', case when hub.can('promotions', 'view') then (
            select count(*) from hub.public_promotions pr where upper(coalesce(pr.programme_key, '')) = x and pr.ends_at > now() and hub.promotion_scope_visible(pr.id)
          ) else 0 end,
          'project_count', (
            select count(*) from hub.content_project_rows('projects') p
            where p.deleted_at is null and exists (
              select 1 from hub.project_programmes pp where pp.project_id = p.id and upper(pp.programme_key) = x and pp.participating
            )
          )
        )
        from unnest(array['LIVNEX', 'LIVNEX_GOLD', 'RENTNEX', 'RENTNEX_BENEFIT', 'RENTNEX_INVEST']) x
        where hub.content_scope_allowed('programme', x, 'view')
        union all
        select 'business:' || bz.code, jsonb_build_object(
          'section_count', (select count(*) from hub.content_sections where scope_type = 'business' and scope_id = bz.code and state <> 'WITHDRAWN'),
          'faq_count', (select count(*) from hub.faqs where scope_type = 'business' and scope_id = bz.code and state <> 'WITHDRAWN'),
          'contact_count', (select count(*) from hub.contacts where scope_type = 'business' and scope_id = bz.code),
          'promotion_count', 0,
          'brand_count', (
            select count(*) from hub.brand_business bb join hub.content_brand_rows('brands') b on b.id = bb.brand_id
            where bb.business_code = bz.code and b.deleted_at is null
          )
        )
        from hub.businesses bz
        where hub.content_scope_allowed('business', bz.code, 'view')
      ) summary_rows;
    end if;
  end if;

  return jsonb_build_object(
    'items', case when jsonb_array_length(rows) > page_size then rows - (jsonb_array_length(rows) - 1) else rows end,
    'programmes', programmes,
    'scope_summaries', scope_summaries,
    'next_cursor', case when jsonb_array_length(rows) > page_size then rows->(page_size - 1)->>'key' end
  );
end $function$;

commit;
