import { expect, test, type Page } from '@playwright/test';

const api = '/api/hub/v1/admin/ads';
const origin = 'http://127.0.0.1:3000';
const line = '30000000-0000-4000-8000-000000000001';
const periodLine = '30000000-0000-4000-8000-000000000002';
const snapshot = '30000000-0000-4000-8000-000000000003';
const findingKey = 'a'.repeat(64);
const documentKey = 'b'.repeat(64);
type Row = Record<string, any>;

async function session(page: Page, role = 'online_staff') {
  expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role } })).ok()).toBeTruthy();
}

async function fixture(page: Page) {
  await session(page);
  const posts: { path: string; body: Row }[] = [];
  const meta = { status: 'AVAILABLE', snapshot_id: snapshot, snapshot_at: '2026-10-01T04:00:00Z', received_at: '2026-10-01T05:00:00Z', environment: 'test', synthetic_only: true, source_watermarks: { hub_source_snapshot_at: '2020-01-01T00:00:00Z', platform_source_snapshot_at: '2356-05-01T00:00:00Z', rem_source_snapshot_at: null } };
  const dimension = { line_key: line, hub_line_id: line, scope_code: 'C-SYNTH-UI', agency: 'KIN', is_applicable: true, revision_no: 1, budget_basis: 'MONTH', approved_gross: '1199.99', components: [{ bud: 'SID' }] };
  const base = { line_key: line, month: '2356-04-01', agency: 'KIN', approved_month_gross: '1199.99', approved_month_media: null, budget_basis: 'MONTH', platform_media_spend: '30.00', attributed_leads: null, media_cpl: null, media_budget_used_pct: null, comparison_reason: 'TYPED_BUDGET_INCOMPLETE', quality_codes: ['LEAD_COVERAGE_UNKNOWN'], platform_data_through: '2356-04-11T17:00:00Z', leads_data_through: null, platform_source_snapshot_at: '2356-05-01T00:00:00Z', rem_source_snapshot_at: null, platform_spend_basis: 'SYNTHETIC_THB', card_cash_by_type: [{ cost_type: 'MEDIA', payment_method: 'CORPORATE_CARD', amount: '30.00' }, { cost_type: 'CHANNEL', payment_method: 'CORPORATE_CARD', amount: '99.00' }], card_monthly_by_type: [{ cost_type: 'TOOL', payment_method: 'CORPORATE_CARD', amount: '10.00' }], dimension };
  const actuals: Row[] = [base, { ...base, line_key: periodLine, budget_basis: 'PERIOD', approved_month_gross: null, dimension: { ...dimension, line_key: periodLine, hub_line_id: periodLine, scope_code: 'CORP-UI-PERIOD', budget_basis: 'PERIOD', approved_gross: '12000.00', period_start_month: '2356-01-01', period_end_month: '2356-12-01' } }];
  const campaign = { platform: 'GOOGLE', account_id: '00000123', campaign_id: '00000456', month: '2356-04-01', match_method: 'HUB_NATIVE_ID', registration_code: 'SN2600123Q', observed_code: 'SN2600999X', observed_name: 'OBSERVED-SYNTHETIC', observed_at: '2356-04-10T05:00:00Z', binding_name_id: '30000000-0000-4000-8000-000000000009', assignment_id: '30000000-0000-4000-8000-000000000010', effective_at: null, recorded_at: '2026-10-01T04:00:00Z', source_record_refs: [{ source_key: 'GOOGLE', relation: 'synthetic_campaign_daily', record_key: 'SYNTHETIC-UI-1' }] };
  const document: Row = { key: documentKey, line_id: line, month: '2356-04-01', scope_code: 'C-SYNTH-UI', agency: 'KIN', subject_kind: 'COMPONENT', subject_id: '30000000-0000-4000-8000-000000000011', cost_type: 'AGENCY_FEE', payment_method: 'AGENCY_PO_INVOICE', requirement_code: 'P', requirement_version: '1', matrix_status: 'PROPOSED', status: 'MISSING', reference: null, partial_reference: 'FEE-PO-ONLY-00001', reason: 'เลข PO ค่าบริการเพียงอย่างเดียวไม่ใช่ใบแจ้งหนี้', source_version: 'c'.repeat(64), source_link: `/ads/finance?view=media-lines&record=${line}`, owner: null, due_at: null, is_overdue: null, template_version: '1', message_th: 'ขอติดตามเอกสาร สำหรับรายการ C-SYNTH-UI เดือนเมษายน กรุณาส่งให้ผู้รับผิดชอบตรวจสอบใน Hub', follow_ups: [] };
  const finding: Row = { finding_key: findingKey, control_code: 'C6', rule_code: 'BOUND_IDENTITY_CONFLICT', month: '2356-04-01', agency: 'KIN', line_key: line, registration_code: 'SN2600123Q', campaign_id: '00000456', condition_present: true, evaluation_status: 'EVALUATED', first_observed_at: null, last_observed_at: null, cleared_at: null, match_method: 'HUB_NATIVE_ID', observed: { observed_code: 'SN2600999X', observed_name: 'OBSERVED-SYNTHETIC', source_snapshot_at: '2356-05-01T00:00:00Z' }, expected: { registration_code: 'SN2600123Q' }, workflow: { state: 'OPEN', owner_id: null, owner_role: null, note: '', version: 0 } };
  const history: Row[] = [];
  await page.route(`**${api}/**`, async route => {
    const url = new URL(route.request().url()); const path = url.pathname.slice(api.length + 1);
    if (!/^(actuals|document-tracking|findings)(\/|$)/.test(path)) return route.continue();
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); posts.push({ path, body });
      if (path.endsWith('/follow-ups')) {
        const followUp = { id: 'copy-1', action: 'COPIED', copied_at: '2026-10-01T06:00:00Z', actor_id: 'synthetic-actor', message_th: document.message_th, source_version: document.source_version, template_version: '1' };
        document.follow_ups.push(followUp); return route.fulfill({ json: { data: { follow_up: followUp } } });
      }
      finding.workflow = { ...finding.workflow, state: body.state, note: body.note, version: finding.workflow.version + 1, ...(body.owner_action === 'SELF' ? { owner_id: 'synthetic-actor', owner_role: 'online_staff' } : {}) };
      history.push({ id: `history-${history.length}`, state: body.state, action: 'OPERATOR', note: body.note, actor_id: 'synthetic-actor', recorded_at: '2026-10-01T06:00:00Z' });
      return route.fulfill({ json: { data: { finding, history, meta } } });
    }
    if (path.startsWith('actuals/')) {
      const selected = actuals.find(row => row.line_key === path.split('/')[1])!;
      return route.fulfill({ json: { data: { line: selected.dimension, revisions: [selected.dimension], months: [selected], campaigns: [campaign], meta } } });
    }
    if (path.startsWith('document-tracking/')) return route.fulfill({ json: { data: { item: document, meta } } });
    if (path.startsWith('findings/')) return route.fulfill({ json: { data: { finding, history, meta } } });
    let items = path === 'actuals' ? actuals : path === 'document-tracking' ? [document] : [finding];
    if (url.searchParams.get('agency')) items = items.filter(row => row.agency === url.searchParams.get('agency'));
    if (url.searchParams.get('month')) items = items.filter(row => row.month === url.searchParams.get('month'));
    if (url.searchParams.get('overdue') === 'true' || url.searchParams.get('overdue') === 'false') items = [];
    if (url.searchParams.get('status')) items = items.filter(row => row.status === url.searchParams.get('status'));
    if (url.searchParams.get('control_code')) items = items.filter(row => row.control_code === url.searchParams.get('control_code'));
    if (url.searchParams.get('condition') === 'UNAVAILABLE') items = items.filter(row => row.condition_present == null);
    return route.fulfill({ json: { data: { items, total: items.length, meta } } });
  });
  return { posts, document, finding };
}

