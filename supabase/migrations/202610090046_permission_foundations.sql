begin;

-- Phase 1 is additive and deny-only. Locked tabs cannot be edited until ALL
-- their DB entry points have guards. Only migrations may change rollout state.
create table hub.permission_catalog (
 tab text primary key check(tab ~ '^[a-z_]+$'), label_th text not null,
 nav_group text not null, levels text[] not null, special_actions text[] not null default '{}',
 separate_edit_approve boolean not null default false,
 agency_visible boolean not null default false, sensitivity text not null,
 rollout_state text not null default 'LEGACY_LOCKED' check(rollout_state in ('LEGACY_LOCKED','MIGRATED','DISABLED')),
 guards_ready boolean not null default false,
 check(levels <@ array['view','edit','approve']::text[] and 'view'=any(levels)),
 check(rollout_state='LEGACY_LOCKED' or guards_ready)
);
insert into hub.permission_catalog(tab,label_th,nav_group,levels,special_actions,separate_edit_approve,agency_visible,sensitivity) values
 ('projects','โครงการ','content','{view,edit,approve}','{}',true,false,'internal'),
 ('brands','แบรนด์','content','{view,edit,approve}','{brands.manage_catalog}',true,false,'internal'),
 ('promotions','โปรโมชัน','content','{view,edit,approve}','{}',true,false,'internal'),
 ('releases','ชุดเผยแพร่','content','{view,approve}','{}',true,false,'internal'),
 ('knowledge','ความรู้','content','{view,edit,approve}','{}',false,false,'restricted'),
 ('registry','ทะเบียนแคมเปญ','ads','{view,edit}','{}',false,true,'internal'),
 ('finance','งบการตลาด','ads','{view,edit,approve}','{finance.review_identifiers_corrections}',false,false,'restricted'),
 ('actuals','ยอดใช้จริง','ads','{view}','{}',false,false,'restricted'),
 ('documents','ติดตามเอกสาร','ads','{view,edit}','{}',false,false,'restricted'),
 ('archive','คลังเอกสาร','ads','{view,edit,approve}','{archive.legal_hold}',false,false,'restricted'),
 ('exceptions','ข้อยกเว้น','ads','{view,edit}','{}',false,false,'restricted'),
 ('questions','คำถาม','other','{view}','{}',false,false,'internal');

create table hub.permission_template (
 code text not null check(code in ('viewer','editor','publisher','admin','online_staff','agency')),
 version integer not null check(version>0), label_th text not null,
 tabs jsonb not null check(jsonb_typeof(tabs)='object'), created_at timestamptz not null default now(),
 primary key(code,version)
);
-- JSON arrays contain granted levels and special actions. Templates are copied,
-- not joined as live authority. No runtime role can change these versioned rows.
insert into hub.permission_template(code,version,label_th,tabs) values
 ('viewer',1,'ผู้ดูข้อมูล','{"projects":["view"],"brands":["view"],"promotions":["view"],"releases":["view"],"knowledge":["view"],"questions":["view"]}'),
 ('editor',1,'ผู้แก้ไขข้อมูล','{"projects":["view","edit"],"brands":["view","edit"],"promotions":["view","edit"],"releases":["view"],"knowledge":["view","edit"],"questions":["view"]}'),
 ('publisher',1,'Manager — อนุมัติและเผยแพร่','{"projects":["view","approve"],"brands":["view","approve"],"promotions":["view","approve"],"releases":["view","approve"],"knowledge":["view","approve"],"questions":["view"]}'),
 ('online_staff',1,'ทีมออนไลน์','{"registry":["view","edit"],"finance":["view","edit","approve"],"actuals":["view"],"documents":["view","edit"],"archive":["view","edit","approve"],"exceptions":["view","edit"],"questions":["view"]}'),
 ('admin',1,'ผู้ดูแลระบบ','{"projects":["view","edit"],"brands":["view","edit","brands.manage_catalog"],"promotions":["view","edit"],"releases":["view"],"knowledge":["view","edit"],"registry":["view","edit"],"finance":["view","edit","approve","finance.review_identifiers_corrections"],"actuals":["view"],"documents":["view","edit"],"archive":["view","edit","approve","archive.legal_hold"],"exceptions":["view","edit"],"questions":["view"]}'),
 ('agency',1,'เอเจนซี — เฉพาะทะเบียนของตน','{"registry":["view"]}');

