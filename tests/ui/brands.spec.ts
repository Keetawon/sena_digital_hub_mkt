import { expect, test, type Page } from '@playwright/test';
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
  await expect(page.getByLabel('ชื่อแบรนด์ที่ใช้เผยแพร่')).toHaveValue(data.name);
  return detail(page, new URL(page.url()).searchParams.get('brand')!);
}

async function publish(page: Page, reason: string) {
  await page.getByRole('button', { name: 'เผยแพร่แบรนด์', exact: true }).click();
  await page.getByLabel('เหตุผลในการเผยแพร่แบรนด์', { exact: true }).fill(reason);
  await page.getByRole('button', { name: 'ยืนยันเผยแพร่แบรนด์', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('admin registers a source brand; editors prepare logos; publisher versions stay isolated', async ({ page }) => {
  test.setTimeout(90_000);
  const data = await fixture();
  try {
    await page.goto('/?view=brands');
    await role(page, 'admin');
    const brand = await createBrand(page, data);
    const publicPath = `/api/hub/v1/brands/${brand.public_brand_id}`;
    const adminPath = `/api/hub/v1/admin/brands/${brand.public_brand_id}`;
    expect((await page.request.post(`${adminPath}/publish`, { headers, data: { change_reason: 'Admin must not publish' } })).status()).toBe(403);
    await role(page, 'editor');
    expect((await page.request.post('/api/hub/v1/admin/brands', { headers, data: { rem_brand_id: data.sourceId } })).status()).toBe(403);
    await page.getByLabel('ชื่ออ้างอิงแบรนด์', { exact: true }).fill(`e2e-brand-${data.suffix}`);
    await page.getByLabel('คำอธิบายแบรนด์ (ภาษาไทย)', { exact: true }).fill('แบรนด์สมมติสำหรับทดสอบการจัดการเนื้อหาและโลโก้เท่านั้น');
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
    expect((await page.request.get(publicPath)).status()).toBe(404);
    await role(page, 'publisher');
    await publish(page, 'เผยแพร่แบรนด์สมมติครั้งแรก');
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
    expect((await (await page.request.get(publicPath)).json()).data).toEqual(first.data);
    await role(page, 'publisher');
    await publish(page, 'เผยแพร่แบรนด์สมมติครั้งที่สอง');
    expect((await (await page.request.get(publicPath)).json()).data.public_name.th).toBe(`${data.name} ฉบับใหม่`);
    await page.getByRole('tab', { name: 'ประวัติการเผยแพร่แบรนด์', exact: true }).click();
    await page.getByRole('button', { name: 'คืนค่าเวอร์ชันแบรนด์นี้', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('ทดสอบคืนค่าแบรนด์สมมติ');
    await page.getByRole('button', { name: 'ยืนยันคืนค่าเวอร์ชันแบรนด์', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await (await page.request.get(publicPath)).json()).data).toEqual(first.data);
    await page.getByRole('tab', { name: 'ข้อมูลและโลโก้แบรนด์', exact: true }).click();
    await page.screenshot({ path: 'artifacts/brand-detail-desktop.png', fullPage: false });
    await page.getByRole('button', { name: 'ถอนการเผยแพร่แบรนด์', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('สิ้นสุดการทดสอบแบรนด์สมมติ');
    await page.getByRole('button', { name: 'ยืนยันถอนการเผยแพร่แบรนด์', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await page.request.get(publicPath)).status()).toBe(404);
    expect((await page.request.get('/api/hub/v1/projects?unexpected=1')).status()).toBe(404);
    expect((await page.request.get(`/api/hub/v1/projects?brand_id=${brand.public_brand_id}&brand_id=x`)).status()).toBe(404);
  } finally { await data.cleanup(); }
});

test('brand requests, exact project association, viewer permissions and mobile layout', async ({ page }) => {
  test.setTimeout(90_000);
  const data = await fixture();
  try {
    await page.setViewportSize({ width: 375, height: 900 });
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
    const created = await page.request.post('/api/hub/v1/admin/brands', { headers, data: { rem_brand_id: data.sourceId } });
    expect(created.status()).toBe(201);
    const brand: Brand = (await created.json()).data;
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
    await page.locator('#source > summary').click();
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
    await expect(page.getByLabel('ชื่อแบรนด์ที่ใช้เผยแพร่')).toBeDisabled();
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
