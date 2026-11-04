import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:3000';
const project = {
  public_project_id: 'CAPABILITY-UI', public_name: { th: 'โครงการต้นทางสมมติที่ต้องปิดเมื่อถอนสิทธิ์' }, slug: 'capability-ui',
  updated_at: '2026-10-09T00:00:00Z', published_version_id: null, publication_available: false,
  readiness: { ready: false, percent: 0, missing: [] }, models: [], assets: [], commercial_types: [],
  meta_title: { th: 'ชื่อเรื่องเดิมจากเซิร์ฟเวอร์' }, meta_description: { th: 'ข้อมูลเดิมที่ไม่ได้แก้' },
  source: { rem_project_id: 'CAPABILITY-UI', project_name_rem: 'โครงการสมมติ', rem_brand_id: 'CAP-BRAND', brand_name_rem: 'ชื่อแบรนด์อ้างอิงเท่านั้น', source_record: null, intake_manifest_sha256: null },
};

async function persona(page: Page, role: string) {
  expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role } })).ok()).toBeTruthy();
  return (await (await page.request.get('/api/hub/v1/me')).json()).data;
}
function capabilities(account: any, tabs: Record<string, string[]>) {
  return { ...account, capabilities: { ...account.capabilities,
    tabs: Object.fromEntries(Object.entries(tabs).map(([tab, levels]) => [tab, { view: levels.includes('view'), edit: levels.includes('edit'), approve: levels.includes('approve') }])),
    special_actions: {}, can_manage_users: false, agency_registry: false,
  } };
}
async function syntheticProject(page: Page) {
  await page.route('**/api/hub/v1/admin/projects/CAPABILITY-UI', route => route.fulfill({ json: { data: project } }));
  await page.route('**/api/hub/v1/admin/projects/CAPABILITY-UI/versions', route => route.fulfill({ json: { data: [] } }));
}

test('capability projection drives controls and names-only brand references without role fallback', async ({ page }) => {
  const real = await persona(page, 'viewer');
  let me = capabilities(real, { projects: ['view', 'edit'], finance: ['view', 'edit'] });
  let brandReads = 0, accountDirectoryReads = 0;
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path === '/api/hub/v1/admin/brands') brandReads++; if (path === '/api/hub/v1/admin/accounts') accountDirectoryReads++; });
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: me } }));
  await syntheticProject(page);
  await page.goto('/?project=CAPABILITY-UI');
  await expect(page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)', { exact: true })).toBeEditable();
  await page.getByRole('navigation').getByRole('button', { name: 'งานโฆษณาและงบ', exact: true }).click();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'งบและค่าใช้จ่าย', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation').locator('a[href="/?view=brands"]')).toHaveCount(0);
  await expect(page.getByRole('navigation').getByRole('link', { name: 'ผู้ใช้และสิทธิ์', exact: true })).toHaveCount(0);
  await expect(page.getByText('ชื่อแบรนด์อ้างอิงเท่านั้น', { exact: true })).toBeVisible();
  await expect(page.locator('a[href*="brand="]')).toHaveCount(0);
  expect(brandReads).toBe(0); expect(accountDirectoryReads).toBe(0);

  const registryActor = await persona(page, 'admin');
  me = capabilities(registryActor, { registry: ['view'] });
  await page.route('**/api/hub/v1/admin/ads/registrations/SN0000007X', route => route.fulfill({ json: { data: {
    registration: { code: 'SN0000007X', objective: 'LEAD', agency: 'KIN', label: 'ทะเบียนสมมติสำหรับดูรหัส', status: 'ACTIVE', created_at: '2026-10-09T00:00:00Z' },
    scope: { scope_id: 'SYNTHETIC-SCOPE', scope_code: 'A_TEST', label_th: 'ขอบเขตสมมติ', kind: 'A' }, members: [], names: [],
    bindings: [{ name_id: 'SYNTHETIC-NAME', platform: 'GOOGLE', account_id: 'SYNTHETIC-ACCOUNT', campaign_id: 'SYNTHETIC-CAMPAIGN' }],
  } } }));
  await page.goto('/ads/registry?registration=SN0000007X&tab=bindings');
  await expect(page.getByRole('tabpanel')).toContainText('GOOGLE · SYNTHETIC-ACCOUNT · SYNTHETIC-CAMPAIGN');
  await expect(page.getByRole('button', { name: 'บันทึกรหัส', exact: true })).toHaveCount(0);
  await expect(page.locator('#binding-account, #binding-campaign')).toHaveCount(0);
});

for (const revoke of ['view', 'edit', 'signed-out'] as const) {
  test(`${revoke} revocation clears source caches and retains only typed values; identity switch clears recovery`, async ({ page }) => {
    const real = await persona(page, 'viewer');
    let me = capabilities(real, { projects: ['view', 'edit'] }), denied = false, checks = 0;
    await page.route('**/api/hub/v1/me', route => { checks++; return route.fulfill(denied ? { status: 401, json: { error: { message: 'กรุณาเข้าสู่ระบบ' } } } : { json: { data: me } }); });
    await syntheticProject(page);
    await page.goto('/?project=CAPABILITY-UI');
    const authored = 'ชื่อที่ฉันพิมพ์เองและยังไม่บันทึก';
    await page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)', { exact: true }).fill(authored);
    const before = checks;
    if (revoke === 'signed-out') denied = true;
    else me = capabilities(real, { projects: revoke === 'edit' ? ['view'] : [] });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => checks).toBeGreaterThan(before);
    const recovery = page.getByRole('complementary', { name: 'ข้อความที่คุณกรอก', exact: true });
    await expect(recovery.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)', { exact: true })).toHaveValue(authored);
    await expect(recovery).not.toContainText('ชื่อเรื่องเดิมจากเซิร์ฟเวอร์');
    expect(await recovery.getByRole('textbox').count()).toBe(1);
    if (revoke !== 'edit') await expect(page.getByRole('heading', { name: project.public_name.th, exact: true })).toHaveCount(0);
    else await expect(page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)', { exact: true }).first()).not.toBeEditable();
    denied = false; me = capabilities({ ...real, id: '65000000-0000-4000-8000-000000000099' }, { projects: ['view'] });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(recovery).toHaveCount(0);
  });
}

