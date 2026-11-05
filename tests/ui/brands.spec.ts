import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const headers = { Origin: 'http://127.0.0.1:3000' };
type Brand = { id: string; public_brand_id: string; rem_brand_id: string; public_name: Record<string, string>; updated_at: string; published_version_id: string | null };

async function fixture() {
  const config = JSON.parse(await readFile('.local/development.json', 'utf8'));
  const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: config.adminPassword });
  await db.connect();
  const suffix = randomUUID();
  const sourceId = `E2E-BRAND-${suffix}`;
  const projectId = `E2E-BRAND-PROJECT-${suffix}`;
  const name = `แบรนด์ทดสอบ ${suffix.slice(0, 8)}`;
  await db.query("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000005',false),set_config('app.change_reason','Synthetic brand browser fixture',false)");
  await db.query('INSERT INTO staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint) VALUES($1,$2,now(),$1)', [sourceId, name]);
  await db.query("INSERT INTO staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint,rem_brand_id,rem_company_id) VALUES($1,$2,now(),$1,$3,'DEMO-CO-A')", [projectId, `โครงการของ ${name}`, sourceId]);
  return {
    sourceId, projectId, name, suffix,
    async cleanup() {
      // Preserve immutable brand releases and audit evidence. This fixture's
      // projects are drafts only, so their source rows can be removed safely.
      try {
        await db.query('BEGIN');
        await db.query('DELETE FROM hub.brand_requests WHERE rem_brand_id=$1', [sourceId]);
        await db.query('DELETE FROM hub.model_types WHERE rem_project_id=$1', [projectId]);
        await db.query('DELETE FROM hub.projects WHERE rem_project_id=$1', [projectId]);
        await db.query('DELETE FROM staging.rem_projects WHERE rem_project_id=$1', [projectId]);
        await db.query('UPDATE hub.brands SET published_version_id=NULL,deleted_at=clock_timestamp() WHERE rem_brand_id=$1', [sourceId]);
        await db.query('UPDATE staging.rem_brands SET is_deleted=true WHERE rem_brand_id=$1', [sourceId]);
        await db.query('COMMIT');
      } catch (error) { await db.query('ROLLBACK'); throw error; }
      finally { await db.end(); }
    },
  };
}

async function role(page: Page, value: 'admin' | 'editor' | 'publisher' | 'viewer') {
  const brandId = new URL(page.url()).searchParams.get('brand');
  const refreshed = brandId ? page.waitForResponse(response => response.url().endsWith(`/api/hub/v1/admin/brands/${brandId}`) && response.request().method() === 'GET') : null;
  const changed = page.waitForResponse(response => response.url().endsWith('/api/local-session') && response.request().method() === 'POST');
  await page.getByLabel('เลือกบัญชีทดสอบ').selectOption(value);
  expect((await changed).ok()).toBeTruthy();
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toBeEnabled();
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue(value);
  if (refreshed) expect((await refreshed).ok()).toBeTruthy();
}

async function createBrand(page: Page, data: Awaited<ReturnType<typeof fixture>>) {
  await page.getByRole('button', { name: 'ดูแบรนด์จากต้นทาง', exact: true }).click();
  await page.getByLabel('ค้นหาแบรนด์ต้นทาง', { exact: true }).fill(data.sourceId);
  const source = page.locator('#brand-source-picker li').filter({ has: page.getByRole('heading', { name: data.name, exact: true }) });
  await source.getByRole('button', { name: 'นำแบรนด์นี้เข้าระบบ', exact: true }).click();
  await expect(page.getByLabel('ชื่อแบรนด์ที่ใช้เผยแพร่')).toHaveValue('');
  return detail(page, new URL(page.url()).searchParams.get('brand')!);
}

async function exposed(locator: Locator) {
  await expect.poll(() => locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0
      && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1
      && (hit === element || !!hit && element.contains(hit));
  })).toBe(true);
}

