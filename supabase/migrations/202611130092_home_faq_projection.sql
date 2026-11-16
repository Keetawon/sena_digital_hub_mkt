begin;

-- Native rows already use the scoped FAQ collection. Recheck the exact row
-- without constructing a discarded FAQ response and rescanning the collection.
do $$
declare definition text;
begin
 definition := replace(pg_get_functiondef('hub.workspace_native_rows_before_scopes()'::regprocedure), E'\r\n', E'\n');
 if position('from hub.content_faq_rows() f join hub.faq_versions v on v.id=f.draft_version_id' in definition) = 0 then
  raise exception 'Native FAQ source definition changed';
 end if;
 definition := hub.content_definition_replace(definition,
  'hub.workspace_faq_allowed(f.id)',
  'hub.content_source_allowed(''faqs'',to_jsonb(f),''knowledge'')');
 execute definition;
end $$;

-- Evaluate business membership only for the already-selected eligible question.
do $$
declare definition text;
 needle constant text := 'or f.scope_type=''business'' and hub.business_project_matches(f.scope_id,p.rem_project_id)';
begin
 definition := replace(pg_get_functiondef('hub.compose_project_faq(uuid,text,text,boolean,boolean)'::regprocedure), E'\r\n', E'\n');
 if cardinality(string_to_array(definition,needle)) <> 2 then
  raise exception 'Composer business predicate must occur exactly once';
 end if;
 definition := hub.content_definition_replace(definition,
  needle,
  $new$or case when f.scope_type='business'
       and v.question_key=q.question_key and v.state<>'WITHDRAWN' and f.state<>'WITHDRAWN'
       then hub.business_project_matches(f.scope_id,p.rem_project_id) else false end$new$);
 execute definition;
end $$;

commit;
