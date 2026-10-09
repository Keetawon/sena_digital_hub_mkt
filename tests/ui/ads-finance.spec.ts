import { expect, test, type Page } from '@playwright/test';
import { randomInt } from 'node:crypto';

// Synthetic browser fixtures exercise transport and interaction. SQL/API suites
// separately verify guarded transitions, arithmetic and forced RLS.
const api = '/api/hub/v1/admin/ads';
const ids = { memo: '10000000-0000-4000-8000-000000000001', scope: '10000000-0000-4000-8000-000000000002', line: '10000000-0000-4000-8000-000000000003', revision: '10000000-0000-4000-8000-000000000004', account: '10000000-0000-4000-8000-000000000005', mapping: '10000000-0000-4000-8000-000000000006', commitment: '10000000-0000-4000-8000-000000000007', batch: '10000000-0000-4000-8000-000000000008', statement: '10000000-0000-4000-8000-000000000009', cost: '10000000-0000-4000-8000-000000000010', correction: '10000000-0000-4000-8000-000000000011', alias: '10000000-0000-4000-8000-000000000012' };
type Row = Record<string, any>;
async function fixture(page: Page, role = 'online_staff') {
  const posts: { path: string; body: Row }[] = [];
  const data: Record<string, Row[]> = {
    memos: [{ id: ids.memo, memo_no: 'MO2609001', subject: 'ข้อมูลทดสอบวงเงิน', requesting_bud: 'SID', gross_amount: '1199.99', mirrored_status: 'APPROVED', record_status: 'DRAFT', row_version: 1, evidence_ref: 'SYNTHETIC-MEMO', approval_date: '2026-09-01', identifiers: [{ id: ids.alias, identifier: 'MO2609001/TEST', kind: 'ALIAS', status: 'PROPOSED', row_version: 1 }] }],
    'media-lines': [{ id: ids.line, kind: 'GROUP', scope_id: ids.scope, scope_code: 'C-DEMO-TEST1', month: '2026-09-01', agency: 'KIN', gross_amount: '1199.99', state: 'ACTIVE', current_revision_id: ids.revision, row_version: 1, revisions: [{ id: ids.revision, revision_no: 1, status: 'APPROVED', components: [{ id: '10000000-0000-4000-8000-000000000013', component_kind: 'PHASE', rem_project_id: '00001', formatted_mapping: 'C-DEMO-TEST1', bud: 'SID', gross_amount: '1199.99', memo_id: ids.memo, observed_memo_no: 'MO2609001', budget_items: [] }] }], assignments: [] }],
    'ad-accounts': [{ id: ids.account, platform: 'GOOGLE', account_id: '00000123', label: 'บัญชีทดสอบ', row_version: 1, mappings: [{ id: ids.mapping, status: 'CONFIRMED', scope_id: ids.scope, bud: 'SID', valid_from: '2026-01-01', valid_to: null }] }],
    'channel-accounts': [], commitments: [],
    'card-statements': [{ id: ids.statement, operator_ref: 'TEST-CYCLE-01', issuer: 'ธนาคารทดสอบ', cycle_start: '2026-08-26', cycle_end: '2026-09-25', due_date: '2026-10-15', declared_total: '1199.99', total_meaning: 'NET_CHARGES', row_version: 1, review_status: 'CONFIRMED' }],
    'card-imports': [{ id: ids.batch, source_tab: 'รายการทดสอบ', status: 'APPLIED_DRAFT', row_version: 1, net_total: '1199.99', difference: '0.00', previous_batch_id: null, statement_control: { declared_total: '1199.99' }, rows: [{ id: '10000000-0000-4000-8000-000000000014', source_row_number: 2, charge_date: '2026-09-01', amount: '1199.99', direction: 'DEBIT', row_version: 1, costs: [] }] }],
    'cost-records': [{ id: ids.cost, vendor: 'เครื่องมือทดสอบ', cost_type: 'TOOL', payment_method: 'CORPORATE_CARD', amount: '1199.99', direction: 'DEBIT', charge_date: '2026-09-01', row_version: 1, status: 'CONFIRMED', allocations: [] }],
    corrections: [{ id: ids.correction, observed_code: 'C-DEMO-OLD01', agency: 'KIN', month_from: '2026-09-01', month_to: '2026-09-01', status: 'PROPOSED', row_version: 1, targets: [{ month: '2026-09-01', line_id: ids.line, status: 'PROPOSED' }], evidence_ref: 'SYNTHETIC-CORRECTION' }],
    'ledger-imports': [], 'document-requirements': [{ id: '10000000-0000-4000-8000-000000000015', cost_type: 'TOOL', payment_method: 'CORPORATE_CARD', requirement_codes: ['M', 'S', 'V', 'C'], review_status: 'PROPOSED' }],
  };
  await page.request.post('/api/local-session', { headers: { Origin: 'http://127.0.0.1:3000' }, data: { role } });
  await page.route(`**${api}/**`, async route => {
    const url = new URL(route.request().url()); const path = url.pathname.slice(api.length + 1); const parts = path.split('/');
    if (route.request().method() !== 'GET') {
      const body = route.request().postDataJSON() as Row; posts.push({ path, body });
      let record = data[parts[0]]?.find(item => item.id === parts[1]);
      if (parts.length === 1) { record = { id: `20000000-0000-4000-8000-${String(posts.length).padStart(12, '0')}`, row_version: 1, status: 'DRAFT', ...body }; (data[parts[0]] ??= []).push(record); }
      if (parts[2] === 'confirm-record') Object.assign(record!, { record_status: 'CONFIRMED', row_version: 2 });
      if (parts[0] === 'memo-identifiers' && parts[2] === 'review') Object.assign(data.memos[0].identifiers[0], { status: 'CONFIRMED', row_version: 2 });
      if (parts[0] === 'corrections' && parts[2] === 'review') Object.assign(record!, { status: 'APPROVED', row_version: 2 });
      if (parts[0] === 'corrections' && parts[2] === 'apply') Object.assign(record!.targets[0], { status: 'APPLIED' });
      return route.fulfill({ json: { data: record ?? { id: parts[1] ?? 'success' } } });
    }
    if (path === 'finance-references') return route.fulfill({ json: { data: {
      vocab: [{ vocab_type: 'BUD', code: 'SID', label_th: 'งบทดสอบ', can_use: true }, { vocab_type: 'BUD', code: 'SENA', label_th: 'งบทดสอบสอง', can_use: true }, { vocab_type: 'AGENCY', code: 'KIN', label_th: 'KIN', can_use: true }],
      scopes: [{ scope_id: ids.scope, scope_code: 'C-DEMO-TEST1', label_th: 'โครงการทดสอบ', can_use: true }],
    } } });
    if (path.endsWith('/line-candidates')) return route.fulfill({ json: { data: [{ ...data['media-lines'][0], eligible: true }] } });
    if (path.endsWith('/monthly-lines')) return route.fulfill({ json: { data: [] } });
    const rows = data[parts[0]] ?? [];
    if (parts[1]) return route.fulfill({ json: { data: rows.find(item => item.id === parts[1]) ?? {} } });
    const q = url.searchParams.get('q'); const matching = q ? rows.filter(row => JSON.stringify(row).includes(q)) : rows;
    return route.fulfill({ json: { data: matching, meta: { total: matching.length, limit: 100, offset: 0 } } });
  });
  return { posts, data };
}

