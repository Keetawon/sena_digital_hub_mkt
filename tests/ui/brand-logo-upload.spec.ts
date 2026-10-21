import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import pg from 'pg';

const headers = { Origin: 'http://127.0.0.1:3000' };
const api = '/api/hub/v1/admin';
const viewports = [{ width: 1366, height: 768 }, { width: 390, height: 844 }];
type FilePayload = { name: string; mimeType: string; buffer: Buffer };
type Asset = { id: string; binding_id: string; original_filename: string; asset_role: string; alt_text: { th: string }; rights_status: string; updated_at: string };

// Small real PNGs, made locally. Every fixture has a unique checksum; no real logos.
function png(width = 64, height = 32) {
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
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const scanlines = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) scanlines[y * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from(`Synthetic\0${randomUUID()}`)), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}

async function session(page: Page, role: string) {
  expect((await page.request.post('/api/local-session', { headers, data: { role }, maxRetries: 1 })).ok()).toBeTruthy();
}

async function fixture(page: Page) {
  const config = JSON.parse(await readFile('.local/development.json', 'utf8'));
  const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: config.adminPassword });
  await db.connect();
  const suffix = randomUUID(), prefix = `E2E-LOGO-${suffix}`, name = `แบรนด์โลโก้สมมติ ${suffix.slice(0, 8)}`;
  await db.query("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000005',false),set_config('app.change_reason','Synthetic logo browser fixture',false)");
  await db.query('INSERT INTO staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint) VALUES($1,$2,now(),$1)', [prefix, name]);
  await session(page, 'admin');
  const created = await page.request.post(`${api}/brands`, { headers, data: { rem_brand_id: prefix } });
  expect(created.status()).toBe(201);
  const brand = (await created.json()).data;
  const named = await page.request.patch(`${api}/brands/${brand.public_brand_id}`, { headers, data: { updated_at: brand.updated_at, public_name: { th: name } } });
  expect(named.status()).toBe(200);
  await session(page, 'editor');
  await page.goto(`/?brand=${brand.public_brand_id}`);
  await expect(page.locator('.brand-logo-slot')).toHaveCount(4);
  return {
    db, brand, name, prefix,
    file(name: string, width = 64, height = 32): FilePayload { return { name: `${prefix}-${name}`, mimeType: 'image/png', buffer: png(width, height) }; },
    async detail(): Promise<{ assets: Asset[]; updated_at: string }> {
      const response = await page.request.get(`${api}/brands/${brand.public_brand_id}`);
      expect(response.ok()).toBeTruthy(); return (await response.json()).data;
    },
    async cleanup() {
      // Keep immutable audit rows and replaced bindings as evidence, and hide only this fixture.
      try {
        await db.query('BEGIN');
        await db.query('UPDATE hub.brand_assets SET deleted_at=clock_timestamp() WHERE brand_id=$1 AND deleted_at IS NULL', [brand.id]);
        await db.query('UPDATE hub.brands SET published_version_id=NULL,deleted_at=clock_timestamp() WHERE id=$1', [brand.id]);
        await db.query('UPDATE hub.assets SET deleted_at=clock_timestamp() WHERE original_filename LIKE $1 AND deleted_at IS NULL', [`${prefix}-%`]);
        await db.query('UPDATE staging.rem_brands SET is_deleted=true WHERE rem_brand_id=$1', [prefix]);
        await db.query('COMMIT');
      } catch (error) { await db.query('ROLLBACK'); throw error; }
      finally { await db.end(); }
    },
  };
}

async function drop(page: Page, target: Locator, files: FilePayload[]) {
  const transfer = await page.evaluateHandle(items => {
    const data = new DataTransfer();
    for (const item of items) data.items.add(new File([Uint8Array.from(atob(item.base64), char => char.charCodeAt(0))], item.name, { type: item.mimeType }));
    return data;
  }, files.map(file => ({ name: file.name, mimeType: file.mimeType, base64: file.buffer.toString('base64') })));
  try { await target.dispatchEvent('drop', { dataTransfer: transfer }); }
  finally { await transfer.dispose(); }
}

function slot(page: Page, role: string) { return page.locator(`.brand-logo-slot[data-logo-role="${role}"]`); }

