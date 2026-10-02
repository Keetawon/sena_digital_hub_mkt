// Local TEST access only. Hosted credentials/provisioning require a separate approval.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

export const localTarget = Object.freeze({ host: '127.0.0.1', port: 55432, database: 'sena_hub_local' });
export const readerFile = new URL('../.local/dw-reader.json', import.meta.url);
export const exportViews = Object.freeze([
  'ad_account', 'campaign_name', 'campaign_registration', 'channel_account', 'correction',
  'cost_allocation', 'cost_record', 'line_assignment', 'media_line', 'memo',
  'memo_identifier', 'native_binding', 'recurring_commitment', 'scope_code', 'scope_member',
]);
export const hubExportViews = Object.freeze(['brand_published', 'project_published']);

async function readCredentialFile(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw error;
    // JSON.parse errors can quote source bytes from a malformed secret file.
    throw new Error('Cannot read local credential configuration');
  }
}

export function assertLocalTarget(target) {
  assert.equal(target.host, localTarget.host, 'DW reader is restricted to loopback TEST');
  assert.equal(target.port, localTarget.port, 'DW reader is restricted to the TEST port');
  assert.equal(target.database, localTarget.database, 'DW reader is restricted to the TEST database');
}

async function denied(client, sql, codes = ['42501']) {
  try { await client.query(sql); }
  catch (error) { assert.ok(codes.includes(error.code), 'Unexpected denial result'); return; }
  throw new Error('DW reader unexpectedly allowed a prohibited operation');
}

