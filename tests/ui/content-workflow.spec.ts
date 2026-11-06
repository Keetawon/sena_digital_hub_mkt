import { expect, test } from '@playwright/test';
import { emptyCapabilities, type CapabilityProjection } from '../../apps/admin/lib/hub-permissions';
import { publicationHref, publicationSelection, submitWorkflowItems, workflowAllowed, workflowCommand, workflowKey, workflowReadPath, workflowMatchesSource,
  loadWorkflowInventory, workflowSubmissionAllowed, workflowSubmitCommand, type WorkflowInventoryItem, type WorkflowInventoryPage,
  type PublicationCandidate, type WorkflowSnapshot, type WorkflowSubmissionSnapshot } from '../../apps/admin/lib/content-workflow';

const hash = 'a'.repeat(64), id = '11111111-1111-4111-8111-111111111111';
const caps = (levels: ('view' | 'edit' | 'approve')[], tab = 'projects'): CapabilityProjection => ({ ...emptyCapabilities, tabs: { [tab]: Object.fromEntries(levels.map(level => [level, true])) } });
function item(extra: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return { kind: 'section', identity: { id }, source_tab: 'projects', source_tabs: ['projects'], expected_hash: hash,
    source_revision: 4, source_updated_at: '2026-11-04T09:00:00+00:00',
    state: 'DRAFT', version_id: null, version_no: null, approved_by: null, approved_at: null, decision_reason: null,
    self_approval: false, needs_reapproval: false, can_edit: true, can_approve: false, can_submit: true, can_return: false,
    can_withdraw: false, can_save_approve: false, approval_requires_reason: false, history: [], ...extra } as WorkflowSnapshot;
}

test('ordinary View never advertises commands and object flags can deny otherwise granted tabs', () => {
  for (const action of ['submit', 'approve', 'return', 'withdraw', 'save_approve'] as const) expect(workflowAllowed(caps(['view']), item({ can_approve: true, can_return: true, can_save_approve: true }), action)).toBe(false);
  expect(workflowAllowed(caps(['view', 'edit']), item({ can_submit: false }), 'submit')).toBe(false);
  expect(workflowAllowed(caps(['view', 'approve']), item({ state: 'IN_REVIEW', can_approve: false, can_return: false }), 'approve')).toBe(false);
  expect(workflowAllowed(caps(['view', 'approve']), item({ state: 'IN_REVIEW', can_return: false }), 'return')).toBe(false);
});

test('N1 save-and-approve is available on an editable draft independently of the current review flag', () => {
  const draft = item({ can_save_approve: true, can_approve: false });
  expect(workflowAllowed(caps(['view', 'edit', 'approve']), draft, 'save_approve')).toBe(true);
  expect(workflowAllowed(caps(['view', 'approve']), draft, 'save_approve')).toBe(false);
  expect(workflowAllowed(caps(['view', 'edit']), draft, 'save_approve')).toBe(false);
  expect(workflowAllowed(caps(['view', 'edit', 'approve']), { ...draft, can_save_approve: false }, 'save_approve')).toBe(false);
});

test('promotions keep DATA and LEGAL outside generic commands, and shared sources require every View', () => {
  for (const action of ['submit', 'approve', 'return', 'withdraw', 'save_approve'] as const) expect(workflowAllowed(caps(['view', 'edit', 'approve'], 'promotions'), item({ kind: 'promotion', source_tabs: ['promotions'], source_tab: 'promotions', can_save_approve: true }), action)).toBe(false);
  expect(workflowAllowed(caps(['view', 'edit', 'approve']), item({ source_tabs: ['projects', 'brands'] }), 'submit')).toBe(false);
  expect(workflowAllowed(caps(['view', 'edit']), item({ expected_hash: 'wrong-revision' }), 'submit')).toBe(false);
});

test('FAQ draft withdrawal is author-specific while submitted withdrawal requires Approve', () => {
  const draft = item({ kind: 'faq', source_tab: 'knowledge', source_tabs: ['knowledge'], can_withdraw: true });
  expect(workflowAllowed(caps(['view', 'edit'], 'knowledge'), draft, 'withdraw')).toBe(true);
  expect(workflowAllowed(caps(['view', 'edit'], 'knowledge'), { ...draft, can_withdraw: false }, 'withdraw')).toBe(false);
  expect(workflowAllowed(caps(['view', 'edit'], 'knowledge'), { ...draft, state: 'IN_REVIEW' }, 'withdraw')).toBe(false);
  expect(workflowAllowed(caps(['view', 'approve'], 'knowledge'), { ...draft, state: 'IN_REVIEW' }, 'withdraw')).toBe(true);
  expect(workflowAllowed(caps(['view', 'approve']), item({ state: 'APPROVED', can_withdraw: true }), 'withdraw')).toBe(false);
});

