import { expect, test, type Page } from '@playwright/test';
import { expectAssistantClearance } from './assistant-clearance';
import { clickPublication } from './content-workflow-fixtures';
import { workspaceText } from '../../apps/admin/lib/unified-workspace';
import { workflowText as text, type PublicationItem, type PublicationQueue, type PublicationReview, type ReleaseHistory } from '../../apps/admin/lib/content-workflow';

const origin = 'http://127.0.0.1:3000', api = '/api/hub/v1/admin', hash = 'a'.repeat(64), digest = 'b'.repeat(64);
const ids = { project: '11111111-1111-4111-8111-111111111111', section: '22222222-2222-4222-8222-222222222222', faq: '33333333-3333-4333-8333-333333333333', batch: '44444444-4444-4444-8444-444444444444', version: '55555555-5555-4555-8555-555555555555', old: '66666666-6666-4666-8666-666666666666', release: '77777777-7777-4777-8777-777777777777' };
function fixture() {
  const approved: PublicationItem = { item_key: 'section:exact', label: { th: 'Synthetic narrative' }, href: '/website/project/prj_exact?tab=data&section=narrative&item=' + ids.section,
    target: { level: 'project', id: 'prj_exact', tab: 'data', section: 'narrative', item: ids.section }, workflow: { kind: 'section', identity: { id: ids.section }, expected_hash: hash }, can_return: true, status: 'APPROVED' };
  const stale: PublicationItem = { item_key: 'faq:exact', label: { th: 'Synthetic question' }, href: '/website/project/prj_exact?tab=faq&question=exact',
    target: { level: 'project', id: 'prj_exact', tab: 'faq', question_key: 'exact' }, workflow: { kind: 'faq', identity: { id: ids.faq }, expected_hash: 'c'.repeat(64) }, can_return: false, status: 'REJECTED', code: 'stale' };
  const release: ReleaseHistory = { id: ids.release, status: 'PUBLISHED', change_reason: 'Synthetic prior release', published_at: '2026-11-01T10:00:00+07:00', published_by: '00000000-0000-4000-8000-000000000001', rolled_back_at: null, rolled_back_by: null, rollback_reason: null,
    members: [{ entity_type: 'project' as const, entity_id: ids.project, public_id: 'prj_exact', before_version_id: ids.old, after_version_id: ids.version }] };
  const queue: PublicationQueue = { can_publish: true, items: [
    { system: 'web', page_key: 'project:prj_exact', label: { th: 'Synthetic website' }, href: '/website/project/prj_exact?tab=overview', target: { level: 'project', id: 'prj_exact', tab: 'overview' }, workflow: null, can_return: false, previous_version_id: ids.old, hash, items: [approved, stale] },
    { system: 'release', entity_type: 'project', entity_id: ids.project, public_id: 'prj_exact', label: { th: 'Synthetic project export' }, href: '/website/project/prj_exact?tab=data', workflow: { kind: 'project', identity: { id: ids.project }, expected_hash: hash }, can_return: true },
  ], web_history: [{ id: ids.batch, state: 'IN_REVIEW', reason: 'Synthetic prepared batch', digest, created_at: '2026-11-04T09:00:00+07:00', page_count: 2 }], release_history: [release] };
  const review: PublicationReview = { ...queue.web_history[0], can_publish: true, pages: [
    { system: 'web', page_key: 'project:prj_exact', label: { th: 'Synthetic website' }, href: '/website/project/prj_exact?tab=overview', workflow: null, can_return: false, preview: { content: { title: 'New approved narrative' } }, previous: { content: { title: 'Prior narrative' } }, html: '<article><h1>Approved preview</h1><p>Safe synthetic content.</p></article>', items: [approved, stale] },
    { system: 'release', member: { entity_type: 'project', entity_id: ids.project, public_id: 'prj_exact' }, label: { th: 'Synthetic project export' }, href: '/website/project/prj_exact?tab=data', workflow: null, can_return: false,
      preview: { public_name: { th: 'Approved export' } }, previous: { public_name: { th: 'Prior export' } }, html: '<article><h1>Approved export</h1></article>', items: [] },
  ] };
  return { approved, stale, release, queue, review };
}
async function enter(page: Page, role = 'publisher') {
  expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role } })).ok()).toBe(true);
}

