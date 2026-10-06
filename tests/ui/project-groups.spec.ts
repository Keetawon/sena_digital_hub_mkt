import { expect, test, type Page } from '@playwright/test';

const stamp = '2026-10-05T00:00:00Z';
const base = '/api/hub/v1/admin/';
const gap = { field: 'latitude', message: 'ระบุพิกัดโครงการ' };
const source = { status_raw: '2', status_label: 'พร้อมอยู่', default_scope: true, is_deleted: false, flags: [], exceptions: [] };
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  public_project_id: id, rem_project_id: id, name: `โครงการ ${id}`, brand_name: 'แบรนด์จำลอง', rem_brand_id: '00025',
  rem_project_group_id: 'G', marketing_project_group_id: 'MARKETING-G', group_status: 'rem_reference',
  new_from_rem: false, filling: true, awaiting_publisher: true, published: false, needs_attention: false,
  has_unpublished_changes: true, withdrawn: false, attention: [], gaps: { core: [gap], media: [], models: [], brand: [] },
  confirmed_models: 0, total_models: 1, amenities: null, waiting_on: ['editor', 'publisher'], updated_at: stamp,
  first_seen_at: stamp, age_days: 0, age_basis: 'first_import', source_review: source, ...extra,
});

async function fixture(page: Page, role = 'publisher') {
  const rows = [...Array.from({ length: 12 }, (_, index) => item(`P${String(index + 1).padStart(2, '0')}`)),
    item('SPACE', { rem_project_group_id: 'G ' }), item('OTHER-BRAND', { rem_brand_id: '25' }),
    item('CONFLICT', { group_status: 'conflict' }), item('MISSING', { group_status: 'missing', rem_project_group_id: null }),
    item('CLOSED', { source_review: { ...source, status_raw: '3', default_scope: false } }),
    item('NEW', { public_project_id: null, new_from_rem: true, filling: false })];
  const asset = { id: 'synthetic-image', original_filename: 'synthetic.png', mime_type: 'image/png', public_url: '/demo-assets/brand-logo.svg', rights_status: 'pending', rights_notes: null, updated_at: stamp, effective_from: null, effective_to: null };
  const project = (id: string) => ({ public_project_id: id, public_name: { th: `โครงการ ${id}` }, slug: id, updated_at: stamp,
    published_version_id: null, publication_available: false, readiness: { ready: false, percent: 0, missing: [gap] },
    source: { rem_project_id: id, project_name_rem: id }, models: [],
    assets: [{ ...asset, binding_id: 'bound', asset_role: 'hero', alt_text: { th: 'ภาพจำลอง' }, display_order: 0 }] });
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.context().addCookies([{ name: 'sena_local_persona', value: role, url: 'http://127.0.0.1:3000' }]);
  await page.route('**/api/hub/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(base, '');
    if (route.request().method() !== 'GET') {
      writes.push({ path, body: route.request().postDataJSON() });
      if (path === 'assets/synthetic-image/review') { asset.rights_status = 'approved'; return route.fulfill({ json: { data: asset } }); }
      return route.fulfill({ status: 403, json: { error: { message: 'ชุดทดสอบไม่อนุญาต' } } });
    }
    const data = path === 'projects/progress' ? { rows, counts: {} } : path === 'brands/completeness' ? {
      rows: [{ public_brand_id: 'BRAND', rem_brand_id: '00025', name_th: 'แบรนด์จำลอง', name_en: '', residential_project_count: 17,
        status: 'missing_data', reason_codes: [], readiness: { ready: false, percent: 0, missing: [] }, checks: {}, optional_logos: [], updated_at: stamp, updated_by: null }], counts: { total: 1 },
    } : path === 'assets/synthetic-image' ? asset : path === 'assets' ? [asset] : path === 'sources/projects' ? [{ rem_project_id: 'NEW', project_name_rem: 'โครงการ NEW', model_count: 0, public_project_id: null, source_record: null }] :
      /^projects\/[^/]+$/.test(path) ? project(path.split('/')[1]) : [];
    await route.fulfill({ json: { data } });
  });
  return { rows, writes };
}

