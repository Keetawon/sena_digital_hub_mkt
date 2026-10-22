-- Synthetic K3 evidence, rolled back after checking private composition semantics.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
insert into staging.rem_projects(rem_project_id,project_name_rem,source_fingerprint) values
 ('K3-SQL-A','Synthetic K3 A','k3-a'),('K3-SQL-B','Synthetic K3 B','k3-b'),('K3-SQL-C','Synthetic K3 C','k3-c');
select hub.create_project_from_rem(rem_project_id) from staging.rem_projects where rem_project_id like 'K3-SQL-%';
insert into staging.intake_batches(manifest_sha256,manifest,datasets) values(repeat('c',64),'{}','{}') on conflict do nothing;
insert into staging.dw_project_groups(project_group_id,source_record,manifest_sha256) values('K3-GROUP','{}',repeat('c',64));
insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance)
 select rem_project_id,jsonb_build_object('project_id',rem_project_id,'rem_project_group_id','K3-GROUP'),now(),repeat('c',64),'{}' from hub.projects where rem_project_id like 'K3-SQL-%';
update hub.projects set brand_id=(select id from hub.brands where deleted_at is null order by id limit 1),
 public_name=jsonb_build_object('th',rem_project_id,'en',rem_project_id) where rem_project_id like 'K3-SQL-%';
insert into hub.commercial_types(project_id,public_name,product_form)
 select id,jsonb_build_object('th',rem_project_id),case rem_project_id when 'K3-SQL-A' then 'condominium' when 'K3-SQL-B' then 'house' end
 from hub.projects where rem_project_id like 'K3-SQL-%';
insert into hub.project_programmes(project_id,programme_key,participating,as_of,state)
 select id,'livnex',true,current_date,'approved' from hub.projects where rem_project_id='K3-SQL-A';