test('finance denies agency access before requesting any financial rows', async ({ page }) => {
  await fixture(page, 'agency_kin'); const requests: string[] = [];
  const clientErrors: string[] = [];
  page.on('pageerror', error => clientErrors.push(error.message));
  // Enter through the P1 module first: its financial-context import must not
  // initialize the whole workspace through a circular runtime dependency.
  await page.goto('/ads/registry');
  await expect(page.getByRole('heading', { name: 'ทะเบียนแคมเปญ', exact: true })).toBeVisible();
  await expect(page.getByText('ยังไม่มีรายการลงทะเบียน', { exact: true })).toBeVisible();
  page.on('request', request => { if (request.url().includes(api)) requests.push(request.url()); });
  await page.goto('/ads/finance?view=memos');
  await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงงบและค่าใช้จ่าย' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'งานงบและค่าใช้จ่าย', exact: true })).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(clientErrors).toEqual([]);
});

test('memo confirmation is transcription confirmation and admin explicitly reviews an alias', async ({ page }) => {
  const { posts } = await fixture(page, 'admin');
  await page.goto(`/ads/finance?view=memos&record=${ids.memo}`);
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('heading', { name: 'MO2609001', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'ยืนยันข้อมูลที่บันทึก', exact: true }).click();
  await expect(dialog.getByText('ยืนยันว่าข้อมูลตรงกับ E-memo', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'ยืนยันข้อมูลที่บันทึก', exact: true }).last().click();
  await expect.poll(() => posts.some(item => item.path.endsWith('/confirm-record'))).toBe(true);
  expect(posts.find(item => item.path.endsWith('/confirm-record'))?.body).toEqual({ expected_version: 1 });
  await expect(dialog.getByText('ยืนยันข้อมูลแล้ว', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'ตรวจเลขอ้างอิง MO2609001/TEST', exact: true }).click();
  await dialog.getByLabel('ผลการตรวจเลขอ้างอิง').selectOption('APPROVE');
  await dialog.getByLabel('เหตุผล', { exact: false }).fill('หลักฐานทดสอบยืนยันเลขอ้างอิงเดียวกัน');
  await dialog.getByRole('button', { name: 'ตรวจเลขอ้างอิง MO2609001/TEST', exact: true }).last().click();
  await expect.poll(() => posts.some(item => item.path === `memo-identifiers/${ids.alias}/review`)).toBe(true);
  expect(posts.at(-1)?.body.decision).toBe('APPROVE');
  expect(posts.every(item => !('actor' in item.body) && !('name' in item.body))).toBe(true);
});

