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
  await openMenu(page);
  const navigation = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
  await expect(navigation).toBeVisible();
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(navigation.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
}

async function openMenu(page: Page) {
  const trigger = page.getByRole('button', { name: 'เปิดเมนู', exact: true });
  if ((page.viewportSize()?.width ?? 1280) <= 720) {
    await expect(trigger).toBeVisible();
    await expect(page.locator('.hub-mobile-drawer')).toHaveCount(1);
    if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  }
}

async function reveal(page: Page, group: string) {
  await openMenu(page);
  const button = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('button', { name: group, exact: true });
  if (await button.count() && await button.getAttribute('aria-expanded') === 'false') await button.click();
}

test('shared Hub menu connects projects, brands and every registry screen', async ({ page }) => {
  await enter(page, 'admin');
  await activeSection(page, 'โครงการที่อยู่อาศัย');
  const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
  await menu.getByRole('link', { name: 'แบรนด์ที่อยู่อาศัย', exact: true }).click();
  await expect(page).toHaveURL(/\?view=brands$/);
  await activeSection(page, 'แบรนด์ที่อยู่อาศัย');
  await reveal(page, 'งานโฆษณาและงบ');
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
  await reveal(page, 'ข้อมูลโครงการและแบรนด์');
  await menu.getByRole('link', { name: 'โครงการที่อยู่อาศัย', exact: true }).click();
  await activeSection(page, 'โครงการที่อยู่อาศัย');
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('admin');
});

test('hidden registry stays denied and local return preserves the residential identity', async ({ page }) => {
  await enter(page, 'editor');
  const registryRequests: string[] = [];
  page.on('request', request => { if (request.url().includes(api)) registryRequests.push(request.url()); });
  await expect(page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('link', { name: 'ทะเบียนแคมเปญ', exact: true })).toHaveCount(0);
  expect((await page.goto('/ads/registry'))?.status()).toBe(403);
  await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงหน้านี้', exact: true })).toBeVisible();
  expect(registryRequests).toEqual([]);
  expect((await page.request.get(`${api}/registrations`)).status()).toBe(403);
  await page.getByRole('link', { name: 'กลับไปเลือกบัญชีทดสอบ', exact: true }).click();
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('editor');
});

test('shared navigation stays keyboard accessible at 390px with large Thai text and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%'; });
  });
  await enter(page, 'admin');
  const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
  for (const name of ['โครงการที่อยู่อาศัย', 'แบรนด์ที่อยู่อาศัย', 'ทะเบียนแคมเปญ']) {
    await reveal(page, name === 'ทะเบียนแคมเปญ' ? 'งานโฆษณาและงบ' : 'ข้อมูลโครงการและแบรนด์');
    const link = menu.getByRole('link', { name, exact: true });
    await link.focus();
    await expect(link).toBeFocused();
    // These are native anchor navigations, including the current-page link.
    // Wait for its new document before reopening the responsive drawer.
    await Promise.all([page.waitForEvent('domcontentloaded'), page.keyboard.press('Enter')]);
    await activeSection(page, name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const target = await menu.getByRole('link', { name, exact: true }).boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  }
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'ส่งคืนรหัสแคมเปญ', exact: true }).click();
  await activeSection(page, 'ทะเบียนแคมเปญ');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'ลงทะเบียนแคมเปญ', exact: true }).click();
  await activeSection(page, 'ทะเบียนแคมเปญ');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('mobile drawer starts closed, traps focus, closes for navigation and returns focus on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await enter(page, 'admin', '/?view=brands');
  const opener = page.getByRole('button', { name: 'เปิดเมนู', exact: true });
  const drawer = page.getByRole('dialog', { name: 'เมนูพื้นที่ทำงาน', exact: true });
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('navigation', { name: 'เมนูหลัก', exact: true })).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'แบรนด์ที่อยู่อาศัย', exact: true })).toBeInViewport();
  await opener.focus(); await page.keyboard.press('Enter'); await expect(drawer).toBeVisible();
  await expect(opener).toHaveAttribute('aria-expanded', 'true');
  const closer = drawer.getByRole('button', { name: 'ปิดเมนู', exact: true });
  await closer.focus(); await page.keyboard.press('Shift+Tab');
  // Native Edge dialogs may tab into browser chrome at the document boundary.
  // They must never expose the background page to keyboard/programmatic focus.
  expect(await drawer.evaluate(element => !document.hasFocus() || element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  expect(await drawer.evaluate(element => document.hasFocus() && element.contains(document.activeElement))).toBe(true);
  await page.getByRole('main', { includeHidden: true }).evaluate(element => element.focus());
  expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(drawer).not.toBeVisible(); await expect(opener).toBeFocused();
  await opener.click(); await drawer.getByRole('link', { name: 'โครงการที่อยู่อาศัย', exact: true }).click();
  await expect(page).toHaveURL(/\/$/); await expect(drawer).not.toBeVisible();
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('sidebar groups toggle independently, persist even when the current page is in a collapsed group', async ({ page }) => {
  await enter(page, 'admin'); const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }); const content = menu.getByRole('button', { name: 'ข้อมูลโครงการและแบรนด์', exact: true }); const ads = menu.getByRole('button', { name: 'งานโฆษณาและงบ', exact: true });
  await expect(content).toHaveAttribute('aria-expanded', 'true'); await expect(ads).toHaveAttribute('aria-expanded', 'false'); await ads.click(); await content.click(); await expect(ads).toHaveAttribute('aria-expanded', 'true'); await expect(content).toHaveAttribute('aria-expanded', 'false');
  const contentId = await content.getAttribute('aria-controls'); await expect(page.locator(`[id="${contentId}"]`)).toHaveAttribute('inert', ''); await expect(menu.getByRole('link', { name: 'โครงการที่อยู่อาศัย', exact: true })).not.toBeVisible();
  await page.goto('/questions'); await expect(content).toHaveAttribute('aria-expanded', 'false'); await expect(ads).toHaveAttribute('aria-expanded', 'true'); await page.goto('/?view=brands'); await expect(content).toHaveAttribute('aria-expanded', 'false'); await expect(content).toHaveAttribute('data-current', 'true'); await expect(content).toHaveAttribute('aria-description', 'มีหน้าที่กำลังใช้งานอยู่ในกลุ่มนี้');
  await expect(page.locator('.breadcrumb')).toHaveText('ข้อมูลโครงการและแบรนด์/แบรนด์ที่อยู่อาศัย');
  const paths = await menu.locator('a.nav-link svg path').evaluateAll(elements => elements.map(element => element.getAttribute('d'))); expect(new Set(paths).size).toBe(paths.length);
});

