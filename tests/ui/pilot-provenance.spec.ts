import { expect, test, type Page } from '@playwright/test';

const snapshotTime = '2026-09-17T15:45:42.124034+00:00';
const snapshotLabel = 'สำเนา REM ที่ตรวจสอบหลักฐานแล้ว';
const sampleLabel = 'ข้อมูลจำลองสำหรับเครื่องพัฒนา';
const evidence = { source_record: null, intake_manifest_sha256: 'a'.repeat(64), source_updated_at: null, source_snapshot_at: snapshotTime };
const source = { ...evidence, rem_project_id: 'PROVENANCE-TEST', project_name_rem: 'โครงการทดสอบป้ายสำเนา', model_count: 1, public_project_id: null, rem_brand_id: '000003', rem_company_id: null, brand_name_rem: null, company_name_rem: null };
const brand = { ...evidence, rem_brand_id: '000003', brand_name_rem: 'แบรนด์ทดสอบป้ายสำเนา', brand_name_en_rem: null, is_deleted: false, residential_project_count: 1, public_brand_id: null };

async function mockStaffReads(page: Page, responses: Record<string, unknown>) {
  responses['brands/completeness'] = { rows: [], counts: { total: 0, missing_data: 0, ready: 0, published: 0, published_changes: 0, not_created: 0 } };
  await page.context().addCookies([{ name: 'sena_local_persona', value: 'editor', url: 'http://127.0.0.1:3000' }]);
  await page.route('**/api/hub/v1/admin/**', async route => {
    expect(route.request().method()).toBe('GET');
    const path = new URL(route.request().url()).pathname.replace('/api/hub/v1/admin/', '');
    await route.fulfill({ json: { data: responses[path] ?? [] } });
  });
}

test('source pickers distinguish reviewed snapshots from samples and do not invent source time', async ({ page }) => {
  await mockStaffReads(page, {
    'sources/projects': [source, { ...source, rem_project_id: 'KUBON', project_name_rem: 'โครงการทดสอบป้ายจำลอง', intake_manifest_sha256: null }],
    'sources/brands': [brand, { ...brand, rem_brand_id: '36', brand_name_rem: 'แบรนด์ทดสอบป้ายจำลอง', intake_manifest_sha256: null }],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'เลือกโครงการจากต้นทาง', exact: true }).click();
  const realProject = page.locator('#source-picker li').filter({ hasText: source.project_name_rem });
  const sampleProject = page.locator('#source-picker li').filter({ hasText: 'โครงการทดสอบป้ายจำลอง' });
  await expect(realProject).toContainText(snapshotLabel);
  await expect(realProject).not.toContainText(sampleLabel);
  await expect(realProject).toContainText('ยังยืนยันเวลา/เขตเวลาต้นทางไม่ได้');
  await expect(realProject).toContainText('เวลาสกัดสำเนาต้นทาง');
  await expect(sampleProject).toContainText(sampleLabel);
  await page.goto('/?view=brands');
  await page.getByRole('button', { name: 'ดูแบรนด์จากต้นทาง', exact: true }).click();
  const realBrand = page.locator('#brand-source-picker li').filter({ hasText: brand.brand_name_rem });
  const sampleBrand = page.locator('#brand-source-picker li').filter({ hasText: 'แบรนด์ทดสอบป้ายจำลอง' });
  await expect(realBrand).toContainText(snapshotLabel);
  await expect(realBrand).toContainText('ยังยืนยันเวลา/เขตเวลาต้นทางไม่ได้');
  await expect(realBrand).toContainText('เวลาสกัดสำเนาต้นทาง');
  await expect(sampleBrand).toContainText(sampleLabel);
});

test('model evidence keeps raw area separate from blank approved specifications', async ({ page }) => {
  const model = { ...evidence, id: 'test-model', public_model_id: 'model-test', rem_model_id: 'A1-1', model_name_rem: 'A1-1', public_name: {}, bedrooms: null, bathrooms: null, usable_area_sqm: null, parking_spaces: null, match_status: 'SUGGESTED', verified_by: null, verified_at: null, source_record: { model_type_id: 'CON4', model_area: '27.00' } };
  await mockStaffReads(page, {
    'projects/project-test': { public_project_id: 'project-test', public_name: {}, slug: '', updated_at: snapshotTime, published_version_id: null, publication_available: false, readiness: { ready: false, percent: 0, missing: [] }, source, models: [model], assets: [] },
  });
  await page.goto('/?project=project-test');
  await page.locator('#source > summary').click();
  await expect(page.locator('#source')).toContainText(snapshotLabel);
  await page.getByRole('tab', { name: /แบบที่อยู่อาศัย/ }).click();
  await page.getByText('รหัสแบบและข้อมูลอ้างอิง REM', { exact: true }).click();
  await page.getByLabel('เลือกแบบที่ต้องการจัดการ', { exact: true }).selectOption(model.public_model_id);
  await page.getByRole('button', { name: 'แก้ไขรายละเอียดแบบ', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('CON4');
  await expect(dialog).toContainText('27.00');
  await expect(dialog).toContainText('ยังไม่ยืนยันหน่วยและความหมาย');
  await expect(dialog.getByLabel('พื้นที่ใช้สอย (ตร.ม.)', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('จำนวนห้องนอน', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('จำนวนห้องน้ำ', { exact: true })).toHaveValue('');
});