test('memo form keeps exact money strings and focuses linked Thai errors', async ({ page }) => {
  const { posts } = await fixture(page);
  await page.goto('/ads/finance?view=memos&record=new');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByRole('alert').getByRole('link').first()).toBeVisible();
  await dialog.getByLabel('เลข Memo หลัก', { exact: false }).fill('MO2610002');
  await dialog.getByLabel('เรื่อง', { exact: false }).fill('รายการสังเคราะห์สำหรับทดสอบ');
  await dialog.getByLabel('BUD ผู้ขอ', { exact: false }).selectOption('SID');
  await dialog.getByLabel('วงเงินรวม', { exact: false }).fill('1199.99');
  await dialog.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body.gross_amount).toBe('1199.99');
  expect(posts[0].body.memo_no).toBe('MO2610002');
  expect(posts[0].body).not.toHaveProperty('media_amount');
});

test('ad account form preserves leading zeros and converts percentages exactly', async ({ page }) => {
  const { posts } = await fixture(page);
  await page.goto('/ads/finance?view=ad-accounts&record=new');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('แพลตฟอร์ม', { exact: false }).selectOption('GOOGLE');
  await dialog.getByLabel('รหัสบัญชีโฆษณา', { exact: false }).fill('0000041200');
  await dialog.getByLabel('ชื่อแสดงบัญชี', { exact: false }).fill('บัญชีสังเคราะห์');
  await dialog.getByLabel('ขอบเขต', { exact: false }).selectOption(ids.scope);
  await dialog.getByLabel('มีผลตั้งแต่', { exact: false }).fill('2026-10-01');
  await dialog.getByLabel('อ้างอิงหลักฐาน', { exact: false }).fill('SYNTHETIC-MAPPING');
  await dialog.getByLabel('เอเจนซี', { exact: false }).selectOption('KIN');
  for (const [index, bud, share] of [[0, 'SID', '25.25'], [1, 'SENA', '74.75']] as const) {
    await dialog.getByRole('button', { name: 'เพิ่มสัดส่วน BUD', exact: true }).click();
    const row = dialog.locator('.finance-repeat').nth(index);
    await row.getByLabel('BUD', { exact: false }).selectOption(bud);
    await row.getByLabel('สัดส่วน (%)', { exact: false }).fill(share);
  }
  await dialog.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body.account_id).toBe('0000041200');
  expect(posts[0].body.mapping.bud_splits).toEqual([{ bud: 'SID', weight_bps: 2525 }, { bud: 'SENA', weight_bps: 7475 }]);
  expect(posts[0].body.mapping).not.toHaveProperty('bud');
});

