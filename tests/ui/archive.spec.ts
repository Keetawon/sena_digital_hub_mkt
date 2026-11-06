import { expect, test, type Page } from '@playwright/test';

const api = '/api/hub/v1/admin/ads/archive';
const origin = 'http://127.0.0.1:3000';
const memoId = '62000000-0000-4000-8000-000000000001';
const statementId = '62000000-0000-4000-8000-000000000002';
const memoVersion = '62000000-0000-4000-8000-000000000003';
const statementVersion = '62000000-0000-4000-8000-000000000004';
const jobId = '62000000-0000-4000-8000-000000000005';
const memoTarget = '62000000-0000-4000-8000-000000000006';
type Row = Record<string, any>;
const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');

async function session(page: Page, role = 'online_staff') { expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role } })).ok()).toBeTruthy(); }
async function fixture(page: Page, role = 'online_staff') {
  await session(page, role); const posts: { path: string; body: Row }[] = []; const reads: string[] = []; let failApply = false;
  const version = (id: string, count: number) => ({ id, version_no: 1, sha256: 'a'.repeat(64), byte_size: 100, page_count: count, filename: 'SYNTHETIC.pdf', received_at: '2026-10-01T03:00:00Z' });
  const fields = { memo_no: 'MO2610901', subject: 'งบโครงการตัวอย่างที่ผ่านการตรวจข้อความ', requesting_bud: 'SID', gross_amount: '12000.01', mirrored_status: 'APPROVED', approval_date: '2026-10-01', period_start: '2026-10-01', period_end: '2026-10-31' };
  const memoResult = { pages: [{ page: 1, method: 'TEXT', confidence: null, text: 'SYNTHETIC MEMO', engine_version: 'pypdf-test', line_boxes: [] }], fields, field_sources: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { page: 1, confidence: null, method: 'TEXT', observed_text: value }])), rows: [], controls: {} };
  const statementResult = { pages: [{ page: 1, method: 'OCR', confidence: null, text: 'SYNTHETIC STATEMENT PAGE 1', engine_version: 'Windows.Ocr en-US', line_boxes: [{ text: 'LINEPAY', words: [{ text: 'LINEPAY', x: 1, y: 2, width: 30, height: 10 }] }] }, { page: 2, method: 'OCR', confidence: null, text: 'SYNTHETIC STATEMENT PAGE 2', engine_version: 'Windows.Ocr en-US', line_boxes: [] }], fields: {}, field_sources: {}, rows: [
    { page: 1, occurrence: 1, charge_date: '2026-09-25', descriptor: 'LINEPAY*LP_LINEOFFICIA BANGKOK THA', amount: '99.00', cost_type: 'CHANNEL', payment_method: 'CORPORATE_CARD' },
    { page: 1, occurrence: 2, charge_date: '2026-09-25', descriptor: 'LINEPAY*LP_LINEOFFICIA BANGKOK THA', amount: '99.00', cost_type: 'CHANNEL', payment_method: 'CORPORATE_CARD' },
    { page: 2, occurrence: 1, charge_date: '2026-09-26', descriptor: 'META FB-INVIOOI', amount: '100.00', cost_type: 'MEDIA', payment_method: 'CORPORATE_CARD' },
    { page: 2, occurrence: 2, charge_date: '2026-09-26', descriptor: 'SYNTHETIC CREDIT', amount: '-10.00', cost_type: 'MEDIA', payment_method: 'CORPORATE_CARD' },
  ], controls: { statement_total: '288.00', page_counts: [{ page: 1, count: 2 }, { page: 2, count: 2 }], meaning: 'NET_CHARGES', issuer: 'SYNTHETIC BANK', cycle_start: '2026-09-01', cycle_end: '2026-09-30', due_date: '2026-10-15' } };
  const memo: Row = { id: memoId, document_type: 'E_MEMO', label_th: 'บันทึกข้อความตัวอย่าง', revision: 1, current_version_id: memoVersion, current_version: version(memoVersion, 1), versions: [version(memoVersion, 1)], legal_hold: false, job: { id: jobId, status: 'DRAFT', attempt: 1 }, extraction: { original_result: memoResult, validation: { valid: true, issues: [] } }, confirmation: null, application: null };
  const statement: Row = { id: statementId, document_type: 'CARD_STATEMENT', label_th: 'ใบแจ้งยอดตัวอย่าง', revision: 1, current_version_id: statementVersion, current_version: version(statementVersion, 2), versions: [version(statementVersion, 2)], legal_hold: false, job: { id: jobId, status: 'DRAFT', attempt: 1 }, extraction: { original_result: statementResult, validation: { valid: false, issues: [{ code: 'ROW_SOURCE_MISMATCH', page: 2, occurrence: 1 }] } }, confirmation: null, application: null };
  const documents = [memo, statement];
  await page.route('**/api/hub/v1/admin/ads/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/memos')) return route.fulfill({ json: { data: [{ id: memoTarget, memo_no: 'MO2610901', row_version: 7, record_status: 'CONFIRMED' }], meta: { total: 1 } } });
    if (url.pathname.endsWith(`/memos/${memoTarget}`)) return route.fulfill({ json: { data: { id: memoTarget, memo_no: 'MO2610901', row_version: 7, gross_amount: '12000.01' } } });
    if (url.pathname.endsWith('/card-imports')) return route.fulfill({ json: { data: [], meta: { total: 0 } } });
    if (!url.pathname.startsWith(api)) return route.continue();
    const path = url.pathname.slice(api.length).replace(/^\//, '');
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); posts.push({ path, body });
      const row = documents.find(item => item.id === path.split('/')[0]) ?? memo;
      if (!path) { memo.job.status = 'QUEUED'; memo.extraction = null; return route.fulfill({ json: { data: memo } }); }
      if (path.endsWith('/confirm')) {
        if (row.id === statementId && body.corrected_result.rows[2].descriptor !== 'META FB-INV1001') return route.fulfill({ status: 422, json: { error: { message: 'รายละเอียดรายการยังไม่ตรงหลักฐาน แม้จำนวนและยอดรวมตรงกัน' } } });
        row.confirmation = { corrected_result: body.corrected_result, confirmed_at: '2026-10-01T05:00:00Z' }; row.job.status = 'CONFIRMED'; row.revision += 1;
      }
      if (path.endsWith('/apply')) {
        if (failApply) { failApply = false; return route.fulfill({ status: 503, json: { error: { message: 'บริการขัดข้อง กรุณาลองคำขอเดิมอีกครั้ง' } } }); }
        row.application = { target_id: memoTarget, applied_at: '2026-10-01T06:00:00Z' }; row.revision += 1;
      }
      if (path.endsWith('/hold')) { row.legal_hold = body.held; row.revision += 1; }
      if (path.endsWith('/retry')) { row.job.status = 'RETRY'; row.revision += 1; }
      return route.fulfill({ json: { data: row } });
    }
    reads.push(url.pathname + url.search);
    if (path === 'fixtures') return route.fulfill({ json: { data: { items: [{ fixture_id: 'synthetic-memo', document_type: 'E_MEMO', label_th: 'บันทึกข้อความสังเคราะห์', page_count: 1, filename: 'SYNTHETIC-MEMO.pdf' }, { fixture_id: 'synthetic-statement', document_type: 'CARD_STATEMENT', label_th: 'ใบแจ้งยอดสังเคราะห์', page_count: 2, filename: 'SYNTHETIC-STATEMENT.pdf' }] } } });
    if (path.endsWith('/file')) return route.fulfill({ body: pdf, contentType: 'application/pdf', headers: { 'Cache-Control': 'private, no-store', 'X-Frame-Options': 'SAMEORIGIN' } });
    if (path.endsWith('/page')) return route.fulfill({ body: png, contentType: 'image/png', headers: { 'Cache-Control': 'private, no-store', 'X-Frame-Options': 'DENY' } });
    if (path === 'search') { const items = !memo.legal_hold && url.searchParams.get('q') === 'MO2610901' ? [{ document_id: memoId, version_id: memoVersion, version_no: 1, page: 1, memo_id: memoTarget, memo_no: 'MO2610901', matched_identifier: 'MO2610901', subject: fields.subject, bud: 'SID', gross_amount: '12000.01', snippet: 'MO2610901\nงบโครงการตัวอย่างที่ผ่านการตรวจข้อความ', confirmed_at: '2026-10-01T05:00:00Z' }] : []; return route.fulfill({ json: { data: { items, total: items.length } } }); }
    if (path) return route.fulfill({ json: { data: documents.find(row => row.id === path) } });
    let items = documents;
    for (const key of ['document_type', 'status']) if (url.searchParams.has(key)) items = items.filter(row => (key === 'status' ? row.job.status : row[key]) === url.searchParams.get(key));
    return route.fulfill({ json: { data: { items, total: items.length } } });
  });
  return { posts, reads, memo, statement, memoResult, statementResult, failApply: () => { failApply = true; } };
}

