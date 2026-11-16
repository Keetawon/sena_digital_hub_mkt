import { expect, test, type Page } from '@playwright/test';
import { contentScopeText as T } from '../../apps/admin/lib/content-scope-text';

type Selection = { mode: 'all' | 'selected'; bu_ids: string[]; project_ids: string[] };
const tabs = ['projects', 'brands', 'knowledge', 'promotions', 'releases'];
const levels = ['view', 'edit', 'approve'];
const all = (): Selection => ({ mode: 'all', bu_ids: [], project_ids: [] });
const future = '2099-01-01T00:00:00Z';
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

async function fixture(page: Page) {
  const directoryResponse = await page.request.get('/api/hub/v1/admin/accounts'); expect(directoryResponse.ok()).toBe(true);
  const directory = (await directoryResponse.json()).data;
  const target = directory.items.find((item: any) => item.id !== directory.actor_id && item.status === 'ACTIVE' && item.hub_role === 'viewer'); expect(target).toBeTruthy();
  const catalog = (await (await page.request.get('/api/hub/v1/admin/permissions/catalog')).json()).data;
  const accountResponse = await page.request.get('/api/hub/v1/me'); expect(accountResponse.ok()).toBe(true);
  const accountProjection = await accountResponse.json();
  const scopes: Record<string, Selection> = Object.fromEntries(tabs.flatMap(tab => levels.map(level => [`${tab}:${level}`, all()])));
  const projectRows = Array.from({ length: 151 }, (_, index) => ({ id: String(index + 1).padStart(4, '0'), name: `Project ${index + 1}`, rem_bu_id: index < 150 ? ' BU ' : null, rem_bu_code: index < 150 ? ' BUD C1 ' : null, rem_bu_name: index < 150 ? ' Exact name ' : null }));
  const state = { scopes, previews: [] as any[], applications: [] as any[], settingsWrites: [] as any[], settingsRevision: 1, days: 7, stale: false, settingsStale: false, denied: false, managerOnly: false,
    delay: null as { query: string; gate: ReturnType<typeof deferred> } | null, historyCalls: [] as string[] };
  await page.route('**/api/hub/v1/me', async route => {
    const body = structuredClone(accountProjection);
    if (state.denied) body.data.capabilities.can_manage_users = false;
    if (state.managerOnly) { body.data.hub_role = 'viewer'; body.data.role = 'viewer'; }
    await route.fulfill({ json: body });
  });
  await page.route('**/api/hub/v1/admin/accounts/content-scopes?*', async route => {
    const params = new URL(route.request().url()).searchParams, query = params.get('q') ?? '';
    if (state.delay?.query === query) await state.delay.gate.promise;
    if (state.denied) { await route.fulfill({ status: 403, json: { error: { code: 'content_scope_permission' } } }); return; }
    let items: { id: string; name?: string; rem_bu_id?: string | null; rem_bu_code: string | null; rem_bu_name: string | null }[] = params.get('reference_kind') === 'bus' ? [{ id: ' BU ', rem_bu_code: ' BUD C1 ', rem_bu_name: ' Exact name ' }, { id: '001', rem_bu_code: 'BusinessUnit1', rem_bu_name: null }] : projectRows;
    if (params.has('bu_id')) items = items.filter((item: any) => item.rem_bu_id === params.get('bu_id'));
    if (query) items = items.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
    const after = params.get('after'), limit = Number(params.get('limit') ?? 100);
    items = items.filter(item => after === null || item.id > after).sort((a, b) => a.id.localeCompare(b.id));
    const next = items.length > limit ? items[limit - 1].id : null; items = items.slice(0, limit);
    const historyAfter = params.get('history_after'); if (params.has('history_limit')) state.historyCalls.push(historyAfter ?? 'first');
    const history = { id: historyAfter ? 'history-2' : 'history-1', account_id: target.id, tab: 'projects', level: 'view', project_id: historyAfter ? '0002' : '0001', project_name: historyAfter ? 'History second' : 'History first', direction: historyAfter ? 'gain' : 'loss', reason: 'handover_end', effective_at: '2030-01-01T01:00:00Z', observed_at: '2030-01-02T01:00:00Z' };
    await route.fulfill({ json: { data: { account_id: params.get('account_id'), scopes: tabs.flatMap(tab => levels.map(level => ({ tab, level, scope: { ...scopes[`${tab}:${level}`], revision: 1 } }))), items, next_cursor: next, effective_history: { items: [history], next_cursor: historyAfter ? null : 'history-page-two' } } } }).catch(() => {});
  });
  await page.route('**/api/hub/v1/admin/accounts/bu-sync-runs?*', route => route.fulfill({ json: { data: { items: [{ id: 'run-1', status: 'FAILED', source_watermark: null, accepted_at: null, recorded_at: '2030-01-02T01:00:00Z', row_count: 0, failure_code: 'read_failed', current: false, deadline: null }], next_cursor: null } } }));
  await page.route('**/api/hub/v1/admin/permissions/preview', async route => {
    const body = route.request().postDataJSON(); if (body.change.kind !== 'content_scope') { await route.fallback(); return; }
    state.previews.push(body);
    if (state.delay?.query === 'preview') await state.delay.gate.promise;
    const effect = { gained: ['0001'], lost: ['0002'] };
    await route.fulfill({ json: { data: { kind: 'content_scope', tab: body.change.tab, level: body.change.level, digest: 'a'.repeat(64), change_count: 1, targets: [{ account_id: target.id, before: scopes[`${body.change.tab}:${body.change.level}`], after: body.change.scope, effects: { view: effect, edit: effect, approve: effect }, gained: effect.gained, lost: effect.lost, future_bu_members: body.change.scope.bu_ids.length > 0 }], excluded: [], scope_state: { expires_at: future } } } }).catch(() => {});
  });
  await page.route('**/api/hub/v1/admin/permissions/apply', async route => {
    const body = route.request().postDataJSON(); if (body.change.kind !== 'content_scope') { await route.fallback(); return; }
    state.applications.push(body);
    if (state.stale) { state.stale = false; await route.fulfill({ status: 409, json: { error: { code: 'permission_preview_stale' } } }); return; }
    scopes[`${body.change.tab}:${body.change.level}`] = body.change.scope;
    await route.fulfill({ json: { data: { batch_id: 'synthetic-batch', changed_count: 1, items: [{ account_id: target.id, scope: body.change.scope }] } } });
  });
  await page.route('**/api/hub/v1/admin/accounts/content-scope-settings**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (state.managerOnly || state.denied) { await route.fulfill({ status: 403, json: { error: { code: 'content_scope_permission' } } }); return; }
    if (path.endsWith('/preview')) { const body = route.request().postDataJSON(); state.settingsWrites.push(body); await route.fulfill({ json: { data: { grace_days: body.grace_days, revision: state.settingsRevision, digest: 'b'.repeat(64), change_count: 1, complete: true, changes: [{ account_id: target.id, tab: 'projects', level: 'view', project_id: '0002', direction: 'loss' }], scope_state: { expires_at: future } } } }); }
    else if (path.endsWith('/apply')) { const body = route.request().postDataJSON(); state.settingsWrites.push(body); if (state.settingsStale) { state.settingsStale = false; state.days = 5; state.settingsRevision++; await route.fulfill({ status: 409, json: { error: { code: 'permission_preview_stale' } } }); return; } state.days = body.grace_days; state.settingsRevision++; await route.fulfill({ json: { data: { grace_days: state.days, revision: state.settingsRevision } } }); }
    else await route.fulfill({ json: { data: { grace_days: state.days, revision: state.settingsRevision } } });
  });
  async function open(level = 'view') {
    await page.goto('/admin/accounts'); await page.locator('#tab-users').click();
    await page.locator('.account-table tbody tr').filter({ hasText: target.email }).getByRole('button').click();
    const panel = page.getByRole('dialog'), grant = panel.locator('.scope-grants > section').filter({ has: page.getByRole('heading', { name: catalog.tabs.find((tab: any) => tab.tab === 'projects').label_th, exact: true }) });
    await grant.locator('.scope-levels > div').nth(levels.indexOf(level)).getByRole('button').click();
    return panel.locator('.scope-editor');
  }
  return { state, open, target, catalog };
}