test('line assignment never selects the single candidate automatically', async ({ page }) => {
  const { posts } = await fixture(page);
  await page.goto(`/ads/finance?view=media-lines&record=${ids.line}`);
  const dialog = page.getByRole('dialog');
  await dialog.getByText('เชื่อมชื่อแคมเปญกับรายการงบนี้', { exact: true }).click();
  await dialog.getByLabel('รหัส SN ที่จะเชื่อม').fill('SN2600001M');
  await dialog.getByLabel('เดือนที่จะเชื่อม').fill('2026-09');
  await dialog.getByRole('button', { name: 'ค้นหารายการงบที่ใช้ได้' }).click();
  await expect(dialog.getByRole('radio')).not.toBeChecked();
  expect(posts).toHaveLength(0);
  await dialog.getByRole('radio').check();
  await dialog.getByRole('button', { name: 'เชื่อมชื่อแคมเปญ', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ path: 'line-assignments', body: { code: 'SN2600001M', month: '2026-09-01', line_id: ids.line, expected_revision_id: ids.revision } });
});

test('correction review and application remain two separate explicit actions', async ({ page }) => {
  const { posts } = await fixture(page, 'admin');
  await page.goto(`/ads/finance?view=corrections&record=${ids.correction}`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'นำการแก้ไขไปใช้ในเดือนที่เลือก', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'ตรวจสอบข้อเสนอแก้ไข', exact: true }).click();
  await dialog.getByLabel('ผลการตรวจข้อเสนอ').selectOption('APPROVE');
  await dialog.getByLabel('เหตุผล', { exact: false }).fill('ตรวจตามหลักฐานสังเคราะห์แล้ว');
  await dialog.getByRole('button', { name: 'ตรวจสอบข้อเสนอแก้ไข', exact: true }).last().click();
  await expect(dialog.getByRole('button', { name: 'นำการแก้ไขไปใช้ในเดือนที่เลือก', exact: true })).toBeVisible();
  expect(posts).toHaveLength(1);
  await dialog.getByRole('button', { name: 'นำการแก้ไขไปใช้ในเดือนที่เลือก', exact: true }).click();
  await dialog.getByRole('checkbox').check();
  await dialog.getByLabel('เหตุผล', { exact: false }).fill('เลือกใช้เฉพาะเดือนตามหลักฐาน');
  await dialog.getByRole('button', { name: 'นำการแก้ไขไปใช้ในเดือนที่เลือก', exact: true }).last().click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].body.months).toEqual(['2026-09-01']);
});