test('collapsed children are skipped by keyboard and storage errors never prevent navigation', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get: () => { throw new DOMException('Storage unavailable', 'SecurityError'); } }); });
  await enter(page, 'admin'); const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }); const content = menu.getByRole('button', { name: 'ข้อมูลโครงการและแบรนด์', exact: true }); const ads = menu.getByRole('button', { name: 'งานโฆษณาและงบ', exact: true });
  await expect(content).toHaveAttribute('aria-expanded', 'true'); await content.focus(); await page.keyboard.press('Space'); await expect(content).toHaveAttribute('aria-expanded', 'false'); await page.keyboard.press('Tab'); await expect(ads).toBeFocused(); await page.keyboard.press('Enter'); await expect(ads).toHaveAttribute('aria-expanded', 'true'); await menu.getByRole('link', { name: 'ทะเบียนแคมเปญ', exact: true }).click(); await activeSection(page, 'ทะเบียนแคมเปญ');
});

test('agency keeps direct registry access and never receives financial, publication or staff-only links', async ({ page }) => {
  expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role: 'agency_kin' } })).ok()).toBeTruthy(); await page.goto('/ads/registry'); const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
  await expect(menu.getByRole('button', { name: 'งานโฆษณาและงบ', exact: true })).toHaveCount(0); await expect(menu.getByRole('link', { name: 'ทะเบียนแคมเปญ', exact: true })).toBeVisible();
  for (const name of ['งบและค่าใช้จ่าย', 'ผลใช้จ่ายรายเดือน', 'ติดตามเอกสาร', 'คลังเอกสาร', 'รายการที่ต้องตรวจสอบ', 'โปรโมชั่นโครงการ', 'ชุดเผยแพร่ข้อมูล', 'คำถามที่รอคำตอบ']) await expect(menu.getByRole('link', { name, exact: true })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'ข้อมูลโครงการและแบรนด์', exact: true })).toHaveCount(0);
  for (const name of ['โครงการที่อยู่อาศัย', 'แบรนด์ที่อยู่อาศัย']) await expect(menu.getByRole('link', { name, exact: true })).toHaveCount(0);
});

