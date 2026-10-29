import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import {assertNoAuthWrites} from './auth-write-check.mjs';
import {protectedPostflight,protectedReadOnlySnapshot} from './auth-protection.mjs';

export const SOURCE = 'sena-hub-supabase-test-v2';
export const PROFILE = 'hosted-test-settings-v1';
export const PROJECT_REF = 'eqlrtevwpyboplljgowo';
const SCHEMAS = ['hub', 'public_api', 'staging', 'audit', 'internal', 'rag', 'ads', 'ads_export', 'hub_export'];
const ACTORS = ['editor', 'publisher', 'viewer', 'service_consumer', 'admin', 'online_staff', 'agency', 'hub_app'];
const RUNTIME_ROLES = ['hub_app'];
const MEMBERSHIP_CUTOFF = 52;
const OWNERS = ['ads_registry_writer', 'ads_export_owner', 'ads_export_reader', 'ads_finance_writer', 'ads_actuals_writer', 'ads_document_worker', 'hub_export_owner'];
const OWNER_SCHEMAS = {ads_registry_writer:['ads'],ads_export_owner:['ads_export'],ads_finance_writer:['ads'],ads_actuals_writer:['ads','staging'],hub_export_owner:['hub_export']};
const ROLES = [...ACTORS, ...OWNERS, 'hub_translation_worker','hub_media_worker','hub_runtime','hub_media_worker_login'];
const HISTORY = 'hub_deployment.schema_migrations';
const LOCK = 1936027233;
const CONTENT_RELEASE_HOLD = 79;
class GuardError extends Error {}
const fail = message => { throw new GuardError(message); };
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => `'${value.replaceAll("'", "''")}'`;

