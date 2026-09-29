-- LOCAL synthetic fixtures only. Never deploy this file to production.
begin;
alter function ads.require_issuance() set app.ads_test_issuing='on';
select set_config('app.change_reason','Local synthetic ads picker fixtures',true);
insert into ads.scope_code(scope_id,scope_code,kind,label_th,label_en,parent_group_id,member_signature,status,source_fingerprint)
select id::uuid,token,kind,label_th,label_en,parent_id,ads.scope_signature(jsonb_build_array(jsonb_build_object(
  'member_type',member_type,'member_id',member_id,'parent_group_id',parent_id))),'ACTIVE','local-synthetic-p1'
from (values
 ('30000000-0000-0000-0000-000000000001','C-DEMO-TEST1','GROUP','โครงการทดสอบหนึ่ง','TEST PROJECT ONE',null,'GROUP','C-DEMO-TEST1'),
 ('30000000-0000-0000-0000-000000000002','C-DEMO-TEST2','GROUP','โครงการทดสอบสอง','TEST PROJECT TWO',null,'GROUP','C-DEMO-TEST2'),
 ('30000000-0000-0000-0000-000000000003','C-DEMO-TEST1-00001','PHASE','เฟสทดสอบ 00001','TEST PHASE 00001','C-DEMO-TEST1','PHASE','00001'),
 ('30000000-0000-0000-0000-000000000004','C-DEMO-TEST1-00002','PHASE','เฟสทดสอบ 00002','TEST PHASE 00002','C-DEMO-TEST1','PHASE','00002'),
 ('30000000-0000-0000-0000-000000000005','CORP-TESTCONTENT','CORP','เนื้อหาองค์กรทดสอบ','TEST CONTENT',null,'CORPORATE','TESTCONTENT'),
 ('30000000-0000-0000-0000-000000000006','BRAND-TESTBRAND','BRAND','แบรนด์ทดสอบ','TEST BRAND',null,'BRAND','000TESTBRAND'),
 ('30000000-0000-0000-0000-000000000007','BU-TESTUNIT','BU','หน่วยธุรกิจทดสอบ','TEST UNIT',null,'BU','TESTUNIT')
) f(id,token,kind,label_th,label_en,parent_id,member_type,member_id)
on conflict(scope_id) do nothing;
insert into ads.scope_member(scope_id,member_type,member_id,parent_group_id)
select scope_id,x->>0,x->>1,x->>2 from ads.scope_code s cross join lateral jsonb_array_elements(s.member_signature::jsonb) x
where source_fingerprint='local-synthetic-p1'
  and not exists(select 1 from ads.scope_member m where m.scope_id=s.scope_id)
on conflict do nothing;
commit;