test.beforeEach(async ({ context }) => { await context.addCookies([{ name: 'sena_local_persona', value: 'admin', url: 'http://127.0.0.1:3000' }]); });
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'wait' }); });

test('independent scope confirmation preserves exact BU IDs and paged project exceptions', async ({ page }) => {
  const { state, open } = await fixture(page), editor = await open();
  await editor.getByRole('radio', { name: T.scope_selected, exact: true }).check();
  const bu = editor.locator('.scope-bu > label input[aria-label="BUD  BUD C1   BU "]'); await bu.check(); await expect(bu).toHaveAttribute('aria-label', 'BUD  BUD C1   BU ');
  const tree = editor.locator('.scope-bu').filter({ has: page.getByRole('checkbox', { name: 'BUD  BUD C1   BU ', exact: true }) });
  await tree.locator('summary').click();
  await tree.getByRole('button', { name: T.scope_load_more, exact: true }).click();
  await tree.getByRole('checkbox', { name: `${T.scope_project_exception} Project 101 0101`, exact: true }).check();
  await expect(tree.getByText(T.scope_bu_included, { exact: true }).first()).toBeVisible();
  await editor.getByRole('button', { name: T.scope_preview, exact: true }).click();
  await expect(editor.locator('.scope-preview')).toContainText(T.scope_gained);
  await expect(editor.locator('.scope-preview')).toContainText(T.scope_lost);
  expect(state.previews.at(-1).change.scope).toEqual({ mode: 'selected', bu_ids: [' BU '], project_ids: ['0101'] });
  expect(state.applications).toHaveLength(0);
  await editor.getByRole('checkbox', { name: T.scope_confirm, exact: true }).check();
  await editor.getByRole('button', { name: T.scope_confirm, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: T.scope_saved })).toBeVisible();
  expect(state.applications).toHaveLength(1); expect(state.applications[0].digest).toBe('a'.repeat(64));
  expect(state.scopes['projects:view'].bu_ids).toEqual([' BU ']); expect(state.scopes['projects:edit']).toEqual(all()); expect(state.scopes['projects:approve']).toEqual(all());
});

