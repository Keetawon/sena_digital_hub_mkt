import { expect, test, type Page } from '@playwright/test';
import { workspaceCopy as copy } from '../../apps/admin/lib/workspace-copy';
import { workspaceText } from '../../apps/admin/lib/unified-workspace';
import { expectAssistantClearance } from './assistant-clearance';

const origin = 'http://127.0.0.1:3000';
const home = {
  projects: [{ ref: 'PROJECT-DEMO', name: { th: 'SYNTHETIC PROJECT' }, href: '/?project=PROJECT-DEMO', readiness: { required_missing: 1, items: [
    { field_key: 'section.project_intro', label: { th: 'SYNTHETIC FIELD' }, complete: false, required: true, href: '/content?project=PROJECT-DEMO&tab=narrative&field=section.project_intro' },
  ] } }], project_total: 1,
  brands: [{ ref: 'BRAND-DEMO', name: { th: 'SYNTHETIC BRAND' }, projects: 1, required_missing: 0, project_required_missing: 1, readiness: { required_missing: 0, items: [] } }],
  buds: [{ id: '  BU-031  ', code: 'BUD31', name: 'SYNTHETIC BU', projects: 1, required_missing: 1 }],
  tasks: [{ id: 'returned:section:1', category: 'returned', label: { th: 'SYNTHETIC RETURNED ITEM' }, href: '/content?project=PROJECT-DEMO&tab=narrative&field=section.project_intro', context: { project: 'PROJECT-DEMO' } }],
  task_total: 1, selected_gap: null, offset: 0, limit: 25,
};

async function enter(page: Page, role = 'viewer') {
  expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role } })).ok()).toBeTruthy();
  await page.route('**/api/hub/v1/admin/content/home?*', route => route.fulfill({ json: { data: home } }));
}

test('home substitutes missing-fact templates and preserves authored task labels', async ({ page }) => {
  await enter(page);
  await page.route('**/api/hub/v1/admin/content/home?*', route => route.fulfill({ json: { data: {
    ...home, task_total: 3, tasks: [
      { ...home.tasks[0], id: 'fact:1', category: 'fact_missing', label: { th: '{project} missing fact' }, project_name: { th: 'Selected $& project' } },
      { ...home.tasks[0], category: 'publish', label: { th: '{project} authored title' }, project_name: { th: 'Selected $& project' } },
      { ...home.tasks[0], id: 'gap:1', category: 'unanswered', label: { th: '{project} user question' }, project_name: { th: 'Selected $& project' } },
    ],
  } } }));
  await page.goto('/home');
  await expect(page.getByRole('region', { name: new RegExp(copy.tasks) })).toContainText(workspaceText.home_tasks_hint);
  await expect(page.getByRole('link', { name: 'Selected $& project missing fact', exact: true })).toHaveAttribute('href', home.tasks[0].href);
  await expect(page.locator('.workspace-home-examples button').first()).toHaveText(copy.ask_prefix + 'Selected $& project missing fact');
  for (const label of ['{project} authored title', '{project} user question']) {
    await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
    await expect(page.locator('.workspace-home-examples').getByRole('button', { name: copy.ask_prefix + label, exact: true })).toBeVisible();
  }
});

for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark'] as const) {
  test(`workspace home and search keep exact targets, keyboard focus and no overflow ${width} ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await enter(page);
    await page.route('**/api/hub/v1/admin/content/search?*', route => route.fulfill({ json: { data: { items: [
      { kind: 'project', ref: 'PROJECT-DEMO', label: { th: 'SYNTHETIC SEARCH PROJECT' }, code: 'EXACT-REM', href: '/?project=PROJECT-DEMO' },
    ] } } }));
    await page.goto('/home');
    await expect(page.getByRole('heading', { name: copy.greeting, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'SYNTHETIC RETURNED ITEM', exact: true })).toHaveAttribute('href', /field=section.project_intro/);
    await page.locator('details').getByText(copy.readiness, { exact: false }).click();
    await expect(page.getByRole('link', { name: 'SYNTHETIC FIELD', exact: true })).toHaveAttribute('href', /tab=narrative&field=section.project_intro/);
    const fieldLink = await page.getByRole('link', { name: 'SYNTHETIC FIELD', exact: true }).getAttribute('href');
    const redirect = await page.request.get(fieldLink!, { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    const destination = new URL(redirect.headers().location, origin);
    expect(destination.pathname).toBe('/website/project/PROJECT-DEMO');
    expect(Object.fromEntries(destination.searchParams)).toEqual({ tab: 'data', section: 'narrative', field: 'section.project_intro' });
    await page.evaluate(() => scrollTo(0, 0));
    const search = page.locator('.topbar').getByRole('combobox', { name: copy.search, exact: true });
    await search.fill('SYNTHETIC');
    await expect(page.getByRole('option', { name: /SYNTHETIC SEARCH PROJECT/ })).toBeVisible();
    await search.press('ArrowDown');
    await expect(search).toHaveAttribute('aria-activedescendant', /option-0$/);
    await expect(search).toBeFocused();
    expect(await search.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/unified-workspace/w3/navigation/home-search-${colorScheme}-${width}.png`, fullPage: width === 1280 });
    await search.press('Escape'); await expect(search).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('combobox', { name: 'BUD', exact: true }).selectOption('  BU-031  ');
    await expect(page).toHaveURL(/bud=\+\+BU-031\+\+/);
  });
}

