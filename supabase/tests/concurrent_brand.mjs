// Two editors must not overwrite a brand changed while waiting on its row lock.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';

const local = JSON.parse(await readFile('.local/development.json', 'utf8'));
const config = { host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: local.adminPassword };
const [setup, first, second] = [new pg.Client(config), new pg.Client(config), new pg.Client(config)];
const sourceId = `SQL-BRAND-CONCURRENCY-${randomUUID()}`;
const actor = '00000000-0000-0000-0000-000000000005';
let pending;
try {
  await Promise.all([setup.connect(), first.connect(), second.connect()]);
  await setup.query('begin');
  await setup.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, sourceId]);
  await setup.query('insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint) values($1,$2,now(),$2)', [sourceId, 'Synthetic concurrency brand']);
  await setup.query('set local role admin');
  const brandId = (await setup.query('select hub.create_brand_from_rem($1) as id', [sourceId])).rows[0].id;
  const expected = (await setup.query('select updated_at::text from hub.brands where id=$1', [brandId])).rows[0].updated_at;
  await setup.query('commit');
  for (const client of [first, second]) {
    await client.query('begin');
    await client.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, sourceId]);
  }
  await first.query('select id from hub.brands where id=$1 for update', [brandId]);
  await first.query('set local role editor');
  await second.query('set local role editor');
  const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
  pending = second.query('select hub.update_brand_draft($1,$2,$3)', [brandId, { description: { th: 'Second edit' } }, expected]);
  pending.catch(() => {});
  let blocked = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = (await setup.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])).rows[0];
    if (state?.wait_event_type === 'Lock') { blocked = true; break; }
    await setTimeout(25);
  }
  assert.ok(blocked, 'Second brand editor must wait on the brand lock');
  await first.query('select hub.update_brand_draft($1,$2,$3)', [brandId, { public_name: { th: 'First edit' } }, expected]);
  await first.query('commit');
  await assert.rejects(pending, { code: '40001' }, 'Waiting brand editor must detect committed change');
  await second.query('rollback');
  await second.query('begin');
  await second.query('set local role editor');
  await second.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, sourceId]);
  const refreshed = (await second.query('select updated_at::text from hub.brands where id=$1', [brandId])).rows[0].updated_at;
  await second.query('select hub.update_brand_draft($1,$2,$3)', [brandId, { description: { th: 'Second edit' } }, refreshed]);
  await second.query('commit');
  const result = (await setup.query("select public_name->>'th' as name,description->>'th' as description from hub.brands where id=$1", [brandId])).rows[0];
  assert.deepEqual(result, { name: 'First edit', description: 'Second edit' });
  console.log('PASS: concurrent brand edits reject stale timestamps and preserve committed fields after reload');
} finally {
  await first.query('rollback').catch(() => {});
  await pending?.catch(() => {});
  await second.query('rollback').catch(() => {});
  await setup.query('rollback').catch(() => {});
  await setup.query('begin');
  await setup.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, sourceId]);
  await setup.query('delete from hub.brands where rem_brand_id=$1', [sourceId]);
  await setup.query('delete from staging.rem_brands where rem_brand_id=$1', [sourceId]);
  await setup.query('delete from audit.change_log where reason=$1', [sourceId]);
  await setup.query('commit');
  await Promise.all([setup.end(), first.end(), second.end()]);
}
