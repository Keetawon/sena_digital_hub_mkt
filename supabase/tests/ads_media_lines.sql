-- Synthetic private financial regression. The entire fixture rolls back.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000006',true);
select set_config('app.change_reason','SQL-P2-SYNTHETIC',true);
insert into ads.scope_code(scope_id,scope_code,kind,label_th,label_en,member_signature,status,parent_group_id)
values('f2000000-0000-0000-0000-000000000001','C-TEST-P2001','GROUP','ทดสอบการเงิน','FINANCE TEST',ads.scope_signature('[{"member_type":"GROUP","member_id":"C-TEST-P2001"}]'),'ACTIVE',null),
('f2000000-0000-0000-0000-000000000002','C-TEST-P2001-A','PHASE','เฟสทดสอบ','FINANCE PHASE',ads.scope_signature('[{"member_type":"PHASE","member_id":"00000201","parent_group_id":"C-TEST-P2001"}]'),'ACTIVE','C-TEST-P2001');
insert into ads.scope_member(scope_id,member_type,member_id,parent_group_id) values
('f2000000-0000-0000-0000-000000000001','GROUP','C-TEST-P2001',null),
('f2000000-0000-0000-0000-000000000002','PHASE','00000201','C-TEST-P2001');
set local role online_staff;
do $$ declare memo jsonb;line jsonb;revision jsonb;second jsonb;assignment jsonb;code text;alias jsonb;account jsonb;statement jsonb;batch jsonb;allocated jsonb;cost jsonb;parts jsonb;changed jsonb;
begin
 if (ads.finance_read('document-requirements')->>'total')::integer<>20 then raise exception 'Document requirement matrix must have 20 combinations';end if;
 begin perform ads.finance_command('memo_create','{"memo_no":"MO2609098","subject":"Synthetic","requesting_bud":"C1","gross_amount":"1.001"}');raise exception 'Excess precision accepted';exception when invalid_parameter_value then null;end;
 memo:=ads.finance_command('memo_create','{"memo_no":"MO2609099","subject":"Synthetic approval","requesting_bud":"C1","gross_amount":"100.00","mirrored_status":"APPROVED","approval_date":"2026-09-30","evidence_ref":"SYNTHETIC-DOCUMENT"}');
 memo:=ads.finance_command('memo_confirm',jsonb_build_object('id',memo->>'id','expected_version',memo->'row_version'));
 if memo->>'record_status'<>'CONFIRMED' then raise exception 'Memo mirror confirmation failed';end if;
 alias:=ads.finance_command('memo_identifier_propose',jsonb_build_object('memo_id',memo->>'id','identifier','MO2609099/SYNTHETIC','reason','Synthetic alias evidence','evidence_ref','SYNTHETIC'));
 begin perform ads.finance_command('memo_identifier_review',jsonb_build_object('id',alias->>'id','expected_version',1,'decision','APPROVE','reason','Synthetic'));raise exception 'Online approved an alias';exception when insufficient_privilege then null;end;
 parts:=jsonb_build_array(jsonb_build_object('component_kind','PHASE','rem_project_id','00000201','formatted_mapping','C-TEST-P2001','bud','C1','gross_amount','100.00','memo_id',memo->>'id'));
 line:=ads.finance_command('line_create',jsonb_build_object('kind','GROUP','scope_id','f2000000-0000-0000-0000-000000000001','month','2093-09-01','agency','KIN','reason','Synthetic first revision','components',parts));
 revision:=line->'revisions'->0;
 line:=ads.finance_command('revision_confirm',jsonb_build_object('id',line->>'id','revision_id',revision->>'id','expected_revision_id',null,'acknowledgements','[]'::jsonb));
 if line->>'state'<>'ACTIVE' or(line->>'gross_amount')::numeric<>100 then raise exception 'Approved group envelope failed';end if;
 code:=ads.issue_registration('f2000000-0000-0000-0000-000000000001','LEADS','KIN')->'registration'->>'code';
 assignment:=ads.finance_command('assignment_create',jsonb_build_object('code',code,'month','2093-09-01','line_id',line->>'id','expected_revision_id',line->>'current_revision_id'));
 begin perform ads.finance_command('assignment_create',jsonb_build_object('code',code,'month','2093-09-01','line_id',line->>'id','expected_revision_id',line->>'current_revision_id'));raise exception 'Two active SN-month assignments';exception when unique_violation then null;end;
 second:=ads.finance_command('revision_create',jsonb_build_object('id',line->>'id','expected_version',line->'row_version','reason','Synthetic replacement','components',parts));
 second:=ads.finance_command('revision_confirm',jsonb_build_object('id',line->>'id','revision_id',second->'revisions'->0->>'id','expected_revision_id',line->>'current_revision_id','acknowledgements','[]'::jsonb));
 if (select count(*) from ads.media_line_revision where line_id=(line->>'id')::uuid and status='APPROVED')<>1 or (ads.finance_read('memos',memo->>'id')->'reconciliation'->>'allocated_amount')::numeric<>100 then raise exception 'Revisions added instead of superseding';end if;
 if ads.finance_read('registration-monthly-lines',code)->'items'->0->>'review_status'<>'REVIEW_REQUIRED' then raise exception 'Assignment failed to detect changed revision';end if;
 perform ads.finance_command('assignment_acknowledge',jsonb_build_object('id',assignment->>'id','expected_version',assignment->'row_version','expected_revision_id',second->>'current_revision_id'));
 begin perform ads.finance_command('revision_confirm',jsonb_build_object('id',line->>'id','revision_id',revision->>'id','expected_revision_id',line->>'current_revision_id'));raise exception 'Stale revision accepted';exception when serialization_failure then null;end;
 begin update ads.memo mm set gross_amount=999 where mm.id=(memo->>'id')::uuid;raise exception 'Direct financial DML granted';exception when insufficient_privilege then null;end;
 account:=ads.finance_command('ad_account_create',jsonb_build_object('platform','GOOGLE','account_id','00000201','label','Synthetic','mapping',jsonb_build_object('scope_id','f2000000-0000-0000-0000-000000000001','agency','KIN','bud','C1','valid_from','2026-01-01','evidence_ref','SYNTHETIC')));
 account:=ads.finance_command('ad_account_version_confirm',jsonb_build_object('id',account->>'id','mapping_id',account->'mappings'->0->>'id','expected_version',1));
 if account->>'account_id'<>'00000201' then raise exception 'Source ID leading zeros were lost';end if;
 account:=ads.finance_command('ad_account_version_create',jsonb_build_object('id',account->>'id','expected_version',account->'row_version','mapping',jsonb_build_object('scope_id','f2000000-0000-0000-0000-000000000001','agency','KIN','bud','C1','valid_from','2026-06-01','evidence_ref','SYNTHETIC')));
 begin perform ads.finance_command('ad_account_version_confirm',jsonb_build_object('id',account->>'id','mapping_id',account->'mappings'->0->>'id','expected_version',1));raise exception 'Account intervals overlap';exception when unique_violation then null;end;
 statement:=ads.finance_command('statement_create','{"operator_ref":"SQL-P2-STATEMENT","issuer":"Synthetic issuer","cycle_start":"2026-09-01","cycle_end":"2026-09-30","due_date":"2026-10-15","declared_total":"1199.99","total_meaning":"NET_CHARGES","evidence_ref":"SYNTHETIC","review_status":"CONFIRMED"}');
 batch:=ads.finance_command('card_import',jsonb_build_object('source_fingerprint',repeat('a',64),'statement_control_id',statement->>'id','logical_source_id','SQL-P2','source_file','synthetic.csv','tab','Synthetic','profile_id','synthetic','profile_version','1','provenance','{}'::jsonb,'rows',jsonb_build_array(jsonb_build_object('row_no',2,'row_hash',repeat('b',64),'raw_row','{}'::jsonb,'amount','1199.99','direction','DEBIT','charge_date','2026-09-05','cost_type','TOOL','bud','C1'))));
 batch:=ads.finance_command('card_batch_confirm',jsonb_build_object('id',batch->>'id','expected_version',batch->'row_version','expected_previous_batch_id',null,'reason','Synthetic reviewed sheet'));
 cost:=batch->'rows'->0->'costs'->0;
 allocated:=ads.finance_command('cost_allocate',jsonb_build_object('id',cost->>'id','expected_version',cost->'row_version','expected_allocation_set_id',null,'method','EQUAL_MONTHS','coverage_start','2026-10-01','coverage_end','2027-09-01','scope_id','f2000000-0000-0000-0000-000000000001','bud','C1','reason','Synthetic annual prepayment'));
 if jsonb_array_length(allocated->'allocations'->0->'items')<>12 or(select sum((x->>'amount')::numeric) from jsonb_array_elements(allocated->'allocations'->0->'items') x)<>1199.99 or(allocated->'allocations'->0->'items'->11->>'amount')::numeric<>99.99 then raise exception 'Annual integer-satang allocation failed';end if;
 changed:=ads.finance_command('memo_update',jsonb_build_object('id',memo->>'id','expected_version',memo->'row_version','mirrored_status','CANCELLED'));
 if ads.finance_read('media-lines',line->>'id')->>'state'<>'SUSPENDED' then raise exception 'Memo invalidation left budget applicable';end if;
 raise notice 'PASS: memo mirror, no direct DML, revision supersession, monthly assignment, alias review, account intervals, annual allocation and memo invalidation';
