import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const api = '/api/hub/v1/admin/ads';
const headers = { Origin: 'http://127.0.0.1:3000' };
type Detail = { registration: { code: string; label: string }; names: { name_id: string; variant: string | null; frozen_name: string; launch_pack: string }[]; bindings: { account_id: string; campaign_id: string }[] };

async function role(page: Page, value: string) {
  const changed = page.waitForResponse(response => response.url().endsWith('/api/local-session') && response.request().method() === 'POST');
  await page.getByLabel('เลือกบัญชีทดสอบ').selectOption(value);
  expect((await changed).ok()).toBeTruthy();
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue(value);
  await expect(page.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0);
}

async function pick(page: Page, label: string, option: RegExp) {
  await page.getByRole('button', { name: new RegExp(`^${label} `) }).click();
  await page.getByRole('option', { name: option }).click();
}

async function create(page: Page, agency: string) {
  const scopes = await page.request.get(`${api}/scopes?kind=F`);
  expect(scopes.ok()).toBeTruthy();
  const scope = (await scopes.json()).data.find((item: { scope_code: string }) => item.scope_code === 'CORP-TESTCONTENT');
  expect(scope).toBeTruthy();
  const response = await page.request.post(`${api}/registrations`, { headers, data: { scope_kind: 'F', scope_id: scope.scope_id, objective: 'LEADS', agency, content_label: `TEST BOOST ${randomUUID().slice(0, 8).toUpperCase()}`, content_label_approved: true } });
  expect(response.status()).toBe(201);
  return (await response.json()).data as Detail;
}