alter table hub.user_account add column can_manage_users boolean not null default false;
alter table hub.user_account add column legacy_hub_role text;
alter table hub.user_account add column permission_template text;
alter table hub.user_account add column permission_template_version integer;
alter table hub.user_account add foreign key(permission_template,permission_template_version) references hub.permission_template(code,version);

create table hub.account_permission (
 account_id uuid not null references hub.user_account(id) on delete cascade,
 tab text not null references hub.permission_catalog(tab),
 can_view boolean not null default false, can_edit boolean not null default false,
 can_approve boolean not null default false, special_actions text[] not null default '{}',
 primary key(account_id,tab),
 check(can_view or (not can_edit and not can_approve and cardinality(special_actions)=0))
);
create table hub.permission_event (
 id uuid primary key default gen_random_uuid(), account_id uuid,
 actor_id uuid, action text not null,
 before_value jsonb not null, after_value jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index permission_event_account on hub.permission_event(account_id,created_at);

-- Explicit owner policies support FORCE RLS even for a non-superuser migration
-- owner (the loopback H1 simulation). No app role is a member of that owner.
do $$ declare t text; begin
 foreach t in array array['permission_catalog','permission_template','account_permission','permission_event'] loop
  execute format('alter table hub.%I enable row level security',t);
  execute format('alter table hub.%I force row level security',t);
  execute format('revoke all on hub.%I from public,editor,publisher,viewer,admin,online_staff,agency,service_consumer',t);
  execute format('create policy permission_owner on hub.%I to %I using(true) with check(true)',t,current_user);
 end loop;
end $$;

-- Invalid/missing actor GUCs fail closed instead of escaping into a cast error.
create function hub.permission_actor() returns uuid language plpgsql stable
set search_path=pg_catalog,pg_temp as $$
begin return nullif(current_setting('app.actor_id',true),'')::uuid;
exception when invalid_text_representation then return null;
end $$;
revoke all on function hub.permission_actor() from public;

create function hub.validate_permission_row() returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
declare c hub.permission_catalog;
begin
 select * into c from hub.permission_catalog where tab=new.tab;
 if not found or (new.can_edit and not 'edit'=any(c.levels))
 or (new.can_approve and not 'approve'=any(c.levels))
 or not new.special_actions <@ c.special_actions
 or (c.separate_edit_approve and new.can_edit and new.can_approve) then
  raise exception 'Invalid permission combination' using errcode='23514',detail='permission_combination';
 end if;
 return new;
end $$;
revoke all on function hub.validate_permission_row() from public;
create trigger account_permission_valid before insert or update on hub.account_permission
for each row execute function hub.validate_permission_row();

create function hub.permission_rows(target uuid) returns jsonb language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_object_agg(tab,to_jsonb(array_remove(array[
 case when can_view then 'view' end,case when can_edit then 'edit' end,
 case when can_approve then 'approve' end],null)||special_actions)),'{}')
 from hub.account_permission where account_id=target
$$;
revoke all on function hub.permission_rows(uuid) from public;

-- Only explicit legacy role decisions during the staged rollout recopy the
-- template/ceiling. A permission save never changes hub_role or its ceiling.
create function hub.copy_account_template() returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $$
declare before_tabs jsonb; t hub.permission_template;
begin
 if tg_op='UPDATE' and new.hub_role is not distinct from old.hub_role then return new; end if;
 before_tabs:=hub.permission_rows(new.id);
 select * into t from hub.permission_template where code=new.hub_role order by version desc limit 1;
 update hub.user_account set legacy_hub_role=new.hub_role,can_manage_users=(new.hub_role is not distinct from 'admin'),
 permission_template=t.code,permission_template_version=t.version where id=new.id;
 delete from hub.account_permission where account_id=new.id;
 insert into hub.account_permission(account_id,tab,can_view,can_edit,can_approve,special_actions)
 select new.id,key,value ? 'view',value ? 'edit',value ? 'approve',
 array(select jsonb_array_elements_text(value) except select unnest(array['view','edit','approve']))
 from jsonb_each(coalesce(t.tabs,'{}'));
 insert into hub.permission_event(account_id,actor_id,action,before_value,after_value)
 values(new.id,hub.permission_actor(),'TEMPLATE_COPY',
 jsonb_build_object('tabs',before_tabs,'can_manage_users',case when tg_op='UPDATE' then old.can_manage_users else false end),
 jsonb_build_object('tabs',hub.permission_rows(new.id),'can_manage_users',new.hub_role is not distinct from 'admin','template',t.code,'version',t.version));
 return new;
