-- Synthetic assertions in a rolled-back transaction. No real reference data.
begin;
select set_config('test.c4_project',public_project_id,true),set_config('test.c4_project_id',id::text,true)
 from hub.projects where rem_project_id='DEMO-001';

do $$ declare name text; rel regclass; f record;begin
 foreach name in array array['feature_catalog','project_features','solar_estimates','project_places','ref_rail_lines','ref_rail_stations','ref_expressways','ref_expressway_ramps'] loop
  rel:=('hub.'||name)::regclass;
  assert (select relrowsecurity and relforcerowsecurity from pg_class where oid=rel),name||' lacks FORCE RLS';
  assert exists(select 1 from pg_trigger where tgrelid=rel and tgname='c4_audit'),name||' lacks audit';
  assert (select count(*) from information_schema.columns where table_schema='hub' and table_name=name and column_name in ('created_at','created_by','updated_at','updated_by'))=4;
  assert not has_table_privilege('hub_app',rel,'INSERT,UPDATE,DELETE'),name||' exposes direct writes';
 end loop;
 for f in select oid,proname,proacl,proowner from pg_proc where pronamespace='hub'::regnamespace and proname like 'c4_%' loop
  assert not exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) where grantee=0 and privilege_type='EXECUTE'),f.proname||' has PUBLIC execute';
 end loop;
 assert not has_function_privilege('hub_app','hub.c4_metric_defs_valid(jsonb)','EXECUTE');
 assert not has_function_privilege('hub_app','hub.c4_check_changes(jsonb,text[])','EXECUTE');
 assert not exists(select 1 from hub.ref_rail_stations),'Migration invented station data';
 assert not exists(select 1 from hub.ref_expressway_ramps),'Migration invented ramp data';
 assert (select label->>'en' from hub.feature_catalog where code='non_dee')='';
 assert (select term->>'en' from hub.translation_glossary where term_key='feature.non_dee')='';
end $$;

set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$ declare p text:=current_setting('test.c4_project'); first_asset jsonb; second_asset jsonb; first_link jsonb; second_link jsonb; switched jsonb; f jsonb; feature jsonb; place jsonb; checklist jsonb;begin
 f:=hub.c4_facility_save(p,'lobby',0,'{"status":"present","display_name":{"th":"ล็อบบี้สมมติ"},"size_sqm":50,"applies_to_project_ids":["DEMO-001"]}');
 assert f->>'revision'='1';
 first_asset:=hub.register_uploaded_asset(jsonb_build_object('original_filename','c4-first.png','mime_type','image/png','checksum',repeat('4',64),
  'storage_path',repeat('4',64)||'.png','file_size',100,'asset_type','image','width',1,'height',1,'language','th'))->'asset';
 first_asset:=hub.media_save_asset(p,(first_asset->>'id')::uuid,0,'{"media_category":"facility","caption":{"th":"คำบรรยายสมมติ","en":"Synthetic caption"},"alt_text":{"th":"ภาพสมมติ"},"tags":["lobby"],"metadata_state":"confirmed","ai_exposure":"open"}');
 second_asset:=hub.register_uploaded_asset(jsonb_build_object('original_filename','c4-second.png','mime_type','image/png','checksum',repeat('5',64),
  'storage_path',repeat('5',64)||'.png','file_size',100,'asset_type','image','width',1,'height',1,'language','th'))->'asset';
 first_link:=hub.media_link_save(p,gen_random_uuid(),0,jsonb_build_object('asset_id',first_asset->>'id','target_type','facility','target_key','lobby','is_primary',true,'sort',1));
 second_link:=hub.media_link_save(p,gen_random_uuid(),0,jsonb_build_object('asset_id',second_asset->>'id','target_type','facility','target_key','lobby','sort',0));
 switched:=hub.c4_facility_cover(p,'lobby',(second_link->>'id')::uuid,(second_link->>'revision')::integer,(first_link->>'id')::uuid,(first_link->>'revision')::integer);
 assert switched->>'is_primary'='true';
 assert (select count(*) from hub.asset_links where project_id=current_setting('test.c4_project_id')::uuid and target_key='lobby' and is_primary and deleted_at is null)=1;
 begin
  perform hub.c4_facility_cover(p,'lobby',(first_link->>'id')::uuid,(first_link->>'revision')::integer,(second_link->>'id')::uuid,(switched->>'revision')::integer);
  assert false,'Stale photo revision accepted';
 exception when serialization_failure then null;end;
 begin
  perform hub.c4_facility_cover(p,'pool',(second_link->>'id')::uuid,(switched->>'revision')::integer,null,0);
  assert false,'Cross-facility cover accepted';
 exception when no_data_found then null;end;
 checklist:=hub.media_checklist(p);
 assert exists(select 1 from jsonb_array_elements(checklist->'items') i where i->>'rule_key'='facility' and i->>'key'='lobby'
  and i->>'count'='0' and i->>'min_count'='1' and i->>'target_count'='3' and i->>'blocks_publish'='false');
 perform set_config('test.c4_asset',first_asset->>'id',true);
 feature:=hub.c4_item_save(p,'features',gen_random_uuid(),0,'{"feature_code":"smart_home","status":"present","detail":{"th":"ระบบสมมติ"}}');
 place:=hub.c4_item_save(p,'places',gen_random_uuid(),0,'{"category":"park","name":{"th":"สวนสมมติ"},"status":"planned","as_of":"2026-10-21"}');
 assert hub.media_target(current_setting('test.c4_project_id')::uuid,'feature',feature->>'id','view');
 assert hub.media_target(current_setting('test.c4_project_id')::uuid,'place',place->>'id','view');
 assert not hub.media_target(current_setting('test.c4_project_id')::uuid,'place',gen_random_uuid()::text,'view');
 assert exists(select 1 from jsonb_array_elements(hub.project_media(p)#>'{context,features}') i where i->>'key'=feature->>'id');
 assert exists(select 1 from jsonb_array_elements(hub.project_media(p)#>'{context,places}') i where i->>'key'=place->>'id');
 assert exists(select 1 from jsonb_array_elements(hub.content_translation_list('projects',p)) t where t->>'owner_key'=place->>'id' and t#>>'{job,status}'='queued');
end $$;

select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ declare data jsonb;begin
 perform hub.review_asset(current_setting('test.c4_asset')::uuid,(hub.asset_detail(current_setting('test.c4_asset')::uuid)->>'updated_at')::timestamptz,
  'approved','Synthetic rights test',null,null,'Synthetic rights review');
 data:=hub.media_checklist(current_setting('test.c4_project'));
 assert exists(select 1 from jsonb_array_elements(data->'items') i where i->>'rule_key'='facility' and i->>'key'='lobby' and i->>'count'='1');
 assert hub.project_content_readiness(current_setting('test.c4_project')) ? 'media_recommended_score';
 begin perform hub.c4_facility_save(current_setting('test.c4_project'),'lobby',1,'{"status":"absent"}');assert false,'Approver edited project';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 assert exists(select 1 from audit.change_log where table_name='hub.project_features' and actor is not null and after_row->>'project_id'=current_setting('test.c4_project_id'));
 assert exists(select 1 from audit.change_log where table_name='hub.project_places' and actor is not null and after_row->>'project_id'=current_setting('test.c4_project_id'));
end $$;
rollback;
