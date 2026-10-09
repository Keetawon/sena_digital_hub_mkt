begin;

-- Enable editing only after every existing tab has its database guards.
do $$ begin
 if (select array_agg(tab order by tab) from hub.permission_catalog) is distinct from
 array['actuals','archive','brands','documents','exceptions','finance','knowledge','projects','promotions','questions','registry','releases']::text[]
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('hub','ads','staging','internal','rag','audit')
 and c.relkind in ('r','p') and (not c.relrowsecurity or not c.relforcerowsecurity))
 or to_regprocedure('hub.require_permission(text,text)') is null or to_regprocedure('hub.require_registry(text,boolean)') is null
 or to_regprocedure('hub.operations_projection(jsonb)') is null or to_regprocedure('internal.assistant_access(text,text,boolean)') is null then
  raise exception 'Permission guard coverage is incomplete';
 end if;
end $$;
-- Explicit attestation: Phase 2–6 runtime deny suites passed for all twelve groups.
update hub.permission_catalog set guards_ready=true,rollout_state='MIGRATED';
alter table hub.permission_catalog add column onboarding_required boolean not null default true;
alter table hub.permission_catalog add column special_labels jsonb not null default '{}';
update hub.permission_catalog set onboarding_required=false;
update hub.permission_catalog set label_th=v.label from (values
 ('projects','โครงการที่อยู่อาศัย'),('brands','แบรนด์ที่อยู่อาศัย'),('promotions','โปรโมชั่นโครงการ'),
 ('releases','ชุดเผยแพร่ข้อมูล'),('knowledge','ตรวจข้อมูลก่อนนำเข้า'),('registry','ทะเบียนแคมเปญ'),
 ('finance','งบและค่าใช้จ่าย'),('actuals','ผลใช้จ่ายรายเดือน'),('documents','ติดตามเอกสาร'),
 ('archive','คลังเอกสาร'),('exceptions','รายการที่ต้องตรวจสอบ'),('questions','คำถามที่รอคำตอบ')) v(tab,label)
 where permission_catalog.tab=v.tab;
update hub.permission_catalog set special_labels=jsonb_build_object('brands.manage_catalog','จัดการรายการแบรนด์') where tab='brands';
update hub.permission_catalog set special_labels=jsonb_build_object('finance.review_identifiers_corrections','ตรวจเลขที่บันทึกและรายการแก้ไข') where tab='finance';
update hub.permission_catalog set special_labels=jsonb_build_object('archive.legal_hold','ระงับการลบเอกสาร') where tab='archive';

create table hub.permission_notice_ack (
 actor_id uuid not null references hub.user_account(id) on delete cascade,
 tab text not null references hub.permission_catalog(tab),
 acknowledged_at timestamptz not null default clock_timestamp(),primary key(actor_id,tab)
);
alter table hub.permission_notice_ack enable row level security;
alter table hub.permission_notice_ack force row level security;
do $$ begin execute format('create policy permission_notice_owner on hub.permission_notice_ack to %I using(true) with check(true)',current_user); end $$;
revoke all on hub.permission_notice_ack from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer;

alter table hub.account_invite add column permission_template text;
alter table hub.account_invite add column permission_template_version integer;
update hub.account_invite set permission_template=hub_role,permission_template_version=1;
alter table hub.account_invite alter column permission_template set not null;
alter table hub.account_invite alter column permission_template_version set not null;
alter table hub.account_invite add foreign key(permission_template,permission_template_version) references hub.permission_template(code,version);
create trigger permission_template_immutable before update or delete on hub.permission_template
for each row execute function hub.reject_version_change();

-- Existing seed/operator INSERT initialization remains. Runtime account updates
-- use explicit writers below; changing compatibility role metadata cannot recopy.
drop trigger account_template_copy on hub.user_account;
create trigger account_template_copy after insert on hub.user_account for each row execute function hub.copy_account_template();

create function hub.normalise_permission_tabs(p jsonb) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare c hub.permission_catalog; levels jsonb; result jsonb:='{}';
begin
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where not exists(select 1 from hub.permission_catalog where tab=k)) then
  raise exception 'Unknown permission tab' using errcode='23514',detail='permission_combination'; end if;
 for c in select * from hub.permission_catalog order by tab loop
  levels:=coalesce(p->c.tab,'[]');
  if jsonb_typeof(levels) is distinct from 'array' then raise exception 'Permission array required' using errcode='23514',detail='permission_combination'; end if;
  if exists(select 1 from jsonb_array_elements(levels) v where jsonb_typeof(v)<>'string') then
   raise exception 'Permission string required' using errcode='23514',detail='permission_combination'; end if;
  if exists(select 1 from jsonb_array_elements_text(levels) v where not v=any(c.levels||c.special_actions))
   or (jsonb_array_length(levels)>0 and not levels ? 'view')
   or (c.separate_edit_approve and levels ? 'edit' and levels ? 'approve') then
   raise exception 'Invalid permission combination' using errcode='23514',detail='permission_combination'; end if;
  select coalesce(jsonb_agg(v order by v),'[]') into levels from (select distinct value v from jsonb_array_elements_text(levels)) x;
  result:=result||jsonb_build_object(c.tab,levels);
 end loop;
 return result;
