begin;

-- Accounts, shared references and published feeds use identity from the Hub row.
-- Grid editing remains locked until the Accounts UI integration is complete.
create or replace function hub.account_admin() returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from hub.user_account where id=hub.permission_actor()
 and status='ACTIVE' and can_manage_users and hub_role in ('viewer','editor','publisher','admin','online_staff'))
$$;

do $migration$ declare f record; definition text;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='hub' and p.proname in ('permission_projection','account_identity','save_account_permissions') loop
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'active and a.can_manage_users and a.hub_role=''admin''','active and a.can_manage_users');
  definition:=replace(definition,'a.status=''ACTIVE'' and a.can_manage_users and a.hub_role=''admin''',
   'a.status=''ACTIVE'' and a.can_manage_users and a.hub_role in (''viewer'',''editor'',''publisher'',''admin'',''online_staff'')');
  definition:=replace(definition,$old$ if manage and a.hub_role<>'admin' then
  raise exception 'Legacy administration ceiling' using errcode='42501',detail='permission_locked'; end if;$old$,'');
  execute definition;
 end loop;
end $migration$;

-- Bounded projections, not raw account or Registry table grants to the app.
create function hub.account_directory() returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.account_admin() then raise exception 'Account administration required' using errcode='42501'; end if;
 return jsonb_build_object('actor_id',hub.permission_actor(),
  'items',(select coalesce(jsonb_agg(to_jsonb(a)-'legacy_hub_role' order by created_at desc),'[]') from hub.user_account a),
  'events',(select coalesce(jsonb_agg(to_jsonb(e) order by created_at desc),'[]') from hub.user_account_event e),
  'agencies',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'label_th',label_th) order by code),'[]')
   from ads.vocab where vocab_type='AGENCY' and status='ACTIVE' and alias_of is null
    and (active_from is null or active_from<=(now() at time zone 'Asia/Bangkok')::date)
    and (active_to is null or active_to>=(now() at time zone 'Asia/Bangkok')::date)));
end $$;
revoke all on function hub.account_directory() from public;
grant execute on function hub.account_directory() to hub_app;

create function hub.finance_references() returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('finance','view');
 return jsonb_build_object(
  'vocab',(select coalesce(jsonb_agg(jsonb_build_object('vocab_type',vocab_type,'code',code,'label_th',label_th,'can_use',true)
   order by vocab_type,code),'[]') from ads.vocab where vocab_type in ('BUD','AGENCY') and status='ACTIVE' and alias_of is null
    and (active_from is null or active_from<=(now() at time zone 'Asia/Bangkok')::date)
    and (active_to is null or active_to>=(now() at time zone 'Asia/Bangkok')::date)),
  'scopes',(select coalesce(jsonb_agg(jsonb_build_object('scope_id',scope_id,'scope_code',scope_code,'label_th',label_th,'can_use',true)
   order by scope_code,scope_id),'[]') from ads.scope_code where status='ACTIVE' and kind in ('GROUP','PHASE','ZONE','BRAND','CORP','BU')));
end $$;
revoke all on function hub.finance_references() from public;
grant execute on function hub.finance_references() to hub_app;

create function hub.require_public_reader() returns uuid language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.permission_actor();
begin
 if not exists(select 1 from hub.user_account where id=actor and status='ACTIVE'
 and hub_role in ('viewer','editor','publisher','admin','online_staff','service_consumer')) then
  raise exception 'Published reader required' using errcode='42501';
 end if;
 return actor;
end $$;
revoke all on function hub.require_public_reader() from public;
grant execute on function hub.require_public_reader(),hub.residential_environment(),hub.residential_local() to hub_app;

create function public_api.read_projects() returns setof public_api.projects language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin perform hub.require_public_reader(); return query select * from public_api.projects; end $$;
create function public_api.read_brands() returns setof public_api.brands language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin perform hub.require_public_reader(); return query select * from public_api.brands; end $$;
create function public_api.read_promotions() returns setof public_api.promotions language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin perform hub.require_public_reader(); return query select * from public_api.promotions; end $$;
revoke all on function public_api.read_projects(),public_api.read_brands(),public_api.read_promotions() from public;
grant usage on schema public_api to hub_app;
grant execute on function public_api.read_projects(),public_api.read_brands(),public_api.read_promotions(),public_api.asset_file(uuid) to hub_app,service_consumer;
do $migration$ declare definition text;
begin
 definition:=pg_get_functiondef('public_api.asset_file(uuid)'::regprocedure);
 if strpos(definition,'hub.require_actor(array[''service_consumer''])')=0 then raise exception 'Missing published asset guard'; end if;
 execute replace(definition,'hub.require_actor(array[''service_consumer''])','hub.require_public_reader()');
