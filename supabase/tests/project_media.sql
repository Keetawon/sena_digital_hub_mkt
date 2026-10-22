begin;
select set_config('test.media_project',public_project_id,true),set_config('test.media_project_id',id::text,true)
 from hub.projects where rem_project_id='DEMO-001';
do $$ declare name text;rel regclass;f record;begin
 foreach name in array array['media_tags','asset_media_tags','asset_links','media_requirements','media_links','media_link_targets','media_jobs'] loop
  rel:=('hub.'||name)::regclass;
  assert (select relrowsecurity and relforcerowsecurity from pg_class where oid=rel),name||' lacks FORCE RLS';
  assert exists(select 1 from pg_trigger where tgrelid=rel and tgname='media_audit'),name||' lacks audit';
  assert not has_table_privilege('hub_app',rel,'INSERT,UPDATE,DELETE'),name||' exposes direct writes';
 end loop;
 for f in select oid,proname from pg_proc where pronamespace='hub'::regnamespace and (proname like 'media_%' or proname='can_read_asset_before_media') loop
  assert not exists(select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=f.oid),acldefault('f',(select proowner from pg_proc where oid=f.oid)))) where grantee=0 and privilege_type='EXECUTE'),f.proname||' has PUBLIC execute';
 end loop;
 assert not has_function_privilege('hub_app','hub.media_claim()','EXECUTE');
 assert not has_function_privilege('hub_app','hub.media_finish(uuid,uuid,jsonb,text,text)','EXECUTE');
 assert not pg_has_role('hub_runtime','hub_media_worker','MEMBER');
end $$;
set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$ declare data jsonb;project jsonb;asset jsonb;other_asset jsonb;link jsonb;second_link uuid:=gen_random_uuid();body jsonb;begin
 project:=hub.project_detail(current_setting('test.media_project'));
 perform hub.save_project_facility(current_setting('test.media_project_id')::uuid,'pool','{"status":"present"}',(project->>'updated_at')::timestamptz);
 perform hub.save_project_building(current_setting('test.media_project'),'MEDIA-UNKNOWN',0,'{"name":{"th":"อาคารไม่ทราบจำนวนชั้น"}}');
 data:=hub.media_checklist(current_setting('test.media_project'));
 assert exists(select 1 from jsonb_array_elements(data->'unknown_coverage') item where item->>'key'='MEDIA-UNKNOWN');
 assert not exists(select 1 from jsonb_array_elements(data->'items') item where item->>'key'='MEDIA-UNKNOWN'),'Unknown floors were invented';
 body:=jsonb_build_object('original_filename','synthetic-media.png','mime_type','image/png','checksum',repeat('e',64),'storage_path',repeat('e',64)||'.png','file_size',100,'asset_type','image','width',1,'height',1,'language','th');
 asset:=hub.register_uploaded_asset(body)->'asset';
 body:=jsonb_build_object('media_category','facility','caption',jsonb_build_object('th','ภาพส่วนกลางสมมติ'),'alt_text',jsonb_build_object('th','สระว่ายน้ำสมมติ'),
  'tags',jsonb_build_array('pool'),'metadata_state','confirmed','ai_exposure','open','marketing_publication',true);
 asset:=hub.media_save_asset(current_setting('test.media_project'),(asset->>'id')::uuid,0,body);
 link:=hub.media_link_save(current_setting('test.media_project'),gen_random_uuid(),0,jsonb_build_object('asset_id',asset->>'id','target_type','facility','target_key','pool','is_primary',true));
 other_asset:=hub.register_uploaded_asset(jsonb_build_object('original_filename','second-media.png','mime_type','image/png','checksum',repeat('f',64),'storage_path',repeat('f',64)||'.png','file_size',100,'asset_type','image','width',1,'height',1,'language','th'))->'asset';
 begin
  perform hub.media_link_save(current_setting('test.media_project'),second_link,0,jsonb_build_object('asset_id',other_asset->>'id','target_type','facility','target_key','pool','is_primary',true));
  assert false,'Two facility covers were accepted';
 exception when unique_violation then null;end;
 perform hub.media_link_save(current_setting('test.media_project'),second_link,0,jsonb_build_object('asset_id',other_asset->>'id','target_type','facility','target_key','pool'));
 data:=hub.media_checklist(current_setting('test.media_project'));
 assert (select item->>'count' from jsonb_array_elements(data->'items') item where item->>'rule_key'='facility' and item->>'key'='pool')='0','Pending rights counted as usable coverage';
 perform set_config('test.media_asset',asset->>'id',true);
 perform set_config('test.media_updated',asset->>'updated_at',true);
end $$;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ declare data jsonb;begin
 perform hub.review_asset(current_setting('test.media_asset')::uuid,(hub.asset_detail(current_setting('test.media_asset')::uuid)->>'updated_at')::timestamptz,
  'approved','Synthetic rights test',null,null,'Synthetic rights review');
 data:=hub.media_checklist(current_setting('test.media_project'));
 assert (select item->>'count' from jsonb_array_elements(data->'items') item where item->>'rule_key'='facility' and item->>'key'='pool')='1','Approved cover not counted';
 assert hub.project_content_readiness(current_setting('test.media_project')) ? 'media_recommended_score';
