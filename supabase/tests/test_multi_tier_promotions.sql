-- Disposable, rollback-only five-tier contract. Every RPC uses hub_app.
-- test-db.mjs supplies the existing residential publication fixture first.
begin;
select set_config('app.actor_id',pg_temp.w4_actor('author')::text,true);
insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint)
values('SQL-MULTI-TIER-97','Synthetic five-tier brand',now(),'SQL-MULTI-TIER-97');
insert into staging.rem_projects(rem_project_id,project_name_rem,rem_brand_id,source_updated_at,source_fingerprint,source_record)
select 'SQL-MULTI-TIER-97-'||n,'Synthetic five-tier phase '||n,'SQL-MULTI-TIER-97',now(),'SQL-MULTI-TIER-97-'||n,
 jsonb_build_object('synthetic_only',true,'is_active',n<>3) from generate_series(1,3) n;
set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
select set_config('test.multi_brand',hub.create_brand_from_rem('SQL-MULTI-TIER-97')::text,true);
select set_config('app.actor_id',pg_temp.w4_actor('author')::text,true);
select set_config('test.multi_a',hub.create_project_from_rem('SQL-MULTI-TIER-97-1')::text,true);
select set_config('test.multi_b',hub.create_project_from_rem('SQL-MULTI-TIER-97-2')::text,true);
select set_config('test.multi_c',hub.create_project_from_rem('SQL-MULTI-TIER-97-3')::text,true);
select hub.assign_project_brand(id,current_setting('test.multi_brand')::uuid,updated_at)
from hub.projects where id in(current_setting('test.multi_a')::uuid,current_setting('test.multi_b')::uuid,current_setting('test.multi_c')::uuid);
reset role;
insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance)
select 'SQL-MULTI-TIER-97-'||n,jsonb_build_object('project_id','SQL-MULTI-TIER-97-'||n,'rem_project_group_id','SQL-GROUP-97'),now(),repeat('9',64),'{"synthetic_only":true}'
from generate_series(1,2) n;
insert into hub.project_programmes(project_id,programme_key,participating,as_of,state,approved_by,approved_at)
select id,'sql_97',true,current_date,case when id=current_setting('test.multi_c')::uuid then 'draft' else 'approved' end,
 case when id<>current_setting('test.multi_c')::uuid then pg_temp.w4_actor('reviewer') end,
 case when id<>current_setting('test.multi_c')::uuid then now() end
from hub.projects where id in(current_setting('test.multi_a')::uuid,current_setting('test.multi_b')::uuid,current_setting('test.multi_c')::uuid);
insert into hub.project_programmes(project_id,programme_key,participating,as_of,state)
values(current_setting('test.multi_b')::uuid,'hidden_97',false,current_date,'draft');
create temp table multi_tier_cases(tier text primary key,body jsonb,row_data jsonb);
insert into multi_tier_cases(tier,body) values
 ('campaign',jsonb_build_object('promotion_tier','campaign','targets',jsonb_build_array(jsonb_build_object('type','project_group','id','SQL-GROUP-97')))),
 ('corporate','{"promotion_tier":"corporate","programme_key":"SQL_97"}'),
 ('brand',jsonb_build_object('promotion_tier','brand','owning_brand_id',current_setting('test.multi_brand'))),
 ('project_group','{"promotion_tier":"project_group","owning_project_group_id":"SQL-GROUP-97"}'),
 ('project',jsonb_build_object('promotion_tier','project','project_id',current_setting('test.multi_a')));