test('card review shows control difference and no PDF or automatic OA-matching control', async ({ page }) => {
  const { posts, data } = await fixture(page);
  data['card-imports'][0].difference = '0.01';
  data['card-imports'][0].status = 'QUARANTINED';
  await page.goto(`/ads/finance?view=card-imports&record=${ids.batch}`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'เทียบยอดตามรายการกับใบแจ้งยอด' })).toBeVisible();
  await expect(dialog.locator('.finance-metric').filter({ hasText: 'ผลต่าง' })).toContainText('0.01 บาท');
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /OCR|จับคู่.*อัตโนมัติ|PDF/ })).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test('annual allocation sends one cash amount with an explicit twelve-month coverage', async ({ page }) => {
  const { posts } = await fixture(page);
  await page.goto(`/ads/finance?view=cost-records&record=${ids.cost}`);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'จัดสรรค่าใช้จ่ายตามเดือน', exact: true }).click();
  await dialog.getByLabel('เดือนเริ่มครอบคลุม', { exact: false }).fill('2026-10');
  await dialog.getByLabel('เดือนสิ้นสุดครอบคลุม', { exact: false }).fill('2027-09');
  await dialog.getByLabel('ขอบเขต', { exact: false }).selectOption(ids.scope);
  await dialog.getByLabel('BUD', { exact: true }).selectOption('SID');
  await dialog.getByLabel('เหตุผล', { exact: false }).fill('ทดสอบบริการรายปี 12 เดือนเต็ม');
  await dialog.getByRole('button', { name: 'จัดสรรค่าใช้จ่ายตามเดือน', exact: true }).last().click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body.coverage_start).toBe('2026-10-01');
  expect(posts[0].body.coverage_end).toBe('2027-09-01');
  expect(posts[0].body).not.toHaveProperty('amount');
  expect(posts[0].body).not.toHaveProperty('name');
});

test('finance detail deep link, Escape focus return and filters work with reduced motion', async ({ page }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/ads/finance?view=memos');
  await page.getByLabel('ค้นหาข้อมูล').fill('MO2609001');
  const row = page.getByRole('button', { name: 'MO2609001', exact: true });
  await row.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`record=${ids.memo}`));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row).toBeFocused();
  await expect(page.getByLabel('ค้นหาข้อมูล')).toHaveValue('MO2609001');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
});

test('channel account requires a real identifier or a clearly unverified steward reference', async ({ page }) => {
  const { posts } = await fixture(page);
  await page.goto('/ads/finance?view=channel-accounts&record=new');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('รหัส LINE OA ที่ตรวจสอบแล้ว', { exact: true }).fill('00000991');
  await dialog.getByRole('textbox', { name: 'ชื่อแสดงบัญชี', exact: true }).fill('LINE OA ทดสอบ');
  await dialog.getByLabel('ขอบเขต', { exact: false }).selectOption(ids.scope);
  await dialog.getByLabel('มีผลตั้งแต่', { exact: false }).fill('2026-10-01');
  await dialog.getByLabel('สิ้นสุดก่อนวันที่', { exact: true }).fill('2027-10-01');
  await expect(dialog.getByText('ไม่รวมวันนี้', { exact: false })).toBeVisible();
  await dialog.getByLabel('อ้างอิงหลักฐาน', { exact: false }).fill('SYNTHETIC-OA');
  await dialog.getByLabel('BUD', { exact: false }).selectOption('SID');
  await dialog.getByLabel('แผนบริการ', { exact: false }).fill('แผนทดสอบ');
  await dialog.getByLabel('ยอดคาดหมายต่อการเรียกเก็บ', { exact: false }).fill('299.00');
  await dialog.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body.account_id).toBe('00000991');
  expect(posts[0].body.mapping.expected_amount).toBe('299.00');
  expect(posts[0].body.mapping.valid_to).toBe('2027-10-01');
});

