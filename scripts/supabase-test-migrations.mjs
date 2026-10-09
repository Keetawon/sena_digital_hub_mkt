import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const SOURCE = 'sena-hub-supabase-test-v2';
export const PROFILE = 'hosted-test-settings-v1';
export const PROJECT_REF = 'eqlrtevwpyboplljgowo';
const SCHEMAS = ['hub', 'public_api', 'staging', 'audit', 'internal', 'rag', 'ads', 'ads_export', 'hub_export'];
const ACTORS = ['editor', 'publisher', 'viewer', 'service_consumer', 'admin', 'online_staff', 'agency', 'hub_app'];
const RUNTIME_ROLES = ['hub_app'];
const MEMBERSHIP_CUTOFF = 52;
const OWNERS = ['ads_registry_writer', 'ads_export_owner', 'ads_export_reader', 'ads_finance_writer', 'ads_actuals_writer', 'ads_document_worker', 'hub_export_owner'];
const OWNER_SCHEMAS = {ads_registry_writer:['ads'],ads_export_owner:['ads_export'],ads_finance_writer:['ads'],ads_actuals_writer:['ads','staging'],hub_export_owner:['hub_export']};
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
  if (projectRef !== PROJECT_REF) fail('Only the approved dedicated TEST project is accepted.');
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

export async function loadMigrations(directory = new URL('../supabase/migrations/', import.meta.url), profileFile = new URL('../supabase/hosted-test/profile.json', import.meta.url)) {
  const profile = JSON.parse(await readFile(profileFile, 'utf8'));
  if (profile.profile !== PROFILE || profile.project_ref !== PROJECT_REF || profile.environment !== 'hosted-test') fail('Unexpected hosted TEST profile identity.');
  const names = (await readdir(directory)).filter(name => /^\d{12}_.+\.sql$/.test(name)).sort();
  if (names.length !== profile.migrations.length || names.some((name,index) => name !== profile.migrations[index].name || Number(name.slice(8,12)) !== index+1)) fail('Migration inventory changed; review and version the hosted profile.');
  return Promise.all(profile.migrations.map(async entry => {
    const canonical = await readFile(new URL(entry.name,directory),'utf8');
    const checksum = createHash('sha256').update(canonical).digest('hex');
    if (checksum !== entry.canonical_sha256) fail(`Canonical migration checksum changed: ${entry.name}.`);
    let sql=canonical;
    if (entry.variant) {
      if (entry.name !== '202609290014_ads_registry.sql' || entry.variant !== '202609290014_ads_registry.settings-v1.sql') fail('Unexpected migration variant.');
      sql=await readFile(new URL(entry.variant,profileFile),'utf8');
    }
    const executedChecksum=createHash('sha256').update(sql).digest('hex');
    if (executedChecksum !== entry.executed_sha256) fail(`Executed migration checksum changed: ${entry.name}.`);
    return {name:entry.name,checksum,executedChecksum,body:migrationBody(sql)};
  }));
}

