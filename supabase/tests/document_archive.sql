-- Independent synthetic metadata/result fixtures; every database change rolls back.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000041',true);
select set_config('app.change_reason','Synthetic archive SQL contract',true);
-- Keep these worker claims isolated from any queued local demonstration.
update ads.archive_document set legal_hold=true where not legal_hold;
-- The persistent walkthrough owns MO2610901/MO2610902. Select an unused test
-- identifier; never weaken the archive's duplicate-memo/link requirement.
do $$ declare memo_no text;begin
 select 'MO9912'||lpad(n::text,3,'0') into memo_no from generate_series(100,999) n
 where not exists(select 1 from ads.memo_identifier i where i.identifier='MO9912'||lpad(n::text,3,'0')) order by n limit 1;
 assert memo_no is not null,'No isolated SQL-test memo identifier available';
 perform set_config('test.archive_memo_no',memo_no,true);
end $$;
select set_config('test.archive_memo_result',jsonb_build_object('pages',jsonb_build_array(jsonb_build_object('page',1,'method','TEXT','text','SYNTHETIC MEMO '||current_setting('test.archive_memo_no'),'confidence',null)),
 'fields',jsonb_build_object('memo_no',current_setting('test.archive_memo_no'),'subject','Synthetic archive SQL memo','requesting_bud','C1','gross_amount','12000.00','mirrored_status','APPROVED','approval_date','2026-10-01','period_start','2026-10-01','period_end','2026-10-31'),
 'field_sources',(select jsonb_object_agg(k,jsonb_build_object('page',1,'confidence',null)) from unnest(array['memo_no','subject','requesting_bud','gross_amount','mirrored_status','approval_date','period_start','period_end']) k),
 'rows','[]'::jsonb,'controls','{}'::jsonb)::text,true);
select ads.archive_register_fixture(jsonb_build_object('fixture_id','sql-archive-memo-v1','document_type','E_MEMO','label_th','บันทึกข้อความสังเคราะห์ SQL','sha256',repeat('1',64),'byte_size',123,'mime','application/pdf','filename','SYNTHETIC-SQL-MEMO.pdf','page_count',1,'storage_key','memo/sha256/'||repeat('1',64)||'.pdf','pipeline_version','sql-archive-v1'),
 jsonb_build_object('fields',current_setting('test.archive_memo_result')::jsonb->'fields'));
select ads.archive_register_fixture(jsonb_build_object('fixture_id','sql-archive-memo-v2','document_type','E_MEMO','label_th','บันทึกข้อความสังเคราะห์ SQL รุ่นสอง','sha256',repeat('2',64),'byte_size',124,'mime','application/pdf','filename','SYNTHETIC-SQL-MEMO-v2.pdf','page_count',1,'storage_key','memo/sha256/'||repeat('2',64)||'.pdf','pipeline_version','sql-archive-v1'),
 jsonb_build_object('fields',current_setting('test.archive_memo_result')::jsonb->'fields'));
select set_config('test.archive_statement_result',jsonb_build_object('pages',jsonb_build_array(jsonb_build_object('page',1,'method','OCR','text','SYNTHETIC TWO ROWS','confidence',null)),
 'fields','{}'::jsonb,'field_sources','{}'::jsonb,'rows',jsonb_build_array(
 jsonb_build_object('page',1,'occurrence',1,'charge_date','2026-10-02','descriptor','LINE OA SYNTHETIC','amount','100.00','cost_type','CHANNEL','payment_method','CORPORATE_CARD'),
 jsonb_build_object('page',1,'occurrence',2,'charge_date','2026-10-02','descriptor','LINE OA SYNTHETIC CREDIT','amount','-10.00','cost_type','CHANNEL','payment_method','CORPORATE_CARD')),
 'controls',jsonb_build_object('statement_total','90.00','meaning','NET_CHARGES','issuer','SYNTHETIC','cycle_start','2026-10-01','cycle_end','2026-10-31','due_date','2026-11-15','page_counts',jsonb_build_array(jsonb_build_object('page',1,'count',2))))::text,true);
select ads.archive_register_fixture(jsonb_build_object('fixture_id','sql-archive-statement','document_type','CARD_STATEMENT','label_th','ใบแจ้งยอดสังเคราะห์ SQL','sha256',repeat('3',64),'byte_size',125,'mime','application/pdf','filename','SYNTHETIC-SQL-STATEMENT.pdf','page_count',1,'storage_key','statement/sha256/'||repeat('3',64)||'.pdf','pipeline_version','sql-archive-v1'),
 current_setting('test.archive_statement_result')::jsonb-'pages'-'fields'-'field_sources');

