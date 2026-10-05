import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
await assertDisposableTestDatabase();
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { exportViews } from '../../scripts/provision-dw-reader.mjs';

const folder = new URL('./fixtures/ads_export/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', folder), 'utf8'));
const data = {};
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('all 15 TEST views match their frozen checksums, schema and exact decimals', async () => {
  assert.equal(manifest.synthetic_only, true);
  assert.equal(manifest.environment, 'local-test');
  assert.equal(manifest.source_key, 'hub');
  assert.match(manifest.hub_commit, /^[a-f0-9]{40}$/);
  assert.equal(manifest.transaction.role, 'dw_hub_reader');
  assert.equal(manifest.transaction.isolation, 'repeatable read');
  assert.equal(manifest.transaction.read_only, true);
  assert.equal(manifest.transaction.snapshot_shared_with_provenance_checks, true);
  assert.deepEqual(manifest.views.map(view => view.view), exportViews.map(view => `ads_export.${view}`));
  for (const view of manifest.views) {
    const bytes = await readFile(new URL(view.file, folder));
    assert.equal(sha256(bytes), view.sha256, view.view);
    const rows = JSON.parse(bytes);
    assert.equal(rows.length, view.row_count, view.view);
    assert.ok(rows.length > 0, `Missing contract example: ${view.view}`);
    data[view.view.slice('ads_export.'.length)] = rows;
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), view.columns.map(column => column.name).sort());
      for (const column of view.columns) {
        const value = row[column.name];
        if (value === null) continue;
        if (column.fixture_encoding === 'decimal_string') {
          assert.equal(typeof value, 'string');
          assert.match(value, /^-?\d+(?:\.\d+)?$/);
        }
        const moneyKey = { budget_items: 'amount', cost_breakdown: 'amount', memo_covers: 'cap_amount' }[column.name];
        if (moneyKey) for (const item of value) {
          assert.equal(typeof item[moneyKey], 'string');
          assert.match(item[moneyKey], /^\d+\.\d{2}$/);
        }
      }
    }
  }
  for (const migration of manifest.migration_checksums) {
    const bytes = await readFile(new URL(`../migrations/${migration.file}`, import.meta.url));
    assert.equal(sha256(bytes.toString('utf8').replace(/\r\n/g, '\n')), migration.normalized_lf_sha256, migration.file);
  }
  for (const generator of manifest.generator_checksums) {
    const bytes = await readFile(new URL(`../../${generator.file}`, import.meta.url));
    assert.equal(sha256(bytes.toString('utf8').replace(/\r\n/g, '\n')), generator.normalized_lf_sha256, generator.file);
  }
});

test('fixtures preserve supersession, foreign keys, applied corrections and annual satang', () => {
  const codes = new Set(data.campaign_registration.map(row => row.code));
  const scopes = new Set(data.scope_code.map(row => row.scope_id));
  const names = new Set(data.campaign_name.map(row => row.name_id));
  const memos = new Set(data.memo.map(row => row.id));
  const lines = new Set(data.media_line.map(row => row.line_id));
  for (const row of data.campaign_registration) assert.ok(scopes.has(row.scope_id));
  for (const row of data.campaign_name) assert.ok(codes.has(row.code));
  for (const row of data.native_binding) { assert.ok(codes.has(row.code)); assert.ok(names.has(row.name_id)); }
  for (const row of data.memo_identifier) assert.ok(memos.has(row.memo_id));
  for (const row of data.line_assignment) { assert.ok(codes.has(row.code)); assert.ok(lines.has(row.line_id)); }
  assert.ok(data.memo_identifier.some(row => row.kind === 'ALIAS' && row.status === 'CONFIRMED'));
  assert.ok(data.correction.some(row => row.is_applied && lines.has(row.line_id)));
  assert.ok(data.native_binding.some(row => row.account_id.startsWith('000000DWTEST')));
  const revisions = new Map();
  for (const row of data.media_line.filter(row => row.is_applicable)) {
    if (!revisions.has(row.line_id)) revisions.set(row.line_id, new Set());
    revisions.get(row.line_id).add(row.revision_id);
  }
  for (const values of revisions.values()) assert.equal(values.size, 1);
  assert.ok(data.media_line.some(row => row.revision_status === 'SUPERSEDED' && !row.is_applicable));
  const annual = data.cost_record.find(row => row.charge_date === '2095-12-25' && row.amount === '1199.99' && row.is_applicable);
  assert.ok(annual);
  const allocations = data.cost_allocation.filter(row => row.cost_id === annual.id && row.is_applicable).sort((a, b) => a.month.localeCompare(b.month));
  assert.equal(allocations.length, 12);
  assert.deepEqual(allocations.map(row => row.amount), [...Array(11).fill('100.00'), '99.99']);
  assert.equal(allocations.reduce((sum, row) => sum + BigInt(row.amount.replace('.', '')), 0n), 119999n);
  assert.ok(data.recurring_commitment.some(row => row.is_applicable && row.frequency === 'ANNUAL'));
});