async function publish(page: Page, reason: string, expected: { before?: string; after: string }) {
  await page.getByRole('button', { name: 'เผยแพร่แบรนด์', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'เผยแพร่แบรนด์', exact: true });
  const confirm = dialog.getByRole('button', { name: 'ยืนยันเผยแพร่แบรนด์', exact: true });
  await expect(confirm).toBeDisabled();
  const field = dialog.getByLabel('เหตุผลในการเผยแพร่แบรนด์', { exact: true });
  await expect(field).toHaveAttribute('required');
  await field.fill('   '); await expect(confirm).toBeDisabled();
  const comparison = dialog.getByRole('region', { name: 'เปรียบเทียบข้อมูลแบรนด์', exact: true });
  await expect(comparison).toContainText(expected.after);
  await expect(comparison.locator('.brand-comparison-row')).toHaveCount(7);
  for (const key of ['public_brand_id', 'public_name', 'description', 'slug', 'status', 'assets', 'synthetic']) {
    await expect(comparison.locator(`[data-field="${key}"]`)).toHaveCount(1);
  }
  if (expected.before) {
    await expect(comparison).toContainText(expected.before);
    await expect(comparison.locator('[data-field="public_name"]')).toHaveClass(/changed/);
    await expect(comparison.locator('[data-field="slug"]')).not.toHaveClass(/changed/);
  } else await expect(dialog.getByRole('heading', { name: 'ตัวอย่างข้อมูลที่จะเผยแพร่', exact: true })).toBeVisible();
  await field.fill(reason); await expect(confirm).toBeEnabled(); await confirm.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
test(`admin registers a brand, editors prepare logos and publisher versions stay isolated at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  test.setTimeout(90_000);
  const data = await fixture();
  try {
    await page.setViewportSize(viewport);
    await page.goto('/?view=brands');
    await role(page, 'admin');
    const brand = await createBrand(page, data);
    await expect(page.locator('.brand-logo-slot')).toHaveCount(4);
    for (const [slot, label] of [['logo_primary', 'โลโก้หลัก'], ['logo_white', 'โลโก้สีขาว'], ['logo_mono', 'โลโก้ขาวดำ'], ['favicon', 'ไอคอนเว็บไซต์ (favicon)']]) {
      const element = page.locator(`.brand-logo-slot[data-logo-role="${slot}"]`);
      await expect(element.getByRole('heading', { name: label, exact: true })).toBeVisible();
      await expect(element).toContainText('สิทธิ์: ยังไม่มีไฟล์ให้ตรวจสอบ');
      await expect(element).toContainText(slot === 'logo_primary' ? 'จำเป็น' : 'ไม่บังคับ');
    }
    const publicPath = `/api/hub/v1/brands/${brand.public_brand_id}`;
    const adminPath = `/api/hub/v1/admin/brands/${brand.public_brand_id}`;
    expect((await page.request.post(`${adminPath}/publish`, { headers, data: { change_reason: 'Admin must not publish' } })).status()).toBe(403);
    await role(page, 'editor');
    expect((await page.request.post('/api/hub/v1/admin/brands', { headers, data: { rem_brand_id: data.sourceId } })).status()).toBe(403);
    await page.getByLabel('ชื่อแบรนด์ที่ใช้เผยแพร่', { exact: true }).fill(data.name);
    await page.getByLabel('ชื่ออ้างอิงแบรนด์', { exact: true }).fill(`e2e-brand-${data.suffix}`);
    await page.getByLabel('คำอธิบายแบรนด์ (ภาษาไทย)', { exact: true }).fill('แบรนด์สมมติสำหรับทดสอบการจัดการเนื้อหาและโลโก้เท่านั้น');
    const save = page.getByRole('button', { name: 'บันทึกข้อมูลแบรนด์', exact: true });
    await expect(save).toHaveClass(/primary/);
    await expect(page.locator('.brand-save-bar')).toBeVisible();
    await exposed(save);
    await page.getByRole('button', { name: 'บันทึกข้อมูลแบรนด์', exact: true }).click();
    await expect(page.getByRole('button', { name: 'บันทึกข้อมูลแบรนด์', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'เปิดคลังสื่อ', exact: true }).click();
    await page.getByLabel('ค้นหาชื่อไฟล์ในคลัง', { exact: true }).fill('synthetic-demo-brand-logo.svg');
    const logo = page.locator('[data-asset-library] article').filter({ has: page.getByText('synthetic-demo-brand-logo.svg', { exact: true }) });
    await logo.getByRole('button', { name: 'เลือกใช้กับแบรนด์', exact: true }).click();
    const binding = page.getByRole('dialog');
    await binding.getByLabel('บทบาทของไฟล์', { exact: true }).selectOption('logo_primary');
    await binding.getByLabel('คำอธิบายภาพ (ภาษาไทย)', { exact: true }).fill('โลโก้สมมติสำหรับทดสอบเท่านั้น');
    await binding.getByRole('button', { name: 'ผูกไฟล์กับแบรนด์', exact: true }).click();
    await expect(binding).toHaveCount(0);
    await expect(page.locator('.brand-logo-slot[data-logo-role="logo_primary"]').getByText('อนุมัติสิทธิ์แล้ว', { exact: true })).toBeVisible();
    expect((await page.request.get(publicPath)).status()).toBe(404);
    await role(page, 'publisher');
    await expect(page.locator('.brand-review-fields input, .brand-review-fields textarea, .brand-review-fields select')).toHaveCount(0);
    await expect(page.locator('.brand-review-fields')).toContainText(data.name);
    const preview = page.getByRole('region', { name: 'ตัวอย่างแบรนด์บนเว็บไซต์', exact: true });
    await expect(preview.getByRole('heading', { name: data.name, exact: true })).toBeVisible();
    await expect(preview.getByRole('img')).toHaveAttribute('alt', 'โลโก้สมมติสำหรับทดสอบเท่านั้น');
    await expect(preview).toContainText('แบรนด์สมมติสำหรับทดสอบการจัดการเนื้อหาและโลโก้เท่านั้น');
    await expect(page.locator('.detail-heading')).toContainText(data.sourceId);
    await expect(page.locator('.detail-heading')).not.toContainText(brand.public_brand_id);
    const publishButton = page.getByRole('button', { name: 'เผยแพร่แบรนด์', exact: true });
    if (viewport.width === 1366) await page.evaluate(() => window.scrollTo(0, 600));
    else await publishButton.scrollIntoViewIfNeeded();
    await exposed(publishButton);
    const [publishBox, assistantBox] = await Promise.all([publishButton.boundingBox(), page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true }).boundingBox()]);
    expect(publishBox && assistantBox && (publishBox.x + publishBox.width <= assistantBox.x || assistantBox.x + assistantBox.width <= publishBox.x || publishBox.y + publishBox.height <= assistantBox.y || assistantBox.y + assistantBox.height <= publishBox.y)).toBe(true);
    await publish(page, 'เผยแพร่แบรนด์สมมติครั้งแรก', { after: data.name });
    const first = await (await page.request.get(publicPath)).json();
    expect(first.data.public_name.th).toBe(data.name);
    await role(page, 'editor');
    await page.getByLabel('ชื่อแบรนด์ที่ใช้เผยแพร่').fill(`${data.name} ฉบับใหม่`);
    // Declining a role switch preserves the unsaved brand draft.
    page.once('dialog', dialog => void dialog.dismiss());
    await page.getByLabel('เลือกบัญชีทดสอบ').selectOption('viewer');
    await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('editor');
    await expect(page.getByLabel('ชื่อแบรนด์ที่ใช้เผยแพร่')).toHaveValue(`${data.name} ฉบับใหม่`);
    await page.getByRole('button', { name: 'บันทึกข้อมูลแบรนด์', exact: true }).click();
    await expect(page.getByRole('button', { name: 'บันทึกข้อมูลแบรนด์', exact: true })).toBeDisabled();
    await expect(page.locator('.detail-heading').getByText('มีการแก้ไขรอเผยแพร่', { exact: true })).toBeVisible();
    await expect(page.locator('.detail-heading').getByText('เผยแพร่แล้ว', { exact: true })).toBeVisible();
    expect((await (await page.request.get(publicPath)).json()).data).toEqual(first.data);
    await page.goto('/?view=brands');
    await page.locator('#brand-search').fill(data.sourceId);
    const changed = page.locator('.brand-table-row').filter({ has: page.getByRole('link', { name: `${data.name} ฉบับใหม่`, exact: true }) });
    await expect(changed.getByText(/เผยแพร่แล้ว · มีการแก้ไขรอเผยแพร่/)).toBeVisible();
    await changed.click();
    await role(page, 'publisher');
    await publish(page, 'เผยแพร่แบรนด์สมมติครั้งที่สอง', { before: data.name, after: `${data.name} ฉบับใหม่` });
    await expect(page.locator('.detail-heading').getByText('มีการแก้ไขรอเผยแพร่', { exact: true })).toHaveCount(0);
    expect((await (await page.request.get(publicPath)).json()).data.public_name.th).toBe(`${data.name} ฉบับใหม่`);
    await page.getByRole('tab', { name: 'ประวัติการเผยแพร่แบรนด์', exact: true }).click();
    await page.getByRole('button', { name: 'คืนค่าเวอร์ชันแบรนด์นี้', exact: true }).click();
    const rollback = page.getByRole('dialog');
    await expect(rollback.getByRole('button', { name: 'ยืนยันคืนค่าเวอร์ชันแบรนด์', exact: true })).toBeDisabled();
    await expect(rollback.getByRole('textbox')).toHaveAttribute('required');
    await expect(rollback.locator('[data-field="public_name"]')).toHaveClass(/changed/);
    await expect(rollback.locator('[data-field="public_name"]')).toContainText(`${data.name} ฉบับใหม่`);
    await expect(rollback.locator('[data-field="public_name"]')).toContainText(data.name);
    await expect(rollback).toContainText('เวอร์ชันที่จะคืนค่า');
    await page.getByRole('dialog').getByRole('textbox').fill('ทดสอบคืนค่าแบรนด์สมมติ');
    await page.getByRole('button', { name: 'ยืนยันคืนค่าเวอร์ชันแบรนด์', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await (await page.request.get(publicPath)).json()).data).toEqual(first.data);
    await page.getByRole('tab', { name: 'ข้อมูลและโลโก้แบรนด์', exact: true }).click();
    await page.screenshot({ path: `artifacts/brand-detail-${viewport.width}.png`, fullPage: false });
    await page.getByRole('button', { name: 'ถอนการเผยแพร่แบรนด์', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'ยืนยันถอนการเผยแพร่แบรนด์', exact: true })).toBeDisabled();
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveAttribute('required');
    await page.getByRole('dialog').getByRole('textbox').fill('สิ้นสุดการทดสอบแบรนด์สมมติ');
    await page.getByRole('button', { name: 'ยืนยันถอนการเผยแพร่แบรนด์', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.detail-heading').getByText('หยุดแสดง', { exact: true })).toBeVisible();
    await expect(page.locator('.detail-heading').getByText('มีการแก้ไขรอเผยแพร่', { exact: true })).toHaveCount(0);
    expect((await page.request.get(publicPath)).status()).toBe(404);
    expect((await page.request.get('/api/hub/v1/projects?unexpected=1')).status()).toBe(404);
    expect((await page.request.get(`/api/hub/v1/projects?brand_id=${brand.public_brand_id}&brand_id=x`)).status()).toBe(404);
  } finally { await data.cleanup(); }
});
}

test('long synthetic brand title keeps the initial and sticky publish action clear of the assistant', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  expect((await page.request.post('/api/local-session', { headers, data: { role: 'publisher' } })).ok()).toBeTruthy();
  const response = await page.request.get('/api/hub/v1/admin/brands'); expect(response.ok()).toBeTruthy();
  const brand = (await response.json()).data.find((item: Brand) => item.rem_brand_id === 'DEMO-BRAND-01');
  expect(brand, 'The prepared synthetic long-name brand is present').toBeDefined();
  await page.goto(`/?brand=${brand.public_brand_id}`);
  await expect(page.getByRole('heading', { name: brand.public_name.th, level: 1, exact: true })).toBeVisible();
  const publish = page.getByRole('button', { name: 'เผยแพร่แบรนด์', exact: true });
  const floating = page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true });
  for (const scroll of [0, 600]) {
    if (scroll) await page.evaluate(value => window.scrollTo(0, value), scroll);
    await exposed(publish); await exposed(floating);
    const [action, button] = await Promise.all([publish.boundingBox(), floating.boundingBox()]);
    expect(action && button && (action.x + action.width <= button.x || button.x + button.width <= action.x || action.y + action.height <= button.y || button.y + button.height <= action.y)).toBe(true);
  }
});

test('mobile assistant clears the real publish action throughout intermediate scroll positions', async ({ page }) => {
  const viewport = { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  expect((await page.request.post('/api/local-session', { headers, data: { role: 'publisher' } })).ok()).toBeTruthy();
  const response = await page.request.get('/api/hub/v1/admin/brands'); expect(response.ok()).toBeTruthy();
  const brand = (await response.json()).data.find((item: Brand) => item.rem_brand_id === 'DEMO-BRAND-01');
  expect(brand, 'The existing synthetic brand is inspected without editing it').toBeDefined();
  await page.goto(`/?brand=${brand.public_brand_id}`);
  const publish = page.getByRole('button', { name: 'เผยแพร่แบรนด์', exact: true });
  const floating = page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true });
  await expect(publish).toBeVisible();
  const initial = (await publish.boundingBox())!;
  const documentTop = initial.y + await page.evaluate(() => scrollY);
  // Exercise a partially visible action, both edges of the assistant, and a
  // central position. The page must stay clear between scroll destinations too.
  for (const targetTop of [viewport.height - 20, viewport.height - initial.height - 2, viewport.height - initial.height - 40, 400]) {
    await page.evaluate(value => window.scrollTo({ top: value, behavior: 'instant' }), Math.max(0, documentTop - targetTop));
    await expect.poll(async () => {
      const [action, button] = await Promise.all([publish.boundingBox(), floating.boundingBox()]);
      if (!action || !button) return { visible: false, clear: false };
      const visible = action.y < viewport.height && action.y + action.height > 0;
      const clear = action.x + action.width <= button.x || button.x + button.width <= action.x
        || action.y + action.height <= button.y || button.y + button.height <= action.y;
      return { visible, clear };
    }).toEqual({ visible: true, clear: true });
    await exposed(floating);
  }
});

test('brand requests, exact project association, viewer permissions and mobile layout', async ({ page }) => {
  test.setTimeout(90_000);
  const data = await fixture();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?view=brands');
    await role(page, 'editor');
    const requestButton = page.getByRole('button', { name: 'ขอเพิ่มแบรนด์', exact: true });
    await requestButton.click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(requestButton).toBeFocused();
    await requestButton.click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('ชื่อแบรนด์ที่ต้องการ', { exact: true }).fill(data.name);
    await dialog.getByLabel('รหัสแบรนด์ REM (ถ้าทราบ)', { exact: true }).fill(data.sourceId);
    await dialog.getByLabel('เหตุผลในการขอเพิ่มแบรนด์', { exact: true }).fill('ต้องการเตรียมข้อมูลแบรนด์สมมติสำหรับโครงการทดสอบ');
    await page.screenshot({ path: 'artifacts/brand-request-mobile.png' });
    await dialog.getByRole('button', { name: 'ส่งคำขอเพิ่มแบรนด์', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const requestRow = page.locator('#brand-requests li').filter({ has: page.getByRole('heading', { name: data.name, exact: true }) });
    await expect(requestRow.getByText('รอตรวจสอบ', { exact: true })).toBeVisible();
    await role(page, 'admin');
    await expect.poll(() => page.locator('#brand-requests').evaluate(element => {
      const grid = document.querySelector('.brand-completeness-table');
      return !!grid && !!(element.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    await expect(page.locator('#brand-requests .count')).not.toHaveText('0');
    const created = await page.request.post('/api/hub/v1/admin/brands', { headers, data: { rem_brand_id: data.sourceId } });
    expect(created.status()).toBe(201);
    const brand: Brand = (await created.json()).data;
    expect(brand.public_name).toEqual({});
    const named = await page.request.patch(`/api/hub/v1/admin/brands/${brand.public_brand_id}`, { headers, data: { updated_at: brand.updated_at, public_name: { th: data.name } } });
    expect(named.status()).toBe(200);
    await page.reload();
    await requestRow.getByRole('button', { name: 'พิจารณาคำขอ', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('แบรนด์สำหรับคำขอ', { exact: true }).selectOption(brand.id);
    await dialog.getByLabel('เหตุผลในการพิจารณาคำขอ', { exact: true }).fill('ตรวจรหัส REM และสร้างข้อมูลแบรนด์สมมติแล้ว');
    await dialog.getByRole('button', { name: 'บันทึกผลพิจารณา', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(requestRow.getByText('เชื่อมแบรนด์แล้ว', { exact: true })).toBeVisible();
    await role(page, 'editor');
    const projectResponse = await page.request.post('/api/hub/v1/admin/projects', { headers, data: { rem_project_id: data.projectId } });
    expect(projectResponse.status()).toBe(201);
    const project = (await projectResponse.json()).data;
    await page.goto(`/?project=${project.public_project_id}`);
    const association = page.locator('#project-brand');
    await expect(association.getByText('DEMO-CO-A', { exact: true })).toBeVisible();
    await association.getByRole('button', { name: 'เลือกแบรนด์ที่ตรงกับต้นทาง', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('แบรนด์ของโครงการ', { exact: true }).selectOption(brand.id);
    await dialog.getByRole('button', { name: 'บันทึกแบรนด์ของโครงการ', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(association.getByRole('link', { name: data.name, exact: true })).toBeVisible();
    const current = (await (await page.request.get(`/api/hub/v1/admin/projects/${project.public_project_id}`)).json()).data;
    expect(current.brand_id).toBe(brand.id);
    expect(current.source.rem_company_id).toBe('DEMO-CO-A');
    expect(current.readiness.ready).toBe(false); // The newly linked brand is still a draft.
    const brands: Brand[] = (await (await page.request.get('/api/hub/v1/admin/brands')).json()).data;
    const other = brands.find(item => item.rem_brand_id === 'DEMO-BRAND-01')!;
    expect((await page.request.post(`/api/hub/v1/admin/projects/${project.public_project_id}/brand`, { headers, data: { brand_id: other.id, updated_at: current.updated_at } })).status()).toBe(422);
    await page.goto('/?view=brands');
    await role(page, 'viewer');
    await expect(page.getByRole('button', { name: 'ขอเพิ่มแบรนด์', exact: true })).toHaveCount(0);
    await page.goto(`/?brand=${brand.public_brand_id}`);
    await expect(page.locator('.brand-review-fields')).toContainText(data.name);
    await expect(page.locator('.brand-review-fields input, .brand-review-fields textarea, .brand-review-fields select')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'บันทึกข้อมูลแบรนด์', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: 'artifacts/brand-detail-mobile.png' });
  } finally { await data.cleanup(); }
});

async function detail(page: Page, publicId: string): Promise<Brand> {
  const response = await page.request.get(`/api/hub/v1/admin/brands/${publicId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}
