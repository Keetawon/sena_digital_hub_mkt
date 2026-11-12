-- Disposable synthetic fixtures only. Every assertion rolls back with the data.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('app.change_reason','W2 native task regression',true);
select set_config('app.content_review_reason','W2 native task regression',true);

do $$ declare name text;begin
 foreach name in array array['hub.content_scope_allowed(text,text,text)','hub.workspace_require()',
  'hub.workspace_project_bu()','hub.workspace_faq_allowed(uuid)','hub.workspace_review_rows()',
  'hub.workspace_context(text,text)','hub.workspace_scope_matches(text,text,text[],text,text)',
  'hub.workspace_native_rows()','hub.workspace_native_publishable(jsonb)','hub.workspace_content_tasks(text,text)',
  'hub.workspace_project_readiness(text)','hub.workspace_brand_readiness(text)'] loop
  assert not has_function_privilege('hub_app',name,'execute') and not has_function_privilege('service_consumer',name,'execute'),
   'Private workspace helper is callable: '||name;
 end loop;
 assert has_function_privilege('hub_app','hub.workspace_search(text,integer)','execute')
  and has_function_privilege('hub_app','hub.workspace_home(text,text,integer,integer,text,uuid)','execute'),'Missing guarded entry point';
 assert not has_function_privilege('service_consumer','hub.workspace_search(text,integer)','execute')
  and not has_function_privilege('agency','hub.workspace_home(text,text,integer,integer,text,uuid)','execute'),'External principal reached workspace';
end $$;

insert into staging.rem_projects(rem_project_id,project_name_rem,source_fingerprint) values('W2-SQL','W2 synthetic project','w2-synthetic'),('W2-SQL-2','W2 second project','w2-synthetic-2'),('W2-SQL-3','W2 third project','w2-synthetic-3');
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_fingerprint,source_record)
 values('W2-SQL','W2-MODEL','W2 synthetic model','w2-synthetic','{"model_area":"30"}');
insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance,model_groups)
 values('W2-SQL','{"project_id":"W2-SQL","rem_bu_id":"  001-REM  ","rem_bu_code":"BU-001","rem_bu_name":"Fixture BU"}',now(),repeat('2',64),'{}','[{"project_model_key":"w2-group","model_name":"W2 source group","model_ids":["W2-MODEL"],"minimum_model_area":30,"maximum_model_area":30,"total_unit_count":10,"available_unit_count":1,"minimum_available_selling_price":2000000}]');
insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint)
 values('W2-BRAND','W2 synthetic brand',now(),'w2-brand');
insert into hub.brands(public_brand_id,rem_brand_id,public_name,slug) values('w2_brand','W2-BRAND','{"th":"W2 brand","en":"W2 brand"}','w2-brand');

-- BUD references come from the accepted membership snapshot, never DW staging.
do $$ declare token jsonb;accepted jsonb;begin
 token:=hub.content_bu_capture();
 accepted:=hub.content_bu_accept(jsonb_build_array(jsonb_build_object(
  'project_id','W2-SQL','rem_bu_id','  001-REM  ','rem_bu_code','BU-001','rem_bu_name','Fixture BU',
  'rem_bu_is_active',true,'rem_bu_is_deleted',false,'source_snapshot_at',clock_timestamp(),'project_status_code',null)),
  (token->>'accepted_run_id')::uuid,(token->>'acceptance_epoch')::bigint);
 assert accepted->>'status'='ACCEPTED';
end $$;

set local role hub_app;
select set_config('test.w2_project',hub.create_project_from_rem('W2-SQL')::text,true);
select hub.create_project_from_rem('W2-SQL-2');
select hub.create_project_from_rem('W2-SQL-3');
select set_config('test.w2_public',public_project_id,true) from hub.projects where id=current_setting('test.w2_project')::uuid;
select hub.save_project_building(current_setting('test.w2_public'),'W2-TOWER',0,'{"name":{"th":"W2 tower","en":"W2 tower"},"floors_above":2}');