test('P3 denies financial screens and API to agencies and residential-only roles', async ({ page }) => {
  for (const role of ['agency_kin', 'agency_combay', 'editor', 'publisher', 'viewer']) {
    await session(page, role);
    const requests: string[] = [];
    const capture = (request: { url: () => string }) => { if (/\/api\/hub\/v1\/admin\/ads\/(actuals|document-tracking|findings)(?:\?|\/|$)/.test(request.url())) requests.push(request.url()); };
    page.on('request', capture);
    for (const route of ['actuals', 'documents', 'exceptions']) {
      await page.goto(`/ads/${route}`);
      await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงผลการตลาดและเอกสาร', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'งานงบและค่าใช้จ่าย' })).toHaveCount(0);
    }
    expect(requests).toEqual([]); page.off('request', capture);
    for (const path of ['actuals', 'document-tracking', 'findings']) expect((await page.request.get(`${api}/${path}`)).status()).toBe(403);
  }
});

test('loaded DW TEST generation reads through the real proxy, API and actuals detail UI', async ({ page }) => {
  await session(page);
  // No routes are mocked and no database records are changed in this scenario.
  const response = await page.request.get(`${api}/actuals?limit=100`);
  expect(response.status()).toBe(200);
  const actuals = (await response.json()).data;
  expect(actuals.meta.status).toBe('AVAILABLE');
  expect(actuals.meta.environment).toBe('test');
  expect(actuals.meta.synthetic_only).toBe(true);
  expect(actuals.items.length).toBeGreaterThan(0);
  const first = actuals.items[0];
  expect(first.line_key).toMatch(/^[a-f0-9-]{36}$/);
  const findingsResponse = await page.request.get(`${api}/findings?limit=100`);
  expect(findingsResponse.status()).toBe(200);
  const findings = (await findingsResponse.json()).data;
  expect(findings.meta.snapshot_id).toBe(actuals.meta.snapshot_id);
  expect(findings.total).toBeGreaterThan(0);
  expect(findings.items.every((row: Row) => ['C5', 'C6'].includes(row.control_code))).toBe(true);
  const detailsResponse = page.waitForResponse(result => result.url().includes(`${api}/actuals/${first.line_key}`));
  await page.goto(`/ads/actuals?line=${first.line_key}&month=${first.month}`);
  expect((await detailsResponse).status()).toBe(200);
  const dialog = page.getByRole('dialog');
  const title = first.dimension.scope_code ?? first.dimension.program_ref ?? first.line_key;
  await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeFocused();
  await expect(dialog.getByRole('heading', { name: 'แคมเปญและวิธีเชื่อมจากคลังข้อมูล', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('actuals preserve unknown metrics and stale synthetic source times, with deep links and focus return', async ({ page }) => {
  await fixture(page); await page.goto('/ads/actuals');
  await expect(page.getByRole('heading', { name: 'ผลใช้จ่ายรายเดือน', exact: true })).toBeVisible();
  const snapshotStatus = page.getByLabel('สถานะข้อมูลจากคลังข้อมูล');
  await expect(snapshotStatus).toContainText('ข้อมูลตัวอย่าง · TEST');
  await expect(snapshotStatus).toContainText('2356');
  await expect(snapshotStatus).toContainText('ข้อมูลยังไม่อัปเดต');
  await page.getByLabel('รายการที่มี BUD นี้').fill('SID');
  await expect(page).toHaveURL(/bud=SID/);
  await expect(page.getByText('ยอดใช้จ่ายของรายการไม่ได้แยกตาม BUD', { exact: false })).toBeVisible();
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'C-SYNTH-UI', exact: true }) });
  await expect(row).toContainText('1,199.99 บาท');
  await expect(row).toContainText('ยังไม่มีข้อมูลที่ครบถ้วน');
  await expect(row).toContainText('ใช้ไป —');
  const opener = row.getByRole('button', { name: 'C-SYNTH-UI', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'C-SYNTH-UI', exact: true })).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`line=${line}`));
  await expect(dialog.getByRole('heading', { name: 'ยอดเรียกเก็บผ่านบัตร', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'ค่าใช้จ่ายบัตรตามเดือน', exact: true })).toBeVisible();
  await expect(dialog.getByText('LINE OA (ยังไม่แยกบัญชี)', { exact: false })).toBeVisible();
  await dialog.getByText('GOOGLE · 00000456 · รหัสแพลตฟอร์มที่ผูกใน Hub', { exact: true }).click();
  await expect(dialog).toContainText('00000123');
  await expect(dialog).toContainText('SN2600999X');
  await expect(dialog).toContainText('SN2600123Q');
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(opener).toBeFocused();
  await expect(page).toHaveURL(/bud=SID/);
  await page.goto(`/ads/actuals?line=${line}&month=2356-04-01`);
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'C-SYNTH-UI', exact: true })).toBeFocused();
});