test('brand expansion preserves exact IDs, shared groups, conflicts and scope through navigation', async ({ page }) => {
  const { writes } = await fixture(page);
  await page.goto('/?view=brands&bq=แบรนด์');
  await page.getByRole('button', { name: 'แสดงกลุ่มโครงการ', exact: true }).click();
  const groups = page.getByRole('region', { name: 'กลุ่มโครงการของแบรนด์' });
  await expect(groups).toContainText('กลุ่มนี้มีสมาชิกต่างแบรนด์');
  await expect(groups.getByRole('link', { name: 'เปิดกลุ่ม', exact: false })).toHaveCount(4);
  await expect(groups).toContainText('กลุ่มที่ต้องตรวจสอบ');
  await expect(groups).toContainText('ยังไม่มีกลุ่มยืนยัน');
  await expect(groups).toContainText('รหัสมีช่องว่าง:');
  await page.screenshot({ path: 'artifacts/brand-group-expansion.png', fullPage: true });
  const open = groups.locator('a').filter({ hasText: 'เปิดกลุ่ม' });
  const exactGroup = open.filter({ has: page.locator('span', { hasText: /^ G$/ }) });
  await exactGroup.click();
  expect(new URL(page.url()).searchParams.get('rem_brand')).toBe('00025');
  expect(new URL(page.url()).searchParams.get('group')).toBe('G');
  await expect(page.locator('.project-dashboard tbody tr')).toHaveCount(10);
  await expect(page.locator('.project-dashboard')).not.toContainText('OTHER-BRAND');
  await page.locator('#projects-top-page').selectOption('2');
  await expect(page.locator('.project-dashboard tbody tr')).toHaveCount(3);
  await page.screenshot({ path: 'artifacts/group-project-list.png', fullPage: true });
  await page.getByRole('link', { name: 'โครงการ P11', exact: true }).click();
  await expect(page.getByRole('tab', { name: /ข้อมูลหลัก/ })).toBeVisible();
  await expect(page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)')).toBeDisabled();
  await page.getByRole('link', { name: 'กลับรายการก่อนหน้า', exact: true }).click();
  await expect(page.locator('#projects-top-page')).toHaveValue('2');
  await page.getByRole('link', { name: 'กลับรายการก่อนหน้า', exact: true }).click();
  await expect(page.getByLabel('ค้นหาชื่อหรือรหัสแบรนด์')).toHaveValue('แบรนด์');
  await expect(page.getByRole('button', { name: 'ซ่อนกลุ่มโครงการ' })).toHaveAttribute('aria-expanded', 'true');
  expect(writes).toEqual([]);
});

test('out-of-scope group selection keeps the toggle and source action stays read-only for viewers', async ({ page }) => {
  const { writes } = await fixture(page, 'viewer');
  await page.goto('/?view=brands&bopen=00025&bother=1');
  await page.locator('.project-group-list a[href*="group=G&"]').first().click();
  await expect(page.getByRole('checkbox', { name: 'แสดงโครงการปิด ถูกลบ และไม่ทราบสถานะ' })).toBeChecked();
  await page.getByLabel('ค้นหาโครงการ แบรนด์ หรือรหัส REM').fill('NEW');
  await page.getByRole('button', { name: 'ดูต้นทาง', exact: true }).click();
  await expect(page.getByLabel('ค้นหาชื่อหรือรหัสโครงการต้นทาง')).toHaveValue('NEW');
  await expect(page.getByRole('button', { name: 'เลือกโครงการนี้' })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('publisher approves an attached project file while content is incomplete, without publishing', async ({ page }) => {
  const { writes } = await fixture(page);
  await page.goto('/?project=P01');
  await page.getByRole('tab', { name: /รูปภาพ/ }).click();
  await page.getByRole('button', { name: 'อนุมัติใช้ไฟล์', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'อนุมัติใช้ไฟล์', exact: true });
  await expect(dialog.getByLabel('หมายเหตุเพิ่มเติม (ไม่บังคับ)')).toBeVisible();
  await dialog.getByRole('button', { name: 'ยืนยันอนุมัติ 1 ไฟล์' }).click();
  await expect(dialog.getByText('อนุมัติใช้ไฟล์แล้ว', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ path: 'assets/synthetic-image/review', body: { decision: 'approved', updated_at: stamp, change_reason: 'อนุมัติใช้ไฟล์โดยผู้เผยแพร่' } });
  await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  await page.getByRole('tab', { name: /เผยแพร่และประวัติ/ }).click();
  await expect(page.getByRole('button', { name: 'เผยแพร่ข้อมูล', exact: true })).toBeDisabled();
});

test('project table has a sticky header, pagination and no mobile document overflow', async ({ page }) => {
  await fixture(page, 'viewer');
  await page.goto('/');
  await expect(page.locator('.project-dashboard tbody tr')).toHaveCount(10);
  const header = page.locator('.project-progress-table th').first();
  expect(await header.evaluate(element => getComputedStyle(element).position)).toBe('sticky');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#projects-top-page')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'artifacts/group-project-mobile.png', fullPage: true });
  await page.goto('/?project=P01&return_to=https%3A%2F%2Fexample.com');
  await expect(page.locator('a.back-link')).toHaveAttribute('href', '/');
});