test('W3.1 an internal excluded item explains its exposure and links to its editor without blocking the approved neighbour', async ({ page }) => {
  await enter(page); const value = await mock(page);
  value.stale.ai_exposure = 'internal'; value.stale.code = 'not_approved_or_available';
  value.stale.exposure_href = '/website/project/prj_exact?tab=faq&question=exact&field=ai_exposure';
  value.approved.ai_exposure = 'web_only';
  await page.goto('/publish');
  const item = page.locator('[data-publication-target="web:project:prj_exact"] [data-publication-item="faq:exact"]');
  await expect(item.getByRole('note')).toContainText(workspaceText.internal_notice);
  await expect(item.getByRole('link', { name: workspaceText.change_exposure })).toHaveAttribute('href', value.stale.exposure_href);
  await page.getByRole('checkbox', { name: text.select_item + ' · Synthetic website', exact: true }).check();
  await page.locator('.publication-workspace > form').getByRole('textbox', { name: text.reason, exact: true }).fill('Publish the eligible neighbour');
  await page.getByRole('button', { name: new RegExp('^' + text.prepare_review) }).click();
  await expect(page.locator('.publication-review [data-publication-item="faq:exact"]')).toContainText(workspaceText.internal_notice);
  await expect(page.locator('.publication-review [data-publication-item="section:exact"] [data-exposure]')).toHaveAttribute('data-exposure', 'web_only');
  await page.locator('.publication-review').getByRole('checkbox', { name: text.confirm_publication, exact: true }).check();
  await expect(page.locator('.publication-review').getByRole('button', { name: text.publish, exact: true })).toBeEnabled();
});
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const element of await page.locator('.publication-workspace input, .publication-workspace textarea, .publication-workspace button').all()) {
    const box = await element.boundingBox(); if (box) expect(box.x + box.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 1280) + 1);
  }
}

test('publication commands stay locked while an exposure dialog is open', async ({ page }) => {
  await enter(page); const value = await mock(page);
  value.stale.ai_exposure = 'internal';
  value.stale.exposure_editor = { kind: 'asset', identity: { id: ids.section } };
  await page.route('**/api/hub/v1/admin/content-workflow?**', route => route.fulfill({ json: { data: {
    kind: 'asset', identity: { id: ids.section }, expected_hash: hash, ai_exposure: 'internal', can_edit: false, state: 'DRAFT',
  } } }));
  await page.goto('/publish');
  await page.getByRole('checkbox', { name: text.select_item + ' · Synthetic website', exact: true }).check();
  const form = page.locator('.publication-workspace > form');
  await form.getByRole('textbox', { name: text.reason, exact: true }).fill('Keep this prepared selection');
  const prepare = page.getByRole('button', { name: new RegExp('^' + text.prepare_review) });
  await expect(prepare).toBeEnabled();
  const item = page.locator('[data-publication-target="web:project:prj_exact"] [data-publication-item="faq:exact"]');
  await item.getByRole('button', { name: workspaceText.change_exposure, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(prepare).toBeDisabled();
  await form.evaluate(element => element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(value.calls).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(prepare).toBeEnabled();
  await expect(form.getByRole('textbox', { name: text.reason, exact: true })).toHaveValue('Keep this prepared selection');
  await prepare.click();
  await expect.poll(() => value.calls.length).toBe(1);
  expect(value.calls[0].path).toBe(api + '/publication-queue/prepare');
});
async function mock(page: Page, publisher = true) {
  // Component protocol fixtures explicitly carry N2 capabilities; defaults gain no grants.
  const response = await page.request.get('/api/hub/v1/me'); expect(response.ok()).toBe(true);
  const account = (await response.json()).data;
  account.capabilities = { ...account.capabilities, tabs: { knowledge: { view: true }, projects: { view: true }, brands: { view: true }, promotions: { view: true } }, special_actions: publisher ? { 'knowledge.publish_web': true } : {} };
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: account } }));
  const value = fixture(), calls: { path: string; body: unknown }[] = [];
  let currentVersion: string | null = ids.old, returned = false, reviewReads = 0;
  value.queue.can_publish = publisher; value.review.can_publish = publisher;
  await page.route('**/api/hub/v1/admin/publication-queue**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: value.queue } });
    const body = route.request().postDataJSON(); calls.push({ path: url.pathname, body });
    if (url.pathname.endsWith('/prepare')) return route.fulfill({ json: { data: { id: ids.batch, digest, page_count: 2, state: 'IN_REVIEW' } } });
    if (url.pathname.endsWith('/return')) { returned = true; return route.fulfill({ status: 409, json: { error: { code: 'stale_revision', message: text.stale_item } } }); }
    value.review.state = 'PARTIAL'; value.queue.web_history[0].state = 'PARTIAL';
    return route.fulfill({ json: { data: { id: ids.batch, state: 'PARTIAL', page_count: 2, outcomes: [{ system: 'web', page_key: 'project:prj_exact', items: [value.approved, value.stale], label: { th: 'Synthetic website' }, workflow: null, can_return: false }, { system: 'release', member: { entity_type: 'project', entity_id: ids.project, public_id: 'prj_exact' }, status: 'PUBLISHED', release_id: ids.release, label: { th: 'Synthetic project export' }, workflow: null, can_return: false }] } } });
  });
  await page.route('**/api/hub/v1/admin/web**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === api + '/web') return route.fulfill({ json: { data: { pages: [{ page_key: 'project:prj_exact', published_version_id: currentVersion }], can_publish: publisher } } });
    if (url.pathname.includes('/publications/')) { reviewReads += 1; return route.fulfill({ json: { data: value.review } }); }
    if (url.pathname.endsWith('/history')) return route.fulfill({ json: { data: [{ id: ids.version, version_no: 2, change_reason: 'Synthetic version two', published_at: '2026-11-04T10:00:00+07:00' }, { id: ids.old, version_no: 1, change_reason: 'Synthetic version one', published_at: '2026-11-01T10:00:00+07:00' }] } });
    if (url.pathname.includes('/versions/')) return route.fulfill({ json: { data: { html: '<article><h1>Retained approved version</h1></article>', preview: {} } } });
    if (url.pathname.endsWith('/pointer')) { const body = route.request().postDataJSON(); calls.push({ path: url.pathname, body }); currentVersion = body.target_version_id; return route.fulfill({ json: { data: { published_version_id: currentVersion } } }); }
    return route.fallback();
  });
  await page.route('**/api/hub/v1/admin/releases/' + ids.release + '**', route => {
    if (route.request().method() === 'POST') { calls.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() }); value.release.status = 'ROLLED_BACK'; }
    return route.fulfill({ json: { data: value.release } });
  });
  return { ...value, calls, wasReturned: () => returned, reviewReads: () => reviewReads };
}