function requireCombinedContentRelease(client, migrations) {
  if (!migrations.some(m => Number(/^\d{8}(\d{4})_/.exec(m.name)?.[1] ?? 0) >= CONTENT_RELEASE_HOLD)) return;
  // H5d: hard hold until the complete H5a 79/80 release admission is implemented.
  // The existing disposable H1 simulation remains local; no env flag bypasses it.
  const c = client.connectionParameters, socket = client.connection?.stream;
  if (c?.host === '127.0.0.1' && Number(c.port) === 55434 && c.database === 'hub_hosted_test_simulation'
      && socket?.remoteAddress === '127.0.0.1') return;
  fail('Migrations 79 and later are held for the complete combined H5a release; no standalone hosted apply is allowed.');
}

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
  const mediaWorkerPassword=env.HUB_SUPABASE_TEST_MEDIA_WORKER_PASSWORD;
  if(mediaWorkerPassword&&(!/^[A-Za-z0-9_-]{32,}$/.test(mediaWorkerPassword)||[runtimePassword,decodeURIComponent(url.password)].includes(mediaWorkerPassword)))fail('Invalid dedicated media worker password.');
  return { projectRef, apply: args.includes('--apply'), runtimePassword, mediaWorkerPassword, connectionString: url.href, caFile: env.HUB_SUPABASE_TEST_SSL_CA_FILE };
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
  const localSimulation=client.connectionParameters?.host==='127.0.0.1'&&Number(client.connectionParameters?.port)===55434&&client.connectionParameters?.database==='hub_hosted_test_simulation'&&client.connection?.stream?.remoteAddress==='127.0.0.1';
  if(count===79&&!localSimulation)fail('Standalone hosted migration 79 detected; the combined release is required.');
  const expectedSchemas=count?SCHEMAS.slice(0,count>=27?9:count>=14?8:6):[];
  const actualSchemas=namespaces.map(row=>row.nspname).filter(name=>name!=='hub_deployment').sort();
  if(JSON.stringify(actualSchemas)!==JSON.stringify([...expectedSchemas].sort())) fail('Hub schemas do not match recorded migrations.');
  const expectedRoles=[...(count?ACTORS.slice(0,count>=6?5:4):[]),...(count>=14?['online_staff','agency','ads_registry_writer','ads_export_owner','ads_export_reader']:[]),...(count>=15?['ads_finance_writer']:[]),...(count>=16?['ads_actuals_writer']:[]),...(count>=22?['ads_document_worker']:[]),...(count>=27?['hub_export_owner']:[])];
  if(count>=47) expectedRoles.push('hub_app');
  if(count>=60) expectedRoles.push('hub_translation_worker');
  if(count>=64) expectedRoles.push('hub_media_worker');
  if(count>=14) {
    const flags=(await client.query("select key,value from ads.setting where key in ('sena_h_approved','hosted_test_issuing_enabled') order by key")).rows;
    if(flags.length!==2 || flags.some(row=>row.value!==false)) fail('H1 requires both issuance flags false; runner never enables or resets flags.');
  }
  const { rows: roles } = await client.query('select rolname,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolinherit,rolcanlogin,rolconnlimit from pg_roles where rolname=any($1)', [ROLES]);
  const unapprovedLogins=(await client.query("select rolname from pg_roles where rolcanlogin and rolname like 'hub\\_%' escape '\\' and rolname<>current_user and rolname not in ('hub_runtime','hub_media_worker_login')")).rows;
  if(unapprovedLogins.length)fail('Unapproved Hub login role.');
  for (const role of roles) {
    if (role.rolname === 'hub_runtime') {
      const knownUpgrade = [50,51].includes(count) && migrations.some(m => m.name === '202610090052_shared_permissions.sql')
        || count === 52 && migrations.some(m => m.name === '202610090053_account_permission_management.sql')
        || count === 53 && migrations.some(m => m.name === '202610150054_public_website_drafts.sql')
        || count === 54 && migrations.some(m => m.name === '202610150055_r2_test_content.sql')
        || count === 55 && migrations.some(m => m.name === '202610190056_project_progress_projection_once.sql')
        // Owner H1/H2, 27 October: reviewed content rollout and business-sheet
        // intake. Recovery still requires an exact canonical/checksum prefix.
        || count >= 56 && count < migrations.length && (
          migrations.length === 76 && migrations.at(-1).name === '202610230076_web_publication.sql'
          || migrations.length === 77 && migrations.at(-1).name === '202610270077_business_sheet_snapshot.sql'
          || migrations.length === 78 && migrations.at(-1).name === '202610270078_website_content_suggestions.sql'
          || migrations.length === 79 && migrations.at(-1).name === '202610280079_media_provider_budget.sql'
          || migrations.length === 80 && migrations.at(-1).name === '202610280080_media_image_worker.sql');
      if ((rows.length !== migrations.length && !knownUpgrade) || !history.hub) fail('Unexpected existing runtime login.');
    } else if(role.rolname==='hub_media_worker_login') {
      if(count!==80||role.rolconnlimit!==2||!(await client.query("select to_regclass('hub_deployment.media_worker_provision') is not null present")).rows[0].present)fail('Unrecorded media worker login.');
      if(!(await client.query("select 1 from hub_deployment.media_worker_provision where role_name='hub_media_worker_login' and project_ref=$1 and source='h5e_combined_release'",[PROJECT_REF])).rowCount)fail('Worker login lacks approved provenance.');
    } else if (!expectedRoles.includes(role.rolname)) fail('Existing Hub role is not recorded by this deployment.');
    if (role.rolsuper || role.rolcreaterole || role.rolcreatedb || role.rolreplication || role.rolbypassrls || role.rolinherit || role.rolcanlogin !== ['hub_runtime','hub_media_worker_login'].includes(role.rolname)) fail('Existing Hub role has unexpected privileges.');
  }
  if (expectedRoles.some(name => !roles.some(role => role.rolname === name))) fail('A recorded Hub role is missing.');
  if (roles.some(role => role.rolname === 'hub_runtime')) {
    const memberships = (await client.query("select r.rolname,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member='hub_runtime'::regrole")).rows;
    const allowedRuntime = count >= MEMBERSHIP_CUTOFF ? RUNTIME_ROLES : ACTORS;
    if (memberships.length !== allowedRuntime.length || memberships.some(row => !allowedRuntime.includes(row.rolname) || row.admin_option || row.inherit_option || !row.set_option)) fail('Runtime role memberships differ from the approved actor roles.');
    if (!(await client.query(`select 1 from hub_deployment.target where project_ref=$1 and source=$2 and runtime_ready`, [config.projectRef, SOURCE])).rowCount) fail('Existing runtime login lacks deployment provenance.');
  }
  if(count>=64&&(await client.query("select pg_has_role('hub_runtime','hub_media_worker','SET') allowed")).rows[0].allowed)fail('API runtime can assume media worker.');
  if(roles.some(role=>role.rolname==='hub_media_worker_login')){
    const memberships=(await client.query("select r.rolname,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member='hub_media_worker_login'::regrole")).rows;
    if(memberships.length!==1||memberships[0].rolname!=='hub_media_worker'||memberships[0].admin_option||memberships[0].inherit_option||!memberships[0].set_option)fail('Worker login membership changed.');
    if((await client.query("select 1 from pg_roles where rolname=any($1) and rolname not in ('hub_media_worker','hub_media_worker_login') and pg_has_role('hub_media_worker_login',oid,'SET')",[ROLES])).rowCount)fail('Worker login can assume another Hub role.');
  }
  return { rows, actor: actor.name, runtimeExists: roles.some(role => role.rolname === 'hub_runtime') };
}