update multi_tier_cases set body=body||jsonb_build_object('code','SQL-MULTI-97-'||upper(tier),'title',jsonb_build_object('th','ทดสอบโปรโมชั่นห้าระดับ'),
 'summary',jsonb_build_object('th','ข้อมูลทดสอบ'),'conditions_public',jsonb_build_object('th','เงื่อนไขทดสอบ'),
 'legal_terms',jsonb_build_object('th','ข้อกำหนดทดสอบ'),'disclaimer',jsonb_build_object('th','ข้อมูลสังเคราะห์เท่านั้น'),
 'benefit_type','other','starts_at',now(),'ends_at',now()+interval '30 days','synthetic',true,
 'highlight_badge',jsonb_build_object('th','ส่วนลดและฟรีค่าโอน'),
 'benefit_items','[{"benefit_type":"discount_amount","benefit_value":"250000.50","benefit_unit":"THB","label":{"th":"ส่วนลดเงินสด"}},{"benefit_type":"free_transfer_fee","benefit_value":null,"benefit_unit":null,"label":{"th":"ฟรีค่าโอน"}}]'::jsonb);
grant select,update on multi_tier_cases to hub_app;
set local role hub_app;
do $$ declare item record;r jsonb;result jsonb;expected integer;begin
 for item in select * from multi_tier_cases loop
  r:=hub.promotion_command('create',null,item.body);
  update multi_tier_cases set row_data=r where tier=item.tier;
  expected:=case item.tier when 'project' then 1 when 'brand' then 3 else 2 end;
  assert r->>'promotion_tier'=item.tier,'Tier was not retained';
  assert (r#>>'{scope,count}')::integer=expected,'Unexpected resolved project scope';
  assert r->>'benefit_type'='discount_amount' and r->>'benefit_value'='250000.50' and r->>'benefit_unit'='THB','Primary benefit was not synchronized';
  assert jsonb_array_length(r->'benefit_items')=2,'Package items lost';
  result:=hub.promotion_read(null,jsonb_build_object('tier',item.tier,'q','SQL-MULTI-97-'));
  assert result->>'total'='1' and result#>>'{items,0,id}'=r->>'id','Tier/search filter failed';
 end loop;
 result:=hub.promotion_read(null,'{"tier":"project","q":"SQL-MULTI-97-","limit":1}');
 assert result#>>'{tier_counts,all}'='5','Tier counts were paginated or tier-filtered';
 assert result#>>'{items,0,status_group}'='draft' and result#>>'{status_counts,draft}'='1';
 result:=hub.promotion_read(null,'{"tier":"project","q":"SQL-MULTI-97-","status":"live","limit":1}');
 assert result->>'total'='0' and result#>>'{status_counts,draft}'='1','Status filter ran after pagination/counts';
 result:=hub.promotion_resolve(jsonb_build_object('promotion_tier','campaign','all_active_projects',true,
  'targets',jsonb_build_array(jsonb_build_object('type','project','id',current_setting('test.multi_c')))));
 assert not exists(select 1 from jsonb_array_elements(result->'items') x where x->>'id'=current_setting('test.multi_c')),
  'All-active explicit targets reintroduced inactive projects';
 result:=hub.promotion_resolve(jsonb_build_object('promotion_tier','campaign','all_active_projects',true,
  'excluded_project_ids',jsonb_build_array(current_setting('test.multi_a'))));
 assert not exists(select 1 from jsonb_array_elements(result->'items') x where x->>'id' in(current_setting('test.multi_a'),current_setting('test.multi_c'))),
  'All-active scope included an excluded or inactive project';
 assert exists(select 1 from jsonb_array_elements(result->'items') x where x->>'id'=current_setting('test.multi_b'));
 result:=hub.workspace_promotions('project',(select public_project_id from hub.projects where id=current_setting('test.multi_a')::uuid));
 assert (select count(distinct x->>'promotion_tier') from jsonb_array_elements(result->'items') x where x->>'code' like 'SQL-MULTI-97-%')=5,'Missing contextual tier';
 assert exists(select 1 from jsonb_array_elements(result->'items') x where x->>'applies_via'='corporate' and jsonb_array_length(x->'benefit_items')=2),'Contextual package missing';
 assert hub.workspace_promotions('project_group','SQL-GROUP-97')->>'total' is not null;
 assert hub.workspace_promotions('corporate','sena')->>'total' is not null;
 assert hub.workspace_page('project_group','SQL-GROUP-97')->'tabs' ? 'promotions','Group promotion tab missing';
 assert hub.workspace_page('corporate','sena')->'tabs' ? 'promotions','Corporate promotion tab missing';
 result:=hub.promotion_references();
 assert exists(select 1 from jsonb_array_elements(result->'project_groups') x where x->>'id'='SQL-GROUP-97' and x->>'member_project_count'='2' and x->>'phase_count'='2');
 assert exists(select 1 from jsonb_array_elements(result->'programmes') x where x->>'programme_key'='sql_97');
end $$;

-- Invalid packages and immutable owner/tier edits never change draft revision.
do $$ declare r jsonb;bad jsonb;begin
 select row_data into r from multi_tier_cases where tier='project';
 foreach bad in array array['{}'::jsonb,'[{}]'::jsonb,
  '[{"benefit_type":"gift","benefit_value":12,"benefit_unit":"items","label":{"th":"ของขวัญ"}}]'::jsonb,
  '[{"benefit_type":"discount_pct","benefit_value":"101","benefit_unit":"percent","label":{}}]'::jsonb,
  '[{"benefit_type":"discount_amount","benefit_value":"1,000","benefit_unit":"THB","label":{}}]'::jsonb,
  (select jsonb_agg(jsonb_build_object('benefit_type','gift','benefit_value',null,'benefit_unit',null,'label','{}'::jsonb)) from generate_series(1,21))] loop
  begin perform hub.promotion_command('update',(r->>'id')::uuid,jsonb_build_object('expected_revision',1,'benefit_items',bad));
   raise exception 'Invalid benefit package accepted';exception when check_violation or invalid_parameter_value then null;end;
 end loop;
 foreach bad in array array[jsonb_build_object('promotion_tier','campaign'),jsonb_build_object('project_id',current_setting('test.multi_b')),
  jsonb_build_object('owning_project_group_id','SQL-GROUP-97')] loop
  begin perform hub.promotion_command('update',(r->>'id')::uuid,jsonb_build_object('expected_revision',1)||bad);
   raise exception 'Owner mutation accepted';exception when invalid_parameter_value or check_violation then null;end;
 end loop;
 assert hub.promotion_read((r->>'id')::uuid)->>'draft_revision'='1';
 begin perform hub.promotion_command('update',(r->>'id')::uuid,jsonb_build_object('expected_revision',1,'targets',
  jsonb_build_array(jsonb_build_object('type','project','id',current_setting('test.multi_b')))));
  raise exception 'Explicit project tier expanded beyond owner';exception when check_violation then null;end;
 begin perform hub.promotion_command('update',(r->>'id')::uuid,'{"expected_revision":1,"legacy_scope":true}');
  raise exception 'Caller forged legacy compatibility marker';exception when invalid_parameter_value then null;end;
 assert not hub.promotion_read((r->>'id')::uuid)?'legacy_scope','Internal legacy marker leaked';
 r:=hub.promotion_command('update',(r->>'id')::uuid,'{"expected_revision":1,"benefit_value":"300000.25"}');
 assert r#>>'{benefit_items,0,benefit_value}'='300000.25' and jsonb_array_length(r->'benefit_items')=2,'Legacy primary edit lost package';
 update multi_tier_cases set row_data=r where tier='project';
 select row_data into r from multi_tier_cases where tier='corporate';
 r:=hub.promotion_command('update',(r->>'id')::uuid,jsonb_build_object('expected_revision',1,'excluded_project_ids',jsonb_build_array(current_setting('test.multi_b'))));
 assert r#>>'{scope,count}'='1','Programme exclusion failed';
 update multi_tier_cases set row_data=r where tier='corporate';
end $$;
reset role;
do $$ declare p uuid:=(select (row_data->>'id')::uuid from multi_tier_cases where tier='project');begin
 begin update hub.public_promotions set promotion_tier='campaign',project_id=null where id=p;
  raise exception 'Owner trigger permitted tier mutation';exception when check_violation then null;end;
end $$;

-- A former editor cannot approve their own row after becoming a reviewer.
set local role hub_app;
do $$ declare r jsonb;promotion_body jsonb;begin
 select body-'synthetic'||jsonb_build_object('synthetic',false,'code','SQL-MULTI-97-REAL') into promotion_body from multi_tier_cases where tier='project';
 r:=hub.promotion_command('create',null,promotion_body);
 perform set_config('test.multi_real',r::text,true);
end $$;
reset role;
update hub.account_permission set can_edit=false,can_approve=true where account_id=pg_temp.w4_actor('author') and tab='promotions';
set local role hub_app;
do $$ declare r jsonb:=current_setting('test.multi_real')::jsonb;begin
 begin perform hub.promotion_command('review',(r->>'id')::uuid,jsonb_build_object('expected_revision',1,'review_type','DATA','decision','APPROVED',
  'expected_scope_hash',r#>>'{scope,scope_hash}','evidence','Synthetic independent review check','change_reason','Synthetic check'));
  raise exception 'Editor approved own real promotion';exception when insufficient_privilege then null;end;
end $$;
reset role;
update hub.account_permission set can_edit=true,can_approve=false where account_id=pg_temp.w4_actor('author') and tab='promotions';
insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance)
select rem_project_id,jsonb_build_object('project_id',rem_project_id,'rem_project_group_id','SQL-PUBLIC-GROUP-97'),now(),repeat('7',64),'{"synthetic_only":true}'
from hub.projects where id=current_setting('test.residential_project')::uuid
on conflict(rem_project_id) do update set source_record=excluded.source_record;
set local role hub_app;

-- Approved review scope is frozen and a stale scope hash is refused.
do $$ declare r jsonb;begin
 select row_data into r from multi_tier_cases where tier='campaign';
 r:=hub.promotion_command('update',(r->>'id')::uuid,jsonb_build_object('expected_revision',r->'draft_revision',
  'excluded_project_ids',jsonb_build_array(current_setting('test.multi_b')),
  'targets',jsonb_build_array(jsonb_build_object('type','project_group','id','SQL-PUBLIC-GROUP-97'),
   jsonb_build_object('type','project','id',current_setting('test.multi_b')))));
 update multi_tier_cases set row_data=r where tier='campaign';
end $$;
select set_config('app.actor_id',pg_temp.w4_actor('reviewer')::text,true);
do $$ declare r jsonb;lane text;begin
 select row_data into r from multi_tier_cases where tier='campaign';
 begin perform hub.promotion_command('review',(r->>'id')::uuid,jsonb_build_object('expected_revision',r->'draft_revision','review_type','DATA','decision','APPROVED',
  'expected_scope_hash',repeat('0',64),'evidence','Synthetic stale scope','change_reason','Synthetic test'));
  raise exception 'Stale scope hash accepted';exception when serialization_failure then null;end;
 foreach lane in array array['DATA','LEGAL'] loop
  r:=hub.promotion_command('review',(r->>'id')::uuid,jsonb_build_object('expected_revision',r->'draft_revision','review_type',lane,'decision','APPROVED',
   'expected_scope_hash',r#>>'{scope,scope_hash}','evidence','Synthetic independent scope review','change_reason','Synthetic test'));
 end loop;
 update multi_tier_cases set row_data=r where tier='campaign';
end $$;
select set_config('app.actor_id',pg_temp.w4_actor('publisher')::text,true);
do $$ declare r jsonb;begin
 select row_data into r from multi_tier_cases where tier='campaign';
 r:=hub.promotion_command('publish',(r->>'id')::uuid,jsonb_build_object('expected_revision',r->'draft_revision',
  'expected_published_version_id',null,'change_reason','Synthetic frozen five-tier publication'));
 assert r->>'published_version_id' is not null;
 update multi_tier_cases set row_data=r where tier='campaign';
end $$;
reset role;
select set_config('test.multi_frozen',(select to_jsonb(v)::text from hub.promotion_versions v join multi_tier_cases c on v.promotion_id=(c.row_data->>'id')::uuid where c.tier='campaign'),true);
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ declare published jsonb;begin
 select payload into published from public_api.read_promotions() where code='SQL-MULTI-97-CAMPAIGN';
 assert published is not null,'Grouped campaign absent from published read';
 assert strpos(published::text,'SQL-PUBLIC-GROUP-97')=0,'Internal source group identity leaked to public';
 assert jsonb_array_length(published->'targets')=1 and published#>>'{targets,0,type}'='project','Group target did not use public project identities';
end $$;
reset role;
set local role hub_app;
select set_config('app.actor_id',pg_temp.w4_actor('author')::text,true);
do $$ declare r jsonb;begin
 select row_data into r from multi_tier_cases where tier='campaign';
 r:=hub.promotion_command('update',(r->>'id')::uuid,jsonb_build_object('expected_revision',r->'draft_revision','excluded_project_ids',jsonb_build_array(current_setting('test.multi_b')),
  'targets',jsonb_build_array(jsonb_build_object('type','project_group','id','SQL-GROUP-97')),
  'title',jsonb_build_object('th','ฉบับร่างที่เปลี่ยนภายหลัง')));
 assert r#>>'{scope,count}'='1';
 update multi_tier_cases set row_data=r where tier='campaign';
end $$;
reset role;
do $$ declare frozen jsonb:=current_setting('test.multi_frozen')::jsonb;begin
 assert (select to_jsonb(v) from hub.promotion_versions v where id=(frozen->>'id')::uuid)=frozen,'Draft edited frozen snapshot';
 begin update hub.promotion_versions set payload='{}' where id=(frozen->>'id')::uuid;
  raise exception 'Version snapshot was mutable';exception when check_violation then null;end;
 assert jsonb_array_length(frozen#>'{payload,target_project_ids}')=1;
end $$;

-- A locked conversation cannot record evidence for another phase even when
-- the same published offer is eligible and visible on both phases.
set local role hub_app;
do $$ declare body jsonb;r jsonb;run jsonb;receipt jsonb;source jsonb;lane text;phase_a text;phase_b text;begin
 select public_project_id into phase_a from hub.projects where id=current_setting('test.residential_project')::uuid;
 select public_project_id into phase_b from hub.projects where id=current_setting('test.multi_other_published_project')::uuid;
 perform set_config('app.actor_id',pg_temp.w4_actor('author')::text,true);
 select c.body||jsonb_build_object('code','SQL-ASSISTANT-SHARED-97','benefit_items','[]'::jsonb,'benefit_type','other',
  'benefit_value',null,'benefit_unit',null,'targets',jsonb_build_array(
   jsonb_build_object('type','project','id',current_setting('test.residential_project')),
   jsonb_build_object('type','project','id',current_setting('test.multi_other_published_project')))) into body
 from multi_tier_cases c where tier='campaign';
 r:=hub.promotion_command('create',null,body);
 perform set_config('app.actor_id',pg_temp.w4_actor('reviewer')::text,true);
 foreach lane in array array['DATA','LEGAL'] loop
  r:=hub.promotion_command('review',(r->>'id')::uuid,jsonb_build_object('expected_revision',r->'draft_revision','review_type',lane,
   'decision','APPROVED','expected_scope_hash',r#>>'{scope,scope_hash}','evidence','Synthetic shared publication','change_reason','Synthetic approval'));
 end loop;
 perform set_config('app.actor_id',pg_temp.w4_actor('publisher')::text,true);
 r:=hub.promotion_command('publish',(r->>'id')::uuid,jsonb_build_object('expected_revision',r->'draft_revision',
  'expected_published_version_id',null,'change_reason','Synthetic receipt boundary'));
 assert hub.promotion_read(null,jsonb_build_object('published_project_id',current_setting('test.residential_project'),
  'published_promotion_id',r->>'id'))->>'total'='1';
 assert hub.promotion_read(null,jsonb_build_object('published_project_id',current_setting('test.multi_other_published_project'),
  'published_promotion_id',r->>'id'))->>'total'='1';
 run:=internal.assistant_run_create(jsonb_build_object('mode','SYNTHETIC','config_version','multi-tier-97','scope_project_id',phase_a));
 source:=jsonb_build_object('namespace','internal_content','entity_type','promotion','entity_id',r->>'id','version',r->>'published_version_id',
  'scope',jsonb_build_object('project_id',phase_b));
 begin perform internal.assistant_tool_record((run->>'id')::uuid,jsonb_build_object('tool_name','get_promotions','outcome','SUCCESS','duration_ms',1,'sources',jsonb_build_array(source)));
  raise exception 'Locked conversation accepted a different eligible phase';exception when insufficient_privilege then null;end;
 receipt:=internal.assistant_tool_record((run->>'id')::uuid,jsonb_build_object('tool_name','get_promotions','outcome','SUCCESS','duration_ms',1,
  'sources',jsonb_build_array(source-'scope')));
 assert receipt#>>'{citations,0,scope,project_id}'=phase_a;
 perform set_config('test.multi_assistant_run',run->>'id',true);
 perform set_config('test.multi_assistant_receipt',receipt::text,true);
 perform set_config('test.multi_assistant_phase',phase_a,true);
end $$;
reset role;
-- Model an existing pre-0097 immutable receipt: its run carries the project.
with legacy as (
 insert into internal.assistant_citation(run_id,tool_id,namespace,entity_type,entity_id,version)
 select run_id,tool_id,namespace,entity_type,entity_id,version from internal.assistant_citation
 where id=(current_setting('test.multi_assistant_receipt')::jsonb#>>'{citations,0,id}')::uuid returning id
) select set_config('test.multi_legacy_citation',(select id::text from legacy),true);
set local role hub_app;
do $$ declare run uuid:=current_setting('test.multi_assistant_run')::uuid;legacy uuid:=current_setting('test.multi_legacy_citation')::uuid;begin
 assert internal.assistant_citation_read(run,legacy)#>>'{scope,project_id}'=current_setting('test.multi_assistant_phase'),
  'Older locked receipt did not expose its validated effective project';
 assert exists(select 1 from jsonb_array_elements(internal.assistant_run_read(run)->'citations') c
  where c->>'id'=legacy::text and c#>>'{scope,project_id}'=current_setting('test.multi_assistant_phase'));
end $$;
reset role;

-- Current draft moved to A; frozen publication still serves another project.
-- Both withdrawal and revoking an older review must check immutable membership.
insert into hub.account_content_scope(account_id,tab,level,project_ids)
select pg_temp.w4_actor(actor),tab,level,array['SQL-MULTI-TIER-97-1']
from (values('publisher','promotions','view'),('publisher','projects','view'),('publisher','knowledge','view'),
 ('reviewer','promotions','view'),('reviewer','promotions','approve'),('reviewer','projects','view')) x(actor,tab,level);
set local role hub_app;
select set_config('app.actor_id',pg_temp.w4_actor('publisher')::text,true);
do $$ declare r jsonb;begin
 select row_data into r from multi_tier_cases where tier='campaign';
 begin perform hub.promotion_command('withdraw',(r->>'id')::uuid,jsonb_build_object('expected_revision',r->'draft_revision',
  'expected_published_version_id',r->'published_version_id','change_reason','Synthetic frozen scope check'));
  raise exception 'Scoped publisher withdrew an unauthorized frozen project';exception when insufficient_privilege then null;end;
end $$;
select set_config('app.actor_id',pg_temp.w4_actor('reviewer')::text,true);
do $$ declare r jsonb;frozen jsonb:=current_setting('test.multi_frozen')::jsonb;begin
 select row_data into r from multi_tier_cases where tier='campaign';
 begin perform hub.promotion_command('review',(r->>'id')::uuid,jsonb_build_object('expected_revision',r->'draft_revision',
  'review_revision',frozen->'draft_revision','review_type','DATA','decision','REVOKED',
  'change_reason','Synthetic old review scope check','evidence','Synthetic evidence'));
  raise exception 'Scoped reviewer revoked an unauthorized frozen project';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Direct pointer transitions used by release rollback are guarded too.
select set_config('app.actor_id',pg_temp.w4_actor('publisher')::text,true);
do $$ declare frozen jsonb:=current_setting('test.multi_frozen')::jsonb;begin
 begin update hub.public_promotions set published_version_id=null where id=(frozen->>'promotion_id')::uuid;
  raise exception 'Direct rollback removed an unauthorized frozen project';exception when insufficient_privilege then null;end;
end $$;
delete from hub.account_content_scope where account_id in(pg_temp.w4_actor('publisher'),pg_temp.w4_actor('reviewer'));
update hub.public_promotions set published_version_id=null where id=(current_setting('test.multi_frozen')::jsonb->>'promotion_id')::uuid;
insert into hub.account_content_scope(account_id,tab,level,project_ids)
select pg_temp.w4_actor('publisher'),tab,'view',array['SQL-MULTI-TIER-97-1']
from (values('promotions'),('projects'),('knowledge')) x(tab);
do $$ declare frozen jsonb:=current_setting('test.multi_frozen')::jsonb;begin
 begin update hub.public_promotions set published_version_id=(frozen->>'id')::uuid where id=(frozen->>'promotion_id')::uuid;
  raise exception 'Rollback from null restored an unauthorized frozen project';exception when insufficient_privilege then null;end;
end $$;
delete from hub.account_content_scope where account_id=pg_temp.w4_actor('publisher');
update hub.public_promotions set published_version_id=(current_setting('test.multi_frozen')::jsonb->>'id')::uuid
where id=(current_setting('test.multi_frozen')::jsonb->>'promotion_id')::uuid;
select set_config('app.actor_id',pg_temp.w4_actor('author')::text,true);

-- Scope tightening: neither an old broad row nor a new broad proposal is editable
-- by someone with only one member project. References must not leak group counts.
insert into hub.account_content_scope(account_id,tab,level,project_ids)
select pg_temp.w4_actor('author'),tab,level,array['SQL-MULTI-TIER-97-1']
from (values('promotions','view'),('promotions','edit'),('projects','view')) x(tab,level);
update hub.account_permission set can_view=false,can_edit=false,can_approve=false
where account_id=pg_temp.w4_actor('author') and tab='brands';
set local role hub_app;
do $$ declare item record;r jsonb;begin
 for item in select * from multi_tier_cases where tier in ('campaign','corporate','project_group','brand') loop
  begin perform hub.promotion_command('create',null,item.body||jsonb_build_object('code','SQL-SCOPED-97-'||upper(item.tier)));
   raise exception 'Scoped editor created cross-scope promotion';exception when insufficient_privilege then null;end;
 end loop;
 select row_data into r from multi_tier_cases where tier='brand';
 begin perform hub.promotion_command('update',(r->>'id')::uuid,jsonb_build_object('expected_revision',1,'title',jsonb_build_object('th','แก้ไขนอกขอบเขต')));
  raise exception 'Scoped editor changed broad promotion';exception when insufficient_privilege then null;end;
 assert not exists(select 1 from jsonb_array_elements(hub.promotion_references()->'project_groups') x where x->>'id'='SQL-GROUP-97'),'Hidden group count leaked';
 assert not exists(select 1 from jsonb_array_elements(hub.promotion_references()->'projects') x
  where x->>'brand_id' is not null or x->>'project_group_id'='SQL-GROUP-97'),'Hidden nested owner reference leaked';
 assert hub.promotion_read(null,jsonb_build_object('project_id',current_setting('test.multi_b')))->>'total'='0',
  'Hidden project scope filter leaked membership';
 assert hub.promotion_read(null,'{"project_group_id":"SQL-GROUP-97"}')->>'total'='0','Hidden group filter leaked membership';
 assert hub.promotion_read(null,jsonb_build_object('brand_id',current_setting('test.multi_brand')))->>'total'='0','Hidden brand filter leaked membership';
end $$;
reset role;
delete from hub.account_content_scope where account_id=pg_temp.w4_actor('author') and tab='promotions';
set local role hub_app;
do $$ begin
 begin perform hub.promotion_resolve('{"promotion_tier":"corporate","programme_key":"hidden_97"}');
  raise exception 'Hidden draft programme key was accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