for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark'] as const) test(`one queue prepares an exact review then publishes partial results in ${colorScheme} at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await enter(page); const value = await mock(page); await page.goto('/publish');
  await expect(page.getByRole('heading', { name: text.queue, exact: true })).toBeVisible();
  expect(value.calls).toEqual([]);
  await expectAssistantClearance(page, page.locator('.publication-history-panel').last());
  await page.screenshot({ path: `artifacts/unified-workspace/polish-p1/after/clearance-publishing-enabled-${width}-${colorScheme}.png` });
  const first = page.getByRole('checkbox', { name: text.select_item + ' · Synthetic website', exact: true });
  await first.focus(); await page.keyboard.press('Space'); await expect(first).toBeFocused(); await expect(first).toBeChecked();
  await page.getByRole('checkbox', { name: text.select_item + ' · Synthetic project export', exact: true }).check();
  await page.locator('.publication-workspace > form').getByRole('textbox', { name: text.reason, exact: true }).fill('Synthetic explicit publication reason');
  await page.getByRole('button', { name: new RegExp('^' + text.prepare_review) }).click();
  await expect(page.locator('.publication-reviewed-page')).toHaveCount(2);
  expect(value.calls[0]).toEqual({ path: api + '/publication-queue/prepare', body: { selections: [{ system: 'web', page_key: 'project:prj_exact' }, { system: 'release', entity_type: 'project', entity_id: ids.project }], reason: 'Synthetic explicit publication reason' } });
  await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Approved preview' })).toBeVisible();
  await expect(page.locator('.publication-review [data-publication-item="faq:exact"]')).toContainText(text.stale_item);
  const publish = page.locator('.publication-review').getByRole('button', { name: text.publish, exact: true });
  await expect(publish).toBeDisabled();
  await page.locator('.publication-review').getByRole('checkbox', { name: text.confirm_publication, exact: true }).check();
  await expect(publish).toBeEnabled(); await fits(page);
  // Paint the sandboxed preview in the viewport before capturing the full page.
  const previewHeading = page.frameLocator('iframe').first().getByRole('heading', { name: 'Approved preview' });
  await page.locator('iframe').first().scrollIntoViewIfNeeded();
  await expect(previewHeading).toBeInViewport();
  await page.screenshot({ path: `artifacts/unified-workspace/w4/review-${colorScheme}-${width}.png`, fullPage: true });
  await clickPublication(page.locator('.publication-review'));
  await expect(page.getByRole('heading', { name: text.publication_results, exact: true })).toBeVisible();
  expect(value.calls.at(-1)).toEqual({ path: api + '/publication-queue/publish', body: { publication_id: ids.batch, expected_digest: digest } });
  await expect(page.locator('.publication-review')).toContainText(text.partial_publication);
  await expect(page.locator('.publication-review')).toContainText(text.stale_item);
  await fits(page); await page.screenshot({ path: `artifacts/unified-workspace/w4/result-${colorScheme}-${width}.png`, fullPage: true });
});