test('archive denies residential and agency roles without private fetches or controls', async ({ page }) => {
  for (const role of ['editor', 'publisher', 'viewer', 'agency_kin', 'agency_combay']) {
    await session(page, role); const reads: string[] = []; const capture = (request: { url: () => string }) => { if (request.url().includes(api)) reads.push(request.url()); }; page.on('request', capture);
    expect((await page.goto('/ads/archive'))?.status()).toBe(403); await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงหน้านี้', exact: true })).toBeVisible(); expect(reads).toEqual([]); page.off('request', capture);
    for (const path of ['', '/fixtures', '/search?q=MO2610901', `/${memoId}`, `/${memoId}/file?version_id=${memoVersion}`, `/${statementId}/page?version_id=${statementVersion}&page=1`]) expect((await page.request.get(api + path)).status()).toBe(403);
  }
});

test('seeded private archive reads the real P2 array contract and serves an authenticated source PDF', async ({ page }) => {
  await session(page);
  const response = await page.request.get(`${api}?limit=100`); expect(response.status()).toBe(200);
  const documents = (await response.json()).data.items;
  const statement = documents.find((row: Row) => row.document_type === 'CARD_STATEMENT' && row.current_version.page_count === 5 && row.extraction?.original_result?.rows.length === 10);
  const memo = documents.find((row: Row) => row.document_type === 'E_MEMO' && row.extraction?.original_result);
  expect(statement).toBeTruthy(); expect(memo).toBeTruthy();
  for (const resource of ['memos', 'card-imports']) {
    const financialResponse = await page.request.get(`/api/hub/v1/admin/ads/${resource}?limit=100`);
    expect(financialResponse.status()).toBe(200); expect(Array.isArray((await financialResponse.json()).data)).toBe(true);
  }
  const file = `${api}/${statement.id}/file?version_id=${statement.current_version_id}&page=1&download=false`;
  const range = await page.request.get(file, { headers: { Range: 'bytes=0-15' } });
  expect(range.status()).toBe(206); expect((await range.body()).length).toBe(16); expect((await range.body()).subarray(0, 5).toString()).toBe('%PDF-');
  expect(range.headers()['x-frame-options']).toBe('SAMEORIGIN'); expect(range.headers()['cache-control']).toContain('no-store');
  expect(range.headers()['content-security-policy']).toContain('sandbox'); expect(range.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
  expect(range.headers()['content-range']).toMatch(/^bytes 0-15\/\d+$/);
  const image = await page.request.get(`${api}/${statement.id}/page?version_id=${statement.current_version_id}&page=5`);
  expect(image.status()).toBe(200); expect(image.headers()['content-type']).toBe('image/png'); expect((await image.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(image.headers()['x-frame-options']).toBe('DENY'); expect(image.headers()['cache-control']).toContain('no-store'); expect(image.headers()['x-content-type-options']).toBe('nosniff');
  expect((await page.request.get('/ads/archive')).headers()['x-frame-options']).toBe('DENY');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const row of [statement, memo]) {
    const targetRead = page.waitForResponse(result => result.url().includes(`/api/hub/v1/admin/ads/${row.document_type === 'E_MEMO' ? 'memos' : 'card-imports'}?limit=100`));
    await page.goto(`/ads/archive?document=${row.id}`); expect((await targetRead).status()).toBe(200);
    const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('heading', { name: row.label_th, exact: true })).toBeVisible();
    if (row.document_type === 'CARD_STATEMENT') {
      await expect(dialog.locator('#archive-source-page option')).toHaveCount(5); await expect(dialog.locator('[id^="archive-description-"]')).toHaveCount(10);
      const source = dialog.getByRole('img', { name: 'หลักฐานเอกสาร รุ่น 1 หน้า 1', exact: true });
      await expect(source).toHaveAttribute('src', new RegExp(`/page\\?version_id=${row.current_version_id}&page=1$`));
      await expect.poll(() => source.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
      await dialog.getByLabel('หน้าหลักฐาน', { exact: true }).selectOption('5');
      await expect.poll(() => dialog.getByRole('img', { name: 'หลักฐานเอกสาร รุ่น 1 หน้า 5', exact: true }).evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    } else await expect(dialog.locator('iframe')).toHaveAttribute('src', new RegExp(`version_id=${row.current_version_id}&page=1&download=false#page=1`));
    if (row.application) await expect(dialog.getByRole('link', { name: 'เปิดรายการ P2 ที่เชื่อม', exact: true })).toBeVisible();
    else await expect(dialog.getByLabel('วิธีนำข้อมูลไปใช้', { exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('archive receives only a registered synthetic fixture, shows queued work and filters by document type', async ({ page }) => {
  const { posts } = await fixture(page); await page.goto('/ads/archive'); await expect(page.locator('input[type=file]')).toHaveCount(0);
  await page.getByLabel('ประเภทเอกสาร', { exact: true }).selectOption('CARD_STATEMENT'); await expect(page.locator('.registry-table')).toContainText('ใบแจ้งยอดตัวอย่าง'); await expect(page.locator('.registry-table')).not.toContainText('บันทึกข้อความตัวอย่าง');
  await page.getByLabel('เอกสารตัวอย่างที่รับเข้า', { exact: true }).selectOption('synthetic-memo'); await page.getByRole('button', { name: 'รับเอกสารและเข้าคิวประมวลผล', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1); expect(posts[0].body).toEqual({ fixture_id: 'synthetic-memo' });
  const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('รอประมวลผล'); await expect(dialog.getByRole('button', { name: 'นำข้อมูลไปใช้ใน P2', exact: true })).toBeDisabled();
});

test('failed local extraction can be explicitly retried without fabricating draft rows', async ({ page }) => {
  const { memo, posts } = await fixture(page); memo.job.status = 'FAILED'; memo.job.safe_error = 'OCR_UNAVAILABLE'; memo.extraction = null;
  await page.goto(`/ads/archive?document=${memoId}`); const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ประมวลผลไม่สำเร็จ'); await expect(dialog.getByRole('button', { name: 'ยืนยันข้อมูลที่ถอดจากเอกสาร', exact: true })).toHaveCount(0);
  await dialog.getByLabel('เหตุผลการประมวลผลหรือเก็บรักษา').fill('ตรวจเครื่องมือในเครื่องแล้ว ขอประมวลผลใหม่'); await dialog.getByRole('button', { name: 'เข้าคิวประมวลผลอีกครั้ง', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1); expect(posts[0]).toMatchObject({ path: `${memoId}/retry`, body: { expected_revision: 1, expected_version_id: memoVersion } }); await expect(dialog).toContainText('รอประมวลผลอีกครั้ง');
});

test('statement review preserves OCR evidence and repeated rows; balanced totals cannot confirm a wrong descriptor', async ({ page }) => {
  const { posts, statementResult } = await fixture(page); await page.goto(`/ads/archive?document=${statementId}`); const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('LINE OA (ยังไม่แยกบัญชี)'); await expect(dialog).toContainText('288.00 บาท'); await expect(dialog).toContainText('รายละเอียดรายการยังไม่ตรงกับหลักฐาน');
  await expect(dialog.getByLabel('รายละเอียด รายการ 1', { exact: true })).toHaveValue(statementResult.rows[0].descriptor); await expect(dialog.getByLabel('รายละเอียด รายการ 2', { exact: true })).toHaveValue(statementResult.rows[0].descriptor);
  await dialog.getByLabel('หลักฐานและบันทึกการตรวจเทียบเอกสาร').fill('ตรวจต้นฉบับสังเคราะห์ทุกหน้า'); await dialog.getByRole('checkbox', { name: 'ตรวจครบทุกหน้าและทุกรายการกับเอกสารต้นฉบับแล้ว' }).check(); await dialog.getByRole('button', { name: 'ยืนยันข้อมูลที่ถอดจากเอกสาร', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('แม้จำนวนและยอดรวมตรงกัน');
  await dialog.getByLabel('รายละเอียด รายการ 3', { exact: true }).fill('META FB-INV1001'); await expect(dialog).toContainText('META FB-INVIOOI');
  await dialog.getByRole('checkbox', { name: 'ตรวจครบทุกหน้าและทุกรายการกับเอกสารต้นฉบับแล้ว' }).check(); await dialog.getByRole('button', { name: 'ยืนยันข้อมูลที่ถอดจากเอกสาร', exact: true }).click();
  await expect.poll(() => posts.length).toBe(2); expect(posts[1].body.corrected_result.pages).toEqual(statementResult.pages); expect(posts[1].body.corrected_result.rows).toHaveLength(4); expect(posts[1].body.corrected_result.rows[2].descriptor).toBe('META FB-INV1001');
  await expect(dialog).toContainText('ยืนยันข้อมูลที่ถอดแล้ว'); expect(posts.every(row => row.path.endsWith('/confirm'))).toBe(true);
  await expect(dialog.getByRole('button', { name: 'ยืนยันชุดค่าใช้จ่าย', exact: true })).toHaveCount(0);
});

test('statement page counts and signed controls show mismatches without inventing rows or balancing amounts', async ({ page }) => {
  const { statement } = await fixture(page); statement.extraction.original_result.controls.page_counts[0].count = 3; statement.extraction.original_result.rows[0].amount = '98.00';
  await page.goto(`/ads/archive?document=${statementId}`); const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('จำนวนรายการไม่ตรง'); await expect(dialog).toContainText('ยอดรวมไม่ตรง'); await expect(dialog).toContainText('-1.00 บาท');
  await dialog.getByLabel('หน้าหลักฐาน', { exact: true }).selectOption('2'); await expect(dialog.getByRole('link', { name: 'เปิดหน้าหลักฐาน 2 รุ่น 1', exact: true })).toHaveAttribute('href', new RegExp(`version_id=${statementVersion}&page=2&download=false#page=2`));
  await expect(dialog.getByRole('img', { name: 'หลักฐานเอกสาร รุ่น 1 หน้า 2', exact: true })).toHaveAttribute('src', new RegExp(`version_id=${statementVersion}&page=2$`)); await expect(page).toHaveURL(/page=2/);
});

test('statement image failure keeps the selected source page and offers the original PDF', async ({ page }) => {
  await fixture(page); await page.route('**/archive/*/page?**', route => route.fulfill({ status: 503, json: { error: { message: 'ไม่สามารถแสดงภาพได้' } } }));
  await page.goto(`/ads/archive?document=${statementId}&page=2`); const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('โหลดภาพหน้าหลักฐานไม่ได้ กรุณาเปิดไฟล์ต้นฉบับจากปุ่มด้านบน');
  await expect(dialog.getByLabel('หน้าหลักฐาน', { exact: true })).toHaveValue('2');
  await expect(dialog.getByRole('link', { name: 'เปิดหน้าหลักฐาน 2 รุ่น 1', exact: true })).toHaveAttribute('href', new RegExp(`version_id=${statementVersion}&page=2&download=false#page=2`));
  await expect(dialog.locator('iframe')).toHaveCount(0);
});

test('memo transcription and P2 application are separate, version-checked and harmless to retry', async ({ page }) => {
  const data = await fixture(page); data.failApply(); await page.goto(`/ads/archive?document=${memoId}`); const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('เครื่องมือไม่ได้ระบุค่าความเชื่อมั่น'); await dialog.getByLabel('หลักฐานและบันทึกการตรวจเทียบเอกสาร').fill('ตรวจข้อมูลจาก PDF ตัวอย่าง'); await dialog.getByRole('checkbox', { name: 'ตรวจครบทุกหน้าและทุกรายการกับเอกสารต้นฉบับแล้ว' }).check();
  await dialog.getByRole('button', { name: 'ยืนยันข้อมูลที่ถอดจากเอกสาร', exact: true }).click(); await expect.poll(() => data.posts.length).toBe(1); expect(data.posts[0].body.corrected_result.field_sources).toEqual(data.memoResult.field_sources);
  await dialog.getByLabel('บันทึกข้อความ P2 ที่จะเชื่อม', { exact: true }).selectOption(memoTarget); await expect(dialog).toContainText('รุ่นข้อมูล P2 ที่จะใช้: 7'); await dialog.getByLabel('เหตุผลการนำข้อมูลไปใช้').fill('เชื่อมหลักฐานเดิม ไม่สร้างซ้ำ'); await dialog.getByRole('checkbox', { name: 'ตรวจปลายทางและยืนยันว่าจะไม่สร้างข้อมูลซ้ำแล้ว' }).check();
  await dialog.getByRole('button', { name: 'นำข้อมูลไปใช้ใน P2', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('ลองคำขอเดิม'); await dialog.getByRole('button', { name: 'นำข้อมูลไปใช้ใน P2', exact: true }).click(); await expect.poll(() => data.posts.length).toBe(3);
  expect(data.posts[2].body).toEqual(data.posts[1].body); expect(data.posts[2].body).toMatchObject({ expected_revision: 2, expected_version_id: memoVersion, expected_job_id: jobId, mode: 'LINK_MEMO', target_id: memoTarget, expected_target_version: 7 });
  await expect(dialog.getByRole('link', { name: 'เปิดรายการ P2 ที่เชื่อม' })).toHaveAttribute('href', `/ads/finance?view=memos&record=${memoTarget}`);
});

test('memo search returns sanitized cited text and validated P2 money, with no statement search option', async ({ page }) => {
  const { reads } = await fixture(page); await page.goto('/ads/archive?view=search'); await expect(page.getByLabel('ประเภทเอกสาร', { exact: true })).toHaveCount(0); await page.getByLabel('ข้อความหรือเลขบันทึกข้อความ').fill('MO2610901'); await page.getByRole('button', { name: 'ค้นหาบันทึกข้อความ', exact: true }).click();
  await expect(page.locator('.archive-result')).toContainText('12,000.01 บาท'); await expect(page.locator('.archive-result mark')).toHaveText('MO2610901'); await page.getByRole('button', { name: 'เปิดหลักฐาน หน้า 1 รุ่น 1', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`version=${memoVersion}`)); await expect(page.getByRole('dialog').locator('iframe')).toHaveAttribute('src', new RegExp(`version_id=${memoVersion}&page=1&download=false#page=1`));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(`${origin}/ads/archive?view=search&q=MO2610901`);
  await page.getByLabel('ข้อความหรือเลขบันทึกข้อความ').fill('LINEPAY'); await expect(page.locator('#archive-search')).toHaveValue('LINEPAY'); await page.getByRole('button', { name: 'ค้นหาบันทึกข้อความ', exact: true }).click(); await expect(page.getByText('ไม่พบบันทึกข้อความที่มีสิทธิ์เข้าถึงและตรงกับคำค้น', { exact: true })).toBeVisible();
  expect(reads.some(path => new URL(path, origin).searchParams.get('q') === 'LINEPAY')).toBe(true);
  expect(reads.filter(path => path.includes('/search?')).every(path => !path.includes('CARD_STATEMENT'))).toBe(true);
});

test('admin legal hold stops processing while keeping restricted evidence accessible; online staff has no hold action', async ({ page }) => {
  const { posts } = await fixture(page, 'admin'); await page.goto(`/ads/archive?document=${memoId}`); const dialog = page.getByRole('dialog'); await dialog.getByLabel('เหตุผลการประมวลผลหรือเก็บรักษา').fill('คำสั่งเก็บรักษาสังเคราะห์'); await dialog.getByRole('button', { name: 'กำหนดให้เก็บรักษาเอกสาร', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1); expect(posts[0].body).toEqual({ expected_revision: 1, held: true, reason: 'คำสั่งเก็บรักษาสังเคราะห์' }); await expect(dialog).toContainText('งดประมวลผลและใช้ข้อมูลเพิ่มเติม'); await expect(dialog.getByRole('link', { name: 'เปิดหน้าหลักฐาน 1 รุ่น 1', exact: true })).toBeVisible(); await expect(dialog.getByRole('button', { name: 'ยืนยันข้อมูลที่ถอดจากเอกสาร', exact: true })).toBeDisabled();
  await session(page, 'online_staff'); await page.reload(); await expect(page.getByRole('button', { name: 'ยกเลิกคำสั่งเก็บรักษา', exact: true })).toHaveCount(0);
});

test('archive details keep unsaved corrections, reject unknown version and remain readable with reduced motion', async ({ page }) => {
  await fixture(page); await page.setViewportSize({ width: 375, height: 812 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%'; })); await page.goto('/ads/archive');
  const opener = page.getByRole('button', { name: 'บันทึกข้อความตัวอย่าง', exact: true }); await opener.focus(); await page.keyboard.press('Enter'); const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('heading', { name: 'บันทึกข้อความตัวอย่าง', exact: true })).toBeFocused();
  await dialog.getByLabel('เรื่อง', { exact: true }).fill('บันทึกตรวจที่ยังไม่บันทึก'); page.once('dialog', confirmation => confirmation.dismiss()); await page.keyboard.press('Escape'); await expect(dialog.getByLabel('เรื่อง', { exact: true })).toHaveValue('บันทึกตรวจที่ยังไม่บันทึก');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(await dialog.locator('.registry-card').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  page.once('dialog', confirmation => confirmation.accept()); await page.keyboard.press('Escape'); await expect(opener).toBeFocused();
  await page.setViewportSize({ width: 812, height: 375 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto(`/ads/archive?document=${memoId}&version=${statementVersion}`); await expect(page.getByRole('dialog').getByRole('alert')).toContainText('ระบบไม่เปลี่ยนไปแสดงรุ่นอื่นแทน'); await expect(page.getByRole('dialog').locator('iframe')).toHaveCount(0);
});

test('archive proxy rejects unsupported queries, arbitrary uploads and unauthorized hold', async ({ page }) => {
  await session(page);
  for (const path of ['?limit=101', '?document_type=E_MEMO&document_type=CARD_STATEMENT', '/search?q=x&private=true', `/${memoId}/file?version_id=bad`, `/${memoId}/file?version_id=${memoVersion}&download=yes`, `/${statementId}/page?version_id=bad&page=1`, `/${statementId}/page?version_id=${statementVersion}&page=0`, `/${statementId}/page?version_id=${statementVersion}&page=1&page=2`, `/${statementId}/page?version_id=${statementVersion}&page=1&download=true`]) expect((await page.request.get(api + path)).status()).toBe(404);
  expect((await page.request.post(`${api}/upload`, { headers: { Origin: origin }, data: {} })).status()).toBe(404);
  expect((await page.request.post(`${api}/${memoId}/hold`, { headers: { Origin: origin }, data: {} })).status()).toBe(403);
  expect((await page.request.get(`${api}/${memoId}/file?version_id=${memoVersion}`, { headers: { Range: 'bytes=0-1,3-5' } })).status()).toBe(416);
});
