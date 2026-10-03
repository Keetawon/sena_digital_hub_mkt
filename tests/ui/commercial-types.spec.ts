import { expect, test, type Page } from '@playwright/test';
import type { CommercialType, CommercialAsset } from '../../apps/admin/components/commercial-types';

const time = '2026-09-20T08:00:00Z';
const nextTime = '2026-09-20T08:01:00Z';
const source = (suffix: string, code: string) => ({ id: `source-${suffix}`, public_model_id: `mdl_${suffix.repeat(32)}`, rem_model_id: code, model_name_rem: code, public_name: { th: code }, bedrooms: null, bathrooms: null, usable_area_sqm: null, parking_spaces: null, match_status: 'SUGGESTED', source_record: null, source_updated_at: null, source_snapshot_at: time, intake_manifest_sha256: null });
const models = [source('a', 'A1-1'), source('b', 'A1-2'), source('c', 'LEGACY-01')];
const type = (name = 'Garden', id = 'ctyp_11111111111111111111111111111111'): CommercialType => ({
  id, public_commercial_type_id: id, public_name: { th: name, en: '' }, description: { th: '' }, product_form: 'house', area_min_sqm: 120, area_max_sqm: 140, bedrooms: 3, bathrooms: 2, kitchens: null, storeys: 2, parking_spaces: null, land_area_sqm: null,
  source_model_ids: [models[2].public_model_id], source_links: [{ ...models[2], link_kind: 'reference', classification_status: 'unverified', shared_reference: true }], source_notes: 'Synthetic acquisition document', status: 'draft', assets: [],
  readiness: { collection: { present: 6, expected: 10 }, missing: [{ field: 'kitchens', message: 'ยังไม่ระบุจำนวนห้องครัว' }], review_issues: [{ field: 'classification', message: 'รอตรวจขอบเขตยูนิต' }], publication_ready: false },
});
const asset = (id: string, name: string): CommercialAsset => ({ id, binding_id: `binding-${id}`, original_filename: name, mime_type: 'application/pdf', public_url: null, checksum: 'a'.repeat(64), file_size: 100, width: null, height: null, rights_status: 'pending', rights_notes: null, updated_at: time, effective_from: null, effective_to: null, reviewed_by: null, reviewed_at: null, review_reason: null, storage_path: null, asset_role: 'floor_plan', alt_text: { th: name }, title: name, floor_label: '', plan_revision: '', applicability_model_ids: [], display_order: 0 });

async function openFixture(page: Page, initial: CommercialType[] = [], role = 'editor') {
  const project = {
    public_project_id: 'commercial-test', public_name: { th: 'โครงการจำลองแบบขาย' }, address: { th: 'ที่อยู่จำลอง' }, slug: 'commercial-test', latitude: null, longitude: null, updated_at: time, published_version_id: null, publication_available: false,
    readiness: { ready: false, percent: 0, missing: [] }, gold_source: null, source: { rem_project_id: 'TEST-COMMERCIAL', project_name_rem: 'โครงการจำลอง', source_record: null, source_snapshot_at: time, source_updated_at: null, intake_manifest_sha256: null },
    models, assets: [], commercial_types: initial,
  };
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const library: CommercialAsset[] = [];
  let conflict = false;
  await page.context().addCookies([{ name: 'sena_local_persona', value: role, url: 'http://127.0.0.1:3000' }]);
  await page.route('**/api/hub/v1/admin/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/hub/v1/admin/', '');
    if (path === 'assets' && request.method() === 'POST') {
      const uploaded = asset(`asset-${library.length}`, decodeURIComponent(request.headers()['x-filename']));
      library.push(uploaded); await route.fulfill({ json: { data: uploaded } }); return;
    }
    if (path === 'assets') { await route.fulfill({ json: { data: library } }); return; }
    if (path.startsWith('projects/commercial-test/commercial-types') && request.method() !== 'GET') {
      const body = request.postDataJSON(); writes.push({ path, method: request.method(), body });
      if (conflict) { await route.fulfill({ status: 409, json: { error: { message: 'ข้อมูลโครงการเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด' } } }); return; }
      if (path.endsWith('/assets')) {
        const owner = project.commercial_types.find(item => path.includes(item.public_commercial_type_id))!;
        owner.assets.push({ ...library.find(item => item.id === body.asset_id)!, ...body });
      } else if (request.method() === 'POST') {
        for (const [index, row] of body.types.entries()) {
          project.commercial_types.push({ ...type(row.public_name.th, `ctyp_${String(index + 2).repeat(32)}`), ...row, source_links: models.filter(model => row.source_model_ids.includes(model.public_model_id)).map(model => ({ ...model, link_kind: 'reference', classification_status: 'unverified', shared_reference: true })) });
        }
      } else {
        Object.assign(project.commercial_types.find(item => path.endsWith(item.public_commercial_type_id))!, body);
      }
      project.updated_at = nextTime;
      await route.fulfill({ json: { data: project } }); return;
    }
    if (path === 'projects/commercial-test' || path === 'projects/commercial-test/commercial-types') await route.fulfill({ json: { data: project } });
    else await route.fulfill({ json: { data: [] } });
  });
  await page.goto('/?project=commercial-test');
  await page.getByRole('tab', { name: /แบบบ้าน/ }).click();
  await expect(page.getByRole('heading', { name: /แบบขายและรหัสแบบต้นทาง/ })).toBeVisible();
  return { project, writes, library, setConflict: (value: boolean) => { conflict = value; } };
}