do $$ declare p hub.projects;u hub.commercial_types;b text;rule jsonb;result jsonb;saved jsonb;q text:='synthetic_k3_sql';s text;ref text;f uuid;v uuid;r integer:=0;begin
 select * into p from hub.projects where rem_project_id='K3-SQL-A';
 select * into u from hub.commercial_types where project_id=p.id;
 select public_brand_id into b from hub.brands where id=p.brand_id;
 rule:=jsonb_build_object('brand_ids',array[b],'group_ids',array['K3-GROUP'],'product_forms',array['condominium']);
 assert hub.faq_rule_projects(rule,'corporate','sena')=array['K3-SQL-A'],'Rule must intersect brand/group/form';
 assert hub.faq_rule_projects('{"group_ids":["K3-GROUP"]}','programme','LIVNEX')=array['K3-SQL-A'],'Programme membership escaped';
 result:=hub.faq_applicability_preview(rule,'corporate','sena');
 assert result->'project_ids'='["K3-SQL-A"]' and result#>>'{unresolved_forms,0,id}'='K3-SQL-C','Unknown form inferred or lost';
 assert not (result->>'frozen')::boolean,'Draft preview claimed publication';
 insert into hub.commercial_types(project_id,public_name) values(p.id,'{"th":"Unknown type"}');
 assert hub.faq_project_form(p.id) is null,'Unknown type silently classified';
 delete from hub.commercial_types where project_id=p.id and product_form is null;

 -- Owner fixture creates the approved bank entry; runtime API tests cover four-eyes.
 insert into hub.faq_questions(question_key,topic,default_level,question_template,answer_kind,is_core,show_on_project_pages,status)
 values(q,'design','project','{"th":"{project} concept"}','text',true,true,'approved');
 foreach s in array array['corporate','brand','programme','project_group','project','unit_type'] loop
  ref:=case s when 'corporate' then 'sena' when 'brand' then b when 'programme' then 'LIVNEX' when 'project_group' then 'K3-GROUP' when 'project' then p.rem_project_id else u.id::text end;
  saved:=hub.save_faq(null,0,jsonb_build_object('question_key',q,'scope_type',s,'scope_id',ref,'question','{"th":"{project} concept"}'::jsonb,
   'short_answer',jsonb_build_object('th','{project} '||s),'answer_kind','text','applies_to_project_ids',array[p.rem_project_id]));
  f:=(saved->>'id')::uuid;v:=(select draft_version_id from hub.faqs where id=f);
  result:=hub.compose_project_faq(p.id,'th',u.public_commercial_type_id,false,false);
  assert (select x->>'scope_type' from jsonb_array_elements(result->'items') x where x->>'question_key'=q)=s,'Scope precedence wrong';
  assert not exists(select 1 from jsonb_array_elements(hub.compose_project_faq(p.id,'th',u.public_commercial_type_id,true,false)->'items') x where x->>'question_key'=q),'Draft leaked into published mode';
 end loop;
 update hub.faq_versions set state='PUBLISHED',approved_by='00000000-0000-0000-0000-000000000002',approved_at=now() where id=v;
 update hub.faqs set state='PUBLISHED',published_version_id=v where id=f;
 result:=hub.compose_project_faq(p.id,'th',u.public_commercial_type_id,true,false);
 assert (select x->>'state' from jsonb_array_elements(result->'items') x where x->>'question_key'=q)='published','Approved unit answer missing';
 insert into hub.faq_questions(question_key,topic,default_level,question_template,answer_kind,status)
 values('synthetic_k3_rekey','design','project','{"th":"New draft question"}','text','approved');
 update hub.faqs set question_key='synthetic_k3_rekey' where id=f;
 result:=hub.compose_project_faq(p.id,'th',u.public_commercial_type_id,true,false);
 assert (select x->>'scope_type' from jsonb_array_elements(result->'items') x where x->>'question_key'=q)='unit_type','Identity edit relabelled the published version';
 assert not exists(select 1 from jsonb_array_elements(result->'items') x where x->>'question_key'='synthetic_k3_rekey'),'Draft question key leaked into published composition';
 update hub.faq_versions set state='PUBLISHED',approved_by='00000000-0000-0000-0000-000000000002',approved_at=now()
 where faq_id in (select id from hub.faqs where question_key=q and scope_type='corporate');
 update hub.faqs set state='PUBLISHED',published_version_id=draft_version_id where question_key=q and scope_type='corporate';
 result:=hub.compose_project_faq(p.id,'th',null,true,false);
 assert (select x->>'state' from jsonb_array_elements(result->'items') x where x->>'question_key'=q)='inherited','Published corporate inheritance missing';
 -- Rule snapshots at save, then drift is visible; publication will freeze again.
 saved:=hub.save_faq(null,0,jsonb_build_object('question_key',q,'scope_type','corporate','scope_id','sena','question','{"th":"{project} concept"}'::jsonb,
  'short_answer','{"th":"{project} rule"}'::jsonb,'answer_kind','text','applicability_rule',rule));
 assert saved#>'{version,applies_to_project_ids}'='["K3-SQL-A"]' and saved#>'{version,applicability_rule}'=rule,'Rule was not saved';
 update hub.commercial_types set product_form='condominium' where project_id=(select id from hub.projects where rem_project_id='K3-SQL-B');
 assert hub.faq_rule_projects(rule,'corporate','sena')=array['K3-SQL-A','K3-SQL-B'],'Rule did not resolve current projects';
 result:=hub.compose_project_faq((select id from hub.projects where rem_project_id='K3-SQL-B'),'th',null,false,false);
 assert (select (x->>'applicability_changed')::boolean from jsonb_array_elements(result->'items') x where x->>'question_key'=q),'Rule drift not flagged';
 assert not(result->>'ready')::boolean,'Drift passed readiness';
 assert not has_function_privilege('hub_app','hub.compose_project_faq(uuid,text,text,boolean,boolean)','execute'),'Private composer is executable by runtime';
 assert not has_function_privilege('hub_app','hub.faq_fact_slot(uuid,text,text,text,boolean)','execute'),'Private fact slot is executable by runtime';
 assert not has_function_privilege('hub_app','hub.faq_rule_projects(jsonb,text,text)','execute'),'Private rule resolver is executable by runtime';
end $$;

