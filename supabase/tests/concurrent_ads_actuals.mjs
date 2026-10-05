import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
await assertDisposableTestDatabase();
// Local synthetic two-connection P3 races. Restore the previous good generation.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';

const local = JSON.parse(await readFile('.local/development.json', 'utf8'));
const config = { host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: local.adminPassword };
const [setup, first, second] = [new pg.Client(config), new pg.Client(config), new pg.Client(config)];
const actor = randomUUID();
const ownFinding = createHash('sha256').update(actor).digest('hex');
let previousBatch = null;
let previousSnapshot = null;
let captured = false;
let pending;
let base;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function begin(client) {
  await client.query('begin');
  await client.query('set local role admin');
  await client.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason','P3 synthetic concurrency',true)", [actor]);
}
async function apply(client, bundle, expected) {
  return (await client.query('select ads.apply_ads_actuals($1::jsonb,$2::jsonb,$3,$4) result',
    [JSON.stringify(bundle.manifest), JSON.stringify(bundle.relations), hash(bundle), expected])).rows[0].result;
}
function generation(sequence) {
  const value = structuredClone(base);
  const id = randomUUID();
  const stamp = new Date(Date.parse(base.manifest.snapshot_at) + sequence * 1000).toISOString();
  Object.assign(value.manifest, { snapshot_id: id, snapshot_at: stamp });
  for (const [name, rows] of Object.entries(value.relations)) {
    for (const row of rows) {
      Object.assign(row, { snapshot_id: id, snapshot_at: stamp });
      // This race must not reopen any pre-existing operator workflow.
      if (name === 'fact_marketing_ops_finding' && row.condition_present === true) row.condition_present = false;
    }
  }
  const sample = structuredClone(value.relations.fact_marketing_ops_finding[0]);
  Object.assign(sample, { finding_key: ownFinding, condition_present: false, evaluation_status: 'EVALUATED' });
  value.relations.fact_marketing_ops_finding.push(sample);
  for (const relation of value.manifest.relations) relation.row_count = value.relations[relation.relation].length;
  return value;
}
async function blockedThenRelease(promise) {
  pending = promise;
  pending.catch(() => {});
  const pid = (await setup.query("select pid from pg_stat_activity where application_name=$1", ['p3-race-second-' + actor])).rows[0].pid;
  let blocked = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if ((await setup.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])).rows[0]?.wait_event_type === 'Lock') { blocked = true; break; }
    await setTimeout(25);
  }
  assert.ok(blocked, 'Competing P3 write must wait for the transaction lock');
  await first.query('commit');
  return pending;
}
try {
  await Promise.all([setup.connect(), first.connect(), second.connect()]);
  await second.query("select set_config('application_name',$1,false)", ['p3-race-second-' + actor]);
  const current = (await setup.query('select b.* from staging.ads_actuals_current c left join staging.ads_actuals_batch b on b.id=c.batch_id')).rows[0];
  previousBatch = current?.id ?? null;
  previousSnapshot = current?.snapshot_id ?? null;
  captured = true;
  if (previousBatch) base = { manifest: current.manifest, relations: current.relations };
  else {
    const directory = new URL('./fixtures/ads_actuals/', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
    const relations = {};
    for (const row of manifest.relations) relations[row.relation] = JSON.parse(await readFile(new URL(row.file, directory), 'utf8'));
    base = { manifest, relations };
  }
  const a = generation(1), b = generation(2);
  await begin(first); await begin(second);
  const winning = await apply(first, a, previousSnapshot);
  assert.equal(winning.status, 'APPLIED');
  const losing = await blockedThenRelease(apply(second, b, previousSnapshot));
  assert.equal(losing.status, 'QUARANTINED');
  assert.ok(losing.issues.includes('CURRENT_SNAPSHOT_CHANGED'));
  await second.query('commit'); pending = undefined;
  assert.equal((await setup.query('select batch_id from staging.ads_actuals_current')).rows[0].batch_id, winning.batch_id);
  for (const table of ['ads_actuals_dim', 'ads_actuals_bridge', 'ads_actuals_monthly', 'ads_actuals_finding']) {
    assert.equal((await setup.query(`select count(*)::int n from staging.${table} where batch_id=$1`, [losing.batch_id])).rows[0].n, 0);
  }
  console.log('PASS: competing complete P3 generations serialize; stale apply quarantines with no partial rows or pointer replacement');

  const c = generation(3);
  await begin(first); await begin(second);
  const complete = await apply(first, c, a.manifest.snapshot_id);
  const replay = await blockedThenRelease(apply(second, c, a.manifest.snapshot_id));
  assert.equal(replay.status, 'NOOP'); assert.equal(replay.batch_id, complete.batch_id);
  await second.query('commit'); pending = undefined;
  console.log('PASS: concurrent exact P3 replay returns one complete generation without duplicate rows');

  await begin(first); await begin(second);
  const payload = { expected_snapshot_id: c.manifest.snapshot_id, expected_version: 0, state: 'ACKNOWLEDGED', owner_action: 'SELF', note: 'ทดสอบพร้อมกัน' };
  await first.query('select ads.actuals_command($1,$2,$3::jsonb)', ['workflow', ownFinding, JSON.stringify(payload)]);
  pending = second.query('select ads.actuals_command($1,$2,$3::jsonb)', ['workflow', ownFinding, JSON.stringify(payload)]);
  pending.catch(() => {});
  await assert.rejects(blockedThenRelease(pending), (error) => error.code === '40001');
  await second.query('rollback'); pending = undefined;
  assert.equal((await setup.query('select version from ads.finding_workflow where finding_key=$1', [ownFinding])).rows[0].version, 1);
  console.log('PASS: concurrent finding updates preserve one version and reject the stale operator');
} finally {
  await first.query('rollback').catch(() => {});
  await pending?.catch(() => {});
  await second.query('rollback').catch(() => {});
  if (captured) {
    await setup.query('begin');
    // Test-only superuser cleanup. These privileges are not granted to application roles.
    await setup.query("set local session_replication_role='replica'");
    await setup.query('update staging.ads_actuals_current set batch_id=$1', [previousBatch]);
    await setup.query('delete from ads.finding_history where finding_key=$1', [ownFinding]);
    await setup.query('delete from ads.finding_workflow where finding_key=$1', [ownFinding]);
    for (const table of ['ads_actuals_bridge', 'ads_actuals_monthly', 'ads_actuals_finding', 'ads_actuals_dim']) {
      await setup.query(`delete from staging.${table} where batch_id in(select id from staging.ads_actuals_batch where created_by=$1)`, [actor]);
    }
    await setup.query('delete from staging.ads_actuals_batch where created_by=$1', [actor]);
    await setup.query('delete from audit.change_log where actor=$1', [actor]);
    await setup.query('commit');
  }
  await Promise.all([setup.end(), first.end(), second.end()]);
}