export function verifyHistory(rows,migrations,projectRef) {
  if(rows.length>migrations.length) fail('Unexpected migration history.');
  rows.forEach((row,index)=>{
    const m=migrations[index];
    if(row.name!==m.name || row.checksum!==m.checksum || row.executed_checksum!==m.executedChecksum || row.project_ref!==projectRef || row.source!==SOURCE || row.profile!==PROFILE || row.environment!=='hosted-test') fail('Migration history is foreign, out of order, or its file checksum changed.');
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
  const rows = history.hub ? (await client.query(`select name,checksum,executed_checksum,project_ref,source,profile,environment from ${HISTORY} order by name`)).rows : [];
  verifyHistory(rows, migrations, config.projectRef);
  if (history.hub && !(await client.query('select 1 from hub_deployment.target where project_ref=$1 and source=$2 and profile=$3 and environment=$4',[config.projectRef,SOURCE,PROFILE,'hosted-test'])).rowCount) fail('Deployment target provenance does not match this TEST profile.');
  const count=rows.length;
  const expectedSchemas=count?SCHEMAS.slice(0,count>=27?9:count>=14?8:6):[];
  const actualSchemas=namespaces.map(row=>row.nspname).filter(name=>name!=='hub_deployment').sort();
  if(JSON.stringify(actualSchemas)!==JSON.stringify([...expectedSchemas].sort())) fail('Hub schemas do not match recorded migrations.');
  const expectedRoles=[...(count?ACTORS.slice(0,count>=6?5:4):[]),...(count>=14?['online_staff','agency','ads_registry_writer','ads_export_owner','ads_export_reader']:[]),...(count>=15?['ads_finance_writer']:[]),...(count>=16?['ads_actuals_writer']:[]),...(count>=22?['ads_document_worker']:[]),...(count>=27?['hub_export_owner']:[])];
  if(count>=47) expectedRoles.push('hub_app');
  if(count>=14) {
    const flags=(await client.query("select key,value from ads.setting where key in ('sena_h_approved','hosted_test_issuing_enabled') order by key")).rows;
    if(flags.length!==2 || flags.some(row=>row.value!==false)) fail('H1 requires both issuance flags false; runner never enables or resets flags.');
  }
  const { rows: roles } = await client.query('select rolname,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolinherit,rolcanlogin from pg_roles where rolname=any($1)', [ROLES]);
  for (const role of roles) {
    if (role.rolname === 'hub_runtime') {
      const knownUpgrade = [50,51].includes(count) && migrations.some(m => m.name === '202610090052_shared_permissions.sql')
        || count === 52 && migrations.some(m => m.name === '202610090053_account_permission_management.sql');
      if ((rows.length !== migrations.length && !knownUpgrade) || !history.hub) fail('Unexpected existing runtime login.');
    } else if (!expectedRoles.includes(role.rolname)) fail('Existing Hub role is not recorded by this deployment.');
    if (role.rolsuper || role.rolcreaterole || role.rolcreatedb || role.rolreplication || role.rolbypassrls || role.rolinherit || role.rolcanlogin !== (role.rolname === 'hub_runtime')) fail('Existing Hub role has unexpected privileges.');
  }
  if (expectedRoles.some(name => !roles.some(role => role.rolname === name))) fail('A recorded Hub role is missing.');
  if (roles.some(role => role.rolname === 'hub_runtime')) {
    const memberships = (await client.query("select r.rolname,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member='hub_runtime'::regrole")).rows;
    const allowedRuntime = count >= MEMBERSHIP_CUTOFF ? RUNTIME_ROLES : ACTORS;
    if (memberships.length !== allowedRuntime.length || memberships.some(row => !allowedRuntime.includes(row.rolname) || row.admin_option || row.inherit_option || !row.set_option)) fail('Runtime role memberships differ from the approved actor roles.');
    if (!(await client.query(`select 1 from hub_deployment.target where project_ref=$1 and source=$2 and runtime_ready`, [config.projectRef, SOURCE])).rowCount) fail('Existing runtime login lacks deployment provenance.');
  }
  return { rows, actor: actor.name, runtimeExists: roles.some(role => role.rolname === 'hub_runtime') };
}

export async function applyMigration(client,migration,config,actor) {
  await client.query('begin');
  const temporaryMemberships=new Map(), temporarySchemaGrants=[];
  try {
    await client.query("set local lock_timeout='15s'; set local statement_timeout='120s'; set local standard_conforming_strings=on");
    // New owner roles/schemas appear at different points in 0014/15/16/27. Apply the
    // reviewed statements in order and borrow only ownership-transfer privileges.
    for(const statement of migration.body) {
      const existing=(await client.query('select rolname from pg_roles where rolname=any($1)',[Object.keys(OWNER_SCHEMAS)])).rows.map(row=>row.rolname);
      for(const role of existing) {
        if(!temporaryMemberships.has(role)) {
          const previous=(await client.query('select m.admin_option,m.inherit_option,m.set_option from pg_auth_members m where m.roleid=$1::regrole and m.member=current_user::regrole and m.grantor=current_user::regrole',[role])).rows[0]??null;
          temporaryMemberships.set(role,previous);
          await client.query(`grant ${identifier(role)} to ${identifier(actor)} with inherit true,set true`);
        }
        for(const schema of OWNER_SCHEMAS[role]) {
          if(!(await client.query('select 1 from pg_namespace where nspname=$1',[schema])).rowCount) continue;
          if(!(await client.query('select has_schema_privilege($1,$2,\'CREATE\') as allowed',[role,schema])).rows[0].allowed) {
            await client.query(`grant create on schema ${identifier(schema)} to ${identifier(role)}`);
            temporarySchemaGrants.push([role,schema]);
          }
        }
      }
      await client.query(statement);
    }
    for(const [role,schema] of temporarySchemaGrants.reverse()) await client.query(`revoke create on schema ${identifier(schema)} from ${identifier(role)}`);
    for(const [role,previous] of temporaryMemberships) {
      if(previous) await client.query(`grant ${identifier(role)} to ${identifier(actor)} with admin ${previous.admin_option},inherit ${previous.inherit_option},set ${previous.set_option}`);
      else await client.query(`revoke ${identifier(role)} from ${identifier(actor)} granted by ${identifier(actor)}`);
    }
    await client.query(`insert into ${HISTORY}(name,checksum,executed_checksum,project_ref,source,profile,environment) values($1,$2,$3,$4,$5,$6,$7)`,[migration.name,migration.checksum,migration.executedChecksum,config.projectRef,SOURCE,PROFILE,'hosted-test']);
    await client.query('commit');
  } catch(error) {await client.query('rollback');throw error;}
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
  if(config.projectRef!==PROJECT_REF) fail('Only the approved dedicated TEST project is accepted.');
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
        create table if not exists ${HISTORY}(name text primary key,checksum text not null,executed_checksum text not null,project_ref text not null,source text not null,profile text not null,environment text not null,applied_at timestamptz not null default now());
        create table if not exists hub_deployment.target(project_ref text primary key,source text not null,profile text not null,environment text not null,runtime_ready boolean not null default false);
        revoke all on all tables in schema hub_deployment from public`);
      await client.query('insert into hub_deployment.target(project_ref,source,profile,environment) values($1,$2,$3,$4) on conflict do nothing', [config.projectRef,SOURCE,PROFILE,'hosted-test']);
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
        const allowedRuntime = migrations.length >= MEMBERSHIP_CUTOFF ? RUNTIME_ROLES : ACTORS;
        await client.query(`grant ${allowedRuntime.join(',')} to hub_runtime with admin false,inherit false,set true`);
        const { rows: [database] } = await client.query('select current_database() as name');
        await client.query(`grant connect on database ${identifier(database.name)} to hub_runtime`);
        await client.query('grant usage on schema hub to hub_runtime; grant execute on function hub.hosted_test_profile() to hub_runtime');
        await client.query('update hub_deployment.target set runtime_ready=true where project_ref=$1 and source=$2', [config.projectRef, SOURCE]);
        await client.query('commit');
      } catch (error) { await client.query('rollback'); throw error; }
    }
    await inspect(client, migrations, config);
    log(`Complete: ${migrations.length} canonical/executed checksums verified; runtime role provisioned. No fixtures, Auth users, or issuance override applied.`);
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