end $$;
reset role;
-- Structured floor coverage respects skipped/unknown floors. Capture dates and
-- rights windows never become current simply because metadata was confirmed.
insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance)
values('DEMO-001','{"project_id":"DEMO-001","project_status_detail":"under_construction"}',now(),repeat('d',64),'{}')
on conflict(rem_project_id) do update set source_record=staging.dw_projects.source_record||excluded.source_record;
with inserted as (insert into hub.commercial_types(project_id,public_name,product_form)
 values(current_setting('test.media_project_id')::uuid,'{"th":"แบบทดสอบห้อง"}','condominium') returning id)
select set_config('test.media_type',id::text,true) from inserted;
set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$ declare data jsonb;asset jsonb;begin
 perform hub.save_project_building(current_setting('test.media_project'),'MEDIA-KNOWN',0,'{"name":{"th":"อาคารทดสอบ"},"floors_above":3,"skip_floors":[2]}');
 asset:=hub.asset_detail(current_setting('test.media_asset')::uuid);
 perform hub.media_save_asset(current_setting('test.media_project'),(asset->>'id')::uuid,(asset->>'media_revision')::integer,'{"media_category":"floor_plan","tags":[]}');
 perform hub.media_link_save(current_setting('test.media_project'),gen_random_uuid(),0,jsonb_build_object('asset_id',asset->>'id','target_type','building_floor','target_key','MEDIA-KNOWN','building_key','MEDIA-KNOWN','floor_from',1,'floor_to',1));
 begin
  perform hub.media_link_save(current_setting('test.media_project'),gen_random_uuid(),0,jsonb_build_object('asset_id',asset->>'id','target_type','building_floor','target_key','MEDIA-KNOWN','building_key','MEDIA-KNOWN','floor_from',2,'floor_to',2));
  assert false,'Skipped building floor accepted';
 exception when check_violation then null;end;
 data:=hub.media_checklist(current_setting('test.media_project'));
 assert (select count(*) from jsonb_array_elements(data->'items') i where i->>'key'='MEDIA-KNOWN')=2;
 assert exists(select 1 from jsonb_array_elements(data->'items') i where i->>'key'='MEDIA-KNOWN' and i->>'floor'='1' and i->>'count'='1');
 assert not exists(select 1 from jsonb_array_elements(data->'items') i where i->>'key'='MEDIA-KNOWN' and i->>'floor'='2');
 asset:=hub.asset_detail(current_setting('test.media_asset')::uuid);
 perform hub.media_save_asset(current_setting('test.media_project'),(asset->>'id')::uuid,(asset->>'media_revision')::integer,jsonb_build_object('media_category','progress','taken_at',current_date-31));
 perform hub.media_link_save(current_setting('test.media_project'),gen_random_uuid(),0,jsonb_build_object('asset_id',asset->>'id','target_type','project','target_key',current_setting('test.media_project_id')));
 data:=hub.media_checklist(current_setting('test.media_project'));
 assert exists(select 1 from jsonb_array_elements(data->'items') i where i->>'rule_key'='construction' and i->>'count'='0'),'Old progress image counted or construction fixture absent';
 asset:=hub.asset_detail(current_setting('test.media_asset')::uuid);
 perform hub.media_save_asset(current_setting('test.media_project'),(asset->>'id')::uuid,(asset->>'media_revision')::integer,jsonb_build_object('taken_at',current_date));
 data:=hub.media_checklist(current_setting('test.media_project'));
 assert exists(select 1 from jsonb_array_elements(data->'items') i where i->>'rule_key'='construction' and i->>'count'='1'),'Current progress image not counted';
end $$;
reset role;
update hub.assets set effective_from=null,effective_to=now()-interval '1 day' where id=current_setting('test.media_asset')::uuid;
set local role hub_app;
do $$ begin
 assert exists(select 1 from jsonb_array_elements(hub.media_checklist(current_setting('test.media_project'))->'items') i where i->>'rule_key'='construction' and i->>'count'='0'),'Expired rights counted';
end $$;
reset role;
update hub.assets set effective_to=null where id=current_setting('test.media_asset')::uuid;
set local role hub_app;
do $$ declare asset jsonb;begin
 asset:=hub.asset_detail(current_setting('test.media_asset')::uuid);
 perform hub.media_save_asset(current_setting('test.media_project'),(asset->>'id')::uuid,(asset->>'media_revision')::integer,'{"media_category":"interior","tags":[]}');
 perform hub.media_link_save(current_setting('test.media_project'),gen_random_uuid(),0,jsonb_build_object('asset_id',asset->>'id','target_type','commercial_type','target_key',current_setting('test.media_type'),'room_tag','living_room'));
 assert exists(select 1 from jsonb_array_elements(hub.media_checklist(current_setting('test.media_project'))->'items') i where i->>'rule_key'='type_living' and i->>'key'=current_setting('test.media_type') and i->>'count'='1'),'Selected room context was ignored by coverage';
end $$;
reset role;
update hub.account_permission set can_view=false,can_edit=false,can_approve=false,special_actions='{}'
 where account_id='00000000-0000-0000-0000-000000000002' and tab='projects';
set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ begin
 assert (select count(*) from hub.media_tags)=0;
 assert (select count(*) from hub.asset_links)=0;
 begin perform hub.project_media(current_setting('test.media_project'));assert false,'Revoked media read accepted';exception when insufficient_privilege then null;end;
 assert hub.faq_question_list() is not null,'Unrelated Knowledge view was revoked';
end $$;
rollback;