for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark'] as const) test(`the future-members explanation describes every BUD checkbox at ${width}px ${colorScheme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  const { state, open } = await fixture(page), editor = await open();
  await editor.getByRole('radio', { name: T.scope_selected, exact: true }).check();
  const explanation = editor.locator('.scope-tree > p', { hasText: T.scope_future_members });
  await expect(explanation).toHaveCount(1);
  const descriptionId = await explanation.getAttribute('id');
  expect(descriptionId).toBeTruthy();
  const buBoxes = editor.locator('.scope-bu > label input[type="checkbox"]');
  await expect(buBoxes).toHaveCount(2);
  for (const box of await buBoxes.all()) await expect(box).toHaveAttribute('aria-describedby', descriptionId!);
  await expect(editor.getByText(T.scope_future_members, { exact: true })).toHaveCount(1);
  await buBoxes.first().check();
  await editor.screenshot({ path: `artifacts/unified-workspace/polish-p1/after/scope-loaded-${width}-${colorScheme}.png` });
  await editor.getByRole('button', { name: T.scope_preview, exact: true }).click();
  await expect(editor.locator('.scope-preview')).toContainText(T.scope_future_members);
  expect(state.applications).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('stale confirmation preserves selections and requires a new preview', async ({ page }) => {
  const { state, open } = await fixture(page), editor = await open('edit'); state.stale = true;
  await editor.getByRole('radio', { name: T.scope_selected, exact: true }).check();
  await expect(editor).toContainText(T.scope_empty_selected);
  await editor.getByRole('checkbox', { name: `${T.scope_project_exception} Project 1 0001`, exact: true }).check();
  await editor.getByRole('button', { name: T.scope_preview, exact: true }).click();
  await editor.getByRole('checkbox', { name: T.scope_confirm, exact: true }).check(); await editor.getByRole('button', { name: T.scope_confirm, exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: T.scope_stale })).toBeVisible();
  await expect(editor.getByRole('checkbox', { name: `${T.scope_project_exception} Project 1 0001`, exact: true })).toBeChecked();
  await expect(editor.locator('.scope-preview')).toHaveCount(0); expect(state.scopes['projects:edit']).toEqual(all());
  await editor.getByRole('button', { name: T.scope_preview, exact: true }).click();
  await expect(editor.getByRole('checkbox', { name: T.scope_confirm, exact: true })).not.toBeChecked();
  expect(state.previews).toHaveLength(2); expect(state.applications).toHaveLength(1);
});

