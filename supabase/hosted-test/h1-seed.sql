-- Wholly fictional H1 fixtures. Caller verifies the TEST profile and owns one transaction.
-- No issuance function or approval/TEST switch is called. No real REM identity is copied.
select set_config('app.actor_id','70000000-0000-0000-0000-000000000002',true);
select set_config('app.change_reason','SYNTHETIC-HOSTED-H1-v1: fictional demonstration, no real approval',true);

insert into staging.rem_brands(rem_brand_id,brand_name_rem,brand_name_en_rem,source_updated_at,source_fingerprint,source_record)
values('H1-BRAND-001','ข้อมูลตัวอย่าง — แบรนด์สวนสมมติ','H1 DEMO BRAND',now(),'SYNTHETIC-HOSTED-H1-v1','{"synthetic_only":true,"source":"hosted-h1-fixture"}');
insert into staging.rem_projects(rem_project_id,project_name_rem,rem_brand_id,source_updated_at,source_fingerprint,source_record)
values('H1-PROJECT-001','ข้อมูลตัวอย่าง — โครงการสวนสมมติ','H1-BRAND-001',now(),'SYNTHETIC-HOSTED-H1-v1','{"synthetic_only":true,"source":"hosted-h1-fixture"}');
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint,source_record)
values('H1-PROJECT-001','H1-MODEL-001','ข้อมูลตัวอย่าง — แบบบ้านสมมติ',now(),'SYNTHETIC-HOSTED-H1-v1','{"synthetic_only":true,"source":"hosted-h1-fixture"}');

insert into hub.brands(id,public_brand_id,rem_brand_id,public_name,description,slug,demo_fields)
values('71000000-0000-0000-0000-000000000001','brd_71000000000000000000000000000001','H1-BRAND-001',
 '{"th":"ข้อมูลตัวอย่าง — แบรนด์สวนสมมติ"}','{"th":"แบรนด์สมมติสำหรับทดลองระบบ ไม่ใช่แบรนด์หรือข้อมูลจริงของ SENA"}',
 'h1-fictional-garden-brand',array['source','public_name.th','description.th','slug']);
insert into hub.projects(id,public_project_id,rem_project_id,brand_id,public_name,name_source,slug,address,latitude,longitude,ad_disclaimer,meta_title,meta_description,demo_fields)
values('71000000-0000-0000-0000-000000000002','prj_71000000000000000000000000000002','H1-PROJECT-001','71000000-0000-0000-0000-000000000001',
 '{"th":"ข้อมูลตัวอย่าง — โครงการสวนสมมติ"}','marketing_override','h1-fictional-garden-project','{"th":"ที่อยู่สมมติสำหรับทดสอบเท่านั้น"}',13.7563,100.5018,
 '{"th":"ข้อมูลตัวอย่างและภาพกราฟิกสังเคราะห์ ไม่ใช่ข้อเสนอขายหรือข้อมูลโครงการจริง"}',
 '{"th":"ข้อมูลตัวอย่าง — โครงการสวนสมมติ"}','{"th":"ข้อมูลสมมติเพื่อทดสอบการเผยแพร่เท่านั้น"}',
 array['source','public_name.th','address.th','latitude','longitude','ad_disclaimer.th','meta_title.th','meta_description.th','slug']);
insert into hub.model_types(id,public_model_id,project_id,rem_project_id,rem_model_id,public_name,bedrooms,bathrooms,usable_area_sqm,parking_spaces,match_status,verified_by,verified_at,demo_fields)
values('71000000-0000-0000-0000-000000000003','mdl_71000000000000000000000000000003','71000000-0000-0000-0000-000000000002','H1-PROJECT-001','H1-MODEL-001',
 '{"th":"ข้อมูลตัวอย่าง — แบบบ้านสมมติ"}',1,1,30,0,'CONFIRMED','70000000-0000-0000-0000-000000000002',now(),
 array['source','public_name.th','bedrooms','bathrooms','usable_area_sqm','parking_spaces','match_status']);

insert into hub.assets(id,original_filename,mime_type,public_url,rights_status,asset_type,storage_bucket,storage_path,checksum,file_size,width,height,language,owner_id,provenance,source_system)
select (payload->>'id')::uuid,payload->>'original_filename','image/png','/v1/assets/'||(payload->>'id')||'/file','pending','image',
 'hub-test-assets',payload->>'storage_path',payload->>'checksum',(payload->>'file_size')::bigint,(payload->>'width')::int,(payload->>'height')::int,
 'th','70000000-0000-0000-0000-000000000002','upload','hub-hosted-test' from h1_seed_assets;