test('search assistant and task examples fill only the composer and retain exact entity context', async ({ page }) => {
  await enter(page);
  let posts = 0;
  await page.route('**/api/hub/v1/admin/assistant/**', route => {
    if (route.request().method() === 'POST') posts++;
    return route.fulfill({ json: { data: { session_key: 'synthetic-w2', mode: 'fake', live_available: false, allowed_tools: ['get_project', 'get_brand'], message_th: 'SYNTHETIC', live_questions: [], proposal_fields: {} } } });
  });
  await page.route('**/api/hub/v1/admin/content/search?*', route => route.fulfill({ json: { data: { items: [] } } }));
  await page.goto('/home');
  const search = page.locator('.topbar').getByRole('combobox', { name: copy.search, exact: true });
  await search.fill('SYNTHETIC QUESTION');
  await page.getByRole('option', { name: `${copy.ask_prefix}SYNTHETIC QUESTION`, exact: true }).click();
  await expect(page.locator('#assistant-question')).toHaveValue('SYNTHETIC QUESTION');
  expect(posts).toBe(0);
  await page.locator('.assistant-close').click(); await expect(search).toBeFocused();
  await page.locator('.workspace-home-examples button').first().click();
  await expect(page.locator('#assistant-question')).toHaveValue(`${copy.task_question}: SYNTHETIC RETURNED ITEM`);
  await expect(page.locator('.assistant-context-trigger')).toContainText('PROJECT-DEMO');
  expect(posts).toBe(0);
});

test('legacy home coverage preserves the selected project, phase and filter on its canonical route', async ({ page }) => {
  await enter(page);
  const response = await page.request.get('/faq?tab=coverage&project=PROJECT-DEMO&phase=00001&status=missing', { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const destination = new URL(response.headers().location, origin);
  expect(destination.pathname).toBe('/home');
  expect(Object.fromEntries(destination.searchParams)).toEqual({ project: 'PROJECT-DEMO', phase: '00001', status: 'missing', section: 'coverage' });
});

test('permission refresh removes search results and home projections from the revoked source', async ({ page }) => {
  await enter(page);
  const real = (await (await page.request.get('/api/hub/v1/me')).json()).data;
  let denied = false;
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: denied ? { ...real, capabilities: { ...real.capabilities, tabs: { questions: { view: true } } } } : real } }));
  await page.route('**/api/hub/v1/admin/content/search?*', route => route.fulfill({ json: { data: { items: [{ kind: 'project', ref: 'secret', label: { th: 'SOURCE TO CLEAR' }, href: '/?project=secret' }] } } }));
  await page.goto('/home');
  await page.locator('.topbar').getByRole('combobox', { name: copy.search, exact: true }).fill('SOURCE');
  await expect(page.getByRole('option', { name: 'SOURCE TO CLEAR', exact: true })).toBeVisible();
  denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event('hub-accounts-changed')));
  await expect(page.getByRole('option', { name: 'SOURCE TO CLEAR', exact: true })).toHaveCount(0);
  await expect(page.locator('.workspace-home')).toHaveCount(0);
  await expect(page.locator('.topbar .workspace-search')).toHaveCount(0);
});

test('search aborts stale responses and never shows results for an earlier query', async ({ page }) => {
  await enter(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route('**/api/hub/v1/admin/content/search?*', async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'old') { requested = true; await held; }
    await route.fulfill({ json: { data: { items: [{ kind: 'project', ref: query, label: { th: `${query} RESULT` }, href: '/?project=PROJECT-DEMO' }] } } });
  });
  await page.goto('/home');
  const search = page.locator('.topbar').getByRole('combobox', { name: copy.search, exact: true });
  await search.fill('old'); await expect.poll(() => requested).toBe(true);
  await search.fill('new'); await expect(page.getByRole('option', { name: 'new RESULT', exact: true })).toBeVisible();
  release();
  await expect(page.getByRole('option', { name: 'old RESULT', exact: true })).toHaveCount(0);
});

for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark'] as const) test(`home content reserves bottom clearance for the floating assistant at ${width}px ${colorScheme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await enter(page);
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: copy.greeting, exact: true })).toBeVisible();
  await expectAssistantClearance(page, page.locator('.workspace-home-card').last());
  await page.screenshot({ path: `artifacts/unified-workspace/polish-p1/after/clearance-home-enabled-${width}-${colorScheme}.png` });
});