test('program period budget appears once and does not invent a monthly budget', async ({ page }) => {
  await fixture(page); await page.goto(`/ads/actuals?line=${periodLine}&month=2356-04-01`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'งบทั้งช่วงเวลา', exact: true })).toBeVisible();
  await expect(dialog.getByText('12,000.00 บาท', { exact: false })).toHaveCount(1);
  await expect(dialog).toContainText('งบรายเดือนยังไม่กำหนด');
  await expect(dialog.locator('dl').filter({ has: page.getByText('งบรวมรายเดือนที่ใช้ได้', { exact: true }) })).toContainText('—');
});

test('document tracker filters unknown due dates and partial PO never becomes an invoice verification', async ({ page }) => {
  await fixture(page); await page.goto('/ads/documents');
  await expect(page.getByText('รูปแบบเอกสารรอยืนยันจากฝ่ายการเงิน', { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: 'สถานะเอกสาร', exact: true }).selectOption('MISSING');
  await page.getByRole('combobox', { name: 'วันครบกำหนด', exact: true }).selectOption('unknown');
  await expect(page.locator('.operations-table')).toContainText('ยังไม่กำหนดวันครบกำหนด');
  await expect(page.locator('.operations-table')).toContainText('FEE-PO-ONLY-00001');
  await page.getByRole('button', { name: 'C-SYNTH-UI', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ยังไม่มีเอกสารอ้างอิง');
  await expect(dialog).toContainText('เลข PO ค่าบริการเพียงอย่างเดียวไม่ใช่ใบแจ้งหนี้');
  await expect(dialog.getByRole('button', { name: 'ตรวจสอบแล้ว', exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('ข้อความที่จะคัดลอก')).toHaveAttribute('readonly', '');
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'วันครบกำหนด', exact: true }).selectOption('true');
  await expect(page.getByText('ไม่พบรายการตามตัวกรอง', { exact: true })).toBeVisible();
});

test('successful follow-up copy records COPIED after clipboard success with server-owned message', async ({ page }) => {
  const { posts, document } = await fixture(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { (window as Window & { copiedFollowUp?: string }).copiedFollowUp = value; } } }));
  await page.goto(`/ads/documents?requirement=${documentKey}&month=2356-04-01`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('ข้อความที่จะคัดลอก')).toHaveValue(document.message_th);
  await dialog.getByRole('button', { name: 'คัดลอกข้อความติดตาม', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(await page.evaluate(() => (window as Window & { copiedFollowUp?: string }).copiedFollowUp)).toBe(document.message_th);
  expect(posts[0].body).toEqual({ expected_source_version: 'c'.repeat(64), template_version: '1', expected_snapshot_id: snapshot, month: '2356-04-01' });
  await expect(dialog).toContainText('คัดลอกแล้วและบันทึกประวัติการคัดลอก ไม่มีการส่งข้อความ');
  await expect(dialog.getByRole('heading', { name: 'ประวัติการติดตาม', exact: true }).locator('..')).toContainText('คัดลอกข้อความ');
  expect(document.follow_ups[0].action).toBe('COPIED');
});

test('clipboard failure offers selectable text and makes no follow-up log request', async ({ page }) => {
  const { posts } = await fixture(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } } }));
  await page.goto(`/ads/documents?requirement=${documentKey}&month=2356-04-01`);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'คัดลอกข้อความติดตาม', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('ระบบยังไม่บันทึกว่าคัดลอกแล้ว');
  await dialog.getByLabel('ข้อความที่จะคัดลอก').focus();
  expect(await dialog.getByLabel('ข้อความที่จะคัดลอก').evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart)).toBeGreaterThan(0);
  expect(posts).toEqual([]);
});

