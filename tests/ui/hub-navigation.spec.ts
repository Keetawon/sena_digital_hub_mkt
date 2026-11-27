import { expect, test, type Page } from '@playwright/test';
import { closeMobileMenu } from './hub-navigation-helpers';

const api = '/api/hub/v1/admin/ads';
const origin = 'http://127.0.0.1:3000';

async function enter(page: Page, role: 'admin' | 'editor', path = '/home') {
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
    await stableDrawer(page);
  }
}

async function stableDrawer(page: Page) {
  const drawer = page.locator('.sidebar[open]');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS('animation-name', 'none');
  await expect(drawer).toHaveCSS('opacity', '1');
  await expect(drawer).toHaveCSS('transform', 'none');
  expect(await drawer.evaluate(element => getComputedStyle(element, '::backdrop').animationName)).toBe('none');
}

async function reveal(page: Page, group: string) {
  await openMenu(page);
  const button = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('button', { name: group, exact: true });
  await expect(button).toBeVisible();
  if (await button.getAttribute('aria-expanded') === 'false') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

test('shared Hub menu connects projects, brands and every registry screen', async ({ page }) => {
  await enter(page, 'admin');
  await activeSection(page, 'หน้าแรก');
  await expect(page.locator('.hub-brand-logo:visible')).toHaveAttribute('href', '/home');
  const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
  for (const label of ['KM แบรนด์', 'KM กลุ่มโครงการ', 'KM โครงการ', 'KM องค์กรและธุรกิจอื่น']) {
    await expect(menu.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
  await menu.getByRole('link', { name: 'KM โครงการ', exact: true }).click();
  await expect(page).toHaveURL(/\/website\?view=projects$/);
  await expect(menu.locator('.hub-brand-count-link')).toHaveCount(0);
  await activeSection(page, 'KM โครงการ');
  await page.locator('.unified-workspace > nav.content-tabs').locator('a[href="/website?view=brands"]').click();
  await expect(page).toHaveURL(/\/website\?view=brands$/);
  await activeSection(page, 'KM แบรนด์');
  await menu.getByRole('link', { name: 'KM กลุ่มโครงการ', exact: true }).click();
  await expect(page).toHaveURL(/\/website\?view=groups$/);
  await activeSection(page, 'KM กลุ่มโครงการ');
  await menu.getByRole('link', { name: 'KM องค์กรและธุรกิจอื่น', exact: true }).click();
  await expect(page).toHaveURL(/\/website\?view=businesses$/);
  await activeSection(page, 'KM องค์กรและธุรกิจอื่น');
  await reveal(page, 'งานโฆษณาและงบ');
  await menu.getByRole('link', { name: 'ทะเบียนแคมเปญ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ทะเบียนแคมเปญ', exact: true })).toBeVisible();
  await activeSection(page, 'ทะเบียนแคมเปญ');
  await closeMobileMenu(page);
  const registry = page.getByRole('navigation', { name: 'เมนูทะเบียนแคมเปญ', exact: true });
  await expect(registry.getByRole('link', { name: 'รายการชื่อแคมเปญ', exact: true })).toHaveAttribute('aria-current', 'page');
  await registry.getByRole('link', { name: 'ส่งคืนรหัสแคมเปญ', exact: true }).click();
  await expect(page).toHaveURL(/\/ads\/registry\/inbox$/);
  await activeSection(page, 'ทะเบียนแคมเปญ');
  await closeMobileMenu(page);
  await expect(registry.getByRole('link', { name: 'ส่งคืนรหัสแคมเปญ', exact: true })).toHaveAttribute('aria-current', 'page');
  await registry.getByRole('link', { name: 'ลงทะเบียนแคมเปญ', exact: true }).click();
  await expect(page).toHaveURL(/\/ads\/registry\/new$/);
  await activeSection(page, 'ทะเบียนแคมเปญ');
  await closeMobileMenu(page);
  await expect(registry.getByRole('link', { name: 'ลงทะเบียนแคมเปญ', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'ลงทะเบียนแคมเปญ', exact: true })).toBeVisible();
  await reveal(page, 'ข้อมูลเว็บไซต์และ AI');
  await menu.getByRole('link', { name: 'หน้าแรก', exact: true }).click();
  await activeSection(page, 'หน้าแรก');
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
  const expectedPaths: Record<string, RegExp> = {
    'หน้าแรก': /\/home$/,
    'KM แบรนด์': /\/website\?view=brands$/,
    'KM กลุ่มโครงการ': /\/website\?view=groups$/,
    'KM โครงการ': /\/website\?view=projects$/,
    'KM องค์กรและธุรกิจอื่น': /\/website\?view=businesses$/,
    'ทะเบียนแคมเปญ': /\/ads\/registry$/,
  };
  for (const name of Object.keys(expectedPaths)) {
    await reveal(page, name === 'ทะเบียนแคมเปญ' ? 'งานโฆษณาและงบ' : 'ข้อมูลเว็บไซต์และ AI');
    const link = menu.getByRole('link', { name, exact: true });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(expectedPaths[name]);
    await activeSection(page, name);
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth, viewport: innerWidth, path: location.pathname,
      overflowing: [...document.querySelectorAll('body *')].map(element => ({
        tag: element.tagName, class: element.className, left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width,
      })).filter(item => item.left >= 0 && item.right > innerWidth + 1).slice(0, 20),
    }));
    expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
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
  await expect(page).toHaveURL(/\/website\?view=brands$/);
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
  await opener.click(); await drawer.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('link', { name: 'หน้าแรก', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/); await expect(drawer).not.toBeVisible();
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('sidebar groups toggle independently, persist even when the current page is in a collapsed group', async ({ page }) => {
  await enter(page, 'admin'); await openMenu(page); const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }); const content = menu.getByRole('button', { name: 'ข้อมูลเว็บไซต์และ AI', exact: true }); const ads = menu.getByRole('button', { name: 'งานโฆษณาและงบ', exact: true });
  await expect(content).toHaveAttribute('aria-expanded', 'true'); await expect(ads).toHaveAttribute('aria-expanded', 'false'); await ads.click(); await content.click(); await expect(ads).toHaveAttribute('aria-expanded', 'true'); await expect(content).toHaveAttribute('aria-expanded', 'false');
  const contentId = await content.getAttribute('aria-controls'); await expect(page.locator(`[id="${contentId}"]`)).toHaveAttribute('inert', ''); await expect(menu.getByRole('link', { name: 'หน้าแรก', exact: true })).not.toBeVisible();
  await page.goto('/questions'); await openMenu(page); await expect(content).toHaveAttribute('aria-expanded', 'false'); await expect(ads).toHaveAttribute('aria-expanded', 'true'); await page.goto('/?view=brands'); await openMenu(page); await expect(content).toHaveAttribute('aria-expanded', 'false'); await expect(content).toHaveAttribute('data-current', 'true'); await expect(content).toHaveAttribute('aria-description', 'มีหน้าที่กำลังใช้งานอยู่ในกลุ่มนี้');
  await expect(page.locator('.breadcrumb')).toHaveText('ข้อมูลเว็บไซต์และ AI/KM แบรนด์');
  const paths = await menu.locator('a.nav-link svg path').evaluateAll(elements => elements.map(element => element.getAttribute('d'))); expect(new Set(paths).size).toBe(paths.length);
});

test('collapsed children are skipped by keyboard and storage errors never prevent navigation', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get: () => { throw new DOMException('Storage unavailable', 'SecurityError'); } }); });
  await enter(page, 'admin'); await openMenu(page); const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }); const content = menu.getByRole('button', { name: 'ข้อมูลเว็บไซต์และ AI', exact: true }); const ads = menu.getByRole('button', { name: 'งานโฆษณาและงบ', exact: true });
  await expect(content).toHaveAttribute('aria-expanded', 'true'); await content.focus(); await page.keyboard.press('Space'); await expect(content).toHaveAttribute('aria-expanded', 'false'); await page.keyboard.press('Tab'); await expect(ads).toBeFocused(); await page.keyboard.press('Enter'); await expect(ads).toHaveAttribute('aria-expanded', 'true'); await menu.getByRole('link', { name: 'ทะเบียนแคมเปญ', exact: true }).click(); await activeSection(page, 'ทะเบียนแคมเปญ');
});

