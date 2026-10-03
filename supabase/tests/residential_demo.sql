-- Synthetic, self-contained residential publication contract; no files or external calls.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
select set_config('app.change_reason','Synthetic residential SQL test',true);
insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint)
values('SQL-RESIDENTIAL-21','Synthetic residential brand',now(),'synthetic-residential-21');
insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint,rem_brand_id)
values('SQL-RESIDENTIAL-21','Synthetic residential project',now(),'synthetic-residential-21','SQL-RESIDENTIAL-21');
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint)
values('SQL-RESIDENTIAL-21','MODEL-01','Synthetic residential model',now(),'synthetic-residential-21');
insert into staging.source_offers(source_offer_key,source_active,source_snapshot_at,source_record)
values('SYNTHETIC:SQL:000021',true,now(),'{"synthetic_only":true}');
set local role admin;
select set_config('test.residential_brand',hub.create_brand_from_rem('SQL-RESIDENTIAL-21')::text,true);
select hub.update_brand_draft(id,'{"public_name":{"th":"Synthetic residential brand"},"slug":"sql-residential-21","description":{"th":"แบรนด์สังเคราะห์"}}',updated_at)
from hub.brands where id=current_setting('test.residential_brand')::uuid;
select set_config('test.residential_hero',hub.register_uploaded_asset(jsonb_build_object('original_filename','synthetic-residential-hero.png',
 'mime_type','image/png','asset_type','image','storage_path',repeat('7',64)||'.png','checksum',repeat('7',64),'file_size',100,'width',10,'height',10))#>>'{asset,id}',true);
select set_config('test.residential_thumbnail',hub.register_uploaded_asset(jsonb_build_object('original_filename','synthetic-residential-thumbnail.png',
 'mime_type','image/png','asset_type','image','storage_path',repeat('8',64)||'.png','checksum',repeat('8',64),'file_size',100,'width',10,'height',10))#>>'{asset,id}',true);
select hub.bind_brand_asset(id,current_setting('test.residential_thumbnail')::uuid,'logo_primary','{"th":"โลโก้สังเคราะห์"}',updated_at)
from hub.brands where id=current_setting('test.residential_brand')::uuid;
set local role publisher;
select hub.review_asset(id,updated_at,'approved','Synthetic test rights',null,null,'Synthetic test fixture')
from hub.assets where id in(current_setting('test.residential_hero')::uuid,current_setting('test.residential_thumbnail')::uuid);
select set_config('test.residential_brand_version',hub.publish_brand(current_setting('test.residential_brand')::uuid,'Synthetic fixture')::text,true);
set local role editor;
select set_config('test.residential_project',hub.create_project_from_rem('SQL-RESIDENTIAL-21')::text,true);
select hub.assign_project_brand(id,current_setting('test.residential_brand')::uuid,updated_at)
from hub.projects where id=current_setting('test.residential_project')::uuid;
select hub.patch_project(id,'{"slug":"sql-residential-project-21","public_name":{"th":"โครงการสังเคราะห์"},"address":{"th":"ที่อยู่สังเคราะห์"},"latitude":13.7563,"longitude":100.5018,"ad_disclaimer":{"th":"ข้อมูลตัวอย่างเท่านั้น"}}',updated_at)
from hub.projects where id=current_setting('test.residential_project')::uuid;
select hub.update_model(project_id,public_model_id,'{"bedrooms":2,"bathrooms":1,"usable_area_sqm":50,"parking_spaces":1}',
 (select updated_at from hub.projects where id=m.project_id)) from hub.model_types m where project_id=current_setting('test.residential_project')::uuid;
select hub.review_model(project_id,public_model_id,(select updated_at from hub.projects where id=m.project_id),'CONFIRMED','Synthetic model review')
from hub.model_types m where project_id=current_setting('test.residential_project')::uuid;
select hub.bind_project_asset(id,current_setting('test.residential_hero')::uuid,'hero','{"th":"ภาพสังเคราะห์"}',updated_at)
from hub.projects where id=current_setting('test.residential_project')::uuid;
select hub.bind_project_asset(id,current_setting('test.residential_thumbnail')::uuid,'thumbnail','{"th":"ภาพสังเคราะห์"}',updated_at)
from hub.projects where id=current_setting('test.residential_project')::uuid;
set local role publisher;
select set_config('test.residential_project_version',hub.publish_project(current_setting('test.residential_project')::uuid,'Synthetic fixture')::text,true);
reset role;

-- Every new table has forced RLS; ordinary editorial roles get no source editing.
do $$ declare relation regclass;role_name text;begin
 foreach relation in array array['hub.public_promotions'::regclass,'hub.promotion_reviews'::regclass,'hub.promotion_versions'::regclass,
 'hub.publication_releases'::regclass,'hub.publication_release_members'::regclass,'hub.demo_assets'::regclass,'hub.demo_release_selection'::regclass,'staging.source_offers'::regclass] loop
 assert(select relrowsecurity and relforcerowsecurity from pg_class where oid=relation),'Residential table lacks forced RLS';
 end loop;
 foreach role_name in array array['editor','publisher','viewer','admin','online_staff','agency','service_consumer'] loop
 assert not has_table_privilege(role_name,'staging.source_offers','INSERT,UPDATE,DELETE'),'Source mirror writable';
 assert not has_table_privilege(role_name,'hub.demo_assets','INSERT,UPDATE,DELETE'),'Demo asset provenance writable';
 assert not has_table_privilege(role_name,'hub.demo_release_selection','INSERT,UPDATE,DELETE'),'Demo selection writable';
 end loop;
end $$;

set local role editor;
do $$ declare p jsonb;begin
 p:=jsonb_build_object('project_id',current_setting('test.residential_project'),'code','SQL-PROMOTION-21','title',jsonb_build_object('th','โปรโมชั่นสังเคราะห์'),
 'summary',jsonb_build_object('th','ตัวอย่างเท่านั้น'),'conditions_public',jsonb_build_object('th','เงื่อนไขตัวอย่าง'),
 'legal_terms',jsonb_build_object('th','เงื่อนไขกฎหมายสังเคราะห์'),'disclaimer',jsonb_build_object('th','ไม่ใช่ข้อเสนอขาย'),
 'benefit_type','discount_amount','benefit_value','1199.99','benefit_unit','THB','stackable',true,'priority',100,
 'starts_at',now(),'ends_at',now()+interval '30 days','source_offer_key','SYNTHETIC:SQL:000021');
 perform set_config('test.residential_promo_body',p::text,true);
 perform set_config('test.residential_promo',hub.promotion_command('create',null,p)->>'id',true);
 begin perform hub.promotion_command('publish',current_setting('test.residential_promo')::uuid,'{"expected_revision":1,"expected_published_version_id":null,"change_reason":"Editor cannot publish"}');
 assert false,'Editor published';exception when insufficient_privilege then null;end;
 begin perform hub.mark_demo_fields('project',current_setting('test.residential_project')::uuid,array['public_name.th']);
 assert false,'Editor marked demo provenance';exception when insufficient_privilege then null;end;
 begin perform hub.configure_demo_selection('project',current_setting('test.residential_project')::uuid,'[]','{}','SYNTHETIC-RESIDENTIAL-test');
 assert false,'Editor configured demo selection';exception when insufficient_privilege then null;end;
end $$;

set local role admin;
do $$ begin
 perform hub.promotion_read(current_setting('test.residential_promo')::uuid);
 begin perform hub.promotion_command('review',current_setting('test.residential_promo')::uuid,'{"expected_revision":1,"review_type":"LEGAL","decision":"APPROVED","evidence":"Synthetic","change_reason":"Admin cannot approve"}');
 assert false,'Admin bypassed publisher review';exception when insufficient_privilege then null;end;
 begin perform hub.release_publish('[]','Admin cannot publish',false);assert false,'Admin published release';exception when insufficient_privilege then null;end;
end $$;
set local role viewer;
do $$ begin
 perform hub.promotion_read(current_setting('test.residential_promo')::uuid);perform hub.release_candidates(false);perform hub.release_read();
 begin perform hub.promotion_command('update',current_setting('test.residential_promo')::uuid,'{"expected_revision":1,"title":{"th":"Viewer"}}');assert false,'Viewer edited promotion';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ declare role_name text;begin
 foreach role_name in array array['online_staff','agency','service_consumer'] loop
 execute format('set local role %I',role_name);
 begin perform hub.promotion_read(current_setting('test.residential_promo')::uuid);assert false,'Non-editorial role read draft';exception when insufficient_privilege then null;end;
 begin perform hub.release_read();assert false,'Non-editorial role read release';exception when insufficient_privilege then null;end;
 execute 'reset role';
 end loop;
end $$;

-- Direct RPC malformed payloads cannot bypass API validation or publication guards.
set local role editor;
do $$ declare bad jsonb;begin
 foreach bad in array array[null::jsonb,'null'::jsonb,'[]'::jsonb,'{}'::jsonb,
 '{"expected_revision":null,"title":{"th":"Bad"}}'::jsonb,'{"expected_revision":1,"published_version_id":null}'::jsonb,
 '{"expected_revision":1,"rag_eligible":true}'::jsonb,'{"expected_revision":1,"demo_fields":[]}'::jsonb,
 '{"expected_revision":1,"benefit_value":1.234}'::jsonb,'{"expected_revision":1,"starts_at":null}'::jsonb] loop
 begin perform hub.promotion_command('update',current_setting('test.residential_promo')::uuid,bad);assert false,'Malformed direct update accepted';
 exception when invalid_parameter_value or check_violation or not_null_violation or serialization_failure then null;end;
 end loop;
 assert hub.promotion_read(current_setting('test.residential_promo')::uuid)->>'draft_revision'='1','Rejected update changed draft';
end $$;

set local role publisher;
do $$ declare p uuid:=current_setting('test.residential_promo')::uuid;bad jsonb;kind text;begin
 foreach bad in array array[null::jsonb,'null'::jsonb,'{}'::jsonb,'{"expected_revision":1,"expected_published_version_id":null,"change_reason":""}'::jsonb] loop
 begin perform hub.promotion_command('publish',p,bad);assert false,'Malformed publish accepted';exception when invalid_parameter_value or check_violation or not_null_violation or serialization_failure then null;end;
 end loop;
 perform hub.promotion_command('review',p,'{"expected_revision":1,"review_type":"DATA","decision":"APPROVED","evidence":"Synthetic data evidence","change_reason":"Test review"}');
 begin perform hub.promotion_command('publish',p,'{"expected_revision":1,"expected_published_version_id":null,"change_reason":"Legal missing"}');assert false,'Missing legal approval published';exception when check_violation then null;end;
 perform hub.promotion_command('review',p,'{"expected_revision":1,"review_type":"LEGAL","decision":"APPROVED","evidence":"Synthetic legal evidence","change_reason":"Test review"}');
 perform hub.promotion_command('publish',p,'{"expected_revision":1,"expected_published_version_id":null,"change_reason":"Initial test publication"}');
 perform set_config('test.residential_first_version',hub.promotion_read(p)->>'published_version_id',true);
end $$;
set local role service_consumer;
do $$ begin
 assert exists(select 1 from public_api.promotions where promotion_id=current_setting('test.residential_promo')::uuid),'Start boundary not inclusive';
 assert(select payload->>'benefit_value'='1199.99' and payload->'rag_eligible'='false'::jsonb and nullif(payload#>>'{legal_terms,th}','') is not null and nullif(payload#>>'{disclaimer,th}','') is not null from public_api.promotions where promotion_id=current_setting('test.residential_promo')::uuid),'Consumer payload lost exact amount/legal context';
 begin perform 1 from hub.promotion_reviews;assert false,'Consumer accessed review evidence';exception when insufficient_privilege then null;end;
end $$;
reset role;

-- Immutable expired snapshot fixture proves read-time [start,end), without a scheduler.
do $$ declare expired uuid;p uuid:=current_setting('test.residential_promo')::uuid;begin
 insert into hub.promotion_versions(promotion_id,version_no,draft_revision,payload,published_by,change_reason)
 select p,version_no+1,draft_revision,jsonb_set(payload,'{ends_at}',to_jsonb(now())),'00000000-0000-0000-0000-000000000002','Synthetic exact end boundary'
 from hub.promotion_versions where id=current_setting('test.residential_first_version')::uuid returning id into expired;
 update hub.public_promotions set published_version_id=expired where id=p;
 assert not exists(select 1 from public_api.promotions where promotion_id=p),'End boundary remained eligible';
 update hub.public_promotions set published_version_id=current_setting('test.residential_first_version')::uuid where id=p;
 begin update hub.promotion_versions set payload='{}' where id=expired;assert false,'Published payload mutable';exception when check_violation then null;end;
 begin delete from hub.promotion_versions where id=expired;assert false,'Published version deletable';exception when check_violation then null;end;
 update staging.source_offers set source_active=false where source_offer_key='SYNTHETIC:SQL:000021';
 assert not exists(select 1 from public_api.promotions where promotion_id=p),'Inactive source remained eligible';
 update staging.source_offers set source_active=true,source_deleted=true where source_offer_key='SYNTHETIC:SQL:000021';
 assert not exists(select 1 from public_api.promotions where promotion_id=p),'Deleted source remained eligible';
 update staging.source_offers set source_deleted=false where source_offer_key='SYNTHETIC:SQL:000021';
end $$;

set local role editor;
select hub.promotion_command('update',current_setting('test.residential_promo')::uuid,'{"expected_revision":1,"title":{"th":"ชื่อร่างใหม่"}}');
select hub.update_model(project_id,public_model_id,'{"bedrooms":3}',
 (select updated_at from hub.projects where id=m.project_id)) from hub.model_types m where project_id=current_setting('test.residential_project')::uuid;
select hub.review_model(project_id,public_model_id,(select updated_at from hub.projects where id=m.project_id),'CONFIRMED','Synthetic changed model review')
from hub.model_types m where project_id=current_setting('test.residential_project')::uuid;
do $$ begin
 assert not(hub.promotion_read(current_setting('test.residential_promo')::uuid)#>>'{readiness,ready}')::boolean,'Edit retained current approvals';
 begin perform hub.promotion_command('update',current_setting('test.residential_promo')::uuid,'{"expected_revision":1,"title":{"th":"Stale"}}');assert false,'Stale edit accepted';exception when serialization_failure then null;end;
 perform set_config('test.residential_second',hub.promotion_command('create',null,current_setting('test.residential_promo_body')::jsonb||'{"code":"SQL-PROMOTION-22"}'::jsonb)->>'id',true);
end $$;
set local role service_consumer;
do $$ begin assert(select payload#>>'{title,th}'='โปรโมชั่นสังเคราะห์' from public_api.promotions where promotion_id=current_setting('test.residential_promo')::uuid),'Draft changed published snapshot';end $$;

-- A mixed set fails atomically across brand, project (with model draft), and promotions.
set local role publisher;
do $$ declare p uuid:=current_setting('test.residential_promo')::uuid;kind text;members jsonb;before_count integer;begin
 foreach kind in array array['DATA','LEGAL'] loop
 perform hub.promotion_command('review',p,jsonb_build_object('expected_revision',2,'review_type',kind,'decision','APPROVED','evidence','Synthetic evidence','change_reason','Test review'));
 end loop;
 select jsonb_agg(jsonb_build_object('entity_type',e->'entity_type','entity_id',e->'entity_id','expected_updated_at',e->'expected_updated_at','expected_revision',e->'expected_revision','expected_published_version_id',e->'expected_published_version_id')) into members from jsonb_array_elements(hub.release_candidates(false)->'items') e
 where(e->>'entity_type'='promotion' and e->>'entity_id' in(current_setting('test.residential_promo'),current_setting('test.residential_second')))
 or(e->>'entity_type'='brand' and e->>'entity_id'=current_setting('test.residential_brand'))
 or(e->>'entity_type'='project' and e->>'entity_id'=current_setting('test.residential_project'));
 assert jsonb_array_length(members)=4,'Mixed release candidate set incomplete';
 before_count:=(hub.release_read()->>'total')::integer;
 begin perform hub.release_publish(members,'Second member lacks approvals',false);assert false,'Invalid release published';exception when check_violation then null;end;
 assert hub.promotion_read(p)->>'published_version_id'=current_setting('test.residential_first_version'),'Partial release changed first pointer';
 assert hub.promotion_read(current_setting('test.residential_second')::uuid)->>'published_version_id' is null,'Partial release changed second pointer';
 assert(select published_version_id::text=current_setting('test.residential_brand_version') from hub.brands where id=current_setting('test.residential_brand')::uuid),'Partial release changed brand pointer';
 assert(select published_version_id::text=current_setting('test.residential_project_version') from hub.projects where id=current_setting('test.residential_project')::uuid),'Partial release changed project pointer';
 assert(select payload#>>'{models,0,bedrooms}'='2' from hub.entity_versions where id=current_setting('test.residential_project_version')::uuid),'Model draft leaked into previous snapshot';
 assert(hub.release_read()->>'total')::integer=before_count,'Failed release left history';
 foreach kind in array array['DATA','LEGAL'] loop
 perform hub.promotion_command('review',current_setting('test.residential_second')::uuid,jsonb_build_object('expected_revision',1,'review_type',kind,'decision','APPROVED','evidence','Synthetic evidence','change_reason','Test review'));
 end loop;
 perform set_config('test.residential_release',hub.release_publish(members,'Complete synthetic set',false)->>'id',true);
 assert jsonb_array_length(hub.release_read(current_setting('test.residential_release')::uuid)->'members')=4,'Release did not record the complete set';
 assert(select payload#>>'{models,0,bedrooms}'='3' from hub.entity_versions where id=(select published_version_id from hub.projects where id=current_setting('test.residential_project')::uuid)),'Project release omitted model draft';
 perform hub.release_rollback(current_setting('test.residential_release')::uuid,'Restore complete previous set');
 assert hub.promotion_read(p)->>'published_version_id'=current_setting('test.residential_first_version'),'Rollback did not restore first';
 assert hub.promotion_read(current_setting('test.residential_second')::uuid)->>'published_version_id' is null,'Rollback did not withdraw previously unpublished member';
 assert(select published_version_id::text=current_setting('test.residential_brand_version') from hub.brands where id=current_setting('test.residential_brand')::uuid),'Rollback did not restore brand';
 assert(select published_version_id::text=current_setting('test.residential_project_version') from hub.projects where id=current_setting('test.residential_project')::uuid),'Rollback did not restore project and model snapshot';
 assert(select bedrooms=3 from hub.model_types where project_id=current_setting('test.residential_project')::uuid),'Rollback rewrote the model draft';
  -- A repeat publication is a new history record. Its pointer makes old rollback stale.
 select jsonb_agg(jsonb_build_object('entity_type',e->'entity_type','entity_id',e->'entity_id','expected_updated_at',e->'expected_updated_at','expected_revision',e->'expected_revision','expected_published_version_id',e->'expected_published_version_id')) into members from jsonb_array_elements(hub.release_candidates(false)->'items') e
 where(e->>'entity_type'='promotion' and e->>'entity_id' in(current_setting('test.residential_promo'),current_setting('test.residential_second')))
 or(e->>'entity_type'='brand' and e->>'entity_id'=current_setting('test.residential_brand'))
 or(e->>'entity_type'='project' and e->>'entity_id'=current_setting('test.residential_project'));
 perform set_config('test.residential_release',hub.release_publish(members,'Second complete set',false)->>'id',true);
 perform hub.promotion_command('publish',p,jsonb_build_object('expected_revision',2,'expected_published_version_id',hub.promotion_read(p)->'published_version_id','change_reason','Independent newer publication'));
 perform set_config('test.residential_latest',hub.promotion_read(p)->>'published_version_id',true);
 begin perform hub.release_rollback(current_setting('test.residential_release')::uuid,'Must not overwrite newer publication');assert false,'Stale release rollback accepted';exception when serialization_failure then null;end;
 assert hub.promotion_read(p)->>'published_version_id'=current_setting('test.residential_latest'),'Stale rollback changed pointer';
 assert(select published_version_id::text<>current_setting('test.residential_brand_version') from hub.brands where id=current_setting('test.residential_brand')::uuid),'Stale rollback changed brand';
 assert(select published_version_id::text<>current_setting('test.residential_project_version') from hub.projects where id=current_setting('test.residential_project')::uuid),'Stale rollback changed project';
 -- Runtime publication cannot select unmarked media merely by passing demo_mode.
 select jsonb_agg(jsonb_build_object('entity_type',e->'entity_type','entity_id',e->'entity_id','expected_updated_at',e->'expected_updated_at','expected_revision',e->'expected_revision','expected_published_version_id',e->'expected_published_version_id')) into members from jsonb_array_elements(hub.release_candidates(false)->'items') e
 where e->>'entity_type'='project' and e->>'entity_id'=current_setting('test.residential_project');
 begin perform hub.release_publish(members,'No seeded demo selection',true);assert false,'Unmarked project used demo publication';exception when check_violation then null;end;
end $$;

set local role editor;
select hub.promotion_command('update',current_setting('test.residential_promo')::uuid,'{"expected_revision":2,"summary":{"th":"ร่างใหม่อีกครั้ง"}}');
set local role publisher;
select hub.promotion_command('review',current_setting('test.residential_promo')::uuid,'{"expected_revision":3,"review_revision":2,"review_type":"LEGAL","decision":"REVOKED","evidence":"Synthetic revocation","change_reason":"Revoke published review after draft change"}');
set local role service_consumer;
do $$ begin assert not exists(select 1 from public_api.promotions where promotion_id=current_setting('test.residential_promo')::uuid),'Revoked published review remained visible';end $$;
reset role;
select 'PASS: residential roles, exact money, expiry, source withdrawal, immutable snapshots, atomic release/rollback and synthetic selection guards' as result;
rollback;
