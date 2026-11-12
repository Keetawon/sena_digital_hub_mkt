import { expect, test, type Page } from '@playwright/test';
import { contentScopeText as T } from '../../apps/admin/lib/content-scope-text';

test.describe('W6 content scopes on isolated H1', () => {
  test.skip(process.env.HUB_HOSTED_TEST_SIMULATION !== '1', 'Requires the isolated loopback H1 simulation');
  test.use({ baseURL: process.env.HUB_ADMIN_ORIGIN! });
  test.beforeEach(async ({ page }) => { await page.route('**/*', route => { const url = new URL(route.request().url()); return ['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1' ? route.abort('blockedbyclient') : route.continue(); }); });
  async function login(page: Page, role: string) {
    await page.goto('/login?next=%2Fadmin%2Faccounts'); await page.locator('input[type=email]').fill(`hub-test-${role}@example.test`);
    await page.locator('input[type=password]').fill('H1-synthetic-only!'); await page.locator('form').getByRole('button').last().click(); await expect.poll(async () => (await page.request.get('/api/hub/v1/me')).status()).toBe(200);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    if (role === 'admin') await expect(page).toHaveURL(/\/admin\/accounts$/);
  }
  for (const width of [1280, 390]) test(`real manager references and preview stay private and fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await login(page, 'admin');
    const directoryResponse = await page.request.get('/api/hub/v1/admin/accounts'); expect(directoryResponse.status()).toBe(200);
    const directory = (await directoryResponse.json()).data, account = directory.items.find((item: any) => item.id !== directory.actor_id && item.status === 'ACTIVE' && item.hub_role === 'viewer'); expect(account).toBeTruthy();
    const scopes = await page.request.get(`/api/hub/v1/admin/accounts/content-scopes?account_id=${account.id}&limit=1&history_limit=1`);
    expect(scopes.status()).toBe(200); expect(scopes.headers()['cache-control']).toContain('no-store'); expect((await scopes.json()).data.scopes).toHaveLength(15);
    expect([404, 422]).toContain((await page.request.get('/api/hub/v1/admin/accounts/content-scopes?limit=101')).status());
    expect([404, 422]).toContain((await page.request.get('/api/hub/v1/admin/accounts/content-scopes?history_limit=1')).status());
    await page.locator('#tab-users').click(); await page.locator('.account-table tbody tr').filter({ hasText: account.email }).getByRole('button').click();
    const panel = page.getByRole('dialog'); await panel.locator('.scope-levels').first().getByRole('button').first().click(); const editor = panel.locator('.scope-editor');
    await editor.getByRole('radio', { name: T.scope_selected, exact: true }).check();
    await editor.getByRole('button', { name: T.scope_preview, exact: true }).click(); await expect(editor.locator('.scope-preview')).toBeVisible();
    await expect(editor.getByRole('button', { name: T.scope_confirm, exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/unified-workspace/w6/h1-scope-preview-${width}.png`, fullPage: true });
    await page.keyboard.press('Escape'); await page.locator('.scope-settings > summary').click(); await expect(page.locator('.scope-settings').getByRole('combobox', { name: T.scope_grace, exact: true })).toBeVisible();
  });
  test('ordinary viewer cannot call manager references or Admin grace routes', async ({ page }) => {
    await login(page, 'viewer');
    for (const path of ['content-scopes', 'bu-sync-runs', 'content-scope-settings']) expect((await page.request.get(`/api/hub/v1/admin/accounts/${path}`)).status()).toBe(403);
    const response = await page.request.post('/api/hub/v1/admin/accounts/content-scope-settings/preview', { headers: { Origin: process.env.HUB_ADMIN_ORIGIN! }, data: { grace_days: 3, expected_revision: 1 } });
    expect(response.status()).toBe(403);
  });
});
