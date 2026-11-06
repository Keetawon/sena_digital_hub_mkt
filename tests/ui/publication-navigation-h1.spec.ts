import { expect, test, type Page } from '@playwright/test';
import { workflowText } from '../../apps/admin/lib/content-workflow';
import { openMobileMenu, closeMobileMenu } from './hub-navigation-helpers';

test.describe('H1 publication navigation', () => {
  test.skip(process.env.HUB_HOSTED_TEST_SIMULATION !== '1', 'Requires the isolated H1 protocol simulation');
  test.use({ baseURL: process.env.HUB_ADMIN_ORIGIN! });
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1' ? route.abort('blockedbyclient') : route.continue();
    });
  });
  async function login(page: Page, next: string, role = 'viewer') {
    await page.goto('/login?next=' + encodeURIComponent(next));
    await page.locator('input[type="email"]').fill(`hub-test-${role}@example.test`);
    await page.locator('input[type="password"]').fill('H1-synthetic-only!');
    await page.locator('form').getByRole('button').last().click();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  }
  for (const width of [1280, 390]) test(`login next retains /publish context and shows one active destination at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    const next = '/publish?project=prj_exact&item=exact-item&brand=brd_one&brand=brd_two';
    await login(page, next);
    await expect(page).toHaveURL(process.env.HUB_ADMIN_ORIGIN! + next);
    await expect(page.getByRole('heading', { name: workflowText.queue, exact: true })).toBeVisible();
    await expect(page.locator('.local-persona-picker')).toHaveCount(0);
    await openMobileMenu(page);
    const navigation = page.locator('.hub-navigation');
    await expect(navigation.locator('a[href="/publish"]')).toHaveCount(1);
    await expect(navigation.locator('a[href="/publish"]')).toHaveAttribute('aria-current', 'page');
    await expect(navigation.locator('a[href="/releases"], a[href="/faq?tab=publication"]')).toHaveCount(0);
    await closeMobileMenu(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/unified-workspace/w4/publication-navigation-h1-${width}.png`, fullPage: true });
  });
  for (const legacy of ['/releases', '/faq?tab=publication']) test(`authenticated legacy ${legacy} preserves context through the redirect`, async ({ page }) => {
    const query = 'project=prj_exact&item=exact-item&brand=brd_one&brand=brd_two';
    await login(page, legacy + (legacy.includes('?') ? '&' : '?') + query);
    await expect(page).toHaveURL(/\/publish\?/);
    const destination = new URL(page.url());
    expect(destination.searchParams.get('project')).toBe('prj_exact');
    expect(destination.searchParams.get('item')).toBe('exact-item');
    expect(destination.searchParams.getAll('brand')).toEqual(['brd_one', 'brd_two']);
    if (legacy.startsWith('/faq')) expect(destination.searchParams.get('tab')).toBe('publication');
    await expect(page.locator('.local-persona-picker')).toHaveCount(0);
  });
  test('authenticated agency has no publication View and receives an early page denial', async ({ page }) => {
    await login(page, '/', 'agency-kin');
    for (const path of ['/publish', '/releases', '/faq?tab=publication']) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(403);
      await expect(page.locator('.publication-workspace')).toHaveCount(0);
    }
  });
});