end $$;
revoke all on function hub.copy_account_template() from public;
create trigger account_template_copy after insert or update of hub_role on hub.user_account
for each row execute function hub.copy_account_template();

-- Existing identities get an audited one-time copy, including suspended rows.
update hub.user_account set legacy_hub_role=hub_role,can_manage_users=(hub_role is not distinct from 'admin'),
 permission_template=case when hub_role<>'service_consumer' then hub_role end,
 permission_template_version=case when hub_role is not null and hub_role<>'service_consumer' then 1 end;
insert into hub.account_permission(account_id,tab,can_view,can_edit,can_approve,special_actions)
select a.id,p.key,p.value ? 'view',p.value ? 'edit',p.value ? 'approve',
 array(select jsonb_array_elements_text(p.value) except select unnest(array['view','edit','approve']))
from hub.user_account a join hub.permission_template t on t.code=a.permission_template and t.version=a.permission_template_version
cross join lateral jsonb_each(t.tabs) p;
insert into hub.permission_event(account_id,action,before_value,after_value)
select id,'CONVERT','{}',jsonb_build_object('tabs',hub.permission_rows(id),'can_manage_users',can_manage_users,
 'template',permission_template,'version',permission_template_version) from hub.user_account;

create function hub.can(p_tab text,p_level text) returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from hub.user_account a join hub.account_permission p on p.account_id=a.id
 join hub.permission_catalog c on c.tab=p.tab
 left join hub.permission_template ceiling on ceiling.code=a.legacy_hub_role and ceiling.version=1
 where a.id=hub.permission_actor() and a.status='ACTIVE'
 and a.hub_role in ('viewer','editor','publisher','admin','online_staff')
 and c.tab=p_tab and p_level=any(c.levels) and c.rollout_state<>'DISABLED'
 and p.can_view and case p_level when 'view' then true when 'edit' then p.can_edit when 'approve' then p.can_approve else false end
 and (c.rollout_state='MIGRATED' or coalesce(ceiling.tabs->p_tab ? p_level,false)))
$$;
revoke all on function hub.can(text,text) from public;
grant execute on function hub.can(text,text) to editor,publisher,viewer,admin,online_staff,agency,service_consumer;

create function hub.can_special(p_tab text,p_action text) returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select hub.can(p_tab,'view') and exists(select 1 from hub.account_permission p
 join hub.user_account a on a.id=p.account_id join hub.permission_catalog c on c.tab=p.tab
 left join hub.permission_template ceiling on ceiling.code=a.legacy_hub_role and ceiling.version=1
 where a.id=hub.permission_actor() and p.tab=p_tab and p_action=any(c.special_actions) and p_action=any(p.special_actions)
 and (c.rollout_state='MIGRATED' or coalesce(ceiling.tabs->p_tab ? p_action,false)))
$$;
revoke all on function hub.can_special(text,text) from public;
grant execute on function hub.can_special(text,text) to editor,publisher,viewer,admin,online_staff,agency,service_consumer;

create function hub.can_agency_registry(p_agency text) returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from hub.user_account a where a.id=hub.permission_actor() and a.status='ACTIVE'
 and a.hub_role='agency' and a.agency_code=p_agency and hub.account_agency_valid(a.agency_code)
 and exists(select 1 from hub.permission_catalog where tab='registry' and rollout_state<>'DISABLED'))
$$;
revoke all on function hub.can_agency_registry(text) from public;
grant execute on function hub.can_agency_registry(text) to editor,publisher,viewer,admin,online_staff,agency;

-- The legacy role remains a ceiling until the Accounts UI/base-role migration.
-- Revoking the flag denies account administration immediately, even as admin.
create or replace function hub.account_admin() returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from hub.user_account where id=hub.permission_actor()
 and status='ACTIVE' and can_manage_users and hub_role='admin')
$$;

create function hub.permission_projection(a hub.user_account) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare tabs jsonb; specials jsonb; effective jsonb; c hub.permission_catalog; bits jsonb;
 ceiling jsonb; active boolean:=coalesce(a.status='ACTIVE' and a.hub_role in ('viewer','editor','publisher','admin','online_staff'),false);
