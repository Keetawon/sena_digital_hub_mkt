import { expect, test, type Page } from '@playwright/test';
import { mockWorkspaceProjection } from './unified-workspace-helpers';
import { openMobileMenu, closeMobileMenu } from './hub-navigation-helpers';
import { contentScopeText } from '../../apps/admin/lib/content-scope-text';
import type { HubAccount } from '../../apps/admin/lib/hub-permissions';
import { unavailableMessage } from '../../apps/admin/lib/hub-account';

const origin = 'http://127.0.0.1:3000';
const projectId = 'CONTENT-SCOPE-UI';
const actor = '66000000-0000-4000-8000-000000000003';
const authored = 'My authored input is preserved';
const sourceText = 'Synthetic previously permitted project';

function gate() {
  let release!: () => void, enter!: () => void;
  return { waiting: new Promise<void>(resolve => { release = resolve; }), requested: new Promise<void>(resolve => { enter = resolve; }),
    release: () => release(), enter: () => enter() };
}

async function fixture(page: Page) {
  expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role: 'admin' } })).ok()).toBeTruthy();
  const response = await page.request.get('/api/hub/v1/me');
  expect(response.ok()).toBeTruthy();
  const actual = (await response.json()).data as HubAccount;
  const project = { public_project_id: projectId, public_name: { th: sourceText }, slug: 'content-scope-ui',
    updated_at: '2026-11-05T03:00:00Z', published_version_id: null, publication_available: false,
    readiness: { ready: false, percent: 0, missing: [] }, models: [], assets: [], commercial_types: [],
    meta_title: { th: 'Synthetic untouched source field' }, meta_description: { th: 'Synthetic source description' },
    source: { rem_project_id: projectId, project_name_rem: 'Synthetic reference', rem_brand_id: null, brand_name_rem: null, source_record: null, intake_manifest_sha256: null } };
  const state = { account: { ...actual, content_scope: { fingerprint: 'scope-before', expires_at: null as string | null } },
    status: 200, nameStatus: 200, meCalls: 0, nameCalls: 0, projectCalls: 0, name: 'Synthetic current actor', writes: 0 };
  const holds = new Map<string, ReturnType<typeof gate>>();
  const hold = (kind: string) => { const value = gate(); holds.set(kind, value); return value; };
  async function wait(kind: string) { const pending = holds.get(kind); if (pending) { holds.delete(kind); pending.enter(); await pending.waiting; } }
  await page.route('**/api/hub/v1/me', async route => {
    state.meCalls++;
    const data = structuredClone(state.account), status = state.status;
    await wait('me');
    await route.fulfill(status === 200 ? { json: { data } } : { status, json: { error: { code: 'synthetic_unavailable' } } });
  });
  await page.route('**/api/hub/v1/accounts/display-names', async route => {
    state.nameCalls++;
    const data = [{ id: actor, display_name_th: state.name }], status = state.nameStatus;
    await wait('names');
    await route.fulfill(status === 200 ? { json: { data } } : { status, json: { error: { code: 'content_authority_changed', invalidate_access: true } } });
  });
  await mockWorkspaceProjection(page, project);
  await page.route(`**/api/hub/v1/admin/projects/${projectId}`, async route => {
    if (route.request().method() !== 'GET') { state.writes++; return route.fulfill({ status: 409, json: { error: { code: 'unexpected_write' } } }); }
    state.projectCalls++;
    const data = structuredClone(project);
    await wait('project');
    await route.fulfill({ json: { data } });
  });
  await page.route(`**/api/hub/v1/admin/projects/${projectId}/versions`, route => route.fulfill({ json: { data: [] } }));
  await page.route('**/api/hub/v1/admin/content/fields', route => route.fulfill({ json: { data: { items: [], email_domains: [] } } }));
  await page.route('**/api/hub/v1/admin/content-workflow/**', route => route.fulfill({ json: { data: { scope: { level: 'project', id: projectId, phase: projectId }, items: [], next_cursor: null } } }));
  return { state, project, hold };
}