do $$ declare p hub.projects;data jsonb;t record;model text;price uuid;progress uuid;begin
 select * into p from hub.projects where id=current_setting('test.w2_project')::uuid;
 select public_model_id into model from hub.model_types where project_id=p.id and rem_model_id='W2-MODEL';
 data:=hub.create_commercial_types(p.id,jsonb_build_array(jsonb_build_object('public_name','{"th":"W2 house","en":"W2 house"}'::jsonb,
  'description','{"th":"W2 description","en":"W2 description"}'::jsonb,'product_form','house','category','single_house','storeys',2,
  'price_mode','manual','source_model_ids',jsonb_build_array(model))),p.updated_at);
 perform set_config('test.w2_type',data#>>'{commercial_types,0,id}',true);
 perform set_config('test.w2_type_public',data#>>'{commercial_types,0,public_commercial_type_id}',true);
 for t in select * from hub.content_translations where owner_type='commercial_type' and owner_key=current_setting('test.w2_type') and btrim(th_text)<>'' loop
  perform hub.review_content_translation(t.id,t.revision,t.th_version,t.entered_en);
 end loop;
 perform hub.unit_type_review(p.public_project_id,current_setting('test.w2_type_public'),(select updated_at from hub.projects where id=p.id),'submit');
 data:=hub.save_project_price(p.public_project_id,null,(select updated_at from hub.projects where id=p.id),jsonb_build_object(
  'kind','starting','commercial_type_id',current_setting('test.w2_type'),'amount',2000000,'basis_size_sqm',30,
  'display_text','{"th":"W2 starting","en":"W2 starting"}'::jsonb,'basis','{"th":"W2 house","en":"W2 house"}'::jsonb,
  'condition_text','{"th":"W2 condition","en":"W2 condition"}'::jsonb,'valid_from',current_date,'valid_to',current_date+10));
 price:=(data->>'price_id')::uuid;perform set_config('test.w2_price',price::text,true);
 for t in select * from hub.content_translations where owner_type='price' and owner_key=price::text and btrim(th_text)<>'' loop
  perform hub.review_content_translation(t.id,t.revision,t.th_version,t.entered_en);
 end loop;
 perform hub.project_price_review(p.public_project_id,price,(select updated_at from hub.projects where id=p.id),'submit');
 data:=hub.save_project_commercial(p.public_project_id,'construction',null,(select updated_at from hub.projects where id=p.id),
  jsonb_build_object('component','structure','percent',30,'as_of',current_date,'source','construction','ai_exposure','web_only'));
 progress:=(data->>'id')::uuid;perform set_config('test.w2_progress',progress::text,true);
 perform hub.review_project_commercial(p.public_project_id,'construction',progress,(select updated_at from hub.projects where id=p.id),'submit');
 perform hub.save_faq_question('w2_question',0,'{"topic":"design","default_level":"project","question_template":{"th":"W2 question","en":"W2 question"},"answer_kind":"text"}');
 perform hub.save_glossary('w2_term',0,'{"th":"W2 term","en":"W2 term"}');
 perform hub.content_workflow_submit('question','{"question_key":"w2_question"}',
  hub.content_workflow_read('question','{"question_key":"w2_question"}')->>'expected_hash');
 perform hub.content_workflow_submit('glossary','{"term_key":"w2_term"}',
  hub.content_workflow_read('glossary','{"term_key":"w2_term"}')->>'expected_hash');
end $$;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);

do $$ declare tasks jsonb;begin
 tasks:=hub.workspace_home(null,null,0,100,'approval')->'tasks';
 assert exists(select 1 from jsonb_array_elements(tasks) t where t->>'kind'='question' and t#>>'{context,question}'='w2_question'),'Question approval missing';
 assert exists(select 1 from jsonb_array_elements(tasks) t where t->>'kind'='glossary' and t#>>'{context,term}'='w2_term'),'Glossary approval target missing';
 assert exists(select 1 from jsonb_array_elements(tasks) t where t->>'item_id'=current_setting('test.w2_progress') and t->>'version_id' is not null),'Commercial approval lacks frozen version';
 perform set_config('app.content_review_reason','Synthetic returned work item',true);
 perform hub.unit_type_review(current_setting('test.w2_public'),current_setting('test.w2_type_public'),(select updated_at from hub.projects where id=current_setting('test.w2_project')::uuid),'return');
 perform hub.project_price_review(current_setting('test.w2_public'),current_setting('test.w2_price')::uuid,(select updated_at from hub.projects where id=current_setting('test.w2_project')::uuid),'return');
 perform hub.review_project_commercial(current_setting('test.w2_public'),'construction',current_setting('test.w2_progress')::uuid,(select updated_at from hub.projects where id=current_setting('test.w2_project')::uuid),'return');
 perform set_config('app.content_review_reason','',true);
 perform hub.approve_faq_question('w2_question',(select revision from hub.faq_questions where question_key='w2_question'),'approved');
end $$;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);

do $$ declare tasks jsonb;kind text;saved jsonb;t record;begin
 tasks:=hub.workspace_home(null,null,0,100,'returned')->'tasks';
 foreach kind in array array['unit_type','price','construction_progress'] loop
  assert exists(select 1 from jsonb_array_elements(tasks) x where x->>'kind'=kind and x#>>'{context,project}'=current_setting('test.w2_public') and x->>'version_id' is not null),'Returned native revision vanished: '||kind;
 end loop;
 saved:=hub.save_faq(null,0,jsonb_build_object('scope_type','project','scope_id','W2-SQL','question_key','w2_question',
  'question','{"th":"W2 question","en":"W2 question"}'::jsonb,'short_answer','{"th":"W2 answer","en":"W2 answer"}'::jsonb,
  'answer_kind','text','applies_to_project_ids',jsonb_build_array('W2-SQL'),'review_due',current_date+5,'effective_to',current_date+15));
 perform set_config('test.w2_faq',saved->>'id',true);
 for t in select * from hub.content_translations where owner_type='faq' and owner_key=current_setting('test.w2_faq') and btrim(th_text)<>'' loop
  perform hub.review_content_translation(t.id,t.revision,t.th_version,t.entered_en);
 end loop;
 perform hub.submit_faq(current_setting('test.w2_faq')::uuid,(select revision from hub.faqs where id=current_setting('test.w2_faq')::uuid));
 -- A new submission supersedes the returned task; history remains intact.
 perform hub.review_project_commercial(current_setting('test.w2_public'),'construction',current_setting('test.w2_progress')::uuid,(select updated_at from hub.projects where id=current_setting('test.w2_project')::uuid),'submit');
 assert not exists(select 1 from jsonb_array_elements(hub.workspace_home(null,null,0,100,'returned')->'tasks') task_row where task_row->>'item_id'=current_setting('test.w2_progress')),'Resubmitted item still returned';
end $$;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.review_project_commercial(current_setting('test.w2_public'),'construction',current_setting('test.w2_progress')::uuid,
 (select updated_at from hub.projects where id=current_setting('test.w2_project')::uuid),'approve');
reset role;

-- Native publication tasks require an independent Online caller, never merely A.
-- The test harness has configured a separate, explicit View-only publisher.

do $$ declare r jsonb;begin
 select value into r from hub.workspace_native_rows() value where value->>'item_id'=current_setting('test.w2_progress');
 assert r->>'state'='APPROVED' and jsonb_array_length(r->'approvers')=1,'Approved native certificate missing';
 assert not hub.workspace_native_publishable(r),'Approver acquired publish task';
 perform set_config('app.actor_id',pg_temp.w4_actor('publisher')::text,true);
 select value into r from hub.workspace_native_rows() value where value->>'item_id'=current_setting('test.w2_progress');
 assert hub.workspace_native_publishable(r),'Independent source viewer lacks eligible publish task';
 assert not hub.workspace_native_publishable(r||'{"current_material":false}'),'Stale native material remained publishable';
 assert not hub.workspace_native_publishable(r||jsonb_build_object('reviewers',jsonb_build_array(hub.permission_actor()))),'English reviewer acquired publish task';
 assert not hub.workspace_native_publishable(r||jsonb_build_object('approvers',jsonb_build_array(hub.permission_actor()))),'Self-approver acquired publish task';
end $$;

-- A Knowledge Manager can review a text FAQ without unrelated Projects View.
update hub.account_permission set can_view=false,can_edit=false,can_approve=false,special_actions='{}'
 where account_id='00000000-0000-0000-0000-000000000002' and tab='projects';
set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ declare data jsonb;begin
 data:=hub.workspace_home(null,null,0,100);
 assert data->'projects'='[]','Revoked project readiness leaked';
 assert exists(select 1 from jsonb_array_elements(data->'tasks') t where t->>'category'='approval' and t->>'item_id'=current_setting('test.w2_faq')),'Knowledge-only FAQ approval missing';
 assert exists(select 1 from jsonb_array_elements(data->'tasks') t where t->>'category'='review_due' and t->>'item_id'=current_setting('test.w2_faq') and (t->>'due')::date=current_date+5),'FAQ review date became expiry';
 assert exists(select 1 from jsonb_array_elements(data->'tasks') t where t->>'category'='expiring' and t->>'item_id'=current_setting('test.w2_faq') and (t->>'due')::date=current_date+15),'FAQ expiry missing';
end $$;
reset role;

-- Brands-only accounts retain independent brand readiness, without project counts.
update hub.account_permission set can_view=false,can_edit=false,can_approve=false,special_actions='{}'
 where account_id='00000000-0000-0000-0000-000000000003' and tab<>'brands';
set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
do $$ declare data jsonb;b jsonb;begin
 data:=hub.workspace_home(null,'w2_brand',0,100);
 assert data->'projects'='[]' and data->'buds'='[]','Brands-only account received Projects data';
 select value into b from jsonb_array_elements(data->'brands') where value->>'ref'='w2_brand';
 assert b is not null and (b->>'projects')::int=0 and (b->>'required_missing')::int>0,'Brand readiness depends on Projects';
 assert exists(select 1 from jsonb_array_elements(b#>'{readiness,items}') i where i#>>'{context,brand}'='w2_brand' and i#>>'{context,usage}'='logo_primary'),'Brand logo slot lacks exact target';
end $$;
reset role;

-- Exact media contexts survive the old readiness wrapper, including floors.
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$ declare data jsonb;begin
 data:=hub.workspace_project_readiness(current_setting('test.w2_public'));
 assert data-'items'=hub.project_content_readiness(current_setting('test.w2_public'))-'items','Home readiness summary differs from the canonical readiness';
 assert exists(select 1 from jsonb_array_elements(data->'items') i where i#>>'{context,target_type}'='building_floor'
  and i#>>'{context,building}'='W2-TOWER' and i#>>'{context,floor_from}'='1' and i#>>'{context,tab}'='media'),'Building-floor media slot lost';
 assert exists(select 1 from jsonb_array_elements(data->'items') i where i#>>'{context,unit_type}'=current_setting('test.w2_type_public') and i#>>'{context,target_key}'=current_setting('test.w2_type') and i#>>'{context,tab}'='media'),'Unit media slot lost its public selection or internal binding target';
 assert exists(select 1 from jsonb_array_elements(data->'items') i where i->>'field_key'='project.public_name' and i#>>'{context,tab}'='identity'),'Identity field routed to facts';
 assert hub.workspace_scope_matches('brand','w2_brand','{}',null,'w2_brand'),'Brand scope filter dropped matching brand';
end $$;

insert into hub.content_gaps(id,project_id,gap_code) values
 ('82000000-0000-0000-0000-000000000001','W2-SQL','NO_ANSWER'),
 ('82000000-0000-0000-0000-000000000002','W2-SQL','NO_ANSWER');

do $$ declare before_count bigint;before_gaps bigint;data jsonb;begin
 select count(*) into before_count from audit.change_log;select count(*) into before_gaps from hub.content_gaps;
 data:=hub.workspace_home(null,'not-a-filter-match',100000,1,'publish','82000000-0000-0000-0000-000000000002');
 assert data#>>'{selected_gap,item_id}'='82000000-0000-0000-0000-000000000002','Exact gap lookup was paginated or filtered away';
 assert data#>>'{selected_gap,context,project}'=current_setting('test.w2_public') and data#>>'{selected_gap,context,gap}'='82000000-0000-0000-0000-000000000002','Gap target is generic';
 assert data#>>'{selected_gap,question_text_available}'='false','Unavailable raw question was invented';
 perform hub.workspace_home();perform hub.workspace_search('W2',20);
 assert (select count(*) from audit.change_log)=before_count and (select count(*) from hub.content_gaps)=before_gaps,'Workspace GET wrote history or gaps';
 assert exists(select 1 from jsonb_array_elements(hub.workspace_search('001-REM',20)->'items') i where i->>'kind'='bud' and i->>'ref'='  001-REM  '),'BU key was normalized';
 data:=hub.workspace_search('W2',3);
 assert jsonb_array_length(data->'items')=3 and (select count(distinct i->>'kind') from jsonb_array_elements(data->'items') i)=3,'Projects monopolized mixed search limit';
 assert exists(select 1 from jsonb_array_elements(data->'items') i where i->>'kind'='brand')
  and exists(select 1 from jsonb_array_elements(data->'items') i where i->>'kind'='question'),'Mixed search omitted brand or FAQ question';
 perform set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
 assert hub.workspace_home(null,null,0,1,null,'82000000-0000-0000-0000-000000000002')->'selected_gap'='null'::jsonb,'Unauthorized gap existence leaked';
end $$;
set local role hub_app;
select set_config('app.actor_id','10000000-0000-0000-0000-000000000082',true);
do $$ begin
 begin perform hub.workspace_search('test',20);raise exception 'Unknown actor reached search';exception when insufficient_privilege then null;end;
 begin perform hub.workspace_home();raise exception 'Unknown actor reached home';exception when insufficient_privilege then null;end;
end $$;
rollback;