test('staged evidence drift can block approval while preserving a server-authorized return', () => {
  const drifted = item({ state: 'IN_REVIEW', needs_reapproval: true, can_approve: false, can_return: true });
  expect(workflowAllowed(caps(['view', 'approve']), drifted, 'approve')).toBe(false);
  expect(workflowAllowed(caps(['view', 'approve']), drifted, 'return')).toBe(true);
});

test('atomic save-and-approve retains the ordinary form payload and exact displayed source hash', () => {
  const changes = { body: { th: 'Synthetic edited draft' }, ai_exposure: 'internal' };
  const command = workflowCommand(item(), 'save_approve', { reason: '  Checked source  ', changes, sourceStamp: { revision: 4 } });
  expect(command).toEqual({ path: 'v1/admin/content-workflow/save-approve', body: { kind: 'section', identity: { id }, expected_hash: hash, changes, reason: 'Checked source' } });
  expect(changes).toEqual({ body: { th: 'Synthetic edited draft' }, ai_exposure: 'internal' });
  expect(() => workflowCommand(item(), 'save_approve', { changes })).toThrow('reason_required');
  expect(() => workflowCommand(item(), 'save_approve', { reason: 'Checked' })).toThrow('draft_required');
  expect(() => workflowCommand(item(), 'save_approve', { reason: 'Checked', changes, sourceStamp: { revision: 3 } })).toThrow('source_changed');
  expect(() => workflowCommand(item(), 'save_approve', { reason: 'Checked', changes })).toThrow('source_changed');
});

test('workflow metadata cannot authorize a different loaded form stamp', () => {
  expect(workflowMatchesSource(item(), { revision: 4 })).toBe(true);
  expect(workflowMatchesSource(item(), { updated_at: '2026-11-04T09:00:00+00:00' })).toBe(true);
  expect(workflowMatchesSource(item(), { revision: 3 })).toBe(false);
  expect(workflowMatchesSource(item(), { revision: 4, updated_at: '2026-11-03T09:00:00+00:00' })).toBe(false);
  expect(workflowMatchesSource(item({ source_revision: null }), { revision: 0 })).toBe(false);
});

test('own approvals and returns require reasons while an independent approval keeps its exact identity', () => {
  expect(() => workflowCommand(item({ approval_requires_reason: true }), 'approve', { reason: ' ' })).toThrow('reason_required');
  expect(() => workflowCommand(item(), 'return')).toThrow('reason_required');
  expect(() => workflowCommand(item({ kind: 'faq' }), 'withdraw')).toThrow('reason_required');
  const source = item({ kind: 'building', identity: { project_id: id, building_key: 'B-01' } });
  const command = workflowCommand(source, 'approve');
  expect(command.body).toEqual({ kind: 'building', identity: { project_id: id, building_key: 'B-01' }, expected_hash: hash, decision: 'approve' });
  const query = new URL(workflowReadPath(source), 'https://example.test/').searchParams;
  expect(JSON.parse(query.get('identity')!)).toEqual(source.identity);
});

test('submit-all keeps an individual conflict and continues the next saved item without refreshing its hash', async () => {
  const first = item(), second = item({ identity: { id: '22222222-2222-4222-8222-222222222222' }, expected_hash: 'b'.repeat(64) });
  const calls: WorkflowSubmissionSnapshot[] = [];
  const outcomes = await submitWorkflowItems([{ label: 'First', snapshot: first }, { label: 'First duplicate', snapshot: first }, { label: 'Second', snapshot: second }], async saved => {
    calls.push(saved); if (workflowKey(saved) === workflowKey(first)) throw Object.assign(new Error('stale'), { status: 409 }); return { ...saved, state: 'IN_REVIEW' };
  });
  expect(calls.map(value => [workflowKey(value), value.expected_hash])).toEqual([[workflowKey(first), hash], [workflowKey(second), 'b'.repeat(64)]]);
  expect(outcomes.map(value => value.status)).toEqual(['failed', 'submitted']);
  expect(outcomes[0].snapshot).toBe(first);
});

test('publication selection strips extra workflow data and source links stay server-owned local paths', () => {
  const candidate: PublicationCandidate = { system: 'release', entity_type: 'project', entity_id: id, public_id: 'prj_exact', label: { th: 'Synthetic project' }, href: '/website/project/prj_exact?tab=data', workflow: { kind: 'project', identity: { id }, expected_hash: hash }, can_return: true };
  expect(publicationSelection(candidate)).toEqual({ system: 'release', entity_type: 'project', entity_id: id });
  expect(publicationHref(candidate)).toBe(candidate.href);
  expect(publicationHref({ ...candidate, href: 'https://example.test/unsafe' })).toBeNull();
  expect(publicationHref({ ...candidate, href: '//example.test/unsafe' })).toBeNull();
  const unavailable = { ...candidate, href: null, target: { level: 'project', id: 'do-not-guess' } };
  expect(publicationHref(unavailable)).toBeNull();
});

