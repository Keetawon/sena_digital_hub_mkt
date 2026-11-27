-- Disposable synthetic fixtures only. Every assertion rolls back with the data.
begin;
select set_config('app.actor_id', '00000000-0000-0000-0000-000000000001', true);
select set_config('app.change_reason', 'KM dashboard and fast workspace regression', true);
select set_config('app.content_review_reason', 'KM dashboard and fast workspace regression', true);

insert into staging.rem_brands(rem_brand_id, brand_name_rem, source_updated_at, source_fingerprint)
  values ('KM98-BR', 'KM98 Brand', now(), 'km98-brand');
insert into hub.brands(public_brand_id, rem_brand_id, public_name, description, slug)
  values ('km98_brand', 'KM98-BR', '{"th":"แบรนด์ KM98","en":"KM98 Brand"}', '{"th":"คำอธิบายแบรนด์ KM98"}', 'km98-brand');

insert into staging.rem_projects(rem_project_id, project_name_rem, rem_brand_id, source_fingerprint)
  values ('KM98-P1', 'KM98 Phase 1', 'KM98-BR', 'km98-p1');
insert into staging.dw_projects(rem_project_id, source_record, source_snapshot_at, source_fingerprint, provenance, model_groups)
  values ('KM98-P1', '{"project_id":"KM98-P1","marketing_project_group_id":"GRP-KM98","marketing_project_group_name":"กลุ่ม KM98"}', now(), repeat('9', 64), '{}', '[]');

set local role hub_app;
select set_config('test.km98_project', hub.create_project_from_rem('KM98-P1')::text, true);
select set_config('test.km98_public', public_project_id, true)
  from hub.projects where id = current_setting('test.km98_project')::uuid;

-- Link brand_id and bind an exterior image in hub.asset_links without hub.entity_assets thumbnail to verify cover_image fallback.
reset role;
update hub.projects
set brand_id = (select id from hub.brands where public_brand_id = 'km98_brand')
where id = current_setting('test.km98_project')::uuid;
with inserted_asset as (
  insert into hub.assets(
    original_filename, mime_type, public_url,
    media_category, metadata_state, rights_status, ai_exposure
  ) values (
    'exterior.jpg', 'image/jpeg', '/demo-assets/km98-exterior.jpg',
    'exterior', 'confirmed', 'approved', 'open'
  ) returning id
)
insert into hub.asset_links(project_id, asset_id, target_type, target_key, usage, sort, ai_exposure)
select current_setting('test.km98_project')::uuid, id, 'project', current_setting('test.km98_project'), 'gallery', 0, 'open'
from inserted_asset;

set local role hub_app;

do $$
declare
  prog_page jsonb;
  home_payload jsonb;
  brand_payload jsonb;
  brand_row jsonb;
  prog_row jsonb;
  tree_payload jsonb;
  corp_hist jsonb;
  prj_hist jsonb;
begin
  -- 1. Programme workspace_page exposes 'data' tab when knowledge.view is granted
  prog_page := hub.workspace_page('programme', 'LIVNEX', null);
  assert (prog_page->'tabs') ? 'data', 'Expected programme workspace_page tabs to include data';

  -- 2. Personal action dashboard payload includes task_counts, scope_summary, and project card fields
  home_payload := hub.workspace_home(null, 'km98_brand', 0, 25, null, null);
  assert home_payload ? 'task_counts' and (home_payload->'task_counts') ? 'returned', 'Expected task_counts in workspace_home';
  assert home_payload ? 'scope_summary' and (home_payload->'scope_summary') ? 'visible_projects', 'Expected scope_summary in workspace_home';
  assert jsonb_array_length(home_payload->'projects') = 1, 'Expected filtered KM98 project in workspace_home';
  assert (home_payload#>'{projects,0,cover_image,id}') is not null, 'Expected cover_image resolved from asset_links in workspace_home';

  -- 3. Brand completeness includes description_th, slug, faq_count, promotion_count
  brand_payload := hub.brand_completeness();
  select value into brand_row from jsonb_array_elements(brand_payload->'rows') where value->>'public_brand_id' = 'km98_brand';
  assert brand_row is not null, 'Expected km98_brand in brand_completeness';
  assert brand_row->>'description_th' = 'คำอธิบายแบรนด์ KM98', 'Expected description_th in brand_completeness';
  assert brand_row ? 'faq_count' and brand_row ? 'promotion_count', 'Expected faq_count and promotion_count in brand_completeness';

  -- 4. Project progress_rows resolves cover_image from asset_links while keeping thumbnail null, plus 4-pillar readiness
  select summary into prog_row from hub.progress_rows('KM98-P1');
  assert prog_row is not null, 'Expected KM98-P1 in progress_rows';
  assert (prog_row->'thumbnail') = 'null'::jsonb or (prog_row->'thumbnail') is null, 'Expected entity_assets thumbnail to remain null';
  assert (prog_row#>'{cover_image,id}') is not null, 'Expected cover_image resolved from asset_links in progress_rows';
  assert (prog_row#>'{pillars,media}')::boolean = true, 'Expected pillars.media true when cover_image exists';

  -- 5. Root workspace_tree includes scope_summaries for corporate & programmes
  tree_payload := hub.workspace_tree(null, null, '', null, 50);
  assert (tree_payload->'scope_summaries') ? 'corporate:sena', 'Expected corporate:sena in workspace_tree scope_summaries';
  assert (tree_payload->'scope_summaries') ? 'programme:LIVNEX', 'Expected programme:LIVNEX in workspace_tree scope_summaries';

  -- 6. Content history executes cleanly across corporate and project scopes
  corp_hist := hub.content_history('corporate', 'sena', null, 10);
  prj_hist := hub.content_history('project', current_setting('test.km98_public'), null, 10);
  assert jsonb_typeof(corp_hist->'items') = 'array' and jsonb_typeof(prj_hist->'items') = 'array', 'Expected history items array';
end $$;

rollback;