for (const viewport of viewports) {
  test(`slot upload, replacement history, safe SVG and role-locked library at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(120_000); await page.setViewportSize(viewport);
    const data = await fixture(page);
    try {
      const primary = slot(page, 'logo_primary');
      await expect(primary.getByRole('button', { name: 'อัปโหลด', exact: true })).toBeVisible();
      await expect(primary.getByRole('button', { name: 'เลือกจากคลัง', exact: true })).toBeVisible();
      const alt = primary.getByLabel('คำอธิบายภาพ (ภาษาไทย) · โลโก้หลัก', { exact: true });
      await expect(alt).toHaveValue(new RegExp(data.name));
      await alt.fill('โลโก้หลักสมมติที่กรอกในช่องนี้');
      const first = data.file('primary.png');
      await primary.getByLabel('เลือกไฟล์ · โลโก้หลัก', { exact: true }).setInputFiles(first);
      await expect(primary.getByText(first.name, { exact: true })).toBeVisible();
      await expect(primary.getByText('รอตรวจสิทธิ์', { exact: true })).toBeVisible();
      await expect(page.getByRole('listitem', { name: first.name, exact: true })).toContainText('พื้นหลัง'); // Opaque-image warning never blocks the bind.
      const uploadResult = page.getByRole('listitem', { name: first.name, exact: true });
      await expect(uploadResult.getByRole('status')).toHaveText('ผูกโลโก้ในข้อมูลร่างแล้ว');
      // Read both bounds in one frame, including while the page scrolls smoothly.
      const [previewBox, detailsBox] = await uploadResult.evaluate(element =>
        ['.asset-preview', '.project-upload-details'].map(selector => element.querySelector(selector)!.getBoundingClientRect().toJSON()));
      expect(previewBox.width).toBeLessThanOrEqual(100);
      expect(viewport.width > 700
        ? previewBox.x + previewBox.width <= detailsBox.x
        : previewBox.y + previewBox.height <= detailsBox.y).toBe(true);
      await uploadResult.screenshot({ path: test.info().outputPath('logo-upload-result.png') });
      const old = (await data.detail()).assets.find(asset => asset.asset_role === 'logo_primary')!;
      expect(old.alt_text.th).toBe('โลโก้หลักสมมติที่กรอกในช่องนี้');
      expect(old.rights_status).toBe('pending');
      await expect(primary.getByRole('button', { name: 'เปลี่ยนไฟล์', exact: true })).toBeVisible();

      // A replaced file stays reusable only through an authorized binding;
      // historical ownership alone must not restore global library access.
      const beforeRetention = await data.detail();
      const retained = await page.request.post(`${api}/brands/${data.brand.public_brand_id}/assets`, {
        headers, data: { updated_at: beforeRetention.updated_at, asset_id: old.id,
          asset_role: 'logo_mono', alt_text: { th: 'โลโก้สมมติที่ยังใช้งานอยู่' } },
      });
      expect(retained.status()).toBe(200);
      await page.reload();

      const malicious: FilePayload = { name: `${data.prefix}-replacement.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" onload="alert('unsafe')"><title>${data.prefix}</title><script>alert('unsafe')</script><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject><image href="https://invalid.example/private.png"/><rect width="640" height="320" fill="#145c46" onclick="alert('unsafe')"/><text x="20" y="40">Synthetic logo</text></svg>`) };
      await alt.fill('โลโก้หลัก SVG สมมติฉบับแทนที่');
      await drop(page, primary, [malicious]);
      await expect(primary.getByText(malicious.name, { exact: true })).toBeVisible();
      await expect(primary.getByText(first.name, { exact: true })).toHaveCount(0);
      const current = (await data.detail()).assets.find(asset => asset.asset_role === 'logo_primary')!;
      expect(current.id).not.toBe(old.id);
      const content = await page.request.get(`${api}/assets/${current.id}/file`);
      expect(content.status()).toBe(200);
      expect(content.headers()['content-type']).toContain('image/svg+xml');
      expect(content.headers()['x-content-type-options']).toBe('nosniff');
      expect(content.headers()['content-security-policy']).toContain("default-src 'none'");
      expect(content.headers()['content-security-policy']).toContain('sandbox');
      expect(content.headers()['x-frame-options']).toBe('DENY');
      const sanitized = await content.text();
      expect(sanitized).toContain('Synthetic logo');
      expect(sanitized).not.toMatch(/<script|foreignObject|onload|onclick|invalid\.example|alert\(/i);
      expect((await page.request.get(`/api/hub/v1/assets/ast_${current.checksum}/file`)).status()).toBe(404);

      const history = (await data.db.query('SELECT id,asset_id,deleted_at FROM hub.brand_assets WHERE brand_id=$1 AND asset_role=$2 ORDER BY created_at,id', [data.brand.id, 'logo_primary'])).rows;
      expect(history).toHaveLength(2);
      expect(history.find(row => row.asset_id === old.id)?.deleted_at).toBeTruthy();
      expect(history.find(row => row.asset_id === current.id)?.deleted_at).toBeNull();
      const removedAudit = (await data.db.query("SELECT operation,before_row,after_row FROM audit.change_log WHERE table_name='hub.brand_assets' AND after_row->>'id'=$1 AND operation='UPDATE'", [old.binding_id])).rows;
      expect(removedAudit.some(row => row.before_row.deleted_at === null && row.after_row.deleted_at !== null)).toBe(true);

      // Reuse the retained old file in a different, locked slot; never upload it twice.
      const white = slot(page, 'logo_white');
      await white.getByLabel('คำอธิบายภาพ (ภาษาไทย) · โลโก้สีขาว', { exact: true }).fill('โลโก้สีขาวจากคลังสมมติ');
      await white.getByRole('button', { name: 'เลือกจากคลัง', exact: true }).click();
      const binding = page.getByRole('dialog', { name: 'เลือกจากคลัง · โลโก้สีขาว', exact: true });
      await expect(binding.getByRole('combobox')).toHaveCount(0);
      await expect(binding).toContainText('โลโก้สีขาวจากคลังสมมติ');
      await binding.getByLabel('ค้นหาชื่อโลโก้ในคลัง', { exact: true }).fill(first.name);
      await binding.getByRole('article', { name: first.name, exact: true }).getByRole('button', { name: 'เลือกใช้เป็นโลโก้สีขาว', exact: true }).click();
      await expect(binding).toHaveCount(0);
      await expect(white.getByText(first.name, { exact: true })).toBeVisible();
      expect((await data.detail()).assets.find(asset => asset.asset_role === 'logo_white')?.id).toBe(old.id);
      const favicon = slot(page, 'favicon'), rectangular = data.file('favicon-rectangle.png');
      await favicon.getByLabel('เลือกไฟล์ · ไอคอนเว็บไซต์ (favicon)', { exact: true }).setInputFiles(rectangular);
      await expect(favicon.getByText(rectangular.name, { exact: true })).toBeVisible();
      const warning = page.getByRole('listitem', { name: rectangular.name, exact: true });
      await expect(warning).toContainText('จัตุรัส');
      await expect(warning).toContainText('512');
      expect((await data.detail()).assets.find(asset => asset.asset_role === 'favicon')?.original_filename).toBe(rectangular.name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await data.cleanup(); }
  });

  test(`bulk logo confirmation, role suggestions, previews and individual batch rights at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(120_000); await page.setViewportSize(viewport);
    const data = await fixture(page);
    try {
      const files = [data.file('white.png'), data.file('mono.png'), data.file('small-square.png', 32, 32)];
      const uploaded: string[] = [];
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === `${api}/assets`) uploaded.push(decodeURIComponent(request.headers()['x-filename'])); });
      await drop(page, page.locator('.brand-logo-slots'), files);
      const dialog = page.getByRole('dialog', { name: 'ตรวจสอบโลโก้ก่อนอัปโหลด', exact: true });
      await expect(dialog).toBeVisible();
      for (const [index, role] of ['logo_white', 'logo_mono', 'favicon'].entries()) {
        await expect(dialog.getByLabel(`บทบาท · ${files[index].name}`, { exact: true })).toHaveValue(role);
        await dialog.getByLabel(`คำอธิบายภาพ (ภาษาไทย) · ${files[index].name}`, { exact: true }).fill(`โลโก้สมมติรายการ ${index + 1}`);
      }
      expect(uploaded).toEqual([]);
      expect((await data.detail()).assets).toHaveLength(0);
      await expect(dialog).toContainText('512'); // A small square remains a warning, not a rejection.
      await dialog.getByRole('button', { name: 'ยืนยันอัปโหลดและผูกโลโก้', exact: true }).click();
      await expect(dialog).toContainText('ผูกแล้ว 3 จาก 3 ไฟล์');
      expect(uploaded).toEqual(files.map(file => file.name));
      await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
      const assets = (await data.detail()).assets;
      expect(assets.map(asset => asset.asset_role).sort()).toEqual(['favicon', 'logo_mono', 'logo_white']);
      expect(assets.every(asset => asset.rights_status === 'pending')).toBe(true);
      const favicon = slot(page, 'favicon');
      await expect(favicon.locator('img[width="16"][height="16"]')).toBeVisible();
      await expect(favicon.locator('img[width="32"][height="32"]')).toBeVisible();
      const backgrounds = await page.evaluate(() => ['logo_white', 'logo_mono'].map(role => getComputedStyle(document.querySelector(`[data-logo-role="${role}"] .asset-preview`)!).backgroundColor));
      expect(backgrounds[0]).not.toBe(backgrounds[1]);

      const previousNotes = `สิทธิ์เดิมของไฟล์สังเคราะห์ ${data.prefix}`;
      await data.db.query('UPDATE hub.assets SET rights_notes=$2,effective_from=$3,effective_to=$4 WHERE id=$1', [assets[0].id, previousNotes, '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z']);
      await expect(page.getByRole('button', { name: /^อนุมัติใช้โลโก้ที่เลือก/ })).toHaveCount(0);
      await session(page, 'publisher'); await page.reload();
      for (const file of files) await page.getByLabel(`เลือกอนุมัติ ${file.name}`, { exact: true }).check();
      await page.getByRole('button', { name: 'อนุมัติใช้โลโก้ที่เลือก (3)', exact: true }).click();
      const rights = page.getByRole('dialog', { name: 'อนุมัติใช้โลโก้', exact: true });
      const notes = viewport.width === 1366 ? '' : `หมายเหตุทดสอบ ${data.prefix}`;
      const reason = `อนุมัติใช้โลโก้โดยผู้เผยแพร่${notes ? ` · ${notes}` : ''}`;
      await expect(rights.getByRole('button', { name: 'ยืนยันอนุมัติ 3 ไฟล์', exact: true })).toBeEnabled();
      await expect(rights.getByRole('textbox')).toHaveCount(1);
      if (notes) await rights.getByLabel('หมายเหตุเพิ่มเติม (ไม่บังคับ)', { exact: true }).fill(notes);
      await rights.screenshot({path:`artifacts/brand-logo-approval-${viewport.width}.png`});
      await rights.getByRole('button', { name: 'ยืนยันอนุมัติ 3 ไฟล์', exact: true }).click();
      await expect(rights.getByText('อนุมัติใช้โลโก้แล้ว', { exact: true })).toHaveCount(3);
      await rights.getByRole('button', { name: 'ปิด', exact: true }).click();
      await expect(rights).toHaveCount(0);
      const ids = assets.map(asset => asset.id);
      const records = (await data.db.query('SELECT id,rights_status,rights_notes,review_reason,reviewed_by,reviewed_at,effective_from,effective_to FROM hub.assets WHERE id=ANY($1::uuid[])', [ids])).rows;
      expect(records).toHaveLength(3);
      for (const record of records) {
        expect(record).toMatchObject({ rights_status: 'approved', rights_notes: record.id === assets[0].id ? previousNotes : 'ผู้เผยแพร่อนุมัติใช้โลโก้ผ่านระบบ Hub', review_reason: reason });
        expect(record.reviewed_by).toBe('00000000-0000-0000-0000-000000000002'); expect(record.reviewed_at).toBeTruthy();
        if (record.id === assets[0].id) { expect(record.effective_from.toISOString()).toBe('2020-01-01T00:00:00.000Z'); expect(record.effective_to.toISOString()).toBe('2099-01-01T00:00:00.000Z'); }
      }
      const audits = (await data.db.query("SELECT after_row->>'id' AS asset_id,before_row->>'rights_status' AS before_status,after_row->>'rights_status' AS after_status,database_role,actor FROM audit.change_log WHERE table_name='hub.assets' AND after_row->>'id'=ANY($1::text[]) AND reason=$2", [ids, reason])).rows;
      expect(audits.map(row => row.asset_id).sort()).toEqual([...ids].sort());
      for (const row of audits) { expect(row).toMatchObject({ before_status: 'pending', after_status: 'approved', database_role: 'hub_app', actor: '00000000-0000-0000-0000-000000000002' }); }
      expect((await data.db.query('SELECT published_version_id FROM hub.brands WHERE id=$1', [data.brand.id])).rows[0].published_version_id).toBeNull();
      await session(page, 'viewer'); await page.reload();
      await expect(page.locator('.brand-logo-slot').getByRole('button', { name: /^(อัปโหลด|เปลี่ยนไฟล์|เลือกจากคลัง)$/ })).toHaveCount(0);
      await expect(page.getByLabel(/^เลือกอนุมัติ /)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await data.cleanup(); }
  });
}

async function retryFixture(page: Page, failure: 'upload' | 'bind', existingMono = false) {
  const stamp = '2026-10-02T03:00:00Z', publicId = 'brd_synthetic_logo_retry';
  const brand = {
    id: 'synthetic-logo-retry', public_brand_id: publicId, rem_brand_id: 'SYNTHETIC-LOGO-RETRY',
    public_name: { th: 'แบรนด์สมมติทดสอบการลองใหม่' }, description: { th: 'ข้อมูลทดสอบเท่านั้น' }, slug: 'synthetic-logo-retry',
    status: 'active', updated_at: stamp, published_version_id: null, publication_available: false,
    readiness: { ready: false, percent: 80, missing: [{ field: 'assets', message: 'รอตรวจสิทธิ์โลโก้' }] },
    assets: [] as any[], projects: [], source: { rem_brand_id: 'SYNTHETIC-LOGO-RETRY', brand_name_rem: 'แบรนด์สมมติทดสอบการลองใหม่', is_deleted: false, source_snapshot_at: stamp },
  };
  const assets: any[] = [], uploads: string[] = [], bindings: string[] = [];
  if (existingMono) {
    const previous = { id: 'synthetic-original-mono', original_filename: 'original-mono.png', mime_type: 'image/png', public_url: null, rights_status: 'pending', updated_at: stamp };
    assets.push(previous);
    brand.assets.push({ ...previous, binding_id: 'binding-original-mono', asset_role: 'logo_mono', alt_text: { th: 'โลโก้ขาวดำเดิม' }, is_primary: true, display_order: 0 });
  }
  let failed = false, revision = 0;
  await session(page, 'editor');
  await page.route(`**${api}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname.slice(`${api}/`.length);
    if (request.method() === 'GET') {
      if (/^assets\/[^/]+\/file$/.test(path)) return route.fulfill({ contentType: 'image/png', body: png() });
      return route.fulfill({ json: { data: path === `brands/${publicId}` ? brand : path === 'brands' ? [brand] : path === 'assets' ? assets : path.startsWith('assets/') ? assets.find(asset => asset.id === path.slice('assets/'.length)) : [] } });
    }
    if (request.method() === 'POST' && path === 'assets') {
      const name = decodeURIComponent(request.headers()['x-filename']); uploads.push(name);
      if (failure === 'upload' && !failed && name === 'retry-mono.png') {
        failed = true; return route.fulfill({ status: 503, json: { error: { message: 'อัปโหลดไฟล์สมมติไม่สำเร็จ' } } });
      }
      const asset = { id: `synthetic-${name}`, original_filename: name, mime_type: 'image/png', public_url: null, checksum: 'a'.repeat(64), file_size: 200, width: 64, height: 32, rights_status: 'pending', rights_notes: null, updated_at: stamp, effective_from: null, effective_to: null, reviewed_by: null, reviewed_at: null, review_reason: null, storage_path: null };
      assets.push(asset); return route.fulfill({ status: 201, json: { data: asset, meta: { reused: false } } });
    }
    if (request.method() === 'POST' && path === `brands/${publicId}/assets`) {
      const body = request.postDataJSON();
      expect(body.updated_at).toBe(brand.updated_at);
      bindings.push(body.asset_id);
      if (failure === 'bind' && !failed && body.asset_id === 'synthetic-retry-mono.png') {
        failed = true; return route.fulfill({ status: 503, json: { error: { message: 'ผูกโลโก้สมมติไม่สำเร็จ' } } });
      }
      expect(brand.assets.find(asset => asset.id === body.asset_id), 'A successful binding must never be retried').toBeUndefined();
      const asset = assets.find(asset => asset.id === body.asset_id);
      expect(asset).toBeTruthy();
      brand.assets.push({ ...asset, binding_id: `binding-${asset.id}`, asset_role: body.asset_role, alt_text: body.alt_text, is_primary: true, display_order: 0 });
      brand.updated_at = `2026-10-02T03:00:${String(++revision).padStart(2, '0')}Z`;
      return route.fulfill({ json: { data: brand } });
    }
    throw new Error(`Unexpected fixture request: ${request.method()} ${path}`);
  });
  await page.goto(`/?brand=${publicId}`);
  await expect(page.locator('.brand-logo-slot')).toHaveCount(4);
  return { brand, assets, uploads, bindings };
}

