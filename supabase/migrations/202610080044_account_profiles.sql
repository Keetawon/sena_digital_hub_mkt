begin;
alter table hub.user_account alter column created_at set default clock_timestamp();
alter table hub.user_account add column company_type text check(company_type in ('SENA','SENA_SUBSIDIARY','AGENCY','CONTRACTOR'));
alter table hub.user_account add column company_name text;
alter table hub.user_account add column position text;
create index user_account_email on hub.user_account(lower(btrim(email)));
-- Older approval/role notes must not remain visible on /v1/me. Events retain them.
update hub.user_account a set decision_note='' where status not in ('REJECTED','SUSPENDED');

create function hub.validate_account_profile(p jsonb) returns void
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if coalesce(p->>'company_type','') not in ('SENA','SENA_SUBSIDIARY','AGENCY','CONTRACTOR')
 or (p->>'company_type'<>'SENA' and length(btrim(coalesce(p->>'company_name','')))=0)
 or length(coalesce(p->>'company_name',''))>200 then
 raise exception 'Company required' using errcode='23514',detail='account_company_invalid'; end if;
 if length(btrim(coalesce(p->>'position',''))) not between 1 and 100 then
 raise exception 'Position required' using errcode='23514',detail='account_position_invalid'; end if;
 if coalesce(p->>'display_name_th','') !~ '[ก-๙]' or length(p->>'display_name_th')>200
 or coalesce(p->>'phone','') !~ '^\+?[0-9 ()-]{8,30}$'
 or length(btrim(coalesce(p->>'team',''))) not between 1 and 200
 or p->>'privacy_acknowledged' is distinct from 'true' then
 raise exception 'Invalid profile' using errcode='23514',detail='account_profile_invalid'; end if;
end $$;
revoke all on function hub.validate_account_profile(jsonb) from public;

