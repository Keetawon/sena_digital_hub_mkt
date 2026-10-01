-- Synthetic assistant ownership and explicit draft confirmation; everything rolls back.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000091',true);
select set_config('app.change_reason','SYNTHETIC-ASSISTANT-SQL',true);
insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint) values('ASSISTANT-SQL-23','Synthetic assistant brand',now(),'synthetic-assistant-23');
insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint,rem_brand_id) values('ASSISTANT-SQL-23','Synthetic assistant project',now(),'synthetic-assistant-23','ASSISTANT-SQL-23');
set local role admin;
select set_config('test.assistant_brand',hub.create_brand_from_rem('ASSISTANT-SQL-23')::text,true);
select hub.update_brand_draft(id,'{"description":{"th":"ข้อความแบรนด์ตัวอย่าง","en":"Keep English brand"}}',updated_at) from hub.brands where id=current_setting('test.assistant_brand')::uuid;
set local role editor;
select set_config('test.assistant_project',hub.create_project_from_rem('ASSISTANT-SQL-23')::text,true);
select hub.patch_project(id,'{"meta_title":{"th":"ชื่อตัวอย่าง","en":"Keep English title"},"meta_description":{"th":"คำอธิบายตัวอย่าง","en":"Keep English description"}}',updated_at) from hub.projects where id=current_setting('test.assistant_project')::uuid;
reset role;
select hub.mark_demo_fields('project',current_setting('test.assistant_project')::uuid,array['meta_title.th','meta_description.th']);
select hub.mark_demo_fields('brand',current_setting('test.assistant_brand')::uuid,array['description.th']);

do $$ declare table_name regclass;role_name text;begin
 foreach table_name in array array['internal.assistant_run'::regclass,'internal.assistant_tool'::regclass,'internal.assistant_citation'::regclass,'internal.assistant_proposal'::regclass,'internal.assistant_proposal_application'::regclass,'audit.assistant_proposal_event'::regclass] loop
 assert(select relrowsecurity and relforcerowsecurity from pg_class where oid=table_name),'Assistant table lacks forced RLS';
 foreach role_name in array array['editor','publisher','viewer','admin','online_staff','agency','service_consumer','ads_export_reader'] loop
 assert not has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE'),'Assistant table directly accessible';end loop;end loop;
 foreach role_name in array array['agency','service_consumer','ads_export_reader'] loop
 assert not has_function_privilege(role_name,'internal.assistant_run_create(jsonb)','EXECUTE'),'Denied role can start assistant';end loop;
 assert not has_function_privilege('viewer','internal.assistant_proposal_create(jsonb)','EXECUTE'),'Viewer can create drafts';
 assert not has_function_privilege('online_staff','internal.assistant_proposal_apply(uuid,text)','EXECUTE'),'Finance role can write residential drafts';
 foreach role_name in array array['editor','publisher','viewer','admin','online_staff'] loop
 execute format('set local role %I',role_name);
 perform internal.assistant_run_create('{"mode":"SYNTHETIC","config_version":"sql-v1"}');
 reset role;end loop;
