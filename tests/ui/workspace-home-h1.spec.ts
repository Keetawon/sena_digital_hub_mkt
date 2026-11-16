import { expect, test } from '@playwright/test';
import { workspaceCopy as copy } from '../../apps/admin/lib/workspace-copy';
import { expectAssistantClearance } from './assistant-clearance';

test.describe('workspace home in disposable H1', () => {
  test.skip(process.env.HUB_HOSTED_TEST_SIMULATION !== '1', 'Requires the isolated H1 simulation');
  test.use({ baseURL: process.env.HUB_ADMIN_ORIGIN! });
  for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark'] as const) {
    test(`search remains available with a short disabled assistant at ${width}px ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        return ['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1' ? route.abort('blockedbyclient') : route.continue();
      });
      const assistantRequests: string[] = [];
      page.on('request', request => { if (request.url().includes('/assistant/')) assistantRequests.push(request.url()); });
      await page.goto('/login?next=%2Fhome');
      await page.locator('input[type=email]').fill('hub-test-viewer@example.test');
      await page.locator('input[type=password]').fill('H1-synthetic-only!');
      await page.locator('form button[type=submit]').click();
      await expect(page.getByRole('heading', { name: copy.greeting, exact: true })).toBeVisible();
      const response = await page.request.get('/api/hub/v1/admin/content/home');
      expect(response.status()).toBe(200);
      expect((await response.json()).data.project_total).toBeGreaterThan(0);
      await expectAssistantClearance(page, page.locator('.workspace-home-card').last(), true);
      await page.screenshot({ path: `artifacts/unified-workspace/polish-p1/after/clearance-home-disabled-${width}-${colorScheme}.png` });
      await page.evaluate(() => window.scrollTo(0, 0));
      const search = page.locator('.topbar').getByRole('combobox', { name: copy.search, exact: true });
      await search.fill('H1-PROJECT');
      const result = page.getByRole('option').filter({ hasText: 'H1-PROJECT-001' });
      await expect(result).toHaveCount(1);
      await expect(result).toHaveAttribute('href', /^\/\?project=/);
      const disabled = page.getByRole('option').filter({ hasText: copy.assistant_disabled });
      await expect(disabled).toHaveAttribute('aria-disabled', 'true');
      await disabled.click({ force: true });
      await expect(page.locator('.assistant-panel')).toHaveCount(0);
      await expect(page.locator('.workspace-assistant-disabled')).toBeDisabled();
      expect(assistantRequests).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `artifacts/unified-workspace/w3/navigation/h1-home-search-${width}.png`, fullPage: width === 1280 });
      const publicId = new URL((await result.getAttribute('href'))!, process.env.HUB_ADMIN_ORIGIN).searchParams.get('project');
      expect(publicId).toBeTruthy();
      await result.click();
      await expect(page).toHaveURL(url => url.pathname === `/website/project/${encodeURIComponent(publicId!)}` && url.searchParams.get('tab') === 'data' && url.searchParams.get('section') === 'identity');
      await expect(page.locator('#workspace-tab-data')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.workspace-persistent-editor input#public_name')).toBeVisible();
      await expect(page.locator('.workspace-persistent-editor input#public_name')).not.toBeEditable();
      await expectAssistantClearance(page, page.locator('.workspace-persistent-editor'), true);
      await page.screenshot({ path: `artifacts/unified-workspace/polish-p1/after/clearance-project-disabled-${width}-${colorScheme}.png` });
      expect(assistantRequests).toEqual([]);
    });
  }
});