test('annual recurring plan keeps its explicit cycle and memo cap without issuing an SN', async ({ page }) => {
  const { posts } = await fixture(page);
  await page.goto('/ads/finance?view=commitments&record=new');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('ไม่ใช่แคมเปญ — ไม่ออก SN', { exact: false })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'ผู้ให้บริการ', exact: true }).fill('ผู้ให้บริการสังเคราะห์');
  await dialog.getByLabel('ขอบเขต', { exact: false }).selectOption(ids.scope);
  await dialog.getByLabel('BUD', { exact: true }).selectOption('SID');
  await dialog.getByLabel('บัญชีผู้ให้บริการเครื่องมือ', { exact: true }).fill('0000-TOOL-TEST');
  await dialog.getByLabel('แผนบริการ', { exact: false }).fill('สมาชิก 12 เดือนทดสอบ');
  await dialog.getByLabel('ประเภทค่าใช้จ่าย', { exact: false }).selectOption('TOOL');
  await dialog.getByLabel('วิธีชำระ', { exact: false }).selectOption('CORPORATE_CARD');
  await dialog.getByLabel('จำนวนเงินต่อรอบ', { exact: false }).fill('1199.99');
  await dialog.getByLabel('ความถี่', { exact: false }).selectOption('ANNUAL');
  await dialog.getByLabel('วันที่เริ่ม', { exact: false }).fill('2026-10-01');
  await dialog.getByLabel('วันที่สิ้นสุด', { exact: false }).fill('2027-09-30');
  await dialog.getByLabel('อ้างอิงหลักฐาน', { exact: false }).fill('SYNTHETIC-PLAN');
  await dialog.getByRole('button', { name: 'เพิ่มรอบเรียกเก็บ', exact: true }).click();
  const cycle = dialog.getByRole('group', { name: 'รอบเรียกเก็บ', exact: true });
  await cycle.getByLabel('ลำดับรอบ', { exact: false }).fill('1');
  await cycle.getByLabel('วันคาดหมายเรียกเก็บ', { exact: false }).fill('2026-09-25');
  await cycle.getByLabel('เดือนเริ่มครอบคลุม', { exact: false }).fill('2026-10');
  await cycle.getByLabel('เดือนสิ้นสุดครอบคลุม', { exact: false }).fill('2027-09');
  await cycle.getByLabel('ยอดคาดหมายรอบนี้', { exact: false }).fill('1199.99');
  await dialog.getByRole('button', { name: 'เพิ่มวงเงิน Memo', exact: true }).click();
  const cover = dialog.getByRole('group', { name: 'วงเงิน Memo', exact: true });
  await cover.getByLabel('Memo ที่ครอบคลุม', { exact: false }).selectOption(ids.memo);
  await cover.getByLabel('BUD', { exact: false }).selectOption('SID');
  await cover.getByLabel('เดือนเริ่มครอบคลุม', { exact: false }).fill('2026-10');
  await cover.getByLabel('เดือนสิ้นสุดครอบคลุม', { exact: false }).fill('2027-09');
  await cover.getByLabel('วงเงินสำหรับช่วงนี้', { exact: false }).fill('1199.99');
  await cover.getByLabel('อ้างอิงหลักฐาน', { exact: false }).fill('SYNTHETIC-COVER');
  await dialog.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  const body = posts[0].body;
  expect(posts[0].path).toBe('commitments');
  expect(body.version.vendor_account_ref).toBe('0000-TOOL-TEST');
  expect(body.version.amount_per_cycle).toBe('1199.99');
  expect(body.version.occurrences[0]).toMatchObject({ cycle_no: 1, charge_date: '2026-09-25', coverage_start: '2026-10-01', coverage_end: '2027-09-01' });
  expect(body.version.covers[0].cap_amount).toBe('1199.99');
  expect(body).not.toHaveProperty('name');
  expect(body).not.toHaveProperty('code');
});