create or replace function hub.submit_access_request(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; actor uuid:=nullif(current_setting('app.actor_id',true),'')::uuid; tasks text[];
begin
 select * into a from hub.user_account where id=actor for update;
 if not found or a.status<>'PENDING' then raise exception 'Pending request required' using errcode='42501'; end if;
 perform hub.validate_account_profile(p);
 tasks:=array(select jsonb_array_elements_text(p->'requested_tasks'));
 if coalesce(p->>'display_name_th','') !~ '[ก-๙]' or length(p->>'display_name_th')>200
 or coalesce(p->>'phone','') !~ '^\+?[0-9 ()-]{8,30}$' or length(btrim(coalesce(p->>'team','')))=0 or length(p->>'team')>200
 or coalesce(array_length(tasks,1),0)=0 or not tasks <@ array['read','edit','publish','online','agency']::text[]
 or length(btrim(coalesce(p->>'reason','')))=0 or length(p->>'reason')>2000 or p->>'privacy_acknowledged'<>'true'
 then raise exception 'Invalid access request' using errcode='23514'; end if;
 update hub.user_account set display_name_th=btrim(p->>'display_name_th'),phone=p->>'phone',team=btrim(p->>'team'),
 company_type=p->>'company_type',company_name=case when p->>'company_type'='SENA' then null else btrim(p->>'company_name') end,position=btrim(p->>'position'),requested_tasks=tasks,reason=btrim(p->>'reason'),privacy_acknowledged_at=coalesce(privacy_acknowledged_at,now()),updated_at=clock_timestamp()
 where id=actor returning * into a;
 insert into hub.user_account_event(account_id,actor_id,action,new_status) values(actor,actor,'REQUEST','PENDING');
 return to_jsonb(a);
end $$;
revoke all on function hub.submit_access_request(jsonb) from public;
grant execute on function hub.submit_access_request(jsonb) to viewer;

create or replace function hub.decide_account(target uuid,action text,new_role text,agency text,note text,expected timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; previous hub.user_account; actor uuid:=nullif(current_setting('app.actor_id',true),'')::uuid; next_status text;
begin
 -- Serialize decisions, including concurrent last-admin removals. Small admin queue.
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 select * into a from hub.user_account where id=target for update;
 if not found then raise exception 'Unknown account' using errcode='P0002'; end if;
 previous:=a;
 if a.status='ACTIVE' and a.hub_role='admin' and (action='suspend' or action='role' and new_role is distinct from 'admin')
 and not exists(select 1 from hub.user_account where id<>target and status='ACTIVE' and hub_role='admin')
 then raise exception 'Last admin required' using errcode='42501',detail='account_last_admin'; end if;
 if target=actor then raise exception 'Self decision forbidden' using errcode='42501',detail='account_self_decision'; end if;
 if a.updated_at is distinct from expected then raise exception 'Stale account' using errcode='40001'; end if;
 if action in ('reject','suspend') and length(btrim(coalesce(note,'')))=0 then
  raise exception 'Rejection reason required' using errcode='23514',detail=case when action='reject' then 'account_reject_reason' else 'account_suspend_reason' end; end if;
 if action='reopen' and a.anonymised_at is not null then
  raise exception 'Anonymised account cannot reopen' using errcode='23514',detail='account_anonymised'; end if;
 next_status:=case
 when action='approve' and a.status='PENDING' and a.privacy_acknowledged_at is not null then 'ACTIVE'
 when action='role' and a.status='ACTIVE' then 'ACTIVE'
 when action='suspend' and a.status='ACTIVE' then 'SUSPENDED'
 when action='reactivate' and a.status='SUSPENDED' then 'ACTIVE'
 when action='reopen' and a.status='REJECTED' then 'PENDING'
 when action='reject' and a.status='PENDING' and length(btrim(coalesce(note,'')))>0 then 'REJECTED' end;
 if next_status is null or length(coalesce(note,''))>2000 then raise exception 'Invalid decision' using errcode='23514'; end if;
 if action not in ('approve','role') then new_role:=a.hub_role; agency:=a.agency_code; end if;
 if new_role='agency' and next_status='ACTIVE' and not exists(select 1 from ads.vocab where vocab_type='AGENCY' and code=agency and status='ACTIVE' and alias_of is null
 and (active_from is null or active_from<=current_date) and (active_to is null or active_to>=current_date))
 then raise exception 'Canonical agency required' using errcode='23514',detail='account_agency_invalid'; end if;
 if new_role is distinct from 'agency' then agency:=null; end if;
 if a.status='ACTIVE' and a.hub_role='admin' and (next_status<>'ACTIVE' or new_role<>'admin')
 and not exists(select 1 from hub.user_account where id<>target and status='ACTIVE' and hub_role='admin')
 then raise exception 'Last admin required' using errcode='42501',detail='account_last_admin'; end if;
 if action='reopen' then new_role:=null; agency:=null; end if;
 update hub.user_account set privacy_acknowledged_at=case when action='reopen' then null else privacy_acknowledged_at end,status=next_status,hub_role=new_role,agency_code=agency,decision_note=case when action in ('reject','suspend') then btrim(note) else '' end,
 decided_by=actor,decided_at=now(),updated_at=clock_timestamp() where id=target returning * into a;
 insert into hub.user_account_event(account_id,actor_id,action,old_status,new_status,old_role,new_role,decision_note,previous_decision_note)
 values(target,actor,action,previous.status,a.status,previous.hub_role,a.hub_role,coalesce(note,''),case when action='reopen' then previous.decision_note else '' end);
 return to_jsonb(a);
end $$;
revoke all on function hub.decide_account(uuid,text,text,text,text,timestamptz) from public;
grant execute on function hub.decide_account(uuid,text,text,text,text,timestamptz) to admin;

create or replace function hub.purge_rejected_accounts() returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a record; total integer:=0;
begin
 for a in select id from hub.user_account where status='REJECTED' and decided_at<now()-interval '90 days' and anonymised_at is null for update loop
  update hub.user_account set email='',display_name_th='',phone='',company_name=null,position=null,company_type=null,team='',requested_tasks='{}',reason='',decision_note='',anonymised_at=now() where id=a.id;
  -- Anonymisation is the sole operator-only exception to append-only event storage.
  update hub.user_account_event set account_id=null,actor_id=null,decision_note='',previous_decision_note='' where account_id=a.id or actor_id=a.id;
  insert into hub.user_account_event(action,new_status) values('ANONYMISED','REJECTED');
  total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function hub.purge_rejected_accounts() from public;
commit;