end $$;
revoke all on function hub.normalise_permission_tabs(jsonb) from public;

create function hub.account_access(a hub.user_account) returns jsonb language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('tabs',hub.normalise_permission_tabs(hub.permission_rows(a.id)),
 'can_manage_users',a.can_manage_users,
 'template',case when a.permission_template is not null then jsonb_build_object('code',a.permission_template,'version',a.permission_template_version) end,
 'customised',hub.normalise_permission_tabs(hub.permission_rows(a.id)) is distinct from
 hub.normalise_permission_tabs(coalesce((select tabs from hub.permission_template where code=a.permission_template and version=a.permission_template_version),'{}')))
$$;
revoke all on function hub.account_access(hub.user_account) from public;

create function hub.permission_catalog_digest() returns text language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(c) order by tab),'[]')::text,'UTF8')),'hex') from hub.permission_catalog c
$$;
revoke all on function hub.permission_catalog_digest() from public;

create or replace function hub.permission_catalog_read() returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 return jsonb_build_object('catalog_digest',hub.permission_catalog_digest(),
 'tabs',(select jsonb_agg(to_jsonb(c)||jsonb_build_object('new_for_actor',c.onboarding_required and not exists(
 select 1 from hub.permission_notice_ack a where a.actor_id=hub.permission_actor() and a.tab=c.tab)) order by tab) from hub.permission_catalog c),
 'templates',(select jsonb_agg(to_jsonb(t) order by code,version) from hub.permission_template t));
end $$;

create or replace function hub.account_directory() returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.account_admin() then raise exception 'Account administration required' using errcode='42501'; end if;
 return jsonb_build_object('actor_id',hub.permission_actor(),
 'items',(select coalesce(jsonb_agg((to_jsonb(a)-'legacy_hub_role')||jsonb_build_object('access',hub.account_access(a)) order by created_at desc),'[]') from hub.user_account a),
 'events',(select coalesce(jsonb_agg(to_jsonb(e) order by created_at desc),'[]') from hub.user_account_event e),
 'permission_events',(select coalesce(jsonb_agg(to_jsonb(e) order by created_at desc),'[]') from hub.permission_event e),
 'agencies',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'label_th',label_th) order by code),'[]') from ads.vocab
 where vocab_type='AGENCY' and status='ACTIVE' and alias_of is null
 and (active_from is null or active_from<=(now() at time zone 'Asia/Bangkok')::date)
 and (active_to is null or active_to>=(now() at time zone 'Asia/Bangkok')::date)));
end $$;