test('exception workflow acknowledges and resolves without clearing immutable DW source findings', async ({ page }) => {
  const { posts, finding } = await fixture(page);
  await page.goto('/ads/exceptions');
  await page.getByLabel('ประเภทการตรวจ').selectOption('C6');
  await expect(page).toHaveURL(/control_code=C6/);
  await page.getByRole('button', { name: 'C6 · SN2600123Q', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ยังพบเงื่อนไข');
  await dialog.getByLabel('กำหนดผู้รับผิดชอบ').selectOption('SELF');
  await dialog.getByLabel('หมายเหตุหรือเหตุผล').fill('กำลังตรวจหลักฐานสังเคราะห์');
  await dialog.getByRole('button', { name: 'รับเรื่อง', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body.owner_action).toBe('SELF');
  expect(posts[0].body).not.toHaveProperty('owner_id');
  await expect(dialog.getByRole('heading', { name: 'ประวัติการดำเนินการ', exact: true }).locator('..')).toContainText('รับเรื่องแล้ว');
  await dialog.getByLabel('หมายเหตุหรือเหตุผล').fill('ดำเนินการในขั้นตอน P2 แล้ว รอตรวจรอบใหม่');
  await dialog.getByRole('button', { name: 'บันทึกว่าดำเนินการแล้ว', exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].body.expected_version).toBe(1);
  expect(posts[1].body.expected_snapshot_id).toBe(snapshot);
  expect(finding.condition_present).toBe(true);
  await expect(dialog).toContainText('ดำเนินการแล้ว รอตรวจผลจากคลังข้อมูล');
  await expect(dialog.getByRole('link', { name: 'เสนอรายการแก้ไข', exact: true })).toHaveAttribute('href', '/ads/finance?view=corrections&record=new');
  await expect(dialog.getByRole('link', { name: 'เชื่อม SN กับรายการงบ', exact: true })).toHaveAttribute('href', `/ads/finance?view=media-lines&record=${line}`);
});

test('P3 details remain readable and keyboard accessible on mobile with reduced motion', async ({ page }) => {
  await fixture(page); await page.setViewportSize({ width: 375, height: 812 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%'; }));
  await page.goto('/ads/actuals');
  const opener = page.getByRole('button', { name: 'C-SYNTH-UI', exact: true });
  await opener.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'C-SYNTH-UI', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await dialog.locator('.registry-card').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape'); await expect(opener).toBeFocused();
});

test('P3 proxy rejects unsupported queries, mutations, oversized page and malformed identity', async ({ page }) => {
  await session(page);
  for (const path of ['actuals?limit=101', 'actuals?month=2356-04-01&month=2356-05-01', 'actuals?private=true', 'actuals/not-a-uuid', `findings/${findingKey}?month=2356-04-01`]) expect((await page.request.get(`${api}/${path}`)).status()).toBe(404);
  expect((await page.request.post(`${api}/document-tracking/${documentKey}/review`, { headers: { Origin: origin }, data: {} })).status()).toBe(404);
});