export async function verifyReader(credentials) {
  assertLocalTarget(credentials);
  assert.equal(credentials.username, 'dw_hub_reader');
  assert.equal(credentials.environment, 'local-test');
  const reader = new pg.Client({ ...localTarget, user: credentials.username, password: credentials.password, connectionTimeoutMillis: 5000 });
  try {
    await reader.connect();
    const identity = (await reader.query('select current_database() db, host(inet_server_addr()) host, inet_server_port() port, current_user username')).rows[0];
    assertLocalTarget({ ...identity, database: identity.db });
    assert.equal(identity.username, 'dw_hub_reader');
    const role = (await reader.query("select rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit from pg_roles where rolname=current_user")).rows[0];
    assert.deepEqual(role, { rolcanlogin: true, rolinherit: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolconnlimit: 2 });
    assert.deepEqual((await reader.query("select rolname from pg_roles where rolname<>current_user and pg_has_role(current_user,oid,'MEMBER') order by rolname")).rows.map(row => row.rolname), ['ads_export_reader']);
    assert.equal((await reader.query("select 1 from pg_auth_members where member=current_user::regrole and admin_option")).rowCount, 0);
    const unsafe = await reader.query(`
      select 1 from pg_class where relowner=current_user::regrole
      union all select 1 from pg_namespace where nspowner=current_user::regrole
      union all select 1 from pg_database where datdba=current_user::regrole
      union all select 1 from pg_proc where proowner=current_user::regrole
      union all select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('ads','staging','audit','hub','internal','rag','public_api') and c.relkind in ('r','p','v','m','f')
        and (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
      union all select 1 from pg_namespace where nspname in ('ads','staging','audit','hub','internal','rag','public_api')
        and has_schema_privilege(current_user,oid,'USAGE,CREATE')
      union all select 1 from pg_namespace where nspname in ('ads_export','hub_export') and has_schema_privilege(current_user,oid,'CREATE')
    `);
    assert.equal(unsafe.rowCount, 0, 'Unexpected reader ownership or private grants');
    assert.deepEqual((await reader.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='ads_export' and c.relkind='v' order by c.relname")).rows.map(row => row.relname), exportViews);
    assert.deepEqual((await reader.query("select viewname from pg_views where schemaname='hub_export' order by viewname")).rows.map(row => row.viewname), hubExportViews);
    assert.equal((await reader.query('show default_transaction_read_only')).rows[0].default_transaction_read_only, 'on');
    await reader.query('begin isolation level repeatable read read only');
    assert.equal((await reader.query('show transaction_read_only')).rows[0].transaction_read_only, 'on');
    for (const view of exportViews) await reader.query(`select * from ads_export.${view} limit 1`);
    for (const view of hubExportViews) await reader.query(`select * from hub_export.${view} limit 1`);
    await reader.query('commit');
    // Check both read-only defense and actual ACLs: the default is not an authorization boundary.
    await denied(reader, 'create table public.dw_reader_must_not_exist(id integer)', ['25006', '42501']);
    await reader.query('set default_transaction_read_only = off');
    const tables = (await reader.query("select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('ads','staging','audit','hub') and c.relkind in ('r','p') order by 1,2")).rows;
    assert.ok(tables.length > 0);
    for (const table of tables) {
      const ident = `${pg.escapeIdentifier(table.nspname)}.${pg.escapeIdentifier(table.relname)}`;
      await denied(reader, `select * from ${ident} limit 0`);
      await denied(reader, `delete from ${ident} where false`);
    }
    for (const view of exportViews) {
      const access = (await reader.query("select has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE') allowed", [`ads_export.${view}`])).rows[0];
      assert.equal(access.allowed, false, 'Reader has view write privileges');
      await denied(reader, `delete from ads_export.${view} where false`, ['42501', '55000']);
    }
    for (const view of hubExportViews) {
      assert.equal((await reader.query("select has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE') allowed", [`hub_export.${view}`])).rows[0].allowed, false);
      await denied(reader, `delete from hub_export.${view} where false`, ['42501', '55000']);
    }
    for (const role of ['admin', 'online_staff', 'agency', 'ads_export_owner', 'hub_export_owner', 'ads_finance_writer', 'ads_registry_writer']) {
      await denied(reader, `set role ${role}`);
    }
    await reader.query('set default_transaction_read_only = on');
  } finally { await reader.end(); }
}

export async function provisionDwReader({ rotate = false } = {}) {
  const config = await readCredentialFile(new URL('../.local/development.json', import.meta.url));
  // Do not accept connection URLs, CLI targets or environment-derived defaults.
  for (const key of Object.keys(localTarget)) if (key in config) assert.equal(config[key], localTarget[key], 'Unexpected local development target');
  let previous;
  try { previous = await readCredentialFile(readerFile); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous) {
    assertLocalTarget(previous);
    assert.equal(previous.username, 'dw_hub_reader');
    assert.equal(previous.environment, 'local-test');
    if (typeof previous.password !== 'string' || !/^[A-Za-z0-9_-]{32,}$/.test(previous.password)) throw new Error('Invalid local reader credential');
    assert.ok(Number.isFinite(Date.parse(previous.created_at)));
  }
  const credentials = {
    ...localTarget, username: 'dw_hub_reader',
    password: previous && !rotate ? previous.password : randomBytes(32).toString('base64url'),
    created_at: previous?.created_at ?? new Date().toISOString(), environment: 'local-test',
    ...(rotate ? { rotated_at: new Date().toISOString() } : previous?.rotated_at ? { rotated_at: previous.rotated_at } : {}),
  };
  const admin = new pg.Client({ ...localTarget, user: 'postgres', password: config.adminPassword, connectionTimeoutMillis: 5000 });
  let createdCredentialFile;
  try {
    await admin.connect();
    const server = (await admin.query('select current_database() as database,host(inet_server_addr()) host,inet_server_port() port')).rows[0];
    assertLocalTarget(server);
    await admin.query('begin');
    await admin.query("select pg_advisory_xact_lock(hashtext('local-dw-reader-provision'))");
    const exists = (await admin.query("select 1 from pg_roles where rolname='dw_hub_reader'")).rowCount;
    if (exists && !previous && !rotate) throw new Error('Existing reader has no local credential file; explicit rotation required');
    if (!exists) await admin.query('create role dw_hub_reader');
    const memberships = (await admin.query("select r.rolname from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member='dw_hub_reader'::regrole")).rows;
    assert.ok(memberships.every(row => row.rolname === 'ads_export_reader'), 'Unexpected reader membership; review before provisioning');
    await admin.query('alter role dw_hub_reader login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 2');
    await admin.query('grant ads_export_reader to dw_hub_reader with inherit true, set false');
    await admin.query('alter role dw_hub_reader set default_transaction_read_only = on');
    // PostgreSQL password DDL has no bind parameter; strictly generated/validated base64url only.
    if (!/^[A-Za-z0-9_-]{32,}$/.test(credentials.password)) throw new Error('Invalid local reader credential');
    await admin.query(`alter role dw_hub_reader password '${credentials.password}'`);
    if (!previous || rotate) {
      const target = previous ? new URL('dw-reader.json.tmp', readerFile) : readerFile;
      const handle = await open(target, 'wx', 0o600);
      createdCredentialFile = target;
      try { await handle.writeFile(`${JSON.stringify(credentials, null, 2)}\n`); }
      finally { await handle.close(); }
      if (previous) {
        await rename(target, readerFile);
        createdCredentialFile = undefined;
      }
    }
    await admin.query('commit');
    createdCredentialFile = undefined;
  } catch (error) {
    await admin.query('rollback').catch(() => {});
    // Only remove a file this invocation created successfully with exclusive open.
    // Never delete a pre-existing credential or another invocation's temporary file.
    if (createdCredentialFile) await unlink(createdCredentialFile).catch(() => {});
    throw error;
  } finally { await admin.end(); }
  await verifyReader(credentials);
  return fileURLToPath(readerFile);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.ok(process.argv.slice(2).every(arg => arg === '--rotate') && process.argv.length <= 3, 'Only --rotate is supported');
    console.log(await provisionDwReader({ rotate: process.argv.includes('--rotate') }));
  } catch (error) {
    // Never surface a pg error/query/config object that might contain a credential.
    const sqlState = ['ERROR', 'FATAL', 'PANIC'].includes(error?.severity)
      && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? ` (SQLSTATE ${error.code})` : '';
    console.error(`Local DW reader provisioning/verification failed${sqlState}; review local configuration and role permissions. No credentials printed.`);
    process.exitCode = 1;
  }
}
