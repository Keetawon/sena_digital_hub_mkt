begin;

create table hub.user_account (
  id uuid primary key,
  email text not null,
  sign_in_method text not null default 'email',
  display_name_th text not null default '',
  phone text not null default '',
  team text not null default '',
  requested_tasks text[] not null default '{}',
  reason text not null default '',
  privacy_acknowledged_at timestamptz,
  status text not null default 'PENDING' check(status in ('PENDING','ACTIVE','SUSPENDED','REJECTED')),
  hub_role text check(hub_role in ('viewer','editor','publisher','admin','online_staff','agency','service_consumer')),
  agency_code text,
  decision_note text not null default '',
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  anonymised_at timestamptz,
  check(status <> 'ACTIVE' or hub_role is not null),
  check((hub_role = 'agency' and agency_code is not null) or (hub_role is distinct from 'agency' and agency_code is null))
);
create index user_account_status on hub.user_account(status,created_at);
create table hub.user_account_event (
  id uuid primary key default gen_random_uuid(),
  account_id uuid,
  actor_id uuid,
  action text not null,
  old_status text, new_status text, old_role text, new_role text,
  created_at timestamptz not null default now()
);
create index user_account_event_account on hub.user_account_event(account_id,created_at);
-- The migration/function owner can read only the agency vocabulary through
-- forced ads RLS (including the managed, non-superuser H1 deployment).
create policy account_agency_vocabulary on ads.vocab for select to current_user
using(vocab_type='AGENCY');
alter table hub.user_account enable row level security;
alter table hub.user_account_event enable row level security;
revoke all on hub.user_account,hub.user_account_event from public,editor,publisher,viewer,admin,online_staff,agency,service_consumer;

create function hub.account_admin() returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
  select exists(select 1 from hub.user_account where id=nullif(current_setting('app.actor_id',true),'')::uuid and status='ACTIVE' and hub_role='admin')
$$;
revoke all on function hub.account_admin() from public;
grant execute on function hub.account_admin() to editor,publisher,viewer,admin,online_staff,agency,service_consumer;
create policy account_read on hub.user_account for select to editor,publisher,viewer,admin,online_staff,agency,service_consumer
using(id=nullif(current_setting('app.actor_id',true),'')::uuid or hub.account_admin());
create policy account_edit on hub.user_account for update to editor,publisher,viewer,admin,online_staff,agency
using(id=nullif(current_setting('app.actor_id',true),'')::uuid and status='PENDING')
with check(id=nullif(current_setting('app.actor_id',true),'')::uuid and status='PENDING');
create policy account_event_read on hub.user_account_event for select to admin using(hub.account_admin());
grant select on hub.user_account to editor,publisher,viewer,admin,online_staff,agency,service_consumer;
grant select on hub.user_account_event to admin;
-- Edits use the validated function; there is no direct UPDATE or decision grant.

