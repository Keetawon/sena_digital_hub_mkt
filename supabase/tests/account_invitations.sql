begin;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz);
set local role admin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
do $$ declare i jsonb; detail text; begin
 begin perform hub.create_invite('{"email":"admin-invite@example.test","hub_role":"admin","company_type":"SENA"}'); raise exception 'Invited admin'; exception when check_violation then
 get stacked diagnostics detail=pg_exception_detail; if detail<>'invite_role_invalid' then raise exception 'Wrong error'; end if; end;
 begin perform hub.create_invite('{"email":"agency-invite@example.test","hub_role":"agency","company_type":"AGENCY","agency_code":"INVALID"}'); raise exception 'Invalid agency invited'; exception when check_violation then null; end;
 i:=hub.create_invite('{"email":" INVITE@EXAMPLE.TEST ","hub_role":"editor","company_type":"SENA","team":"ทีมสมมติ"}');
 if i->>'email'<>'invite@example.test' or (i->>'expires_at')::timestamptz-(i->>'created_at')::timestamptz<>interval '14 days' then raise exception 'Invite normalisation/lifetime'; end if;
 begin perform hub.create_invite('{"email":"invite@example.test","hub_role":"viewer","company_type":"SENA"}'); raise exception 'Duplicate allowed'; exception when unique_violation then null; end;
 begin select * from hub.account_invite; raise exception 'Direct read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into auth.users values('91000000-0000-0000-0000-000000000001','INVITE@example.test',null,clock_timestamp());
set local role viewer;
select set_config('app.actor_id','91000000-0000-0000-0000-000000000001',true);
do $$ declare a jsonb; begin
 a:=hub.account_identity('invite@example.test','google','ทดสอบ');
 if a->'invite'->>'id' is not null then raise exception 'Unconfirmed invite matched'; end if;
 begin select * from auth.users; raise exception 'Auth read allowed'; exception when insufficient_privilege then null; end;
 begin perform hub.create_invite('{"email":"forged@example.test","hub_role":"editor","company_type":"SENA"}'); raise exception 'Nonadmin invite allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update auth.users set email_confirmed_at=now();
set local role viewer;
select set_config('app.actor_id','91000000-0000-0000-0000-000000000001',true);
do $$ declare a jsonb; i jsonb; begin
 a:=hub.account_identity('invite@example.test','email','ทดสอบ');i:=a->'invite';
 if i->>'id' is null then raise exception 'Verified invite missing'; end if;
 a:=hub.accept_account_invite(jsonb_build_object('invite_id',i->>'id','display_name_th','ผู้รับ สมมติ','phone','020000000','company_type','SENA','team','ทีมทดสอบ','position','ผู้ประสานงาน','privacy_acknowledged',true));
 if a->>'status'<>'ACTIVE' or a->>'hub_role'<>'editor' or a->>'decided_by'<>'00000000-0000-0000-0000-000000000005' then raise exception 'Wrong invitation authority'; end if;
 begin perform hub.accept_account_invite(jsonb_build_object('invite_id',i->>'id')); raise exception 'Invite reused'; exception when check_violation then null; end;
end $$;
reset role;
do $$ begin
 if (select count(*) from hub.user_account_event where account_id='91000000-0000-0000-0000-000000000001' and action='INVITE_ACCEPT')<>1 then raise exception 'Accept audit missing'; end if;
 if not exists(select 1 from hub.account_invite where status='ACCEPTED' and accepted_account_id='91000000-0000-0000-0000-000000000001') then raise exception 'Invite not accepted'; end if;
end $$;
rollback;
