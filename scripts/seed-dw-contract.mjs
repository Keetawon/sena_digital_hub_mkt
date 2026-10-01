// Local synthetic contract examples. Called only by export-dw-fixtures.mjs --seed.
// Every write uses the existing guarded commands; the caller owns one transaction.
export async function seedDwContract(client) {
  const marker = 'SYNTHETIC-DW-CONTRACT-V1';
  await client.query('select pg_advisory_xact_lock(1560015)');
  const existing = await client.query('select id from ads.memo where evidence_ref=$1', [marker]);
  if (existing.rowCount) return;
  const scope = '30000000-0000-0000-0000-000000000001';
  await client.query("set local role admin");
  await client.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true),set_config('app.change_reason',$1,true)", [marker]);
  const call = async (action, payload) => (await client.query('select ads.finance_command($1,$2::jsonb) result', [action, JSON.stringify(payload)])).rows[0].result;
  const memo = async (memo_no, gross_amount) => {
    let result = await call('memo_create', { memo_no, subject: marker, requesting_bud: 'C1', gross_amount,
      mirrored_status: 'APPROVED', approval_date: '2026-10-01', evidence_ref: marker });
    return call('memo_confirm', { id: result.id, expected_version: result.row_version });
  };
  const lineMemo = await memo('MO9610997', '100.00');
  const annualMemo = await memo('MO9610998', '1199.99');
  let alias = await call('memo_identifier_propose', { memo_id: annualMemo.id, identifier: 'SYNTHETIC-DW-ANNUAL-ALIAS', reason: marker, evidence_ref: marker });
  await call('memo_identifier_review', { id: alias.id, expected_version: alias.row_version, decision: 'APPROVE', reason: marker });
  const components = [{ component_kind: 'PHASE', rem_project_id: '00001', formatted_mapping: 'C-DEMO-TEST1',
    bud: 'C1', gross_amount: '100.00', memo_id: lineMemo.id, fee_po_ref: 'SYNTHETIC-PO-000001',
    budget_items: [{ cost_type: 'MEDIA', payment_method: 'AGENCY_PO_INVOICE', amount: '100.00' }] }];
  let line = await call('line_create', { kind: 'GROUP', scope_id: scope, month: '2096-10-01', agency: 'KIN', reason: marker, components });
  line = await call('revision_confirm', { id: line.id, revision_id: line.revisions[0].id, expected_revision_id: null, acknowledgements: [] });
  const previous = line.current_revision_id;
  line = await call('revision_create', { id: line.id, expected_version: line.row_version, reason: marker + '-SUPERSESSION', components });
  line = await call('revision_confirm', { id: line.id, revision_id: line.revisions[0].id, expected_revision_id: previous, acknowledgements: [] });
  const issued = (await client.query("select ads.issue_registration($1::uuid,'LEADS','KIN') result", [scope])).rows[0].result;
  const code = issued.registration.code;
  await client.query("select ads.bind_native($1,$2::uuid,'GOOGLE','000000DWTESTACCOUNT','000000DWTESTCAMPAIGN')", [code, issued.names[0].name_id]);
  await call('assignment_create', { code, month: '2096-10-01', line_id: line.id, expected_revision_id: line.current_revision_id });
  let correction = await call('correction_create', { observed_code: 'C-DEMO-OLD99', agency: 'KIN', month_from: '2096-10-01', month_to: '2096-10-01',
    reason: marker, evidence_ref: marker, targets: [{ month: '2096-10-01', line_id: line.id }] });
  correction = await call('correction_review', { id: correction.id, expected_version: correction.row_version, decision: 'APPROVE', reason: marker });
  await call('correction_apply', { id: correction.id, expected_version: correction.row_version, months: ['2096-10-01'], reason: marker });
  for (const type of ['ad', 'channel']) {
    const account = await call(`${type}_account_create`, { ...(type === 'ad' ? { platform: 'GOOGLE' } : { channel: 'LINE_OA' }),
      account_id: `000000DWTEST${type.toUpperCase()}`, label: marker,
      mapping: { scope_id: scope, ...(type === 'ad' ? { agency: 'KIN' } : { plan: 'SYNTHETIC-MONTHLY', expected_amount: '100.00' }),
        bud: 'C1', valid_from: '2096-01-01', valid_to: '2097-01-01', evidence_ref: marker } });
    await call(`${type}_account_version_confirm`, { id: account.id, mapping_id: account.mappings[0].id, expected_version: account.mappings[0].row_version });
  }
  let commitment = await call('commitment_create', { vendor: marker, version: {
    vendor_account_ref: '000000DWTESTTOOL', scope_id: scope, bud: 'C1', plan: 'SYNTHETIC-ANNUAL', cost_type: 'TOOL',
    payment_method: 'CORPORATE_CARD', amount_per_cycle: '1199.99', frequency: 'ANNUAL', start_date: '2096-01-01', end_date: '2096-12-31', evidence_ref: marker,
    occurrences: [{ cycle_no: 1, charge_date: '2095-12-25', coverage_start: '2096-01-01', coverage_end: '2096-12-01', expected_amount: '1199.99' }],
    covers: [{ memo_id: annualMemo.id, bud: 'C1', coverage_start: '2096-01-01', coverage_end: '2096-12-01', cap_amount: '1199.99', evidence_ref: marker }] } });
  commitment = await call('commitment_activate', { id: commitment.id, expected_version: commitment.row_version,
    version_id: commitment.versions[0].id, expected_current_version_id: null, acknowledgements: [] });
  const occurrence = commitment.versions.find(v => v.status === 'CONFIRMED').occurrences[0];
  const statement = await call('statement_create', { operator_ref: marker, issuer: 'SYNTHETIC-BANK', cycle_start: '2095-12-01', cycle_end: '2095-12-31',
    due_date: '2096-01-15', declared_total: '1199.99', total_meaning: 'NET_CHARGES', evidence_ref: marker, review_status: 'CONFIRMED' });
  let batch = await call('card_import', { source_fingerprint: 'd'.repeat(64), statement_control_id: statement.id, logical_source_id: marker,
    source_file: 'synthetic-dw-contract.csv', tab: 'SYNTHETIC', profile_id: 'SYNTHETIC-DW-CONTRACT', profile_version: '1', provenance: { synthetic: true }, issues: [],
    rows: [{ row_no: 2, row_hash: 'e'.repeat(64), raw_row: { Category: 'TOOL', BUD: 'C1', Detail: marker },
      cost_type: 'TOOL', payment_method: 'CORPORATE_CARD', amount: '1199.99', direction: 'DEBIT', charge_date: '2095-12-25', bud: 'C1' }] });
  const row = batch.rows[0];
  batch = await call('cost_classify', { source_row_id: row.id, expected_version: row.row_version, costs: [{ cost_type: 'TOOL', amount: '1199.99',
    direction: 'DEBIT', scope_id: scope, bud: 'C1', vendor: marker, memo_id: annualMemo.id, commitment_occurrence_id: occurrence.id,
    evidence_refs: { M: marker, S: marker, V: marker, C: marker } }] });
  batch = await call('card_batch_confirm', { id: batch.id, expected_version: batch.row_version, expected_previous_batch_id: null, reason: marker });
  const cost = batch.rows[0].costs.find(c => c.status === 'CONFIRMED');
  await call('cost_allocate', { id: cost.id, expected_version: cost.row_version, expected_allocation_set_id: null, method: 'EQUAL_MONTHS',
    coverage_start: '2096-01-01', coverage_end: '2096-12-01', scope_id: scope, bud: 'C1', reason: marker });
  await client.query('reset role');
}
