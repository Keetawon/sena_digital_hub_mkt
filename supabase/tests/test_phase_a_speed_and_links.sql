begin;

-- Verify Migration 0096:
-- 1. hub.list_project_summaries() enforces projects.view + scope filtering and returns minimal fields
-- 2. hub.workspace_tree returns '/website/project/<ref>?tab=data' review_href for source-visible projects
--    and null for faq_only callers, while hub.workspace_page clears the redundant top review_href
-- 3. Set-based hub.project_content_readiness_before_media, hub.media_checklist, hub.content_history,
--    hub.content_workflow_items, and hub.publication_queue_read execute cleanly under staff roles

do $$
declare
  editor_id uuid;
  viewer_id uuid;
  agency_id uuid;
  p record;
  summaries jsonb;
  tree_data jsonb;
  page_data jsonb;
  readiness_data jsonb;
  checklist_data jsonb;
  history_data jsonb;
  workflow_data jsonb;
  queue_data jsonb;
  node jsonb;
begin
  select id into editor_id from hub.user_account where status = 'ACTIVE' and hub_role = 'editor' order by created_at limit 1;
  select id into viewer_id from hub.user_account where status = 'ACTIVE' and hub_role = 'viewer' order by created_at limit 1;
  select id into agency_id from hub.user_account where status = 'ACTIVE' and hub_role = 'agency' order by created_at limit 1;

  select * into p from hub.projects where deleted_at is null order by public_project_id limit 1;
  if p.id is null then
    raise exception 'Expected at least one active project in disposable test fixture';
  end if;

  -- Agency cannot call list_project_summaries
  if agency_id is not null then
    perform set_config('app.actor_id', agency_id::text, true);
    begin
      perform hub.list_project_summaries();
      raise exception 'Agency should not access hub.list_project_summaries()';
    exception when insufficient_privilege then null;
    end;
  end if;

  -- Viewer can read project summaries and workspace projections
  perform set_config('app.actor_id', coalesce(viewer_id, editor_id)::text, true);
  summaries := hub.list_project_summaries();
  if jsonb_typeof(summaries) <> 'array' or jsonb_array_length(summaries) = 0 then
    raise exception 'Expected non-empty project summaries array, got %', summaries;
  end if;
  if not ((summaries->0) ? 'id' and (summaries->0) ? 'public_project_id' and (summaries->0) ? 'public_name') then
    raise exception 'Missing expected summary keys in %', summaries->0;
  end if;

  tree_data := hub.workspace_tree(null, null, p.public_project_id, null, 50);
  select value into node from jsonb_array_elements(tree_data->'items')
  where value->>'kind' = 'project' and value->>'ref' = p.public_project_id limit 1;
  if node is null then
    raise exception 'Project % not found in workspace_tree search', p.public_project_id;
  end if;
  if node#>>'{grouping,review_href}' <> ('/website/project/' || p.public_project_id || '?tab=data') then
    raise exception 'Expected direct project data edit href, got %', node#>'{grouping,review_href}';
  end if;

  page_data := hub.workspace_page('project', p.public_project_id, null);
  if page_data#>>'{entity,grouping,review_href}' is not null then
    raise exception 'Expected null entity.grouping.review_href on workspace_page, got %', page_data#>'{entity,grouping,review_href}';
  end if;

  readiness_data := hub.project_content_readiness_before_media(p.public_project_id);
  if jsonb_typeof(readiness_data->'items') <> 'array' then
    raise exception 'Expected items array from project_content_readiness_before_media';
  end if;

  checklist_data := hub.media_checklist(p.public_project_id);
  if jsonb_typeof(checklist_data->'items') <> 'array' then
    raise exception 'Expected items array from media_checklist';
  end if;

  history_data := hub.content_history('project', p.public_project_id, null, 5);
  if jsonb_typeof(history_data->'items') <> 'array' then
    raise exception 'Expected items array from content_history';
  end if;

  perform set_config('app.actor_id', editor_id::text, true);
  workflow_data := hub.content_workflow_items('project', p.public_project_id, null, null, 20);
  if jsonb_typeof(workflow_data->'items') <> 'array' then
    raise exception 'Expected items array from content_workflow_items';
  end if;

  queue_data := hub.publication_queue_read();
  if jsonb_typeof(queue_data->'items') <> 'array' then
    raise exception 'Expected items array from publication_queue_read';
  end if;
end $$;

rollback;
