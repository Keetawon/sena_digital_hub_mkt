import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
await assertDisposableTestDatabase();
// Actual concurrent duplicate registration. Files are API-owned; this test checks
// SQL serialization and preservation of the winner's reviewed registry metadata.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';

const local = JSON.parse(await readFile('.local/development.json', 'utf8'));
const config = { host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: local.adminPassword };
const [setup, first, second] = [new pg.Client(config), new pg.Client(config), new pg.Client(config)];
const reason = `SQL-ASSET-CONCURRENCY-${randomUUID()}`;
const checksum = createHash('sha256').update(reason).digest('hex');
const metadata = { original_filename: 'synthetic-concurrency.png', mime_type: 'image/png', storage_path: `${checksum}.png`, checksum, file_size: 100, asset_type: 'image', width: 10, height: 10 };
let pending;
try {
  await Promise.all([setup.connect(), first.connect(), second.connect()]);
  for (const client of [first, second]) {
    await client.query('begin');
    await client.query('set local role publisher');
    await client.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", ['00000000-0000-0000-0000-000000000002', reason]);
  }
  const registered = (await first.query('select hub.register_uploaded_asset($1) as result', [metadata])).rows[0].result;
  assert.equal(registered.reused, false);
  const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
  pending = second.query('select hub.register_uploaded_asset($1) as result', [{ ...metadata, original_filename: 'duplicate-name.png' }]);
  pending.catch(() => {});
  let blocked = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = (await setup.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])).rows[0];
    if (state?.wait_event_type === 'Lock') { blocked = true; break; }
    await setTimeout(25);
  }
  assert.ok(blocked, 'Duplicate registration must wait for the first upload transaction');
  await first.query('set local role publisher');
  await first.query("select set_config('app.actor_id',$1,true)", ['00000000-0000-0000-0000-000000000002']);
  const approved = (await first.query('select hub.review_asset($1,$2,$3,$4,$5,$6,$7) as result', [registered.asset.id, registered.asset.updated_at, 'approved', 'Original synthetic illustration', null, null, reason])).rows[0].result;
  await first.query('commit');
  const duplicate = (await pending).rows[0].result;
  await second.query('commit');
  assert.equal(duplicate.reused, true);
  assert.deepEqual(duplicate.asset, approved, 'Duplicate changed approved rights, original filename or timestamps');
  const count = (await setup.query('select count(*)::int as count from hub.assets where checksum=$1 and deleted_at is null', [checksum])).rows[0].count;
  assert.equal(count, 1, 'Duplicate upload created multiple live registry records');
  console.log('PASS: concurrent upload dedup preserves the approved registry winner');
} finally {
  await first.query('rollback').catch(() => {});
  await pending?.catch(() => {});
  await second.query('rollback').catch(() => {});
  await setup.query('begin');
  await setup.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", ['00000000-0000-0000-0000-000000000002', reason]);
  await setup.query('delete from hub.assets where checksum=$1', [checksum]);
  await setup.query('delete from audit.change_log where reason=$1', [reason]);
  await setup.query('commit');
  await Promise.all([setup.end(), first.end(), second.end()]);
}
