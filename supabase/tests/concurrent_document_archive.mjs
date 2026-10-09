import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
await assertDisposableTestDatabase();
// Local TEST: one lease, one confirmation and one P2 application per immutable source version.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';

const config = JSON.parse(await readFile('.local/development.json', 'utf8'));
const connection = { host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: config.adminPassword };
const [setup, first, second] = [new pg.Client(connection), new pg.Client(connection), new pg.Client(connection)];
const actor = randomUUID(), fixtureId = `archive-race-${actor}`, sha = randomBytes(32).toString('hex');
let pending, secondPid, documentId, memoId;
const begin = async (client, role) => {
  await client.query('begin');
  await client.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, fixtureId]);
  await client.query(`set local role ${role}`);
};
const read = async client => (await client.query('select ads.archive_read($1) value', [documentId])).rows[0].value;
const command = async (client, action, payload) => (await client.query('select ads.archive_command($1,$2,$3::jsonb) value', [action, documentId, JSON.stringify(payload)])).rows[0].value;
async function releaseBlocked(promise) {
  pending = promise; pending.catch(() => {});
  let blocked = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await setup.query('select wait_event_type from pg_stat_activity where pid=$1', [secondPid])).rows[0]?.wait_event_type === 'Lock') { blocked = true; break; }
    await setTimeout(25);
  }
  assert.ok(blocked, 'Competing archive operation must wait on the same document');
  await first.query('commit');
  return pending;
}
try {
  await Promise.all([setup.connect(), first.connect(), second.connect()]);
  secondPid = (await second.query('select pg_backend_pid() pid')).rows[0].pid;
  await setup.query('begin');
  await setup.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, fixtureId]);
  await setup.query("insert into hub.user_account(id,email,status,hub_role) values($1,$2,'ACTIVE','online_staff')", [actor, actor + '@example.test']);
  const memoNo = (await setup.query("select 'MO2610'||lpad(n::text,3,'0') value from generate_series(0,899) n where not exists(select 1 from ads.memo_identifier where identifier='MO2610'||lpad(n::text,3,'0')) order by n limit 1")).rows[0].value;
  const fields = { memo_no: memoNo, subject: 'Synthetic concurrency memo', requesting_bud: 'C1', gross_amount: '123.45', mirrored_status: 'APPROVED', approval_date: '2026-10-01', period_start: '2026-10-01', period_end: '2026-10-31' };
  const result = { pages: [{ page: 1, method: 'TEXT', text: 'SYNTHETIC CONCURRENCY MEMO', confidence: null }], fields, field_sources: Object.fromEntries(Object.keys(fields).map(k => [k, { page: 1, confidence: null }])), rows: [], controls: {} };
  await setup.query('select ads.archive_register_fixture($1::jsonb,$2::jsonb)', [JSON.stringify({ fixture_id: fixtureId, document_type: 'E_MEMO', label_th: 'เอกสารสังเคราะห์พร้อมกัน', sha256: sha, byte_size: 123, mime: 'application/pdf', filename: 'SYNTHETIC-CONCURRENCY.pdf', page_count: 1, storage_key: `memo/sha256/${sha}.pdf`, pipeline_version: 'synthetic-concurrency-v1' }), JSON.stringify({ fields })]);
  await setup.query('set local role online_staff');
  documentId = (await setup.query('select ads.archive_receive($1::jsonb) value', [JSON.stringify({ fixture_id: fixtureId })])).rows[0].value.id;
  await setup.query('reset role');
  // Make our own synthetic queue entry first without changing any existing document.
  await setup.query("update ads.archive_job set created_at='1900-01-01T00:00:00Z' where version_id=(select current_version_id from ads.archive_document where id=$1)", [documentId]);
  await setup.query('commit');

  await begin(first, 'ads_document_worker'); await begin(second, 'ads_document_worker');
  const claim = (await first.query("select ads.archive_claim('RACE-FIRST',120) value")).rows[0].value;
  assert.equal(claim.document_id, documentId);
  const other = (await second.query("select ads.archive_claim('RACE-SECOND',120) value")).rows[0].value;
  assert.notEqual(other?.document_id, documentId, 'The second worker leased the locked document');
  await second.query('rollback'); // Any unrelated queue claim is never committed or processed.
  await first.query('select ads.archive_finish($1,$2,$3::jsonb)', [claim.job_id, claim.lease_token, JSON.stringify(result)]);
  await first.query('commit');
  console.log('PASS: concurrent workers cannot lease the same immutable document version');

  await begin(setup, 'online_staff');
  const draft = await read(setup);
  await setup.query('rollback');
  const confirm = { expected_revision: draft.revision, expected_version_id: draft.current_version_id, expected_job_id: draft.job.id, corrected_result: result, evidence: fixtureId };
  await begin(first, 'online_staff'); await begin(second, 'online_staff');
  await command(first, 'confirm', confirm);
  const repeatedConfirmation = await releaseBlocked(command(second, 'confirm', confirm));
  assert.equal(repeatedConfirmation.operation_status, 'NOOP');
  await second.query('commit'); pending = undefined;
  assert.equal(Number((await setup.query('select count(*) n from ads.archive_confirmation where confirmed_by=$1', [actor])).rows[0].n), 1);
  console.log('PASS: concurrent exact confirmation records one immutable review and preserves original extraction');

  await begin(setup, 'online_staff');
  const confirmed = await read(setup);
  await setup.query('rollback');
  const apply = { expected_revision: confirmed.revision, expected_version_id: confirmed.current_version_id, expected_job_id: confirmed.job.id, mode: 'MEMO_CREATE', reason: fixtureId, request_id: randomUUID() };
  await begin(first, 'online_staff'); await begin(second, 'online_staff');
  const applied = await command(first, 'apply', apply);
  memoId = applied.application.target_id;
  const replay = await releaseBlocked(command(second, 'apply', apply));
  assert.equal(replay.operation_status, 'NOOP'); assert.equal(replay.application.target_id, memoId);
  await second.query('commit'); pending = undefined;
  assert.equal(Number((await setup.query('select count(*) n from ads.archive_application where applied_by=$1', [actor])).rows[0].n), 1);
  assert.equal(Number((await setup.query('select count(*) n from ads.memo where created_by=$1', [actor])).rows[0].n), 1);
  assert.equal((await setup.query('select record_status from ads.memo where id=$1', [memoId])).rows[0].record_status, 'DRAFT');
  console.log('PASS: concurrent archive application creates one P2 draft memo and one receipt; no financial approval');
} finally {
  await first.query('rollback').catch(() => {});
  await pending?.catch(() => {});
  await second.query('rollback').catch(() => {});
  await setup.query('rollback').catch(() => {});
  await setup.query('begin');
  // Test-owner cleanup is scoped to this random actor/fixture. App roles cannot do this.
  await setup.query("set local session_replication_role='replica'");
  for (const table of ['archive_memo_chunk', 'archive_application', 'archive_confirmation', 'archive_receipt']) {
    await setup.query(`delete from ads.${table} where version_id in(select id from ads.archive_version where fixture_id=$1)`, [fixtureId]);
  }
  for (const table of ['archive_extraction', 'archive_attempt']) {
    await setup.query(`delete from ads.${table} where job_id in(select j.id from ads.archive_job j join ads.archive_version v on v.id=j.version_id where v.fixture_id=$1)`, [fixtureId]);
  }
  await setup.query('delete from ads.archive_job where version_id in(select id from ads.archive_version where fixture_id=$1)', [fixtureId]);
  await setup.query('delete from ads.archive_version where fixture_id=$1', [fixtureId]);
  await setup.query('delete from ads.archive_document where id=$1', [documentId ?? null]);
  await setup.query('delete from ads.archive_fixture where fixture_id=$1', [fixtureId]);
  await setup.query('delete from ads.memo_identifier where memo_id in(select id from ads.memo where created_by=$1)', [actor]);
  await setup.query('delete from ads.memo where created_by=$1', [actor]);
  await setup.query('delete from audit.change_log where actor=$1', [actor]);
  await setup.query("set local session_replication_role='origin'");
  await setup.query('delete from hub.user_account where id=$1', [actor]);
  await setup.query('commit');
  await Promise.all([setup.end(), first.end(), second.end()]);
}
