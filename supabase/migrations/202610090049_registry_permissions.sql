begin;

-- External scope is always read from the account, never a role/agency GUC.
create function hub.registry_agency() returns text
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select agency_code from hub.user_account
 where id=hub.permission_actor() and hub.can_agency_registry(agency_code)
$$;
create function hub.require_registry(level text,allow_agency boolean default false) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not (hub.can('registry',level) or (allow_agency and hub.registry_agency() is not null)) then
  raise exception 'Registry permission required' using errcode='42501';
 end if;
 return hub.permission_actor();
end $$;
revoke all on function hub.registry_agency(),hub.require_registry(text,boolean) from public;
grant execute on function hub.registry_agency(),hub.require_registry(text,boolean),hub.can_agency_registry(text)
 to hub_app,editor,publisher,viewer,admin,online_staff,agency,ads_registry_writer;
grant execute on function hub.can(text,text),hub.require_permission(text,text),hub.permission_actor() to ads_registry_writer;
grant execute on function hub.require_permission(text,text) to hub_app,online_staff;

-- Preserve business validation and the deployment-owned issuance switch.
do $$ declare f record; definition text; matched integer:=0;
begin
 for f in select oid,proname from pg_proc where pronamespace='ads'::regnamespace
 and proname=any(array['preview_scope','create_scope','preview_existing_scope','issue_registration','add_variant']) loop
  definition:=pg_get_functiondef(f.oid);
  if strpos(definition,'hub.require_actor(array[''admin'',''online_staff''])')=0 then raise exception 'Missing registry guard: %',f.proname; end if;
  execute replace(definition,'hub.require_actor(array[''admin'',''online_staff''])','hub.require_permission(''registry'',''edit'')');
  matched:=matched+1;
 end loop;
 if matched<>5 then raise exception 'Incomplete registry edit guards'; end if;
 select pg_get_functiondef('ads.bind_native(text,uuid,text,text,text)'::regprocedure) into definition;
 if strpos(definition,'hub.require_actor(array[''admin'',''online_staff'',''agency''])')=0 then raise exception 'Missing binding guard'; end if;
 definition:=replace(definition,'hub.require_actor(array[''admin'',''online_staff'',''agency''])','hub.require_registry(''edit'',true)');
 definition:=replace(definition,'(current_setting(''role'')<>''agency'' or agency=nullif(current_setting(''app.agency_code'',true),''''))',
  '(hub.can(''registry'',''edit'') or hub.can_agency_registry(agency))');
 definition:=replace(definition,'current_setting(''role'')=''agency''','hub.can_agency_registry(r.agency)');
 execute definition;
end $$;

create or replace function ads.registry_settings() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_registry('view',true);
 return jsonb_build_object('sena_h_approved',exists(select 1 from ads.setting where key='sena_h_approved' and value='true'::jsonb));
end $$;
-- Preserve the reviewed H1 settings variant as well as the local proconfig
-- implementation; this migration does not change either issuance mechanism.
do $$ declare source text; definer boolean;
begin
 select prosrc,prosecdef into source,definer from pg_proc where oid='ads.test_issuing_enabled()'::regprocedure;
 execute format('create or replace function ads.test_issuing_enabled() returns boolean language plpgsql stable %s set search_path=pg_catalog,pg_temp as %L',
  case when definer then 'security definer' else 'security invoker' end,
  'begin perform hub.require_registry(''view'',true); return ('||regexp_replace(source,';\s*$','')||'); end');
end $$;

-- Bounded technical startup proof, not a user-data read. H1 must start before
-- an account is approved. Expose only readiness, never configuration rows or
-- a role/permission override; the hosted profile is independently DB-proven.
create function hub.registry_startup_ready() returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select hub.hosted_test_profile() and
  (select count(*)=2 from ads.setting where key in ('sena_h_approved','hosted_test_issuing_enabled') and value='false'::jsonb)
