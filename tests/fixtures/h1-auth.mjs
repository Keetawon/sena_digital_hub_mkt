// Synthetic invitation evidence only, never a hosted Auth writer.
import assert from 'node:assert/strict';

async function requireDisposable(db) {
  const c=db.connectionParameters??db.options;
  assert.equal(c.host,'127.0.0.1');assert.equal(Number(c.port),55434);assert.equal(c.database,'hub_hosted_test_simulation');
  const {rows:[actual]}=await db.query('select host(inet_server_addr()) host,inet_server_port() port,current_database() name');
  assert.equal(actual.host,'127.0.0.1');assert.equal(actual.port,55434);assert.equal(actual.name,'hub_hosted_test_simulation');
}
export async function createH1AuthFixture(db) {
  await requireDisposable(db);
  await db.query('create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz not null)');
  await db.query('grant usage on schema auth to hub_migration_verifier; grant select on auth.users to hub_migration_verifier');
}
export async function saveH1AuthFixture(db,user) {
  assert.ok(user.email.endsWith('@example.test'));await requireDisposable(db);
  await db.query('insert into auth.users(id,email,email_confirmed_at,created_at) values($1,$2,$3,$4) on conflict(id) do update set email=excluded.email,email_confirmed_at=excluded.email_confirmed_at',
    [user.id,user.email,user.email_confirmed_at??null,user.created_at]);
}
