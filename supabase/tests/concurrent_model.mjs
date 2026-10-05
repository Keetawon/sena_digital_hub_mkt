import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
await assertDisposableTestDatabase();
// Local-only PostgreSQL regression. Uses two transactions and a unique synthetic
// fixture; never mutates DEMO-001. Run from the repo root after npm run dev:db.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';

const local = JSON.parse(await readFile('.local/development.json', 'utf8'));
const config = { host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: local.adminPassword };
const [setup, first, second] = [new pg.Client(config), new pg.Client(config), new pg.Client(config)];
const sourceId = `SQL-CONCURRENCY-${randomUUID()}`;
const actor = '00000000-0000-0000-0000-000000000001';
let projectId;
let pending;
try {
  await Promise.all([setup.connect(), first.connect(), second.connect()]);
  await setup.query('begin');
  await setup.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, sourceId]);
  await setup.query('insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_snapshot_at,source_fingerprint) values ($1,$2,now(),now(),$2)', [sourceId, 'Synthetic concurrency test']);
  await setup.query('insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint) values ($1,$1,$2,now(),$2)', [sourceId, 'Synthetic concurrency test']);
  await setup.query('set local role editor');
  projectId = (await setup.query('select hub.create_project_from_rem($1) as id', [sourceId])).rows[0].id;
  const modelId = (await setup.query('select public_model_id from hub.model_types where project_id=$1', [projectId])).rows[0].public_model_id;
  const initialTimestamp = (await setup.query('select updated_at::text from hub.projects where id=$1', [projectId])).rows[0].updated_at;
  await setup.query('select hub.update_model($1,$2,$3,$4)', [projectId, modelId, { bedrooms: 2, bathrooms: 1 }, initialTimestamp]);
  const expectedTimestamp = (await setup.query('select updated_at::text from hub.projects where id=$1', [projectId])).rows[0].updated_at;
  await setup.query('commit');

  await first.query('begin');
  await first.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, sourceId]);
  await first.query('select id from hub.projects where id=$1 for update', [projectId]);
  await first.query('set local role editor');
  await second.query('begin');
  await second.query('set local role editor');
  await second.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, sourceId]);
  const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
  pending = second.query('select hub.update_model($1,$2,$3,$4)', [projectId, modelId, { bathrooms: 2 }, expectedTimestamp]);
  // Attach rejection handling immediately while observing the deterministic lock wait.
  pending.catch(() => {});
  let blocked = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = (await setup.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])).rows[0];
    if (state?.wait_event_type === 'Lock') { blocked = true; break; }
    await setTimeout(25);
  }
  assert.ok(blocked, 'Second editor must wait on the project lock');
  await first.query('select hub.update_model($1,$2,$3,$4)', [projectId, modelId, { bedrooms: 3 }, expectedTimestamp]);
  await first.query('commit');
  await assert.rejects(pending, { code: '40001' }, 'Waiting editor must detect the committed parent change');
  await second.query('rollback');
  await second.query('begin');
  await second.query('set local role editor');
  await second.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, sourceId]);
  const refreshedTimestamp = (await second.query('select updated_at::text from hub.projects where id=$1', [projectId])).rows[0].updated_at;
  await second.query('select hub.update_model($1,$2,$3,$4)', [projectId, modelId, { bathrooms: 2 }, refreshedTimestamp]);
  await second.query('commit');
  const model = (await setup.query('select bedrooms::text,bathrooms::text from hub.model_types where public_model_id=$1', [modelId])).rows[0];
  assert.deepEqual(model, { bedrooms: '3', bathrooms: '2' }, 'Partial edit must preserve the concurrent committed field');
  console.log('PASS: concurrent model edit rejects stale timestamp and preserves committed fields after reload');
} finally {
  await first.query('rollback').catch(() => {});
  await pending?.catch(() => {});
  await second.query('rollback').catch(() => {});
  await setup.query('rollback').catch(() => {});
  if (projectId) {
    await setup.query('begin');
    await setup.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, sourceId]);
    await setup.query('delete from hub.model_types where project_id=$1', [projectId]);
    await setup.query('delete from hub.projects where id=$1', [projectId]);
    await setup.query('delete from staging.rem_models where rem_project_id=$1', [sourceId]);
    await setup.query('delete from staging.rem_projects where rem_project_id=$1', [sourceId]);
    await setup.query('delete from audit.change_log where reason=$1', [sourceId]);
    await setup.query('commit');
  }
  await Promise.all([setup.end(), first.end(), second.end()]);
}