$$;
revoke all on function hub.registry_startup_ready() from public;
grant execute on function hub.registry_startup_ready() to hub_app;

-- Operator-only stewardship: no application role or user-management flag can
-- invoke these functions. A supplied actor UUID is audit attribution only;
-- the operator's database connection/ACL is the authority.
revoke all on function ads.cancel_registration(text,text),ads.set_approval(boolean,text,text)
 from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer;
revoke insert,update on ads.vocab,ads.scope_code,ads.scope_member from admin;
do $$ declare f regprocedure; definition text;
begin
 foreach f in array array['ads.cancel_registration(text,text)'::regprocedure,'ads.set_approval(boolean,text,text)'::regprocedure] loop
  definition:=pg_get_functiondef(f);
  if strpos(definition,'actor:=hub.require_actor(array[''admin'']);')=0 then raise exception 'Missing stewardship guard'; end if;
  execute replace(definition,'actor:=hub.require_actor(array[''admin'']);',
   'actor:=hub.permission_actor(); if actor is null then raise exception ''Audit actor required'' using errcode=''42501''; end if;');
 end loop;
end $$;

-- A restrictive predicate remains effective alongside every old permissive
-- policy. Technical definer/export owners retain their existing narrow ACLs.
drop policy agency_vocab on ads.vocab;
drop policy agency_registration on ads.campaign_registration;
drop policy agency_names on ads.campaign_name;
drop policy agency_bindings on ads.native_binding;
drop policy agency_binding_check on ads.native_binding;
drop policy agency_scopes on ads.scope_code;
drop policy agency_members on ads.scope_member;
do $$ declare rule record;
begin
 for rule in select * from (values
  ('vocab','hub.can(''registry'',''view'') or (hub.registry_agency() is not null and status=''ACTIVE'' and vocab_type<>''BUD'')'),
  ('scope_code','hub.can(''registry'',''view'') or (hub.registry_agency() is not null and ((status=''ACTIVE'' and kind not in (''MULTI_PHASE'',''ZONE'')) or exists(select 1 from ads.campaign_registration r where r.scope_id=scope_code.scope_id and hub.can_agency_registry(r.agency))))'),
  ('scope_member','exists(select 1 from ads.scope_code s where s.scope_id=scope_member.scope_id)'),
  ('campaign_registration','hub.can(''registry'',''view'') or hub.can_agency_registry(agency)'),
  ('campaign_name','exists(select 1 from ads.campaign_registration r where r.code=campaign_name.code)'),
  ('native_binding','exists(select 1 from ads.campaign_registration r where r.code=native_binding.code)'),
  ('setting','hub.can(''registry'',''view'')'),
  ('code_sequence','false')
 ) as r(name,predicate) loop
  execute format('alter table ads.%I force row level security',rule.name);
  execute format('create policy registry_owner on ads.%I to %I using(true) with check(true)',rule.name,current_user);
  execute format('create policy registry_permission on ads.%I as restrictive to hub_app,editor,publisher,viewer,admin,online_staff,agency using(%s) with check(false)',rule.name,rule.predicate);
  if rule.name not in ('setting','code_sequence') then
   execute format('create policy registry_app_read on ads.%I for select to hub_app,agency using(true)',rule.name);
   execute format('grant select on ads.%I to hub_app',rule.name);
  end if;
 end loop;
end $$;
grant usage on schema ads to hub_app;
grant execute on function ads.sn_code(integer,integer),ads.scope_signature(jsonb),ads.active_vocab(text,text),
 ads.registry_settings(),ads.test_issuing_enabled(),ads.registration_detail(text),
 ads.preview_scope(text,text,text[]),ads.preview_existing_scope(uuid),ads.create_scope(text,text,text[]),
 ads.issue_registration(uuid,text,text,text,text,boolean),ads.add_variant(text,text),ads.bind_native(text,uuid,text,text,text) to hub_app;

commit;