end $$;
reset role;
do $$ declare t record;begin
 for t in select c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where(n.nspname='ads' and c.relname in('memo','memo_identifier','media_line','media_line_revision','media_line_component','line_assignment','correction','correction_target','document_requirement','ad_account','channel_account','account_mapping','recurring_commitment','commitment_version','commitment_memo_cover','commitment_occurrence','cost_record','cost_allocation_set','cost_allocation','card_statement_control')) or(n.nspname='staging' and c.relname in('ads_card_batch','ads_card_row','ads_ledger_batch','ads_ledger_row')) loop
 if not t.relrowsecurity or not t.relforcerowsecurity then raise exception 'Forced RLS missing: %',t.relname;end if;end loop;
 if(select value from ads.setting where key='sena_h_approved')<>'false'::jsonb then raise exception 'P1 approval changed';end if;
 if exists(select 1 from information_schema.view_column_usage where view_schema in('public_api','rag') and table_schema='ads') then raise exception 'Financial records leaked to public API or RAG';end if;
end $$;
set local role agency;
do $$ begin
 begin perform ads.finance_read('memos');raise exception 'Agency read finance RPC';exception when insufficient_privilege then null;end;
 begin perform count(*) from ads.memo;raise exception 'Agency read memo rows';exception when insufficient_privilege then null;end;
 begin perform count(*) from staging.ads_card_row;raise exception 'Agency read source evidence';exception when insufficient_privilege then null;end;
 begin perform count(*) from audit.change_log;raise exception 'Agency read audit PII';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role viewer;
