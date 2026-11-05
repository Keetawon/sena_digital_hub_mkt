begin;
do $$ declare signature text;begin
 foreach signature in array array[
  'hub.workspace_tree(text,text,text,text,integer)','hub.workspace_page(text,text,text)',
  'hub.workspace_search(text,integer)',
  'hub.workspace_faq(text,text,text,text,text,integer,text)','hub.workspace_resolve(uuid,uuid,text)',
  'hub.workspace_preview(text,text,text,text)',
  'hub.content_history(text,text,bigint,integer)','hub.content_history_event(text,text,bigint)',
  'hub.content_activity(jsonb,bigint,integer)','hub.website_text_decide(text,uuid,bigint,text,integer,jsonb,text)',
  'hub.workspace_legacy_faq_candidates(uuid[])'] loop
  assert has_function_privilege('hub_app',signature,'execute'),signature;
  assert not has_function_privilege('agency',signature,'execute'),signature;
  assert not has_function_privilege('service_consumer',signature,'execute'),signature;
 end loop;
 foreach signature in array array['hub.workspace_admin()','hub.workspace_confirmed_groups()',
  'hub.workspace_faq_scope_access(text,text,text,text)','hub.workspace_faq_scope_allowed(text,text,text)',
  'hub.workspace_history_contexts(text,jsonb)','hub.workspace_history_fields(text,jsonb)',
  'hub.website_text_latest(uuid,uuid)','hub.content_scope_allowed(text,text,text)',
  'hub.review_knowledge_candidate_before_workspace(uuid,integer,text,text[],text,boolean,text,text)',
  'hub.review_knowledge_candidate_before_versions(uuid,integer,text,text[],text,boolean,text,text)'] loop
  assert not has_function_privilege('hub_app',signature,'execute'),signature;
 end loop;
 assert not has_table_privilege('hub_app','audit.change_log','select');
 assert not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='hub' and c.relname='website_text_decision');
end $$;
-- Preserve the existing Knowledge-only FAQ boundary under the real app role.
select set_config('test.workspace_public_id',(select public_project_id from hub.projects where deleted_at is null order by public_project_id limit 1),true);
update hub.account_permission set can_view=false,can_edit=false,can_approve=false,special_actions='{}'
 where account_id='00000000-0000-0000-0000-000000000003' and tab in ('projects','brands');
set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
do $$ declare page jsonb;discovered jsonb;ref text:=current_setting('test.workspace_public_id');begin
 page:=hub.workspace_page('project',ref,null);
 assert page->'tabs'='["faq","history"]'::jsonb and (page->>'faq_only')::boolean;
 assert page->'sections'='[]'::jsonb and page#>'{overview,preview_target}'='null'::jsonb;
 assert hub.workspace_faq('project',ref,null,'',null,1,'th')->'items' is not null;
 assert hub.workspace_faq('project',ref,null,'','q:workspace_missing_exact_sql',1,'th')->'items'='[]'::jsonb;
 assert hub.workspace_faq('project',ref,null,'','q:workspace_missing_exact_sql',1,'th')->'unmatched_clusters'='[]'::jsonb;
 assert hub.content_history('project',ref,null,1)->'items' is not null;
 discovered:=hub.workspace_search(ref,1)#>'{items,0}';
 assert discovered->>'ref'=ref and discovered#>>'{context,tab}'='faq';
 select item into discovered from jsonb_array_elements(hub.workspace_tree(null,null,ref,null,100)->'items') item where item->>'ref'=ref;
 assert discovered#>>'{target,tab}'='faq' and discovered->>'visible_phase_count'='0' and discovered->'parent'='null'::jsonb;
 begin perform hub.project_detail(ref);raise exception 'Source detail allowed through FAQ authority';exception when insufficient_privilege then null;end;
 begin perform hub.workspace_preview('project',ref,null,'th');raise exception 'Private source preview allowed through FAQ authority';exception when insufficient_privilege then null;end;
 begin perform hub.workspace_faq_scope_access('project',ref);raise exception 'Private FAQ scope helper callable';exception when insufficient_privilege then null;end;
 begin perform hub.content_activity('{}',null,50);raise exception 'Viewer activity allowed';exception when insufficient_privilege then null;end;
 begin perform hub.workspace_tree(null,null,'',null,101);raise exception 'Unbounded tree allowed';exception when check_violation then null;end;
 begin perform hub.workspace_resolve(null,null);raise exception 'Ambiguous resolution allowed';exception when check_violation then null;end;
 begin perform hub.workspace_faq('corporate','sena',null,'','u:broken',1,'th');raise exception 'Malformed unmatched cursor allowed';exception when check_violation then null;end;
 begin perform hub.workspace_faq('project',ref,null,'','q:invalid/key',1,'th');raise exception 'Malformed exact question allowed';exception when check_violation then null;end;
 begin perform hub.workspace_faq('project',ref,null,'search','q:workspace_missing_exact_sql',1,'th');raise exception 'Mixed exact and search allowed';exception when check_violation then null;end;
end $$;
rollback;