do $$ declare p uuid;result jsonb;candidate uuid;cluster uuid;begin
 select id into p from hub.projects where rem_project_id='K3-SQL-C';
 insert into hub.faq_questions(question_key,topic,default_level,question_template,answer_kind,is_core,property_types,status) values
 ('synthetic_k3_form','design','project','{"th":"Housing type"}','text',true,array['house'],'approved'),
 ('synthetic_k3_legacy','design','project','{"th":"Legacy source"}','text',true,'{}','approved');
 result:=hub.compose_project_faq(p,'th',null,false,false);
 assert (select x->>'reason' from jsonb_array_elements(result->'cells') x where x->>'question_key'='synthetic_k3_form')='unknown_property_form','Unknown form is not a hold';
 result:=hub.compose_project_faq((select id from hub.projects where rem_project_id='K3-SQL-A'),'th',null,false,false);
 assert (select x->>'state' from jsonb_array_elements(result->'cells') x where x->>'question_key'='synthetic_k3_form')='not_applicable','Known incompatible form not distinguished';
 insert into staging.knowledge_batches(manifest_sha256,manifest) values(repeat('9',64),'{}');
 insert into staging.knowledge_candidates(batch_sha256,source_key,kind,project_ids,topic,source_ref,evidence)
 values(repeat('9',64),'k3-synthetic-legacy','faq',array['K3-SQL-C'],'design','synthetic K3','{}') returning id into candidate;
 insert into staging.faq_clusters(cluster_key,generation_sha256,algorithm,sort_key,template,member_candidate_ids,variants,answer_groups,project_ids,suggested_question_key,suggested_level,suggested_kind,suggestion_basis)
 values(repeat('9',64),repeat('9',64),'synthetic',99999,'Legacy source',array[candidate],jsonb_build_array(jsonb_build_object('candidate_id',candidate)),'[]',array['K3-SQL-C'],'synthetic_k3_legacy','project','text','question_bank') returning id into cluster;
 result:=hub.compose_project_faq(p,'th',null,false,false);
 assert (select x->>'state' from jsonb_array_elements(result->'cells') x where x->>'question_key'='synthetic_k3_legacy')='legacy_candidate','Legacy candidate missing';
 update staging.faq_clusters set holds=array['numeric'] where id=cluster;
 result:=hub.compose_project_faq(p,'th',null,false,false);
 assert (select x->>'state' from jsonb_array_elements(result->'cells') x where x->>'question_key'='synthetic_k3_legacy')='hold','Held legacy candidate not distinguished';
 insert into hub.faq_intake_decisions(cluster_id,cluster_revision,decision,candidate_ids,note,decided_by)
 values(cluster,1,'rejected',array[candidate],'Synthetic rejection','00000000-0000-0000-0000-000000000001');
 result:=hub.compose_project_faq(p,'th',null,false,false);
 assert (select x->>'state' from jsonb_array_elements(result->'cells') x where x->>'question_key'='synthetic_k3_legacy')='missing','Rejected source still suggested';
end $$;

do $$ declare p uuid;slot jsonb;begin
 select id into p from hub.projects where rem_project_id='K3-SQL-A';
 insert into hub.field_catalog(field_key,entity,section,label,value_kind,source_policy)
 values('project.synthetic_boolean','project','facts','{"th":"Synthetic boolean"}','bool','mkt');
 insert into hub.project_facts(project_id,fact_key,value_bool,source,as_of,ai_exposure)
 values(p,'project.synthetic_boolean',false,'mkt',current_date,'open');
 slot:=hub.faq_fact_slot(p,'project.synthetic_boolean','en',null,false);
 assert slot->'value'='false' and slot->>'text'='No' and (slot->>'available')::boolean,'False treated as missing';
 assert not (hub.faq_fact_slot(p,'project.synthetic_boolean','en',null,true)->>'available')::boolean,'Unapproved fact leaked';
 update hub.project_facts set approved_by='00000000-0000-0000-0000-000000000002',approved_at=now() where project_id=p;
 assert (hub.faq_fact_slot(p,'project.synthetic_boolean','en',null,true)->>'available')::boolean,'Approved fact unavailable';
 update hub.project_facts set ai_exposure='internal' where project_id=p;
 assert not (hub.faq_fact_slot(p,'project.synthetic_boolean','en',null,false)->>'available')::boolean,'Internal fact leaked';
 insert into hub.project_facts(project_id,fact_key,value_number,source,as_of,ai_exposure)
 values(p,'project.parking_regular',0,'mkt',current_date,'open'),(p,'project.unit_total',100,'mkt',current_date,'open');
 assert hub.faq_fact_slot(p,'project.parking_pct_regular','en',null,false)->'value'='0','Computed zero lost';
 assert not(hub.faq_fact_slot(p,'project.parking_pct_total','en',null,false)->>'available')::boolean,'Unknown tandem spaces treated as zero';
 assert not(hub.faq_fact_slot(p,'project.parking_pct_regular','en',null,true)->>'available')::boolean,'Unapproved derived value leaked';
 assert hub.faq_lint('K3-SQL-A value 10','', 'K3-SQL-A','',array['project.unit_total'],'fact') ? 'use_fact_slots_for_numbers','Typed numbers passed lint';
 assert hub.faq_lint('K3-SQL-A value {unit_total}','', 'K3-SQL-A','',array['project.unit_total'],'fact')='[]','Numbers in project name were rejected';
end $$;
rollback;