test('residential account can explicitly switch into the registry without a permission dead end', async ({ page }) => {
  await page.goto('/');
  const session = await page.request.post('/api/local-session', { headers, data: { role: 'editor' } });
  expect(session.ok()).toBeTruthy();
  await page.reload();
  const registryRequests: string[] = [];
  page.on('request', request => { if (request.url().includes(api)) registryRequests.push(request.url()); });
  await page.getByRole('link', { name: 'ทะเบียนแคมเปญ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'เลือกบัญชีสำหรับทะเบียนแคมเปญ', exact: true })).toBeVisible();
  await expect(page.getByText('ขณะนี้ใช้บัญชี “ผู้แก้ไขข้อมูล”', { exact: false })).toBeVisible();
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('editor');
  await expect(page.getByRole('button', { name: 'ลองอีกครั้ง', exact: true })).toHaveCount(0);
  expect(registryRequests).toEqual([]);
  expect((await page.request.get(`${api}/registrations`)).status()).toBe(403);
  await page.getByRole('button', { name: 'ใช้บัญชีทดสอบทีมออนไลน์', exact: true }).click();
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('online_staff');
  await expect(page.getByRole('heading', { name: 'รายการลงทะเบียน', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ลงทะเบียนแคมเปญ', exact: true })).toBeVisible();
  expect((await page.request.get(`${api}/registrations`)).status()).toBe(200);
});

test('Online issues an approved corporate label through server preview and copies the exact launch pack', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addInitScript(() => {
    if (!navigator.clipboard) return;
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async value => {
      (window as Window & { copiedByRegistry?: string }).copiedByRegistry = value;
      return write(value);
    };
  });
  await page.goto('/ads/registry');
  await role(page, 'online_staff');
  await expect(page.getByText('รออนุมัติรูปแบบชื่อ', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'ลงทะเบียนแคมเปญ', exact: true }).click();
  await pick(page, 'ประเภทขอบเขต', /^F ·/);
  await pick(page, 'ขอบเขตที่เลือก', /^CORP-TESTCONTENT ·/);
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await pick(page, 'วัตถุประสงค์', /^LEADS ·/);
  await pick(page, 'เอเจนซีที่รับชื่อ', /^KIN ·/);
  const label = `TEST BOOST ${randomUUID().slice(0, 8).toUpperCase()}`;
  await page.getByLabel('ชื่อเนื้อหาต่อบูสต์ที่อนุมัติ (ภาษาอังกฤษ)').fill(label);
  const previewResponse = page.waitForResponse(response => response.url().endsWith('/registrations/preview') && response.status() === 200);
  await page.getByLabel('ทีมออนไลน์ยืนยันว่าชื่อเนื้อหานี้ได้รับอนุมัติแล้ว').check();
  const preview = await previewResponse;
  const payload = preview.request().postDataJSON();
  expect(payload).not.toHaveProperty('name');
  expect(payload).not.toHaveProperty('frozen_name');
  expect(payload.content_label).toBe(label);
  const previewData = (await preview.json()).data;
  await expect(page.locator('.registry-name')).toHaveText(previewData.preview_name);
  expect(previewData.preview_name).toContain('รหัสจะออกเมื่อบันทึก');
  await expect(page.getByRole('button', { name: 'คัดลอกชื่อ', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  const created = page.waitForResponse(response => response.url().endsWith('/registrations') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'บันทึกและออกชื่อ' }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const detail: Detail = (await response.json()).data;
  await expect(page.getByRole('heading', { name: `ออกชื่อเรียบร้อยแล้ว: ${detail.registration.code}` })).toBeVisible();
  await page.getByRole('button', { name: 'คัดลอกชุดข้อมูลสำหรับเปิดแคมเปญ' }).click();
  await expect(page.getByText('คัดลอกแล้ว', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { copiedByRegistry?: string }).copiedByRegistry)).toBe(detail.names[0].launch_pack);
  // Windows converts LF to CRLF in the native clipboard; the delegated API input above stays exact.
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(detail.names[0].launch_pack);
  await page.getByRole('button', { name: 'คัดลอกชื่อ', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(detail.names[0].frozen_name);
  await page.getByRole('link', { name: 'เปิดรายละเอียด', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByText(detail.names[0].frozen_name, { exact: true })).toBeVisible();
  await pick(page, 'รูปแบบย่อยเพิ่มเติม', /^KW-BRAND ·/);
  const added = page.waitForResponse(response => response.url().endsWith(`/${detail.registration.code}/names`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'ออกชื่อรูปแบบย่อย', exact: true }).click();
  const variantResponse = await added;
  expect(variantResponse.ok()).toBe(true);
  const variants: Detail = (await variantResponse.json()).data;
  expect(variants.registration.code).toBe(detail.registration.code);
  expect(variants.names).toHaveLength(2);
  expect(variants.names.every(name => name.frozen_name.includes(detail.registration.code))).toBe(true);
  expect(variants.names.some(name => name.variant === 'KW-BRAND')).toBe(true);
});

test('agency sees only its own names and returns multiple exact source IDs without issuing permission', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/ads/registry');
  await role(page, 'online_staff');
  const kin = await create(page, 'KIN');
  const secondKin = await create(page, 'KIN');
  const combay = await create(page, 'COMBAY');
  await role(page, 'agency_kin');
  await expect(page.getByRole('link', { name: 'ลงทะเบียนแคมเปญ', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^เอเจนซี / })).toHaveCount(0);
  const all = await page.request.get(`${api}/registrations?q=${kin.registration.code}`);
  expect((await all.json()).data.map((row: Detail) => row.registration.code)).toEqual([kin.registration.code]);
  expect((await page.request.get(`${api}/registrations/${combay.registration.code}`)).status()).toBe(404);
  expect((await page.request.post(`${api}/registrations/preview`, { headers, data: {} })).status()).toBe(403);
  await page.getByLabel('ค้นหารหัสหรือชื่อ').fill(combay.registration.code);
  await expect(page.getByText('ไม่พบรายการตามตัวกรอง')).toBeVisible();
  await page.goto(`/ads/registry?registration=${combay.registration.code}`);
  await expect(page.getByRole('dialog').getByText('ไม่พบรายการที่มีสิทธิ์เข้าถึง')).toBeVisible();
  await page.getByRole('button', { name: 'ปิด', exact: true }).click();
  await page.goto(`/ads/registry/inbox?registration=${kin.registration.code}&tab=bindings`);
  await expect(page.getByRole('dialog')).toBeVisible();
  const account = `00000412${randomUUID().slice(0, 8)}`;
  for (const campaign of ['000006', '000007']) {
    await page.getByLabel('รหัสบัญชีโฆษณา', { exact: true }).fill(account);
    await page.getByLabel('รหัสแคมเปญ', { exact: true }).fill(campaign);
    await page.getByRole('button', { name: 'บันทึกรหัส', exact: true }).click();
    await expect(page.getByText(`GOOGLE · ${account} · ${campaign}`, { exact: true })).toBeVisible();
  }
  const bound = (await (await page.request.get(`${api}/registrations/${kin.registration.code}`)).json()).data as Detail;
  expect(bound.bindings.map(binding => binding.campaign_id)).toEqual(expect.arrayContaining(['000006', '000007']));
  expect(bound.bindings.every(binding => binding.account_id === account)).toBe(true);
  await page.getByLabel('รหัสบัญชีโฆษณา', { exact: true }).fill(account);
  await page.getByLabel('รหัสแคมเปญ', { exact: true }).fill('000006');
  await page.getByRole('button', { name: 'บันทึกรหัส', exact: true }).click();
  await expect(page.getByText('รหัสนี้บันทึกไว้แล้ว', { exact: true })).toBeVisible();
  await page.goto(`/ads/registry/inbox?registration=${secondKin.registration.code}&tab=bindings`);
  await page.getByLabel('รหัสบัญชีโฆษณา', { exact: true }).fill(account);
  await page.getByLabel('รหัสแคมเปญ', { exact: true }).fill('000006');
  await page.getByRole('button', { name: 'บันทึกรหัส', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('รหัสแคมเปญ', { exact: true })).toHaveValue('000006');
  // A failed binding keeps the editable draft; explicitly discard it for navigation.
  page.once('dialog', prompt => prompt.accept());
  await page.goto('/ads/registry/new');
  await expect(page.getByText('บัญชีนี้ส่งคืนรหัสและอ่านชื่อของตนเองได้เท่านั้น')).toBeVisible();
});

test('C scope requires distinct phases and keyboard pickers expose the server preview', async ({ page }) => {
  await page.goto('/ads/registry');
  await role(page, 'online_staff');
  await page.goto('/ads/registry/new');
  const type = page.getByRole('button', { name: /^ประเภทขอบเขต / });
  await type.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option', { name: /^C ·/ }).click();
  await expect(type).toBeFocused();
  await pick(page, 'กลุ่มโครงการ', /^C-DEMO-TEST1 ·/);
  await page.getByRole('checkbox', { name: /^00001 ·/ }).check();
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(page.locator('.registry-error[role="alert"]')).toContainText('เลือกสมาชิกอย่างน้อย 2 รายการที่ไม่ซ้ำกัน');
  await page.getByRole('checkbox', { name: /^00002 ·/ }).check();
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await pick(page, 'วัตถุประสงค์', /^LEADS ·/);
  await pick(page, 'เอเจนซีที่รับชื่อ', /^KIN ·/);
  await expect(page.locator('.registry-name')).toContainText('__C-DEMO-TEST1__KIN__รหัสจะออกเมื่อบันทึก');
});

test('normal motion row-to-card remains usable after binding refreshes the source row', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/ads/registry/inbox');
  await role(page, 'online_staff');
  const own = await create(page, 'KIN');
  await page.getByLabel('ค้นหารหัสหรือชื่อ').fill(own.registration.code);
  await page.getByRole('button', { name: `กรอกรหัสสำหรับ ${own.registration.code}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const account = `00000412${randomUUID().slice(0, 8)}`;
  for (const campaign of ['000001', '000002']) {
    await dialog.getByLabel('รหัสบัญชีโฆษณา', { exact: true }).fill(account);
    await dialog.getByLabel('รหัสแคมเปญ', { exact: true }).fill(campaign);
    const refreshed = page.waitForResponse(response => response.url().includes('/registrations?q=') && response.request().method() === 'GET');
    await dialog.getByRole('button', { name: 'บันทึกรหัส', exact: true }).click();
    expect((await refreshed).ok()).toBe(true);
    await expect(dialog.getByText(`GOOGLE · ${account} · ${campaign}`, { exact: true })).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: `กรอกรหัสสำหรับ ${own.registration.code}` })).toBeFocused();
});

test('reduced motion preserves modal focus, Escape, Back/Forward and narrow Thai layout', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ads/registry');
  await role(page, 'online_staff');
  const own = await create(page, 'KIN');
  await page.getByLabel('ค้นหารหัสหรือชื่อ').fill(own.registration.code);
  const row = page.getByRole('button', { name: `ดูรายละเอียด ${own.registration.code}` });
  await row.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: own.registration.code, exact: true })).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`registration=${own.registration.code}`));
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(row).toBeFocused();
  await page.goForward();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'รหัสบนแพลตฟอร์ม', exact: true }).click();
  const account = page.getByLabel('รหัสบัญชีโฆษณา', { exact: true });
  await expect(account).toBeFocused();
  await account.fill('00000412');
  const discard = page.waitForEvent('dialog');
  await page.evaluate(() => history.back());
  await (await discard).dismiss();
  await expect(page).toHaveURL(new RegExp(`registration=${own.registration.code}`));
  await expect(account).toHaveValue('00000412');
  const confirm = page.waitForEvent('dialog');
  await page.evaluate(() => history.back());
  await (await confirm).accept();
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(row).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await row.click();
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
});
