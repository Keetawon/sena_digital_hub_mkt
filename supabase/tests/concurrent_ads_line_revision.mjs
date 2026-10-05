import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
await assertDisposableTestDatabase();
// Real two-connection races. Synthetic fixtures only; no remote database support.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';

const local = JSON.parse(await readFile('.local/development.json', 'utf8'));
const database = process.env.HUB_ADS_TEST_DATABASE || 'sena_hub_local';
if (!['sena_hub_local', 'sena_hub_p2_verify'].includes(database)) throw new Error('P2 concurrency requires the local synthetic database');
const config = { host: '127.0.0.1', port: 55432, database, user: 'postgres', password: local.adminPassword };
const [setup, first, second] = [new pg.Client(config), new pg.Client(config), new pg.Client(config)];
const actor = randomUUID();
const scope = randomUUID();
const phase = randomUUID();
const token = 'C-TEST-' + actor.replaceAll('-', '').slice(0, 5).toUpperCase();
const reason = `SQL-P2-RACE-${actor}`;
const month = '2094-09-01';
let pending;
async function begin(client, role = 'online_staff') {
  await client.query('begin');
  assert.ok(['online_staff', 'admin'].includes(role));
  await client.query(`set local role ${role}`);
  await client.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, reason]);
}
async function cmd(client, action, payload) {
  return (await client.query('select ads.finance_command($1,$2::jsonb) as result', [action, JSON.stringify(payload)])).rows[0].result;
}
async function read(resource, key) {
  await begin(setup);
  const result = (await setup.query('select ads.finance_read($1,$2) as result', [resource, key])).rows[0].result;
  await setup.query('commit');
  return result;
}
async function race(firstAction, firstPayload, secondAction, secondPayload, failureCode, role = 'online_staff') {
  await begin(first, role);
  await begin(second, role);
  const winning = await cmd(first, firstAction, firstPayload);
  const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
  pending = cmd(second, secondAction, secondPayload);
  pending.catch(() => {});
  let blocked = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if ((await setup.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])).rows[0]?.wait_event_type === 'Lock') { blocked = true; break; }
    await setTimeout(25);
  }
  assert.ok(blocked, 'Competing financial write must wait on the transaction lock');
  await first.query('commit');
  if (failureCode) {
    await assert.rejects(pending, (error) => error.code === failureCode);
    await second.query('rollback');
  } else {
    const replay = await pending;
    assert.equal(replay.id, winning.id);
    assert.equal(replay.replayed, true);
    await second.query('commit');
  }
  pending = undefined;
  return winning;
}
try {
  await Promise.all([setup.connect(), first.connect(), second.connect()]);
  await setup.query('begin');
  await setup.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [actor, reason]);
  for (const [id, kind, code, members, parent] of [
    [scope, 'GROUP', token, [{ member_type: 'GROUP', member_id: token }], null],
    [phase, 'PHASE', token + '-A', [{ member_type: 'PHASE', member_id: '0000' + actor, parent_group_id: token }], token],
  ]) {
    await setup.query(`insert into ads.scope_code(scope_id,scope_code,kind,label_th,label_en,member_signature,status,parent_group_id,created_by)
      values($1,$2,$3,'ทดสอบพร้อมกัน','P2 CONCURRENT',ads.scope_signature($4::jsonb),'ACTIVE',$5,$6)`, [id, code, kind, JSON.stringify(members), parent, actor]);
    await setup.query('insert into ads.scope_member(scope_id,member_type,member_id,parent_group_id,name_alias) values($1,$2,$3,$4,$5)', [id, members[0].member_type, members[0].member_id, parent, kind === 'PHASE' ? 'A' : null]);
  }
  await setup.query('commit');
  await begin(setup);
  let memo = await cmd(setup, 'memo_create', { memo_no: 'MO9912' + String(parseInt(actor.slice(0, 6), 16) % 1000).padStart(3, '0'), subject: 'Synthetic race memo', requesting_bud: 'C1', gross_amount: '1000.00', mirrored_status: 'APPROVED', approval_date: '2026-09-30', evidence_ref: reason });
  memo = await cmd(setup, 'memo_confirm', { id: memo.id, expected_version: memo.row_version });
  const components = [{ component_kind: 'PHASE', rem_project_id: '0000' + actor, formatted_mapping: token, bud: 'C1', gross_amount: '100.00', memo_id: memo.id }];
  const acknowledgements = [{ memo_id: memo.id, reason: 'Synthetic remaining allocation is visible' }];
  let line = await cmd(setup, 'line_create', { kind: 'GROUP', scope_id: scope, month, agency: 'KIN', reason, components });
  line = await cmd(setup, 'revision_confirm', { id: line.id, revision_id: line.revisions[0].id, expected_revision_id: null, acknowledgements });
  const oldRevision = line.current_revision_id;
  line = await cmd(setup, 'revision_create', { id: line.id, expected_version: line.row_version, components, reason });
  const a = line.revisions[0].id;
  line = await cmd(setup, 'revision_create', { id: line.id, expected_version: line.row_version, components, reason });
  const b = line.revisions[0].id;
  await setup.query('commit');
  line = await race('revision_confirm', { id: line.id, revision_id: a, expected_revision_id: oldRevision, acknowledgements }, 'revision_confirm', { id: line.id, revision_id: b, expected_revision_id: oldRevision, acknowledgements }, '40001');
  assert.equal((await setup.query("select count(*)::int n from ads.media_line_revision where line_id=$1 and status='APPROVED'", [line.id])).rows[0].n, 1);
  console.log('PASS: two competing line revisions serialize; one wins and one receives a stale-version conflict');

  memo = await read('memos', memo.id);
  await race('memo_update', { id: memo.id, expected_version: memo.row_version, mirrored_status: 'CANCELLED' }, 'revision_confirm', { id: line.id, revision_id: b, expected_revision_id: line.current_revision_id, acknowledgements }, '22023');
  assert.equal((await read('media-lines', line.id)).state, 'SUSPENDED');
  console.log('PASS: concurrent memo cancellation prevents confirmation against stale external approval');

  await begin(setup);
  memo = (await setup.query("select ads.finance_read('memos',$1) result", [memo.id])).rows[0].result;
  memo = await cmd(setup, 'memo_update', { id: memo.id, expected_version: memo.row_version, mirrored_status: 'APPROVED' });
  memo = await cmd(setup, 'memo_confirm', { id: memo.id, expected_version: memo.row_version });
  line = await cmd(setup, 'revision_confirm', { id: line.id, revision_id: b, expected_revision_id: line.current_revision_id, acknowledgements });
  const component = line.revisions.find((r) => r.id === line.current_revision_id).components[0];
  const registration = (await setup.query("select ads.issue_registration($1,'LEADS','KIN') result", [scope])).rows[0].result.registration;
  await setup.query('commit');
  const assignment = { code: registration.code, month, line_id: line.id, expected_revision_id: line.current_revision_id };
  await race('assignment_create', assignment, 'assignment_create', assignment, '23505');
  console.log('PASS: concurrent SN-month assignment leaves exactly one active relationship');
  const competingMemoNo = 'MO9812' + String(parseInt(actor.slice(0, 6), 16) % 1000).padStart(3, '0');
  await race('memo_create', { memo_no: competingMemoNo, subject: 'Synthetic alias collision', requesting_bud: 'C1', gross_amount: '1.00' }, 'memo_identifier_propose', { memo_id: memo.id, identifier: competingMemoNo, reason, evidence_ref: reason }, '23505');
  console.log('PASS: concurrent canonical memo and alias claims cannot acquire the same identifier');
  await begin(setup);
  const correctionPayload = { observed_code: token + '-OLD', agency: 'KIN', month_from: month, month_to: month, reason, evidence_ref: reason, targets: [{ month, line_id: line.id }] };
  const correctionA = await cmd(setup, 'correction_create', correctionPayload);
  const correctionB = await cmd(setup, 'correction_create', correctionPayload);
  await setup.query('commit');
  await race('correction_review', { id: correctionA.id, expected_version: correctionA.row_version, decision: 'APPROVE', reason }, 'correction_review', { id: correctionB.id, expected_version: correctionB.row_version, decision: 'APPROVE', reason }, '23505', 'admin');
  console.log('PASS: competing correction approvals cannot own the same observed code, agency and month');
  await begin(setup);
  const version = { scope_id: scope, bud: 'C1', vendor_account_ref: 'SYNTHETIC-' + actor, plan: 'Synthetic monthly', cost_type: 'TOOL', payment_method: 'CORPORATE_CARD', amount_per_cycle: '80.00', frequency: 'MONTHLY', start_date: month, end_date: '2094-09-30', evidence_ref: reason,
    occurrences: [{ cycle_no: 1, charge_date: '2094-09-05', coverage_start: month, coverage_end: month, expected_amount: '80.00' }],
    covers: [{ memo_id: memo.id, bud: 'C1', coverage_start: month, coverage_end: month, cap_amount: '80.00', component_id: component.id, evidence_ref: reason }] };
  const commitmentA = await cmd(setup, 'commitment_create', { vendor: 'Synthetic vendor A', version });
  const commitmentB = await cmd(setup, 'commitment_create', { vendor: 'Synthetic vendor B', version });
  await setup.query('commit');
  await race('commitment_activate', { id: commitmentA.id, expected_version: commitmentA.row_version, version_id: commitmentA.versions[0].id, expected_current_version_id: null, acknowledgements }, 'commitment_activate', { id: commitmentB.id, expected_version: commitmentB.row_version, version_id: commitmentB.versions[0].id, expected_current_version_id: null, acknowledgements }, '23514');
  assert.equal((await read('commitments', commitmentB.id)).state, 'DRAFT');
  console.log('PASS: competing commitment covers cannot reserve more than the same applicable line component');

  await begin(setup);
  const statement = await cmd(setup, 'statement_create', { operator_ref: reason, issuer: 'Synthetic', cycle_start: '2026-09-01', cycle_end: '2026-09-30', due_date: '2026-10-15', declared_total: '1.00', total_meaning: 'NET_CHARGES', evidence_ref: reason, review_status: 'CONFIRMED' });
  const importPayload = { statement_control_id: statement.id, logical_source_id: reason, source_file: 'synthetic.csv', tab: 'Synthetic', profile_id: 'synthetic', profile_version: '1', provenance: {}, rows: [{ row_no: 2, row_hash: createHash('sha256').update(reason).digest('hex'), raw_row: {}, amount: '1.00', direction: 'DEBIT', charge_date: '2026-09-05', cost_type: 'CHANNEL', bud: 'C1' }] };
  await setup.query('commit');
  const replayPayload = { ...importPayload, source_fingerprint: createHash('sha256').update(reason + 'A').digest('hex') };
  const batchA = await race('card_import', replayPayload, 'card_import', replayPayload, null);
  console.log('PASS: concurrent identical card imports return one batch and one harmless replay');
  await begin(setup);
  const batchB = await cmd(setup, 'card_import', { ...importPayload, source_fingerprint: createHash('sha256').update(reason + 'B').digest('hex') });
  await setup.query('commit');
  await race('card_batch_confirm', { id: batchA.id, expected_version: batchA.row_version, expected_previous_batch_id: null, reason }, 'card_batch_replace', { id: batchB.id, expected_version: batchB.row_version, expected_previous_batch_id: null, reason }, '40001');
  assert.equal((await setup.query("select count(*)::int n from staging.ads_card_batch where statement_control_id=$1 and status='CONFIRMED'", [statement.id])).rows[0].n, 1);
  console.log('PASS: concurrent statement interpretations cannot create two applicable batches');
} finally {
  await first.query('rollback').catch(() => {});
  await pending?.catch(() => {});
  await second.query('rollback').catch(() => {});
  await setup.query('rollback').catch(() => {});
  await setup.query('begin');
  // Local superuser fixture cleanup only; application roles cannot DELETE.
  await setup.query("set local session_replication_role='replica'");
  for (const table of ['ads.cost_allocation', 'ads.cost_allocation_set', 'ads.cost_record', 'staging.ads_card_row', 'staging.ads_card_batch', 'ads.card_statement_control', 'ads.commitment_occurrence', 'ads.commitment_memo_cover', 'ads.commitment_version', 'ads.recurring_commitment', 'ads.correction_target', 'ads.correction', 'ads.line_budget_item', 'ads.media_line_component', 'ads.media_line_revision', 'ads.line_assignment', 'ads.media_line', 'ads.memo_identifier', 'ads.memo']) await setup.query(`delete from ${table} where created_by=$1`, [actor]);
  await setup.query('delete from ads.campaign_name where code in(select code from ads.campaign_registration where scope_id=$1)', [scope]);
  await setup.query('delete from ads.campaign_registration where scope_id=$1', [scope]);
  await setup.query('delete from ads.scope_member where scope_id=any($1::uuid[])', [[scope, phase]]);
  await setup.query('delete from ads.scope_code where scope_id=any($1::uuid[])', [[scope, phase]]);
  await setup.query('delete from audit.change_log where actor=$1', [actor]);
  await setup.query('commit');
  await Promise.all([setup.end(), first.end(), second.end()]);
}
