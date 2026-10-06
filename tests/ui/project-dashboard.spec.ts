import { expect, test, type Page } from '@playwright/test';

const gap = { field: 'latitude', message: 'พิกัดอยู่นอกประเทศไทย ตรวจละติจูดและลองจิจูด' };
const row = (id: string, extra: Record<string, unknown> = {}) => ({ public_project_id: id, rem_project_id: id,
  name: `โครงการ ${id}`, brand_name: 'แบรนด์จำลอง', new_from_rem: false, filling: true, awaiting_publisher: false,
  published: false, needs_attention: false, has_unpublished_changes: true, withdrawn: false, attention: [],
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
    const data = path.endsWith('/projects/progress') ? { rows, counts: { all: 3, new_from_rem: 1, filling: 2, awaiting_publisher: 0, published: 1, needs_attention: 1 } } :
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

test('summary counts filter rows, show named gaps without percentages and separate optional amenities', async ({ page }) => {
  const writes = await setup(page);
  const dashboard = page.locator('.project-dashboard');
  await expect(dashboard.locator('tbody tr')).toHaveCount(3);
  await expect(dashboard).toContainText('ยืนยัน 2/3');
  await expect(dashboard).toContainText('ใช้เวลานำเข้าสำเนาครั้งแรก');
  await expect(dashboard).toContainText('ไม่ทราบวันนำเข้า');
  await expect(dashboard).not.toContainText('%');
  await expect(dashboard).toContainText('0/6 รายการ');
  await dashboard.getByRole('button', { name: 'ต้องดูแล 1', exact: true }).click();
  await expect(dashboard.locator('tbody tr')).toHaveCount(1);
  await expect(dashboard.locator('tbody')).toContainText('โครงการ B');
  await dashboard.getByRole('button', { name: 'ใหม่จาก REM 1', exact: true }).click();
  await dashboard.getByRole('button', { name: 'เริ่มกรอก', exact: true }).click();
  await expect(page.getByLabel('ค้นหาชื่อหรือรหัสโครงการต้นทาง')).toHaveValue('C');
  await expect(page.locator('#source-picker')).toContainText('โครงการ C');
  expect(writes).toEqual([]);
});

test('missing-field link opens and focuses the actual editor field', async ({ page }) => {
  await setup(page);
  await page.locator('.project-dashboard tbody tr').first().getByRole('link', { name: 'ยังขาด 1 รายการ', exact: true }).click();
  await expect(page).toHaveURL(/project=A&field=latitude/);
  await expect(page.getByRole('tab', { name: /ข้อมูลหลัก/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#latitude')).toBeFocused();
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
  await expect(dashboard.getByRole('button', { name: `ทั้งหมด ${data.counts.all}`, exact: true })).toBeVisible();
  await expect(dashboard.getByRole('button', { name: 'เริ่มกรอก', exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/hub/v1/admin/projects/progress?unexpected=1')).status()).toBe(404);
});

for (const width of [1440, 844]) {
  test(`project identity stays pinned and long Thai gaps remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const models = Array.from({ length: 63 }, (_, index) => [
      { field: `models.M${index}.match_status`, message: 'ยืนยันการจับคู่แบบกับ REM' },
      { field: `models.M${index}.specs`, message: 'กรอกชื่อไทย ห้องนอน ห้องน้ำ และพื้นที่ใช้สอย' },
    ]).flat();
    const writes = await setup(page, 'publisher', { extraRows: 7, firstRow: {
      name: 'โครงการจำลองสำหรับทดสอบข้อความภาษาไทยที่ยาว', confirmed_models: 0, total_models: 63,
      gaps: { core: [gap], media: [], models, brand: [{ field: 'brand', message: 'เลือกแบรนด์ที่ตรงกับ REM และเผยแพร่แบรนด์พร้อมโลโก้ที่มีสิทธิ์ใช้งาน' }] },
    } });
    const scroll = page.getByRole('region', { name: 'ตารางความคืบหน้าโครงการ', exact: true });
    await expect(scroll.locator('tbody tr')).toHaveCount(10);
    await scroll.scrollIntoViewIfNeeded();
    const cells = scroll.locator('tbody tr').first().locator('td');
    const project = cells.nth(0), brand = cells.nth(1), core = cells.nth(2), modelCell = cells.nth(4);
    const projectBefore = (await project.boundingBox())!, brandBefore = (await brand.boundingBox())!;
    expect((await core.boundingBox())!.width).toBeGreaterThanOrEqual(260);
    expect((await modelCell.boundingBox())!.width).toBeGreaterThanOrEqual(290);
    expect((await scroll.locator('tbody tr').first().boundingBox())!.height).toBeLessThan(360);
    await expect(modelCell.locator('.project-gap-count')).toHaveText(['(63)', '(63)']);
    await scroll.evaluate(element => { element.scrollLeft = 950; });
    await expect.poll(async () => Math.abs((await project.boundingBox())!.x - projectBefore.x)).toBeLessThan(2);
    if (width >= 1000) {
      expect(Math.abs((await brand.boundingBox())!.x - brandBefore.x)).toBeLessThan(2);
      expect(await brand.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    } else expect((await brand.boundingBox())!.x).toBeLessThan(brandBefore.x - 500);
    const firstHeader = scroll.locator('th').first(), headerBefore = (await firstHeader.boundingBox())!;
    await scroll.evaluate(element => { element.scrollTop = 220; });
    await expect.poll(async () => Math.abs((await firstHeader.boundingBox())!.y - headerBefore.y)).toBeLessThan(2);
    expect(await firstHeader.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return document.elementFromPoint(rect.x + 15, rect.y + 15)?.closest('th') === element;
    })).toBeTruthy();
    await scroll.evaluate(element => { element.scrollTop = 0; });
    await core.getByRole('link', { name: 'ยังขาด 1 รายการ' }).focus();
    const focused = (await core.getByRole('link', { name: 'ยังขาด 1 รายการ' }).boundingBox())!;
    expect(focused.x).toBeGreaterThanOrEqual(projectBefore.x + (width >= 1000 ? 440 : 260));
    await modelCell.locator('summary').click();
    await expect(modelCell.locator('details[open] a')).toHaveCount(126);
    expect(await modelCell.locator('details > ul').evaluate(element => element.scrollHeight > element.clientHeight)).toBeTruthy();
    await modelCell.locator('summary').click();
    await scroll.evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0; });
    await page.screenshot({ path: `artifacts/project-table-pinned-${width}.png` });
    expect(writes).toEqual([]);
  });
}
