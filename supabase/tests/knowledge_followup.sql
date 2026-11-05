begin;
insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint)
  values('KN-FOLLOW','โครงการทดสอบ',now(),'synthetic');
insert into staging.knowledge_batches values(repeat('d',64),'{}',now());
insert into staging.knowledge_followup_batches values(repeat('e',64),'{}',now());
insert into staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,topic,source_ref,evidence,holds) values
('00000000-0000-4000-9800-000000000001',repeat('d',64),'follow-section','section',array['KN-FOLLOW'],'design','synthetic','{"title":{"th":"สวน"},"body":{"th":"โครงการทดสอบ มีสวน"}}','{}'),
('00000000-0000-4000-9800-000000000002',repeat('d',64),'follow-hero','asset',array['KN-FOLLOW'],'media_documents','synthetic','{"sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","classification":{"people":"absent","third_party_marks":"absent","stock_imagery":"absent"}}','{}'),
('00000000-0000-4000-9800-000000000003',repeat('d',64),'follow-hero2','asset',array['KN-FOLLOW'],'media_documents','synthetic','{}','{}');
insert into staging.knowledge_eval_questions values('synthetic-question',repeat('e',64),'KN-FOLLOW','มีสวนไหม','มีสวน',array['00000000-0000-4000-9800-000000000001']::uuid[],'tuning','{}',array['synthetic'],'DRAFT_MKT_TO_VERIFY');
insert into staging.knowledge_eval_questions values('phase-question',repeat('e',64),'KN-FOLLOW','สวนของระยะนี้ไหม','มีสวน',array['00000000-0000-4000-9800-000000000001']::uuid[],'held_out',array['needs_phase_decision'],array['synthetic'],'DRAFT_MKT_TO_VERIFY');
insert into rag.project_fact_cards values('KN-FOLLOW',repeat('d',64),'{"status":{"raw":1}}','DRAFT_PREVIEW');
insert into rag.knowledge_preview_chunks(candidate_id,project_ids,locale,chunk_text,keywords,content_sha256,embedding_model,embedding)
 values('00000000-0000-4000-9800-000000000001',array['KN-FOLLOW'],'th','โครงการทดสอบ มีสวน',array['สวน'],repeat('d',64),'synthetic',array_fill(0::real,array[1536]));
-- Historical accepted FAQ evidence is seeded by the disposable test operator,
-- never by the now-closed acceptance command. It remains readable for private
-- preview, while no legacy decision may create, revise or withdraw its draft.
select set_config('app.change_reason','Synthetic immutable legacy FAQ fixture',true);
insert into staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,topic,source_ref,evidence,holds)
 values('00000000-0000-4000-9800-000000000004',repeat('d',64),'follow-legacy-faq','faq',array['KN-FOLLOW'],'design','synthetic-n7',
 '{"canonical_question":{"th":"Synthetic legacy question"},"short_answer":{"th":"Synthetic legacy answer"}}','{}');
insert into hub.knowledge_reviews(candidate_id,decision,applies_to_project_ids,note,reviewed_by)
 values('00000000-0000-4000-9800-000000000004','accepted',array['KN-FOLLOW'],'Synthetic historical review','00000000-0000-0000-0000-000000000001');
insert into hub.faqs(id,candidate_id,scope_type,scope_id,applies_to_project_ids,topic,canonical_question,short_answer,source_ref,reviewed_by)
 values('00000000-0000-4000-9800-000000000104','00000000-0000-4000-9800-000000000004','project','KN-FOLLOW',array['KN-FOLLOW'],'design',
 '{"th":"Synthetic legacy question"}','{"th":"Synthetic legacy answer"}','synthetic-n7','00000000-0000-0000-0000-000000000001');
insert into hub.faq_versions(id,faq_id,version_no,question,short_answer,answer_kind,applies_to_project_ids,editors)
 values('00000000-0000-4000-9800-000000000204','00000000-0000-4000-9800-000000000104',1,
 '{"th":"Synthetic legacy question"}','{"th":"Synthetic legacy answer"}','text',array['KN-FOLLOW'],array['00000000-0000-0000-0000-000000000001']::uuid[]);
update hub.faqs set draft_version_id='00000000-0000-4000-9800-000000000204' where id='00000000-0000-4000-9800-000000000104';
insert into rag.knowledge_preview_chunks(candidate_id,project_ids,locale,chunk_text,keywords,content_sha256,embedding_model,embedding)
 values('00000000-0000-4000-9800-000000000004',array['KN-FOLLOW'],'th','Synthetic legacy answer',array['Synthetic'],repeat('f',64),'synthetic',array_fill(0::real,array[1536]));
create temporary table original_public_count as select count(*) n from hub.entity_versions;
do $$ begin
 assert not has_function_privilege('editor','hub.publish_knowledge_preview(text,jsonb,text)','EXECUTE');
 assert not has_table_privilege('service_consumer','hub.knowledge_preview_releases','SELECT');
 assert not has_table_privilege('viewer','staging.knowledge_eval_questions','SELECT');
 begin update staging.knowledge_eval_questions set expected_answer='changed'; raise exception 'evidence changed'; exception when check_violation then null; end;
