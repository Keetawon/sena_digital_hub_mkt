import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const origin = 'http://127.0.0.1:3000';
const api = '/api/hub/v1/admin/ads';

async function onlineStaff(page: Page) {
  const session = await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role: 'online_staff' } });
  expect(session.ok()).toBeTruthy();
}

async function registration(page: Page) {
  const scopes = await (await page.request.get(`${api}/scopes?kind=F`)).json();
  const scope = scopes.data.find((item: { scope_code: string }) => item.scope_code === 'CORP-TESTCONTENT');
  const response = await page.request.post(`${api}/registrations`, { headers: { Origin: origin }, data: { scope_kind: 'F', scope_id: scope.scope_id, objective: 'LEADS', agency: 'KIN', content_label: `MOTION ${randomUUID().slice(0, 8).toUpperCase()}`, content_label_approved: true } });
  expect(response.status()).toBe(201);
  return (await response.json()).data.registration.code as string;
}

const enterAnimation = (page: Page) => page.locator('main > *').first().evaluate(element => getComputedStyle(element).animationName);

test('normal motion: tables stay still and only the dialog uses a short translate/fade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await onlineStaff(page);
  const code = await registration(page);
  await page.goto('/ads/registry');
  expect(await enterAnimation(page)).toBe('none');
  expect(await page.evaluate(() => [...document.styleSheets].some(sheet => { try { return [...sheet.cssRules].some(rule => rule.cssText.includes('@view-transition')); } catch { return false; } }))).toBe(false);
  await page.getByLabel('ค้นหารหัสหรือชื่อ').fill(code);
  await page.getByRole('button', { name: `ดูรายละเอียด ${code}` }).click();
  const card = page.locator('.registry-card');
  await expect(card).toBeVisible();
  expect(await card.evaluate(element => parseFloat(getComputedStyle(element).animationDuration))).toBeLessThanOrEqual(.15);
  expect(await page.locator('.registry-table tbody tr').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await expect(card).toHaveCSS('opacity', '1');
  await expect.poll(() => card.evaluate(element => getComputedStyle(element).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  await expect(page.getByRole('heading', { name: code, exact: true })).toBeFocused();
});

test('reduced motion: no entrance, no page transition and the detail card appears immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await onlineStaff(page);
  const code = await registration(page);
  await page.goto('/ads/registry');
  expect(await enterAnimation(page)).toBe('none');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: no-preference)').matches)).toBe(false);
  await page.getByLabel('ค้นหารหัสหรือชื่อ').fill(code);
  await page.getByRole('button', { name: `ดูรายละเอียด ${code}` }).click();
  const card = page.locator('.registry-card');
  await expect(card).toHaveCSS('opacity', '1');
  expect(await card.evaluate(element => getComputedStyle(element).transform)).toBe('none');
  expect(await card.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: `ดูรายละเอียด ${code}` })).toBeFocused();
});
