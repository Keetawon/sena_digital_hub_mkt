-- Real hub_app grants and RLS; the runner verifies disposable data_directory.
begin;
select set_config('test.core_project',public_project_id,true),set_config('test.core_project_id',id::text,true),set_config('test.core_rem',rem_project_id,true)
 from hub.projects where rem_project_id='DEMO-001';
insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance)
values(current_setting('test.core_rem'),jsonb_build_object('project_id',current_setting('test.core_rem'))||'{"area_rai":2,"area_ngan":1,"area_square_wah":5,"total_unit":100,"total_unit_count":98,"buildings":[{"building_key":"TOWER-01","name":{"th":"อาคารสมมติ"},"floors_above":12,"unit_count":98}]}',now(),repeat('d',64),'{}')
on conflict(rem_project_id) do update set source_record=excluded.source_record;

do $$ declare name text; rel regclass; begin
 foreach name in array array['field_catalog','project_facts','project_buildings','project_selling_points','contact_domains','contacts','knowledge_topics',
  'faq_questions','faq_question_versions','content_section_versions','faq_versions','faq_sources','translation_glossary','content_translations','translation_jobs'] loop
  rel:=('hub.'||name)::regclass;
  assert (select relrowsecurity and relforcerowsecurity from pg_class where oid=rel),name||' lacks FORCE RLS';
  assert exists(select 1 from pg_trigger where tgrelid=rel and tgname='content_audit'),name||' lacks audit';
  assert not has_table_privilege('hub_app',rel,'INSERT,UPDATE,DELETE'),name||' exposes direct writes';
 end loop;
 assert not has_function_privilege('hub_app','hub.claim_translation(uuid)','EXECUTE'),'API can claim worker jobs';
 assert not has_function_privilege('hub_app','hub.finish_translation(uuid,uuid,text,text,text)','EXECUTE'),'API can forge worker output';
 assert not has_function_privilege('hub_app','hub.sync_content_translation(text,text,text,text,text,jsonb,jsonb)','EXECUTE'),'API can forge translation sources';
end $$;

set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$ declare data jsonb; building jsonb; f jsonb; begin
 data:=hub.project_content(current_setting('test.core_project'));
 assert data#>>'{rem,land_area_sqwah}'='905','REM conversion is incorrect';
 assert data#>>'{rem,unit_total}'='100' and data#>>'{rem,unit_counted}'='98','REM counts were conflated';
 building:=hub.save_project_building(current_setting('test.core_project'),'TOWER-01',0,'{"use_rem":true}');
 assert building->>'source'='rem' and building->>'floors_above'='12','REM building prefill lost provenance';
 assert building->'has_rooftop'='null'::jsonb,'Unknown rooftop was converted to absent';
 f:=hub.save_project_fact(current_setting('test.core_project'),'project.unit_total','project',0,'{"value_number":98,"unit_count_choice":"rem_counted","as_of":"2026-10-21"}');
 assert f->>'source'='rem','Confirmed REM observation lost its source';
 begin perform hub.save_project_fact(current_setting('test.core_project'),'project.unit_total','project',0,'{"value_number":98,"unit_count_choice":"rem_counted","as_of":"2026-10-21"}');assert false,'Stale fact accepted';exception when serialization_failure then null;end;
 begin perform hub.save_project_fact(current_setting('test.core_project'),'project.parking_pct_total','project',0,'{"value_number":20,"as_of":"2026-10-21"}');assert false,'Computed ratio editable';exception when check_violation then null;end;
 begin perform hub.save_project_fact(current_setting('test.core_project'),'project.parking_regular','project',0,'{"value_number":"NaN","as_of":"2026-10-21"}');assert false,'Non-finite fact accepted';exception when check_violation then null;end;
 begin update hub.project_facts set value_number=1;assert false,'Direct fact update accepted';exception when insufficient_privilege then null;end;
 assert hub.project_content_readiness(current_setting('test.core_project'))->>'mode'='PRIVATE_DRAFT','Readiness became a publication action';
end $$;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
do $$ begin
 assert (select count(*) from hub.project_facts)>0,'Authorized viewer cannot see facts';
 begin perform hub.save_content_section('project',current_setting('test.core_project'),'section.project_intro',0,'{"body":{"th":"ทดสอบ"}}');assert false,'Viewer can save narrative';exception when insufficient_privilege then null;end;
end $$;
reset role;
update hub.account_permission set can_view=false,can_edit=false,can_approve=false,special_actions='{}'
 where account_id='00000000-0000-0000-0000-000000000003' and tab='projects';
set local role hub_app;
do $$ begin
 assert (select count(*) from hub.project_facts)=0,'Revoked project facts leaked through RLS';
 assert (select count(*) from hub.project_buildings)=0,'Revoked buildings leaked through RLS';
 begin perform hub.project_content(current_setting('test.core_project'));assert false,'Revoked API-equivalent read accepted';exception when insufficient_privilege then null;end;
 assert hub.faq_question_list() is not null,'Neighboring Knowledge V was lost';
end $$;
rollback;
