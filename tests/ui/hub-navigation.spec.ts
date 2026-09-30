import { expect, test, type Page } from '@playwright/test';

const api = '/api/hub/v1/admin/ads';
const origin = 'http://127.0.0.1:3000';

async function enter(page: Page, role: 'admin' | 'editor', path = '/') {
  const response = await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role } });
  expect(response.ok()).toBeTruthy();
  await page.goto(path);
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue(role);
}

async function activeSection(page: Page, name: string) {
  const navigation = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('link')).toHaveCount(3);
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(navigation.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
}

test('shared Hub menu connects projects, brands and every registry screen', async ({ page }) => {
  await enter(page, 'admin');
  await activeSection(page, 'โครงการที่อยู่อาศัย');
  const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
  await menu.getByRole('link', { name: 'แบรนด์ที่อยู่อาศัย', exact: true }).click();
  await expect(page).toHaveURL(/\?view=brands$/);
  await activeSection(page, 'แบรนด์ที่อยู่อาศัย');
  await menu.getByRole('link', { name: 'ทะเบียนแคมเปญ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ทะเบียนแคมเปญ', exact: true })).toBeVisible();
  await activeSection(page, 'ทะเบียนแคมเปญ');
  const registry = page.getByRole('navigation', { name: 'เมนูทะเบียนแคมเปญ', exact: true });
  await expect(registry.getByRole('link', { name: 'รายการชื่อแคมเปญ', exact: true })).toHaveAttribute('aria-current', 'page');
  await registry.getByRole('link', { name: 'ส่งคืนรหัสแคมเปญ', exact: true }).click();
  await expect(page).toHaveURL(/\/ads\/registry\/inbox$/);
  await activeSection(page, 'ทะเบียนแคมเปญ');
  await expect(registry.getByRole('link', { name: 'ส่งคืนรหัสแคมเปญ', exact: true })).toHaveAttribute('aria-current', 'page');
  await registry.getByRole('link', { name: 'ลงทะเบียนแคมเปญ', exact: true }).click();
  await expect(page).toHaveURL(/\/ads\/registry\/new$/);
  await activeSection(page, 'ทะเบียนแคมเปญ');
  await expect(registry.getByRole('link', { name: 'ลงทะเบียนแคมเปญ', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'ลงทะเบียนแคมเปญ', exact: true })).toBeVisible();
  await menu.getByRole('link', { name: 'โครงการที่อยู่อาศัย', exact: true }).click();
  await activeSection(page, 'โครงการที่อยู่อาศัย');
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('admin');
});

test('opening the registry from the shared menu preserves the residential role', async ({ page }) => {
  await enter(page, 'editor');
  const registryRequests: string[] = [];
  page.on('request', request => { if (request.url().includes(api)) registryRequests.push(request.url()); });
  await page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('link', { name: 'ทะเบียนแคมเปญ', exact: true }).click();
  await activeSection(page, 'ทะเบียนแคมเปญ');
  await expect(page.getByRole('heading', { name: 'เลือกบัญชีสำหรับทะเบียนแคมเปญ', exact: true })).toBeVisible();
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('editor');
  await expect(page.getByRole('link', { name: 'ลงทะเบียนแคมเปญ', exact: true })).toHaveCount(0);
  expect(registryRequests).toEqual([]);
  expect((await page.request.get(`${api}/registrations`)).status()).toBe(403);
  await page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('link', { name: 'โครงการที่อยู่อาศัย', exact: true }).click();
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('editor');
});

test('shared navigation stays keyboard accessible at 375px with large Thai text and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%'; });
  });
  await enter(page, 'admin');
  const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
  for (const name of ['โครงการที่อยู่อาศัย', 'แบรนด์ที่อยู่อาศัย', 'ทะเบียนแคมเปญ']) {
    const link = menu.getByRole('link', { name, exact: true });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await activeSection(page, name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const target = await menu.getByRole('link', { name, exact: true }).boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  }
  await page.getByRole('link', { name: 'ส่งคืนรหัสแคมเปญ', exact: true }).click();
  await activeSection(page, 'ทะเบียนแคมเปญ');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'ลงทะเบียนแคมเปญ', exact: true }).click();
  await activeSection(page, 'ทะเบียนแคมเปญ');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
