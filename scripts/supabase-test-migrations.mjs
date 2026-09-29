import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const SOURCE = 'sena-hub-supabase-test-v1';
const SCHEMAS = ['hub', 'public_api', 'staging', 'audit', 'internal', 'rag', 'ads', 'ads_export'];
const ACTORS = ['editor', 'publisher', 'viewer', 'service_consumer', 'admin', 'online_staff', 'agency'];
const OWNERS = ['ads_registry_writer', 'ads_export_owner', 'ads_export_reader'];
const ROLES = [...ACTORS, ...OWNERS, 'hub_runtime'];
const HISTORY = 'hub_deployment.schema_migrations';
const LOCK = 1936027233;
class GuardError extends Error {}
const fail = message => { throw new GuardError(message); };
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => `'${value.replaceAll("'", "''")}'`;

export function configuration(env, args = []) {
  if (args.some((arg, i) => arg !== '--apply' && arg !== '--project-ref' && args[i - 1] !== '--project-ref')) fail('Unknown argument. Use --project-ref <ref> and optional --apply.');
  const projectRef = env.HUB_SUPABASE_TEST_PROJECT_REF;
  if (!projectRef || !/^[a-z]{20}$/.test(projectRef)) fail('Set HUB_SUPABASE_TEST_PROJECT_REF to the dedicated test project reference.');
  const namedRef = args[args.indexOf('--project-ref') + 1];
  if (!args.includes('--project-ref') || namedRef !== projectRef) fail('Provide --project-ref matching HUB_SUPABASE_TEST_PROJECT_REF.');
  const missing = ['HUB_SUPABASE_TEST_ADMIN_DATABASE_URL', 'HUB_SUPABASE_TEST_RUNTIME_PASSWORD'].filter(key => !env[key]);
  if (missing.length) fail(`Missing configuration: ${missing.join(', ')}. No connection attempted.`);
  let url;
  try { url = new URL(env.HUB_SUPABASE_TEST_ADMIN_DATABASE_URL); } catch { fail('Invalid admin database URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/postgres' || (url.port && url.port !== '5432') || url.hash) fail('Use the postgres database on port 5432 (direct or session pooler).');
  const direct = url.hostname === `db.${projectRef}.supabase.co` && url.username === 'postgres';
  const session = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && url.username === `postgres.${projectRef}`;
  if (!direct && !session) fail('Database host/user does not match the named Supabase test project.');
  if (!url.password) fail('The admin database URL needs its database password.');
  if ([...url.searchParams.keys()].some(key => key !== 'sslmode') || (url.searchParams.has('sslmode') && url.searchParams.get('sslmode') !== 'verify-full')) fail('Only sslmode=verify-full is accepted; use HUB_SUPABASE_TEST_SSL_CA_FILE for a CA file.');
  const runtimePassword = env.HUB_SUPABASE_TEST_RUNTIME_PASSWORD;
  if (!/^[A-Za-z0-9_-]{32,}$/.test(runtimePassword) || runtimePassword === decodeURIComponent(url.password)) fail('Use a separate random base64url runtime password of at least 32 characters.');
  url.search = ''; // pg connection-string SSL flags must never override verified TLS.
  return { projectRef, apply: args.includes('--apply'), runtimePassword, connectionString: url.href, caFile: env.HUB_SUPABASE_TEST_SSL_CA_FILE };
}

// Split only top-level SQL: bodies/comments/quoted text can contain semicolons.
export function statements(sql) {
  const result = [];
  let start = 0, i = 0, mode = '', depth = 0;
  while (i < sql.length) {
    if (mode === 'line') { if (sql[i] === '\n') mode = ''; i++; continue; }
    if (mode === 'block') {
      if (sql.slice(i, i + 2) === '/*') { depth++; i += 2; }
      else if (sql.slice(i, i + 2) === '*/') { if (--depth === 0) mode = ''; i += 2; }
      else i++;
      continue;
    }
    if (mode === "'" || mode === '"') {
      if (sql[i] === mode) { if (sql[i + 1] === mode) i += 2; else { mode = ''; i++; } }
      else i++;
      continue;
    }
    if (mode) { if (sql.startsWith(mode, i)) { i += mode.length; mode = ''; } else i++; continue; }
    if (sql.startsWith('--', i)) { mode = 'line'; i += 2; }
    else if (sql.startsWith('/*', i)) { mode = 'block'; depth = 1; i += 2; }
    else if (sql[i] === "'" || sql[i] === '"') { mode = sql[i++]; }
    else if (sql[i] === '$' && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i))) { mode = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)[0]; i += mode.length; }
    else if (sql[i] === ';') { result.push(sql.slice(start, ++i)); start = i; }
    else i++;
  }
  if (mode && mode !== 'line') fail('Unterminated SQL quote or comment.');
  if (withoutComments(sql.slice(start)).trim()) fail('SQL statement must end in a semicolon.');
  return result;
}
const withoutComments = sql => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\r\n]*/g, '').trim();

