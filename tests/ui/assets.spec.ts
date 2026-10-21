import { expect, test, type Page } from '@playwright/test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import pg from 'pg';

const headers = { Origin: 'http://127.0.0.1:3000' };
type Asset = { id: string; binding_id?: string; asset_role?: string; original_filename: string; checksum: string; updated_at: string; rights_status: string };

// Real, tiny PNG/PDF fixtures. No enterprise data or external image service.
function png() {
  function chunk(type: string, data: Buffer) {
    const value = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of value) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, value, sum]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from(`Sample\0${randomUUID()}`)), chunk('IDAT', deflateSync(Buffer.concat([Buffer.from([0]), randomBytes(3)]))), chunk('IEND', Buffer.alloc(0))]);
}

function pdf() {
  const stream = `% synthetic sample ${randomUUID()}\nq Q\n`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>', `<< /Length ${stream.length} >>\nstream\n${stream}endstream`];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(value => `${value.toString().padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

async function fixture() {
  const local = JSON.parse(await readFile('.local/development.json', 'utf8'));
  const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: local.adminPassword });
  await db.connect();
  const project = (await db.query("SELECT * FROM hub.projects WHERE rem_project_id='DEMO-001'")).rows[0];
  const bindings = (await db.query('SELECT id FROM hub.entity_assets WHERE project_id=$1 AND deleted_at IS NULL', [project.id])).rows.map(row => row.id);
  const created: string[] = [];
  return {
    project, created,
    async cleanup() {
      // Restore only the sample project's binding selection/published pointer.
      // Immutable publication history, audit evidence and tiny fixture files remain.
      try {
        await db.query('BEGIN');
        await db.query("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true), set_config('app.change_reason','Restore synthetic asset browser fixtures',true)");
        await db.query('UPDATE hub.entity_assets SET deleted_at=clock_timestamp() WHERE project_id=$1 AND deleted_at IS NULL', [project.id]);
        await db.query('UPDATE hub.entity_assets SET deleted_at=NULL WHERE id=ANY($1::uuid[])', [bindings]);
        await db.query('UPDATE hub.projects SET published_version_id=$2 WHERE id=$1', [project.id, project.published_version_id]);
        await db.query("UPDATE hub.assets SET deleted_at=clock_timestamp(),rights_status='revoked' WHERE id=ANY($1::uuid[])", [created]);
        await db.query('COMMIT');
      } catch (error) { await db.query('ROLLBACK'); throw error; }
      finally { await db.end(); }
    },
  };
}

async function role(page: Page, value: 'editor' | 'publisher' | 'viewer') {
  const changed = page.waitForResponse(response => response.url().endsWith('/api/local-session') && response.request().method() === 'POST');
  await page.getByLabel('เลือกบัญชีทดสอบ').selectOption(value);
  expect((await changed).ok()).toBeTruthy();
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toBeEnabled();
  await page.getByRole('tab', { name: /รูปภาพ/ }).click();
  await expect(page.locator('#assets')).toBeVisible();
}

async function library(page: Page) {
  await page.getByRole('tab', { name: /รูปภาพ/ }).click();
  const open = page.getByRole('button', { name: 'เปิดคลังสื่อ', exact: true });
  if (await open.count()) await open.click();
  await expect(page.getByLabel('ค้นหาชื่อไฟล์ในคลัง', { exact: true })).toBeVisible();
}

function entry(page: Page, filename: string) {
  return page.locator('[data-asset-library] article').filter({ has: page.getByText(filename, { exact: true }) });
}