end $$;
set local role editor;
select set_config('test.assistant_run',internal.assistant_run_create('{"mode":"SYNTHETIC","config_version":"sql-v1","scope_project_id":"prj_synthetic"}')->>'id',true);
do $$ declare r jsonb;t jsonb;begin
 begin perform internal.assistant_run_create('{"mode":"SYNTHETIC","config_version":"sql-v1","prompt":"must not store"}');assert false,'Raw prompt accepted';exception when invalid_parameter_value then null;end;
 t:=internal.assistant_tool_record(current_setting('test.assistant_run')::uuid,'{"tool_name":"get_project","outcome":"SUCCESS","duration_ms":1,"sources":[{"namespace":"internal_content","entity_type":"project","entity_id":"prj_synthetic","version":"2026-10-01T10:00:00+07:00"}]}');
 perform set_config('test.assistant_citation',t#>>'{citations,0,id}',true);
 assert t#>>'{citations,0,entity_id}'='prj_synthetic','Source identity changed';
 begin perform internal.assistant_tool_record(current_setting('test.assistant_run')::uuid,'{"tool_name":"get_line_actuals","outcome":"SUCCESS","duration_ms":1,"sources":[{"namespace":"internal_ads","entity_type":"media_line","entity_id":"private","version":"1"}]}');assert false,'Content editor obtained finance source metadata';exception when insufficient_privilege then null;end;
 begin perform internal.assistant_tool_record(current_setting('test.assistant_run')::uuid,'{"tool_name":"search_content","outcome":"SUCCESS","duration_ms":1,"sources":[{"namespace":"internal_memo","entity_type":"memo","entity_id":"private","version":"1"}]}');assert false,'Namespace crossed';exception when invalid_parameter_value then null;end;
 begin perform internal.assistant_tool_record(current_setting('test.assistant_run')::uuid,'{"tool_name":"search_content","outcome":"SUCCESS","duration_ms":1,"sources":[{"namespace":"internal_content","entity_type":"project","entity_id":"prj_synthetic","version":"1","text":"secret"}]}');assert false,'Raw source text accepted';exception when invalid_parameter_value then null;end;
 r:=internal.assistant_run_read(current_setting('test.assistant_run')::uuid);assert jsonb_array_length(r->'tools')=1,'Failed record left partial audit';
 perform set_config('app.actor_id','00000000-0000-0000-0000-000000000092',true);
 begin perform internal.assistant_run_read(current_setting('test.assistant_run')::uuid);assert false,'Foreign actor read run';exception when no_data_found then null;end;
 begin perform internal.assistant_citation_read(current_setting('test.assistant_run')::uuid,current_setting('test.assistant_citation')::uuid);assert false,'Foreign actor read citation';exception when no_data_found then null;end;
 perform set_config('app.actor_id','00000000-0000-0000-0000-000000000091',true);
end $$;
set local role admin;
do $$ begin
 begin perform internal.assistant_run_read(current_setting('test.assistant_run')::uuid);assert false,'Changed role inherited prior run';exception when no_data_found then null;end;
end $$;
set local role editor;
do $$ declare r jsonb;p jsonb;stamp timestamptz;before_markers text[];begin
 select updated_at,demo_fields into stamp,before_markers from hub.projects where id=current_setting('test.assistant_project')::uuid;
 p:=internal.assistant_proposal_create(jsonb_build_object('entity_type','project','entity_id',current_setting('test.assistant_project'),'field_path','meta_description.th','expected_updated_at',stamp,'new_text','คำอธิบายที่ปรับปรุงสำหรับเดโม','run_id',current_setting('test.assistant_run'),'citations',jsonb_build_array(current_setting('test.assistant_citation'))));
 perform set_config('test.assistant_proposal',p->>'id',true);perform set_config('test.assistant_digest',p->>'digest',true);
 assert p->>'old_text'='คำอธิบายตัวอย่าง' and p->>'status'='PROPOSED','Server diff missing';
 assert(select updated_at=stamp and meta_description->>'th'='คำอธิบายตัวอย่าง' from hub.projects where id=current_setting('test.assistant_project')::uuid),'Proposal wrote draft before confirmation';
 begin perform internal.assistant_proposal_apply((p->>'id')::uuid,repeat('0',64));assert false,'Wrong diff confirmed';exception when serialization_failure then null;end;
 r:=internal.assistant_proposal_apply((p->>'id')::uuid,p->>'digest');assert r->>'replayed'='false','First apply not recorded';
 assert(select meta_description->>'th'='คำอธิบายที่ปรับปรุงสำหรับเดโม' and meta_description->>'en'='Keep English description' and demo_fields=before_markers and published_version_id is null from hub.projects where id=current_setting('test.assistant_project')::uuid),'Draft apply lost locales/markers or published';
 select updated_at into stamp from hub.projects where id=current_setting('test.assistant_project')::uuid;
 r:=internal.assistant_proposal_apply((p->>'id')::uuid,p->>'digest');assert r->>'replayed'='true','Replay wrote again';
 assert(select updated_at=stamp from hub.projects where id=current_setting('test.assistant_project')::uuid),'Replay touched draft';
 begin perform internal.assistant_proposal_create(jsonb_build_object('entity_type','project','entity_id',current_setting('test.assistant_project'),'field_path','public_name.th','expected_updated_at',stamp,'new_text','Forbidden'));assert false,'Non-allowlisted field accepted';exception when insufficient_privilege then null;end;
 begin perform internal.assistant_proposal_create(jsonb_build_object('entity_type','project','entity_id',current_setting('test.assistant_project'),'field_path','meta_title.th','expected_updated_at',stamp-interval '1 second','new_text','Stale'));assert false,'Stale proposal created';exception when serialization_failure then null;end;
 p:=internal.assistant_proposal_create(jsonb_build_object('entity_type','project','entity_id',current_setting('test.assistant_project'),'field_path','meta_title.th','expected_updated_at',stamp,'new_text','Do not overwrite later edit'));
 perform hub.patch_project(current_setting('test.assistant_project')::uuid,'{"meta_title":{"th":"Later user edit","en":"Keep English title"}}',stamp);
 begin perform internal.assistant_proposal_apply((p->>'id')::uuid,p->>'digest');assert false,'Stale apply overwrote user';exception when serialization_failure then null;end;
 p:=internal.assistant_proposal_create(jsonb_build_object('entity_type','brand','entity_id',current_setting('test.assistant_brand'),'field_path','description.th','expected_updated_at',(select updated_at from hub.brands where id=current_setting('test.assistant_brand')::uuid),'new_text','คำอธิบายแบรนด์ที่ปรับปรุง'));
 perform internal.assistant_proposal_apply((p->>'id')::uuid,p->>'digest');
 assert(select description->>'en'='Keep English brand' and demo_fields=array['description.th'] and published_version_id is null from hub.brands where id=current_setting('test.assistant_brand')::uuid),'Brand locales/provenance/publication changed';
 perform set_config('app.actor_id','00000000-0000-0000-0000-000000000092',true);
 begin perform internal.assistant_proposal_read(current_setting('test.assistant_proposal')::uuid);assert false,'Foreign proposal read';exception when no_data_found then null;end;
 begin perform internal.assistant_proposal_apply(current_setting('test.assistant_proposal')::uuid,current_setting('test.assistant_digest'));assert false,'Foreign proposal applied';exception when no_data_found then null;end;
 perform set_config('app.actor_id','00000000-0000-0000-0000-000000000091',true);
end $$;
set local role publisher;
do $$ declare p jsonb;begin
 p:=internal.assistant_proposal_create(jsonb_build_object('entity_type','project','entity_id',current_setting('test.assistant_project'),'field_path','meta_title.th','expected_updated_at',(select updated_at from hub.projects where id=current_setting('test.assistant_project')::uuid),'new_text','Publisher draft text'));
 perform internal.assistant_proposal_apply((p->>'id')::uuid,p->>'digest');
 begin perform internal.assistant_proposal_create(jsonb_build_object('entity_type','brand','entity_id',current_setting('test.assistant_brand'),'field_path','description.th','expected_updated_at',(select updated_at from hub.brands where id=current_setting('test.assistant_brand')::uuid),'new_text','Forbidden publisher brand edit'));assert false,'Publisher wrote brand draft';exception when insufficient_privilege then null;end;
end $$;
set local role editor;
do $$ declare p jsonb;begin
 p:=internal.assistant_proposal_create(jsonb_build_object('entity_type','project','entity_id',current_setting('test.assistant_project'),'field_path','meta_title.th','expected_updated_at',(select updated_at from hub.projects where id=current_setting('test.assistant_project')::uuid),'new_text','Marker must still exist'));
 perform set_config('test.assistant_unmarked',p->>'id',true);perform set_config('test.assistant_unmarked_digest',p->>'digest',true);
end $$;
reset role;
update hub.projects set demo_fields=array['meta_description.th'] where id=current_setting('test.assistant_project')::uuid;
set local role editor;
do $$ begin
 begin perform internal.assistant_proposal_apply(current_setting('test.assistant_unmarked')::uuid,current_setting('test.assistant_unmarked_digest'));assert false,'Removed marker ignored';exception when insufficient_privilege then null;end;
 begin perform internal.assistant_proposal_create(jsonb_build_object('entity_type','project','entity_id',current_setting('test.assistant_project'),'field_path','meta_title.th','expected_updated_at',(select updated_at from hub.projects where id=current_setting('test.assistant_project')::uuid),'new_text','Not synthetic'));assert false,'Unmarked field proposed';exception when insufficient_privilege then null;end;
 perform internal.assistant_run_finish(current_setting('test.assistant_run')::uuid,'{"status":"DONE","duration_ms":20,"usage":{"input_tokens":1,"output_tokens":2}}');
 perform internal.assistant_run_finish(current_setting('test.assistant_run')::uuid,'{"status":"DONE"}');
 begin perform internal.assistant_tool_record(current_setting('test.assistant_run')::uuid,'{"tool_name":"explain_name","outcome":"SUCCESS","duration_ms":1,"sources":[]}');assert false,'Finished run accepted tool';exception when serialization_failure then null;end;
 begin perform internal.assistant_run_finish(current_setting('test.assistant_run')::uuid,'{"status":"ERROR"}');assert false,'Terminal status overwritten';exception when serialization_failure then null;end;
end $$;
set local role online_staff;
do $$ declare run_id uuid;begin
 run_id:=(internal.assistant_run_create('{"mode":"SYNTHETIC","config_version":"sql-v1"}')->>'id')::uuid;
 begin perform internal.assistant_tool_record(run_id,'{"tool_name":"search_documents","outcome":"SUCCESS","duration_ms":1,"sources":[{"namespace":"internal_memo","entity_type":"statement","entity_id":"secret","version":"1"}]}');assert false,'Statement citation accepted';exception when invalid_parameter_value then null;end;
 begin perform internal.assistant_tool_record(run_id,'{"tool_name":"get_project","outcome":"SUCCESS","duration_ms":1,"sources":[{"namespace":"internal_content","entity_type":"project","entity_id":"private","version":"1"}]}');assert false,'Finance role got content namespace';exception when insufficient_privilege then null;end;
 perform internal.assistant_tool_record(run_id,'{"tool_name":"explain_name","outcome":"SUCCESS","duration_ms":1,"sources":[{"namespace":"internal_ads","entity_type":"naming_rule","entity_id":"SENA-H","version":"1"}]}');
 for i in 1..7 loop perform internal.assistant_tool_record(run_id,'{"tool_name":"search_documents","outcome":"NO_ANSWER","duration_ms":1,"sources":[]}');end loop;
 begin perform internal.assistant_tool_record(run_id,'{"tool_name":"search_documents","outcome":"NO_ANSWER","duration_ms":1,"sources":[]}');assert false,'Tool quota exceeded';exception when program_limit_exceeded then null;end;
end $$;
reset role;
-- Temporary test-only SELECT grants prove the ownership policies independently of RPC checks.
grant select on internal.assistant_run,internal.assistant_tool,internal.assistant_citation to editor,viewer;
set local role editor;
do $$ begin
 assert(select count(*)>0 from internal.assistant_run),'Owner RLS hid all own runs';
 assert not exists(select 1 from internal.assistant_run where actor_role<>'editor'),'Role RLS widened';
 perform set_config('app.actor_id','00000000-0000-0000-0000-000000000099',true);
 assert not exists(select 1 from internal.assistant_run),'Foreign actor bypassed run RLS';
 assert not exists(select 1 from internal.assistant_tool),'Foreign actor bypassed tool RLS';
 assert not exists(select 1 from internal.assistant_citation),'Foreign actor bypassed citation RLS';
 perform set_config('app.actor_id','00000000-0000-0000-0000-000000000091',true);
end $$;
reset role;
revoke select on internal.assistant_run,internal.assistant_tool,internal.assistant_citation from editor,viewer;
do $$ begin
 assert(select count(*)=3 from internal.assistant_proposal_application where actor_id='00000000-0000-0000-0000-000000000091'),'Proposal application count differs';
 assert(select count(*)=3 from audit.assistant_proposal_event where actor_id='00000000-0000-0000-0000-000000000091' and action='APPLIED'),'Application audit missing';
 assert not exists(select 1 from audit.change_log where table_name='internal.assistant_proposal' and actor='00000000-0000-0000-0000-000000000091'),'Proposal text duplicated in generic audit';
 begin update internal.assistant_proposal set new_text='Mutation';assert false,'Immutable diff mutated';exception when check_violation then null;end;
 begin delete from internal.assistant_run;assert false,'Run audit deleted';exception when check_violation then null;end;
end $$;
rollback;
