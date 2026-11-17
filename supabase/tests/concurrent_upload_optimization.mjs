import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';

// U53: real transaction contention, metadata-only synthetic files. No decoder,
// storage object, historical row, permission design or production connection.
await assertDisposableTestDatabase();
const local = JSON.parse(await readFile(new URL('../../.local/development.json', import.meta.url), 'utf8'));
const config = { host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: local.adminPassword };
const [setup, first, second] = [new pg.Client(config), new pg.Client(config), new pg.Client(config)];
const actor = randomUUID();
const reason = `SQL-W9-CONCURRENCY-${actor}`;
const digest = (label) => createHash('sha256').update(`${reason}:${label}`).digest('hex');
const sourceKey = (checksum) => `upload-source:marketing_raster:${checksum}`;
const processing = { pipeline_version: 'race-v1', max_edge: 4096, quality: 85, output_format: 'jpeg', metadata_stripped: true, pdf_images_recompressed: false, kept_original_because_no_gain: false };
const original = (label) => ({ checksum: digest(label), size: 150, mime_type: 'image/jpeg', width: 20, height: 10 });
const metadata = (label) => ({ original_filename: `${label}.jpg`, mime_type: 'image/jpeg', storage_path: `${digest(label)}.jpg`, checksum: digest(label), file_size: 90, asset_type: 'image', width: 10, height: 10 });
const suggestions = (label) => ({ source: 'file_metadata', confirmed: false, pipeline_version: label, values: { caption: label, proximity: 'unknown' } });
let context;
let firstPid;
let secondPid;
let pending;

async function begin(client) {
  await client.query('begin');
  // A failed assertion must never strand a blocked test backend indefinitely.
  await client.query("set local statement_timeout='8s'");
  await client.query("set local lock_timeout='6s'");
  await client.query('set local role hub_app');
  await client.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, reason]);
  return (await client.query('select hub.asset_upload_context($1,$2) as result', [context, 'image/jpeg'])).rows[0].result.context_stamp;
}

async function record(client, stored, source, stamp, extraction, pipeline = processing) {
  return (await client.query('select hub.record_asset_upload_source($1,$2,$3,$4,$5,$6) as result',
    [stored, source, pipeline, suggestions(extraction), context, stamp])).rows[0].result;
}

async function advisory(pid, key) {
  return (await setup.query(`select granted,mode from pg_locks where pid=$1 and locktype='advisory' and objsubid=1
    and classid::bigint=((hashtextextended($2,0)>>32)&4294967295)
    and objid::bigint=(hashtextextended($2,0)&4294967295)`, [pid, key])).rows;
}

async function waitForLock(key) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const rows = await advisory(secondPid, key);
    if (rows.some((row) => !row.granted && row.mode === 'ExclusiveLock')) {
      const blockers = (await setup.query('select pg_blocking_pids($1) as pids', [secondPid])).rows[0].pids;
      assert.ok(blockers.includes(firstPid), 'The other real upload transaction must be the blocker');
      return;
    }
    await setTimeout(25);
  }
  assert.fail('The second upload never waited on the expected W9 advisory key');
}

async function assertNoTransactionLocks() {
  const locks = (await setup.query("select pid from pg_locks where pid=any($1::int[]) and locktype='advisory'", [[firstPid, secondPid]])).rows;
  assert.deepEqual(locks, [], 'Completed uploads retained an advisory lock');
  assert.equal((await second.query('select 1 as responsive')).rows[0].responsive, 1);
}

