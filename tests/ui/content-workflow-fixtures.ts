import { expect, request, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { workflowText, publicationSelectionKey, type PublicationSelection, type WorkflowKind, type WorkflowSnapshot, type WorkflowTarget } from '../../apps/admin/lib/content-workflow';

export { workflowText };
export const workflowHeaders = { Origin: 'http://127.0.0.1:3000' };
export const adminApi = '/api/hub/v1/admin';
export async function persona(page: Page, role: string) {
  expect((await page.request.post('/api/local-session', { headers: workflowHeaders, data: { role } })).ok()).toBeTruthy();
}
export async function readData<T = any>(page: Page, endpoint: string): Promise<T> {
  const response = await page.request.get(endpoint); expect(response.ok(), endpoint).toBeTruthy(); return (await response.json()).data;
}
export function workflowControl(root: Page | Locator, kind: WorkflowKind) { return root.locator(`[data-workflow-kind="${kind}"]:visible`); }
export async function submitItem(root: Page | Locator, kind: WorkflowKind) {
  const control = workflowControl(root, kind);
  await control.getByRole('button', { name: workflowText.submit, exact: true }).click();
  await expect(control.locator('.workflow-state')).toHaveText(new RegExp('^' + workflowText.IN_REVIEW));
}
export async function approveItem(page: Page, root: Page | Locator, kind: WorkflowKind) {
  await workflowControl(root, kind).getByRole('button', { name: workflowText.approve, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(workflowText.reason, { exact: true }).fill('Independent review of synthetic fixture');
  await dialog.getByRole('button', { name: workflowText.approve, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(workflowControl(root, kind).locator('.workflow-state')).toHaveText(new RegExp('^' + workflowText.APPROVED));
}
export async function realWorkflowApproval(page: Page, target: WorkflowTarget) {
  const endpoint = adminApi + '/content-workflow?' + new URLSearchParams({ kind: target.kind, identity: JSON.stringify(target.identity) });
  await persona(page, 'editor'); let item = await readData<WorkflowSnapshot>(page, endpoint);
  if (item.state.toUpperCase() === 'APPROVED' && !item.needs_reapproval) return;
  if (item.can_submit) {
    const response = await page.request.post(adminApi + '/content-workflow/submit', { headers: workflowHeaders, data: { ...target, expected_hash: item.expected_hash } });
    expect(response.ok(), `${target.kind} submit`).toBeTruthy();
  }
  await persona(page, 'publisher'); item = await readData<WorkflowSnapshot>(page, endpoint);
  expect(item.can_approve, `${target.kind} is independently reviewable`).toBe(true);
  const response = await page.request.post(adminApi + '/content-workflow/review', { headers: workflowHeaders,
    data: { ...target, expected_hash: item.expected_hash, decision: 'approve', reason: 'Independent synthetic fixture review' } });
  expect(response.ok(), `${target.kind} approve`).toBeTruthy();
}
/** Normal authenticated permission API; the existing global setup attests the disposable run. */
export async function publishingGrant() {
  expect(process.env.HUB_DISPOSABLE_TEST_RUN).toBeTruthy();
  const manager = await request.newContext({ baseURL: workflowHeaders.Origin });
  expect((await manager.post('/api/local-session', { headers: workflowHeaders, data: { role: 'admin' } })).ok()).toBeTruthy();
  const id = '00000000-0000-0000-0000-000000000003';
  async function current() {
    const response = await manager.get(adminApi + '/accounts'); expect(response.ok()).toBeTruthy();
    const account = (await response.json()).data.items.find((row: { id: string }) => row.id === id);
    expect(account).toBeTruthy(); return account;
  }
  const original = structuredClone((await current()).access), granted = structuredClone(original);
  for (const tab of ['projects', 'brands', 'promotions', 'releases', 'knowledge']) granted.tabs[tab] = [...new Set([...(granted.tabs[tab] ?? []), 'view'])];
  granted.tabs.knowledge = [...new Set([...granted.tabs.knowledge, 'knowledge.publish_web'])];
  async function apply(access: typeof original) {
    const account = await current();
    const response = await manager.post(`${adminApi}/accounts/${id}/permissions`, { headers: workflowHeaders, data: {
      tabs: access.tabs, template: access.template, can_manage_users: access.can_manage_users, updated_at: account.updated_at,
      note: 'Scoped synthetic browser publication fixture',
    } });
    expect(response.status()).toBe(200);
  }
  let restored = false;
  async function restore() { if (!restored) { restored = true; try { await apply(original); } finally { await manager.dispose(); } } }
  try { await apply(granted); } catch (error) { await restore(); throw error; }
  return { role: 'viewer' as const, enable: () => apply(granted), disable: () => apply(original), restore };
}
/** Only the finite identities used by the legacy source snapshot, not all workspace drafts. */
export async function approveLegacySource(page: Page, kind: 'project' | 'brand', publicId: string) {
  await persona(page, 'editor');
  const row = await readData(page, `${adminApi}/${kind === 'brand' ? 'brands' : 'projects'}/${publicId}`);
  expect(row.id, 'A saved native entity UUID is required').toBeTruthy();
  expect(row.publication_preview_redacted, 'Only the complete authorized export may select fixture dependencies').not.toBe(true);
  const preview = row.publication_preview;
  expect(preview).toBeTruthy();
  const targets: WorkflowTarget[] = [{ kind, identity: { id: row.id } }];
  const media = (items: any[], exported: any[], bindingKind: 'project_asset' | 'brand_asset' | 'type_asset') => {
    for (const output of exported ?? []) {
      const matches = (items ?? []).filter(item => output.public_asset_id === 'ast_' + (item.checksum || createHash('sha256').update(item.id).digest('hex'))
        && item.asset_role === output.asset_role && (item.public_model_id ?? null) === (output.public_model_id ?? null)
        && item.display_order === output.display_order && (item.is_primary ?? false) === (output.is_primary ?? false));
      expect(matches, 'An included media node resolves to one exact saved binding').toHaveLength(1);
      const item = matches[0];
      targets.push({ kind: 'asset', identity: { id: item.id } }, { kind: bindingKind, identity: { id: item.binding_id } });
    }
  };
  media(row.assets, preview.assets, kind === 'brand' ? 'brand_asset' : 'project_asset');
  if (kind === 'project') {
    if (row.brand_id) {
      const brand = (await readData<any[]>(page, adminApi + '/brands')).find(item => item.id === row.brand_id);
      expect(brand, 'Only the exact linked brand is a prerequisite').toBeTruthy();
      const reviewedBrand = await approveLegacySource(page, 'brand', brand.public_brand_id);
      await persona(page, 'viewer');
      const review = await preparePublication(page, [{ system: 'release', entity_type: 'brand', entity_id: reviewedBrand.id }], 'Publish the independently approved linked fixture brand');
      await confirmPublication(page, review);
    }
    for (const exported of preview.models ?? []) {
      const model = (row.models ?? []).find((item: any) => item.public_model_id === exported.public_model_id);
      expect(model?.id).toBeTruthy(); targets.push({ kind: 'model', identity: { id: model.id } });
    }
    // Staff commercial_types are not part of the legacy draft payload. Only an
    // explicitly exported type can introduce a native unit certificate.
    for (const exported of preview.commercial_types ?? []) {
      const item = (row.commercial_types ?? []).find((item: any) => item.public_commercial_type_id === exported.public_commercial_type_id);
      expect(item?.id).toBeTruthy(); targets.push({ kind: 'unit_type', identity: { id: item.id } }); media(item.assets, exported.assets, 'type_asset');
    }
    for (const item of (row.facilities?.items ?? []).filter((item: any) => item.updated_at)) targets.push({ kind: 'facility', identity: { project_id: row.id, facility_code: item.code } });
  }
  const seen = new Set<string>();
  for (const target of targets) {
    const key = JSON.stringify(target); if (seen.has(key)) continue; seen.add(key);
    expect(Object.values(target.identity).every(Boolean), `${target.kind} has its exact native identity`).toBe(true);
    await realWorkflowApproval(page, target);
  }
  return row;
}
export async function preparePublication(page: Page, selections: PublicationSelection[], reason: string) {
  await page.goto('/publish');
  await refreshSyntheticAuthority(page);
  for (const item of selections) await page.locator(`[data-publication-target="${publicationSelectionKey(item)}"]`).getByRole('checkbox').check();
  const prepare = page.locator('.publication-workspace > form');
  const action = prepare.getByRole('button', { name: `${workflowText.prepare_review} (${selections.length})`, exact: true });
  await expect(prepare.getByLabel(workflowText.reason, { exact: true })).toHaveAttribute('required');
  await expect(action).toBeDisabled();
  await prepare.getByLabel(workflowText.reason, { exact: true }).fill('   '); await expect(action).toBeDisabled();
  await prepare.getByLabel(workflowText.reason, { exact: true }).fill(reason);
  await action.click();
  const review = page.getByRole('region', { name: workflowText.review_publication, exact: true });
  await expect(review.locator('.publication-reviewed-page')).toHaveCount(selections.length);
  return review;
}
export async function clickPublication(review: Locator) {
  const publish = review.getByRole('button', { name: workflowText.publish, exact: true });
  // Settle the viewport before dispatching beside the sandboxed preview frame.
  // The ordinary click still checks visibility, stability and enabled state.
  await publish.scrollIntoViewIfNeeded();
  await expect(publish).toBeInViewport({ ratio: 1 });
  await publish.click();
}
export async function confirmPublication(page: Page, review: Locator) {
  const publish = review.getByRole('button', { name: workflowText.publish, exact: true });
  await expect(publish).toBeDisabled();
  await review.getByRole('checkbox', { name: workflowText.confirm_publication, exact: true }).check();
  await clickPublication(review);
  await expect(review.getByRole('heading', { name: workflowText.publication_results, exact: true })).toBeVisible();
}
export async function sourceHistory(page: Page, kind: 'project' | 'brand' | 'promotion', publicId: string) {
  await page.goto('/publish?' + new URLSearchParams({ source: kind, id: publicId }));
  await refreshSyntheticAuthority(page);
  const region = page.locator(`[data-publication-source="${kind}:${publicId}"]`); await expect(region).toBeVisible(); return region;
}
export async function confirmSourceCommand(page: Page, button: Locator, reason: string) {
  await button.click(); const dialog = page.getByRole('dialog'), confirm = dialog.locator('button[type="submit"], button.primary');
  await expect(confirm).toBeDisabled();
  const input = dialog.getByLabel(workflowText.reason, { exact: true }); await expect(input).toHaveAttribute('required');
  await input.fill('   '); await expect(confirm).toBeDisabled();
  await input.fill(reason); await expect(confirm).toBeDisabled();
  await dialog.getByRole('checkbox').check(); await confirm.click(); await expect(dialog).toHaveCount(0);
}

/** Explicit browser-only authority for synthetic projection tests, never a real grant. */
export async function mockWorkflowReads(page: Page, { role = 'publisher', publish = false }: { role?: string; publish?: boolean } = {}) {
  const account = await readData(page, '/api/hub/v1/me');
  const edit = role === 'editor', approve = role === 'publisher';
  const data = { ...account, capabilities: { ...account.capabilities,
    tabs: { ...account.capabilities.tabs, ...Object.fromEntries(['projects', 'brands', 'promotions', 'knowledge', 'releases'].map(tab => [tab, { view: true, edit, approve }])) },
    special_actions: { ...account.capabilities.special_actions, 'knowledge.publish_web': publish } } };
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data } }));
  await page.route(`**${adminApi}/publication-queue`, route => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ json: { data: { items: [], web_history: [], release_history: [], can_publish: publish } } });
  });
  await page.route(`**${adminApi}/web`, route => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ json: { data: { pages: [], can_publish: publish } } });
  });
  await page.route('**/api/hub/v1/admin/content-workflow**', route => {
    expect(route.request().method()).toBe('GET'); const query = new URL(route.request().url()).searchParams;
    const result = new URL(route.request().url()).pathname.endsWith('/items')
      ? { scope: { level: query.get('level'), id: query.get('id'), phase: query.get('phase') }, items: [], next_cursor: null }
      : { kind: query.get('kind'), identity: JSON.parse(query.get('identity')!), expected_hash: 'a'.repeat(64), source_revision: null, source_updated_at: null,
        source_tab: query.get('kind') === 'brand' ? 'brands' : 'projects', source_tabs: [query.get('kind') === 'brand' ? 'brands' : 'projects'], state: 'DRAFT',
        version_id: null, version_no: null, approved_by: null, approved_at: null, decision_reason: null, self_approval: false, needs_reapproval: false,
        can_edit: edit, can_submit: false, can_approve: false, can_return: false, can_withdraw: false, can_save_approve: false, approval_requires_reason: false, history: [] };
    return route.fulfill({ json: { data: result } });
  });
}
export async function refreshSyntheticAuthority(page: Page) {
  // HubShell mounts its children only after AccountDirectory has installed its
  // refresh listener. Waiting on an actual page heading avoids an early event.
  await page.locator('main h1').first().waitFor();
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/hub/v1/me');
  await page.evaluate(() => window.dispatchEvent(new Event('hub-accounts-changed'))); await refreshed;
}