-- The safe catalog contains no accounts, template defaults, notes or audit rows.
do $$ declare definition text; original text;
begin
 definition:=pg_get_functiondef('hub.permission_projection(hub.user_account)'::regprocedure); original:=definition;
 definition:=replace(definition,'''published_consumer'',active)',
 $new$'published_consumer',active,'customised',(hub.account_access(a)->>'customised')::boolean,
 'catalog',(select coalesce(jsonb_agg(jsonb_build_object('tab',catalog_row.tab,'label_th',catalog_row.label_th,
 'nav_group',case when catalog_row.nav_group='other' then null else catalog_row.nav_group end,'levels',catalog_row.levels,
 'special_actions',catalog_row.special_actions,'special_labels',catalog_row.special_labels,'separate_edit_approve',catalog_row.separate_edit_approve,
 'agency_visible',catalog_row.agency_visible,'sensitivity',catalog_row.sensitivity,'rollout_state',catalog_row.rollout_state,'guards_ready',catalog_row.guards_ready) order by catalog_row.tab),'[]')
 from hub.permission_catalog catalog_row where active or (a.status='ACTIVE' and a.hub_role='agency' and catalog_row.tab='registry')))$new$);
 if definition=original then raise exception 'Projection marker drift'; end if;
 execute definition;
 definition:=pg_get_functiondef('hub.account_identity(text,text,text)'::regprocedure); original:=definition;
 definition:=replace(definition,'return (to_jsonb(a)-''legacy_hub_role'')||',
 'return (to_jsonb(a)-''legacy_hub_role'')||case when hub.account_admin() then jsonb_build_object(''pending_count'',(select count(*) from hub.user_account where status=''PENDING'' and privacy_acknowledged_at is not null)) else ''{}''::jsonb end||');
 if definition=original then raise exception 'Identity marker drift'; end if;
 execute definition;
end $$;

-- Private validation/write helpers are called only inside guarded entry points.
create function hub.resolve_account_access(a hub.user_account,p jsonb) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare t hub.permission_template; tabs jsonb; manage boolean; chosen_code text:=a.permission_template; chosen_version integer:=a.permission_template_version;
begin
 if p ? 'template' then
  if jsonb_typeof(p->'template') is distinct from 'object' or exists(select 1 from jsonb_object_keys(p->'template') k where k not in ('code','version')) then
   raise exception 'Template required' using errcode='23514',detail='permission_combination'; end if;
  chosen_code:=p#>>'{template,code}'; chosen_version:=(p#>>'{template,version}')::integer;
  if chosen_code is null or chosen_version is null then raise exception 'Template required' using errcode='23514',detail='permission_combination'; end if;
 end if;
 if chosen_code is not null then
  select * into t from hub.permission_template where code=chosen_code and version=chosen_version;
  if not found then raise exception 'Template version unavailable' using errcode='40001',detail='template_version_stale'; end if;
 end if;
 tabs:=hub.normalise_permission_tabs(case when p ? 'tabs' then p->'tabs' when p ? 'template' then t.tabs else hub.permission_rows(a.id) end);
 if p ? 'can_manage_users' and jsonb_typeof(p->'can_manage_users') is distinct from 'boolean' then
  raise exception 'Manager boolean required' using errcode='23514',detail='permission_combination'; end if;
 manage:=case when p ? 'can_manage_users' then (p->>'can_manage_users')::boolean else a.can_manage_users end;
 if manage and not a.can_manage_users and p->'confirm_manage_users' is distinct from 'true'::jsonb then
  raise exception 'Confirm account administration' using errcode='23514',detail='permission_admin_confirmation'; end if;
 if a.hub_role='agency' or chosen_code='agency' or a.hub_role='service_consumer' then
  raise exception 'Fixed external profile' using errcode='42501',detail='permission_fixed_profile'; end if;
 return jsonb_build_object('tabs',tabs,'can_manage_users',manage,
 'template',case when chosen_code is not null then jsonb_build_object('code',chosen_code,'version',chosen_version) end,
 'customised',tabs is distinct from hub.normalise_permission_tabs(coalesce(t.tabs,'{}')));
end $$;
revoke all on function hub.resolve_account_access(hub.user_account,jsonb) from public;

create function hub.write_account_access(target uuid,next_access jsonb,event_actor uuid,event_action text,note text default '',batch uuid default null)
returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; before_access jsonb; c hub.permission_catalog; tabs jsonb; manage boolean;
begin
 select * into strict a from hub.user_account where id=target for update;
 before_access:=hub.account_access(a); tabs:=hub.normalise_permission_tabs(next_access->'tabs'); manage:=(next_access->>'can_manage_users')::boolean;
 if length(coalesce(note,''))>2000 or manage is null then raise exception 'Invalid permission change' using errcode='23514',detail='permission_combination'; end if;
 if a.can_manage_users and not manage and a.status='ACTIVE' and not exists(select 1 from hub.user_account
 where id<>target and status='ACTIVE' and can_manage_users and hub_role in ('viewer','editor','publisher','admin','online_staff')) then
  raise exception 'Last admin required' using errcode='42501',detail='account_last_admin'; end if;
 for c in select * from hub.permission_catalog loop
  if c.rollout_state<>'MIGRATED' and tabs->c.tab is distinct from before_access#>array['tabs',c.tab] then
   raise exception 'Tab editing is locked' using errcode='42501',detail='permission_locked'; end if;
 end loop;
 if before_access=next_access then return false; end if;
 delete from hub.account_permission where account_id=target;
 insert into hub.account_permission(account_id,tab,can_view,can_edit,can_approve,special_actions)
 select target,key,value ? 'view',value ? 'edit',value ? 'approve',
 array(select jsonb_array_elements_text(value) except select unnest(array['view','edit','approve'])) from jsonb_each(tabs);
 update hub.user_account set can_manage_users=manage,permission_template=next_access#>>'{template,code}',
 permission_template_version=(next_access#>>'{template,version}')::integer,updated_at=clock_timestamp() where id=target;
 insert into hub.permission_event(account_id,actor_id,action,before_value,after_value)
 values(target,event_actor,event_action,before_access,next_access||jsonb_build_object('note',coalesce(note,''),'batch_id',batch));
 return true;
end $$;
revoke all on function hub.write_account_access(uuid,jsonb,uuid,text,text,uuid) from public;

create function hub.configure_account_access(target uuid,p jsonb) returns jsonb language plpgsql security definer
set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; next_access jsonb; changed boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where k not in
 ('updated_at','template','tabs','can_manage_users','confirm_manage_users','agency_code','note')) then
  raise exception 'Invalid access change' using errcode='23514',detail='permission_combination'; end if;
 select * into a from hub.user_account where id=target for update;
 if not found then raise exception 'Unknown account' using errcode='P0002'; end if;
 if target=hub.permission_actor() then raise exception 'Self decision forbidden' using errcode='42501',detail='account_self_decision'; end if;
 if a.updated_at is distinct from (p->>'updated_at')::timestamptz then raise exception 'Stale account' using errcode='40001'; end if;
 if a.status<>'ACTIVE' or a.hub_role='service_consumer' then raise exception 'Inactive or external account' using errcode='42501',detail='permission_fixed_profile'; end if;
 if a.hub_role='agency' then
  if exists(select 1 from jsonb_object_keys(p) k where k not in ('updated_at','agency_code','note')) then
   raise exception 'Fixed agency profile' using errcode='42501',detail='permission_fixed_profile'; end if;
  if not hub.account_agency_valid(p->>'agency_code') then raise exception 'Canonical agency required' using errcode='23514',detail='account_agency_invalid'; end if;
  if length(coalesce(p->>'note',''))>2000 then raise exception 'Invalid note' using errcode='23514'; end if;
  changed:=a.agency_code is distinct from p->>'agency_code';
  if changed then
   update hub.user_account set agency_code=p->>'agency_code',company_name=case when company_type='AGENCY' then p->>'agency_code' else company_name end,
   updated_at=clock_timestamp() where id=target;
   insert into hub.permission_event(account_id,actor_id,action,before_value,after_value)
   values(target,hub.permission_actor(),'AGENCY_CODE',jsonb_build_object('agency_code',a.agency_code),jsonb_build_object('agency_code',p->>'agency_code','note',coalesce(p->>'note','')));
  end if;
 else
  if p ? 'agency_code' and p->'agency_code'<>'null'::jsonb then raise exception 'Internal profile' using errcode='42501',detail='permission_fixed_profile'; end if;
  next_access:=hub.resolve_account_access(a,p);
  changed:=hub.write_account_access(target,next_access,hub.permission_actor(),case when p ? 'template' then 'TEMPLATE_APPLY' else 'PERMISSIONS' end,p->>'note');
 end if;
 select * into a from hub.user_account where id=target;
 return jsonb_build_object('account_id',target,'updated_at',a.updated_at,'agency_code',a.agency_code,'access',hub.account_access(a),'changed',changed);
end $$;
revoke all on function hub.configure_account_access(uuid,jsonb) from public;
grant execute on function hub.configure_account_access(uuid,jsonb) to hub_app;

create or replace function hub.save_account_permissions(target uuid,tabs jsonb,manage boolean,expected timestamptz) returns jsonb
language sql security definer set search_path=pg_catalog,pg_temp as $$
 select hub.configure_account_access(target,jsonb_build_object('tabs',tabs,'can_manage_users',manage,'updated_at',expected))
$$;

create or replace function hub.account_agency_valid(code text) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from ads.vocab v where v.vocab_type='AGENCY' and v.code=$1 and v.status='ACTIVE' and v.alias_of is null
 and (v.active_from is null or v.active_from<=(now() at time zone 'Asia/Bangkok')::date)
 and (v.active_to is null or v.active_to>=(now() at time zone 'Asia/Bangkok')::date))
$$;

create function hub.approve_account_access(target uuid,p jsonb) returns jsonb language plpgsql security definer
set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; previous hub.user_account; t hub.permission_template; next_access jsonb;
 chosen_code text; chosen_version integer; actor uuid:=hub.permission_actor();
begin
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where k not in
 ('updated_at','action','hub_role','template','tabs','can_manage_users','confirm_manage_users','agency_code','note')) then
  raise exception 'Invalid approval' using errcode='23514',detail='permission_combination'; end if;
 select * into a from hub.user_account where id=target for update;
 if not found then raise exception 'Unknown account' using errcode='P0002'; end if;
 previous:=a;
 if target=actor then raise exception 'Self decision forbidden' using errcode='42501',detail='account_self_decision'; end if;
 if a.updated_at is distinct from (p->>'updated_at')::timestamptz then raise exception 'Stale account' using errcode='40001'; end if;
 if a.status<>'PENDING' or a.privacy_acknowledged_at is null then raise exception 'Submitted request required' using errcode='23514'; end if;
 if p ? 'template' and (jsonb_typeof(p->'template') is distinct from 'object' or
 exists(select 1 from jsonb_object_keys(p->'template') k where k not in ('code','version'))) then
 raise exception 'Template required' using errcode='23514',detail='permission_combination'; end if;
 chosen_code:=coalesce(p#>>'{template,code}',p->>'hub_role');
 chosen_version:=case when p ? 'template' then (p#>>'{template,version}')::integer else 1 end;
 if chosen_code is null or chosen_version is null or (p ? 'hub_role' and p->>'hub_role' is distinct from chosen_code) then
 raise exception 'Template required' using errcode='23514',detail='permission_combination'; end if;
 select * into t from hub.permission_template where code=chosen_code and version=chosen_version;
 if not found then raise exception 'Template version unavailable' using errcode='40001',detail='template_version_stale'; end if;
 if chosen_code='agency' then
  if p ? 'tabs' or (p ? 'can_manage_users' and p->'can_manage_users' is distinct from 'false'::jsonb) then
   raise exception 'Fixed agency profile' using errcode='42501',detail='permission_fixed_profile'; end if;
  if not hub.account_agency_valid(p->>'agency_code') then raise exception 'Canonical agency required' using errcode='23514',detail='account_agency_invalid'; end if;
  next_access:=jsonb_build_object('tabs',hub.normalise_permission_tabs(t.tabs),'can_manage_users',false,
    'template',jsonb_build_object('code',chosen_code,'version',chosen_version),'customised',false);
 else
  if p ? 'agency_code' and p->'agency_code'<>'null'::jsonb then raise exception 'Internal profile' using errcode='42501',detail='permission_fixed_profile'; end if;
  a.can_manage_users:=false;
  next_access:=hub.resolve_account_access(a,p||jsonb_build_object('template',jsonb_build_object('code',chosen_code,'version',chosen_version)));
 end if;
 if length(coalesce(p->>'note',''))>2000 then raise exception 'Invalid note' using errcode='23514'; end if;
 update hub.user_account set status='ACTIVE',hub_role=chosen_code,agency_code=case when chosen_code='agency' then p->>'agency_code' end,
 can_manage_users=false,decision_note='',decided_by=actor,decided_at=now(),updated_at=clock_timestamp() where id=target;
 perform hub.write_account_access(target,next_access,actor,'APPROVE',p->>'note');
 insert into hub.user_account_event(account_id,actor_id,action,old_status,new_status,old_role,new_role,decision_note)
 values(target,actor,'approve',previous.status,'ACTIVE',previous.hub_role,chosen_code,coalesce(p->>'note',''));
 select * into a from hub.user_account where id=target;
 return (to_jsonb(a)-'legacy_hub_role')||jsonb_build_object('access',hub.account_access(a));
end $$;
revoke all on function hub.approve_account_access(uuid,jsonb) from public;
grant execute on function hub.approve_account_access(uuid,jsonb) to hub_app;

create or replace function hub.decide_account(target uuid,action text,new_role text,agency text,note text,expected timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; previous hub.user_account; actor uuid:=hub.permission_actor(); next_status text; p jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 select * into a from hub.user_account where id=target for update;
 if not found then raise exception 'Unknown account' using errcode='P0002'; end if;
 previous:=a;
 if target=actor then raise exception 'Self decision forbidden' using errcode='42501',detail='account_self_decision'; end if;
 if a.updated_at is distinct from expected then raise exception 'Stale account' using errcode='40001'; end if;
 if action='approve' then
  return hub.approve_account_access(target,jsonb_build_object('updated_at',expected,'hub_role',new_role,'agency_code',agency,'note',note));
 end if;
 if action='role' then
  if a.hub_role='agency' and new_role='agency' then
   p:=jsonb_build_object('updated_at',expected,'agency_code',agency,'note',note);
  else
   if a.hub_role='agency' or new_role='agency' then raise exception 'Fixed external profile' using errcode='42501',detail='permission_fixed_profile'; end if;
   p:=jsonb_build_object('updated_at',expected,'template',jsonb_build_object('code',new_role,'version',1),'note',note);
  end if;
  perform hub.configure_account_access(target,p);
  update hub.user_account set hub_role=new_role,updated_at=clock_timestamp() where id=target;
 else
  if action in ('reject','suspend') and length(btrim(coalesce(note,'')))=0 then
   raise exception 'Reason required' using errcode='23514',detail=case when action='reject' then 'account_reject_reason' else 'account_suspend_reason' end; end if;
  if action='reopen' and a.anonymised_at is not null then raise exception 'Anonymised account cannot reopen' using errcode='23514',detail='account_anonymised'; end if;
  next_status:=case when action='suspend' and a.status='ACTIVE' then 'SUSPENDED'
   when action='reactivate' and a.status='SUSPENDED' then 'ACTIVE'
   when action='reopen' and a.status='REJECTED' then 'PENDING'
   when action='reject' and a.status='PENDING' then 'REJECTED' end;
  if next_status is null or length(coalesce(note,''))>2000 then raise exception 'Invalid decision' using errcode='23514'; end if;
  if a.status='ACTIVE' and a.can_manage_users and next_status<>'ACTIVE' and not exists(select 1 from hub.user_account
   where id<>target and status='ACTIVE' and can_manage_users and hub_role in ('viewer','editor','publisher','admin','online_staff')) then
   raise exception 'Last admin required' using errcode='42501',detail='account_last_admin'; end if;
  if next_status='ACTIVE' and a.hub_role='agency' and not hub.account_agency_valid(a.agency_code) then
   raise exception 'Canonical agency required' using errcode='23514',detail='account_agency_invalid'; end if;
  if action='reopen' then
   perform hub.write_account_access(target,jsonb_build_object('tabs',hub.normalise_permission_tabs('{}'),'can_manage_users',false,'template',null,'customised',false),actor,'REOPEN',note);
  end if;
  update hub.user_account set status=next_status,hub_role=case when action='reopen' then null else hub_role end,
   agency_code=case when action='reopen' then null else agency_code end,
   privacy_acknowledged_at=case when action='reopen' then null else privacy_acknowledged_at end,
   decision_note=case when action in ('reject','suspend') then btrim(note) else '' end,
   decided_by=actor,decided_at=now(),updated_at=clock_timestamp() where id=target;
 end if;
 select * into a from hub.user_account where id=target;
 insert into hub.user_account_event(account_id,actor_id,action,old_status,new_status,old_role,new_role,decision_note,previous_decision_note)
 values(target,actor,action,previous.status,a.status,previous.hub_role,a.hub_role,coalesce(note,''),case when action='reopen' then previous.decision_note else '' end);
 return (to_jsonb(a)-'legacy_hub_role')||jsonb_build_object('access',hub.account_access(a));
end $$;

-- Preserve the existing identity proof and profile rules, adding only pinned copies.
do $migration$ declare definition text; original text;
begin
 definition:=pg_get_functiondef('hub.create_invite(jsonb)'::regprocedure); original:=definition;
 definition:=replace(definition,$old$ if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;$old$,
 $new$ if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p ? 'template' then
  if jsonb_typeof(p->'template') is distinct from 'object' or exists(select 1 from jsonb_object_keys(p->'template') k where k not in ('code','version'))
   or (p ? 'hub_role' and p->>'hub_role' is distinct from p#>>'{template,code}') then
   raise exception 'Invalid invite template' using errcode='23514',detail='invite_role_invalid'; end if;
  p:=p||jsonb_build_object('hub_role',p#>>'{template,code}');
 else p:=p||jsonb_build_object('template',jsonb_build_object('code',p->>'hub_role','version',1)); end if;
 if p ? 'tabs' or p ? 'can_manage_users' or not exists(select 1 from hub.permission_template
 where code=p#>>'{template,code}' and version=(p#>>'{template,version}')::integer) then
 raise exception 'Invalid invite template' using errcode='23514',detail='invite_role_invalid'; end if;$new$);
 definition:=replace(definition,'agency_code,created_by,created_at,expires_at)',
 'agency_code,created_by,created_at,expires_at,permission_template,permission_template_version)');
 definition:=replace(definition,$old$invited_at+interval '14 days') returning$old$,
 $new$invited_at+interval '14 days',p#>>'{template,code}',(p#>>'{template,version}')::integer) returning$new$);
 if definition=original or position('permission_template_version)' in definition)=0 then raise exception 'Invite create marker drift'; end if;
 execute definition;
 definition:=pg_get_functiondef('hub.match_account_invite()'::regprocedure); original:=definition;
 definition:=replace(definition,'''hub_role'',i.hub_role,''agency_code''',
 '''template'',jsonb_build_object(''code'',i.permission_template,''version'',i.permission_template_version),''hub_role'',i.hub_role,''agency_code''');
 if definition=original then raise exception 'Invite match marker drift'; end if; execute definition;
 definition:=pg_get_functiondef('hub.accept_account_invite(jsonb)'::regprocedure); original:=definition;
 definition:=replace(definition,'where id=actor returning * into a;',
 $new$where id=actor returning * into a;
 perform hub.write_account_access(actor,jsonb_build_object('tabs',hub.normalise_permission_tabs((select tabs from hub.permission_template
 where code=i.permission_template and version=i.permission_template_version)),'can_manage_users',false,
 'template',jsonb_build_object('code',i.permission_template,'version',i.permission_template_version),'customised',false),i.created_by,'INVITE_ACCEPT');
 select * into a from hub.user_account where id=actor;$new$);
 if definition=original then raise exception 'Invite accept marker drift'; end if; execute definition;
 definition:=pg_get_functiondef('hub.purge_rejected_accounts()'::regprocedure); original:=definition;
 definition:=replace(definition,'delete from hub.account_permission where account_id=a.id;',
 'delete from hub.permission_notice_ack where actor_id=a.id; delete from hub.account_permission where account_id=a.id;');
 -- Permission event notes and batched personal references follow the same retention.
 definition:=replace(definition,'set account_id=null,actor_id=null where account_id=a.id or actor_id=a.id;',
 'set account_id=null,actor_id=null,before_value=''{}'',after_value=''{}'' where account_id=a.id or actor_id=a.id;');
 if definition=original then raise exception 'Purge marker drift'; end if; execute definition;
end $migration$;

-- Preview is recomputed from server data. Its digest is a stale-review token,
-- never an authorization token; every entry point rechecks the live manager.
create function hub.permission_batch_preview(p jsonb) returns jsonb language plpgsql security definer
set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account; before_access jsonb; next_access jsonb; result jsonb; targets jsonb:='[]'; excluded jsonb:='[]';
 excluded_state jsonb:='[]'; ids uuid[]; total integer:=0; changes integer:=0; reason text; c hub.permission_catalog;
 selection jsonb:=p->'selection'; change jsonb:=p->'change'; digest text;
begin
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where k not in ('selection','change','note'))
 or length(coalesce(p->>'note',''))>2000 or jsonb_typeof(selection) is distinct from 'object' or jsonb_typeof(change) is distinct from 'object' then
 raise exception 'Invalid batch' using errcode='23514',detail='permission_combination'; end if;
 if selection->>'kind'='accounts' then
  if exists(select 1 from jsonb_object_keys(selection) k where k not in ('kind','account_ids'))
   or jsonb_typeof(selection->'account_ids') is distinct from 'array' then raise exception 'Account selection required' using errcode='23514',detail='permission_combination'; end if;
  if jsonb_array_length(selection->'account_ids') not between 1 and 100 then raise exception 'Select at most 100 accounts' using errcode='23514',detail='permission_combination'; end if;
  select array_agg(distinct value::uuid order by value::uuid) into ids from jsonb_array_elements_text(selection->'account_ids');
  if exists(select 1 from unnest(ids) chosen(account_id) where not exists(select 1 from hub.user_account u where u.id=chosen.account_id)) then raise exception 'Unknown account' using errcode='P0002'; end if;
 elsif selection->>'kind'='template' then
  if exists(select 1 from jsonb_object_keys(selection) k where k not in ('kind','code')) or not exists(select 1 from hub.permission_template where code=selection->>'code') then
   raise exception 'Template selection required' using errcode='23514',detail='permission_combination'; end if;
 elsif selection->>'kind'='team' then
  if exists(select 1 from jsonb_object_keys(selection) k where k not in ('kind','team')) or length(coalesce(selection->>'team','')) not between 1 and 200 then
   raise exception 'Team selection required' using errcode='23514',detail='permission_combination'; end if;
 else raise exception 'Unknown selection' using errcode='23514',detail='permission_combination'; end if;
 if change->>'kind'='template' then
  if exists(select 1 from jsonb_object_keys(change) k where k not in ('kind','template')) or change#>>'{template,code}'='agency' then
   raise exception 'Internal template required' using errcode='23514',detail='permission_combination'; end if;
  if jsonb_typeof(change->'template') is distinct from 'object' or exists(select 1 from jsonb_object_keys(change->'template') k where k not in ('code','version')) then
   raise exception 'Template required' using errcode='23514',detail='permission_combination'; end if;
  if not exists(select 1 from hub.permission_template where code=change#>>'{template,code}' and version=(change#>>'{template,version}')::integer) then
   raise exception 'Template version unavailable' using errcode='40001',detail='template_version_stale'; end if;
 elsif change->>'kind'='tab' then
  if exists(select 1 from jsonb_object_keys(change) k where k not in ('kind','tab','levels')) then
   raise exception 'Invalid tab assignment' using errcode='23514',detail='permission_combination'; end if;
  select * into c from hub.permission_catalog where tab=change->>'tab';
  if not found then raise exception 'Unknown permission tab' using errcode='23514',detail='permission_combination'; end if;
  if c.rollout_state<>'MIGRATED' then raise exception 'Tab editing is locked' using errcode='42501',detail='permission_locked'; end if;
  perform hub.normalise_permission_tabs(jsonb_build_object(c.tab,change->'levels'));
 else raise exception 'Unknown change' using errcode='23514',detail='permission_combination'; end if;
 for a in select * from hub.user_account u where
  (selection->>'kind'='accounts' and u.id=any(ids)) or
  (selection->>'kind'='template' and u.permission_template=selection->>'code') or
  (selection->>'kind'='team' and u.team=selection->>'team') order by u.id loop
  total:=total+1;
  if total>100 then raise exception 'Select at most 100 accounts' using errcode='23514',detail='permission_combination'; end if;
  reason:=case when a.id=hub.permission_actor() then 'self' when a.status<>'ACTIVE' then 'inactive'
   when a.hub_role not in ('viewer','editor','publisher','admin','online_staff') then 'external' end;
  if reason is not null then
   excluded:=excluded||jsonb_build_array(jsonb_build_object('account_id',a.id,'reason',reason));
   excluded_state:=excluded_state||jsonb_build_array(jsonb_build_object('account_id',a.id,'updated_at',a.updated_at,'status',a.status,'reason',reason));
   continue;
  end if;
  before_access:=hub.account_access(a);
  next_access:=hub.resolve_account_access(a,case when change->>'kind'='template' then jsonb_build_object('template',change->'template')
   else jsonb_build_object('tabs',hub.permission_rows(a.id)||jsonb_build_object(change->>'tab',change->'levels')) end);
  for c in select * from hub.permission_catalog loop
   if c.rollout_state<>'MIGRATED' and next_access#>array['tabs',c.tab] is distinct from before_access#>array['tabs',c.tab] then
    raise exception 'Tab editing is locked' using errcode='42501',detail='permission_locked'; end if;
  end loop;
  if before_access is distinct from next_access then changes:=changes+1; end if;
  targets:=targets||jsonb_build_array(jsonb_build_object('account_id',a.id,'updated_at',a.updated_at,
   'display_name_th',a.display_name_th,'email',a.email,'before',before_access,'after',next_access,'changed',before_access is distinct from next_access));
 end loop;
 result:=jsonb_build_object('catalog_digest',hub.permission_catalog_digest(),'targets',targets,'excluded',excluded,'change_count',changes);
 digest:=encode(sha256(convert_to(jsonb_build_array(hub.permission_actor(),p,result,excluded_state)::text,'UTF8')),'hex');
 return result||jsonb_build_object('digest',digest);
end $$;
revoke all on function hub.permission_batch_preview(jsonb) from public;

create function hub.preview_account_permissions(p jsonb) returns jsonb language plpgsql security definer
set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 return hub.permission_batch_preview(p);
end $$;
revoke all on function hub.preview_account_permissions(jsonb) from public;
grant execute on function hub.preview_account_permissions(jsonb) to hub_app;

create function hub.apply_account_permissions(p jsonb,expected_digest text) returns jsonb language plpgsql security definer
set search_path=pg_catalog,pg_temp as $$
declare preview jsonb; item jsonb; batch uuid:=gen_random_uuid(); items jsonb:='[]'; a hub.user_account; changed integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 preview:=hub.permission_batch_preview(p);
 perform 1 from hub.user_account where id in (select (x->>'account_id')::uuid
 from jsonb_array_elements((preview->'targets')||(preview->'excluded')) x) order by id for update;
 preview:=hub.permission_batch_preview(p);
 if expected_digest is distinct from preview->>'digest' then raise exception 'Permission preview changed' using errcode='40001',detail='permission_preview_stale'; end if;
 for item in select value from jsonb_array_elements(preview->'targets') loop
  if (item->>'changed')::boolean then
   if hub.write_account_access((item->>'account_id')::uuid,item->'after',hub.permission_actor(),
    case when p#>>'{change,kind}'='template' then 'TEMPLATE_APPLY' else 'BULK_TAB' end,p->>'note',batch) then changed:=changed+1; end if;
  end if;
  select * into a from hub.user_account where id=(item->>'account_id')::uuid;
  items:=items||jsonb_build_array(jsonb_build_object('account_id',a.id,'updated_at',a.updated_at,'access',hub.account_access(a)));
 end loop;
 return jsonb_build_object('batch_id',batch,'changed_count',changed,'items',items);
end $$;
revoke all on function hub.apply_account_permissions(jsonb,text) from public;
grant execute on function hub.apply_account_permissions(jsonb,text) to hub_app;

create function hub.ack_permission_notice(p_tab text,expected_catalog_digest text) returns jsonb language plpgsql security definer
set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.account_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if expected_catalog_digest is distinct from hub.permission_catalog_digest() then
  raise exception 'Permission catalog changed' using errcode='40001',detail='permission_preview_stale'; end if;
 if not exists(select 1 from hub.permission_catalog where tab=p_tab) then raise exception 'Unknown permission tab' using errcode='P0002'; end if;
 insert into hub.permission_notice_ack(actor_id,tab) values(hub.permission_actor(),p_tab) on conflict do nothing;
 if found then
  insert into hub.permission_event(account_id,actor_id,action,before_value,after_value)
  values(hub.permission_actor(),hub.permission_actor(),'NOTICE_ACK','{}',jsonb_build_object('tab',p_tab));
 end if;
 return jsonb_build_object('tab',p_tab,'acknowledged',true);
end $$;
revoke all on function hub.ack_permission_notice(text,text) from public;
grant execute on function hub.ack_permission_notice(text,text) to hub_app;

-- A pending request can join a team selection even though it is excluded from
-- access grants. Serialize its membership change and retention with batch review.
do $migration$ declare definition text; original text;
begin
 definition:=pg_get_functiondef('hub.submit_access_request(jsonb)'::regprocedure); original:=definition;
 definition:=replace(definition,'select * into a from hub.user_account where id=actor for update;',
 $new$perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 select * into a from hub.user_account where id=actor for update;$new$);
 if definition=original then raise exception 'Request lock marker drift'; end if; execute definition;
 definition:=pg_get_functiondef('hub.purge_rejected_accounts()'::regprocedure); original:=definition;
 definition:=replace(definition,$old$for a in select id from hub.user_account where status='REJECTED'$old$,
 $new$perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 for a in select id from hub.user_account where status='REJECTED'$new$);
 if definition=original then raise exception 'Purge lock marker drift'; end if; execute definition;
end $migration$;

commit;