async function race({ name, sameOriginal }) {
  const sourceA = original(`${name}-original-a`);
  const sourceB = sameOriginal ? { ...sourceA } : original(`${name}-original-b`);
  const storedA = metadata(`${name}-stored-a`);
  const storedB = sameOriginal ? metadata(`${name}-stored-b`) : { ...storedA, original_filename: `${name}-second-name.jpg` };
  const stampA = await begin(first);
  const stampB = await begin(second);
  // Both callers genuinely observe a miss before either registration commits.
  for (const [client, source] of [[first, sourceA], [second, sourceB]]) {
    assert.equal((await client.query('select hub.find_uploaded_asset_source($1,$2,$3) as result',
      [source.checksum, source.mime_type, context])).rows[0].result, null);
  }
  await second.query('savepoint private_probe');
  await assert.rejects(second.query('select * from hub.asset_upload_evidence'), { code: '42501' });
  await second.query('rollback to savepoint private_probe');
  await second.query('release savepoint private_probe');
  const winner = await record(first, storedA, sourceA, stampA, `${name}-extract-a`);
  assert.equal(winner.reuse_kind, 'none');
  const sourceSnapshot = (await first.query('select hub.find_uploaded_asset_source($1,$2,$3) as result',
    [sourceA.checksum, sourceA.mime_type, context])).rows[0].result;
  pending = record(second, storedB, sourceB, stampB, `${name}-extract-b`, { ...processing, pipeline_version: 'race-v2' });
  pending.catch(() => {});
  await waitForLock(sameOriginal ? sourceKey(sourceA.checksum) : storedA.checksum);
  if (sameOriginal) {
    assert.deepEqual(await advisory(secondPid, storedB.checksum), [], 'Losing candidate stored lock was taken before its source lock');
    assert.deepEqual(await advisory(secondPid, storedA.checksum), [], 'Winner stored lock was taken before its source lock');
  } else {
    assert.ok((await advisory(secondPid, sourceKey(sourceB.checksum))).some((row) => row.granted),
      'Distinct-original upload must hold its source lock before waiting for shared stored bytes');
  }
  // Ordinary rights review while the duplicate waits; the duplicate must return
  // this exact committed registry row, never its own candidate metadata.
  const approved = (await first.query('select hub.review_asset($1,$2,$3,$4,$5,$6,$7) as result',
    [winner.asset.id, winner.asset.updated_at, 'approved', 'Synthetic concurrent rights evidence', null, null, reason])).rows[0].result;
  assert.equal(approved.rights_status, 'approved');
  await first.query('commit');
  const duplicate = await pending;
  await second.query('commit');
  pending = undefined;
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.reuse_kind, sameOriginal ? 'original' : 'stored');
  assert.deepEqual(duplicate.asset, approved, 'Race rewrote winner identity, rights, owner, filename or timestamps');
  assert.notEqual(duplicate.upload.evidence_id, winner.upload.evidence_id);
  assert.equal(duplicate.upload.extraction_version, `${name}-extract-b`);
  assert.equal(duplicate.upload.suggestions.values.caption, `${name}-extract-b`);
  assert.equal(duplicate.upload.pipeline_version, sameOriginal ? 'race-v1' : 'race-v2');
  assert.equal(duplicate.upload.source_id === winner.upload.source_id, sameOriginal);
  const sourceRows = (await setup.query('select to_jsonb(s) as row from hub.asset_upload_sources s where asset_id=$1 order by original_checksum', [winner.asset.id])).rows.map((row) => row.row);
  assert.equal(sourceRows.length, sameOriginal ? 1 : 2);
  assert.deepEqual(sourceRows.map((row) => row.original_checksum).sort(), [...new Set([sourceA.checksum, sourceB.checksum])].sort(), 'Original source hashes changed');
  assert.ok(sourceRows.every((row) => row.original_size === sourceA.size && row.asset_id === approved.id));
  const retained = sourceRows.find((row) => row.id === winner.upload.source_id);
  assert.equal(retained.pipeline_version, sourceSnapshot.pipeline_version);
  assert.deepEqual(retained.processing, sourceSnapshot.processing);
  assert.equal(retained.original_checksum, sourceSnapshot.original.checksum);
  const asset = (await setup.query('select to_jsonb(a) as row from hub.assets a where id=$1', [approved.id])).rows[0].row;
  assert.deepEqual(asset, approved, 'Post-commit registry differs from reviewed winner');
  const assets = (await setup.query('select id from hub.assets where checksum=any($1::text[])', [[storedA.checksum, storedB.checksum]])).rows;
  assert.equal(assets.length, 1, 'Losing candidate installed an extra registry asset');
  const evidence = (await setup.query(`select e.id,e.source_id,e.extraction_version,e.suggestions from hub.asset_upload_evidence e
    join hub.asset_upload_sources s on s.id=e.source_id where s.asset_id=$1`, [approved.id])).rows;
  assert.equal(evidence.length, 2, 'Each transaction must retain separate private evidence');
  assert.deepEqual(evidence.map((row) => row.extraction_version).sort(), [`${name}-extract-a`, `${name}-extract-b`].sort());
  await assertNoTransactionLocks();
}

try {
  await Promise.all([setup.connect(), first.connect(), second.connect()]);
  [firstPid, secondPid] = await Promise.all([first, second].map(async (client) => (await client.query('select pg_backend_pid() as pid')).rows[0].pid));
  await setup.query('begin');
  await setup.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, reason]);
  await setup.query("insert into hub.user_account(id,email,status,hub_role) values($1,$2,'ACTIVE','viewer')", [actor, `${actor}@example.test`]);
  await setup.query('delete from hub.account_permission where account_id=$1', [actor]);
  await setup.query("insert into hub.account_permission(account_id,tab,can_view,can_edit,can_approve) values($1,'projects',true,true,false),($1,'knowledge',true,false,true)", [actor]);
  const project = (await setup.query('select public_project_id from hub.projects where deleted_at is null order by public_project_id limit 1')).rows[0];
  assert.ok(project, 'Disposable harness must supply one project');
  context = { v: 1, kind: 'project', ref: project.public_project_id, category: 'exterior', purpose: 'media' };
  await setup.query('commit');
  await race({ name: 'same-original', sameOriginal: true });
  await race({ name: 'same-output', sameOriginal: false });
  console.log('PASS: W9 real source-before-stored races preserve reviewed winners, original hashes and private evidence; all locks release');
} finally {
  // Release the winning transaction first; cancel only this test's waiting PID.
  await first.query('rollback').catch(() => {});
  if (pending) {
    await setup.query('select pg_cancel_backend($1)', [secondPid]).catch(() => {});
    await pending.catch(() => {});
  }
  await second.query('rollback').catch(() => {});
  await setup.query('rollback').catch(() => {});
  try {
    await setup.query('begin');
    await setup.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, reason]);
    // Test-owner cleanup only, inside the verified disposable database. Normal
    // app roles never acquire mutation rights on the two immutable relations.
    await setup.query("set local session_replication_role='replica'");
    await setup.query('delete from hub.asset_upload_evidence where source_id in(select id from hub.asset_upload_sources where created_by=$1)', [actor]);
    await setup.query('delete from hub.asset_upload_sources where created_by=$1', [actor]);
    await setup.query("set local session_replication_role='origin'");
    await setup.query('delete from hub.assets where owner_id=$1', [actor]);
    await setup.query('delete from hub.user_account where id=$1', [actor]);
    await setup.query('delete from audit.change_log where actor=$1 or reason=$2', [actor, reason]);
    await setup.query('commit');
  } finally {
    await setup.query('rollback').catch(() => {});
    await Promise.all([setup.end(), first.end(), second.end()]);
  }
}