test('one atomic set supports multiple REM references, shared codes and an unmatched acquired type', async ({ page }) => {
  const { project, writes } = await openFixture(page);
  const panel = page.locator('#commercial-types');
  await panel.getByRole('button', { name: 'เพิ่มแบบขายเป็นชุด', exact: true }).click();
  const first = panel.getByRole('region', { name: 'แบบขายรายการ 1', exact: true });
  const second = panel.getByRole('region', { name: 'แบบขายรายการ 2', exact: true });
  await first.getByLabel('ชื่อแบบขาย (ไทย)').fill('Type A1');
  await first.getByRole('checkbox', { name: 'A1-1', exact: true }).check();
  await first.getByRole('checkbox', { name: 'A1-2', exact: true }).check();
  await first.getByRole('checkbox', { name: 'LEGACY-01', exact: true }).check();
  await second.getByLabel('ชื่อแบบขาย (ไทย)').fill('Family');
  await second.getByRole('checkbox', { name: 'LEGACY-01', exact: true }).check();
  await panel.getByRole('button', { name: 'เพิ่มอีกแถว', exact: true }).click();
  await panel.getByRole('region', { name: 'แบบขายรายการ 3', exact: true }).getByLabel('ชื่อแบบขาย (ไทย)').fill('Corner');
  await panel.getByRole('button', { name: 'บันทึกแบบขาย', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('เพิ่มแบบขายฉบับร่าง 3 รายการแล้ว');
  expect(writes).toHaveLength(1);
  expect((writes[0].body.types as { source_model_ids: string[] }[]).map(item => item.source_model_ids)).toEqual([[models[0].public_model_id, models[1].public_model_id, models[2].public_model_id], [models[2].public_model_id], []]);
  expect(project.commercial_types).toHaveLength(3);
  expect(project.published_version_id).toBeNull();
  await expect(panel).toContainText('รอแยกยูนิต');
  await expect(panel).toContainText('ยังไม่ส่งออกใน API ที่เผยแพร่');
});

test('inline edits survive tabs and a stale revision preserves the draft for review', async ({ page }) => {
  const { project, writes, setConflict } = await openFixture(page, [type()]);
  const panel = page.locator('#commercial-types');
  await panel.getByRole('button', { name: 'แก้ไข Garden', exact: true }).click();
  await panel.getByLabel('ชื่อแบบขาย (ไทย)').fill('Garden revised');
  await panel.getByLabel('ห้องครัว', { exact: true }).fill('1');
  await page.getByRole('tab', { name: /ข้อมูลหลัก/ }).click();
  await expect(page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: /แบบบ้าน/ }).click();
  await expect(panel.getByLabel('ชื่อแบบขาย (ไทย)')).toHaveValue('Garden revised');
  setConflict(true);
  await panel.getByRole('button', { name: 'บันทึกแบบขาย', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('ข้อมูลโครงการเปลี่ยนแล้ว');
  await expect(panel.getByLabel('ชื่อแบบขาย (ไทย)')).toHaveValue('Garden revised');
  expect(writes[0].body.updated_at).toBe(time);
  expect(project.commercial_types[0].public_name.th).toBe('Garden');
  await panel.getByRole('button', { name: 'ยกเลิกการแก้ไข', exact: true }).click();
  setConflict(false);
  await panel.getByRole('button', { name: 'แก้ไข Garden', exact: true }).click();
  await panel.getByLabel('ห้องครัว', { exact: true }).fill('1');
  await panel.getByRole('button', { name: 'บันทึกแบบขาย', exact: true }).click();
  expect(project.commercial_types[0].kitchens).toBe(1);
});

test('multiple uploads are separate library files and plans retain house floor and REM applicability', async ({ page }) => {
  const { project, writes, library } = await openFixture(page, [type()]);
  const panel = page.locator('#commercial-types');
  await panel.getByRole('button', { name: 'ดูรายละเอียด Garden', exact: true }).click();
  await panel.getByLabel('อัปโหลดภาพหรือแปลนหลายไฟล์').setInputFiles([
    { name: 'floor-one.pdf', mimeType: 'application/pdf', buffer: Buffer.from('synthetic fixture one') },
    { name: 'floor-two.pdf', mimeType: 'application/pdf', buffer: Buffer.from('synthetic fixture two') },
  ]);
  await panel.getByRole('button', { name: 'อัปโหลด 2 ไฟล์เข้าคลัง', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('อัปโหลดเข้าคลังสำเร็จ 2 ไฟล์');
  expect(library).toHaveLength(2);
  expect(project.commercial_types[0].assets).toHaveLength(0);
  await panel.getByRole('button', { name: 'ใช้ไฟล์ floor-one.pdf', exact: true }).click();
  await panel.getByLabel('ชื่อแปลนหรือภาพ').fill('Garden ชั้น 1');
  await panel.getByLabel('ชั้นของบ้านที่แปลนแสดง').fill('ชั้น 1');
  await panel.getByLabel('เลขฉบับหรือวันที่ของแปลน').fill('R2');
  await panel.getByLabel('คำอธิบายไฟล์ (ไทย)').fill('แปลนบ้าน Garden ชั้นล่าง');
  await panel.getByRole('checkbox', { name: 'LEGACY-01', exact: true }).check();
  await panel.getByRole('button', { name: 'ผูกไฟล์กับแบบขาย', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('ผูกไฟล์กับแบบขายฉบับร่างแล้ว');
  expect(writes[0].path).toContain(`/commercial-types/${type().public_commercial_type_id}/assets`);
  expect(writes[0].body).toMatchObject({ updated_at: time, floor_label: 'ชั้น 1', plan_revision: 'R2', applicability_model_ids: [models[2].public_model_id] });
  expect(project.commercial_types[0].assets).toHaveLength(1);
  await panel.getByRole('button', { name: 'ใช้ไฟล์ floor-two.pdf', exact: true }).click();
  await panel.getByLabel('ชื่อแปลนหรือภาพ').fill('Garden ชั้น 2');
  await panel.getByLabel('ชั้นของบ้านที่แปลนแสดง').fill('ชั้น 2');
  await panel.getByLabel('คำอธิบายไฟล์ (ไทย)').fill('แปลนบ้าน Garden ชั้นบน');
  await panel.getByRole('button', { name: 'ผูกไฟล์กับแบบขาย', exact: true }).click();
  expect(writes[1].body.updated_at).toBe(nextTime);
  expect(project.commercial_types[0].assets).toHaveLength(2);
  await expect(panel).toContainText('ยังไม่ระบุขอบเขตรหัสแบบ');
});

test('viewer can inspect missing data using keyboard on mobile without edit controls or overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFixture(page, [type()], 'viewer');
  const panel = page.locator('#commercial-types');
  await expect(panel.getByRole('button', { name: 'เพิ่มแบบขาย', exact: true })).toHaveCount(0);
  const toggle = panel.getByRole('button', { name: 'ดูรายละเอียด Garden', exact: true });
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(panel.getByRole('button', { name: 'ย่อรายละเอียด Garden', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toContainText('ยังไม่ระบุจำนวนห้องครัว');
  await expect(panel).toContainText('รอตรวจขอบเขตยูนิต');
  await expect(panel.getByLabel('อัปโหลดภาพหรือแปลนหลายไฟล์')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