/** Transport fixtures only for tests that already mock their source projections. */
export async function mockReleaseQueue(page: Page, candidates: any[], writes: { path: string; body: any }[] = []) {
  const publicationId = '79000000-0000-4000-8000-000000000001', releaseId = '79000000-0000-4000-8000-000000000002';
  const versionId = '79000000-0000-4000-8000-000000000003', digest = 'b'.repeat(64);
  let failPrepare = false, staleId: string | null = null, review: any = null;
  const releases: any[] = [];
  const descriptor = (row: any) => ({ label: typeof row.title === 'string' ? { th: row.title } : row.title,
    target: null, href: null, workflow: null, can_return: false });
  const member = (row: any) => ({ entity_type: row.entity_type, entity_id: row.entity_id, public_id: row.public_id });
  await page.route(`**${adminApi}/publication-queue**`, async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (method === 'GET') return route.fulfill({ json: { data: { items: candidates.map(row => ({ system: 'release', ...member(row), ...descriptor(row) })), web_history: review ? [review] : [], release_history: releases, can_publish: true } } });
    const body = route.request().postDataJSON(); writes.push({ path: path.slice(adminApi.length + 1), body });
    if (path.endsWith('/prepare')) {
      if (failPrepare) { failPrepare = false; return route.fulfill({ status: 409, json: { error: { message: workflowText.stale_item } } }); }
      const selected = body.selections.map((item: any) => candidates.find(row => row.entity_type === item.entity_type && row.entity_id === item.entity_id));
      expect(selected.every(Boolean)).toBe(true);
      review = { id: publicationId, state: 'IN_REVIEW', reason: body.reason, digest, created_at: '2026-10-02T00:00:00Z', page_count: selected.length, can_publish: true,
        pages: selected.map((row: any) => ({ system: 'release', member: member(row), ...descriptor(row), hash: 'c'.repeat(64), preview: row.preview ?? { public_name: row.title }, previous: row.previous ?? null,
          previous_redacted: false, preview_redacted: false, items: [{ item_key: row.entity_id, ...descriptor(row), status: 'APPROVED' }] })) };
      return route.fulfill({ json: { data: { id: publicationId } } });
    }
    expect(path).toBe(adminApi + '/publication-queue/publish');
    expect(body).toEqual({ publication_id: publicationId, expected_digest: digest });
    const accepted = review.pages.filter((item: any) => item.member.entity_id !== staleId);
    releases.push({ id: releaseId, status: 'PUBLISHED', change_reason: review.reason, published_at: '2026-10-02T00:00:00Z', published_by: '00000000-0000-0000-0000-000000000003',
      rolled_back_at: null, rolled_back_by: null, rollback_reason: null, members: accepted.map((item: any) => ({ ...item.member, before_version_id: null, after_version_id: versionId })) });
    const outcomes = review.pages.map((item: any) => ({ system: 'release', member: item.member, label: item.label, target: item.target, href: item.href, workflow: null, can_return: false, status: item.member.entity_id === staleId ? 'REJECTED' : 'PUBLISHED',
      ...(item.member.entity_id === staleId ? { code: 'stale' } : { release_id: releaseId }) }));
    review.state = staleId ? 'PARTIAL' : 'PUBLISHED';
    return route.fulfill({ json: { data: { id: publicationId, state: review.state, page_count: accepted.length, outcomes } } });
  });
  await page.route(`**${adminApi}/web`, route => route.fulfill({ json: { data: { pages: [], can_publish: true } } }));
  await page.route(`**${adminApi}/web/publications/${publicationId}?*`, route => route.fulfill({ json: { data: review } }));
  await page.route(`**${adminApi}/releases/${releaseId}**`, route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); writes.push({ path: `releases/${releaseId}/rollback`, body });
      Object.assign(releases[0], { status: 'ROLLED_BACK', rollback_reason: body.change_reason, rolled_back_at: '2026-10-02T01:00:00Z', rolled_back_by: '00000000-0000-0000-0000-000000000003' });
    }
    return route.fulfill({ json: { data: releases[0] } });
  });
  return { writes, digest, publicationId, releaseId, releases, failNextPrepare: () => { failPrepare = true; }, rejectStale: (id: string) => { staleId = id; } };
}
