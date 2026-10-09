-- Synthetic P1 contracts. Every row and function configuration change rolls back.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000006',true);
select set_config('app.change_reason','SQL ads registry fixture',true);
insert into ads.scope_code(scope_id,scope_code,kind,label_th,label_en,member_signature,status)
values('40000000-0000-0000-0000-000000000001','C-TEST-SQL01','GROUP','โครงการทดสอบ','SQL TEST PROJECT',
  ads.scope_signature('[{"member_type":"GROUP","member_id":"C-TEST-SQL01"}]'),'ACTIVE');
insert into ads.scope_member(scope_id,member_type,member_id)
values('40000000-0000-0000-0000-000000000001','GROUP','C-TEST-SQL01');
insert into ads.scope_code(scope_id,scope_code,kind,label_th,label_en,parent_group_id,member_signature,status)
select id::uuid,token,kind,'ข้อมูลทดสอบ','SQL TEST',parent_id,
  ads.scope_signature(jsonb_build_array(jsonb_build_object('member_type',kind,'member_id',member_id,'parent_group_id',parent_id))),'ACTIVE'
from (values
 ('40000000-0000-0000-0000-000000000002','C-TEST-SQL02','GROUP',null,'C-TEST-SQL02'),
 ('40000000-0000-0000-0000-000000000003','C-TEST-SQL01-P1','PHASE','C-TEST-SQL01','P1'),
 ('40000000-0000-0000-0000-000000000004','C-TEST-SQL01-P2','PHASE','C-TEST-SQL01','P2')) f(id,token,kind,parent_id,member_id);
insert into ads.scope_member(scope_id,member_type,member_id,parent_group_id)
select scope_id,x->>0,x->>1,x->>2 from ads.scope_code cross join lateral jsonb_array_elements(member_signature::jsonb) x
where scope_id in('40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000004');

-- Session settings cannot bypass the deployment-owned production guard.
alter function ads.require_issuance() set app.ads_test_issuing='off';
set local role online_staff;
select set_config('app.ads_test_issuing','on',true);
do $$ begin
  assert not ads.test_issuing_enabled(), 'Caller forged deployment setting';
  begin perform ads.issue_registration('40000000-0000-0000-0000-000000000001','LEADS','KIN');
    raise exception 'Unapproved production issue succeeded'; exception when insufficient_privilege then null; end;
  begin perform ads.set_approval(true,'Forged approval','Forged evidence');
    raise exception 'Online staff changed pattern approval'; exception when insufficient_privilege then null; end;