for (const failure of ['upload', 'bind'] as const) {
  test(`bulk logo ${failure} retry keeps completed files and never reuploads an already uploaded asset`, async ({ page }) => {
    const data = await retryFixture(page, failure);
    await drop(page, page.locator('.brand-logo-slots'), [
      { name: 'retry-white.png', mimeType: 'image/png', buffer: png() },
      { name: 'retry-mono.png', mimeType: 'image/png', buffer: png() },
    ]);
    const dialog = page.getByRole('dialog', { name: 'ตรวจสอบโลโก้ก่อนอัปโหลด', exact: true });
    await expect(dialog.getByLabel('บทบาท · retry-white.png', { exact: true })).toHaveValue('logo_white');
    await dialog.getByRole('button', { name: 'ยืนยันอัปโหลดและผูกโลโก้', exact: true }).click();
    await expect(dialog).toContainText('ผูกแล้ว 1 จาก 2 ไฟล์');
    await dialog.getByRole('button', { name: 'ลองอีกครั้งเฉพาะไฟล์ที่ยังไม่สำเร็จ', exact: true }).click();
    await expect(dialog).toContainText('ผูกแล้ว 2 จาก 2 ไฟล์');
    expect(data.uploads).toEqual(failure === 'bind' ? ['retry-white.png', 'retry-mono.png'] : ['retry-white.png', 'retry-mono.png', 'retry-mono.png']);
    expect(data.bindings).toEqual(failure === 'bind' ? ['synthetic-retry-white.png', 'synthetic-retry-mono.png', 'synthetic-retry-mono.png'] : ['synthetic-retry-white.png', 'synthetic-retry-mono.png']);
    expect(data.brand.assets.map(asset => asset.asset_role)).toEqual(['logo_white', 'logo_mono']);
  });
}

