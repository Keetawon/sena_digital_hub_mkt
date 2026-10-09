-- Synthetic P3 source/workflow/RLS checks. Everything rolls back.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
select set_config('app.change_reason','SQL-P3-SYNTHETIC',true);
update staging.ads_actuals_current set batch_id=null;
insert into ads.scope_code(scope_id,scope_code,kind,label_th,label_en,member_signature,status)
values('01600000-0000-0000-0000-000000000001','C-TEST-P3SQL','GROUP','โครงการทดสอบ','P3 SQL TEST',ads.scope_signature('[{"member_type":"GROUP","member_id":"C-TEST-P3SQL"}]'),'ACTIVE');
insert into ads.memo(id,memo_no,subject,requesting_bud,gross_amount) values('01600000-0000-0000-0000-000000000002','MO9912001','ข้อมูลสังเคราะห์','C1',100);
insert into ads.media_line(id,kind,scope_id,month,agency,state) values('01600000-0000-0000-0000-000000000003','GROUP','01600000-0000-0000-0000-000000000001','2199-12-01','KIN','ACTIVE');
insert into ads.media_line_revision(id,line_id,revision_no,status,reason) values('01600000-0000-0000-0000-000000000004','01600000-0000-0000-0000-000000000003',1,'APPROVED','ข้อมูลสังเคราะห์');
insert into ads.media_line_component(id,revision_id,component_kind,rem_project_id,formatted_mapping,bud,gross_amount,memo_id,fee_po_ref)
values('01600000-0000-0000-0000-000000000005','01600000-0000-0000-0000-000000000004','PHASE','000016','C-TEST-P3SQL','C1',100,'01600000-0000-0000-0000-000000000002','SYNTHETIC-FEE-PO');
insert into ads.line_budget_item(component_id,cost_type,payment_method,amount) values('01600000-0000-0000-0000-000000000005','AGENCY_FEE','AGENCY_PO_INVOICE',100);
insert into ads.line_budget_item(component_id,cost_type,payment_method,amount) values('01600000-0000-0000-0000-000000000005','AGENCY_FEE','AGENCY_PO_INVOICE',0);

do $$ declare r text;t regclass;begin
 assert not has_schema_privilege('admin','staging','USAGE'),'Admin received access to unrelated source mirrors';
 foreach r in array array['staging.ads_actuals_batch','staging.ads_actuals_current','staging.ads_actuals_dim','staging.ads_actuals_bridge','staging.ads_actuals_monthly','staging.ads_actuals_finding','ads.finding_workflow','ads.finding_history','ads.document_follow_up'] loop
 t:=r::regclass;assert (select relrowsecurity and relforcerowsecurity from pg_class where oid=t),'P3 table lacks forced RLS';
 assert not has_table_privilege('online_staff',t,'INSERT,UPDATE,DELETE'),'Staff received direct write access';
 assert not has_table_privilege('ads_export_reader',t,'SELECT'),'P3 leaked to DW export reader';
 end loop;
 foreach r in array array['editor','publisher','viewer','agency','service_consumer'] loop
 assert not has_function_privilege(r,'ads.actuals_read(text,text,jsonb)','EXECUTE'),'Denied role received RPC';
 assert not has_function_privilege(r,'ads.actuals_command(text,text,jsonb)','EXECUTE'),'Denied role received workflow';
 end loop;
 assert not has_function_privilege('online_staff','ads.apply_ads_actuals(jsonb,jsonb,text,text)','EXECUTE');
 assert not has_function_privilege('admin','ads.apply_ads_actuals(jsonb,jsonb,text,text)','EXECUTE');
 assert not has_function_privilege('hub_app','ads.actuals_current_snapshot()','EXECUTE');
 assert not has_function_privilege('online_staff','ads.actuals_documents(date)','EXECUTE');
 assert not has_function_privilege('online_staff','ads.actuals_context_changed(timestamptz)','EXECUTE');
 assert not (select rolcanlogin or rolsuper or rolbypassrls or rolcreaterole from pg_roles where rolname='ads_actuals_writer');
end $$;