async function refresh(page: Page) { await page.evaluate(() => window.dispatchEvent(new Event('hub-accounts-changed'))); }
async function open(page: Page, state: Awaited<ReturnType<typeof fixture>>['state'], tab = 'data&section=identity') {
  await page.goto(`/website/project/${projectId}?tab=${tab}`);
  if (tab.startsWith('data')) await expect(page.locator('#public_name')).toBeEditable();
  else await expect(page.locator('.workspace-timeline')).toBeVisible();
  const before = state.meCalls, namesBefore = state.nameCalls;
  await refresh(page);
  await expect.poll(() => state.meCalls).toBeGreaterThan(before);
  await expect.poll(() => state.nameCalls).toBeGreaterThan(namesBefore);
  if (tab.startsWith('data')) await expect(page.locator('#public_name')).toBeEditable();
}
function recovery(page: Page) { return page.locator('aside.registry-panel').filter({ has: page.locator('textarea[readonly]') }); }
async function closed(page: Page) {
  await expect(page.getByRole('heading', { name: sourceText, exact: true })).toHaveCount(0);
  await expect(page.locator('#public_name')).toHaveCount(0);
  await expect.poll(() => recovery(page).locator('textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value))).toContain(authored);
  await expect(recovery(page)).not.toContainText('Synthetic untouched source field');
}

test('deadline closes cached source immediately, keeps authored input and stays closed after a failed refresh', async ({ page }) => {
  const epoch = new Date('2026-11-05T03:00:00Z');
  await page.clock.install({ time: epoch }); await page.clock.pauseAt(epoch);
  const { state, hold } = await fixture(page);
  state.account.content_scope.expires_at = new Date(epoch.getTime() + 5_000).toISOString();
  await open(page, state);
  await page.locator('#public_name').fill(authored);
  state.status = 503;
  const pending = hold('me');
  await page.clock.fastForward(5_000);
  await pending.requested;
  await closed(page);
  await expect(page.getByRole('alert').filter({ hasText: contentScopeText.scope_loss })).toBeVisible();
  pending.release();
  await expect(page.getByRole('alert').filter({ hasText: unavailableMessage })).toBeVisible();
  await closed(page);
  // Scope expiry does not revoke unrelated account management or Ads grants.
  await openMobileMenu(page);
  await expect(page.locator('nav a[href="/admin/accounts"]')).toBeVisible();
  await closeMobileMenu(page);
  state.status = 200; state.account.content_scope = { fingerprint: 'scope-after', expires_at: null };
  await refresh(page);
  await expect(page.locator('#public_name')).toBeEditable();
  await expect.poll(() => recovery(page).locator('textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value))).toContain(authored);
  expect(state.writes).toBe(0);
});

test('explicit transport invalidation closes source before delayed /me and preserves same-account authored text', async ({ page }) => {
  const { state, hold } = await fixture(page);
  await open(page, state);
  await page.locator('#public_name').fill(authored);
  const pending = hold('me');
  await page.route('**/api/hub/v1/admin/content/search?**', route => route.fulfill({ status: 403,
    json: { error: { code: 'content_authority_changed', invalidate_access: true } } }));
  const search = page.locator('.hub-service-search .workspace-search input, .hub-topbar .workspace-search input, .workspace-search input').first();
  await search.fill('Synthetic authority check');
  await pending.requested;
  await closed(page);
  pending.release();
  await expect(page.locator('#public_name')).toBeEditable();
  await expect.poll(() => recovery(page).locator('textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value))).toContain(authored);
  expect(state.writes).toBe(0);
});

test('same base grants with changed scope discard old data; a real identity switch also clears recovery', async ({ page }) => {
  const { state, hold } = await fixture(page);
  await open(page, state);
  await page.locator('#public_name').fill(authored);
  const source = hold('project');
  state.account.content_scope.fingerprint = 'scope-after';
  await refresh(page);
  await source.requested;
  await expect(page.locator('#public_name')).toHaveCount(0);
  await expect(recovery(page).locator('textarea')).toHaveValue(authored);
  source.release();
  await expect(page.locator('#public_name')).toBeEditable();
  await expect(recovery(page).locator('textarea')).toHaveValue(authored);
  state.account = { ...state.account, id: '66000000-0000-4000-8000-000000000099' };
  await refresh(page);
  await expect(recovery(page)).toHaveCount(0);
  await expect(page.locator('#public_name')).toBeEditable();
});

test('account helper invalidation clears content while its fresh projection is still pending', async ({ page }) => {
  const { state, hold } = await fixture(page);
  await open(page, state);
  await page.locator('#public_name').fill(authored);
  state.nameStatus = 403;
  const names = hold('names');
  await refresh(page); await names.requested;
  const me = hold('me');
  names.release(); await me.requested;
  await closed(page);
  state.nameStatus = 200;
  me.release();
  await expect(page.locator('#public_name')).toBeEditable();
  await expect(recovery(page).locator('textarea')).toHaveValue(authored);
});

test('a refresh queued during /me discards its stale completion and performs the newer request', async ({ page }) => {
  const { state, hold } = await fixture(page);
  await open(page, state);
  await page.locator('#public_name').fill(authored);
  const previous = state.meCalls;
  const pending = hold('me');
  await refresh(page); await pending.requested;
  state.account = { ...state.account, status: 'SUSPENDED' };
  await refresh(page);
  pending.release();
  await expect.poll(() => state.meCalls).toBeGreaterThanOrEqual(previous + 2);
  await closed(page);
  expect(state.writes).toBe(0);
});

test('slow old display names neither block fresh authority nor repopulate a newer identity', async ({ page }) => {
  const { state, hold } = await fixture(page);
  await page.route(`**/api/hub/v1/admin/content/workspace/project/${projectId}/history?**`, route => route.fulfill({ json: { data: {
    items: [{ audit_id: '1', occurred_at: '2026-11-05T03:00:00Z', actor: { id: actor }, action: 'edit', entity: { kind: 'project', ref: projectId, name: { th: sourceText } },
      source_tab: 'projects', section_key: 'identity', reason: null, version: null, target: { level: 'project', id: projectId, tab: 'data', section: 'identity' }, diff_available: false }], next_cursor: null,
  } } }));
  await open(page, state, 'history');
  await expect(page.locator('.workspace-timeline')).toContainText(state.name);
  state.name = 'Synthetic delayed old actor';
  const pending = hold('names');
  await refresh(page); await pending.requested;
  state.account = { ...state.account, id: '66000000-0000-4000-8000-000000000098' };
  state.name = 'Synthetic newer actor';
  const count = state.meCalls;
  await refresh(page);
  await expect.poll(() => state.meCalls).toBeGreaterThan(count);
  await expect(page.locator('.workspace-timeline')).toContainText(state.name);
  pending.release();
  await expect(page.locator('.workspace-timeline')).not.toContainText('Synthetic delayed old actor');
  await expect(page.locator('.workspace-timeline')).toContainText(state.name);
});

test('a delayed search cannot return revoked results after a same-grant scope change', async ({ page }) => {
  const { state } = await fixture(page);
  await open(page, state);
  const pending = gate();
  let calls = 0;
  await page.route('**/api/hub/v1/admin/content/search?**', async route => {
    const call = ++calls;
    if (call === 1) { pending.enter(); await pending.waiting; }
    await route.fulfill({ json: { data: { items: [{ kind: 'project', ref: 'permitted-neighbour', href: '/website/project/permitted-neighbour',
      label: { th: call === 1 ? 'Synthetic revoked search result' : 'Synthetic allowed search neighbour' } }] } } });
  });
  let search = page.locator('.workspace-search input').first();
  await search.fill('Synthetic'); await pending.requested;
  state.account.content_scope.fingerprint = 'scope-after';
  await refresh(page);
  await expect(page.locator('.workspace-search input').first()).toHaveValue('');
  pending.release();
  await expect(page.getByRole('option', { name: 'Synthetic revoked search result' })).toHaveCount(0);
  search = page.locator('.workspace-search input').first();
  await search.fill('Synthetic neighbour');
  await expect(page.getByRole('option', { name: 'Synthetic allowed search neighbour' })).toBeVisible();
});

test('unrestricted content remains open across a later clock boundary', async ({ page }) => {
  const epoch = new Date('2026-11-05T03:00:00Z');
  await page.clock.install({ time: epoch }); await page.clock.pauseAt(epoch);
  const { state } = await fixture(page);
  await open(page, state);
  await page.locator('#public_name').fill(authored);
  await page.clock.fastForward(10_000);
  await expect(page.locator('#public_name')).toHaveValue(authored);
  await expect(recovery(page)).toHaveCount(0);
  expect(state.writes).toBe(0);
});