test('account mapping closure selects an exclusive date and the mapping version', async ({ page }) => {
  const { posts, data } = await fixture(page);
  data['ad-accounts'][0].row_version = 8;
  data['ad-accounts'][0].mappings[0].row_version = 3;
  await page.goto(`/ads/finance?view=ad-accounts&record=${ids.account}`);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^ปิดช่วงเวลาผังบัญชีที่เริ่ม/ }).click();
  await dialog.getByLabel('ใช้ผังนี้ก่อนวันที่', { exact: false }).fill('2027-01-01');
  await expect(dialog.getByText('ไม่รวมวันที่เลือก ผังเดิมยังคงอยู่เป็นประวัติ', { exact: true })).toBeVisible();
  await dialog.getByLabel('เหตุผล', { exact: false }).fill('เปลี่ยนบัญชีตามข้อมูลสังเคราะห์');
  await dialog.getByRole('button', { name: /^ปิดช่วงเวลาผังบัญชีที่เริ่ม/ }).last().click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ path: `ad-accounts/${ids.account}/versions/close`, body: { mapping_id: ids.mapping, expected_version: 3, effective_to: '2027-01-01', reason: 'เปลี่ยนบัญชีตามข้อมูลสังเคราะห์' } });
});

test('commitment review separates forecast, cover cap and actual cash consumption', async ({ page }) => {
  const { data } = await fixture(page);
  data.commitments.push({ id: ids.commitment, vendor: 'แผนสังเคราะห์รายปี', state: 'ACTIVE', row_version: 1, current_version_id: ids.revision, versions: [{ id: ids.revision, version_no: 1, status: 'CONFIRMED', amount_per_cycle: '1199.99', frequency: 'ANNUAL', covers: [{ memo_id: ids.memo, bud: 'SID', cap_amount: '1500.00', actual_consumption: '1199.99', coverage_start: '2026-10-01', coverage_end: '2027-09-01' }], occurrences: [], monthly_preview: [{ month: '2026-10-01', bud: 'SID', amount: '100.00', measure: 'FORECAST' }, { month: '2027-09-01', bud: 'SID', amount: '99.99', measure: 'FORECAST' }] }] });
  await page.goto(`/ads/finance?view=commitments&record=${ids.commitment}`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'ประมาณการตามเดือน (ไม่ใช่ค่าใช้จ่ายจริง)', exact: true })).toBeVisible();
  await expect(dialog.getByRole('columnheader', { name: 'ใช้จริงจากยอดเรียกเก็บ', exact: true })).toBeVisible();
  await expect(dialog.getByRole('cell', { name: '300.01 บาท', exact: true })).toBeVisible();
  await expect(dialog.getByRole('cell', { name: '99.99 บาท', exact: true })).toBeVisible();
});

