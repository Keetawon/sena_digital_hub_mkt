// Synthetic invitation evidence only, never a hosted Auth writer.
import assert from 'node:assert/strict';
import {assertSimulationDatabase} from '../../scripts/disposable-simulation.mjs';

async function requireDisposable(db) {
  await assertSimulationDatabase(db,{checkDataDirectory:true});
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
