import { expect, test, type Page } from '@playwright/test';
import { workflowText as text } from '../../apps/admin/lib/content-workflow';

test.describe('H1 unified publication workspace', () => {
  test.skip(process.env.HUB_HOSTED_TEST_SIMULATION !== '1', 'Requires the isolated H1 Auth/API/database simulation');
  test.use({ baseURL: process.env.HUB_ADMIN_ORIGIN! });
  const headers = { Origin: process.env.HUB_ADMIN_ORIGIN! }, api = '/api/hub/v1/admin';
  async function login(page: Page, role: string) {
    await page.goto('/login?next=%2Fpublish');
    await page.locator('input[type="email"]').fill(`hub-test-${role}@example.test`);
    await page.locator('input[type="password"]').fill('H1-synthetic-only!');
    await page.locator('form').getByRole('button').last().click();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  }
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', route => { const url = new URL(route.request().url()); return ['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1' ? route.abort('blockedbyclient') : route.continue(); });
  });
  for (const width of [1280, 390]) test(`verified Knowledge readers see the single queue and both histories at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: width === 390 ? 'dark' : 'light', reducedMotion: 'reduce' });
    await login(page, 'viewer'); await expect(page).toHaveURL(/\/publish$/);
    await expect(page.getByRole('heading', { name: text.queue, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: text.web_history, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: text.release_history, exact: true })).toBeVisible();
    const queue = await page.request.get(api + '/publication-queue'); expect(queue.status()).toBe(200);
    expect((await queue.json()).data.can_publish).toBe(false);
    await expect(page.getByRole('button', { name: text.publish, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: new RegExp('^' + text.prepare_review) })).toHaveCount(0);
    await expect(page.getByRole('button', { name: text.return, exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/unified-workspace/w4/h1-queue-${width}.png`, fullPage: true });
  });
  test('H1 View cannot submit an exact source or bypass the publication special by direct API', async ({ page }) => {
    await login(page, 'viewer'); await expect(page).toHaveURL(/\/publish$/);
    const response = await page.request.get(api + '/projects'); expect(response.status()).toBe(200);
    const project = (await response.json()).data.find((item: { source?: { rem_project_id?: string } }) => item.source?.rem_project_id === 'H1-PROJECT-001'); expect(project).toBeTruthy();
    const query = new URLSearchParams({ kind: 'project', identity: JSON.stringify({ id: project.id }) });
    const source = await page.request.get(api + '/content-workflow?' + query); expect(source.status()).toBe(200);
    const snapshot = (await source.json()).data;
    expect(snapshot.can_submit).toBe(false); expect(snapshot.can_approve).toBe(false); expect(snapshot.can_save_approve).toBe(false);
    const submitted = await page.request.post(api + '/content-workflow/submit', { headers, data: { kind: 'project', identity: { id: project.id }, expected_hash: snapshot.expected_hash } });
    expect(submitted.status()).toBe(403);
    const published = await page.request.post(api + '/publication-queue/publish', { headers, data: { publication_id: '11111111-1111-4111-8111-111111111111', expected_digest: 'a'.repeat(64) } });
    expect(published.status()).toBe(403);
  });
  test('H1 agency cannot read the internal queue or render the publication workspace', async ({ page }) => {
    await login(page, 'agency-kin');
    const queue = await page.request.get(api + '/publication-queue'); expect(queue.status()).toBe(403);
    const response = await page.goto('/publish'); expect(response?.status()).toBe(403);
    await expect(page.locator('.publication-workspace')).toHaveCount(0);
  });
});
