begin;
insert into hub.user_account(id,email,privacy_acknowledged_at) values('90000000-0000-0000-0000-000000000001','pending@example.test',now());
set local role viewer;
select set_config('app.actor_id','90000000-0000-0000-0000-000000000001',true);
do $$ begin
 if (select count(*) from hub.user_account)<>1 then raise exception 'Own-row isolation failed'; end if;
 begin update hub.user_account set status='ACTIVE'; raise exception 'Direct status update allowed'; exception when insufficient_privilege then null; end;
 begin select * from hub.user_account_event; raise exception 'Private event read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role admin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
do $$ declare stamp timestamptz; begin
 select updated_at into stamp from hub.user_account where id='00000000-0000-0000-0000-000000000005';
 begin perform hub.decide_account('00000000-0000-0000-0000-000000000005','role','viewer',null,'self',stamp); raise exception 'Self decision allowed'; exception when insufficient_privilege then null; end;
 select updated_at into stamp from hub.user_account where id='90000000-0000-0000-0000-000000000001';
 begin perform hub.decide_account('90000000-0000-0000-0000-000000000001','approve','agency',null,'missing code',stamp); raise exception 'Agency missing code allowed'; exception when check_violation then null; end;
 perform hub.decide_account('90000000-0000-0000-0000-000000000001','approve','agency','KIN','approved',stamp);
 begin delete from hub.user_account_event; raise exception 'Audit delete allowed'; exception when insufficient_privilege then null; end;
 begin update hub.user_account_event set action='forged'; raise exception 'Audit update allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Retention cannot restore personal fields on a subsequent verified sign-in.
-- Reopening preserves a legacy rejection note and requires a new submission.
update hub.user_account set status='REJECTED',decision_note='legacy rejection note' where id='90000000-0000-0000-0000-000000000001';
set local role admin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
do $$ declare stamp timestamptz; a jsonb; begin
 select updated_at into stamp from hub.user_account where id='90000000-0000-0000-0000-000000000001';
 a:=hub.decide_account('90000000-0000-0000-0000-000000000001','reopen',null,null,'please resubmit',stamp);
 if a->>'status'<>'PENDING' or a->>'privacy_acknowledged_at' is not null then raise exception 'Reopen must await submission'; end if;
 if not exists(select 1 from hub.user_account_event where action='reopen' and previous_decision_note='legacy rejection note' and decision_note='please resubmit') then raise exception 'Rejection history lost'; end if;
 begin perform hub.decide_account('90000000-0000-0000-0000-000000000001','reopen',null,null,'stale',stamp); raise exception 'Stale reopen allowed'; exception when serialization_failure then null; end;
end $$;
reset role;
update hub.user_account set status='REJECTED',decided_at=now()-interval '91 days' where id='90000000-0000-0000-0000-000000000001';
select hub.purge_rejected_accounts();
do $$ begin
 if exists(select 1 from hub.user_account_event where decision_note in ('please resubmit','legacy rejection note') or previous_decision_note='legacy rejection note') then raise exception 'Personal audit notes survived purge'; end if;
end $$;
set local role admin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
do $$ declare stamp timestamptz; detail text; begin
 select updated_at into stamp from hub.user_account where id='90000000-0000-0000-0000-000000000001';
 begin perform hub.decide_account('90000000-0000-0000-0000-000000000001','reopen',null,null,'cannot restore',stamp); raise exception 'Anonymised reopen allowed'; exception when check_violation then
  get stacked diagnostics detail=pg_exception_detail;
  if detail<>'account_anonymised' then raise exception 'Wrong reopen failure'; end if;
 end;
end $$;
reset role;
set local role viewer;
select set_config('app.actor_id','90000000-0000-0000-0000-000000000001',true);
do $$ declare a jsonb; begin
 a:=hub.account_identity('pending@example.test','email','ชื่อใหม่');
 if a->>'email'<>'' or a->>'display_name_th'<>'' then raise exception 'Anonymisation undone'; end if;
end $$;
rollback;