begin
 effective:=hub.permission_rows(a.id);
 select t.tabs into ceiling from hub.permission_template t where code=a.legacy_hub_role and version=1;
 tabs:='{}'; specials:='{}';
 for c in select * from hub.permission_catalog loop
  bits:=coalesce(effective->c.tab,'[]');
  if not active or c.rollout_state='DISABLED' or not bits ? 'view' then bits:='[]'; end if;
  if c.rollout_state='LEGACY_LOCKED' then
   select coalesce(jsonb_agg(x),'[]') into bits from jsonb_array_elements_text(bits) x where coalesce(ceiling->c.tab ? x,false);
  end if;
  tabs:=tabs||jsonb_build_object(c.tab,jsonb_build_object('view',bits ? 'view','edit',bits ? 'edit','approve',bits ? 'approve'));
  select specials||coalesce(jsonb_object_agg(s,bits ? s),'{}') into specials from unnest(c.special_actions) s;
 end loop;
 return jsonb_build_object('tabs',tabs,'special_actions',specials,'can_manage_users',active and a.can_manage_users and a.hub_role='admin',
 'template',a.permission_template,'template_version',a.permission_template_version,
 'locked_tabs',(select coalesce(jsonb_agg(tab order by tab),'[]') from hub.permission_catalog where rollout_state='LEGACY_LOCKED'),
 'external_profile',case when a.hub_role='agency' then 'agency' end,
 'agency_registry',coalesce(a.status='ACTIVE' and a.hub_role='agency' and hub.account_agency_valid(a.agency_code)
 and exists(select 1 from hub.permission_catalog where tab='registry' and rollout_state<>'DISABLED'),false),
 'published_consumer',active);
end $$;
revoke all on function hub.permission_projection(hub.user_account) from public;

create function hub.permission_catalog_read() returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 return jsonb_build_object('tabs',(select jsonb_agg(to_jsonb(c) order by tab) from hub.permission_catalog c),
 'templates',(select jsonb_agg(to_jsonb(t) order by code,version) from hub.permission_template t));
end $$;
revoke all on function hub.permission_catalog_read() from public;
grant execute on function hub.permission_catalog_read() to admin;