export function migrationBody(sql) {
  const parts = statements(sql);
  if (!/^begin\s*;$/i.test(withoutComments(parts[0] ?? '')) || !/^commit\s*;$/i.test(withoutComments(parts.at(-1) ?? ''))) fail('Migration must have exactly one outer BEGIN/COMMIT wrapper.');
  const body = parts.slice(1, -1);
  if (body.some(part => /^(begin|commit|rollback|savepoint|release|end|start\s+transaction|prepare\s+transaction|set\s+transaction)\b/i.test(withoutComments(part)))) fail('Nested transaction control is forbidden.');
  return body;
}

export async function loadMigrations(directory = new URL('../supabase/migrations/', import.meta.url)) {
  const names = (await readdir(directory)).filter(name => /^\d{12}_.+\.sql$/.test(name)).sort();
  if (names.length !== 14 || names.some((name, index) => Number(name.slice(8, 12)) !== index + 1)) fail('This runner is pinned to migrations 0001 through 0014 only.');
  return Promise.all(names.map(async name => {
    const sql = await readFile(new URL(name, directory), 'utf8');
    return { name, checksum: createHash('sha256').update(sql).digest('hex'), body: migrationBody(sql) };
  }));
}

export function verifyHistory(rows, migrations, projectRef) {
  if (rows.length > migrations.length) fail('Unexpected migration history.');
  rows.forEach((row, index) => {
    const migration = migrations[index];
    if (row.name !== migration.name || row.checksum !== migration.checksum || row.project_ref !== projectRef || row.source !== SOURCE) fail('Migration history is foreign, out of order, or its file checksum changed.');
  });
}

