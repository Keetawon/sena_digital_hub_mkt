import assert from 'node:assert/strict';
import { test } from 'node:test';
import {readFile} from 'node:fs/promises';
import {rehearseWorkspaceMigrations} from '../scripts/supabase-test-migrations.mjs';
import { applyMigration, applyCombinedContentRelease, COMBINED_COMPONENTS, configuration, loadMigrations, mediaWorkerLoginStatements, migrationBody, operatorDiagnostic, requireVerifiedTls, runMigrations, safeError, statements, validateCombinedManifest, verifyHistory } from '../scripts/supabase-test-migrations.mjs';

const ref = 'eqlrtevwpyboplljgowo';
const env = {
  HUB_SUPABASE_TEST_PROJECT_REF: ref,
  HUB_SUPABASE_TEST_ADMIN_DATABASE_URL: `postgresql://postgres:secret@db.${ref}.supabase.co:5432/postgres?sslmode=verify-full`,
  HUB_SUPABASE_TEST_RUNTIME_PASSWORD: 'x'.repeat(40),
};
const args = ['--project-ref', ref];

test('workspace rehearsal rejects hosted and working databases before issuing SQL',async()=>{
 for(const connectionParameters of [
  {host:`db.${ref}.supabase.co`,port:5432,database:'postgres'},
  {host:'127.0.0.1',port:55432,database:'sena_hub_local'},
  {host:'127.0.0.1',port:55432,database:'hub_hosted_test_simulation'},
  {host:'127.0.0.1',port:55433,database:'another_database'},
 ]){
  const queries=[],client={connectionParameters,query:async sql=>queries.push(sql)};
  await assert.rejects(rehearseWorkspaceMigrations(client,{projectRef:ref,apply:true},{}),/Disposable H1 loopback/);
  assert.deepEqual(queries,[]);
 }
});

test('default is dry-run with an explicitly named matching project and verified TLS config', () => {
  const config = configuration(env, args);
  assert.equal(config.apply, false);
  assert.equal(config.projectRef, ref);
  assert.equal(new URL(config.connectionString).search, '');
  assert.equal(configuration(env, [...args, '--apply']).apply, true);
  assert.equal(configuration({ ...env, HUB_SUPABASE_TEST_SSL_CA_FILE: 'certificate.crt' }, args).caFile, 'certificate.crt');
});

