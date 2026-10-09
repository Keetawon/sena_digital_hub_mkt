begin;
insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint)
  values('KN-PILOT','โครงการทดสอบความรู้',now(),'synthetic'),('TPRAK','ระยะปิดสมมติ',now(),'synthetic');
insert into staging.knowledge_batches(manifest_sha256,manifest) values(repeat('a',64),'{}');
insert into staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,topic,source_ref,evidence,holds) values
('00000000-0000-4000-9000-000000000001',repeat('a',64),'test-section','section',array['KN-PILOT'],'design','synthetic','{"title":{"th":"สวน"},"body":{"th":"โครงการทดสอบความรู้ มีสวน"}}','{}'),
('00000000-0000-4000-9000-000000000002',repeat('a',64),'test-phase','section',array['KN-PILOT','TPRAK'],'design','synthetic','{"title":{"th":"สวน"},"body":{"th":"โครงการทดสอบ มีสวน"}}',array['needs_phase_decision']),
('00000000-0000-4000-9000-000000000003',repeat('a',64),'test-price','fact',array['KN-PILOT'],'commercial_terms','synthetic','{"source_value":"ราคา 3 ล้านบาท"}',array['commercial_text']),
('00000000-0000-4000-9000-000000000004',repeat('a',64),'test-asset','asset',array['KN-PILOT'],'media_documents','synthetic','{"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","classification":{"people":"absent","third_party_marks":"absent","stock_imagery":"unknown"}}','{}');
insert into rag.project_fact_cards(rem_project_id,batch_sha256,payload)
  values('KN-PILOT',repeat('a',64),'{"mode":"DRAFT_PREVIEW"}');
do $$ begin
  assert not has_table_privilege('service_consumer','staging.knowledge_candidates','SELECT');
  assert not has_table_privilege('agency','rag.knowledge_preview_chunks','SELECT');
  assert not has_table_privilege('viewer','hub.knowledge_reviews','UPDATE');
  assert not has_function_privilege('publisher','hub.review_knowledge_candidate(uuid,integer,text,text[],text,boolean,text,text)','EXECUTE');
  begin update staging.knowledge_candidates set topic='changed'; raise exception 'immutable evidence changed'; exception when check_violation then null; end;
end $$;
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select hub.review_knowledge_candidate('00000000-0000-4000-9000-000000000001',0,'accepted',array['KN-PILOT'],'ตรวจข้อมูลสมมติแล้ว',false,null,null);
do $$ begin
  assert (select count(*) from hub.content_sections where status='DRAFT')=1;
  begin perform hub.review_knowledge_candidate('00000000-0000-4000-9000-000000000001',0,'accepted',array['KN-PILOT'],'stale',false,null,null);raise exception 'stale replay accepted';exception when serialization_failure then null;end;
  begin perform hub.review_knowledge_candidate('00000000-0000-4000-9000-000000000002',0,'accepted',array['TPRAK'],'wrong phase',false,null,null);raise exception 'closed phase accepted';exception when check_violation then null;end;
  begin perform hub.review_knowledge_candidate('00000000-0000-4000-9000-000000000002',0,'accepted','{}','no phase',false,null,null);raise exception 'empty phase accepted';exception when check_violation then null;end;
  begin perform hub.review_knowledge_candidate('00000000-0000-4000-9000-000000000003',0,'accepted',array['KN-PILOT'],'held',false,null,null);raise exception 'held price accepted';exception when check_violation then null;end;
end $$;
select hub.review_knowledge_candidate('00000000-0000-4000-9000-000000000002',0,'accepted',array['KN-PILOT'],'ยืนยันเฉพาะระยะที่เปิด',false,null,null);
select hub.review_knowledge_candidate('00000000-0000-4000-9000-000000000004',0,'accepted',array['KN-PILOT'],'ตรวจไฟล์สมมติ',true,'gallery','สวนสมมติ');
reset role;
-- Reach the classification guard using a real visible upload with the exact
-- candidate checksum, rather than failing earlier on an inaccessible UUID.
insert into hub.assets(id,original_filename,mime_type,public_url,rights_status,checksum,owner_id,provenance)
 values('00000000-0000-4000-9000-000000009999','synthetic.png','image/png','https://example.test/synthetic.png','approved',repeat('b',64),
 '00000000-0000-0000-0000-000000000002','upload');
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ begin
  begin perform hub.knowledge_link_approved_asset('00000000-0000-4000-9000-000000000004','00000000-0000-4000-9000-000000009999',1);raise exception 'unknown stock bypassed';exception when check_violation then null;end;
end $$;
set local role viewer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
select hub.record_knowledge_gap('KN-PILOT','NO_ANSWER',repeat('c',64));
select hub.record_knowledge_gap('KN-PILOT','NO_ANSWER',repeat('c',64));
do $$ begin
  assert (select count(*) from hub.knowledge_candidate_rows() where source_ref='synthetic')=4;
  assert (select count(*) from hub.content_gaps where project_id='KN-PILOT' and question_sha256=repeat('c',64))=1;
  assert not has_schema_privilege('viewer','staging','USAGE');
end $$;
reset role;
do $$ begin
  assert (select count(*) from audit.change_log where table_name='hub.knowledge_reviews' and after_row->>'candidate_id'='00000000-0000-4000-9000-000000000001')=1;
  assert not exists(select 1 from hub.content_sections where status<>'DRAFT');
end $$;
rollback;