test('return uses the exact approved item, retains its reason on conflict, and restores keyboard focus', async ({ page }) => {
  await enter(page); const value = await mock(page); await page.goto('/publish');
  const item = page.locator('[data-publication-target="web:project:prj_exact"] [data-publication-item="section:exact"]');
  await expect(item.getByRole('link')).toHaveAttribute('href', value.approved.href!);
  const button = item.getByRole('button', { name: text.return, exact: true }); await button.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: text.reason, exact: true }).fill('Synthetic return explanation');
  await dialog.getByRole('checkbox', { name: text.confirm, exact: true }).check();
  await dialog.getByRole('button', { name: text.return + ' · Synthetic narrative', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(text.stale_item);
  await expect(dialog.getByRole('textbox', { name: text.reason, exact: true })).toHaveValue('Synthetic return explanation');
  expect(value.calls[0]).toEqual({ path: api + '/publication-queue/return', body: { ...value.approved.workflow, reason: 'Synthetic return explanation' } });
  expect(value.wasReturned()).toBe(true);
  await page.screenshot({ path: 'artifacts/unified-workspace/w4/return-conflict.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(button).toBeFocused();
  await expect(page.locator('[data-publication-item="faq:exact"] button')).toHaveCount(0);
});

test('retained website versions require explicit review, reason and confirmation for pointer changes', async ({ page }) => {
  await enter(page); const value = await mock(page); await page.goto('/publish?page=project%3Aprj_exact');
  await page.getByRole('button', { name: text.version + ' 2', exact: true }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Retained approved version' })).toBeVisible();
  await page.getByRole('button', { name: text.restore_version, exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('button', { name: text.restore_version, exact: true })).toBeDisabled();
  await dialog.getByRole('textbox', { name: text.reason, exact: true }).fill('Synthetic restore reason');
  await dialog.getByRole('checkbox', { name: text.confirm_pointer_change, exact: true }).check();
  await dialog.getByRole('button', { name: text.restore_version, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(value.calls[0]).toEqual({ path: api + '/web/pages/project%3Aprj_exact/pointer', body: { expected_version_id: ids.old, target_version_id: ids.version, reason: 'Synthetic restore reason' } });
  await page.getByRole('button', { name: text.withdraw_page, exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: text.reason, exact: true }).fill('Synthetic withdrawal reason');
  await page.getByRole('dialog').getByRole('checkbox', { name: text.confirm_pointer_change, exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: text.withdraw_page, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(value.calls[1]).toEqual({ path: api + '/web/pages/project%3Aprj_exact/pointer', body: { expected_version_id: ids.version, target_version_id: null, reason: 'Synthetic withdrawal reason' } });
  await fits(page); await page.screenshot({ path: 'artifacts/unified-workspace/w4/web-history.png', fullPage: true });
});

test('release history retains the original whole-release rollback route and members', async ({ page }) => {
  await enter(page); const value = await mock(page); await page.goto('/publish?release=' + ids.release);
  await page.getByRole('button', { name: text.rollback_release, exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: text.reason, exact: true }).fill('Synthetic rollback reason');
  await dialog.getByRole('checkbox', { name: text.confirm_release_rollback, exact: true }).check();
  await dialog.getByRole('button', { name: text.rollback_release, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(value.calls[0]).toEqual({ path: api + '/releases/' + ids.release + '/rollback', body: { change_reason: 'Synthetic rollback reason' } });
  await expect(page.locator('.publication-workspace')).toContainText(text.rolled_back);
  await fits(page); await page.screenshot({ path: 'artifacts/unified-workspace/w4/release-history.png', fullPage: true });
});

test('a View-only reader sees both histories but no publication or return controls', async ({ page }) => {
  await enter(page, 'viewer'); const value = await mock(page, false); await page.goto('/publish?publication=' + ids.batch);
  await expect(page.getByRole('heading', { name: text.web_history, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: text.release_history, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: text.publish, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: text.return, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp('^' + text.prepare_review) })).toHaveCount(0);
  for (const checkbox of await page.locator('.publication-targets input[type="checkbox"]').all()) await expect(checkbox).toBeDisabled();
  expect(value.calls).toEqual([]);
});

test('N2 publisher needs source View and the existing special without borrowing source Approve', async ({ page }) => {
  await enter(page); const value = await mock(page);
  const response = await page.request.get('/api/hub/v1/me'); expect(response.ok()).toBe(true); const account = (await response.json()).data;
  account.capabilities = { ...account.capabilities, tabs: { knowledge: { view: true }, projects: { view: true, approve: true }, brands: { view: true }, promotions: { view: true } }, special_actions: { 'knowledge.publish_web': true } };
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: account } }));
  await page.goto('/publish?publication=' + ids.batch);
  await expect(page.locator('.publication-reviewed-page')).toHaveCount(2);
  const priorReads = value.reviewReads();
  account.capabilities.tabs.projects = { view: true };
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/hub/v1/me'));
  await page.evaluate(() => window.dispatchEvent(new Event('hub-accounts-changed'))); await refreshed;
  await expect.poll(value.reviewReads).toBeGreaterThan(priorReads);
  const review = page.locator('.publication-review');
  await expect(review.locator('[data-publication-item="section:exact"]').getByRole('button', { name: text.return, exact: true })).toBeVisible();
  await review.getByRole('checkbox', { name: text.confirm_publication, exact: true }).check();
  await expect(review.getByRole('button', { name: text.publish, exact: true })).toBeEnabled();
  expect(value.calls).toEqual([]);
  account.capabilities.special_actions = {};
  const revoked = page.waitForResponse(response => response.url().endsWith('/api/hub/v1/me'));
  await page.evaluate(() => window.dispatchEvent(new Event('hub-accounts-changed'))); await revoked;
  await expect(page.getByRole('button', { name: text.publish, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: text.return, exact: true })).toHaveCount(0);
  expect(value.calls).toEqual([]);
});

test('each queue card shows one visible exact title and a detail navigation link', async ({ page }) => {
  await enter(page); await mock(page); await page.goto('/publish');
  await expect(page.locator('.publication-targets')).toHaveCount(2);
  const cards = page.locator('.publication-targets > li');
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  let detailed = 0;
  for (let index = 0; index < count; index++) {
    const card = cards.nth(index);
    const title = card.locator('.publication-selection > span');
    await expect(title).toHaveCount(1);
    const value = (await title.innerText()).trim();
    expect(value.length, 'card title').toBeGreaterThan(0);
    await expect(card.getByText(value, { exact: true })).toHaveCount(1);
    const detail = card.locator('p a').filter({ hasText: text.detail });
    if (await detail.count()) { await expect(detail).toHaveCount(1); detailed++; }
  }
  expect(detailed, 'detail navigation links').toBeGreaterThan(0);
});

test('unfiltered publication queues and every history level name what is empty', async ({ page }) => {
  await enter(page); const value = await mock(page);
  value.queue.items = []; value.queue.web_history = []; value.queue.release_history = [];
  await page.route('**/api/hub/v1/admin/web/pages/**/history', route => route.fulfill({ json: { data: [] } }));
  await page.goto('/publish');
  await expect(page.getByText(text.publication_queue_empty, { exact: true })).toHaveCount(2);
  await expect(page.getByText(text.publication_history_empty, { exact: true })).toHaveCount(2);
  await expect(page.getByText(text.empty, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: text.web_history + ' · project:prj_exact', exact: true }).click();
  await expect(page.getByText(text.publication_history_empty, { exact: true })).toHaveCount(3);
  await expect(page.getByText(text.empty, { exact: true })).toHaveCount(0);
  expect(value.calls).toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) test(`publication text, actions and input borders retain measured contrast in ${colorScheme}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' }); await enter(page); await mock(page); await page.goto('/publish');
  await expect(page.locator('.publication-targets')).toHaveCount(2);
  const pairs = await page.evaluate(() => {
    const probe = document.createElement('span'); probe.hidden = true; document.body.append(probe);
    const luminance = (token: string) => { probe.style.color = 'var(--' + token + ')'; const color = getComputedStyle(probe).color;
      if (!color.startsWith('rgb')) throw new Error('Unsupported computed color: ' + color);
      const channels = color.match(/[\d.]+/g)!.map(Number); if (channels.length > 3 && channels[3] !== 1) throw new Error('Opaque color required');
      const linear = channels.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722; };
    const tokens: [string, string, number][] = [['ink', 'surface', 4.5], ['ink', 'surface-warm', 4.5], ['action', 'surface', 4.5], ['surface', 'action', 4.5], ['line-strong', 'surface', 3], ['focus', 'surface', 3]];
    const result = tokens.map(([foreground, background, minimum]) => { const a = luminance(foreground), b = luminance(background); return { foreground, background, minimum, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }; }); probe.remove(); return result;
  });
  for (const pair of pairs) expect(pair.ratio, pair.foreground + '/' + pair.background).toBeGreaterThanOrEqual(pair.minimum);
});


test('a hidden previous snapshot is omitted while an independently allowed new preview remains publishable', async ({ page }) => {
  await enter(page); const value = await mock(page);
  value.review.pages[0].previous_redacted = true;
  value.review.pages[0].previous = { content: { title: 'PRIVATE-BEFORE-SENTINEL' } };
  await page.goto('/publish?publication=' + ids.batch);
  const item = page.locator('.publication-reviewed-page').filter({ has: page.getByRole('heading', { name: 'Synthetic website', exact: true }) });
  await expect(item.getByRole('status')).toHaveText(text.before + ' · ' + text.permission_required);
  await expect(item).not.toContainText('PRIVATE-BEFORE-SENTINEL');
  await expect(item).toContainText('New approved narrative');
  await expect(item.frameLocator('iframe').getByRole('heading', { name: 'Approved preview' })).toBeVisible();
  const review = page.locator('.publication-review');
  await review.getByRole('checkbox', { name: text.confirm_publication, exact: true }).check();
  await expect(review.getByRole('button', { name: text.publish, exact: true })).toBeEnabled();
  expect(value.calls).toEqual([]);
});

test('a redacted new snapshot never renders its payload or HTML and does not hide an allowed neighbour', async ({ page }) => {
  await enter(page); const value = await mock(page);
  value.review.pages[0].preview_redacted = true;
  value.review.pages[0].preview = { content: { title: 'PRIVATE-AFTER-SENTINEL' } };
  value.review.pages[0].html = '<article>PRIVATE-HTML-SENTINEL</article>';
  value.review.pages[0].status = 'REJECTED';
  value.review.pages[0].code = 'retained_source_unavailable';
  await page.goto('/publish?publication=' + ids.batch);
  const item = page.locator('.publication-reviewed-page').filter({ has: page.getByRole('heading', { name: 'Synthetic website', exact: true }) });
  await expect(item.getByRole('status')).toHaveText(text.after + ' · ' + text.permission_required);
  await expect(item).not.toContainText('PRIVATE-AFTER-SENTINEL');
  await expect(item.locator('iframe')).toHaveCount(0);
  await expect(item).toContainText('Prior narrative');
  await expect(page.locator('.publication-reviewed-page').filter({ has: page.getByRole('heading', { name: 'Synthetic project export', exact: true }) })).toContainText('Approved export');
  expect(value.calls).toEqual([]);
});


test('existing Releases View keeps its permitted history without requesting Knowledge projections or gaining publish', async ({ page }) => {
  await enter(page, 'viewer'); const value = await mock(page, false);
  const response = await page.request.get('/api/hub/v1/me'); expect(response.ok()).toBe(true);
  const account = (await response.json()).data;
  account.capabilities = { ...account.capabilities, tabs: { releases: { view: true }, projects: { view: true } }, special_actions: {} };
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: account } }));
  await page.route('**/api/hub/v1/admin/releases', route => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ json: { data: { items: [value.release], total: 1 } } });
  });
  const deniedSourceReads: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === api + '/publication-queue' || path.startsWith(api + '/web')) deniedSourceReads.push(path);
  });
  await page.goto('/publish');
  await expect(page.getByRole('heading', { name: text.release_history, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: text.web_history, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: text.detail + ' · Synthetic prior release', exact: true }).click();
  await expect(page.locator('.publication-workspace')).toContainText('prj_exact');
  await expect(page.getByRole('button', { name: text.publish, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: text.rollback_release, exact: true })).toHaveCount(0);
  expect(deniedSourceReads).toEqual([]);
  expect(value.calls).toEqual([]);
});