test('allows only the matching direct host or session pooler username on port 5432', () => {
  const url = `postgresql://postgres.${ref}:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
  assert.equal(configuration({ ...env, HUB_SUPABASE_TEST_ADMIN_DATABASE_URL: url }, args).projectRef, ref);
  for (const bad of [
    url.replace(':5432', ':6543'),
    url.replace(ref, 'z'.repeat(20)),
    url.replace('supabase.com', 'supabase.com.attacker.example'),
    env.HUB_SUPABASE_TEST_ADMIN_DATABASE_URL.replace(`db.${ref}`, 'db.' + 'z'.repeat(20)),
    env.HUB_SUPABASE_TEST_ADMIN_DATABASE_URL.replace('verify-full', 'require'),
    env.HUB_SUPABASE_TEST_ADMIN_DATABASE_URL + '&sslrootcert=system',
    env.HUB_SUPABASE_TEST_ADMIN_DATABASE_URL.replace('/postgres?', '/other?'),
    env.HUB_SUPABASE_TEST_ADMIN_DATABASE_URL.replace('postgres:secret', 'postgres'),
  ]) assert.throws(() => configuration({ ...env, HUB_SUPABASE_TEST_ADMIN_DATABASE_URL: bad }, args));
});

test('rejects missing keys, wrong confirmation, local credentials and weak runtime password', () => {
  assert.throws(() => configuration(env, []), /--project-ref/);
  assert.throws(() => configuration(env, ['--project-ref', 'z'.repeat(20)]), /matching/);
  assert.throws(() => configuration({ ...env, HUB_SUPABASE_TEST_ADMIN_DATABASE_URL: '' }, args), /Missing configuration/);
  assert.throws(() => configuration({ ...env, HUB_SUPABASE_TEST_ADMIN_DATABASE_URL: 'postgres://postgres:secret@127.0.0.1:55432/postgres' }, args));
  assert.throws(() => configuration({ ...env, HUB_SUPABASE_TEST_RUNTIME_PASSWORD: 'short' }, args));
  assert.throws(() => configuration(env, [...args, '--reset']), /Unknown argument/);
});

test('SQL scanner preserves quoted bodies and strips only the outer transaction', () => {
  const sql = `-- wrapper\nbegin; /* ; nested /* ; */ comment */ create table a(x text);\ndo $function$ begin perform 'COMMIT; ''quote'''; /* ; */ end $function$; commit;`;
  assert.equal(statements(sql).length, 4);
  const parts = migrationBody(sql);
  assert.equal(parts.length, 2);
  assert.match(parts[1], /COMMIT;/);
  for (const bad of ['begin; create table a(x int);', 'begin; commit; commit;', 'begin; rollback; commit;', 'create table a(x int);', "begin; select 'unterminated; commit;"]) assert.throws(() => migrationBody(bad));
});

test('all 91 canonical migrations and explicit variant parse and foreign/modified/gapped history fails', async () => {
  const migrations = await loadMigrations();
  assert.equal(migrations.length,91);
  assert.equal(migrations.at(-1).name,'202611110091_writing_aid.sql');
  assert.notEqual(migrations[13].checksum,migrations[13].executedChecksum);
  assert.equal(migrations.filter(m=>m.checksum!==m.executedChecksum).length,1);
  const rows = migrations.map(m => ({ name: m.name, checksum:m.checksum,executed_checksum:m.executedChecksum,project_ref:ref,source:'sena-hub-supabase-test-v2',profile:'hosted-test-settings-v1',environment:'hosted-test' }));
  verifyHistory(rows, migrations, ref);
  verifyHistory(rows.slice(0, 5), migrations, ref);
  for (const bad of [rows.slice(1), [{ ...rows[0], checksum: 'changed' }], [{ ...rows[0], project_ref: 'z'.repeat(20) }], [{ ...rows[0], source: 'local' }]]) assert.throws(() => verifyHistory(bad, migrations, ref));
});

test('connection and SQL errors never expose supplied secrets or SQL', () => {
  const secret = env.HUB_SUPABASE_TEST_ADMIN_DATABASE_URL;
  assert.doesNotMatch(safeError(Object.assign(new Error(secret), { code: '28P01', detail: secret })), /secret|postgresql/);
  assert.doesNotMatch(safeError(new Error(secret)), /secret|postgresql/);
  assert.match(safeError(Object.assign(new Error(secret), { code: 'ECONNREFUSED' })), /ECONNREFUSED/);
});

test('operator diagnostics keep failure location, cause and status without values', () => {
  const error=Object.assign(new Error('postgresql://private:credential@host/db'),{code:'42501',detail:'private-request'});
  const result=operatorDiagnostic(error,{step:'promotion/ai_state',httpStatus:403,apiErrorCode:'forbidden',missingResponseKeys:['data']});
  assert.deepEqual(result,{step:'promotion/ai_state',exception_class:'Error',sqlstate:'42501',code:'42501',http_status:403,api_error_code:'forbidden',missing_response_keys:['data']});
  assert.doesNotMatch(JSON.stringify(result),/postgresql|credential|private-request/);
  assert.equal(operatorDiagnostic(new Error('wrapper',{cause:error}),{step:'lifespan'}).sqlstate,'42501');
  assert.equal(JSON.parse(safeError(error,{step:'backup'})).step,'backup');
  const wrapped=Object.assign(new Error('child raw output withheld'),{diagnostic:{...result,exception_class:'InsufficientPrivilegeError',message:'private-request',headers:{authorization:'private-token'}}});
  assert.equal(operatorDiagnostic(wrapped).sqlstate,'42501');
  assert.equal(operatorDiagnostic(wrapped).exception_class,'InsufficientPrivilegeError');
  assert.equal(operatorDiagnostic(wrapped).http_status,403);
  assert.doesNotMatch(safeError(wrapped),/private-request|private-token|headers/);
});

test('H5d refuses canonical 79 through both hosted apply entry points before any SQL', async () => {
  const migrations=await loadMigrations(),queries=[];
  for(const connectionParameters of [undefined,{host:`db.${ref}.supabase.co`,port:5432,database:'postgres'},
    {host:'127.0.0.1',port:55434,database:'postgres'}]) {
    const client={connectionParameters,connection:{stream:{remoteAddress:'127.0.0.1'}},query:async sql=>queries.push(sql)};
    await assert.rejects(runMigrations(client,{...configuration(env,args),apply:true},{migrations,log:()=>{}}),/combined H5a release/);
    await assert.rejects(applyMigration(client,migrations[78],configuration(env,args),'unused'),/combined H5a release/);
  }
  assert.deepEqual(queries,[]);
});

test('combined admission requires all components, matching gates and key-absent Linux readiness',()=>{
  const sources=Object.fromEntries(COMBINED_COMPONENTS.map(file=>[file,'a'.repeat(64)]));
  sources[COMBINED_COMPONENTS[0]]='a439a8af79b26280ace573c084bac71433513b8474fc1b059c1b71f2c0fa2a91';
  sources[COMBINED_COMPONENTS[1]]='5d2992b87b2e2ca64af39f874704248b90322cef507ef569e4dc8e9a26fdab0d';
  const manifest={project_ref:ref,release_kind:'H5a_H5c_H5e_H5i_79_80_81',release:'aaaaaaa-media-aaaaaaaaaaaa',gates_sha256:'b'.repeat(64),
    attestations:{combined_schema:{sha256:'c'.repeat(64)},media_worker_login:{sha256:'d'.repeat(64)}}};
  const gates={status:'passed',provider_calls:0,api:2132,ui:302,db:62,h1_browser:45,typecheck:true,offline_build:true,populated_upgrade:true,credential_matches:0,sources};
  const candidate={status:'passed',project_ref:ref,release:manifest.release,gates_sha256:manifest.gates_sha256,
    linux_build:true,private_socket_only:true,native_broker_checks_passed:true,api_worker_variables_absent:true,media_key_present:false,components:{...sources}};
  assert.doesNotThrow(()=>validateCombinedManifest(manifest,gates,candidate));
  for(const key of ['api','ui','db','status','typecheck','provider_calls']){
    const bad=structuredClone(gates);delete bad[key];assert.throws(()=>validateCombinedManifest(manifest,bad,candidate));
  }
  for(const file of COMBINED_COMPONENTS){const bad=structuredClone(candidate);delete bad.components[file];assert.throws(()=>validateCombinedManifest(manifest,gates,bad));}
  for(const key of ['linux_build','private_socket_only','native_broker_checks_passed','api_worker_variables_absent'])assert.throws(()=>validateCombinedManifest(manifest,gates,{...candidate,[key]:false}));
  assert.throws(()=>validateCombinedManifest({...manifest,release_kind:'79_only'},gates,candidate));
  assert.throws(()=>validateCombinedManifest(manifest,gates,{...candidate,media_key_present:true}));
});

test('missing combined proof and Auth-writing migration 80 issue no SQL',async()=>{
  const queries=[],client={connection:{stream:{encrypted:true,authorized:true}},query:async sql=>queries.push(sql)};
  await assert.rejects(applyCombinedContentRelease(client,{...configuration(env,args),apply:true}),/Receipt/);
  await assert.rejects(applyMigration(client,{name:'202610280080_media_image_worker.sql',body:['UPDATE auth.users SET role=1;']},configuration(env,args),'unused'),/Auth write rejected/);
  assert.deepEqual(queries,[]);
});

test('worker bootstrap has exact bounded grants and only a SCRAM verifier enters SQL',()=>{
  const password='x'.repeat(43),sql=mediaWorkerLoginStatements(password,'postgres');
  assert.equal(sql.length,6);assert.ok(sql.every(s=>!s.includes(password)));
  assert.match(sql[0],/login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 2 password 'SCRAM-SHA-256\$/);
  assert.equal(sql[1],'grant hub_media_worker to hub_media_worker_login with admin false,inherit false,set true');
  assert.equal(sql[2],'grant connect on database "postgres" to hub_media_worker_login');
  assert.ok(!sql.some(s=>/grant (?:hub_app|admin|editor|publisher|viewer|hub_translation_worker)\b/.test(s)));
  assert.throws(()=>mediaWorkerLoginStatements('short','postgres'));
});

test('TLS guard checks the verified client socket when using a pooler', () => {
  requireVerifiedTls({ connection: { stream: { encrypted: true, authorized: true } } });
  for (const stream of [{}, { encrypted: true }, { encrypted: true, authorized: false }, { encrypted: false, authorized: true }]) {
    assert.throws(() => requireVerifiedTls({ connection: { stream } }), /Verified TLS/);
  }
  assert.throws(() => requireVerifiedTls({}), /Verified TLS/);
});


test('0014 variant changes only the reviewed setting/issuance mechanism', async()=>{
 const canonical=await readFile(new URL('../supabase/migrations/202609290014_ads_registry.sql',import.meta.url),'utf8');
 let variant=await readFile(new URL('../supabase/hosted-test/202609290014_ads_registry.settings-v1.sql',import.meta.url),'utf8');
 const functionBody=(sql,name)=>sql.slice(sql.indexOf(`create function ads.${name}(`),sql.indexOf('$$;',sql.indexOf(`create function ads.${name}(`))+3);
 for(const name of ['require_issuance','test_issuing_enabled']) variant=variant.replace(functionBody(variant,name),()=>functionBody(canonical,name));
 variant=variant.replace(/-- Hosted TEST settings profile v1[^\n]*\n-- Only the issuance[^\n]*\n/,'-- P1 only: SENA-H naming registry. No budget, memo, PO or public API objects.\n');
 variant=variant.replace("check(key in ('sena_h_approved','hosted_test_issuing_enabled'))","check(key='sena_h_approved')");
 variant=variant.replace("values('sena_h_approved','false','Pending pattern-owner approval'),\n('hosted_test_issuing_enabled','false','H1 issuance disabled; deployment operator only');","values('sena_h_approved','false','Pending pattern-owner approval');");
 variant=variant.replace(/-- Profile-only permissions:[\s\S]*?(?=create policy agency_vocab)/,'');
 assert.equal(variant.replaceAll('\r\n','\n'),canonical.replaceAll('\r\n','\n'));
});

test('hosted SQL preserves Thai approval text without encoding replacement runs', async()=>{
 const files=[
  '../supabase/hosted-test/202609290014_ads_registry.settings-v1.sql',
  '../supabase/hosted-test/h1-seed.sql',
  '../supabase/migrations/202610020025_hosted_h1_adapters.sql',
  '../supabase/tests/hosted_h1.sql',
 ];
 for(const file of files){
  const sql=await readFile(new URL(file,import.meta.url),'utf8');
  assert.doesNotMatch(sql,/\?{3,}/,`${file} contains encoding replacement characters`);
  if(file.includes('settings-v1')) assert.ok(sql.includes("raise exception 'รออนุมัติรูปแบบชื่อ' using errcode='42501';"));
 }
});