end $migration$;

-- Own request and verified-identity operations still validate the actor/status
-- themselves. They do not require ACTIVE status before email approval.
grant execute on function hub.account_identity(text,text,text),hub.submit_access_request(jsonb),hub.accept_account_invite(jsonb),
 hub.account_display_names(),hub.account_admin(),hub.permission_catalog_read(),hub.save_account_permissions(uuid,jsonb,boolean,timestamptz),
 hub.list_account_invites(),hub.create_invite(jsonb),hub.change_invite(uuid,text,timestamptz),
 hub.decide_account(uuid,text,text,text,text,timestamptz) to hub_app;

-- Technical owners need explicit policies once owner bypass is disabled.
-- No human/app direct grant is added for these source or personal-data tables.
do $$ declare relation text;
begin
 foreach relation in array array['audit.change_log','hub.asset_roles','staging.ads_scope_import','staging.dw_project_groups',
 'staging.dw_projects','staging.intake_batches','staging.project_group_evidence','staging.project_intake_evidence',
 'staging.project_intake_receipts','staging.rem_brands','staging.rem_companies','staging.rem_models','staging.rem_projects',
 'hub.user_account','hub.user_account_event','hub.account_invite'] loop
  execute format('alter table %s enable row level security',relation);
  execute format('create policy shared_owner on %s to %I using(true) with check(true)',relation,current_user);
  execute format('alter table %s force row level security',relation);
 end loop;
end $$;
create policy actuals_audit_clock on audit.change_log for select to ads_actuals_writer using(true);
revoke select on hub.asset_roles from hub_app;

-- ETL and worker execution is a technical/operator boundary, outside the grid.
-- The operator ACL proves authority; actor_id is attribution only.
do $migration$ declare f record; definition text;
begin
 -- These Registry functions belong to their private technical owner. Retain
 -- only the operator's exact entry points after migration memberships close.
 execute format('grant execute on function ads.cancel_registration(text,text),ads.set_approval(boolean,text,text) to %I',current_user);
 for f in select p.oid,p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='ads' and p.proname in ('actuals_current_snapshot','apply_ads_actuals') loop
  definition:=pg_get_functiondef(f.oid);
  if strpos(definition,'hub.require_actor(array[''admin''])')=0 then raise exception 'Missing ETL guard'; end if;
  if f.proname='apply_ads_actuals' then
   definition:=replace(definition,'actor:=hub.require_actor(array[''admin'']);',
    'actor:=hub.permission_actor(); if actor is null then raise exception ''Operator actor required'' using errcode=''42501''; end if;');
  else
   definition:=replace(definition,'perform hub.require_actor(array[''admin'']);',
    'if hub.permission_actor() is null then raise exception ''Operator actor required'' using errcode=''42501''; end if;');
  end if;
  execute definition;
  execute format('revoke all on function %s from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer',f.signature);
  execute format('grant execute on function %s to %I',f.signature,current_user);
 end loop;
 for f in select p.oid,p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='ads' and p.proname in ('archive_claim','archive_heartbeat','archive_finish') loop
  definition:=pg_get_functiondef(f.oid);
  if strpos(definition,'hub.require_actor(array[''admin'',''ads_document_worker''])')=0 then raise exception 'Missing worker guard'; end if;
  execute replace(definition,'hub.require_actor(array[''admin'',''ads_document_worker''])','hub.require_actor(array[''ads_document_worker''])');
  execute format('revoke all on function %s from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer',f.signature);
 end loop;
end $migration$;
grant execute on function hub.permission_actor() to ads_actuals_writer;

-- PostgreSQL's global default EXECUTE grant must be revoked globally for each
-- creator; a schema-only REVOKE cannot remove the built-in PUBLIC default.
alter default privileges revoke execute on functions from public;
do $$ declare owner_name text; namespace text;
begin
 foreach owner_name in array array['ads_registry_writer','ads_finance_writer','ads_actuals_writer','ads_export_owner','hub_export_owner'] loop
  execute format('alter default privileges for role %I revoke execute on functions from public',owner_name);
 end loop;
 foreach namespace in array array['hub','ads','staging','audit','internal','rag','public_api','ads_export','hub_export'] loop
  execute format('revoke create on schema %I from public,hub_app',namespace);
 end loop;
 if exists(select 1 from pg_roles where rolname='hub_runtime') then
  revoke editor,publisher,viewer,admin,online_staff,agency,service_consumer from hub_runtime;
 end if;
end $$;
commit;