end $$;
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select hub.review_knowledge_question('synthetic-question',0,'verified','โครงการทดสอบมีสวน','ตรวจคำตอบแล้ว');
do $$ begin
 begin perform hub.review_knowledge_question('synthetic-question',0,'verified','มีสวน','stale'); raise exception 'stale allowed'; exception when serialization_failure then null; end;
 assert exists(select 1 from jsonb_array_elements(hub.knowledge_followup('KN-FOLLOW')->'questions') q where q->>'id'='synthetic-question' and q#>>'{review,expected_answer}'='โครงการทดสอบมีสวน');
 begin perform hub.review_knowledge_question('phase-question',0,'verified','มีสวน','held'); raise exception 'unresolved phase verified'; exception when check_violation then null; end;
end $$;
select hub.review_knowledge_candidate('00000000-0000-4000-9800-000000000001',0,'accepted',array['KN-FOLLOW'],'ตรวจเนื้อหา',false,null,null);
select hub.review_knowledge_question('phase-question',0,'verified','โครงการระยะนี้มีสวน','MKT ยืนยันระยะแล้ว');
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ declare expected jsonb; begin
 select jsonb_object_agg(candidate_id::text,revision) into expected from hub.knowledge_reviews where 'KN-FOLLOW'=any(applies_to_project_ids);
 begin perform hub.publish_knowledge_preview('KN-FOLLOW',expected,'no hero'); raise exception 'zero heroes allowed'; exception when check_violation then null; end;
end $$;
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select hub.review_knowledge_candidate('00000000-0000-4000-9800-000000000002',0,'accepted',array['KN-FOLLOW'],'ตรวจภาพหลัก',true,'hero','สวน');
do $$ begin
 begin perform hub.review_knowledge_candidate('00000000-0000-4000-9800-000000000003',0,'accepted',array['KN-FOLLOW'],'ภาพซ้ำ',true,'hero','สวน'); raise exception 'second hero allowed'; exception when check_violation then null; end;
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ declare expected jsonb; begin
 select jsonb_object_agg(candidate_id::text,revision) into expected from hub.knowledge_reviews where 'KN-FOLLOW'=any(applies_to_project_ids);
 begin perform hub.publish_knowledge_preview('KN-FOLLOW','{}','stale'); raise exception 'stale release allowed'; exception when serialization_failure then null; end;
 begin perform hub.publish_knowledge_preview('KN-FOLLOW',expected,'missing rights'); raise exception 'unapproved image allowed'; exception when check_violation then null; end;
end $$;
reset role;
select set_config('app.change_reason','synthetic rights fixture',true);
insert into hub.assets(id,original_filename,mime_type,public_url,rights_status,checksum,owner_id,provenance)
 values('00000000-0000-4000-9800-000000000099','synthetic.png','image/png','https://example.test/synthetic.png','approved',repeat('d',64),
 '00000000-0000-0000-0000-000000000002','upload');
set local role publisher;
select hub.knowledge_link_approved_asset('00000000-0000-4000-9800-000000000002','00000000-0000-4000-9800-000000000099',1);
do $$ declare expected jsonb; release_id uuid; begin
 select jsonb_object_agg(candidate_id::text,revision) into expected from hub.knowledge_reviews where 'KN-FOLLOW'=any(applies_to_project_ids);
 release_id:=hub.publish_knowledge_preview('KN-FOLLOW',expected,'พรีวิวส่วนตัวสมมติ');
 assert (select payload->>'mode' from hub.knowledge_preview_releases where id=release_id)='PRIVATE_PREVIEW';
 assert (select jsonb_array_length(payload->'chunks') from hub.knowledge_preview_releases where id=release_id)=2;
 assert (select array_agg(c->>'kind' order by c->>'kind') from hub.knowledge_preview_releases r,
  lateral jsonb_array_elements(r.payload->'chunks') c where r.id=release_id)=array['faq','section'];
end $$;
reset role;
update hub.assets set effective_to=now()-interval '1 day' where id='00000000-0000-4000-9800-000000000099';
set local role publisher;
do $$ declare expected jsonb; begin
 select jsonb_object_agg(candidate_id::text,revision) into expected from hub.knowledge_reviews where 'KN-FOLLOW'=any(applies_to_project_ids);
 begin perform hub.publish_knowledge_preview('KN-FOLLOW',expected,'expired rights'); raise exception 'expired rights allowed'; exception when check_violation then null; end;
end $$;
reset role;
do $$ begin
 assert (select count(*) from hub.entity_versions)=(select n from original_public_count);
 begin delete from hub.knowledge_preview_releases where rem_project_id='KN-FOLLOW'; raise exception 'preview mutated'; exception when check_violation then null; end;
end $$;
-- N7 denial also protects already accepted, keyless historical versions.
set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
do $$ declare choice text; faq_before jsonb; version_before jsonb; review_before jsonb; begin
 select to_jsonb(f) into faq_before from hub.faqs f where id='00000000-0000-4000-9800-000000000104';
 select to_jsonb(v) into version_before from hub.faq_versions v where id='00000000-0000-4000-9800-000000000204';
 select to_jsonb(r) into review_before from hub.knowledge_reviews r where candidate_id='00000000-0000-4000-9800-000000000004';
 assert faq_before->>'question_key' is null and version_before->>'state'='DRAFT';
 foreach choice in array array['accepted','rejected','missing'] loop
  begin
   perform hub.review_knowledge_candidate('00000000-0000-4000-9800-000000000004',1,choice,array['KN-FOLLOW'],'N7 historical denial',false,null,null);
   raise exception 'Historical FAQ mutation was allowed';
  exception when check_violation then
   assert sqlerrm like 'Legacy FAQ candidates are read-only%';
  end;
  assert (select to_jsonb(f) from hub.faqs f where id='00000000-0000-4000-9800-000000000104')=faq_before;
  assert (select to_jsonb(v) from hub.faq_versions v where id='00000000-0000-4000-9800-000000000204')=version_before;
  assert (select count(*) from hub.faq_versions where faq_id='00000000-0000-4000-9800-000000000104')=1;
  assert (select to_jsonb(r) from hub.knowledge_reviews r where candidate_id='00000000-0000-4000-9800-000000000004')=review_before;
 end loop;
end $$;
reset role;
rollback;