do $$ begin begin perform ads.finance_read('media-lines');raise exception 'Residential viewer read budgets';exception when insufficient_privilege then null;end;end $$;
reset role;
set local role ads_export_reader;
do $$ begin
 perform count(*) from ads_export.media_line;perform count(*) from ads_export.memo;perform count(*) from ads_export.line_assignment;perform count(*) from ads_export.correction;
 perform count(*) from ads_export.ad_account;perform count(*) from ads_export.channel_account;perform count(*) from ads_export.recurring_commitment;perform count(*) from ads_export.cost_record;perform count(*) from ads_export.cost_allocation;perform count(*) from ads_export.memo_identifier;
 begin perform subject from ads.memo;raise exception 'Export reader read memo subject';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role ads_export_owner;
do $$ begin
 begin perform approvers from ads.memo;raise exception 'Export owner read approver PII';exception when insufficient_privilege then null;end;
 begin perform raw_row from staging.ads_card_row;raise exception 'Export owner read source detail';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ declare k uuid;begin
 select id into k from ads.memo where memo_no='MO2609099';
 begin delete from ads.memo where id=k;raise exception 'Financial DELETE allowed';exception when check_violation then null;end;
 begin update ads.media_line_component set gross_amount=0 where revision_id in(select id from ads.media_line_revision where status='APPROVED');raise exception 'Confirmed components mutable';exception when check_violation then null;end;
 raise notice 'PASS: forced RLS, agency/residential/audit isolation, ten private export views, PII column denial and immutable financial history';
end $$;
rollback;