-- ETL is an operator ACL, independent of the manage-users flag.
reset role;
do $$ declare m jsonb;rs jsonb;common jsonb;answer jsonb;doc jsonb;fkey text:=repeat('a',64);snapshot text:='01600000-0000-0000-0000-000000000006';
lineid text:='01600000-0000-0000-0000-000000000003';revision text:='01600000-0000-0000-0000-000000000004';newm jsonb;newrs jsonb;k text;bad jsonb;wf jsonb;v int;prior_snapshot text;recurs boolean;
begin
 common:=jsonb_build_object('environment','test','contract_version','hub-p3-test-v1','snapshot_id',snapshot,'snapshot_at','2199-12-01T00:00:00Z','hub_snapshot_id','synthetic-hub');
 rs:=jsonb_build_object(
 'dim_media_line',jsonb_build_array(common||jsonb_build_object('line_source','hub','line_key',lineid,'revision_key',revision,'revision_no',1,'is_applicable',true,'scope_code','C-TEST-P3SQL','agency','KIN','components','[]'::jsonb,'approved_gross','100.00')),
 'bridge_native_campaign_media_line','[]'::jsonb,
 'fact_media_line_monthly',jsonb_build_array(common||jsonb_build_object('line_key',lineid,'revision_key',revision,'month','2199-12-01','platform_media_spend','15.25','media_cpl',null)),
 'fact_marketing_ops_finding',jsonb_build_array(common||jsonb_build_object('finding_key',fkey,'control_code','C6','condition_present',true,'evaluation_status','EVALUATED','month','2199-12-01')));
 m:=common||jsonb_build_object('synthetic_only',true,'relations',jsonb_build_array(
 jsonb_build_object('relation','dim_media_line','row_count',1),jsonb_build_object('relation','bridge_native_campaign_media_line','row_count',0),
 jsonb_build_object('relation','fact_media_line_monthly','row_count',1),jsonb_build_object('relation','fact_marketing_ops_finding','row_count',1)));
 answer:=ads.apply_ads_actuals(m,rs,repeat('1',64),null);assert answer->>'status'='APPLIED';
 assert ads.actuals_current_snapshot()=snapshot;
 answer:=ads.actuals_read('actuals',null,'{"month":"2199-12-01"}');assert answer->>'total'='1';
 assert answer#>>'{items,0,platform_media_spend}'='15.25';assert answer#>'{items,0,media_cpl}'='null'::jsonb;
 wf:=ads.actuals_command('workflow',fkey,jsonb_build_object('expected_version',0,'expected_snapshot_id',snapshot,'state','RESOLVED','owner_action','SELF','note','ดำเนินการแล้ว รอตรวจผล'));
 assert wf#>>'{finding,workflow,owner_id}'='00000000-0000-0000-0000-000000000005';assert wf#>>'{finding,workflow,owner_role}'='admin';
 answer:=ads.apply_ads_actuals(m,rs,repeat('1',64),null);assert answer->>'status'='NOOP';
 assert ads.actuals_read('findings',fkey)#>>'{finding,workflow,state}'='RESOLVED','Replay reopened finding';
 begin perform ads.actuals_command('workflow',fkey,jsonb_build_object('expected_version',0,'expected_snapshot_id',snapshot,'state','OPEN'));raise exception 'Stale workflow accepted';exception when serialization_failure then null;end;
 begin perform ads.actuals_command('workflow',fkey,jsonb_build_object('expected_version',1,'expected_snapshot_id',snapshot,'state','OPEN','owner_role','admin','owner_id','00000000-0000-0000-0000-000000000004'));raise exception 'Forged owner accepted';exception when invalid_parameter_value then null;end;
 answer:=ads.apply_ads_actuals(m||'{"changed":true}',rs,repeat('1',64),snapshot);assert answer->>'status'='QUARANTINED';
 assert ads.actuals_read('findings',fkey)#>>'{finding,workflow,state}'='RESOLVED','Quarantine reopened finding';

 -- Document tracking comes from P2 even when no platform fact exists for the line.
 answer:=ads.actuals_read('document-tracking',null,'{"month":"2199-12-01"}');assert answer->>'total'='2';
 select value into doc from jsonb_array_elements(answer->'items') where value->>'requirement_code'='P';
 assert doc->>'status'='MISSING' and doc->>'partial_reference'='SYNTHETIC-FEE-PO','PO alone satisfied invoice pair';
 assert doc->'is_overdue'='null'::jsonb and doc->>'matrix_status'='PROPOSED';
 assert doc->>'message_th' not like '%MO9912001%' and doc->>'message_th' not like '%100.00%';
 answer:=ads.actuals_command('follow-up',doc->>'key',jsonb_build_object('expected_snapshot_id',snapshot,'expected_source_version',doc->>'source_version','template_version','1','month',doc->>'month'));
 assert answer#>>'{follow_up,action}'='COPIED';
 begin perform ads.actuals_command('follow-up',doc->>'key',jsonb_build_object('expected_snapshot_id',snapshot,'expected_source_version',repeat('0',64),'template_version','1'));raise exception 'Stale document copied';exception when serialization_failure then null;end;
 newm:=m||'{"snapshot_id":"01600000-0000-0000-0000-000000000007","snapshot_at":"2199-12-02T00:00:00Z"}';newrs:='{}';
 for k in select jsonb_object_keys(rs) loop select coalesce(jsonb_agg(e||jsonb_build_object('snapshot_id',newm->>'snapshot_id','snapshot_at',newm->>'snapshot_at')),'[]') into bad from jsonb_array_elements(rs->k) e;newrs:=newrs||jsonb_build_object(k,bad);end loop;
 bad:=newrs||jsonb_build_object('fact_media_line_monthly',(newrs->'fact_media_line_monthly')||(newrs->'fact_media_line_monthly'));
 answer:=ads.apply_ads_actuals(newm,bad,repeat('3',64),snapshot);assert answer->>'status'='QUARANTINED';assert ads.actuals_current_snapshot()=snapshot;
 answer:=ads.apply_ads_actuals(newm,newrs,repeat('2',64),snapshot);assert answer->>'status'='APPLIED';
 answer:=ads.actuals_read('findings',fkey);assert answer#>>'{finding,workflow,state}'='OPEN';assert answer#>>'{finding,workflow,version}'='2';assert jsonb_array_length(answer->'history')=2;
 prior_snapshot:=newm->>'snapshot_id';
 perform ads.actuals_command('workflow',fkey,jsonb_build_object('expected_version',2,'expected_snapshot_id',prior_snapshot,'state','ACKNOWLEDGED','owner_action','SELF'));
 foreach recurs in array array[false,null,true] loop
 newm:=newm||jsonb_build_object('snapshot_id',case when recurs then '01600000-0000-0000-0000-000000000010' when recurs is null then '01600000-0000-0000-0000-000000000009' else '01600000-0000-0000-0000-000000000008' end,
 'snapshot_at',case when recurs then '2199-12-05T00:00:00Z' when recurs is null then '2199-12-04T00:00:00Z' else '2199-12-03T00:00:00Z' end);
 newrs:='{}';for k in select jsonb_object_keys(rs) loop
 select coalesce(jsonb_agg(e||jsonb_build_object('snapshot_id',newm->>'snapshot_id','snapshot_at',newm->>'snapshot_at')||case when k='fact_marketing_ops_finding' then jsonb_build_object('condition_present',recurs,'evaluation_status',case when recurs is null then 'UNAVAILABLE' else 'EVALUATED' end) else '{}'::jsonb end),'[]') into bad from jsonb_array_elements(rs->k) e;
 newrs:=newrs||jsonb_build_object(k,bad);end loop;
 answer:=ads.apply_ads_actuals(newm,newrs,repeat(case when recurs then '5' when recurs is null then '6' else '4' end,64),prior_snapshot);assert answer->>'status'='APPLIED';
 answer:=ads.actuals_read('findings',fkey);
 assert answer#>>'{finding,workflow,state}'=case when recurs then 'OPEN' else 'ACKNOWLEDGED' end;
 assert answer#>>'{finding,workflow,version}'=case when recurs then '4' else '3' end;
 prior_snapshot:=newm->>'snapshot_id';end loop;
