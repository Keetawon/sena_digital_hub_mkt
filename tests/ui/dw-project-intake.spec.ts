import { expect, test, type Page } from '@playwright/test';

const metadata = (code: string | null, extra = {}) => ({status_raw: code, status_label: code === '2' ? 'พร้อมอยู่' : code === '3' ? 'ปิดโครงการ' : 'ไม่ทราบสถานะ',
  is_deleted: false, default_scope: code === '2', flags: [], exceptions: [], brand_binding_allowed: true, gold_prefill_allowed: true, first_import_only: true, ...extra});
const reviews = [metadata('2', {brand_binding_allowed: false, exceptions: [{code: 'PROJECT_BRAND_MISSING', keys: {ProjectID: 'P0'}}]}),
  metadata('2', {gold_prefill_allowed: false, exceptions: [{code: 'GOLD_PROJECT_IDENTITY_OR_GROUP_CONFLICT', keys: {project_id: 'P1'}}, {code: 'GOLD_MODEL_ID_MISSING_REM', keys: {project_id: 'P1', ModelID: '001 '}}]}),
  metadata('3', {flags: ['changed']}), metadata('4')];

async function setup(page: Page, role = 'viewer') {
  const writes: string[] = [];
  const rows = reviews.map((source_review, i) => ({public_project_id: i === 2 ? 'prj_closed' : null, rem_project_id: `P${i}`, name: `โครงการสมมติ ${i}`,
    brand_name: null, source_review, new_from_rem: i !== 2, filling: false, awaiting_publisher: false, published: i === 2, needs_attention: i === 2,
    attention: i === 2 ? [{field: 'source', message: 'โครงการต้นทาง REM ปิดโครงการ (3)'}] : [], gaps: {core: [], media: [], models: [], brand: []},
    confirmed_models: 0, total_models: 1, waiting_on: [], first_seen_at: '2026-10-05T00:00:00Z', age_days: 0, age_basis: 'first_import', amenities: null}));
  await page.context().addCookies([{name: 'sena_local_persona', value: role, url: 'http://127.0.0.1:3000'}]);
  await page.route('**/api/hub/**', async route => {
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/projects/progress') ? {rows, counts: {all: 2, new_from_rem: 2, filling: 0, awaiting_publisher: 0, published: 0, needs_attention: 1}} :
      path.endsWith('/sources/projects') ? rows.map(row => ({...row, project_name_rem: row.name, model_count: 1, source_record: null, intake_manifest_sha256: 'a'.repeat(64)})) : [];
    await route.fulfill({json: {data}});
  });
  await page.goto('/');
  return writes;
}

test('default scope, raw status counts, exceptions and live closed attention are read-only', async ({page}) => {
  const writes = await setup(page);
  const dashboard = page.locator('.project-dashboard');
  await expect(dashboard.locator('tbody tr')).toHaveCount(2);
  await expect(dashboard).toContainText('พร้อมอยู่ (2)');
  await expect(dashboard.getByRole('columnheader', {name: 'นำเข้าครั้งแรก', exact: true})).toBeVisible();
  await expect(dashboard).toContainText('ต้นทางไม่มีแบรนด์');
  await expect(dashboard).toContainText('"001 "');
  await dashboard.getByRole('button', {name: 'ต้องดูแล 1', exact: true}).click();
  await expect(dashboard.locator('tbody tr')).toHaveCount(1);
  await expect(dashboard).toContainText('ปิดโครงการ (3)');
  await expect(dashboard).toContainText('ต้นทางเปลี่ยน');
  await dashboard.getByRole('button', {name: 'ทั้งหมด 2', exact: true}).click();
  await dashboard.getByLabel('สถานะโครงการ REM').selectOption('4');
  await expect(dashboard.getByLabel('แสดงโครงการปิด ถูกลบ และไม่ทราบสถานะ')).toBeChecked();
  await expect(dashboard.locator('tbody tr')).toHaveCount(1);
  await expect(dashboard).toContainText('ไม่ทราบสถานะ (4)');
  expect(writes).toEqual([]);
});

test('source picker disables missing-brand selection and explains Gold conflict without repairing IDs', async ({page}) => {
  const writes = await setup(page, 'editor');
  await page.locator('.project-dashboard tbody tr').first().getByRole('button', {name: 'เริ่มกรอก'}).click();
  const picker = page.locator('#source-picker');
  await expect(picker.locator('#source-brand-P0')).toBeDisabled();
  await expect(picker).toContainText('ต้นทางไม่มีแบรนด์ จึงยังผูกแบรนด์ไม่ได้');
  await page.getByLabel('ค้นหาชื่อหรือรหัสโครงการต้นทาง').fill('P1');
  await expect(picker).toContainText('ปิดการเติมจาก Gold');
  await expect(picker).toContainText('ไม่จับคู่อัตโนมัติ');
  await expect(picker).toContainText('"001 "');
  expect(writes).toEqual([]);
});