test('delayed search and closed-panel responses cannot replace current results', async ({ page }) => {
  const { state, open } = await fixture(page), editor = await open();
  await editor.getByRole('radio', { name: T.scope_selected, exact: true }).check();
  const gate = deferred(); state.delay = { query: 'Project 1', gate };
  await editor.getByLabel(T.scope_search, { exact: true }).fill('Project 1');
  await editor.getByLabel(T.scope_search, { exact: true }).fill('Project 151');
  await expect(editor.getByRole('checkbox', { name: `${T.scope_project_exception} Project 151 0151`, exact: true })).toBeVisible();
  gate.release(); await expect(editor.getByRole('checkbox', { name: `${T.scope_project_exception} Project 1 0001`, exact: true })).toHaveCount(0);
  const previewGate = deferred(); state.delay = { query: 'preview', gate: previewGate };
  await editor.getByRole('checkbox', { name: `${T.scope_project_exception} Project 151 0151`, exact: true }).check();
  await editor.getByRole('button', { name: T.scope_preview, exact: true }).click();
  await expect.poll(() => state.previews.length).toBe(1); await page.keyboard.press('Escape'); previewGate.release();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.applications).toHaveLength(0);
});

test('revocation during a delayed preview hides payload and cannot enable confirm', async ({ page }) => {
  const { state, open } = await fixture(page), editor = await open();
  await editor.getByRole('radio', { name: T.scope_selected, exact: true }).check();
  const gate = deferred(); state.delay = { query: 'preview', gate };
  await editor.getByRole('button', { name: T.scope_preview, exact: true }).click(); await expect.poll(() => state.previews.length).toBe(1);
  state.denied = true; gate.release();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.account-table')).toHaveCount(0);
  await expect(page.locator('#main-content > .registry-panel > h1')).toBeVisible();
  await expect(page.getByRole('button', { name: T.scope_confirm, exact: true })).toHaveCount(0);
  await expect(page.locator('.scope-preview')).toHaveCount(0); expect(state.applications).toHaveLength(0);
});

test('bounded effective history paging never resets an unsaved scope selection', async ({ page }) => {
  const { state, open } = await fixture(page), editor = await open();
  await editor.getByRole('radio', { name: T.scope_selected, exact: true }).check();
  await editor.getByRole('checkbox', { name: `${T.scope_project_exception} Project 1 0001`, exact: true }).check();
  const history = page.getByRole('region', { name: T.scope_history, exact: true });
  await expect(history).toContainText(T.scope_loss); await expect(history).toContainText(T.scope_effective_at); await expect(history).toContainText(T.scope_observed_at);
  await history.getByRole('button', { name: T.scope_load_more, exact: true }).click(); await expect(history).toContainText('History second');
  expect(state.historyCalls).toContain('history-page-two'); await history.getByRole('button', { name: T.refresh, exact: true }).click();
  await expect(editor.getByRole('checkbox', { name: `${T.scope_project_exception} Project 1 0001`, exact: true })).toBeChecked();
});

test('grace uses explicit Admin preview and confirmation while managers only see run history', async ({ page }) => {
  const { state } = await fixture(page); await page.goto('/admin/accounts');
  await page.locator('.scope-settings > summary').click(); const settings = page.locator('.scope-settings');
  await settings.getByRole('combobox', { name: T.scope_grace, exact: true }).selectOption('3');
  await settings.getByRole('button', { name: T.scope_settings_preview, exact: true }).click();
  await expect(settings.locator('.scope-preview')).toContainText('0002'); expect(state.settingsWrites).toHaveLength(1);
  await settings.getByRole('checkbox', { name: T.scope_settings_confirm, exact: true }).check(); await settings.getByRole('button', { name: T.scope_settings_confirm, exact: true }).click();
  await expect(settings.getByRole('status').filter({ hasText: T.scope_settings_saved })).toBeVisible();
  expect(state.settingsWrites.at(-1)).toMatchObject({ grace_days: 3, expected_revision: 1, digest: 'b'.repeat(64), confirmed: true });
  state.managerOnly = true; await page.evaluate(() => window.dispatchEvent(new Event('hub-accounts-changed')));
  await expect(page.locator('.scope-settings')).toHaveCount(0); await expect(page.getByText(T.scope_admin_only, { exact: true })).toBeVisible();
  await page.locator('.scope-management > details > summary').click(); await expect(page.locator('.scope-runs')).toContainText(T.scope_sync_failed);
});

