-- Both original publication histories remain immutable and share the boundary.
begin;
do $$ declare name text;begin
 foreach name in array array['entity_versions','brand_versions','promotion_versions'] loop
  assert exists(select 1 from information_schema.columns where table_schema='hub' and table_name=name and column_name='review_evidence');
  assert exists(select 1 from pg_trigger where tgrelid=('hub.'||name)::regclass and tgname='z_publication_approval');
  assert not has_table_privilege('hub_app','hub.'||name,'INSERT,UPDATE,DELETE');
 end loop;
 foreach name in array array['hub.publication_actor()','hub.publication_write_lock()','hub.publication_certificate(text,jsonb,jsonb)',
  'hub.publication_dependency_check(jsonb,boolean,boolean)','hub.publication_sanitize(jsonb,jsonb,boolean)',
  'hub.publication_workflow_descriptor(text,jsonb)','hub.publication_item_descriptor(jsonb)','hub.publication_release_prepared(jsonb,boolean)',
  'hub.publication_retained_reviewer_evidence(jsonb,uuid)','hub.publication_retained_media_source(jsonb)','hub.publication_task_context(text,jsonb)',
  'hub.publication_task_native_ready(text,jsonb,jsonb)','hub.publication_task_published(jsonb)','hub.publication_expiry_tasks(text,text)','hub.workspace_content_tasks(text,text)',
  'hub.content_preview_compose(hub.web_pages)','hub.content_preview_project(uuid)','hub.content_preview_sections(text,text)',
  'hub.content_preview_faqs(uuid)','hub.content_preview_scope_faq(text,text)','hub.content_preview_output(jsonb,text,boolean)',
  'hub.content_preview_resolve(jsonb,text,boolean,boolean)','hub.content_preview_source_available(jsonb)',
  'hub.publication_pinned_source(jsonb)','hub.publication_pinned_fact(jsonb,jsonb)','hub.publication_fact_dependencies(uuid,text,jsonb)',
  'hub.publication_release_core(jsonb,text,boolean)','hub.web_source_available_before_workflow(jsonb)'] loop
  assert not has_function_privilege('hub_app',name,'EXECUTE'),name||' exposes an implementation bypass';
 end loop;
 assert has_function_privilege('hub_app','hub.content_workflow_items(text,text,text,text,integer)','EXECUTE');
 foreach name in array array['admin','editor','publisher','viewer','service_consumer'] loop
  assert not has_function_privilege(name,'hub.content_workflow_items(text,text,text,text,integer)','EXECUTE'),name||' may call the app-only saved-item RPC';
 end loop;
 assert has_function_privilege('hub_app','hub.publication_queue_read()','EXECUTE');
 assert has_function_privilege('hub_app','hub.publication_queue_prepare(jsonb,text)','EXECUTE');
 assert has_function_privilege('hub_app','hub.publication_queue_publish(uuid,text)','EXECUTE');
 assert has_function_privilege('hub_app','hub.publication_queue_return(text,jsonb,text,text)','EXECUTE');
 assert to_regclass('hub.publication_releases') is not null and to_regclass('hub.web_publications') is not null;
end $$;
rollback;
