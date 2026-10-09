import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
await assertDisposableTestDatabase();
// Fixed local TEST only: confirmation replay and two proposals for one draft revision.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';

const config = JSON.parse(await readFile('.local/development.json', 'utf8'));
const connection = { host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: config.adminPassword };
const [setup, first, second] = [new pg.Client(connection), new pg.Client(connection), new pg.Client(connection)];
const actor = randomUUID(), sourceId = `SYNTHETIC-ASSISTANT-${actor}`;
let projectId, pending, secondPid;
const begin = async client => {
  await client.query('begin');
  await client.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, sourceId]);
  await client.query('set local role editor');
};
const read = async () => (await setup.query('select meta_title,meta_description,demo_fields,published_version_id,updated_at from hub.projects where id=$1', [projectId])).rows[0];
const create = async text => (await setup.query("select internal.assistant_proposal_create(jsonb_build_object('entity_type','project','entity_id',id,'field_path','meta_description.th','new_text',$2::text,'expected_updated_at',updated_at)) value from hub.projects where id=$1", [projectId, text])).rows[0].value;
const apply = async (client, proposal) => (await client.query('select internal.assistant_proposal_apply($1,$2) value', [proposal.id, proposal.digest])).rows[0].value;
async function waitAndCommit(promise) {
  pending = promise; pending.catch(() => {});
  let blocked = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await setup.query('select wait_event_type from pg_stat_activity where pid=$1', [secondPid])).rows[0]?.wait_event_type === 'Lock') { blocked = true; break; }
    await setTimeout(25);
  }
  assert.ok(blocked, 'Second confirmation must wait on proposal or target draft lock');
  await first.query('commit');
  return pending;
}
try {
  await Promise.all([setup.connect(), first.connect(), second.connect()]);
  secondPid = (await second.query('select pg_backend_pid() pid')).rows[0].pid;
  await setup.query('begin');
  await setup.query("insert into hub.user_account(id,email,status,hub_role) values($1,$2,'ACTIVE','editor')",[actor,actor+'@example.test']);
  await setup.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, sourceId]);
  await setup.query('insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint) values($1,$2,now(),$1)', [sourceId, 'Synthetic assistant concurrency']);
  await setup.query('set local role editor');
  projectId = (await setup.query('select hub.create_project_from_rem($1) id', [sourceId])).rows[0].id;
  await setup.query("select hub.patch_project(id,'{\"meta_title\":{\"th\":\"ชื่อตัวอย่าง\"},\"meta_description\":{\"th\":\"ข้อความเดิม\",\"en\":\"Keep this locale\"}}',updated_at) from hub.projects where id=$1", [projectId]);
  await setup.query('reset role');
  await setup.query("select hub.mark_demo_fields('project',$1,array['meta_title.th','meta_description.th'])", [projectId]);
  await setup.query('commit');

  await begin(setup); const one = await create('ข้อความที่ยืนยันเพียงครั้งเดียว'); await setup.query('commit');
  const before = await read();
  await begin(first); await begin(second);
  const applied = await apply(first, one);
  const repeated = await waitAndCommit(apply(second, one));
  await second.query('commit'); pending = undefined;
  assert.equal(applied.replayed, false); assert.equal(repeated.replayed, true);
  assert.equal(repeated.receipt.id, applied.receipt.id);
  assert.equal(Number((await setup.query('select count(*) n from internal.assistant_proposal_application where proposal_id=$1', [one.id])).rows[0].n), 1);
  const after = await read();
  assert.equal(after.meta_description.th, 'ข้อความที่ยืนยันเพียงครั้งเดียว');
  assert.equal(after.meta_description.en, before.meta_description.en);
  assert.deepEqual(after.demo_fields, before.demo_fields);
  assert.equal(after.published_version_id, before.published_version_id);
  console.log('PASS: concurrent same-proposal confirmations apply once and preserve locales, synthetic markers and publication');

  await begin(setup); const older = await create('ผู้ชนะที่ยืนยันก่อน'), competing = await create('ห้ามเขียนทับผู้ชนะ'); await setup.query('commit');
  await begin(first); await begin(second);
  await apply(first, older);
  const result = await waitAndCommit(apply(second, competing).then(value => ({ value }), error => ({ code: error.code })));
  assert.equal(result.code, '40001', 'Competing proposal must fail its captured source revision');
  await second.query('rollback'); pending = undefined;
  const winner = await read();
  assert.equal(winner.meta_description.th, 'ผู้ชนะที่ยืนยันก่อน');
  assert.equal(Number((await setup.query('select count(*) n from internal.assistant_proposal_application where proposal_id=$1', [competing.id])).rows[0].n), 0);
  assert.equal(Number((await setup.query('select count(*) n from internal.assistant_proposal_application where actor_id=$1', [actor])).rows[0].n), 2);
  console.log('PASS: concurrent different proposals cannot overwrite a later confirmed draft; stale attempt leaves no receipt');
} finally {
  await first.query('rollback').catch(() => {}); await pending?.catch(() => {});
  await second.query('rollback').catch(() => {}); await setup.query('rollback').catch(() => {});
  await setup.query('begin');
  // Test-owner cleanup only for this random synthetic actor/project; app roles have no DELETE.
  await setup.query("set local session_replication_role='replica'");
  await setup.query('delete from audit.assistant_proposal_event where actor_id=$1', [actor]);
  await setup.query('delete from internal.assistant_proposal_application where actor_id=$1', [actor]);
  await setup.query('delete from internal.assistant_proposal where actor_id=$1', [actor]);
  await setup.query('delete from hub.model_types where project_id=$1', [projectId ?? null]);
  await setup.query('delete from hub.projects where id=$1', [projectId ?? null]);
  await setup.query('delete from staging.rem_projects where rem_project_id=$1', [sourceId]);
  await setup.query('delete from audit.change_log where actor=$1', [actor]);
  await setup.query('delete from hub.account_permission where account_id=$1', [actor]);
  await setup.query('delete from hub.user_account where id=$1', [actor]);
  await setup.query('commit');
  await Promise.all([setup.end(), first.end(), second.end()]);
}
