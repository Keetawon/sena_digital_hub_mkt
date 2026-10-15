import { progressFixture } from './progress-fixture';
import { expect, test, type Page } from '@playwright/test';

test('public website source remark is visible in the approval/source column', async ({ page }) => {
  await setup(page, 'editor', { firstRow: { website_sources: [{ url: 'https://www.sena.co.th/project/synthetic', fetched_at: '2026-10-15T00:00:00Z' }] } });
  const table = page.getByRole('region', { name: 'ตารางความคืบหน้าโครงการ', exact: true });
  await expect(table.getByRole('columnheader', { name: 'อนุมัติโดย / แหล่งข้อมูล', exact: true })).toBeVisible();
  await expect(table.getByText('ดึงจากเว็บไซต์สาธารณะ SENA', { exact: true })).toBeVisible();
  await expect(table).toContainText('ยังไม่ใช่การอนุมัติโดยบุคคล');
  await page.setViewportSize({ width: 400, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

const gap = { field: 'latitude', message: 'พิกัดอยู่นอกประเทศไทย ตรวจละติจูดและลองจิจูด' };
const row = (id: string, extra: Record<string, unknown> = {}) => ({ public_project_id: id, rem_project_id: id,
  name: `โครงการ ${id}`, brand_name: 'แบรนด์จำลอง', new_from_rem: false, filling: true, awaiting_publisher: false,
  published: false, needs_attention: false, has_unpublished_changes: true, withdrawn: false, attention: [],
  checklist: { ready: false, required: [{ ...gap, group: 'core', passed: false }], recommended: [{field: 'facilities.pool', message: 'ระบุสถานะสระว่ายน้ำ', group: 'extra', passed: true}], passed: 1, total: 2, percent: 50 }, knowledge: { reviewed: 3, staged: 10 },
  gaps: { core: [gap], media: [], models: [], brand: [] }, confirmed_models: 2, total_models: 3,
  amenities: { collected: 0, total: 6 }, waiting_on: ['editor'], updated_at: '2026-10-03T00:00:00Z',
  age_days: 10, first_seen_at: '2026-09-23T00:00:00Z', age_basis: 'mirror_import', ...extra });

async function setup(page: Page, role = 'editor', options: { firstRow?: Record<string, unknown>; extraRows?: number } = {}) {
  const rows = [row('A', options.firstRow), row('B', { published: true, needs_attention: true, attention: [{ field: 'brand', message: 'แบรนด์ที่เผยแพร่ถูกถอนการเผยแพร่แล้ว' }] }),
    row('C', { public_project_id: null, filling: false, new_from_rem: true, age_days: null, age_basis: 'unknown' }),
    ...Array.from({ length: options.extraRows ?? 0 }, (_, index) => row(`EXTRA-${index}`))];
  const writes: string[] = [];
  await page.context().addCookies([{ name: 'sena_local_persona', value: role, url: 'http://127.0.0.1:3000' }]);
  await page.route('**/api/hub/**', async route => {
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    const path = new URL(route.request().url()).pathname;
    if(path==='/api/hub/v1/me')return route.continue();
    const data = path.endsWith('/projects/progress') ? progressFixture(route.request().url(), rows) :
      path.endsWith('/sources/projects') ? [{ rem_project_id: 'C', project_name_rem: 'โครงการ C', model_count: 3, public_project_id: null, source_record: null, intake_manifest_sha256: null }] :
      path.endsWith('/projects/A') ? { public_project_id: 'A', public_name: { th: 'โครงการ A' }, slug: '', latitude: 0, longitude: 0,
        updated_at: '2026-10-03T00:00:00Z', published_version_id: null, publication_available: false,
        readiness: { ready: false, percent: 0, missing: [gap] }, source: { rem_project_id: 'A', project_name_rem: 'โครงการ A' }, models: [], assets: [] } : [];
    await route.fulfill({ json: { data } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ความคืบหน้าโครงการ' })).toBeVisible();
  return writes;
}

test('publishability, completeness and keyboard disclosure are separate and filters stay read-only', async ({ page }) => {
  const writes = await setup(page);
  const dashboard = page.locator('.project-dashboard');
  await expect(dashboard.locator('.project-summary-row')).toHaveCount(3);
  const first = dashboard.locator('.project-summary-row').first();
  await expect(first).toContainText('ขาดข้อบังคับ 1');
  await expect(first).toContainText('ความครบถ้วน 50%');
  await expect(first.getByRole('progressbar')).toHaveAttribute('value', '1');
  await expect(first.getByRole('link', { name: 'ตรวจแล้ว 3/10' })).toHaveAttribute('href', '/knowledge?project=A');
  const expand = first.getByRole('button', { name: /รายการตรวจ/ });
  await expand.focus(); await page.keyboard.press('Enter');
  await expect(expand).toHaveAttribute('aria-expanded', 'true');
  const detail = dashboard.locator('.project-detail-row');
  await expect(detail.getByRole('region', { name: 'ต้องมีก่อนเผยแพร่' })).toContainText(gap.message);
  await expect(detail.getByRole('region', { name: 'ควรเติมภายหลัง' })).toContainText('ระบุสถานะสระว่ายน้ำ');
  await expand.press('Space'); await expect(detail).toHaveCount(0);
  await dashboard.getByRole('button', { name: 'ต้องดูแล 1', exact: true }).click();
  await expect(dashboard.locator('.project-summary-row')).toHaveCount(1);
  await dashboard.getByRole('button', { name: 'ใหม่จาก REM 1', exact: true }).click();
  await dashboard.getByRole('button', { name: 'เริ่มกรอก', exact: true }).click();
  await expect(page.getByLabel('ค้นหาชื่อหรือรหัสโครงการต้นทาง')).toHaveValue('C');
  expect(writes).toEqual([]);
});

test('required field links focus the editor and recommended items cannot change the badge', async ({ page }) => {
  await setup(page);
  await page.locator('.project-summary-row').first().getByRole('button', { name: /รายการตรวจ/ }).click();
  await page.locator('.project-detail-row').getByRole('link', { name: `ไปแก้ ${gap.message}` }).click();
  await expect(page).toHaveURL(/project=A&field=latitude/);
  await expect(page.locator('#latitude')).toBeFocused();
});

test('ready project remains publishable below 100 percent and the bar turns green only when complete', async ({ page }) => {
  await setup(page, 'publisher', { firstRow: { filling: false, checklist: { ready: true, required: [{field:'slug',message:'slug',group:'core',passed:true}], recommended:[{field:'knowledge',message:'ความรู้',group:'extra',passed:false}], passed:1,total:2,percent:50 } } });
  const first=page.locator('.project-summary-row').first();
  await expect(first).toContainText('เผยแพร่ได้ ✓');
  await expect(first.locator('.completeness-bar')).toHaveAttribute('data-complete','false');
});

test('viewer can filter and inspect source rows on mobile without creating data', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  const writes = await setup(page, 'viewer');
  const dashboard = page.locator('.project-dashboard');
  await dashboard.getByRole('button', { name: 'ใหม่จาก REM 1', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: 'เริ่มกรอก', exact: true })).toHaveCount(0);
  await dashboard.getByRole('button', { name: 'ดูต้นทาง', exact: true }).click();
  await expect(page.locator('#source-picker')).toContainText('บัญชีนี้ดูต้นทางได้เท่านั้น');
  await expect(page.getByRole('button', { name: 'เลือกโครงการนี้', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(writes).toEqual([]);
  await page.screenshot({ path: 'artifacts/project-dashboard-mobile.png', fullPage: true });
});

test('actual local viewer dashboard matches the authenticated progress response', async ({ page }) => {
  await page.context().addCookies([{ name: 'sena_local_persona', value: 'viewer', url: 'http://127.0.0.1:3000' }]);
  const response = await page.request.get('/api/hub/v1/admin/projects/progress');
  expect(response.status()).toBe(200);
  const data = (await response.json()).data;
  await page.goto('/');
  const dashboard = page.locator('.project-dashboard');
  await expect(dashboard.locator('tbody tr')).toHaveCount(Math.min(10, data.rows.filter((row: { source_review?: { default_scope: boolean } }) => row.source_review?.default_scope !== false).length));
  await expect(dashboard.getByRole('button', { name: `ทั้งหมด ${(await (await page.request.get('/api/hub/v1/admin/projects/progress?view=counts')).json()).data.counts.all}`, exact: true })).toBeVisible();
  await expect(dashboard.getByRole('button', { name: 'เริ่มกรอก', exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/hub/v1/admin/projects/progress?unexpected=1')).status()).toBe(404);
});

for (const width of [1440, 844]) {
  test(`compact dashboard keeps identity and header pinned at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const writes = await setup(page, 'publisher', { extraRows: 7 });
    const scroll = page.getByRole('region', { name: 'ตารางความคืบหน้าโครงการ', exact: true });
    await expect(scroll.locator('.project-summary-row')).toHaveCount(10);
    await scroll.scrollIntoViewIfNeeded();
    const identity = scroll.locator('.project-summary-row').first().locator('td').first();
    const before = (await identity.boundingBox())!;
    expect((await scroll.locator('.project-summary-row').first().boundingBox())!.height).toBeLessThan(280);
    await scroll.evaluate(element => { element.scrollLeft = 800; });
    await expect.poll(async () => Math.abs((await identity.boundingBox())!.x - before.x)).toBeLessThan(2);
    const header = scroll.locator('th').first(), top = (await header.boundingBox())!.y;
    await scroll.evaluate(element => { element.scrollTop = 220; });
    await expect.poll(async () => Math.abs((await header.boundingBox())!.y - top)).toBeLessThan(2);
    await scroll.evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0; });
    await page.screenshot({ path: `artifacts/project-table-pinned-${width}.png` });
    expect(writes).toEqual([]);
  });
}