test('agency keeps direct registry access and never receives financial, publication or staff-only links', async ({ page }) => {
  expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role: 'agency_kin' } })).ok()).toBeTruthy(); await page.goto('/ads/registry'); await openMenu(page); const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
  await expect(menu.getByRole('button', { name: 'งานโฆษณาและงบ', exact: true })).toHaveAttribute('aria-expanded', 'true'); await expect(menu.getByRole('link', { name: 'ทะเบียนแคมเปญ', exact: true })).toBeVisible();
  for (const name of ['งบและค่าใช้จ่าย', 'ผลใช้จ่ายรายเดือน', 'ติดตามเอกสาร', 'คลังเอกสาร', 'รายการที่ต้องตรวจสอบ', 'โปรโมชั่น', 'เผยแพร่', 'คำถามที่รอคำตอบ']) await expect(menu.getByRole('link', { name, exact: true })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'ข้อมูลเว็บไซต์และ AI', exact: true })).toHaveCount(0);
  for (const name of ['หน้าแรก', 'KM แบรนด์', 'KM กลุ่มโครงการ', 'KM โครงการ', 'KM องค์กรและธุรกิจอื่น']) await expect(menu.getByRole('link', { name, exact: true })).toHaveCount(0);
  const logo = page.locator('.hub-brand-logo:visible');
  await expect(logo).toHaveAttribute('href', '/ads/registry');
  await expect(logo).toHaveAccessibleName('ทะเบียนแคมเปญ');
  await logo.click();
  await expect(page).toHaveURL(/\/ads\/registry$/);
  expect((await page.request.get('/home')).status()).toBe(403);
});