-- Only the API's verified identity is set here, using the same trusted actor GUC
-- boundary as the rest of Hub. Metadata supplies no authorization.
create function hub.account_identity(p_email text,p_provider text,p_name text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; actor uuid:=nullif(current_setting('app.actor_id',true),'')::uuid;
begin
 if actor is null then raise exception 'Identity required' using errcode='42501'; end if;
 select * into a from hub.user_account where id=actor;
 if not found then
  insert into hub.user_account(id,email,sign_in_method,display_name_th)
  values(actor,left(p_email,254),case when p_provider='google' then 'google' else 'email' end,left(coalesce(p_name,''),200))
  on conflict(id) do nothing;
  select * into a from hub.user_account where id=actor;
 end if;
 return to_jsonb(a);
end $$;
revoke all on function hub.account_identity(text,text,text) from public;
grant execute on function hub.account_identity(text,text,text) to viewer;

create function hub.submit_access_request(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; actor uuid:=nullif(current_setting('app.actor_id',true),'')::uuid; tasks text[];
begin
 select * into a from hub.user_account where id=actor for update;
 if not found or a.status<>'PENDING' then raise exception 'Pending request required' using errcode='42501'; end if;
 tasks:=array(select jsonb_array_elements_text(p->'requested_tasks'));
 if coalesce(p->>'display_name_th','') !~ '[ก-๙]' or length(p->>'display_name_th')>200
 or coalesce(p->>'phone','') !~ '^\+?[0-9 ()-]{8,30}$' or length(btrim(coalesce(p->>'team','')))=0 or length(p->>'team')>200
 or coalesce(array_length(tasks,1),0)=0 or not tasks <@ array['read','edit','publish','online','agency']::text[]
 or length(btrim(coalesce(p->>'reason','')))=0 or length(p->>'reason')>2000 or p->>'privacy_acknowledged'<>'true'
 then raise exception 'Invalid access request' using errcode='23514'; end if;
 update hub.user_account set display_name_th=btrim(p->>'display_name_th'),phone=p->>'phone',team=btrim(p->>'team'),
 requested_tasks=tasks,reason=btrim(p->>'reason'),privacy_acknowledged_at=coalesce(privacy_acknowledged_at,now()),updated_at=clock_timestamp()
 where id=actor returning * into a;
 insert into hub.user_account_event(account_id,actor_id,action,new_status) values(actor,actor,'REQUEST','PENDING');
 return to_jsonb(a);
end $$;
revoke all on function hub.submit_access_request(jsonb) from public;
grant execute on function hub.submit_access_request(jsonb) to viewer;

create function hub.decide_account(target uuid,action text,new_role text,agency text,note text,expected timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; previous hub.user_account; actor uuid:=nullif(current_setting('app.actor_id',true),'')::uuid; next_status text;
begin
 -- Serialize decisions, including concurrent last-admin removals. Small admin queue.
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 if not hub.account_admin() or target=actor then raise exception 'Admin required; self decisions forbidden' using errcode='42501'; end if;
 select * into a from hub.user_account where id=target for update;
 if not found then raise exception 'Unknown account' using errcode='P0002'; end if;
 previous:=a;
 if a.updated_at is distinct from expected then raise exception 'Stale account' using errcode='40001'; end if;
 next_status:=case
 when action='approve' and a.status='PENDING' and a.privacy_acknowledged_at is not null then 'ACTIVE'
 when action='role' and a.status='ACTIVE' then 'ACTIVE'
 when action='suspend' and a.status='ACTIVE' then 'SUSPENDED'
 when action='reactivate' and a.status='SUSPENDED' then 'ACTIVE'
 when action='reject' and a.status='PENDING' and length(btrim(coalesce(note,'')))>0 then 'REJECTED' end;
 if next_status is null or length(coalesce(note,''))>2000 then raise exception 'Invalid decision' using errcode='23514'; end if;
 if action not in ('approve','role') then new_role:=a.hub_role; agency:=a.agency_code; end if;
 if new_role='agency' and not exists(select 1 from ads.vocab where vocab_type='AGENCY' and code=agency and status='ACTIVE' and alias_of is null
 and (active_from is null or active_from<=current_date) and (active_to is null or active_to>=current_date))
 then raise exception 'Canonical agency required' using errcode='23514'; end if;
 if new_role is distinct from 'agency' then agency:=null; end if;
 if a.status='ACTIVE' and a.hub_role='admin' and (next_status<>'ACTIVE' or new_role<>'admin')
 and not exists(select 1 from hub.user_account where id<>target and status='ACTIVE' and hub_role='admin')
 then raise exception 'Last admin required' using errcode='42501'; end if;
 update hub.user_account set status=next_status,hub_role=new_role,agency_code=agency,decision_note=coalesce(note,''),
 decided_by=actor,decided_at=now(),updated_at=clock_timestamp() where id=target returning * into a;
 insert into hub.user_account_event(account_id,actor_id,action,old_status,new_status,old_role,new_role)
 values(target,actor,action,previous.status,a.status,previous.hub_role,a.hub_role);
 return to_jsonb(a);
end $$;
revoke all on function hub.decide_account(uuid,text,text,text,text,timestamptz) from public;
grant execute on function hub.decide_account(uuid,text,text,text,text,timestamptz) to admin;

create function hub.account_display_names() returns table(id uuid,display_name_th text)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select id,display_name_th from hub.user_account where anonymised_at is null and exists(
 select 1 from hub.user_account caller where caller.id=nullif(current_setting('app.actor_id',true),'')::uuid
 and caller.status='ACTIVE' and caller.hub_role in ('editor','publisher','viewer','admin','online_staff'))
$$;
revoke all on function hub.account_display_names() from public;
grant execute on function hub.account_display_names() to editor,publisher,viewer,admin,online_staff;

-- Operator-only maintenance; no app role, assistant, export or RAG grants.
create function hub.purge_rejected_accounts() returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a record; total integer:=0;
begin
 for a in select id from hub.user_account where status='REJECTED' and decided_at<now()-interval '90 days' and anonymised_at is null for update loop
  update hub.user_account set email='',display_name_th='',phone='',team='',requested_tasks='{}',reason='',decision_note='',anonymised_at=now() where id=a.id;
  -- Anonymisation is the sole operator-only exception to append-only event storage.
  update hub.user_account_event set account_id=null,actor_id=null where account_id=a.id or actor_id=a.id;
  insert into hub.user_account_event(action,new_status) values('ANONYMISED','REJECTED');
  total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function hub.purge_rejected_accounts() from public;
commit;
