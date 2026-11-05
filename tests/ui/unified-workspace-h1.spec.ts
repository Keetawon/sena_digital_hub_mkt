import { expect, test, type Page } from '@playwright/test';
import { fitsWorkspace, workspaceText as text } from './unified-workspace-helpers';
test.describe('H1 unified entity workspace', () => {
  test.skip(process.env.HUB_HOSTED_TEST_SIMULATION !== '1', 'Requires the isolated H1 Auth/API/database simulation');
  test.use({ baseURL: process.env.HUB_ADMIN_ORIGIN! });
  async function login(page: Page, role: string) {
    await page.goto('/login?next=%2Fwebsite');
    await page.locator('input[type="email"]').fill(`hub-test-${role}@example.test`);
    await page.locator('input[type="password"]').fill('H1-synthetic-only!');
    await page.locator('form').getByRole('button').last().click();
    await expect(page).toHaveURL(/\/website/);
  }
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1' ? route.abort('blockedbyclient') : route.continue();
    });
  });
  for (const width of [1280, 390]) test(`authorized entity tabs, FAQ and history fit H1 at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await login(page, 'editor');
    await expect(page.getByRole('heading', { name: text.website, exact: true })).toBeVisible();
    const response = await page.request.get('/api/hub/v1/admin/projects'); expect(response.ok()).toBe(true);
    const project = (await response.json()).data.find((item: { source?: { rem_project_id?: string } }) => item.source?.rem_project_id === 'H1-PROJECT-001');
    expect(project).toBeTruthy();
    await page.goto(`/website/project/${project.public_project_id}?tab=overview`);
    await expect(page.locator('#workspace-tab-overview')).toHaveAttribute('aria-selected', 'true');
    await fitsWorkspace(page); await page.screenshot({ path: `artifacts/unified-workspace/w3/h1-overview-${width}.png`, fullPage: true });
    await page.locator('#workspace-tab-faq').click(); await expect(page.locator('.entity-embedded-faq')).toBeVisible(); await fitsWorkspace(page);
    await page.screenshot({ path: `artifacts/unified-workspace/w3/h1-faq-${width}.png`, fullPage: true });
    await page.locator('#workspace-tab-history').click(); await expect(page.locator('#workspace-panel-history')).toBeVisible();
    await fitsWorkspace(page); await page.screenshot({ path: `artifacts/unified-workspace/w3/h1-history-${width}.png`, fullPage: true });
    const denied = await page.goto('/settings/activity'); expect(denied?.status()).toBe(403);
  });
  test('Admin activity and legacy source settings remain authenticated in H1', async ({ page }) => {
    await login(page, 'admin'); await page.goto('/settings/activity');
    await expect(page.getByRole('heading', { name: text.activity, exact: true })).toBeVisible();
    await page.goto('/faq?tab=bank'); await expect(page).toHaveURL(/\/settings\?section=bank/);
    await fitsWorkspace(page);
  });
});