for (const change of ['removed', 'rebound'] as const) {
  test(`a failed logo bind cannot silently replace a slot ${change} by another editor before retry`, async ({ page }) => {
    const data = await retryFixture(page, 'bind', true);
    await drop(page, page.locator('.brand-logo-slots'), [
      { name: 'retry-white.png', mimeType: 'image/png', buffer: png() },
      { name: 'retry-mono.png', mimeType: 'image/png', buffer: png() },
    ]);
    const dialog = page.getByRole('dialog', { name: 'ตรวจสอบโลโก้ก่อนอัปโหลด', exact: true });
    await dialog.getByRole('button', { name: 'ยืนยันอัปโหลดและผูกโลโก้', exact: true }).click();
    await expect(dialog).toContainText('ผูกแล้ว 1 จาก 2 ไฟล์');
    await expect(dialog.getByText('ผูกโลโก้สมมติไม่สำเร็จ', { exact: true })).toBeVisible();
    const retry = dialog.getByRole('button', { name: 'ลองอีกครั้งเฉพาะไฟล์ที่ยังไม่สำเร็จ', exact: true });
    await expect(retry).toBeEnabled();
    const prior = data.brand.assets.find(asset => asset.asset_role === 'logo_mono');
    if (change === 'removed') data.brand.assets = data.brand.assets.filter(asset => asset.asset_role !== 'logo_mono');
    else prior.binding_id = 'binding-same-asset-but-new-editor-decision';
    data.brand.updated_at = '2026-10-02T03:05:00Z';
    await retry.click();
    await expect(dialog).toContainText('ช่องโลโก้นี้ถูกแก้ไขแล้ว');
    expect(data.uploads).toEqual(['retry-white.png', 'retry-mono.png']);
    expect(data.bindings).toEqual(['synthetic-retry-white.png', 'synthetic-retry-mono.png']);
    expect(data.brand.assets.filter(asset => asset.asset_role === 'logo_mono')).toHaveLength(change === 'removed' ? 0 : 1);
  });
}