test('sidebar hierarchy uses the same section labels and guided links in desktop and mobile', async ({ page }) => {
  await enter(page, 'admin');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await openMenu(page);
    const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
    const toggle = menu.getByRole('button', { name: 'ข้อมูลเว็บไซต์และ AI', exact: true });
    await expect(toggle).toHaveCSS('font-size', '15.5px');
    await expect(toggle).toHaveCSS('font-weight', '700');
    await expect(toggle.locator('svg')).toHaveCount(2);
    const link = menu.getByRole('link', { name: 'หน้าแรก', exact: true });
    await expect(link).toHaveCSS('font-size', '15px');
    await expect(link.locator('svg')).toHaveCSS('width', '16px');
    await expect(link.locator('svg')).toHaveCSS('opacity', '1');
    await expect(menu.locator('.hub-nav-items').first()).toHaveCSS('border-left-width', '1px');
    await expect(menu.locator('.hub-nav-items').first()).toHaveCSS('padding-left', '10px');
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
  await page.screenshot({ path: 'artifacts/unified-workspace/w3/navigation/local-sidebar-focus-1280.png', fullPage: false });
  await expect(sidebar.locator('.hub-logo-mark')).toBeVisible();
  await expect(sidebar.locator('.hub-logo-mark')).toHaveJSProperty('naturalWidth', 1001);
  await expect(sidebar.locator('.hub-logo-full')).not.toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'ผู้ช่วย Hub', exact: true })).toHaveCount(0);
  await page.reload(); await expect(sidebar).toHaveCSS('width', '64px');
  await page.screenshot({ path: 'artifacts/unified-workspace/w3/navigation/local-sidebar-rail-1280.png', fullPage: true });
  await sidebar.getByRole('button', { name: 'ขยายเมนู', exact: true }).focus();
  await page.keyboard.press('Enter');
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