async function inspect(client, migrations, config) {
  const { rows: [actor] } = await client.query('select current_user as name, rolcreaterole, rolsuper, current_setting(\'server_version_num\')::integer as version from pg_roles where rolname=current_user');
  if (actor.version < 160000 || (!actor.rolcreaterole && !actor.rolsuper)) fail('Migration login requires PostgreSQL 16+ and CREATEROLE.');
  const { rows: namespaces } = await client.query('select nspname, pg_get_userbyid(nspowner) as owner from pg_namespace where nspname=any($1)', [[...SCHEMAS, 'hub_deployment']]);
  const { rows: [history] } = await client.query("select to_regclass('hub_deployment.schema_migrations') as hub, to_regclass('public.local_migrations') as local, to_regclass('supabase_migrations.schema_migrations') as supabase");
  if (history.local) fail('Local migration/fixture history detected. Refusing this target.');
  if (history.supabase && (await client.query('select 1 from supabase_migrations.schema_migrations limit 1')).rowCount) fail('Existing Supabase migration history requires explicit reconciliation.');
  if (namespaces.some(row => row.owner !== actor.name)) fail('Existing Hub schema has an unexpected owner.');
  if (!history.hub && namespaces.length) fail('Existing Hub schema has no trusted deployment history.');
  const rows = history.hub ? (await client.query(`select name,checksum,project_ref,source from ${HISTORY} order by name`)).rows : [];
  verifyHistory(rows, migrations, config.projectRef);
  if (rows.length < 14 && !(await client.query("select has_parameter_privilege(current_user,'app.ads_test_issuing','SET') as allowed")).rows[0].allowed) fail('Migration 0014 requires SET ON PARAMETER app.ads_test_issuing for the migration login. Ask the managed database administrator to grant that narrow privilege; this runner cannot self-elevate. No migration applied.');
  if (history.hub && !(await client.query('select 1 from hub_deployment.target where project_ref=$1 and source=$2', [config.projectRef, SOURCE])).rowCount) fail('Deployment target provenance does not match this test project.');
  const expectedSchemas = rows.length ? SCHEMAS.slice(0, rows.length === 14 ? 8 : 6) : [];
  const actualSchemas = namespaces.map(row => row.nspname).filter(name => name !== 'hub_deployment').sort();
  if (JSON.stringify(actualSchemas) !== JSON.stringify([...expectedSchemas].sort())) fail('Hub schemas do not match recorded migrations.');
  const expectedRoles = [...(rows.length ? ACTORS.slice(0, rows.length >= 6 ? 5 : 4) : []), ...(rows.length === 14 ? ['online_staff', 'agency', ...OWNERS] : [])];
  const { rows: roles } = await client.query('select rolname,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolinherit,rolcanlogin from pg_roles where rolname=any($1)', [ROLES]);
  for (const role of roles) {
    if (role.rolname === 'hub_runtime') {
      if (rows.length !== 14 || !history.hub) fail('Unexpected existing runtime login.');
    } else if (!expectedRoles.includes(role.rolname)) fail('Existing Hub role is not recorded by this deployment.');
    if (role.rolsuper || role.rolcreaterole || role.rolcreatedb || role.rolreplication || role.rolbypassrls || role.rolinherit || role.rolcanlogin !== (role.rolname === 'hub_runtime')) fail('Existing Hub role has unexpected privileges.');
  }
  if (expectedRoles.some(name => !roles.some(role => role.rolname === name))) fail('A recorded Hub role is missing.');
  if (roles.some(role => role.rolname === 'hub_runtime')) {
    const memberships = (await client.query("select r.rolname,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member='hub_runtime'::regrole")).rows;
    if (memberships.length !== ACTORS.length || memberships.some(row => !ACTORS.includes(row.rolname) || row.admin_option || row.inherit_option || !row.set_option)) fail('Runtime role memberships differ from the approved actor roles.');
    if (!(await client.query(`select 1 from hub_deployment.target where project_ref=$1 and source=$2 and runtime_ready`, [config.projectRef, SOURCE])).rowCount) fail('Existing runtime login lacks deployment provenance.');
  }
  return { rows, actor: actor.name, runtimeExists: roles.some(role => role.rolname === 'hub_runtime') };
}

export async function applyMigration(client, migration, config, actor) {
  await client.query('begin');
  try {
    await client.query("set local lock_timeout='15s'; set local statement_timeout='120s'; set local standard_conforming_strings=on");
    const isRegistry = migration.name.startsWith('202609290014_');
    let memberships = [];
    if (isRegistry) {
      if (!/^create schema ads\s*;$/i.test(withoutComments(migration.body[0])) || !/^create schema ads_export\s*;$/i.test(withoutComments(migration.body[1])) || !/^do\s+\$\$/i.test(withoutComments(migration.body[4]))) fail('Registry bootstrap prefix changed; review required.');
      await client.query(migration.body.slice(0, 5).join('\n'));
      memberships = (await client.query('select r.rolname,m.admin_option,m.inherit_option,m.set_option,pg_get_userbyid(m.grantor) as grantor from pg_auth_members m join pg_roles r on r.oid=m.roleid where r.rolname=any($1) and m.member=current_user::regrole', [['ads_registry_writer', 'ads_export_owner']])).rows;
      await client.query(`grant ads_registry_writer,ads_export_owner to ${identifier(actor)} with inherit true,set true`);
      await client.query('grant create on schema ads to ads_registry_writer; grant create on schema ads_export to ads_export_owner');
      await client.query(migration.body.slice(5).join('\n'));
      await client.query('revoke create on schema ads from ads_registry_writer; revoke create on schema ads_export from ads_export_owner');
      for (const role of ['ads_registry_writer', 'ads_export_owner']) {
        const previous = memberships.find(row => row.rolname === role && row.grantor === actor);
        if (previous) await client.query(`grant ${role} to ${identifier(actor)} with inherit ${previous.inherit_option},set ${previous.set_option}`);
        else await client.query(`revoke ${role} from ${identifier(actor)} granted by ${identifier(actor)}`);
      }
    } else await client.query(migration.body.join('\n'));
    await client.query(`insert into ${HISTORY}(name,checksum,project_ref,source) values($1,$2,$3,$4)`, [migration.name, migration.checksum, config.projectRef, SOURCE]);
    await client.query('commit');
  } catch (error) { await client.query('rollback'); throw error; }
}

