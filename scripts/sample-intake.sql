-- LOCAL SAMPLES ONLY: staged records for selecting a project and reviewing models.
-- These are fabricated examples, not residential project facts or real REM records.
begin;
insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint)
values ('DEMO-002','ข้อมูลจำลอง — โครงการฝึกนำเข้า ไม่ใช่โครงการจริง','2026-09-16T00:00:00Z','synthetic-intake-project-v1')
on conflict do nothing;
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint)
values
  ('DEMO-002','DEMO-002-M1','แบบจำลอง ก — สำหรับฝึกตรวจสอบ','2026-09-16T00:00:00Z','synthetic-intake-model-a-v1'),
  ('DEMO-002','DEMO-002-M2','แบบจำลอง ข — สำหรับฝึกตรวจสอบ','2026-09-16T00:00:00Z','synthetic-intake-model-b-v1')
on conflict do nothing;
commit;