test('batch rights retry reconciles a lost response with equivalent timestamp notation without approving any file twice', async ({ page }) => {
  const data = await retryFixture(page, 'upload');
  await drop(page, page.locator('.brand-logo-slots'), [
    { name: 'rights-white.png', mimeType: 'image/png', buffer: png() },
    { name: 'rights-mono.png', mimeType: 'image/png', buffer: png() },
  ]);
  const upload = page.getByRole('dialog', { name: 'ตรวจสอบโลโก้ก่อนอัปโหลด', exact: true });
  await upload.getByRole('button', { name: 'ยืนยันอัปโหลดและผูกโลโก้', exact: true }).click();
  await expect(upload).toContainText('ผูกแล้ว 2 จาก 2 ไฟล์');
  await upload.getByRole('button', { name: 'ปิด', exact: true }).click();
  const reviews: { id: string; body: any }[] = [];
  await page.route(`**${api}/assets/*/review`, async route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const body = route.request().postDataJSON(); reviews.push({ id, body });
    const asset = data.assets.find(asset => asset.id === id)!;
    expect(body.updated_at).toBe(asset.updated_at);
    Object.assign(asset, { rights_status: body.decision, rights_notes: body.rights_notes, review_reason: body.change_reason, effective_from: body.effective_from?.replace('.000Z', '+00:00') ?? null, effective_to: body.effective_to?.replace('.000Z', '+00:00') ?? null, updated_at: '2026-10-02T03:01:00+00:00' });
    Object.assign(data.brand.assets.find(asset => asset.id === id)!, { rights_status: 'approved' });
    if (id === 'synthetic-rights-mono.png') return route.fulfill({ status: 503, json: { error: { message: 'คำตอบสมมติสูญหายหลังบันทึกสิทธิ์สำเร็จ' } } });
    return route.fulfill({ json: { data: asset } });
  });
  await session(page, 'publisher'); await page.reload();
  for (const name of ['rights-white.png', 'rights-mono.png']) await page.getByLabel(`เลือกอนุมัติ ${name}`, { exact: true }).check();
  await page.getByRole('button', { name: 'อนุมัติใช้โลโก้ที่เลือก (2)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'อนุมัติใช้โลโก้', exact: true });
  await dialog.getByLabel('หมายเหตุเพิ่มเติม (ไม่บังคับ)', { exact: true }).fill('ทดสอบคำตอบสูญหายโดยไม่บันทึกสิทธิ์ซ้ำ');
  await dialog.getByText('กำหนดช่วงเวลาใช้งาน (ไม่บังคับ)', { exact: true }).click();
  await dialog.getByLabel('เริ่มใช้สิทธิ์ (เวลาไทย)', { exact: true }).fill('2026-10-02T10:00');
  await dialog.getByRole('button', { name: 'ยืนยันอนุมัติ 2 ไฟล์', exact: true }).click();
  await expect(dialog.getByText('อนุมัติใช้โลโก้แล้ว', { exact: true })).toHaveCount(1);
  await expect(dialog).toContainText('คำตอบสมมติสูญหายหลังบันทึกสิทธิ์สำเร็จ');
  await expect(dialog.getByLabel('หมายเหตุเพิ่มเติม (ไม่บังคับ)', { exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'ลองอนุมัติเฉพาะไฟล์ที่ยังไม่สำเร็จ', exact: true }).click();
  await expect(dialog.getByText('อนุมัติใช้โลโก้แล้ว', { exact: true })).toHaveCount(1);
  await expect(dialog.getByText('พบผลอนุมัติที่ตรงกันแล้ว ไม่บันทึกซ้ำ', { exact: true })).toBeVisible();
  expect(reviews.map(review => review.id)).toEqual(['synthetic-rights-white.png', 'synthetic-rights-mono.png']);
  expect(reviews[0].body).toEqual(reviews[1].body);
  expect(reviews[0].body.effective_from).toBe('2026-10-02T03:00:00.000Z');
});
