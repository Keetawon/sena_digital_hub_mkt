-- W4 storage/ACL contract; runtime state transitions are exercised by API tests.
begin;
do $$ declare function_name text;begin
 assert (select not separate_edit_approve from hub.permission_catalog where tab='projects');
 assert (select not separate_edit_approve from hub.permission_catalog where tab='brands');
 assert (select separate_edit_approve from hub.permission_catalog where tab='promotions');
 assert (select relrowsecurity and relforcerowsecurity from pg_class where oid='hub.content_review_versions'::regclass);
 assert not has_table_privilege('hub_app','hub.content_review_versions','INSERT,UPDATE,DELETE,SELECT');
 assert exists(select 1 from pg_trigger where tgrelid='hub.content_review_versions'::regclass and tgname='workflow_audit');
 assert exists(select 1 from pg_trigger where tgrelid='staging.dw_projects'::regclass and tgname='content_staged_invalidation');
 foreach function_name in array array['hub.content_workflow_source(text,jsonb,text)','hub.content_workflow_lock(text,jsonb,text,text)',
  'hub.content_workflow_staged_values(text,jsonb)','hub.content_workflow_authors(text,jsonb,jsonb)','hub.content_staged_invalidation()','hub.content_workflow_history_staged(jsonb)','hub.content_workflow_history_review(text,jsonb)','hub.content_self_review(uuid[])','hub.content_native_authors()',
  'hub.translation_editable_before_workflow(hub.content_translations)'] loop
  assert not has_function_privilege('hub_app',function_name,'EXECUTE'),function_name||' is an open helper';
 end loop;
 foreach function_name in array array['hub.content_workflow_read(text,jsonb)','hub.content_workflow_submit(text,jsonb,text)',
  'hub.content_workflow_review(text,jsonb,text,text,text)','hub.content_workflow_save_approve(text,jsonb,text,jsonb,text)'] loop
  assert has_function_privilege('hub_app',function_name,'EXECUTE'),function_name||' missing runtime grant';
 end loop;
 assert exists(select 1 from pg_constraint where conrelid='hub.account_permission'::regclass and conname='web_publish_requires_view');
 assert not exists(select 1 from pg_constraint where conrelid='hub.account_permission'::regclass and conname='web_publish_requires_approval');
 assert hub.content_workflow_history_staged('{"project.unit_total":120,"rem_bu_id":"hidden","source_snapshot_at":"hidden","building":{"name":{"th":"Synthetic"},"floors_above":12,"unit_count":120,"private":"hidden"}}')=
  '{"project.unit_total":120,"building":{"name":{"th":"Synthetic"},"floors_above":12,"unit_count":120}}'::jsonb;
 assert hub.content_workflow_material('{"title":"Kept","_form_updated_at":"2026-11-05T01:00:00Z","_tab":"projects","_tabs":["projects"]}')='{"title":"Kept"}'::jsonb;
 assert hub.content_workflow_payload('unit_type','{"title":"Kept","_form_updated_at":"2026-11-05T01:00:00Z"}')='{"title":"Kept"}'::jsonb;
 assert hub.content_workflow_hash('{"id":"same","_form_updated_at":"old"}')<>hub.content_workflow_hash('{"id":"same","_form_updated_at":"new"}');
 assert hub.content_workflow_history_staged('{"project.phase_count":3,"rem_project_group_id":"hidden","rem_bu_id":"hidden","as_of":"hidden"}')='{"project.phase_count":3}'::jsonb;
 assert hub.content_workflow_authors('selling_point','{"project_id":"00000000-0000-4000-8000-000000000001","point_key":"00000000-0000-4000-8000-000000000002"}',
  '{"created_by":"00000000-0000-4000-8000-000000000003","editors":[],"revision":2}')=array['00000000-0000-4000-8000-000000000003'::uuid];
 assert hub.workspace_history_fields('hub.user_account','{"password":"hidden","email":"hidden"}')='{}'::jsonb;
end $$;
rollback;
