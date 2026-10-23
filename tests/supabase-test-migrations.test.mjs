import assert from 'node:assert/strict';
import { test } from 'node:test';
import {readFile} from 'node:fs/promises';
import { configuration, loadMigrations, migrationBody, requireVerifiedTls, safeError, statements, verifyHistory } from '../scripts/supabase-test-migrations.mjs';

const ref = 'eqlrtevwpyboplljgowo';
const env = {
  HUB_SUPABASE_TEST_PROJECT_REF: ref,
  HUB_SUPABASE_TEST_ADMIN_DATABASE_URL: `postgresql://postgres:secret@db.${ref}.supabase.co:5432/postgres?sslmode=verify-full`,
  HUB_SUPABASE_TEST_RUNTIME_PASSWORD: 'x'.repeat(40),
};
const args = ['--project-ref', ref];

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

test('all 74 canonical migrations and explicit variant parse and foreign/modified/gapped history fails', async () => {
  const migrations = await loadMigrations();
  assert.equal(migrations.length,74);
  assert.equal(migrations.at(-1).name,'202610220074_facility_media_translation.sql');
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