for (const width of [1280, 1024, 390]) test(`sidebar has no horizontal page overflow at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await enter(page, 'admin');
  if (width === 390) await openMenu(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.sidebar-footer')).toHaveCount(0);
  await page.screenshot({ path: `artifacts/unified-workspace/w3/navigation/local-sidebar-${width}.png`, fullPage: width !== 390 });
  if (width === 1024) { await page.getByRole('button', { name: 'ขยายเมนู', exact: true }).focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('dialog', { name: 'เมนูพื้นที่ทำงาน', exact: true })).toBeVisible(); await stableDrawer(page); await page.screenshot({ path: 'artifacts/unified-workspace/w3/navigation/local-sidebar-overlay-1024.png' }); }
  if (width !== 1280) await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('settings keep canonical destinations, legacy context and active state through native query navigation', async ({ page }) => {
  await enter(page, 'admin');
  await reveal(page, 'ตั้งค่า');
  const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
  for (const [label, href] of [
    ['คำถามมาตรฐาน', '/settings?section=bank'], ['คำแปลมาตรฐาน', '/settings?section=glossary'],
    ['ทะเบียนฟิลด์', '/settings?section=fields'], ['แท็กรูป', '/settings?section=media-tags#tags'],
    ['กติการูปที่ต้องมี', '/settings?section=media-rules#requirements'], ['หลักฐานนำเข้าเดิม', '/knowledge'],
  ]) await expect(menu.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href);
  await menu.getByRole('link', { name: 'คำถามมาตรฐาน', exact: true }).click();
  await activeSection(page, 'คำถามมาตรฐาน');
  await closeMobileMenu(page);
  await page.getByRole('navigation', { name: 'ตั้งค่า', exact: true }).getByRole('link', { name: 'คำแปลมาตรฐาน', exact: true }).click();
  await activeSection(page, 'คำแปลมาตรฐาน');
  await expect(page.locator('.breadcrumb')).toHaveText('ข้อมูลเว็บไซต์และ AI/คำแปลมาตรฐาน');
  await page.goBack(); await activeSection(page, 'คำถามมาตรฐาน');
  await page.goto('/faq?tab=bank&project=SYNTHETIC-CONTEXT&question=SYNTHETIC-QUESTION');
  await expect(page).toHaveURL(url => url.pathname === '/settings' && url.searchParams.get('section') === 'bank' && url.searchParams.get('project') === 'SYNTHETIC-CONTEXT' && url.searchParams.get('question') === 'SYNTHETIC-QUESTION');
  await page.evaluate(() => history.pushState(null, '', '/settings?section=glossary&project=SYNTHETIC-CONTEXT'));
  await activeSection(page, 'คำแปลมาตรฐาน');
  await page.goBack(); await activeSection(page, 'คำถามมาตรฐาน');
  await page.goto('/media?tab=rules&project=SYNTHETIC-CONTEXT#tags');
  await expect(page).toHaveURL(url => url.pathname === '/settings' && url.searchParams.get('section') === 'media-rules' && url.searchParams.get('project') === 'SYNTHETIC-CONTEXT' && url.hash === '#tags');
  await expect(page.locator('#tags')).toBeInViewport();
  await reveal(page, 'ตั้งค่า');
  await expect(menu.getByRole('link', { name: 'แท็กรูป', exact: true })).toHaveAttribute('href', '/settings?section=media-tags#tags');
  await expect(menu.getByRole('link', { name: 'กติการูปที่ต้องมี', exact: true })).toHaveAttribute('href', '/settings?section=media-rules#requirements');
});

test('legacy evidence needs an active content admin and Knowledge View, independent of user management', async ({ page }) => {
  await enter(page, 'admin');
  const original = (await (await page.request.get('/api/hub/v1/me')).json()).data;
  let account = { ...original, role: 'editor', hub_role: 'editor', capabilities: { ...original.capabilities, can_manage_users: true } };
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: account } }));
  await page.reload(); await reveal(page, 'ตั้งค่า');
  const evidence = page.locator('.hub-navigation').getByRole('link', { name: 'หลักฐานนำเข้าเดิม', exact: true });
  await expect(evidence).toHaveCount(0);
  account = { ...account, role: 'admin', hub_role: 'admin', capabilities: { ...account.capabilities, tabs: { ...account.capabilities.tabs, knowledge: { view: false, edit: false, approve: false } } } };
  await page.reload(); await expect(evidence).toHaveCount(0);
  account = { ...original, capabilities: { ...original.capabilities, can_manage_users: false } };
  await page.reload(); await reveal(page, 'ตั้งค่า');
  await expect(evidence).toBeVisible();
  await expect(page.locator('.hub-navigation').getByRole('link', { name: 'ผู้ใช้และสิทธิ์', exact: true })).toHaveCount(0);
  account = { ...account, status: 'SUSPENDED' };
  await page.reload(); await expect(evidence).toHaveCount(0);
});

for (const colorScheme of ['light', 'dark'] as const) test(`SENA semantic palette retains text and control contrast in ${colorScheme}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize({ width: 1280, height: 1000 }); await enter(page, 'admin');
  const pairs = await page.evaluate(() => {
    // Resolve through the browser: the production CSS optimizer may emit #fff
    // or rgb() even when tokens.css uses six-digit hex.
    const probe = document.createElement('span'); probe.hidden = true; document.body.append(probe);
    const luminance = (token: string) => {
      probe.style.color = 'var(--' + token + ')';
      const color = getComputedStyle(probe).color;
      if (!color.startsWith('rgb')) throw new Error('Unsupported computed color for ' + token + ': ' + color);
      const rgba = color.match(/[\d.]+/g)!.map(Number);
      if (rgba.length > 3 && rgba[3] !== 1) throw new Error('Contrast needs an opaque color for ' + token);
      const channels = rgba.slice(0, 3).map(value => value / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const pairs: [string, string, number][] = [];
    for (const foreground of ['ink', 'muted', 'read-only', 'brand', 'action', 'primary-strong', 'gold-strong', 'success-strong', 'warning-strong', 'danger', 'info-strong'])
      for (const background of ['surface', 'canvas', 'surface-warm']) pairs.push([foreground, background, 4.5]);
    for (const foreground of ['sidebar-ink', 'sidebar-muted', 'gold-light'])
      for (const background of ['sidebar', 'sidebar-active']) pairs.push([foreground, background, 4.5]);
    for (const background of ['action', 'primary-strong', 'danger']) pairs.push(['surface', background, 4.5]);
    for (const background of ['gold', 'coral']) pairs.push(['ink', background, 4.5]);
    for (const background of ['art-background', 'art-surface']) pairs.push(['art-ink', background, 4.5]);
    for (const [foreground, background] of [['success-strong', 'success-soft'], ['warning-strong', 'warning-soft'], ['danger', 'danger-soft'], ['info-strong', 'info-soft'], ['sidebar', 'gold-light']]) pairs.push([foreground, background, 4.5]);
    for (const background of ['surface', 'canvas', 'surface-warm']) { pairs.push(['line-strong', background, 3]); pairs.push(['focus', background, 3]); }
    for (const background of ['sidebar', 'sidebar-active']) pairs.push(['sidebar-line', background, 3]);
    for (const foreground of ['action', 'success-strong']) pairs.push([foreground, 'line', 3]);
    const measurements = pairs.map(([foreground, background, minimum]) => {
      const a = luminance(foreground), b = luminance(background);
      return { foreground, background, minimum, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
    probe.remove(); return measurements;
  });
  for (const pair of pairs) expect(pair.ratio, `${pair.foreground} on ${pair.background}`).toBeGreaterThanOrEqual(pair.minimum);
  await expect(page.locator('.hub-brand-logo')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.hub-logo-full')).toBeVisible();
  await expect(page.locator('.hub-logo-full')).toHaveJSProperty('naturalWidth', 1001);
  await page.screenshot({ path: `artifacts/unified-workspace/w3/navigation/local-${colorScheme}-1280.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await openMenu(page); await reveal(page, 'ตั้งค่า');
  const label = page.locator('.hub-navigation').getByRole('link', { name: 'หลักฐานนำเข้าเดิม', exact: true });
  // A pointer click opened Settings. Re-enter with Tab so the browser applies
  // the keyboard focus-visible state rather than inherited pointer modality.
  await page.mouse.move(389, 0);
  await label.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  await expect(label).toBeFocused(); expect(await label.evaluate(element => element.matches(':focus-visible'))).toBe(true);
  await expect(label.locator('.hub-nav-label')).toHaveCSS('white-space', 'nowrap'); await expect(label.locator('.hub-nav-label')).toHaveCSS('text-overflow', 'ellipsis');
  await expect(label.getByRole('tooltip')).toHaveText('หลักฐานนำเข้าเดิม'); await expect(label.getByRole('tooltip')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const tooltip = label.getByRole('tooltip');
  await expect(tooltip).toHaveCSS('bottom', '16px');
  const box = (await tooltip.boundingBox())!, viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(await tooltip.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
  await page.screenshot({ path: `artifacts/unified-workspace/w3/navigation/local-${colorScheme}-390-reduced.png`, fullPage: false });
});
