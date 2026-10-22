-- Phase 4 FAQ intake: FORCE RLS, audit, closed operator regeneration and immutable decisions.
begin;
do $$ declare rel regclass; begin
 foreach rel in array array['staging.faq_clusters'::regclass,'hub.faq_intake_decisions'::regclass] loop
  assert (select relrowsecurity and relforcerowsecurity from pg_class where oid=rel),rel::text||' lacks FORCE RLS';
  assert exists(select 1 from pg_trigger where tgrelid=rel and tgname='intake_audit'),rel::text||' lacks audit';
  assert not has_table_privilege('hub_app',rel,'SELECT,INSERT,UPDATE,DELETE'),rel::text||' exposes direct access';
 end loop;
 assert exists(select 1 from pg_trigger where tgrelid='hub.faq_intake_decisions'::regclass and tgname='intake_decision_immutable'),'Decisions are mutable';
 assert not has_function_privilege('hub_app','staging.replace_faq_clusters(text,text,jsonb)','EXECUTE'),'API can regenerate clusters';
 assert not has_function_privilege('hub_app','hub.faq_intake_state(uuid)','EXECUTE'),'Private state helper is exposed';
 assert has_function_privilege('hub_app','hub.decide_faq_cluster(uuid,integer,text,jsonb)','EXECUTE'),'Decision entry point missing';
end $$;

insert into staging.knowledge_batches(manifest_sha256,manifest) values(repeat('e',64),'{"purpose":"synthetic faq intake sql"}');
with c as (
 insert into staging.knowledge_candidates(batch_sha256,source_key,kind,project_ids,topic,source_ref,evidence)
 values(repeat('e',64),'sql-intake','faq','{DEMO-001}','design','synthetic sql intake',
  '{"canonical_question":{"th":"โครงการตัวอย่างมีลานกิจกรรมสมมติไหม"},"short_answer":{"th":"มีลานกิจกรรมสมมติ"}}') returning id)
select set_config('test.intake_candidate',id::text,true) from c;
select staging.replace_faq_clusters(repeat('d',64),'sql-test',jsonb_build_array(jsonb_build_object(
 'cluster_key',repeat('c',64),'sort_key',1,'template','{project} มีลานกิจกรรมสมมติไหม','member_candidate_ids',jsonb_build_array(current_setting('test.intake_candidate')),
 'variants',jsonb_build_array(jsonb_build_object('candidate_id',current_setting('test.intake_candidate'))),'answer_groups','[]'::jsonb,
 'project_ids','["DEMO-001"]'::jsonb,'brand_ids','[]'::jsonb,'holds','[]'::jsonb,'suggested_level','project','suggested_kind','text','suggestion_basis','heuristic')));

set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$ declare page jsonb; cluster uuid; decided jsonb; begin
 page:=hub.faq_intake_clusters('{}',0,100);
 cluster:=(select (i->>'id')::uuid from jsonb_array_elements(page->'items') i where i->>'template'='{project} มีลานกิจกรรมสมมติไหม');
 assert cluster is not null,'Knowledge V cannot read the cluster list';
 begin perform 1 from staging.faq_clusters; assert false,'Direct cluster read accepted'; exception when insufficient_privilege then null; end;
 decided:=hub.decide_faq_cluster(cluster,1,'reject','{"note":"synthetic rejection"}');
 assert decided#>>'{status,state}'='decided','Rejection was not recorded';
 assert jsonb_array_length(decided->'decisions')=1,'Decision history missing';
 begin perform hub.decide_faq_cluster(cluster,2,'reject','{"note":"again"}'); assert false,'Decided cluster changed';
 exception when check_violation then null; end;
end $$;
reset role;
do $$ begin
 begin update hub.faq_intake_decisions set note='rewritten'; assert false,'Decision rewritten'; exception when check_violation then null; end;
 begin perform staging.replace_faq_clusters(repeat('d',64),'sql-test','[]'); end;
 assert (select count(*) from staging.faq_clusters where cluster_key=repeat('c',64))=1,'Regeneration removed a decided cluster';
end $$;
rollback;
