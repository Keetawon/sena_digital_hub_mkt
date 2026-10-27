-- Owner H2: append business-sheet evidence without changing REM/DW state.
begin;
alter table staging.project_intake_evidence drop constraint project_intake_evidence_kind_check;
alter table staging.project_intake_evidence add constraint project_intake_evidence_kind_check
 check(kind in ('projects','models','gold_projects','gold_models','business_projects'));

-- Business sheets never change the DW status, missing/deleted flags, exception
-- baseline or first-import policy. Existing private table ACLs stay unchanged.
create or replace function hub.project_source_review(rem_id text) returns jsonb
language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare r jsonb; code text; deleted jsonb; flags jsonb; exceptions jsonb; latest_hash text;
begin
  select record into r from staging.project_intake_evidence
    where kind='projects' and rem_project_id=rem_id and record is not null order by id desc limit 1;
  if r is null then select source_record into r from staging.rem_projects where rem_project_id=rem_id; end if;
  code := case when r ? 'ProjectStatus' then r->>'ProjectStatus' else r->>'project_status' end;
  deleted := case when r ? 'isDeleted' then r->'isDeleted' else coalesce(r->'is_deleted','null'::jsonb) end;
  select receipt.manifest_sha256 into latest_hash from staging.project_intake_receipts receipt
    join staging.intake_batches b using(manifest_sha256)
    where b.manifest->>'source_system' is distinct from 'business_sheet'
    order by receipt.imported_at desc,receipt.manifest_sha256 desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('code',e->>'issue_code','keys',e->'keys') order by e->>'exception_key'),'[]') into exceptions
    from staging.intake_batches b cross join lateral jsonb_array_elements(b.datasets->'exceptions') e
    where b.manifest_sha256=latest_hash and coalesce(e#>>'{keys,ProjectID}',e#>>'{keys,project_id}')=rem_id;
  select coalesce(jsonb_agg(distinct outcome) filter(where outcome in ('changed','missing','deleted')),'[]') into flags
    from (select distinct on(kind,source_id) outcome from staging.project_intake_evidence
          where rem_project_id=rem_id and kind in ('projects','models','gold_projects','gold_models') order by kind,source_id,id desc) recent;
  return jsonb_build_object('status_raw',code,'status_label',case code when '0' then 'พรีเซล' when '1' then 'กำลังก่อสร้าง' when '2' then 'พร้อมอยู่' when '3' then 'ปิดโครงการ' else 'ไม่ทราบสถานะ' end,
    'is_deleted',deleted,'default_scope',coalesce(deleted='false'::jsonb and code in ('0','1','2'),false),
    'flags',flags,'exceptions',exceptions,
    'brand_binding_allowed',not exists(select 1 from jsonb_array_elements(exceptions) e where e->>'code'='PROJECT_BRAND_MISSING')
      and exists(select 1 from staging.rem_projects p join staging.rem_brands b using(rem_brand_id) where p.rem_project_id=rem_id and b.is_deleted=false),
    'gold_prefill_allowed',not exists(select 1 from jsonb_array_elements(exceptions) e where e->>'code'='GOLD_PROJECT_IDENTITY_OR_GROUP_CONFLICT'),
    'first_import_only',(select count(*)<=1 from staging.project_intake_receipts receipt join staging.intake_batches b using(manifest_sha256) where b.manifest->>'source_system' is distinct from 'business_sheet'));
end $$;
commit;