async function applyMigrationStatements(client,migration,config,actor) {
  if(Number(migration.name.slice(8,12))>=80)assertNoAuthWrites(migration.body.join('\n'));
  if([79,80].includes(Number(migration.name.slice(8,12)))){
    // These two Hub-only migrations transfer no object ownership; borrow no role.
    await client.query("set local lock_timeout='15s'; set local statement_timeout='120s'; set local standard_conforming_strings=on");
    for(const statement of migration.body)await client.query(statement);
    await client.query(`insert into ${HISTORY}(name,checksum,executed_checksum,project_ref,source,profile,environment) values($1,$2,$3,$4,$5,$6,$7)`,[migration.name,migration.checksum,migration.executedChecksum,config.projectRef,SOURCE,PROFILE,'hosted-test']);
    return;
  }
  const temporaryMemberships=new Map(), temporarySchemaGrants=[];
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
}

export async function applyMigration(client,migration,config,actor) {
  if(Number(migration.name.slice(8,12))>=80)assertNoAuthWrites(migration.body.join('\n'));
  requireCombinedContentRelease(client,[migration]);
  await client.query('begin');
  try {
    await applyMigrationStatements(client,migration,config,actor);
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

export function mediaWorkerLoginStatements(password,database) {
 if(!/^[A-Za-z0-9_-]{32,}$/.test(password??''))fail('Dedicated random worker password required.');
 return [
  `create role hub_media_worker_login login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 2 password ${literal(scramVerifier(password))}`,
  'grant hub_media_worker to hub_media_worker_login with admin false,inherit false,set true',
  `grant connect on database ${identifier(database)} to hub_media_worker_login`,
  'create table hub_deployment.media_worker_provision(role_name text primary key,project_ref text not null,source text not null)',
  'revoke all on hub_deployment.media_worker_provision from public',
  `insert into hub_deployment.media_worker_provision values('hub_media_worker_login',${literal(PROJECT_REF)},'h5e_combined_release')`,
 ];
}

export const COMBINED_COMPONENTS=Object.freeze([
 'supabase/migrations/202610280079_media_provider_budget.sql','supabase/migrations/202610280080_media_image_worker.sql',
 'apps/api/sena_hub_api/image_broker.py','apps/api/sena_hub_api/hosted_media_worker.py','apps/api/sena_hub_api/media_worker.py',
 'apps/admin/components/media-ai-button.tsx','apps/admin/components/media-ai-text.ts',
 'scripts/hosted-test/sena-hub-test-media-worker.service','scripts/hosted-test/sena-hub-test-image-broker.socket','scripts/hosted-test/60-image-broker.conf',
]);

export function validateCombinedManifest(manifest,gates,candidate) {
 if(manifest?.project_ref!==PROJECT_REF||manifest.release_kind!=='H5a_H5c_H5e_79_80'||!/^[a-f0-9]{7}-media-[a-f0-9]{12}$/.test(manifest.release??'')||candidate?.project_ref!==PROJECT_REF
  ||candidate.status!=='passed'||candidate.release!==manifest.release||candidate.linux_build!==true||candidate.private_socket_only!==true||candidate.native_broker_checks_passed!==true
  ||candidate.api_worker_variables_absent!==true||candidate.media_key_present!==false)fail('Complete combined-release readiness required.');
 if(gates?.status!=='passed'||gates.provider_calls!==0||![gates.api,gates.ui,gates.db].every(Number.isInteger)||gates.api<2132||gates.ui<302||gates.db<62||gates.h1_browser!==45
  ||gates.typecheck!==true||gates.offline_build!==true||gates.populated_upgrade!==true||gates.credential_matches!==0)fail('Complete passing release gates required.');
 if(!/^[a-f0-9]{64}$/.test(manifest.gates_sha256??'')||candidate.gates_sha256!==manifest.gates_sha256)fail('Candidate and gates must have one source seal.');
 for(const file of COMBINED_COMPONENTS)if(!/^[a-f0-9]{64}$/.test(gates.sources?.[file]??'')||candidate.components?.[file]!==gates.sources[file])fail('Combined-release component missing or changed.');
 if(gates.sources[COMBINED_COMPONENTS[0]]!=='a439a8af79b26280ace573c084bac71433513b8474fc1b059c1b71f2c0fa2a91')fail('Frozen migration 79 changed.');
}

async function protectedReceipt(file,parent) {
 const absolute=path.resolve(file??''),allowed=path.resolve(parent)+path.sep;
 if(!absolute.startsWith(allowed)||await realpath(absolute)!==absolute)fail('Receipt must be a real file in its approved ignored directory.');
 const raw=await readFile(absolute);return {raw,value:JSON.parse(raw)};
}
async function combinedReadiness(manifestFile,backupFile) {
 const {value:manifest}=await protectedReceipt(manifestFile,'.local/hosted-content-rollout');
 const gate=await protectedReceipt(manifest.gates_receipt,'.local/hosted-content-rollout');
 const {value:candidate}=await protectedReceipt(manifest.candidate_receipt,'.local/hosted-content-rollout');
 if(createHash('sha256').update(gate.raw).digest('hex')!==manifest.gates_sha256)fail('Release gate receipt changed.');
 validateCombinedManifest(manifest,gate.value,candidate);
 for(const [file,hash] of Object.entries(gate.value.sources)){
  if(path.isAbsolute(file)||file.split(/[\\/]/).includes('..')||file.startsWith('.local')||/(^|\/)\.env/.test(file))fail('Invalid release source path.');
  if(createHash('sha256').update(await readFile(file)).digest('hex')!==hash)fail('Tested source changed before hosted release.');
 }
 const {value:backup}=await protectedReceipt(backupFile,'.local/backups');
 const dump=path.resolve(backup.path??'');
 if(!dump.startsWith(path.resolve('.local/backups')+path.sep)||await realpath(dump)!==dump||backup.target!==PROJECT_REF
  ||backup.status!=='verified'||!backup.full_archive_read_verified||!backup.inventory_verified
  ||!Number.isFinite(Date.parse(backup.verified_at))||Date.now()-Date.parse(backup.verified_at)>15*60*1000||Date.parse(backup.verified_at)>Date.now())fail('Fresh verified TEST backup required.');
 if(createHash('sha256').update(await readFile(dump)).digest('hex')!==backup.sha256)fail('Verified backup changed.');
 const {raw:baselineRaw,value:baseline}=await protectedReceipt('.local/hosted-content-rollout/h5h-protected-baseline.json','.local/hosted-content-rollout');
 if(manifest.h5h_baseline_sha256!==createHash('sha256').update(baselineRaw).digest('hex'))fail('H5h baseline changed.');
 return {manifest,baseline,backup};
}

// Generic --apply and applyMigration still hard-refuse 79. Only this complete,
// separately attested bundle can commit 79 and 80, in one database transaction.
export async function applyCombinedContentRelease(client,config,{manifestFile,backupFile}={}) {
 if(config.projectRef!==PROJECT_REF||config.apply!==true)fail('Explicit approved TEST write required.');
 requireVerifiedTls(client);
 const {manifest,baseline,backup}=await combinedReadiness(manifestFile,backupFile),migrations=await loadMigrations();
 if(migrations.length!==80)fail('Only the exact 79/80 combined release is admitted.');
 const locked=(await client.query('select pg_try_advisory_lock($1) acquired',[LOCK])).rows[0].acquired;
 if(!locked)fail('Another Hub deployment holds the migration lock.');
 try{
  const state=await inspect(client,migrations,config);
  if(backup.applied_migrations!==state.rows.length||backup.operation!=='combined_schema')fail('Backup must precede this exact schema batch.');
  const before=await protectedReadOnlySnapshot(client,baseline);if(before.status!=='passed')fail('Strict protected preflight failed.');
  if(state.rows.length===80)return {status:'already_applied',release:manifest.release,before};
  if(state.rows.length!==78)fail('Combined release requires the exact applied prefix 1-78.');
  await client.query('begin isolation level serializable');
  try{
   for(const migration of migrations.slice(78))await applyMigrationStatements(client,migration,config,state.actor);
   const after=await protectedPostflight(client,baseline);if(after.status!=='passed')fail('Strict protected state changed during the combined release.');
   await client.query('commit');return {status:'applied',release:manifest.release,migrations:migrations.slice(78).map(m=>m.name),before,after};
  }catch(error){await client.query('rollback');throw error;}
 }finally{await client.query('select pg_advisory_unlock($1)',[LOCK]);}
}

export async function provisionMediaWorkerLogin(client,config,{manifestFile,backupFile}={}) {
 if(config.projectRef!==PROJECT_REF||config.apply!==true||!config.mediaWorkerPassword)fail('Dedicated worker password must be in the existing approved configuration.');
 requireVerifiedTls(client);
 const {baseline,backup}=await combinedReadiness(manifestFile,backupFile),migrations=await loadMigrations();
 const state=await inspect(client,migrations,config);
 if(state.rows.length!==80)fail('Worker login requires the complete recorded 79/80 release.');
 if(backup.applied_migrations!==80||backup.operation!=='media_worker_login')fail('A separate verified post-schema backup is required for worker provisioning.');
 const before=await protectedReadOnlySnapshot(client,baseline);if(before.status!=='passed')fail('Strict protected preflight failed.');
 if((await client.query("select 1 from pg_roles where rolname='hub_media_worker_login'")).rowCount)return {status:'already_applied',before};
 await client.query('begin isolation level serializable');
 try{
  if(!(await client.query('select pg_try_advisory_xact_lock($1) acquired',[LOCK])).rows[0].acquired)fail('Another Hub deployment holds the migration lock.');
  const database=(await client.query('select current_database() name')).rows[0].name;
  for(const statement of mediaWorkerLoginStatements(config.mediaWorkerPassword,database))await client.query(statement);
  await inspect(client,migrations,config);
  const after=await protectedPostflight(client,baseline);if(after.status!=='passed')fail('Strict protected state changed during worker provisioning.');
  await client.query('commit');return {status:'applied',before,after};
 }catch(error){await client.query('rollback');throw error;}
}

export async function runMigrations(client, config, { log = console.log, migrations } = {}) {
  if(config.projectRef!==PROJECT_REF) fail('Only the approved dedicated TEST project is accepted.');
  migrations ??= await loadMigrations();
  if(config.apply) requireCombinedContentRelease(client,migrations);
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