for (const colorScheme of ['light', 'dark'] as const) for (const width of [1280, 390]) test(`scope controls fit ${width}px with keyboard focus and reduced motion in ${colorScheme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  const { open } = await fixture(page), editor = await open(); await editor.getByRole('radio', { name: T.scope_selected, exact: true }).check();
  await editor.getByLabel(T.scope_search, { exact: true }).focus(); await page.keyboard.press('Tab');
  const active = await page.evaluate(() => { const element = document.activeElement!; return { outline: getComputedStyle(element).outlineStyle, animation: getComputedStyle(element).animationName }; });
  expect(active.outline).not.toBe('none'); expect(active.animation).toBe('none'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dialog = page.getByRole('dialog'), bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/unified-workspace/w6/scopes-${width}-${colorScheme}.png` });
});


test('unsaved base grants block scope writes without erasing selected exceptions', async ({ page }) => {
  const { state, open, catalog } = await fixture(page), editor = await open();
  await editor.getByRole('radio', { name: T.scope_selected, exact: true }).check();
  const chosen = editor.getByRole('checkbox', { name: `${T.scope_project_exception} Project 1 0001`, exact: true }); await chosen.check();
  const row = page.getByRole('dialog').locator('.permission-grid tbody tr').filter({ hasText: catalog.tabs.find((tab: any) => tab.tab === 'projects').label_th }).first();
  const ordinaryView = row.locator('.permission-cell input').first(); await ordinaryView.click();
  await expect(page.getByText(T.scope_save_base_first, { exact: true })).toBeVisible(); await expect(chosen).toBeChecked();
  await expect(editor.getByRole('button', { name: T.scope_preview, exact: true })).toBeDisabled(); expect(state.previews).toHaveLength(0);
  await ordinaryView.click(); await expect(editor.getByRole('button', { name: T.scope_preview, exact: true })).toBeEnabled(); await expect(chosen).toBeChecked();
});

test('saved selections absent from the current BU page can be explicitly removed', async ({ page }) => {
  const { state, open } = await fixture(page); state.scopes['projects:view'] = { mode: 'selected', bu_ids: ['OLD BU'], project_ids: ['OLD PROJECT'] };
  const editor = await open(); await editor.getByRole('button', { name: `${T.clear_selection} BUD OLD BU`, exact: true }).click();
  await editor.getByRole('button', { name: `${T.clear_selection} ${T.project} OLD PROJECT`, exact: true }).click();
  await editor.getByRole('button', { name: T.scope_preview, exact: true }).click();
  await expect(editor.locator('.scope-preview')).toBeVisible(); expect(state.previews.at(-1).change.scope).toEqual({ mode: 'selected', bu_ids: [], project_ids: [] });
});

test('stale grace confirmation retains the proposed value and refreshes its revision', async ({ page }) => {
  const { state } = await fixture(page); state.settingsStale = true; await page.goto('/admin/accounts');
  await page.locator('.scope-settings > summary').click(); const settings = page.locator('.scope-settings');
  await settings.getByRole('combobox', { name: T.scope_grace, exact: true }).selectOption('3'); await settings.getByRole('button', { name: T.scope_settings_preview, exact: true }).click();
  await settings.getByRole('checkbox', { name: T.scope_settings_confirm, exact: true }).check(); await settings.getByRole('button', { name: T.scope_settings_confirm, exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText(T.scope_stale); await expect(settings.getByRole('combobox', { name: T.scope_grace, exact: true })).toHaveValue('3');
  await expect(settings.locator('.scope-preview')).toHaveCount(0); expect(state.days).toBe(5);
  await settings.getByRole('button', { name: T.scope_settings_preview, exact: true }).click(); await expect(settings.locator('.scope-preview')).toBeVisible();
  expect(state.settingsWrites.at(-1)).toEqual({ grace_days: 3, expected_revision: 2 }); await expect(settings.getByRole('checkbox', { name: T.scope_settings_confirm, exact: true })).not.toBeChecked();
});