test('sidebar hierarchy uses the same section labels and guided links in desktop and mobile', async ({ page }) => {
  await enter(page, 'admin');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await openMenu(page);
    const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
    const toggle = menu.getByRole('button', { name: 'ข้อมูลโครงการและแบรนด์', exact: true });
    await expect(toggle).toHaveCSS('font-size', '12.5px');
    await expect(toggle).toHaveCSS('font-weight', '700');
    await expect(toggle.locator('svg')).toHaveCount(1);
    const link = menu.getByRole('link', { name: 'โครงการที่อยู่อาศัย', exact: true });
    await expect(link).toHaveCSS('font-size', '15px');
    await expect(link.locator('svg')).toHaveCSS('width', '16px');
    await expect(link.locator('svg')).toHaveCSS('opacity', '0.8');
    await expect(menu.locator('.hub-nav-items').first()).toHaveCSS('border-left-width', '1px');
    await expect(menu.locator('.hub-nav-items').first()).toHaveCSS('padding-left', '16px');
    await expect(menu.locator('.hub-nav-standalone')).toHaveCSS('border-top-width', '1px');
    await expect(menu.getByRole('link', { name: 'คำถามที่รอคำตอบ', exact: true })).toHaveCSS('font-size', '15.5px');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(menu.locator('.hub-nav-collapse').first()).toHaveCSS('transition-duration', '0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(menu.locator('.hub-nav-collapse').first()).toHaveCSS('transition-duration', '0s');
  }
});


test('desktop rail persists, labels appear on focus and badges remain visible', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 }); await enter(page, 'admin');
  const sidebar = page.getByRole('complementary', { name: 'พื้นที่ทำงาน' });
  const toggle = sidebar.getByRole('button', { name: 'ย่อเมนู', exact: true });
  await expect(sidebar).toHaveCSS('width', '244px');
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(sidebar).toHaveCSS('width', '64px');
  await expect(sidebar.getByRole('button', { name: 'ขยายเมนู', exact: true })).toBeFocused();
  await expect(sidebar.getByRole('button', { name: 'ขยายเมนู', exact: true })).toHaveAttribute('aria-expanded', 'false');
  const accounts = sidebar.getByRole('link', { name: 'ผู้ใช้และสิทธิ์', exact: true });
  await accounts.focus(); await expect(accounts.getByRole('tooltip')).toBeVisible();
  await expect(accounts.getByRole('tooltip')).toHaveText('ผู้ใช้และสิทธิ์');
  const label = await accounts.getByRole('tooltip').boundingBox(); expect(label!.x).toBeGreaterThanOrEqual(64);
  await expect(accounts.getByLabel('บัญชีรออนุมัติ')).toBeVisible();
  await page.screenshot({ path: 'artifacts/permissions-uat/sidebar-focus-1280.png', fullPage: false });
  await expect(sidebar.locator('.wordmark')).toHaveText('SENA.DIGITAL HUB');
  await expect(sidebar.locator('.wordmark-full')).not.toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'ผู้ช่วย Hub', exact: true })).toBeVisible();
  await page.reload(); await expect(sidebar).toHaveCSS('width', '64px');
  await page.screenshot({ path: 'artifacts/permissions/sidebar-rail-1280.png', fullPage: true });
  await sidebar.getByRole('button', { name: 'ขยายเมนู', exact: true }).click();
  await page.reload(); await expect(sidebar).toHaveCSS('width', '244px');
});

test('tablet rail expands over content and closes with Escape or outside click, returning focus', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 }); await enter(page, 'admin');
  const opener = page.getByRole('button', { name: 'ขยายเมนู', exact: true });
  await expect(page.locator('aside.sidebar')).toHaveCSS('width', '64px');
  const before = await page.locator('.main-shell').boundingBox();
  await opener.focus(); await page.keyboard.press('Enter');
  const overlay = page.getByRole('dialog', { name: 'เมนูพื้นที่ทำงาน', exact: true });
  await expect(overlay).toBeVisible(); await expect(overlay).toHaveCSS('animation-name', 'none'); expect((await page.locator('.main-shell').boundingBox())!.x).toBe(before!.x);
  await page.keyboard.press('Tab'); expect(await overlay.evaluate(e => e.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(overlay).not.toBeVisible(); await expect(opener).toBeFocused();
  await page.keyboard.press('Enter'); await expect(overlay).toBeVisible();
  await page.mouse.click(700, 150); await expect(overlay).not.toBeVisible(); await expect(opener).toBeFocused();
});

for (const width of [1280, 1024, 400]) test(`sidebar has no horizontal page overflow at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await enter(page, 'admin');
  if (width === 400) await openMenu(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.sidebar-footer')).toHaveCount(0);
  await page.screenshot({ path: `artifacts/permissions/sidebar-${width}.png`, fullPage: width !== 400 });
  if (width === 1024) { await page.getByRole('button', { name: 'ขยายเมนู', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'เมนูพื้นที่ทำงาน', exact: true })).toBeVisible(); await page.screenshot({ path: 'artifacts/permissions/sidebar-overlay-1024.png' }); }
  if (width !== 1280) await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