do $$ declare t regclass;role_name text;begin
 foreach t in array array['ads.archive_document'::regclass,'ads.archive_version'::regclass,'ads.archive_job'::regclass,'ads.archive_fixture'::regclass,'ads.archive_extraction'::regclass,'ads.archive_confirmation'::regclass,'ads.archive_application'::regclass,'ads.archive_memo_chunk'::regclass,'audit.archive_access'::regclass] loop
 assert(select relrowsecurity and relforcerowsecurity from pg_class where oid=t),'Archive table lacks forced RLS';
 foreach role_name in array array['online_staff','admin','agency','editor','publisher','viewer','service_consumer','ads_export_reader','ads_document_worker'] loop
 assert not has_table_privilege(role_name,t,'INSERT,UPDATE,DELETE,SELECT'),'Archive base table privilege leaked';end loop;end loop;
 foreach role_name in array array['agency','editor','publisher','viewer','service_consumer','ads_export_reader'] loop
 execute format('set local role %I',role_name);
 begin perform ads.archive_read();assert false,'Restricted role read archive';exception when insufficient_privilege then null;end;
 execute 'reset role';end loop;
end $$;
set local role online_staff;
do $$ begin
 begin perform ads.archive_receive('{"fixture_id":"arbitrary-real-pdf","synthetic":true}');assert false,'Client synthetic flag accepted';exception when invalid_parameter_value then null;end;
 begin perform ads.archive_receive('{"fixture_id":"arbitrary-real-pdf"}');assert false,'Unknown PDF allowed';exception when insufficient_privilege then null;end;
 begin perform ads.archive_register_fixture('{}','{}');assert false,'Staff registered synthetic hash';exception when insufficient_privilege then null;end;
 perform set_config('test.archive_memo',ads.archive_receive('{"fixture_id":"sql-archive-memo-v1"}')->>'id',true);
 assert ads.archive_receive('{"fixture_id":"sql-archive-memo-v1"}')->>'receipt_status'='NOOP','Hash replay created a new identity';
end $$;
set local role ads_document_worker;
select set_config('test.archive_claim',ads.archive_claim('SQL-WORKER',120)::text,true);
do $$ declare claim jsonb:=current_setting('test.archive_claim')::jsonb;begin
 assert claim->>'document_id'=current_setting('test.archive_memo'),'Claim escaped synthetic fixture';
 assert not claim?'truth','Worker received validation ground truth';
 assert ads.archive_claim('SQL-SECOND',120) is null,'Two workers leased same job';
 perform ads.archive_heartbeat((claim->>'job_id')::uuid,(claim->>'lease_token')::uuid);
 begin perform ads.archive_finish((claim->>'job_id')::uuid,gen_random_uuid(),current_setting('test.archive_memo_result')::jsonb);assert false,'Wrong lease finished';exception when serialization_failure then null;end;
 perform ads.archive_finish((claim->>'job_id')::uuid,(claim->>'lease_token')::uuid,current_setting('test.archive_memo_result')::jsonb);
 begin perform ads.archive_finish((claim->>'job_id')::uuid,(claim->>'lease_token')::uuid,current_setting('test.archive_memo_result')::jsonb);assert false,'Finished job replay overwritten';exception when serialization_failure then null;end;