end $$;
reset role;
alter function ads.require_issuance() set app.ads_test_issuing='on';
set local role online_staff;
select set_config('test.ads_a',ads.issue_registration('40000000-0000-0000-0000-000000000001','LEADS','KIN','KW-BRAND')#>>'{registration,code}',true);
select set_config('test.ads_b',ads.issue_registration('40000000-0000-0000-0000-000000000001','LEADS','BRANDSTROM')#>>'{registration,code}',true);
select set_config('test.ads_name_a',ads.registration_detail(current_setting('test.ads_a'))#>>'{names,0,name_id}',true);
select set_config('test.ads_name_b',ads.registration_detail(current_setting('test.ads_b'))#>>'{names,0,name_id}',true);
select set_config('test.ads_c_scope',ads.create_scope('MULTI_PHASE','C-TEST-SQL01',array['P2','P1'])::text,true);
select set_config('test.ads_d_scope',ads.create_scope('ZONE',null,array['C-TEST-SQL02','C-TEST-SQL01'])::text,true);
select ads.issue_registration(current_setting('test.ads_c_scope')::uuid,'LEADS','KIN');
select ads.issue_registration(current_setting('test.ads_d_scope')::uuid,'LEADS','BRANDSTROM');
do $$ declare d jsonb; begin
  assert ads.sn_code(2026,123)='SN2600123Q', 'Check character vector failed';
  assert ads.sn_code(2026,1)='SN2600001M', 'Initial code vector failed';
  assert ads.create_scope('MULTI_PHASE','C-TEST-SQL01',array['P1','P2'])::text=current_setting('test.ads_c_scope'), 'Member ordering changed C identity';
  assert ads.create_scope('ZONE',null,array['C-TEST-SQL01','C-TEST-SQL02'])::text=current_setting('test.ads_d_scope'), 'Member ordering changed D identity';
  assert ads.preview_scope('ZONE',null,array['C-TEST-SQL01','C-TEST-SQL02'])#>>'{scope,scope_code}' ~ '^ZONE-[A-F0-9]{12}$', 'ZONE slug is not bounded canonical SHA-256';
  begin perform ads.preview_scope('MULTI_PHASE','C-TEST-SQL01',array['P1','P1']); raise exception 'Duplicate C members accepted'; exception when check_violation then null; end;
  begin perform ads.preview_scope('ZONE',null,array['C-TEST-SQL01']); raise exception 'Single-group D accepted'; exception when check_violation then null; end;
  d:=ads.add_variant(current_setting('test.ads_a'),'KW-COMPETITOR');
  assert jsonb_array_length(d->'names')=2, 'Variant did not share registration';
  assert d#>>'{registration,code}'=current_setting('test.ads_a'), 'Variant allocated a new SN';
  assert jsonb_array_length(ads.add_variant(current_setting('test.ads_a'),'KW-COMPETITOR')->'names')=2, 'Variant replay duplicated name';
  begin update ads.campaign_name set frozen_name='FORGED'; raise exception 'Online changed frozen name'; exception when insufficient_privilege then null; end;
  begin update ads.code_sequence set last_value=0; raise exception 'Online reset sequence'; exception when insufficient_privilege then null; end;
end $$;

set local role agency;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000007',true);
select set_config('app.agency_code','KIN',true);
do $$ declare b jsonb; begin
  assert (select count(*) from ads.campaign_registration where code in(current_setting('test.ads_a'),current_setting('test.ads_b')))=1, 'Agency read another registration';
  assert ads.registration_detail(current_setting('test.ads_b')) is null, 'Agency detail leaked';
  assert not exists(select 1 from ads.campaign_name where name_id=current_setting('test.ads_name_b')::uuid), 'Agency read another name';
  assert exists(select 1 from ads.scope_code where scope_id=current_setting('test.ads_c_scope')::uuid), 'Own C scope unavailable';
  assert not exists(select 1 from ads.scope_code where scope_id=current_setting('test.ads_d_scope')::uuid), 'Other agency D selection leaked';
  assert not exists(select 1 from ads.scope_member where scope_id=current_setting('test.ads_d_scope')::uuid), 'Other agency D members leaked';
  begin perform ads.issue_registration('40000000-0000-0000-0000-000000000001','LEADS','KIN'); raise exception 'Agency issued a name'; exception when insufficient_privilege then null; end;
  begin perform ads.add_variant(current_setting('test.ads_a'),'LIVNEX'); raise exception 'Agency added variant'; exception when insufficient_privilege then null; end;
  begin perform ads.bind_native(current_setting('test.ads_b'),current_setting('test.ads_name_b')::uuid,'META','000ACC','000ID'); raise exception 'Agency bound another registration'; exception when no_data_found then null; end;
  begin perform ads.bind_native(current_setting('test.ads_a'),current_setting('test.ads_name_b')::uuid,'META','000ACC','000ID'); raise exception 'Cross-registration name accepted'; exception when no_data_found then null; end;
  b:=ads.bind_native(current_setting('test.ads_a'),current_setting('test.ads_name_a')::uuid,'META','000ACC','000ID');
  assert b->>'campaign_id'='000ID' and b->>'account_id'='000ACC', 'Native IDs lost leading zeros';
  assert b=ads.bind_native(current_setting('test.ads_a'),current_setting('test.ads_name_a')::uuid,'META','000ACC','000ID'), 'Binding replay changed facts';
  perform ads.bind_native(current_setting('test.ads_a'),current_setting('test.ads_name_a')::uuid,'META','000ACC','000ID2');
  begin perform ads.bind_native(current_setting('test.ads_a'),
    (select name_id from ads.campaign_name where code=current_setting('test.ads_a') and variant='KW-COMPETITOR'),'META','000ACC','000ID');
    raise exception 'Binding moved to another variant'; exception when unique_violation then null; end;
  begin perform * from ads_export.campaign_registration; raise exception 'Agency read export'; exception when insufficient_privilege then null; end;
  begin perform * from ads.setting; raise exception 'Agency read private setting'; exception when insufficient_privilege then null; end;
end $$;
select set_config('app.agency_code','UNKNOWN',true);
do $$ begin
  assert exists(select 1 from ads.campaign_registration where code=current_setting('test.ads_a')), 'Forged session agency changed the table-backed scope';
  assert not exists(select 1 from ads.campaign_registration where code=current_setting('test.ads_b')), 'Forged session agency widened scope';
end $$;
reset role;
insert into hub.user_account(id,email,status,hub_role,agency_code)
 values('40000000-0000-0000-0000-000000000099','registry-sql@example.test','ACTIVE','agency','BRANDSTROM');
set local role agency;
select set_config('app.actor_id','40000000-0000-0000-0000-000000000099',true);
select set_config('app.agency_code','BRANDSTROM',true);
do $$ begin
  assert not exists(select 1 from ads.native_binding where account_id='000ACC'), 'Agency read another binding';
  begin perform ads.bind_native(current_setting('test.ads_b'),current_setting('test.ads_name_b')::uuid,'META','000ACC','000ID'); raise exception 'Native key rebound'; exception when unique_violation then null; end;
end $$;

reset role;
update ads.scope_code set status='INACTIVE' where scope_id='40000000-0000-0000-0000-000000000001';
select set_config('app.actor_id','00000000-0000-0000-0000-000000000006',true);
set local role online_staff;
do $$ begin
  begin perform ads.preview_existing_scope('40000000-0000-0000-0000-000000000003'); raise exception 'Preview accepted inactive phase parent'; exception when check_violation then null; end;
  begin perform ads.issue_registration(current_setting('test.ads_c_scope')::uuid,'LEADS','KIN'); raise exception 'Issue accepted inactive C parent'; exception when check_violation then null; end;
end $$;
reset role;
update ads.scope_code set status='ACTIVE' where scope_id='40000000-0000-0000-0000-000000000001';
do $$ declare original integer; begin
  assert (select count(*) from pg_class where relnamespace='ads'::regnamespace and relkind='r'
    and relname in('vocab','scope_code','scope_member','campaign_registration','campaign_name','native_binding','code_sequence','setting')
    and relrowsecurity and relforcerowsecurity)=8, 'Not all eight registry tables FORCE RLS';
  assert not exists(select 1 from pg_roles where rolname in ('ads_registry_writer','ads_export_owner') and (rolsuper or rolbypassrls or rolcanlogin)), 'Unsafe function/view owner';
  begin update ads.campaign_name set utm_campaign='FORGED' where code=current_setting('test.ads_a'); raise exception 'Privileged UTM changed'; exception when check_violation then null; end;
  begin update ads.campaign_registration set label='FORGED' where code=current_setting('test.ads_a'); raise exception 'Frozen registration changed'; exception when check_violation then null; end;
  begin update ads.scope_member set member_id='FORGED' where scope_id='40000000-0000-0000-0000-000000000001'; raise exception 'Frozen membership changed'; exception when check_violation then null; end;
  begin insert into ads.scope_member(scope_id,member_type,member_id) values('40000000-0000-0000-0000-000000000001','GROUP','FORGED'); raise exception 'Frozen member appended'; exception when check_violation then null; end;
  begin delete from ads.campaign_registration where code=current_setting('test.ads_a'); raise exception 'Issued code deleted'; exception when check_violation then null; end;
  select last_value into original from ads.code_sequence where sequence_year=extract(year from now() at time zone 'Asia/Bangkok')::integer;
  begin
    set local role online_staff;
    perform ads.issue_registration('40000000-0000-0000-0000-000000000001','LEADS','KIN');
    raise exception 'Deliberate subtransaction rollback' using errcode='40001';
  exception when serialization_failure then null; end;
  assert (select last_value from ads.code_sequence where sequence_year=extract(year from now() at time zone 'Asia/Bangkok')::integer)=original, 'Rollback left a registration sequence allocation';
  assert exists(select 1 from audit.change_log where table_name='ads.campaign_name' and after_row->>'code'=current_setting('test.ads_a')), 'Issue not audited';
end $$;

set local role ads_export_reader;
do $$ begin
  assert exists(select 1 from ads_export.campaign_registration where code=current_setting('test.ads_b')), 'Export omits other agency';
  assert (select count(*) from ads_export.native_binding where code=current_setting('test.ads_a'))=2, 'Export bindings incomplete';
  begin perform * from ads.campaign_registration; raise exception 'Export reader read base table'; exception when insufficient_privilege then null; end;
  begin update ads_export.scope_code set label_en='FORGED'; raise exception 'Export reader wrote view'; exception when insufficient_privilege then null; end;
  assert not exists(select 1 from information_schema.columns where table_schema='ads_export' and column_name in ('created_by','issued_by','bound_by','approval_evidence')), 'Export leaks private metadata';
end $$;
set local role editor;
do $$ begin
  begin perform * from ads.campaign_registration; raise exception 'Residential role read ads'; exception when insufficient_privilege then null; end;
end $$;
set local role admin;
do $$ begin
  begin perform ads.cancel_registration(current_setting('test.ads_a'),'Application cancellation denied');
    raise exception 'Admin cancelled operator-only registry'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select ads.cancel_registration(current_setting('test.ads_a'),'ยกเลิกข้อมูลทดสอบ');
do $$ begin
  assert ads.registration_detail(current_setting('test.ads_a'))#>>'{registration,status}'='CANCELLED', 'Cancellation failed';
  assert jsonb_array_length(ads.registration_detail(current_setting('test.ads_a'))->'names')=2, 'Cancellation deleted names';
end $$;
rollback;
select 'PASS: ads registry RLS, frozen identity, variants, native bindings, approval guard, audit and exports' as result;
