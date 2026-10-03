-- LOCAL DEMO ONLY. All names, specifications and coordinates below are synthetic.
-- These are not SENA project facts, REM production records, or pilot acceptance data.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select set_config('app.change_reason','Load clearly synthetic local demo fixtures',true);
insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint)
values ('DEMO-001','ข้อมูลจำลอง — โครงการทดสอบ ไม่ใช่โครงการจริง','2026-09-16T00:00:00Z','synthetic-demo-project-v1');
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint)
values ('DEMO-001','DEMO-001-M1','แบบจำลองสำหรับทดสอบเท่านั้น','2026-09-16T00:00:00Z','synthetic-demo-model-v1');

set local role editor;
select hub.create_project_from_rem('DEMO-001');
reset role;
update hub.projects set
  public_name='{"th":"ข้อมูลจำลอง — โครงการทดสอบ ไม่ใช่โครงการจริง"}',name_source='marketing_override',
  slug='synthetic-demo-project',
  address='{"th":"ที่อยู่สมมติสำหรับทดสอบระบบเท่านั้น"}',
  latitude=13.7563,longitude=100.5018,
  ad_disclaimer='{"th":"ข้อมูลและรูปประกอบนี้สร้างขึ้นเพื่อทดสอบระบบ ไม่ใช่ข้อเสนอหรือข้อมูลโครงการจริงของ SENA"}',
  meta_title='{"th":"ข้อมูลจำลอง — ทดสอบ Digital Hub"}',
  meta_description='{"th":"ข้อมูลสังเคราะห์สำหรับทดลองแก้ไขและเผยแพร่ภายในเครื่องเท่านั้น"}'
where rem_project_id='DEMO-001';
update hub.model_types set bedrooms=2,bathrooms=1,usable_area_sqm=50,parking_spaces=1,
  match_status='CONFIRMED',verified_by='00000000-0000-0000-0000-000000000002',verified_at=now()
where rem_project_id='DEMO-001';
insert into hub.assets(id,original_filename,mime_type,public_url,rights_status) values
  ('10000000-0000-0000-0000-000000000001','synthetic-demo-hero.svg','image/svg+xml','/demo-assets/hero.svg','approved'),
  ('10000000-0000-0000-0000-000000000002','synthetic-demo-thumbnail.svg','image/svg+xml','/demo-assets/thumbnail.svg','approved');
insert into hub.entity_assets(project_id,asset_id,asset_role,alt_text)
select id,'10000000-0000-0000-0000-000000000001','hero','{"th":"ภาพประกอบสมมติสำหรับทดสอบ ไม่ใช่ภาพโครงการจริง"}' from hub.projects where rem_project_id='DEMO-001';
insert into hub.entity_assets(project_id,asset_id,asset_role,alt_text)
select id,'10000000-0000-0000-0000-000000000002','thumbnail','{"th":"ภาพตัวอย่างสมมติสำหรับทดสอบ"}' from hub.projects where rem_project_id='DEMO-001';
-- Intentionally left as a draft: the user performs the first publish explicitly.
commit;