end $$;
set local role online_staff;
do $$ declare d jsonb;body jsonb;begin
 d:=ads.archive_read(current_setting('test.archive_memo')::uuid);
 assert d#>>'{job,status}'='DRAFT' and(d#>>'{extraction,validation,valid}')::boolean,'Valid extraction not retained as draft';
 body:=jsonb_build_object('expected_revision',d->'revision','expected_version_id',d->'current_version_id','expected_job_id',d#>'{job,id}','corrected_result',current_setting('test.archive_memo_result')::jsonb,'evidence','Synthetic source check');
 begin perform ads.archive_command('confirm',(d->>'id')::uuid,jsonb_set(body,'{corrected_result,fields,gross_amount}','"12001.00"'));assert false,'Wrong amount confirmed';exception when check_violation then null;end;
 begin perform ads.archive_command('confirm',(d->>'id')::uuid,jsonb_set(body,'{corrected_result,field_sources,subject,confidence}','0.99'));assert false,'Human confirmation fabricated engine confidence';exception when check_violation then null;end;
 d:=ads.archive_command('confirm',(d->>'id')::uuid,body);
 assert ads.archive_command('confirm',(d->>'id')::uuid,body)->>'operation_status'='NOOP','Exact confirmation replay not harmless';
 body:=jsonb_build_object('expected_revision',d->'revision','expected_version_id',d->'current_version_id','expected_job_id',d#>'{job,id}','mode','MEMO_CREATE','reason','Synthetic explicit P2 handoff','request_id',gen_random_uuid());
 d:=ads.archive_command('apply',(d->>'id')::uuid,body);
 assert d#>>'{application,target_type}'='MEMO','P2 memo handoff missing';
 assert ads.archive_command('apply',(d->>'id')::uuid,body)->>'operation_status'='NOOP','Application replay duplicated financial record';
 assert ads.finance_read('memos',d#>>'{application,target_id}')->>'record_status'='DRAFT','Transcription confirmation approved P2 memo';
 assert(ads.archive_search(current_setting('test.archive_memo_no'))->>'total')::integer=1,'Confirmed applied memo missing from exact search';
 perform set_config('test.archive_p2_memo',d#>>'{application,target_id}',true);
 begin perform ads.archive_command('hold',(d->>'id')::uuid,jsonb_build_object('expected_revision',d->'revision','held',true,'reason','Staff cannot hold'));assert false,'Staff placed legal hold';exception when insufficient_privilege then null;end;
 perform set_config('test.archive_memo_version',d->>'current_version_id',true);
end $$;
reset role;
do $$ begin
 update ads.memo set mirrored_status='CANCELLED' where id=current_setting('test.archive_p2_memo')::uuid;
 set local role online_staff;
 assert(ads.archive_search(current_setting('test.archive_memo_no'))->>'total')::integer=0,'P2 status change left stale source facts in search';
 reset role;
 update ads.memo set mirrored_status='APPROVED' where id=current_setting('test.archive_p2_memo')::uuid;
end $$;
set local role admin;
do $$ declare d jsonb;claim jsonb;begin
 d:=ads.archive_read(current_setting('test.archive_memo')::uuid);
 d:=ads.archive_command('hold',(d->>'id')::uuid,jsonb_build_object('expected_revision',d->'revision','held',true,'reason','Synthetic legal hold'));
 assert(ads.archive_search(current_setting('test.archive_memo_no'))->>'total')::integer=0,'Held memo remained indexed';
 begin perform ads.archive_receive(jsonb_build_object('fixture_id','sql-archive-memo-v2','document_id',d->'id','expected_revision',d->'revision'));assert false,'Held source version changed';exception when check_violation then null;end;
 d:=ads.archive_command('hold',(d->>'id')::uuid,jsonb_build_object('expected_revision',d->'revision','held',false,'reason','Synthetic authorized release'));
 d:=ads.archive_receive(jsonb_build_object('fixture_id','sql-archive-memo-v2','document_id',d->'id','expected_revision',d->'revision'));
 assert jsonb_array_length(d->'versions')=2,'Old immutable evidence lost';
 assert(ads.archive_search(current_setting('test.archive_memo_no'))->>'total')::integer=0,'Old version remained in search after new source receipt';
 claim:=ads.archive_claim('SQL-UNAVAILABLE',120);
 d:=ads.archive_finish((claim->>'job_id')::uuid,(claim->>'lease_token')::uuid,null,'OCR_UNAVAILABLE');
 assert d#>>'{job,status}'='FAILED' and d->'extraction'='null'::jsonb,'Unavailable engine fabricated extraction';
 d:=ads.archive_command('retry',(d->>'id')::uuid,jsonb_build_object('expected_revision',d->'revision','expected_version_id',d->'current_version_id','reason','Synthetic retry after engine availability'));
 claim:=ads.archive_claim('SQL-RETRY',120);assert(claim->>'attempt')::integer=2,'Retry lost attempt history';
 d:=ads.archive_finish((claim->>'job_id')::uuid,(claim->>'lease_token')::uuid,current_setting('test.archive_memo_result')::jsonb);
 perform ads.archive_command('hold',(d->>'id')::uuid,jsonb_build_object('expected_revision',d->'revision','held',true,'reason','Isolate next worker fixture'));
 perform ads.archive_access(jsonb_build_object('action','DOWNLOAD','outcome','DENIED','original_role','agency','original_actor_id','00000000-0000-0000-0000-000000000041','document_id',d->'id','version_id',current_setting('test.archive_memo_version'),'request_id',gen_random_uuid(),'bytes',0));
end $$;

set local role online_staff;
select set_config('test.archive_statement',ads.archive_receive('{"fixture_id":"sql-archive-statement"}')->>'id',true);
set local role ads_document_worker;
select set_config('test.archive_claim',ads.archive_claim('SQL-WORKER',120)::text,true);
do $$ declare claim jsonb:=current_setting('test.archive_claim')::jsonb;bad jsonb:=current_setting('test.archive_statement_result')::jsonb;begin
 -- Balanced but wrong rows must be retained as an invalid draft, never silently corrected.
 bad:=jsonb_set(jsonb_set(bad,'{rows,0,amount}','"110.00"'),'{rows,1,amount}','"-20.00"');
 perform ads.archive_finish((claim->>'job_id')::uuid,(claim->>'lease_token')::uuid,bad);
end $$;
set local role online_staff;
do $$ declare d jsonb;body jsonb;before_target uuid;begin
 d:=ads.archive_read(current_setting('test.archive_statement')::uuid);
 assert not(d#>>'{extraction,validation,valid}')::boolean and(d#>>'{extraction,validation,difference}')::numeric=0,'Balanced row corruption escaped independent truth check';
 body:=jsonb_build_object('expected_revision',d->'revision','expected_version_id',d->'current_version_id','expected_job_id',d#>'{job,id}','corrected_result',d#>'{extraction,original_result}','evidence','Synthetic source comparison');
 begin perform ads.archive_command('confirm',(d->>'id')::uuid,body);assert false,'Balanced wrong rows confirmed';exception when check_violation then null;end;
 body:=jsonb_set(body,'{corrected_result}',current_setting('test.archive_statement_result')::jsonb);
 d:=ads.archive_command('confirm',(d->>'id')::uuid,body);
 assert d#>>'{extraction,original_result,rows,0,amount}'='110.00' and d#>>'{confirmation,corrected_result,rows,0,amount}'='100.00','Correction replaced original extraction';
 body:=jsonb_build_object('expected_revision',d->'revision','expected_version_id',d->'current_version_id','expected_job_id',d#>'{job,id}','mode','CARD_CREATE','reason','Synthetic explicit card draft','request_id',gen_random_uuid());
 d:=ads.archive_command('apply',(d->>'id')::uuid,body);before_target:=(d#>>'{application,target_id}')::uuid;
 assert ads.finance_read('card-imports',before_target::text)->>'status'='APPLIED_DRAFT','Archive silently confirmed card finances';
 assert ads.archive_command('apply',(d->>'id')::uuid,body)#>>'{application,target_id}'=before_target::text,'Repeated apply changed batch';
 assert(ads.archive_search('LINE OA')->>'total')::integer=0,'Statement leaked into memo search';
end $$;
reset role;
do $$ declare d ads.archive_document;c ads.archive_confirmation;begin
 select * into d from ads.archive_document where id=current_setting('test.archive_statement')::uuid;
 select * into c from ads.archive_confirmation where version_id=d.current_version_id;
 begin insert into ads.archive_memo_chunk(version_id,confirmation_id,page,body) values(d.current_version_id,c.id,1,'Attempted statement index');assert false,'Statement indexed through direct SQL';exception when check_violation then null;end;
 begin update ads.archive_document set document_type='E_MEMO' where id=d.id;assert false,'Document type changed';exception when check_violation then null;end;
 begin update ads.archive_extraction set original_result='{}' where job_id=c.job_id;assert false,'Original extraction modified';exception when check_violation then null;end;
 begin delete from ads.archive_version where id=d.current_version_id;assert false,'Original evidence deleted';exception when check_violation then null;end;
 assert exists(select 1 from audit.archive_access where outcome='DENIED' and original_role='agency'),'Access denial audit missing';
end $$;
select 'PASS: private archive ACL, hash replay, leases, independent row validation, immutable corrections, separate P2 handoff, memo-only search and legal hold' as result;
rollback;