function scramVerifier(password) {
  const salt = randomBytes(16), iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const stored = createHash('sha256').update(clientKey).digest('base64');
  const server = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${stored}:${server}`;
}

export async function runMigrations(client, config, { log = console.log, migrations } = {}) {
  migrations ??= await loadMigrations();
  let locked = false;
  try {
    if (config.apply) {
      const { rows: [lock] } = await client.query('select pg_try_advisory_lock($1) as acquired', [LOCK]);
      if (!lock.acquired) fail('Another Hub deployment holds the migration lock.');
      locked = true;
    }
    const state = await inspect(client, migrations, config);
    log(`${config.apply ? 'Apply' : 'Dry-run'}: ${config.projectRef}; ${state.rows.length} applied, ${migrations.length - state.rows.length} pending migrations.`);
    for (const migration of migrations.slice(state.rows.length)) log(`Pending: ${migration.name}`);
    if (!config.apply) { log('Read-only preflight complete. No schemas, roles, migrations, or fixtures changed.'); return; }
    await client.query('begin');
    try {
      await client.query(`create schema if not exists hub_deployment; revoke all on schema hub_deployment from public;
        create table if not exists ${HISTORY}(name text primary key,checksum text not null,project_ref text not null,source text not null,applied_at timestamptz not null default now());
        create table if not exists hub_deployment.target(project_ref text primary key,source text not null,runtime_ready boolean not null default false);
        revoke all on all tables in schema hub_deployment from public`);
      await client.query('insert into hub_deployment.target(project_ref,source) values($1,$2) on conflict do nothing', [config.projectRef, SOURCE]);
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; }
    for (const migration of migrations.slice(state.rows.length)) {
      await applyMigration(client, migration, config, state.actor);
      log(`Applied: ${migration.name}`);
    }
    if (!state.runtimeExists) {
      await client.query('begin');
      try {
        // Only a SCRAM verifier enters SQL/server statement logs, never plaintext.
        await client.query(`create role hub_runtime login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password ${literal(scramVerifier(config.runtimePassword))}`);
        await client.query(`grant ${ACTORS.join(',')} to hub_runtime with admin false,inherit false,set true`);
        const { rows: [database] } = await client.query('select current_database() as name');
        await client.query(`grant connect on database ${identifier(database.name)} to hub_runtime`);
        await client.query('update hub_deployment.target set runtime_ready=true where project_ref=$1 and source=$2', [config.projectRef, SOURCE]);
        await client.query('commit');
      } catch (error) { await client.query('rollback'); throw error; }
    }
    await inspect(client, migrations, config);
    log('Complete: 14 migration checksums verified; runtime role provisioned. No fixtures, Auth users, or test-issuing override applied.');
  } finally { if (locked) await client.query('select pg_advisory_unlock($1)', [LOCK]); }
}

export function safeError(error) {
  // Database errors may include SQL, values or a connection string: print codes only.
  if (error.code) return `Database/connection operation failed (${/^[A-Z0-9_]{2,40}$/.test(error.code) ? error.code : 'unclassified'}). No credentials logged.`;
  return error instanceof GuardError ? error.message : 'Operation failed. Error details withheld to protect connection credentials.';
}

export function requireVerifiedTls(client) {
  // pg_stat_ssl describes the pooler's backend connection, not this TLS socket.
  // pg supplies the target hostname as SNI; rejectUnauthorized remains true.
  const socket = client.connection?.stream;
  if (socket?.encrypted !== true || socket.authorized !== true) fail('Verified TLS is required.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let client;
  try {
    const config = configuration(process.env, process.argv.slice(2));
    const ssl = { rejectUnauthorized: true, ...(config.caFile ? { ca: await readFile(config.caFile, 'utf8') } : {}) };
    client = new pg.Client({ connectionString: config.connectionString, ssl, connectionTimeoutMillis: 15000, application_name: SOURCE });
    await client.connect();
    requireVerifiedTls(client);
    await runMigrations(client, config);
  } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
  finally { if (client) await client.end().catch(() => {}); }
}
