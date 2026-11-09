import { expect, test, type Locator, type Page } from '@playwright/test';
import { workspaceText as text } from '../../apps/admin/lib/unified-workspace';

const api = '/api/hub/v1/admin', sessionKey = 'synthetic-business-context';
const businessUrl = '/website/business/residential';
const panelFor = (page: Page) => page.getByRole('dialog', { name: 'ผู้ช่วย Hub', exact: true });

async function mocked(page: Page, options: { stored?: unknown; searchOnly?: boolean; noSearch?: boolean; noKnowledge?: boolean } = {}) {
  expect((await page.request.post('/api/local-session', {
    headers: { Origin: 'http://127.0.0.1:3000' }, data: { role: 'editor' },
  })).ok()).toBeTruthy();
  if (options.stored !== undefined) await page.addInitScript(({ key, value }) => {
    sessionStorage.setItem(`hub-assistant-context:${key}`, JSON.stringify(value));
  }, { key: sessionKey, value: options.stored });
  if (options.searchOnly || options.noKnowledge) {
    const response = await page.request.get('/api/hub/v1/me');
    expect(response.ok()).toBeTruthy();
    const account = (await response.json()).data;
    account.capabilities = { ...account.capabilities, tabs: options.noKnowledge ? {
      projects: { view: true }, brands: { view: true }, knowledge: { view: false },
    } : { knowledge: { view: true } }, can_manage_users: false };
    await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: account } }));
  }
  const posts: { path: string; body: { context?: Record<string, unknown> } }[] = [];
  await page.route('**/api/hub/v1/admin/**', route => {
    const path = new URL(route.request().url()).pathname.slice(api.length);
    if (route.request().method() !== 'GET') {
      posts.push({ path, body: route.request().postDataJSON() });
      if (path === '/assistant/runs') return options.noKnowledge
        ? route.fulfill({ status: 403, json: { error: { message: 'SYNTHETIC BUSINESS DENIED' } } })
        : route.fulfill({ contentType: 'text/event-stream', body: 'event: done\ndata: {"status":"COMPLETED"}\n\n' });
      return route.fulfill({ status: 404, json: { error: { message: 'SYNTHETIC UNEXPECTED WRITE' } } });
    }
    if (path === '/assistant/config') return route.fulfill({ json: { data: {
      session_key: sessionKey, mode: 'fake', live_available: false,
      allowed_tools: options.searchOnly ? ['search_content'] : options.noSearch ? ['get_project', 'get_brand'] : ['get_project', 'get_brand', 'search_content'],
      message_th: 'SYNTHETIC', live_questions: [],
      proposal_fields: options.searchOnly ? {} : { project: ['meta_title.th'], brand: ['description.th'] },
    } } });
    if (path === '/content/workspace/business/residential') return route.fulfill({ json: { data: {
      entity: { kind: 'business', ref: 'residential', name: { th: text.business }, scope_type: 'business', scope_id: 'residential' },
      phases: [], selected_phase: null, tabs: ['overview'], sections: [],
      overview: { readiness: { required: [], recommended: [] }, tasks: [], changes_since_publication: [] },
    } } });
    if (path === '/content-workflow/items') return route.fulfill({ json: { data: {
      scope: { level: 'business', id: 'residential', phase: null }, items: [], next_cursor: null,
    } } });
    if (path === '/questions') return route.fulfill({ json: { data: { questions: [] } } });
    return route.fallback();
  });
  return posts;
}

async function open(page: Page, deepLink = false) {
  await page.goto(businessUrl + (deepLink ? '?assistant=open' : ''));
  await expect(page.locator('.workspace-heading')).toContainText(text.business);
  if (!deepLink) await page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true }).click();
  const panel = panelFor(page);
  await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toBeFocused();
  return panel;
}

async function contextPicker(panel: Locator) {
  await panel.getByRole('button', { name: 'เปลี่ยนบริบทอย่างชัดเจน', exact: true }).click();
  const picker = panel.getByRole('dialog', { name: 'บริบทผู้ช่วย', exact: true });
  await expect(picker.getByRole('heading', { name: 'บริบทผู้ช่วย', exact: true })).toBeFocused();
  return picker;
}

async function send(panel: Locator) {
  await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('SYNTHETIC QUESTION');
  await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'ส่งคำถาม', exact: true })).toBeDisabled();
  await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveValue('');
}

test('ordinary business page derives a business scope and never offers a business proposal form', async ({ page }) => {
  const posts = await mocked(page), panel = await open(page);
  await expect(panel.locator('.assistant-context-trigger')).toHaveText(text.business + ': residential⌄');
  expect(posts).toEqual([]);
  await panel.getByRole('tab', { name: 'เสนอแก้ร่าง', exact: true }).click();
  await expect(panel.locator('.assistant-proposal')).toHaveCount(0);
  await expect(panel.getByLabel('ข้อความที่เสนอ', { exact: true })).toHaveCount(0);
  await panel.getByRole('tab', { name: 'แชท', exact: true }).click();
  await send(panel);
  expect(posts).toEqual([{ path: '/assistant/runs', body: { mode: 'fake', message: 'SYNTHETIC QUESTION', context: { business_id: 'residential' } } }]);
  await panel.getByRole('button', { name: 'ปิดผู้ช่วย', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true })).toBeFocused();
});