test('missing capability projection never falls back to the admin role', async ({ page }) => {
  const me = await persona(page, 'admin'); delete me.capabilities;
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: me } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงหน้านี้' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ผู้ใช้และสิทธิ์', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'เลือกโครงการจากต้นทาง', exact: true })).toHaveCount(0);
});

test('API unavailable is separate from signed out during capability refresh', async ({ page }) => {
  await persona(page, 'viewer');
  await page.route('**/api/hub/v1/me', route => route.fulfill({ status: 503, json: { error: { message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่' } } }));
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'ระบบขัดข้องชั่วคราว' })).toContainText('ระบบขัดข้องชั่วคราว');
  await expect(page.locator('.session-expired')).toHaveCount(0);
});

test('direct management URLs use tab boxes while agencies retain the registry boundary', async ({ page }) => {
  await persona(page, 'viewer');
  expect((await page.request.get('/ads/finance')).status()).toBe(403);
  expect((await page.request.get('/admin/accounts')).status()).toBe(403);
  expect((await page.request.get('/?view=brands')).status()).toBe(200);
  await persona(page, 'agency_kin');
  expect((await page.request.get('/?project=CAPABILITY-UI')).status()).toBe(403);
  expect((await page.request.get('/?view=brands')).status()).toBe(403);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'ทะเบียนแคมเปญ', exact: true })).toBeVisible();
  expect((await page.request.get('/ads/registry')).status()).toBe(200);
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('agency_kin');
  await page.getByLabel('เลือกบัญชีทดสอบ').selectOption('viewer');
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('viewer');
  await expect(page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('link', { name: 'หน้าแรก', exact: true })).toBeVisible();
});

test('finance drafting permission cannot confirm a statement through a visible form', async ({ page }) => {
  const real = await persona(page, 'admin');
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: capabilities(real, { finance: ['view', 'edit'] }) } }));
  await page.goto('/ads/finance?view=card-statements&record=new');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'การตรวจยอดควบคุม', exact: true }).selectOption('CONFIRMED');
  await expect(dialog.getByRole('button', { name: 'บันทึกร่าง', exact: true })).toBeDisabled();
  await dialog.getByRole('combobox', { name: 'การตรวจยอดควบคุม', exact: true }).selectOption('DRAFT');
  await expect(dialog.getByRole('button', { name: 'บันทึกร่าง', exact: true })).toBeEnabled();
  const id = '65000000-0000-4000-8000-000000000097';
  await page.route(`**/api/hub/v1/admin/ads/card-statements/${id}`, route => route.fulfill({ json: { data: { id, review_status: 'CONFIRMED', row_version: 1, operator_ref: 'SYNTHETIC-CONFIRMED', issuer: 'Synthetic issuer' } } }));
  await page.goto(`/ads/finance?view=card-statements&record=${id}`);
  await dialog.getByRole('button', { name: 'ตรวจหรือแก้ยอดควบคุม', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'การตรวจยอดควบคุม', exact: true }).selectOption('DRAFT');
  await expect(dialog.getByRole('button', { name: 'ตรวจหรือแก้ยอดควบคุม', exact: true }).last()).toBeDisabled();
});


test('observed capabilities clear assistant source caches on a retained shell and recover an unsent question', async ({ page }) => {
  const real = await persona(page, 'editor');
  let me = capabilities(real, { projects: ['view', 'edit'], questions: ['view'] });
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: me } }));
  await page.route('**/api/hub/v1/admin/assistant/config', route => route.fulfill({ json: { data: {
    session_key: 'synthetic-stale-config', mode: 'fake', live_available: false, allowed_tools: ['get_project'],
    proposal_fields: {}, live_questions: [], message_th: 'ข้อมูลสมมติ',
  } } }));
  await page.route('**/api/hub/v1/admin/assistant/runs', route => {
    const frame = (event: string, value: object) => `event: ${event}\ndata: ${JSON.stringify({ run_id: '65000000-0000-4000-8000-000000000098', ...value })}\n\n`;
    return route.fulfill({ contentType: 'text/event-stream', body: frame('status', { state: 'running' })
      + frame('answer_delta', { block_id: 'synthetic', text: 'ข้อมูลต้นทางจากคำตอบที่ต้องปิด', metadata: { synthetic: true }, citation_ids: [] })
      + frame('done', { status: 'DONE', provider: 'fake', usage: {} }) });
  });
  await page.goto('/questions?assistant=open');
  const panel = page.getByRole('dialog', { name: 'ผู้ช่วย Hub', exact: true });
  await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('อ่านข้อมูลสมมติ');
  await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click();
  await expect(panel.locator('.assistant-answer')).toHaveText('ข้อมูลต้นทางจากคำตอบที่ต้องปิด');
  await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('คำถามที่ยังไม่ได้ส่งและต้องเก็บ');
  me = capabilities(real, { questions: ['view'] });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.assistant-answer')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'ข้อความที่คุณกรอก', exact: true }).getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveValue('คำถามที่ยังไม่ได้ส่งและต้องเก็บ');
});