async function approve(page: Page, asset: Asset, decision: 'approved' | 'revoked') {
  await library(page);
  await page.getByLabel('ค้นหาชื่อไฟล์ในคลัง', { exact: true }).fill(asset.original_filename);
  await entry(page, asset.original_filename).getByRole('button', { name: 'ตรวจสอบสิทธิ์', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(decision === 'approved' ? 'อนุมัติสิทธิ์ใช้งาน' : 'ถอนสิทธิ์ใช้งาน', { exact: true }).check();
  await dialog.getByLabel('หลักฐานและเงื่อนไขสิทธิ์', { exact: true }).fill('ไฟล์สังเคราะห์ที่สร้างเพื่อทดสอบในเครื่องเท่านั้น');
  await dialog.getByLabel('เหตุผลในการตรวจสิทธิ์', { exact: true }).fill('ทดสอบขั้นตอนตรวจสิทธิ์ของไฟล์จำลอง');
  await dialog.getByRole('button', { name: /บันทึก.*สิทธิ์|ยืนยัน.*สิทธิ์/ }).click();
  await expect(dialog).toHaveCount(0);
}

test('upload, duplicate reuse, rights approval and published file lifecycle', async ({ page }) => {
  test.setTimeout(90_000);
  const data = await fixture();
  const filename = `ภาพทดสอบ-${randomUUID()}.png`;
  const bytes = png();
  const base = `/api/hub/v1/admin/projects/${data.project.public_project_id}`;
  try {
    await page.goto(`/?project=${data.project.public_project_id}`);
    await role(page, 'editor');
    // This lifecycle checks required primary images. Optional pending images no longer block.
    let initial = (await (await page.request.get(base)).json()).data;
    for (const binding of initial.assets.filter((item: Asset & { is_primary: boolean }) => item.is_primary && ['hero','thumbnail'].includes(item.asset_role || ''))) {
      const removed = await page.request.post(`${base}/assets/${binding.binding_id}/remove`, { headers, data: { updated_at: initial.updated_at } });
      expect(removed.ok()).toBeTruthy();
      initial = (await (await page.request.get(base)).json()).data;
    }
    await page.reload(); await page.getByRole('tab', { name: /รูปภาพ/ }).click();
    const uploadButton = page.getByRole('button', { name: 'อัปโหลดไฟล์', exact: true });
    await uploadButton.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(uploadButton).toBeFocused();
    await uploadButton.click();
    await page.getByRole('dialog').getByRole('button', { name: 'ปิด', exact: true }).click();
    await expect(uploadButton).toBeFocused();
    await uploadButton.click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('เลือกไฟล์ภาพหรือ PDF', { exact: true }).setInputFiles({ name: filename, mimeType: 'image/png', buffer: bytes });
    // Project uploads collect captions first and append to the chosen slot.
    await dialog.getByLabel(`คำอธิบายภาพ (ภาษาไทย) · ${filename}`, { exact: true }).fill('ภาพจำลองเพื่อทดสอบการเผยแพร่');
    await dialog.getByRole('button', { name: 'อัปโหลดและเพิ่มไฟล์', exact: true }).click();
    await expect(dialog).toContainText('เพิ่มแล้ว 1 จาก 1 ไฟล์');
    let asset: Asset = (await (await page.request.get('/api/hub/v1/admin/assets')).json()).data.find((item: Asset) => item.original_filename === filename);
    expect(asset).toBeTruthy(); data.created.push(asset.id);
    expect(asset.checksum).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(asset.rights_status).toBe('pending');
    expect((await page.request.get(`/api/hub/v1/assets/ast_${asset.checksum}/file`)).status()).toBe(404);
    const preview = await page.request.get(`/api/hub/v1/admin/assets/${asset.id}/file`);
    expect(preview.ok()).toBeTruthy(); expect(await preview.body()).toEqual(bytes);
    await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const duplicate = await page.request.post('/api/hub/v1/admin/assets', { headers: { ...headers, 'Content-Type': 'image/png', 'X-Filename': encodeURIComponent(`อีกชื่อ-${filename}`) }, data: bytes });
    expect(duplicate.status()).toBe(200);
    expect((await duplicate.json()).data.id).toBe(asset.id);
    expect((await duplicate.json()).meta.reused).toBe(true);
    await library(page);
    for (const assetRole of ['thumbnail']) {
      await page.locator(`input[name="assets-purpose"][value="${assetRole}"]`).check();
      await entry(page, filename).getByRole('button', { name: 'เลือกใช้กับโครงการ', exact: true }).click();
      dialog = page.getByRole('dialog');
      await expect(dialog.getByLabel('บทบาทของไฟล์', { exact: true })).toHaveValue(assetRole);
      await dialog.getByLabel('คำอธิบายภาพ (ภาษาไทย)', { exact: true }).fill('ภาพจำลองเพื่อทดสอบการเผยแพร่');
      await dialog.getByRole('button', { name: 'บันทึกไฟล์กับโครงการ', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    let project = (await (await page.request.get(base)).json()).data;
    expect(project.readiness.ready).toBe(false);
    await role(page, 'publisher');
    await page.getByRole('tab', { name: /เผยแพร่และประวัติ/ }).click();
    await expect(page.getByRole('button', { name: 'เผยแพร่ข้อมูล', exact: true })).toBeDisabled();
    await page.getByRole('tab', { name: /รูปภาพ/ }).click();
    await approve(page, asset, 'approved');
    expect((await page.request.get(`/api/hub/v1/assets/ast_${asset.checksum}/file`)).status()).toBe(404);
    await page.getByRole('tab', { name: /เผยแพร่และประวัติ/ }).click();
    await page.getByRole('button', { name: 'เผยแพร่ข้อมูล', exact: true }).click();
    await page.getByLabel('เหตุผลในการดำเนินการ').fill('ทดสอบเผยแพร่รูปที่ผ่านการตรวจสิทธิ์');
    await page.getByRole('button', { name: 'ยืนยันเผยแพร่ข้อมูล', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const published = await page.request.get(`/api/hub/v1/assets/ast_${asset.checksum}/file`);
    expect(published.status()).toBe(200); expect(await published.body()).toEqual(bytes);
    expect(published.headers()['cache-control']).toBe('no-store');
    expect(published.headers()['x-content-type-options']).toBe('nosniff');

    // A draft binding removal cannot change bytes referenced by the live snapshot.
    await role(page, 'editor');
    project = (await (await page.request.get(base)).json()).data;
    const hero = project.assets.find((item: Asset) => item.asset_role === 'hero' && item.id === asset.id);
    const removed = await page.request.post(`${base}/assets/${hero.binding_id}/remove`, { headers, data: { updated_at: project.updated_at } });
    expect(removed.ok()).toBeTruthy();
    expect((await page.request.get(`/api/hub/v1/assets/ast_${asset.checksum}/file`)).status()).toBe(200);
    await page.reload(); await role(page, 'publisher');
    await approve(page, asset, 'revoked');
    expect((await page.request.get(`/api/hub/v1/assets/ast_${asset.checksum}/file`)).status()).toBe(404);
    await expect(page.getByText('หยุดแสดงผ่าน API', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'artifacts/asset-rights-revoked.png', fullPage: true });
  } finally { await data.cleanup(); }
});

test('PDF download, invalid file types, viewer permissions and binding conflicts', async ({ page }) => {
  const data = await fixture();
  const base = `/api/hub/v1/admin/projects/${data.project.public_project_id}`;
  const filename = `เอกสารทดสอบ-${randomUUID()}.pdf`;
  try {
    await page.goto(`/?project=${data.project.public_project_id}`); await role(page, 'editor');
    const upload = await page.request.post('/api/hub/v1/admin/assets', { headers: { ...headers, 'Content-Type': 'application/pdf', 'X-Filename': encodeURIComponent(filename) }, data: pdf() });
    expect(upload.status()).toBe(201);
    const asset: Asset = (await upload.json()).data; data.created.push(asset.id);
    await role(page, 'viewer');
    expect((await page.request.get(`/api/hub/v1/admin/assets/${asset.id}/file`)).status()).toBe(404);
    const hidden=(await (await page.request.get('/api/hub/v1/admin/assets')).json()).data as Asset[];
    expect(hidden.some(item=>item.id===asset.id)).toBe(false);
    await role(page, 'editor');
    await page.locator('input[name="assets-purpose"][value="brochure"]').check();
    await library(page);
    await expect(entry(page, filename)).toBeVisible();
    await entry(page, filename).getByRole('button', { name: 'เลือกใช้กับโครงการ', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel('บทบาทของไฟล์', { exact: true })).toHaveValue('brochure');
    await page.getByRole('dialog').getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    const file = await page.request.get(`/api/hub/v1/admin/assets/${asset.id}/file`);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-disposition']).toMatch(/^attachment/);
    expect(file.headers()['content-type']).toContain('application/pdf');
    const project = (await (await page.request.get(base)).json()).data;
    const incompatible = await page.request.post(`${base}/assets`, { headers, data: { asset_id: asset.id, asset_role: 'hero', alt_text: { th: 'เอกสารทดสอบ' }, updated_at: project.updated_at } });
    expect(incompatible.status()).toBe(422);
    const valid = { asset_id: asset.id, asset_role: 'brochure', alt_text: { th: 'เอกสารทดสอบ' }, updated_at: project.updated_at };
    expect((await page.request.post(`${base}/assets`, { headers, data: valid })).status()).toBe(200);
    expect((await page.request.post(`${base}/assets`, { headers, data: valid })).status()).toBe(409);
    expect((await page.request.get(`/api/hub/v1/assets/ast_${asset.checksum}/file`)).status()).toBe(404);
    for (const [type, name, body] of [['image/svg+xml', 'fake.svg', '<svg/>'], ['image/png', 'fake.png', '<html>not an image</html>']]) {
      const invalid = await page.request.post('/api/hub/v1/admin/assets', { headers: { ...headers, 'Content-Type': type, 'X-Filename': name }, data: body });
      expect([415, 422]).toContain(invalid.status());
    }
    expect((await page.request.post('/api/hub/v1/admin/assets', { headers: { ...headers, 'Content-Type': 'image/png', 'X-Filename': 'huge.png' }, data: Buffer.alloc(10 * 1024 * 1024 + 1) })).status()).toBe(413);
    await role(page, 'viewer');
    await expect(page.getByRole('button', { name: 'อัปโหลดไฟล์', exact: true })).toHaveCount(0);
    await library(page);
    await expect(entry(page, filename).getByRole('button', { name: 'เลือกใช้กับโครงการ', exact: true })).toHaveCount(0);
    const denied = await page.request.post('/api/hub/v1/admin/assets', { headers: { ...headers, 'Content-Type': 'image/png', 'X-Filename': 'viewer.png' }, data: png() });
    expect(denied.status()).toBe(403);
    expect((await page.request.post(`/api/hub/v1/admin/assets/${asset.id}/review`, { headers, data: { updated_at: asset.updated_at, decision: 'approved', rights_notes: 'test', change_reason: 'test' } })).status()).toBe(403);
  } finally { await data.cleanup(); }
});