test('explicit context change, published mode, page reset and clear send one scope only', async ({ page }) => {
  const posts = await mocked(page), panel = await open(page);
  await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('SYNTHETIC UNSENT');
  let picker = await contextPicker(panel);
  await picker.getByLabel('ประเภทบริบท').selectOption('brand_id');
  await picker.getByLabel('รหัสบริบทตามต้นทาง').fill('BRAND-SYNTHETIC');
  await picker.getByLabel('ฉบับข้อมูลที่ต้องการ').selectOption('published');
  await picker.getByLabel('เดือนตามเวลาประเทศไทย').fill('2026-11');
  await picker.getByRole('button', { name: 'ใช้บริบทนี้', exact: true }).click();
  await expect(panel.locator('.assistant-context-trigger')).toBeFocused();
  await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveValue('SYNTHETIC UNSENT');
  expect(posts).toEqual([]);
  await send(panel);
  expect(posts[0].body.context).toEqual({ brand_id: 'BRAND-SYNTHETIC', month: '2026-11-01', visibility: 'published' });
  picker = await contextPicker(panel);
  await picker.getByLabel('ประเภทบริบท').selectOption('business_id');
  await picker.getByLabel('รหัสบริบทตามต้นทาง').fill('residential');
  await picker.getByRole('button', { name: 'ใช้บริบทนี้', exact: true }).click();
  await send(panel);
  expect(posts[1].body.context).toEqual({ business_id: 'residential', month: '2026-11-01', visibility: 'published' });
  picker = await contextPicker(panel);
  await picker.getByRole('button', { name: 'ใช้บริบทของหน้าปัจจุบัน', exact: true }).click();
  await send(panel);
  expect(posts[2].body.context).toEqual({ business_id: 'residential' });
  picker = await contextPicker(panel);
  await picker.getByRole('button', { name: 'ล้างบริบท', exact: true }).click();
  await send(panel);
  expect(posts[3].body.context).toEqual({});
});

for (const [name, stored] of [
  ['mixed business and brand', { business_id: 'residential', brand_id: 'BRAND-SYNTHETIC' }],
  ['mixed existing scopes', { project_id: 'PROJECT-SYNTHETIC', brand_id: 'BRAND-SYNTHETIC' }],
  ['uppercase business', { business_id: 'Residential' }],
  ['business trailing newline', { business_id: 'residential\n' }],
  ['non-string business', { business_id: 123 }],
  ['invalid visibility', { business_id: 'residential', visibility: 'all' }],
] as const) test(`stored ${name} is discarded before a request`, async ({ page }) => {
  const posts = await mocked(page, { stored }), panel = await open(page, true);
  await expect(panel.locator('.assistant-context-trigger')).toContainText('เลือกบริบท');
  await send(panel);
  expect(posts[0].body.context).toEqual({});
});

test('Knowledge view with search_content alone can select business context without proposal authority', async ({ page }) => {
  const posts = await mocked(page, { searchOnly: true }), panel = await open(page);
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/hub/v1/me');
  await page.evaluate(() => window.dispatchEvent(new Event('hub-accounts-changed')));
  expect((await (await refreshed).json()).data.capabilities.tabs).toEqual({ knowledge: { view: true } });
  const picker = await contextPicker(panel);
  await expect(picker.getByLabel('ประเภทบริบท').locator('option')).toHaveText([text.business]);
  await expect(picker.getByLabel('ประเภทบริบท')).toHaveValue('business_id');
  await picker.getByRole('button', { name: 'ปิดบริบท', exact: true }).click();
  await panel.getByRole('tab', { name: 'เสนอแก้ร่าง', exact: true }).click();
  await expect(panel.locator('.assistant-proposal')).toHaveCount(0);
  await panel.getByRole('tab', { name: 'แชท', exact: true }).click();
  await send(panel);
  expect(posts[0].body.context).toEqual({ business_id: 'residential' });
  expect(posts.every(post => post.path === '/assistant/runs')).toBe(true);
});

test('business choice is absent when search_content is not permitted', async ({ page }) => {
  await mocked(page, { noSearch: true });
  const picker = await contextPicker(await open(page));
  await expect(picker.getByLabel('ประเภทบริบท').locator('option[value="business_id"]')).toHaveCount(0);
});

test('search_content with Projects and Brands View cannot offer business without Knowledge View or change an explicit business scope', async ({ page }) => {
  const posts = await mocked(page, { noKnowledge: true, stored: { business_id: 'residential' } });
  await page.goto('/questions?assistant=open');
  const panel = panelFor(page);
  await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toBeFocused();
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/hub/v1/me');
  await page.evaluate(() => window.dispatchEvent(new Event('hub-accounts-changed')));
  expect((await (await refreshed).json()).data.capabilities.tabs).toEqual({
    projects: { view: true }, brands: { view: true }, knowledge: { view: false },
  });
  const picker = await contextPicker(panel);
  await expect(picker.getByLabel('ประเภทบริบท').locator('option[value="business_id"]')).toHaveCount(0);
  await expect(picker.getByLabel('ประเภทบริบท').locator('option[value="project_id"]')).toHaveCount(1);
  await expect(picker.getByLabel('ประเภทบริบท').locator('option[value="brand_id"]')).toHaveCount(1);
  await expect(picker.getByLabel('ประเภทบริบท')).toHaveValue('');
  await expect(picker.getByRole('button', { name: 'ใช้บริบทนี้', exact: true })).toBeDisabled();
  await picker.getByRole('button', { name: 'ปิดบริบท', exact: true }).click();
  await expect(panel.locator('.assistant-context-trigger')).toContainText(text.business + ': residential');
  expect(posts).toEqual([]);
  await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('SYNTHETIC QUESTION');
  await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('SYNTHETIC BUSINESS DENIED');
  expect(posts[0].body.context).toEqual({ business_id: 'residential' });
  await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveValue('SYNTHETIC QUESTION');
});