function inventoryItem(extra: Partial<WorkflowInventoryItem> = {}): WorkflowInventoryItem {
  return { kind: 'section', identity: { id }, expected_hash: hash, source_revision: 4, source_updated_at: null,
    state: 'DRAFT', can_edit: true, can_submit: true, source_tab: 'projects', source_tabs: ['projects'],
    label: { th: 'Synthetic saved section' }, target: { level: 'project', id: 'prj_exact', tab: 'data', section: 'narrative', item: id },
    href: '/website/project/prj_exact?tab=data&section=narrative&item=' + id, ...extra } as WorkflowInventoryItem;
}
const inventoryScope = { level: 'project' as const, id: 'prj_exact', phase: 'REM-EXACT' };

test('header inventory consumes all pages and minimal submission metadata without per-item hydration', async () => {
  const first = inventoryItem(), second = inventoryItem({ identity: { id: '22222222-2222-4222-8222-222222222222' }, expected_hash: 'b'.repeat(64) });
  const paths: string[] = [];
  const result = await loadWorkflowInventory({ level: 'project', id: 'prj_exact' }, async path => {
    paths.push(path); return { scope: inventoryScope, items: paths.length === 1 ? [first] : [first, second], next_cursor: paths.length === 1 ? 'scoped-cursor' : null };
  });
  expect(result).toEqual({ scope: inventoryScope, items: [first, second] }); expect(paths).toHaveLength(2);
  expect(Object.fromEntries(new URL(paths[0], 'https://example.test/').searchParams)).toEqual({ level: 'project', id: 'prj_exact', limit: '100' });
  expect(Object.fromEntries(new URL(paths[1], 'https://example.test/').searchParams)).toEqual({ level: 'project', id: 'prj_exact', limit: '100', phase: 'REM-EXACT', after: 'scoped-cursor' });
  expect(result.items[0]).not.toHaveProperty('history'); expect(result.items[0]).not.toHaveProperty('can_approve');
  expect(workflowSubmissionAllowed(caps(['view', 'edit']), first)).toBe(true);
  expect(workflowSubmissionAllowed(caps(['view']), first)).toBe(false);
  expect(workflowSubmitCommand(first)).toEqual({ path: 'v1/admin/content-workflow/submit', body: { kind: 'section', identity: { id }, expected_hash: hash } });
});

test('incomplete inventory and a later denied page never resolve a partial submittable list', async () => {
  let calls = 0;
  await expect(loadWorkflowInventory(inventoryScope, async () => {
    calls += 1; if (calls === 2) throw { status: 403 };
    return { scope: inventoryScope, items: [inventoryItem()], next_cursor: 'next-page' };
  })).rejects.toMatchObject({ status: 403 }); expect(calls).toBe(2);
});

for (const failure of ['phase', 'identity', 'cursor', 'hash'] as const) test(`header inventory refuses ${failure} drift without replacing earlier hashes`, async () => {
  let calls = 0;
  await expect(loadWorkflowInventory(inventoryScope, async () => {
    calls += 1;
    const value: WorkflowInventoryPage = { scope: inventoryScope, items: [inventoryItem()], next_cursor: calls === 1 ? 'next-page' : null };
    if (calls === 2) {
      if (failure === 'phase') value.scope = { ...inventoryScope, phase: 'OTHER-PHASE' };
      if (failure === 'identity') value.scope = { ...inventoryScope, id: 'prj_other' };
      if (failure === 'cursor') value.next_cursor = 'next-page';
      if (failure === 'hash') value.items = [inventoryItem({ expected_hash: 'c'.repeat(64) })];
    }
    return value;
  })).rejects.toThrow(failure === 'cursor' ? 'invalid_inventory_cursor' : failure === 'hash' ? 'source_changed' : 'invalid_inventory_scope');
  expect(calls).toBe(2);
});

test('inventory cancels between pages when dirty forms or authority make the request obsolete', async () => {
  let current = true, calls = 0;
  await expect(loadWorkflowInventory(inventoryScope, async () => {
    calls += 1; current = false;
    return { scope: inventoryScope, items: [inventoryItem()], next_cursor: 'next-page' };
  }, () => current)).rejects.toMatchObject({ code: 'inventory_cancelled' }); expect(calls).toBe(1);
});

test('inventory enforces the resource bound rather than silently submitting a truncated result', async () => {
  let calls = 0;
  await expect(loadWorkflowInventory(inventoryScope, async () => ({ scope: inventoryScope, items: [], next_cursor: 'page-' + ++calls }))).rejects.toThrow('inventory_limit');
  expect(calls).toBe(100);
});
