begin;
create table hub.account_invite (
 id uuid primary key default gen_random_uuid(),
 email text not null check(email=lower(btrim(email)) and length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 display_hint text not null default '' check(length(display_hint)<=200),
 company_type text not null check(company_type in ('SENA','SENA_SUBSIDIARY','AGENCY','CONTRACTOR')),
 company_name text, team text not null default '' check(length(team)<=200),
 hub_role text not null check(hub_role in ('viewer','editor','publisher','online_staff','agency')),
 agency_code text,
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '14 days',
 status text not null default 'INVITED' check(status in ('INVITED','ACCEPTED','CANCELLED')),
 accepted_account_id uuid, cancelled_by uuid, cancelled_at timestamptz,
 check((hub_role='agency' and agency_code is not null) or (hub_role<>'agency' and agency_code is null))
);
create unique index account_invite_email_pending on hub.account_invite(email) where status='INVITED';
alter table hub.account_invite enable row level security;
revoke all on hub.account_invite from public,editor,publisher,viewer,admin,online_staff,agency,service_consumer;
alter table hub.user_account_event add column invite_id uuid;

create function hub.account_agency_valid(code text) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from ads.vocab v where v.vocab_type='AGENCY' and v.code=$1 and v.status='ACTIVE' and v.alias_of is null
 and (v.active_from is null or v.active_from<=current_date) and (v.active_to is null or v.active_to>=current_date))
$$;
revoke all on function hub.account_agency_valid(text) from public;

create function hub.list_account_invites() returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('status',case when i.status='INVITED' and i.expires_at<=now() then 'EXPIRED' else i.status end,'invited_by_name',a.display_name_th) order by i.created_at desc)
 from hub.account_invite i left join hub.user_account a on a.id=i.created_by),'[]');
end $$;
revoke all on function hub.list_account_invites() from public;
grant execute on function hub.list_account_invites() to admin;

