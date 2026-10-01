-- Local TEST login contract. Run after scripts/provision-dw-reader.mjs.
-- The administrator connection is intentional: the real-login verifier also checks
-- login defaults and SET ROLE denial. SET ROLE alone does not load role defaults.
-- No application rows are inserted, changed or deleted; the transaction rolls back.
begin read write;

do $$
declare
  reader pg_roles%rowtype;
  memberships text[];
  relation record;
begin
  select * into reader from pg_roles where rolname = 'dw_hub_reader';
  if not found then
    raise exception 'Provision the local DW reader with npm run dev:dw-reader first';
  end if;
  if not reader.rolcanlogin or not reader.rolinherit or reader.rolsuper
    or reader.rolcreatedb or reader.rolcreaterole or reader.rolreplication
    or reader.rolbypassrls or reader.rolconnlimit <> 2 then
    raise exception 'Unsafe dw_hub_reader attributes';
  end if;
  if not coalesce('default_transaction_read_only=on' = any(reader.rolconfig), false) then
    raise exception 'DW login does not default to read-only transactions';
  end if;

  select array_agg(r.rolname::text order by r.rolname) into memberships
  from pg_roles r
  where r.oid <> reader.oid and pg_has_role(reader.oid, r.oid, 'MEMBER');
  if memberships is distinct from array['ads_export_reader']::text[] then
    raise exception 'DW login has unexpected direct or inherited role membership';
  end if;
  if exists(select 1 from pg_auth_members where member = reader.oid and admin_option) then
    raise exception 'DW login can grant its role membership';
  end if;
  if exists(select 1 from pg_database where datdba = reader.oid)
    or exists(select 1 from pg_namespace where nspowner = reader.oid)
    or exists(select 1 from pg_class where relowner = reader.oid)
    or exists(select 1 from pg_proc where proowner = reader.oid) then
    raise exception 'DW login unexpectedly owns database objects';
  end if;
  if exists(select 1 from pg_roles where rolname in ('ads_export_reader', 'ads_export_owner')
    and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
    raise exception 'Unsafe export group or view-owner attributes';
  end if;

  -- Check effective ACLs, including column-only grants and PUBLIC privileges.
  for relation in
    select c.oid, n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('ads', 'hub', 'staging', 'audit', 'internal', 'rag')
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    if has_table_privilege(reader.oid, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(reader.oid, relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception 'DW login has private relation privileges: %.%', relation.nspname, relation.relname;
    end if;
  end loop;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('ads', 'hub', 'staging', 'audit', 'internal', 'rag', 'public_api')
      and p.prosecdef and has_schema_privilege(reader.oid, n.oid, 'USAGE')
      and has_function_privilege(reader.oid, p.oid, 'EXECUTE')
  ) then
    raise exception 'DW login can invoke an application SECURITY DEFINER function';
  end if;
end $$;

set local role dw_hub_reader;
-- User-settable defaults are not a security boundary. The checks below run in
-- READ WRITE and must still be denied by privileges, without relying on RLS data.
set local default_transaction_read_only = off;

do $$
declare
  expected_views constant text[] := array[
    'ad_account', 'campaign_name', 'campaign_registration', 'channel_account',
    'correction', 'cost_allocation', 'cost_record', 'line_assignment',
    'media_line', 'memo', 'memo_identifier', 'native_binding',
    'recurring_commitment', 'scope_code', 'scope_member'
  ];
  actual_views text[];
  view_name text;
  private_schema text;
  relation record;
begin
  if current_user <> 'dw_hub_reader' or current_setting('transaction_read_only') <> 'off' then
    raise exception 'ACL probes did not run as the DW reader in a read-write transaction';
  end if;
  select array_agg(c.relname::text order by c.relname) into actual_views
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'ads_export' and c.relkind = 'v';
  if actual_views is distinct from expected_views then
    raise exception 'The frozen P1/P2 contract must contain exactly 15 expected views';
  end if;
  foreach view_name in array expected_views loop
    execute format('select * from ads_export.%I limit 1', view_name);
    if has_table_privilege(format('ads_export.%I', view_name), 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'DW login has a write privilege on export view %', view_name;
    end if;
  end loop;
  foreach private_schema in array array['ads', 'hub', 'staging', 'audit', 'internal', 'rag', 'public_api'] loop
    if has_schema_privilege(private_schema, 'USAGE,CREATE') then
      raise exception 'DW login has private schema privileges: %', private_schema;
    end if;
  end loop;
  if has_schema_privilege('ads_export', 'CREATE') then
    raise exception 'DW login can create export objects';
  end if;

  for relation in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('ads', 'hub', 'staging', 'audit') and c.relkind in ('r', 'p')
  loop
    begin
      execute format('select * from %I.%I where false', relation.nspname, relation.relname);
      raise exception 'DW login accessed private table %.%', relation.nspname, relation.relname;
    exception when insufficient_privilege then null;
    end;
  end loop;

  begin
    update ads_export.campaign_registration set status = status where false;
    raise exception 'DW login can UPDATE an export view';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from ads_export.campaign_registration where false;
    raise exception 'DW login can DELETE from an export view';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into ads_export.campaign_registration select * from ads_export.campaign_registration where false;
    raise exception 'DW login can INSERT into an export view';
  exception when insufficient_privilege then null;
  end;
  begin
    update ads.setting set value = value where false;
    raise exception 'DW login can UPDATE a private table';
  exception when insufficient_privilege then null;
  end;
  begin
    perform ads.finance_read('memos');
    raise exception 'DW login can read private finance RPCs';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: DW reader attributes, sole membership, 15 export views, private table/column/RPC isolation and write denial with read-only disabled';
end $$;

reset role;
rollback;
