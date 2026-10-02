-- LOCAL SAMPLES ONLY. No REM/DW facts or real SENA brand/company mappings.
-- One synthetic brand spans two synthetic project companies to demonstrate the relationship.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
select set_config('app.change_reason','Prepare synthetic local brand and company examples',true);
insert into staging.rem_brands(rem_brand_id,brand_name_rem,brand_name_en_rem,source_updated_at,source_fingerprint) values
  ('DEMO-BRAND-01','แบรนด์จำลอง — สำหรับทดสอบเท่านั้น','Synthetic demonstration brand','2026-09-16T00:00:00Z','synthetic-brand-01'),
  ('DEMO-BRAND-02','แบรนด์ฝึกเพิ่ม — ไม่ใช่แบรนด์จริง','Synthetic brand for intake practice','2026-09-16T00:00:00Z','synthetic-brand-02');
insert into staging.rem_companies(rem_company_id,company_name_rem,company_name_en_rem,source_updated_at,source_fingerprint) values
  ('DEMO-CO-A','บริษัทสมมติ ก — สำหรับทดสอบ','Synthetic company A','2026-09-16T00:00:00Z','synthetic-company-a'),
  ('DEMO-CO-B','บริษัทสมมติ ข — สำหรับทดสอบ','Synthetic company B','2026-09-16T00:00:00Z','synthetic-company-b');
update staging.rem_projects set rem_brand_id='DEMO-BRAND-01',rem_company_id='DEMO-CO-A' where rem_project_id='DEMO-001';
update staging.rem_projects set rem_brand_id='DEMO-BRAND-01',rem_company_id='DEMO-CO-B' where rem_project_id='DEMO-002';
insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint,rem_brand_id,rem_company_id)
values ('DEMO-003','ข้อมูลจำลอง — โครงการฝึกเลือกแบรนด์ ไม่ใช่โครงการจริง','2026-09-16T00:00:00Z','synthetic-brand-intake-project','DEMO-BRAND-02','DEMO-CO-B');
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint)
values ('DEMO-003','DEMO-003-M1','แบบจำลอง — สำหรับฝึกเลือกแบรนด์','2026-09-16T00:00:00Z','synthetic-brand-intake-model');
set local role admin;
select hub.create_brand_from_rem('DEMO-BRAND-01');
reset role;
update hub.brands set public_name='{"th":"แบรนด์จำลอง — สำหรับทดสอบเท่านั้น","en":"Synthetic demonstration brand"}',
  slug='synthetic-demo-brand',description='{"th":"แบรนด์และบริษัททั้งหมดในตัวอย่างนี้สร้างขึ้นเพื่อทดสอบ ไม่มีความเกี่ยวข้องกับแบรนด์หรือบริษัทจริง"}'
where rem_brand_id='DEMO-BRAND-01';
insert into hub.assets(id,original_filename,mime_type,public_url,rights_status,rights_notes)
values ('10000000-0000-0000-0000-000000000003','synthetic-demo-brand-logo.svg','image/svg+xml','/demo-assets/brand-logo.svg','approved','สื่อสมมติที่มากับระบบสำหรับทดสอบภายในเครื่องเท่านั้น');
set local role admin;
select hub.bind_brand_asset(id,'10000000-0000-0000-0000-000000000003','logo_primary','{"th":"โลโก้แบรนด์สมมติสำหรับทดสอบเท่านั้น"}',updated_at)
from hub.brands where rem_brand_id='DEMO-BRAND-01';
reset role;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
set local role publisher;
select hub.publish_brand(id,'เตรียมแบรนด์สมมติที่พร้อมใช้สำหรับตัวอย่างในเครื่อง') from hub.brands where rem_brand_id='DEMO-BRAND-01';
reset role;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
set local role editor;
select hub.assign_project_brand(p.id,b.id,p.updated_at) from hub.projects p cross join hub.brands b
where p.rem_project_id in ('DEMO-001','DEMO-002') and b.rem_brand_id='DEMO-BRAND-01';
reset role;
-- Pre-brand demo releases cannot satisfy the new contract. Retain their immutable
-- history but return those synthetic examples to draft for an explicit new release.
update hub.projects p set published_version_id=null
where p.rem_project_id in ('DEMO-001','DEMO-002') and exists (
  select 1 from hub.entity_versions v where v.id=p.published_version_id and v.payload->>'brand_version_id' is null
);
commit;
