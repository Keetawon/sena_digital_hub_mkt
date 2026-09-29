import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuration, loadMigrations, migrationBody, requireVerifiedTls, safeError, statements, verifyHistory } from '../scripts/supabase-test-migrations.mjs';

const ref = 'abcdefghijklmnopqrst';
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

test('all fourteen actual migration files parse and foreign/modified/gapped history fails', async () => {
  const migrations = await loadMigrations();
  assert.equal(migrations.length, 14);
  const rows = migrations.map(m => ({ name: m.name, checksum: m.checksum, project_ref: ref, source: 'sena-hub-supabase-test-v1' }));
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