create function hub.save_account_permissions(target uuid,tabs jsonb,manage boolean,expected timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; before_tabs jsonb; c hub.permission_catalog; levels jsonb;
begin
 -- ponytail: same global lock as account decisions; shard only after measured contention.
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 select * into a from hub.user_account where id=target for update;
 if not found then raise exception 'Unknown account' using errcode='P0002'; end if;
 if target=hub.permission_actor() then raise exception 'Self decision forbidden' using errcode='42501',detail='account_self_decision'; end if;
 if a.updated_at is distinct from expected then raise exception 'Stale account' using errcode='40001'; end if;
 if a.status<>'ACTIVE' or a.hub_role in ('agency','service_consumer') then
  raise exception 'Fixed or inactive profile' using errcode='42501',detail='permission_fixed_profile'; end if;
 if manage is null or jsonb_typeof(tabs) is distinct from 'object' then
  raise exception 'Permission object required' using errcode='23514',detail='permission_combination'; end if;
 if manage and a.hub_role<>'admin' then
  raise exception 'Legacy administration ceiling' using errcode='42501',detail='permission_locked'; end if;
 if a.can_manage_users and not manage and not exists(select 1 from hub.user_account
 where id<>target and status='ACTIVE' and can_manage_users) then
  raise exception 'Last admin required' using errcode='42501',detail='account_last_admin'; end if;
 if exists(select 1 from jsonb_object_keys(tabs) k where not exists(select 1 from hub.permission_catalog where tab=k)) then
  raise exception 'Unknown tab' using errcode='23514',detail='permission_combination'; end if;
 before_tabs:=hub.permission_rows(target);
 for c in select * from hub.permission_catalog loop
  levels:=coalesce(tabs->c.tab,'[]');
  if jsonb_typeof(levels) is distinct from 'array' or exists(select 1 from jsonb_array_elements(levels) x where jsonb_typeof(x)<>'string') then
   raise exception 'Permission array required' using errcode='23514',detail='permission_combination'; end if;
  if c.rollout_state<>'MIGRATED' and not (levels @> coalesce(before_tabs->c.tab,'[]') and levels <@ coalesce(before_tabs->c.tab,'[]')) then
   raise exception 'Tab permission editing is locked' using errcode='42501',detail='permission_locked'; end if;
 end loop;
 delete from hub.account_permission where account_id=target;
 insert into hub.account_permission(account_id,tab,can_view,can_edit,can_approve,special_actions)
 select target,key,value ? 'view',value ? 'edit',value ? 'approve',
 array(select jsonb_array_elements_text(value) except select unnest(array['view','edit','approve'])) from jsonb_each(tabs);
 update hub.user_account set can_manage_users=manage,updated_at=clock_timestamp() where id=target;
 insert into hub.permission_event(account_id,actor_id,action,before_value,after_value)
 values(target,hub.permission_actor(),'PERMISSIONS',jsonb_build_object('tabs',before_tabs,'can_manage_users',a.can_manage_users),
 jsonb_build_object('tabs',hub.permission_rows(target),'can_manage_users',manage));
 return jsonb_build_object('id',target,'updated_at',(select updated_at from hub.user_account where id=target));
end $$;
revoke all on function hub.save_account_permissions(uuid,jsonb,boolean,timestamptz) from public;
grant execute on function hub.save_account_permissions(uuid,jsonb,boolean,timestamptz) to admin;

-- Keep the same identity function and one bounded capabilities projection on
-- each request. Neither JWT metadata nor any caller-supplied role is consulted.
create or replace function hub.account_identity(p_email text,p_provider text,p_name text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; actor uuid:=hub.permission_actor();
begin
 if actor is null then raise exception 'Identity required' using errcode='42501'; end if;
 select * into a from hub.user_account where id=actor;
 if not found then
  perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
  insert into hub.user_account(id,email,sign_in_method,display_name_th)
  values(actor,lower(btrim(left(p_email,254))),case when p_provider='google' then 'google' else 'email' end,left(coalesce(p_name,''),200)) on conflict(id) do nothing;
  select * into a from hub.user_account where id=actor;
 end if;
 return (to_jsonb(a)-'legacy_hub_role')||jsonb_build_object('capabilities',hub.permission_projection(a),
 'can_manage_users',a.status='ACTIVE' and a.can_manage_users and a.hub_role='admin',
 'invite',case when a.status='PENDING' and a.privacy_acknowledged_at is null and lower(btrim(p_email))=lower(btrim(a.email)) then hub.match_account_invite() end);
end $$;

-- Existing account decisions share the flag-based last-admin invariant.
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
 if a.status='ACTIVE' and a.can_manage_users and (action='suspend' or action='role' and new_role is distinct from 'admin')
 and not exists(select 1 from hub.user_account where id<>target and status='ACTIVE' and can_manage_users)
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
 if a.status='ACTIVE' and a.can_manage_users and (next_status<>'ACTIVE' or new_role<>'admin')
 and not exists(select 1 from hub.user_account where id<>target and status='ACTIVE' and can_manage_users)
 then raise exception 'Last admin required' using errcode='42501',detail='account_last_admin'; end if;
 if action='reopen' then new_role:=null; agency:=null; end if;
 update hub.user_account set privacy_acknowledged_at=case when action='reopen' then null else privacy_acknowledged_at end,status=next_status,hub_role=new_role,agency_code=agency,decision_note=case when action in ('reject','suspend') then btrim(note) else '' end,
 decided_by=actor,decided_at=now(),updated_at=clock_timestamp() where id=target returning * into a;
 insert into hub.user_account_event(account_id,actor_id,action,old_status,new_status,old_role,new_role,decision_note,previous_decision_note)
 values(target,actor,action,previous.status,a.status,previous.hub_role,a.hub_role,coalesce(note,''),case when action='reopen' then previous.decision_note else '' end);
 select * into a from hub.user_account where id=target;
 return to_jsonb(a);
end $$;
revoke all on function hub.decide_account(uuid,text,text,text,text,timestamptz) from public;
grant execute on function hub.decide_account(uuid,text,text,text,text,timestamptz) to admin;


-- Retention covers the new account-linked audit storage too.
create or replace function hub.purge_rejected_accounts() returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a record; total integer:=0;
begin
 for a in select id from hub.user_account where status='REJECTED' and decided_at<now()-interval '90 days' and anonymised_at is null for update loop
  update hub.user_account set email='',display_name_th='',phone='',company_name=null,position=null,company_type=null,team='',requested_tasks='{}',reason='',decision_note='',anonymised_at=now() where id=a.id;
  -- Anonymisation is the sole operator-only exception to append-only event storage.
  update hub.user_account_event set account_id=null,actor_id=null,decision_note='',previous_decision_note='' where account_id=a.id or actor_id=a.id;
  update hub.permission_event set account_id=null,actor_id=null where account_id=a.id or actor_id=a.id;
  delete from hub.account_permission where account_id=a.id;
  insert into hub.user_account_event(action,new_status) values('ANONYMISED','REJECTED');
  total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function hub.purge_rejected_accounts() from public;

commit;
