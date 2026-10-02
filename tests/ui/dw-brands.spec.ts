import { expect, test } from '@playwright/test';

const stamp = '2026-10-02T07:11:04+00:00';
const source = { brand_name_rem: 'แบรนด์สมมติจาก DW', brand_name_en_rem: 'Synthetic DW brand',
  source_updated_at: null, source_snapshot_at: stamp, source_fingerprint: 'synthetic',
  source_record: {}, intake_manifest_sha256: 'a'.repeat(64), public_brand_id: null };
const rows = [
  { ...source, rem_brand_id: '000003', is_deleted: false, deletion_status: 'active', residential_project_count: 18, exception_codes: ['DUPLICATE_THAI_NAME'] },
  { ...source, rem_brand_id: 'TEST-DELETED', is_deleted: true, deletion_status: 'deleted', residential_project_count: 2, exception_codes: [] },
  { ...source, rem_brand_id: 'TEST-UNKNOWN', brand_name_rem: null, brand_name_en_rem: null, is_deleted: null, deletion_status: 'unknown', residential_project_count: 1, exception_codes: ['BLANK_THAI_NAME', 'BLANK_ENGLISH_NAME', 'UNKNOWN_DELETION_STATUS'] },
  { ...source, rem_brand_id: 'TEST-UNUSED', is_deleted: false, deletion_status: 'active', residential_project_count: 0, exception_codes: [] },
];

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`DW source brands show usage, deletion and exception evidence at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.context().addCookies([{ name: 'sena_local_persona', value: 'admin', url: 'http://127.0.0.1:3000' }]);
    await page.route('**/api/hub/v1/admin/**', route => {
      expect(route.request().method()).toBe('GET');
      return route.fulfill({ json: { data: route.request().url().endsWith('/sources/brands') ? rows : [] } });
    });
    await page.goto('/?view=brands');
    await page.getByRole('button', { name: 'ดูแบรนด์จากต้นทาง', exact: true }).click();
    const picker = page.locator('#brand-source-picker');
    const usage = picker.getByLabel('การใช้แบรนด์ในโครงการที่อยู่อาศัย');
    await expect(usage).toHaveValue('residential');
    await expect(picker.locator('li')).toHaveCount(3);
    const active = picker.locator('li').filter({ hasText: 'รหัส REM 000003' });
    await expect(active).toContainText('Synthetic DW brand');
    await expect(active).toContainText('18 โครงการ');
    await expect(active).toContainText('ชื่อภาษาไทยซ้ำ · ตรวจตามรหัส');
    await expect(active.getByRole('button', { name: 'นำแบรนด์นี้เข้าระบบ' })).toBeEnabled();
    const deleted = picker.locator('li').filter({ hasText: 'รหัส REM TEST-DELETED' });
    await expect(deleted).toContainText('ถูกลบแล้ว');
    await expect(deleted.getByRole('button')).toBeDisabled();
    const unknown = picker.locator('li').filter({ hasText: 'รหัส REM TEST-UNKNOWN' });
    await expect(unknown).toContainText('ยังไม่ทราบ · สร้างแบรนด์ไม่ได้');
    await expect(unknown.locator('.status-badge')).toHaveCount(3);
    await expect(unknown.getByRole('button')).toBeDisabled();
    await usage.selectOption('all');
    await expect(picker.locator('li')).toHaveCount(4);
    await picker.getByLabel('ค้นหาแบรนด์ต้นทาง').fill('Synthetic DW brand');
    await expect(picker.locator('li')).toHaveCount(3);
    await picker.getByLabel('ค้นหาแบรนด์ต้นทาง').fill('missing');
    await expect(picker).toContainText('ไม่พบแบรนด์ที่ตรงกับตัวกรอง');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const role of ['editor', 'viewer']) {
  test(`${role} cannot create DW source brands`, async ({ page }) => {
    await page.context().addCookies([{ name: 'sena_local_persona', value: role, url: 'http://127.0.0.1:3000' }]);
    await page.route('**/api/hub/v1/admin/**', route => route.fulfill({ json: { data: route.request().url().endsWith('/sources/brands') ? rows : [] } }));
    await page.goto('/?view=brands');
    await page.getByRole('button', { name: 'ดูแบรนด์จากต้นทาง', exact: true }).click();
    const picker = page.locator('#brand-source-picker');
    await expect(picker.locator('li')).toHaveCount(3);
    await expect(picker.getByRole('button', { name: 'นำแบรนด์นี้เข้าระบบ' })).toHaveCount(0);
    if (role === 'editor') {
      await expect(picker.locator('li').filter({ hasText: 'TEST-UNKNOWN' }).getByRole('button')).toBeDisabled();
    }
  });
}