end $$;
set local role online_staff;
do $$ begin
 perform ads.actuals_read('actuals');
 begin perform ads.actuals_current_snapshot();raise exception 'Staff read admin pointer';exception when insufficient_privilege then null;end;
 begin perform 1 from staging.ads_actuals_dim;raise exception 'Staff bypassed read RPC';exception when insufficient_privilege then null;end;
end $$;
set local role agency;
do $$ begin
 begin perform ads.actuals_read('actuals');raise exception 'Agency saw P3';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Context notices use recorded writes, never recompute a DW association. None of
-- these synthetic identities survive the outer rollback.
do $$ declare watermark timestamptz;code text:=ads.sn_code(2026,99991);name_id uuid:=gen_random_uuid();correction_id uuid:=gen_random_uuid();begin
 insert into ads.campaign_registration(code,sequence_year,sequence_no,scope_id,objective,agency,label,created_by)
 values(code,2026,99991,'01600000-0000-0000-0000-000000000001','LEADS','KIN','P3 SQL TEST','00000000-0000-0000-0000-000000000005');
 insert into ads.campaign_name(name_id,code,frozen_name,utm_campaign,issued_by)
 values(name_id,code,'P3 SQL TEST__LEADS__C-TEST-P3SQL__KIN__'||code,'P3 SQL TEST__LEADS__C-TEST-P3SQL__KIN__'||code,'00000000-0000-0000-0000-000000000005');
 watermark:=clock_timestamp();assert not ads.actuals_context_changed(watermark);
 insert into ads.line_assignment(code,month,line_id,acknowledged_revision_id)
 values(code,'2199-12-01','01600000-0000-0000-0000-000000000003','01600000-0000-0000-0000-000000000004');
 assert ads.actuals_context_changed(watermark),'Assignment write did not mark stale context';
 watermark:=clock_timestamp();assert not ads.actuals_context_changed(watermark);
 insert into ads.correction(id,observed_code,agency,month_from,month_to,reason,evidence_ref)
 values(correction_id,'C-TEST-OLD16','KIN','2199-12-01','2199-12-01','ข้อมูลสังเคราะห์','SYNTHETIC');
 assert ads.actuals_context_changed(watermark),'Correction write did not mark stale context';
 watermark:=clock_timestamp();assert not ads.actuals_context_changed(watermark);
 insert into ads.native_binding(platform,account_id,campaign_id,code,name_id,method,bound_by)
 values('META','000016-SQL','000016-SQL',code,name_id,'ONLINE_CONFIRMED','00000000-0000-0000-0000-000000000005');
 assert ads.actuals_context_changed(watermark),'Native binding write did not mark stale context';
 assert ads.actuals_context_changed(null),'Missing watermark was represented as current';
end $$;
do $$ begin assert exists(select 1 from audit.change_log where reason='SQL-P3-SYNTHETIC' and table_name='ads.document_follow_up');end $$;
rollback;
