import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { closeMobileMenu, openMobileMenu } from './hub-navigation-helpers';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// These three accounts exist only inside this spec's verified disposable run.
// No response is mocked: browser, Next proxy, API and DB all enforce the boxes.
const origin = 'http://127.0.0.1:3000';
const headers = { Origin: origin };
const api = '/api/hub/v1/admin';
const personas = {
  uat_admin: 'ec4582d4-c806-5b44-bc73-d6c358e45a83',
  uat_suspended: 'd66df957-c45f-5ed7-ac2f-371645c1a91b',
  uat_somchai: '2499dad0-228e-5633-9565-20e8935bcc82',
};
const shots = 'artifacts/permissions-uat';
function seed(cleanup = false) {
  if (!process.env.HUB_DISPOSABLE_TEST_RUN) throw new Error('UAT UI requires the disposable runner');
  const python = path.resolve('apps/api/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  execFileSync(python, ['scripts/seed-permissions-uat.py', '--disposable', ...(cleanup ? ['--cleanup'] : [])], { stdio: 'pipe', timeout: 60_000 });
}
async function persona(request: APIRequestContext, role: string) {
  expect((await request.post('/api/local-session', { headers, data: { role } })).status()).toBe(200);
  const response = await request.get('/api/hub/v1/me'); expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function account(request: APIRequestContext, id: string) {
  const response = await request.get(`${api}/accounts`); expect(response.status()).toBe(200);
  const row = (await response.json()).data.items.find((item: { id: string }) => item.id === id);
  expect(row).toBeTruthy(); return row;
}
async function setAccess(request: APIRequestContext, id: string, access: any) {
  const current = await account(request, id);
  const response = await request.post(`${api}/accounts/${id}/permissions`, { headers, data: {
    tabs: access.tabs, template: access.template, can_manage_users: access.can_manage_users,
    updated_at: current.updated_at, note: 'ตรวจรับสิทธิ์ด้วยบัญชีสมมติในเครื่อง',
  } });
  expect(response.status()).toBe(200); return (await response.json()).data;
}
async function decide(request: APIRequestContext, id: string, action: 'suspend' | 'reactivate') {
  const current = await account(request, id);
  const response = await request.post(`${api}/accounts/${id}/decision`, { headers, data: {
    action, hub_role: current.hub_role, agency_code: current.agency_code, updated_at: current.updated_at,
    note: 'เหตุผลสมมติสำหรับตรวจรับในเครื่อง',
  } });
  expect(response.status()).toBe(200);
}
async function manage(page: Page, email: string) {
  await page.getByRole('tab', { name: 'ผู้ใช้ทั้งหมด', exact: true }).click();
  await page.getByRole('row').filter({ hasText: email }).getByRole('button', { name: 'จัดการ', exact: true }).click();
  return page.getByRole('dialog');
}

test.beforeAll(async () => { seed(); await mkdir(shots, { recursive: true }); });
test.afterAll(() => seed(true));

test('local UAT personas retain a switch path from suspension and land by actual capabilities', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toBeVisible();
  await expect(page.getByLabel('เลือกบัญชีทดสอบ').getByRole('option', { name: /ผู้ดูแลสำรอง \(UAT\)/ })).toHaveAttribute('value', 'uat_admin');
  await page.screenshot({ path: `${shots}/local-personas.png`, fullPage: true });
  await page.getByLabel('เลือกบัญชีทดสอบ').selectOption('uat_suspended');
  await expect(page).toHaveURL(/\/account\/request$/);
  await expect(page.getByRole('heading', { name: 'ระงับ', exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/hub/v1/me')).json()).data).toMatchObject({ id: personas.uat_suspended, status: 'SUSPENDED' });
  expect((await page.request.get(`${api}/projects`)).status()).toBe(403);
  await page.screenshot({ path: `${shots}/suspended-status.png`, fullPage: true });
  await page.getByLabel('เลือกบัญชีทดสอบ').selectOption('uat_admin');
  await expect(page).toHaveURL(`${origin}/home`);
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('uat_admin');
  expect((await (await page.request.get('/api/hub/v1/me')).json()).data.capabilities.can_manage_users).toBe(true);
  await page.goto('/ads/finance');
  await page.getByLabel('เลือกบัญชีทดสอบ').selectOption('viewer');
  await expect(page).toHaveURL(`${origin}/home`);
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('viewer');
  await persona(page.request, 'online_staff'); await page.goto('/ads/registry');
  await page.getByLabel('เลือกบัญชีทดสอบ').selectOption('uat_somchai');
  await expect(page).toHaveURL(`${origin}/home`);
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('uat_somchai');
});

test('Somchai has exactly four tabs with the custom grid, and hidden management APIs fail closed', async ({ page }) => {
  const me = await persona(page.request, 'uat_somchai');
  expect(me.id).toBe(personas.uat_somchai);
  const tabs = me.capabilities.tabs as Record<string, { view: boolean; edit: boolean; approve: boolean }>;
  expect(Object.keys(tabs).filter(tab => tabs[tab].view).sort()).toEqual(['brands', 'finance', 'projects', 'promotions']);
  expect(Object.keys(tabs).filter(tab => tabs[tab].edit).sort()).toEqual(['finance', 'projects']);
  expect(Object.keys(tabs).filter(tab => tabs[tab].approve)).toEqual([]);
  expect(me.capabilities.can_manage_users).toBe(false); expect(me.capabilities.customised).toBe(true);
  await page.goto('/');
  await openMobileMenu(page);
  const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
  // Services remain explicit even with one permitted item; empty services stay hidden.
  await menu.getByRole('button', { name: 'งานโฆษณาและงบ', exact: true }).click();
  for (const label of ['หน้าแรก', 'ข้อมูลเว็บไซต์', 'โปรโมชั่น', 'งบและค่าใช้จ่าย']) await expect(menu.getByRole('link', { name: label, exact: true })).toBeVisible();
  for (const href of ['/ads/registry', '/ads/archive', '/ads/actuals', '/knowledge', '/releases', '/questions', '/admin/accounts']) await expect(menu.locator(`a[href="${href}"]`)).toHaveCount(0);
  await page.screenshot({ path: `${shots}/somchai-custom-tabs.png`, fullPage: true });
  for (const route of ['projects', 'brands/completeness.csv', 'ads/memos']) expect((await page.request.get(`${api}/${route}`)).status()).toBe(200);
  for (const route of ['ads/registrations', 'ads/archive', 'ads/actuals', 'knowledge/projects', 'releases/candidates']) expect((await page.request.get(`${api}/${route}`)).status()).toBe(403);
  expect((await page.request.post(`${api}/brands`, { headers, data: {} })).status()).toBe(403);
  expect((await page.request.post(`${api}/ads/memos/00000000-0000-4000-8000-000000000000/confirm-record`, { headers, data: { expected_version: 1 } })).status()).toBe(403);
  await closeMobileMenu(page);
  await page.setViewportSize({ width: 400, height: 860 });
  await openMobileMenu(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('dialog', { name: 'เมนูพื้นที่ทำงาน', exact: true }).waitFor({ state: 'visible' });
  await page.screenshot({ path: `${shots}/somchai-mobile-400.png`, fullPage: false, animations: 'disabled' });
});

test('second manager sees audited custom boxes, self locks and the real Actuals rollout diff', async ({ page, browser }) => {
  await persona(page.request, 'uat_admin'); await page.goto('/admin/accounts');
  const original = await account(page.request, personas.uat_somchai);
  try {
    let panel = await manage(page, 'uat-admin@example.test');
    await expect(panel.getByText('นี่คือบัญชีของคุณ', { exact: true })).toBeVisible();
    await expect(panel.getByLabel('แม่แบบสิทธิ์', { exact: true })).toBeDisabled();
    const self = await account(page.request, personas.uat_admin);
    expect((await page.request.post(`${api}/accounts/${self.id}/permissions`, { headers, data: { tabs: self.access.tabs, template: self.access.template, can_manage_users: true, updated_at: self.updated_at } })).status()).toBe(403);
    await page.keyboard.press('Escape'); panel = await manage(page, 'uat-somchai@example.test');
    await expect(panel.getByRole('checkbox', { name: 'โครงการที่อยู่อาศัย แก้ไข', exact: true })).toBeChecked();
    await expect(panel.getByRole('checkbox', { name: 'โครงการที่อยู่อาศัย อนุมัติ', exact: true })).toBeDisabled();
    await expect(panel.getByRole('checkbox', { name: 'แบรนด์ที่อยู่อาศัย แก้ไข', exact: true })).not.toBeChecked();
    await panel.getByRole('region', { name: 'ตารางสิทธิ์รายแท็บ', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/second-admin-panel.png`, fullPage: false });
    await page.keyboard.press('Escape');
    const notice = page.getByRole('region', { name: 'แท็บใหม่ ผลใช้จ่ายรายเดือน', exact: true });
    await notice.getByRole('button', { name: 'กำหนดสิทธิ์แท็บนี้', exact: true }).click(); panel = page.getByRole('dialog');
    await panel.getByRole('checkbox', { name: /uat-somchai@example.test/ }).check();
    await panel.getByRole('checkbox', { name: 'ผลใช้จ่ายรายเดือน ดู', exact: true }).check();
    await panel.getByRole('button', { name: 'ดูความแตกต่างก่อนยืนยัน', exact: true }).click();
    await expect(panel.getByLabel('ความแตกต่างของสิทธิ์')).toContainText('ผลใช้จ่ายรายเดือน: ไม่มีสิทธิ์ → ดู');
    await expect(panel.getByRole('button', { name: 'ใช้กับ 1 คน', exact: true })).toBeDisabled();
    await panel.getByRole('region', { name: 'ตัวอย่างการปรับสิทธิ์', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/actuals-rollout-rehearsal.png`, fullPage: false });
    await panel.getByRole('checkbox', { name: 'ยืนยันความแตกต่างของทุกบัญชีที่แสดง', exact: true }).check();
    await panel.getByRole('button', { name: 'ใช้กับ 1 คน', exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect((await account(page.request, personas.uat_somchai)).access.tabs.actuals).toEqual(['view']);
    const accepted = await browser.newContext({ baseURL: origin });
    try { await persona(accepted.request, 'uat_somchai'); expect((await accepted.request.get(`${api}/ads/actuals`)).status()).toBe(200); } finally { await accepted.close(); }
    await notice.getByRole('button', { name: 'รับทราบโดยไม่ให้สิทธิ์', exact: true }).click();
    await expect(notice).toHaveCount(0);
  } finally { await setAccess(page.request, personas.uat_somchai, original.access); }
});

test('real permission revocation denies hidden CSV immediately and suspension takes effect next request', async ({ page, browser }) => {
  const manager = await browser.newContext({ baseURL: origin });
  await persona(manager.request, 'uat_admin');
  const original = await account(manager.request, personas.uat_somchai);
  try {
    await persona(page.request, 'uat_somchai'); await page.goto('/?view=brands');
    await expect(page).toHaveURL(`${origin}/website?view=brands`);
    expect((await page.request.get(`${api}/brands/completeness.csv`)).status()).toBe(200);
    await setAccess(manager.request, personas.uat_somchai, { ...original.access, tabs: { ...original.access.tabs, brands: [] } });
    for (const route of ['brands', 'brands/completeness.csv']) expect((await page.request.get(`${api}/${route}`)).status()).toBe(403);
    expect((await page.request.get(`${api}/projects`)).status()).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงหน้านี้', exact: true })).toBeVisible();
    expect((await (await page.request.get('/api/hub/v1/me')).json()).data.status).toBe('ACTIVE');
    await decide(manager.request, personas.uat_somchai, 'suspend');
    expect((await (await page.request.get('/api/hub/v1/me')).json()).data.status).toBe('SUSPENDED');
    expect((await page.request.get(`${api}/projects`)).status()).toBe(403);
    await page.goto('/'); await expect(page).toHaveURL(/\/account\/request$/);
    await expect(page.getByRole('heading', { name: 'ระงับ', exact: true })).toBeVisible();
    await page.getByLabel('เลือกบัญชีทดสอบ').selectOption('uat_admin');
    await expect(page).toHaveURL(`${origin}/home`);
  } finally {
    if ((await account(manager.request, personas.uat_somchai)).status === 'SUSPENDED') await decide(manager.request, personas.uat_somchai, 'reactivate');
    await setAccess(manager.request, personas.uat_somchai, original.access); await manager.close();
  }
});