create function hub.create_invite(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare i hub.account_invite; existing uuid; actor uuid:=nullif(current_setting('app.actor_id',true),'')::uuid;
 address text:=lower(btrim(p->>'email')); company text:=btrim(p->>'company_name'); invited_at timestamptz;
begin
 -- ponytail: one account lock suits the small admin queue; shard only if contention is measured.
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 select id into existing from hub.user_account where lower(btrim(email))=address limit 1;
 if found then return jsonb_build_object('error','account_exists','account_id',existing); end if;
 if exists(select 1 from hub.account_invite where email=address and status='INVITED' and expires_at>now()) then
 raise exception 'Live invite exists' using errcode='23505',detail='invite_exists'; end if;
 if coalesce(p->>'hub_role','') not in ('viewer','editor','publisher','online_staff','agency') then
 raise exception 'Invite cannot grant admin' using errcode='23514',detail='invite_role_invalid'; end if;
 if p->>'hub_role'='agency' then
  if not hub.account_agency_valid(p->>'agency_code') then raise exception 'Canonical agency required' using errcode='23514',detail='account_agency_invalid'; end if;
  company:=p->>'agency_code'; p:=p||jsonb_build_object('company_type','AGENCY');
 end if;
 if coalesce(p->>'company_type','') not in ('SENA','SENA_SUBSIDIARY','AGENCY','CONTRACTOR')
 or (p->>'company_type'<>'SENA' and length(coalesce(company,''))=0) or length(company)>200 then
 raise exception 'Company required' using errcode='23514',detail='account_company_invalid'; end if;
 -- Expired INVITED rows are retired before a fresh invitation can use the same address.
 for i in select * from hub.account_invite where email=address and status='INVITED' for update loop
  update hub.account_invite set status='CANCELLED',cancelled_by=actor,cancelled_at=now() where id=i.id;
  insert into hub.user_account_event(actor_id,action,invite_id) values(actor,'INVITE_EXPIRE',i.id);
 end loop;
 invited_at:=clock_timestamp();
 insert into hub.account_invite(email,display_hint,company_type,company_name,team,hub_role,agency_code,created_by,created_at,expires_at)
 values(address,coalesce(p->>'display_hint',''),p->>'company_type',case when p->>'company_type'='SENA' then null else company end,
 coalesce(p->>'team',''),p->>'hub_role',case when p->>'hub_role'='agency' then p->>'agency_code' end,actor,invited_at,invited_at+interval '14 days') returning * into i;
 insert into hub.user_account_event(actor_id,action,invite_id,new_role) values(actor,'INVITE_CREATE',i.id,i.hub_role);
 return to_jsonb(i);
end $$;
revoke all on function hub.create_invite(jsonb) from public;
grant execute on function hub.create_invite(jsonb) to admin;

create function hub.change_invite(target uuid,action text,expected timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare i hub.account_invite; actor uuid:=nullif(current_setting('app.actor_id',true),'')::uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 select * into i from hub.account_invite where id=target for update;
 if not found then raise exception 'Unknown invite' using errcode='P0002'; end if;
 if i.status<>'INVITED' or i.expires_at is distinct from expected then raise exception 'Stale invite' using errcode='40001'; end if;
 if action='cancel' then
  update hub.account_invite set status='CANCELLED',cancelled_by=actor,cancelled_at=now() where id=target returning * into i;
 elsif action='extend' then
  if i.hub_role='agency' and not hub.account_agency_valid(i.agency_code) then
   raise exception 'Canonical agency required' using errcode='23514',detail='account_agency_invalid'; end if;
  update hub.account_invite set expires_at=clock_timestamp()+interval '14 days' where id=target returning * into i;
 else raise exception 'Invalid invite action' using errcode='23514'; end if;
 insert into hub.user_account_event(actor_id,action,invite_id,new_role) values(actor,case when action='cancel' then 'INVITE_CANCEL' else 'INVITE_EXTEND' end,target,i.hub_role);
 return to_jsonb(i);
end $$;
revoke all on function hub.change_invite(uuid,text,timestamptz) from public;
grant execute on function hub.change_invite(uuid,text,timestamptz) to admin;

-- No Auth key or metadata claim proves confirmation here. Only the protected
-- Auth row does. Dynamic SQL lets ordinary local/demo databases omit auth.users;
-- absent Auth storage fails closed. Deployment owner must have SELECT on it.
create function hub.match_account_invite() returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; i hub.account_invite; auth_email text; confirmed timestamptz; born timestamptz;
begin
 select * into a from hub.user_account where id=nullif(current_setting('app.actor_id',true),'')::uuid;
 if not found or a.status<>'PENDING' or a.privacy_acknowledged_at is not null or a.anonymised_at is not null then return null; end if;
 select * into i from hub.account_invite where email=lower(btrim(a.email)) order by created_at desc limit 1;
 if not found then return null; end if;
 if i.status<>'INVITED' or i.expires_at<=now() then
  return jsonb_build_object('message','คำเชิญหมดอายุหรือถูกยกเลิกแล้ว กรุณาส่งคำขอตามปกติ'); end if;
 if to_regclass('auth.users') is null then return null; end if;
 execute 'select email,email_confirmed_at,created_at from auth.users where id=$1' into auth_email,confirmed,born using a.id;
 if confirmed is null or lower(btrim(auth_email)) is distinct from i.email then return null; end if;
 if born<i.created_at or a.created_at<i.created_at then
  return jsonb_build_object('message','บัญชีนี้มีอยู่ก่อนคำเชิญ กรุณาส่งคำขอให้ผู้ดูแลพิจารณา'); end if;
 if i.hub_role='agency' and not hub.account_agency_valid(i.agency_code) then
  return jsonb_build_object('message','รหัสเอเจนซีในคำเชิญไม่พร้อมใช้งาน กรุณาส่งคำขอตามปกติ'); end if;
 return jsonb_build_object('id',i.id,'company_type',i.company_type,'company_name',i.company_name,'team',i.team,
 'hub_role',i.hub_role,'agency_code',i.agency_code,'expires_at',i.expires_at);
end $$;
revoke all on function hub.match_account_invite() from public;

create or replace function hub.account_identity(p_email text,p_provider text,p_name text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; actor uuid:=nullif(current_setting('app.actor_id',true),'')::uuid;
begin
 if actor is null then raise exception 'Identity required' using errcode='42501'; end if;
 select * into a from hub.user_account where id=actor;
 if not found then
  -- Serialize first Hub sign-in against invite creation and acceptance.
  perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
  insert into hub.user_account(id,email,sign_in_method,display_name_th)
  values(actor,lower(btrim(left(p_email,254))),case when p_provider='google' then 'google' else 'email' end,left(coalesce(p_name,''),200)) on conflict(id) do nothing;
  select * into a from hub.user_account where id=actor;
 end if;
 -- ACTIVE requests retain the single indexed account lookup; invite proof is
 -- needed only for an unsubmitted pending identity.
 return to_jsonb(a)||jsonb_build_object('invite',case when a.status='PENDING' and a.privacy_acknowledged_at is null and lower(btrim(p_email))=lower(btrim(a.email)) then hub.match_account_invite() end);
end $$;

create function hub.accept_account_invite(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; i hub.account_invite; match jsonb; actor uuid:=nullif(current_setting('app.actor_id',true),'')::uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 select * into a from hub.user_account where id=actor for update;
 match:=hub.match_account_invite();
 if match->>'id' is null or match->>'id' is distinct from p->>'invite_id' then
 raise exception 'Invite unavailable' using errcode='23514',detail='invite_unavailable'; end if;
 select * into i from hub.account_invite where id=(match->>'id')::uuid for update;
 if i.created_by=actor then raise exception 'Self decision forbidden' using errcode='42501',detail='account_self_decision'; end if;
 if i.hub_role='agency' then p:=p||jsonb_build_object('company_type','AGENCY','company_name',i.agency_code); end if;
 perform hub.validate_account_profile(p);
 update hub.user_account set display_name_th=btrim(p->>'display_name_th'),phone=btrim(p->>'phone'),team=btrim(p->>'team'),
 company_type=p->>'company_type',company_name=case when p->>'company_type'='SENA' then null else btrim(p->>'company_name') end,position=btrim(p->>'position'),
 privacy_acknowledged_at=now(),status='ACTIVE',hub_role=i.hub_role,agency_code=i.agency_code,decision_note='',decided_by=i.created_by,decided_at=now(),updated_at=clock_timestamp()
 where id=actor returning * into a;
 update hub.account_invite set status='ACCEPTED',accepted_account_id=actor where id=i.id;
 insert into hub.user_account_event(account_id,actor_id,action,old_status,new_status,new_role,invite_id)
 values(actor,i.created_by,'INVITE_ACCEPT','PENDING','ACTIVE',i.hub_role,i.id);
 return to_jsonb(a);
end $$;
revoke all on function hub.accept_account_invite(jsonb) from public;
grant execute on function hub.accept_account_invite(jsonb) to viewer;
commit;