test('live synthetic memo, approved line revision and explicit SN assignment round trip', async ({ page }) => {
  test.setTimeout(90_000);
  const headers = { Origin: 'http://127.0.0.1:3000' };
  expect((await page.request.post('/api/local-session', { headers, data: { role: 'online_staff' } })).ok()).toBeTruthy();
  const scopes = await page.request.get(`${api}/scopes?kind=A`);
  expect(scopes.ok()).toBeTruthy();
  const scope = (await scopes.json()).data.find((item: Row) => item.scope_code === 'C-DEMO-TEST1');
  expect(scope, 'The local synthetic registry fixtures must be loaded').toBeTruthy();
  let memoNo = ''; let month = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    const serial = randomInt(1, 1000).toString().padStart(3, '0');
    const yy = randomInt(40, 99).toString(); const mm = randomInt(1, 13).toString().padStart(2, '0');
    const candidateMemo = `MO${yy}${mm}${serial}`; const candidateMonth = `20${yy}-${mm}-01`;
    const lines = await page.request.get(`${api}/media-lines?month=${candidateMonth}&scope_id=${scope.scope_id}&agency=KIN`);
    const memos = await page.request.get(`${api}/memos?q=${candidateMemo}`);
    expect(lines.ok() && memos.ok()).toBeTruthy();
    if (!(await lines.json()).data.length && !(await memos.json()).data.length) { memoNo = candidateMemo; month = candidateMonth; break; }
  }
  expect(month, 'Find an unused synthetic month without altering previous test evidence').not.toBe('');
  const memoResponse = await page.request.post(`${api}/memos`, { headers, data: { memo_no: memoNo, subject: 'ข้อมูลสังเคราะห์สำหรับทดสอบเบราว์เซอร์', requesting_bud: 'SID', gross_amount: '5000.00', mirrored_status: 'APPROVED', approval_date: '2026-09-01', evidence_ref: 'SYNTHETIC-UI-EVIDENCE', approvers: [] } });
  expect(memoResponse.status(), await memoResponse.text()).toBe(201);
  const memo = (await memoResponse.json()).data;
  await page.goto(`/ads/finance?view=memos&record=${memo.id}`);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'ยืนยันข้อมูลที่บันทึก', exact: true }).click();
  const confirmation = page.waitForResponse(response => response.url().endsWith(`/memos/${memo.id}/confirm-record`));
  await dialog.getByRole('button', { name: 'ยืนยันข้อมูลที่บันทึก', exact: true }).last().click();
  expect((await confirmation).ok()).toBeTruthy();
  await expect(dialog.getByRole('definition').filter({ hasText: /^ยืนยันข้อมูลแล้ว$/ })).toBeVisible();
  const lineResponse = await page.request.post(`${api}/media-lines`, { headers, data: { kind: 'GROUP', scope_id: scope.scope_id, month, agency: 'KIN', reason: 'ข้อมูลสังเคราะห์ทดสอบครบวงจร', components: [{ component_kind: 'PHASE', rem_project_id: '00001', formatted_mapping: 'C-DEMO-TEST1', bud: 'SID', gross_amount: '5000.00', memo_id: memo.id }] } });
  expect(lineResponse.status(), await lineResponse.text()).toBe(201);
  const line = (await lineResponse.json()).data;
  await page.goto(`/ads/finance?view=media-lines&record=${line.id}`);
  const confirmName = `ยืนยันรายการตาม Memo ที่อนุมัติแล้ว รุ่น ${line.revisions[0].revision_no}`;
  await dialog.getByRole('button', { name: confirmName, exact: true }).click();
  const approved = page.waitForResponse(response => response.url().endsWith(`/revisions/${line.revisions[0].id}/confirm`));
  await dialog.getByRole('button', { name: confirmName, exact: true }).last().click();
  expect((await approved).ok()).toBeTruthy();
  const registrationResponse = await page.request.post(`${api}/registrations`, { headers, data: { scope_kind: 'A', scope_id: scope.scope_id, objective: 'LEADS', agency: 'KIN' } });
  expect(registrationResponse.status(), await registrationResponse.text()).toBe(201);
  const registration = (await registrationResponse.json()).data;
  await dialog.getByText('เชื่อมชื่อแคมเปญกับรายการงบนี้', { exact: true }).click();
  await dialog.getByLabel('รหัส SN ที่จะเชื่อม').fill(registration.registration.code);
  await dialog.getByLabel('เดือนที่จะเชื่อม').fill(month.slice(0, 7));
  await dialog.getByRole('button', { name: 'ค้นหารายการงบที่ใช้ได้', exact: true }).click();
  const option = dialog.locator(`input[type=radio][value="${line.id}"]`);
  await expect(option).not.toBeChecked(); await option.check();
  const linked = page.waitForResponse(response => response.url().endsWith('/line-assignments') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'เชื่อมชื่อแคมเปญ', exact: true }).click();
  expect((await linked).status()).toBe(201);
  const monthly = (await (await page.request.get(`${api}/registrations/${registration.registration.code}/monthly-lines`)).json()).data.items;
  expect(monthly).toHaveLength(1); expect(monthly[0].line_id).toBe(line.id);
  await page.goto(`/ads/registry?registration=${registration.registration.code}`);
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'รายการงบและ Memo รายเดือน', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText(`Memo: ${memoNo}`, { exact: true })).toBeVisible();
  await expect(page.getByText('รออนุมัติรูปแบบชื่อ', { exact: true })).toBeVisible();
});