set local role publisher;
select hub.review_asset(a.id,a.updated_at,'approved','SYNTHETIC-HOSTED-H1-v1: generated test pixels, not real rights evidence',null,null,'ข้อมูลตัวอย่างสำหรับทดสอบเท่านั้น')
from hub.assets a where a.id in('71000000-0000-0000-0000-000000000011','71000000-0000-0000-0000-000000000012','71000000-0000-0000-0000-000000000013');
reset role;
insert into hub.brand_assets(brand_id,asset_id,asset_role,alt_text)
values('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000011','logo_primary','{"th":"ข้อมูลตัวอย่าง: ลายตารางสังเคราะห์ ไม่ใช่โลโก้จริง"}');
insert into hub.entity_assets(project_id,asset_id,asset_role,alt_text) values
 ('71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000012','hero','{"th":"ข้อมูลตัวอย่าง: ลายตารางสังเคราะห์ ไม่ใช่ภาพโครงการจริง"}'),
 ('71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000013','thumbnail','{"th":"ข้อมูลตัวอย่าง: ภาพกราฟิกสังเคราะห์"}');

insert into hub.public_promotions(id,project_id,code,title,summary,conditions_public,legal_terms,disclaimer,benefit_type,benefit_value,benefit_unit,starts_at,ends_at,demo_fields,created_by,updated_by)
values('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000002','H1-FICTIONAL-GIFT',
 '{"th":"ข้อมูลตัวอย่าง — โปรโมชั่นของขวัญสมมติ"}','{"th":"ของขวัญสมมติหนึ่งชิ้น ไม่มีสิทธิ์รับของจริง"}',
 '{"th":"สาธิตระบบเท่านั้น ไม่ใช่ข้อเสนอขาย"}','{"th":"ข้อความสมมติ ไม่ใช่คำอนุมัติจากฝ่ายกฎหมาย"}',
 '{"th":"ข้อมูลตัวอย่าง ไม่ก่อให้เกิดสิทธิ์หรือภาระผูกพัน"}','gift',1,'items','2026-10-01T00:00:00+07:00','2030-10-01T00:00:00+07:00',
 array['source','title.th','summary.th','conditions_public.th','legal_terms.th','disclaimer.th','benefit_value','starts_at','ends_at'],
 '70000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000002');
set local role publisher;
select hub.promotion_command('review','71000000-0000-0000-0000-000000000004',jsonb_build_object('expected_revision',1,'review_revision',1,'review_type',kind,'decision','APPROVED',
 'evidence','SYNTHETIC-HOSTED-H1-v1: simulation review only','change_reason','ข้อมูลตัวอย่าง ไม่ใช่การอนุมัติจริง'))
from unnest(array['DATA','LEGAL']) kind;
select hub.release_publish((select jsonb_agg(jsonb_build_object(
 'entity_type',e->'entity_type','entity_id',e->'entity_id','expected_updated_at',e->'expected_updated_at',
 'expected_revision',e->'expected_revision','expected_published_version_id',e->'expected_published_version_id'))
 from jsonb_array_elements(hub.release_candidates(false)->'items') e),
 'SYNTHETIC-HOSTED-H1-v1: isolated TEST release only',false);
reset role;

insert into ads.scope_code(scope_id,scope_code,kind,label_th,label_en,member_signature,status,source_fingerprint)
values('71000000-0000-0000-0000-000000000021','C-H1DM-DEMO1','GROUP','ข้อมูลตัวอย่าง — โครงการสวนสมมติ','H1 DEMO PROJECT',
 '[["GROUP", "C-H1DM-DEMO1", null]]','ACTIVE','SYNTHETIC-HOSTED-H1-v1');
insert into ads.scope_member(scope_id,member_type,member_id)
values('71000000-0000-0000-0000-000000000021','GROUP','C-H1DM-DEMO1');
insert into ads.campaign_registration(code,sequence_year,sequence_no,scope_id,objective,agency,label,created_by)
select code,2026,sequence_no,'71000000-0000-0000-0000-000000000021','LEADS',agency,'H1 DEMO PROJECT','70000000-0000-0000-0000-000000000005'
from h1_seed_codes;
insert into ads.campaign_name(code,frozen_name,utm_campaign,issued_by)
select code, label||'__'||objective||'__C-H1DM-DEMO1__'||agency||'__'||code,
 label||'__'||objective||'__C-H1DM-DEMO1__'||agency||'__'||code,'70000000-0000-0000-0000-000000000005'
from ads.campaign_registration where scope_id='71000000-0000-0000-0000-000000000021';
insert into ads.code_sequence(sequence_year,last_value) values(2026,90002);
