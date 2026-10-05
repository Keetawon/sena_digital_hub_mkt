import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
await assertDisposableTestDatabase();
// Two real transactions must serialize allocation and receive distinct SN codes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';

const local = JSON.parse(await readFile('.local/development.json', 'utf8'));
const database = process.env.HUB_ADS_TEST_DATABASE || 'sena_hub_local';
if (!['sena_hub_local', 'sena_ads_p1_check'].includes(database)) throw new Error('Synthetic concurrency test requires the local test database');
const config = { host: '127.0.0.1', port: 55432, database, user: 'postgres', password: local.adminPassword };
const [setup, first, second] = [new pg.Client(config), new pg.Client(config), new pg.Client(config)];
const scopeId = randomUUID();
const reason = `SQL-ADS-CONCURRENCY-${scopeId}`;
const codes = [];
let pending;
try {
  await Promise.all([setup.connect(), first.connect(), second.connect()]);
  assert.equal((await setup.query('select ads.test_issuing_enabled() as enabled')).rows[0].enabled, true, 'Local fixture override is required');
  await setup.query('begin');
  await setup.query("select set_config('app.change_reason',$1,true)", [reason]);
  // Scope token includes a valid unique synthetic group suffix.
  const token = 'C-TEST-' + scopeId.replaceAll('-', '').slice(0, 5).toUpperCase();
  await setup.query(`insert into ads.scope_code(scope_id,scope_code,kind,label_th,label_en,member_signature,status)
    values($1,$2,'GROUP','ทดสอบการออกเลขพร้อมกัน','CONCURRENT TEST',ads.scope_signature($3::jsonb),'ACTIVE')`,
  [scopeId, token, JSON.stringify([{ member_type: 'GROUP', member_id: token }])]);
  await setup.query("insert into ads.scope_member(scope_id,member_type,member_id) values($1,'GROUP',$2)", [scopeId, token]);
  await setup.query('commit');
  for (const client of [first, second]) {
    await client.query('begin');
    await client.query('set local role online_staff');
    await client.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000006',true),set_config('app.change_reason',$1,true)", [reason]);
  }
  const a = (await first.query("select ads.issue_registration($1,'LEADS','KIN') as detail", [scopeId])).rows[0].detail.registration;
  codes.push(a.code);
  const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
  pending = second.query("select ads.issue_registration($1,'LEADS','KIN') as detail", [scopeId]);
  pending.catch(() => {});
  let blocked = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await setup.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])).rows[0]?.wait_event_type === 'Lock') { blocked = true; break; }
    await setTimeout(25);
  }
  assert.ok(blocked, 'Second issuer must wait for the annual counter lock');
  await first.query('commit');
  const b = (await pending).rows[0].detail.registration;
  codes.push(b.code);
  await second.query('commit');
  assert.notEqual(a.code, b.code);
  assert.equal(b.sequence_year, a.sequence_year);
  assert.equal(b.sequence_no, a.sequence_no + 1);
  assert.equal((await setup.query('select count(*)::int as count from ads.campaign_registration where code=any($1::text[])', [codes])).rows[0].count, 2);
  console.log('PASS: concurrent ads registrations wait on the annual counter and commit distinct sequential SN codes');
} finally {
  await first.query('rollback').catch(() => {});
  await pending?.catch(() => {});
  await second.query('rollback').catch(() => {});
  await setup.query('rollback').catch(() => {});
  await setup.query('begin');
  // Local superuser fixture cleanup only. Keep the counter advanced: committed
  // numbers are never reused. No application function has this capability.
  await setup.query("set local session_replication_role='replica'");
  await setup.query('delete from ads.campaign_name where code in(select code from ads.campaign_registration where scope_id=$1)', [scopeId]);
  await setup.query('delete from ads.campaign_registration where scope_id=$1', [scopeId]);
  await setup.query('delete from ads.scope_member where scope_id=$1', [scopeId]);
  await setup.query('delete from ads.scope_code where scope_id=$1', [scopeId]);
  await setup.query('delete from audit.change_log where reason=$1', [reason]);
  await setup.query('commit');
  await Promise.all([setup.end(), first.end(), second.end()]);
}
