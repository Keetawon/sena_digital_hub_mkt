import { expect, test, type Page } from '@playwright/test';

const base = '/api/hub/v1/admin/assistant';
const origin = 'http://127.0.0.1:3000';
const run = '65000000-0000-4000-8000-000000000001';
const citation = '65000000-0000-4000-8000-000000000002';
const proposalId = '65000000-0000-4000-8000-000000000003';
const entity = '65000000-0000-4000-8000-000000000004';
const frame = (event: string, data: Record<string, unknown>) => `event: ${event}\ndata: ${JSON.stringify({ run_id: run, ...data })}\n\n`;
const metadata = { visibility: 'draft', version: 'draft-v1', environment: 'local-test', synthetic: true, as_of: '2026-10-01T03:00:00Z', freshness: { status: 'STALE', source_snapshot_at: '2026-09-29T03:00:00Z' } };

async function session(page: Page, role = 'editor') { expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role } })).ok()).toBeTruthy(); }
async function mocked(page: Page, role = 'editor') {
  await session(page, role); const posts: { path: string; body: Record<string, any> }[] = []; const reads: string[] = [];
  const config = { session_key: `mock-${role}`, mode: 'fake', live_available: false, allowed_tools: ['get_project', 'get_brand', 'get_campaign', 'get_line_actuals', 'get_project_marketing'], message_th: 'ยังไม่ได้ตั้งค่าโมเดลจริง ใช้ข้อมูลสาธิต', live_questions: [{ id: 'project-demo', label_th: 'โครงการสมมติมีแบบบ้านอะไรบ้าง' }], proposal_fields: role === 'editor' || role === 'admin' ? { project: ['meta_title.th', 'meta_description.th'], brand: ['description.th'] } : role === 'publisher' ? { project: ['meta_title.th', 'meta_description.th'] } : {} };
  let response = frame('status', { state: 'RUNNING', message_th: 'กำลังตรวจข้อมูลโครงการ', mode: 'fake' }) + frame('tool_start', { tool_name: 'get_project', label_th: 'ตรวจข้อมูลโครงการตามสิทธิ์' }) + frame('tool_end', { tool_name: 'get_project', label_th: 'ตรวจข้อมูลโครงการแล้ว' }) + frame('answer_delta', { block_id: 'block-1', text: 'แบบบ้านตัวอย่างมี 3 ห้องนอน ตามข้อมูลฉบับร่าง', metadata, citation_ids: [citation] }) + frame('citation', { id: citation, label_th: 'ข้อมูลโครงการฉบับร่าง', href: `${base}/runs/${run}/citations/${citation}` }) + frame('done', { status: 'COMPLETED', provider: 'fake', usage: {} });
  let citationDenied = false; let stale = false;
  const proposal = { id: proposalId, entity_type: 'project', entity_id: entity, field_path: 'meta_title.th', old_text: 'ชื่อเรื่องเดิมตัวอย่าง', new_text: 'ชื่อเรื่องใหม่ตัวอย่าง', expected_updated_at: '2026-10-01T03:00:00Z', status: 'PROPOSED', digest: 'a'.repeat(64) };
  await page.route('**/api/hub/v1/admin/projects/PROJECT-DEMO', route => route.fulfill({ json: { data: { id: entity, public_project_id: 'PROJECT-DEMO', updated_at: '2026-10-01T03:00:00Z', meta_title: { th: 'ชื่อเรื่องเดิมตัวอย่าง', en: 'Original English' }, meta_description: { th: 'คำอธิบายเดิม' }, demo_fields: ['meta_title.th', 'meta_description.th'] } } }));
  await page.route('**/api/hub/v1/admin/assistant/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname.slice(base.length);
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); posts.push({ path, body });
      if (path === '/runs') return route.fulfill({ contentType: 'text/event-stream', body: response });
      if (path.endsWith('/cancel')) return route.fulfill({ json: { data: { cancelled: true } } });
      if (path === '/proposals') return route.fulfill({ json: { data: { ...proposal, new_text: body.new_text } } });
      if (path === '/proposals/suggest') return route.fulfill({ json: { data: { ...proposal, new_text: 'ข้อเสนอจากผู้ช่วยจำลองในเครื่อง' } } });
      if (path.endsWith('/confirm')) return route.fulfill(stale ? { status: 409, json: { error: { message: 'ฉบับร่างเปลี่ยนแล้ว กรุณาทบทวนข้อมูลล่าสุด' } } } : { json: { data: { proposal: { ...proposal, status: 'APPLIED' }, receipt: {}, replayed: false } } });
    }
    reads.push(path);
    if (path === '/config') return route.fulfill({ json: { data: config } });
    if (path.includes('/citations/')) return route.fulfill(citationDenied ? { status: 403, json: { error: { message: 'ไม่มีสิทธิ์เปิดแหล่งข้อมูลนี้แล้ว' } } } : { json: { data: { id: citation, source: { namespace: 'internal_content', entity_type: 'project', entity_id: entity, version: 'draft-v1' }, source_href: '/?project=PROJECT-DEMO', metadata } } });
    return route.fulfill({ status: 404, json: { error: { message: 'ไม่พบข้อมูลผู้ช่วย' } } });
  });
  return { posts, reads, config, setResponse: (value: string) => { response = value; }, denyCitation: () => { citationDenied = true; }, makeStale: () => { stale = true; } };
}
async function open(page: Page) { await page.goto('/questions'); await page.getByRole('button', { name: 'ผู้ช่วย Hub', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'ผู้ช่วย Hub', exact: true }).getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toBeVisible(); return page.getByRole('dialog', { name: 'ผู้ช่วย Hub', exact: true }); }

test('assistant entry is staff-only and loads capabilities only when opened', async ({ page }) => {
  for (const role of ['editor', 'publisher', 'viewer', 'admin', 'online_staff']) {
    const data = await mocked(page, role); await page.goto('/questions'); await expect(page.getByRole('button', { name: 'ผู้ช่วย Hub', exact: true })).toBeVisible(); expect(data.reads).toEqual([]);
    await page.getByRole('button', { name: 'ผู้ช่วย Hub', exact: true }).click(); await expect.poll(() => data.reads.includes('/config')).toBe(true); await page.getByRole('button', { name: 'ปิดผู้ช่วย', exact: true }).click(); await page.unrouteAll();
  }
  for (const role of ['agency_kin', 'agency_combay']) {
    await session(page, role); const reads: string[] = []; const capture = (request: { url: () => string }) => { if (request.url().includes('/assistant/')) reads.push(request.url()); }; page.on('request', capture);
    await page.goto('/ads/registry'); await expect(page.getByRole('button', { name: 'ผู้ช่วย Hub', exact: true })).toHaveCount(0); expect(reads).toEqual([]); page.off('request', capture);
    expect((await page.request.get(`${base}/config`)).status()).toBe(403); expect((await page.request.post(`${base}/runs`, { headers: { Origin: origin }, data: { mode: 'fake', message: 'สวัสดี' } })).status()).toBe(403);
  }
});

test('validated answer blocks show draft, synthetic, freshness and reauthorized citations', async ({ page }) => {
  const data = await mocked(page); const panel = await open(page);
  await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('โครงการนี้มีแบบบ้านกี่ห้องนอน'); await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click();
  await expect(panel.locator('.assistant-answer')).toHaveText('แบบบ้านตัวอย่างมี 3 ห้องนอน ตามข้อมูลฉบับร่าง'); await expect(panel).toContainText('โหมดจำลองในเครื่อง'); await expect(panel).toContainText('ฉบับร่าง · รุ่น draft-v1'); await expect(panel).toContainText('ข้อมูลตัวอย่าง'); await expect(panel).toContainText('ข้อมูลยังไม่เป็นปัจจุบัน');
  expect(data.reads.some(path => path.includes('/citations/'))).toBe(false); await panel.getByRole('button', { name: 'ข้อมูลโครงการฉบับร่าง', exact: true }).click();
  await expect(panel.getByRole('link', { name: 'เปิดต้นทางที่ตรวจสิทธิ์แล้ว', exact: true })).toHaveAttribute('href', '/?project=PROJECT-DEMO'); expect(data.posts.map(item => item.path)).toEqual(['/runs']);
  await expect(panel).not.toContainText('tool_name'); await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveValue('');
  data.setResponse(frame('answer_delta', { block_id: 'mixed', text: 'ข้อมูลโครงการเดิมและข้อความตัวอย่าง', metadata: { ...metadata, synthetic: false, contains_synthetic: true }, citation_ids: [] }) + frame('done', { status: 'COMPLETED', provider: 'fake' }));
  await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('ตรวจข้อมูลที่มีตัวอย่างบางส่วน'); await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click();
  await expect(panel.locator('.assistant-turn').last().locator('.assistant-answer-block .assistant-meta')).toContainText('มีข้อมูลตัวอย่างบางส่วน');
  await expect(panel.locator('.assistant-turn').last().locator('.assistant-answer-block .assistant-meta')).not.toContainText(' · ข้อมูลตัวอย่าง · ');
});

test('chosen project context survives page changes until explicitly changed and is isolated by caller', async ({ page }) => {
  const data = await mocked(page); const panel = await open(page); await panel.getByText('เปลี่ยนบริบทอย่างชัดเจน', { exact: true }).click(); await panel.getByLabel('รหัสบริบทตามต้นทาง').fill('PROJECT-DEMO'); await panel.getByRole('button', { name: 'ใช้บริบทนี้', exact: true }).click();
  await page.goto('/questions?project=ANOTHER&assistant=open'); await expect(page.getByRole('dialog')).toContainText('โครงการ: PROJECT-DEMO');
  await page.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('ตรวจแบบบ้าน'); await page.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click(); await expect.poll(() => data.posts.length).toBe(1); expect(data.posts[0].body.context.project_id).toBe('PROJECT-DEMO');
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('hub-assistant-context:')).map(key => sessionStorage.getItem(key)).join(''))).not.toContain('ตรวจแบบบ้าน');
  await page.unrouteAll(); await mocked(page, 'viewer'); await page.goto('/questions?assistant=open'); await expect(page.getByRole('dialog')).toContainText('ยังไม่เลือกบริบท');
});

test('live mode sends only a server-owned golden question and never typed text or retained context', async ({ page }) => {
  const data = await mocked(page); data.config.live_available = true; data.config.message_th = 'พร้อมทดสอบด้วยคำถามสมมติที่กำหนด'; const panel = await open(page);
  await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('ข้อความที่ต้องอยู่ในเครื่องเท่านั้น'); await panel.getByLabel('วิธีตอบคำถาม').selectOption('live'); await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveCount(0); await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click();
  await expect.poll(() => data.posts.length).toBe(1); expect(data.posts[0].body).toEqual({ mode: 'live', golden_id: 'project-demo' });
});

test('provider errors and no-answer states preserve the unsent text without inventing zero values', async ({ page }) => {
  const data = await mocked(page); data.setResponse(frame('status', { message_th: 'ตรวจข้อมูล' }) + frame('error', { code: 'unavailable', message_th: 'ยังไม่มีข้อมูลที่ยืนยันได้สำหรับคำถามนี้' })); const panel = await open(page);
  await expect(panel.getByLabel('วิธีตอบคำถาม').locator('option[value=live]')).toBeDisabled(); await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('เดางบให้หน่อย'); await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('ยังไม่มีข้อมูลที่ยืนยันได้'); await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveValue('เดางบให้หน่อย'); await expect(panel.locator('.assistant-answer')).toHaveCount(0);
  data.setResponse(frame('status', { message_th: 'ตรวจข้อมูล' }) + frame('done', { status: 'NO_ANSWER', provider: 'fake' })); await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click(); await expect(panel.locator('.assistant-turn')).toHaveCount(2); await expect(panel.locator('.assistant-turn').last()).toContainText('ยังไม่มีข้อมูลที่ยืนยันได้สำหรับคำถามนี้');
});

test('stopping a streaming answer cancels the run and retains the question', async ({ page }) => {
  const data = await mocked(page); await page.addInitScript(({ endpoint, first }) => { const original = window.fetch.bind(window); window.fetch = async (input, init) => { if (String(input) === `${endpoint}/runs`) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(first)); init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError'))); } }), { headers: { 'Content-Type': 'text/event-stream' } }); return original(input, init); }; }, { endpoint: base, first: frame('status', { message_th: 'กำลังค้นข้อมูล', mode: 'fake' }) });
  const panel = await open(page); await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('คำถามที่หยุดได้'); await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click(); await expect(panel.getByRole('button', { name: 'หยุดการตอบ', exact: true })).toBeVisible(); await panel.getByRole('button', { name: 'หยุดการตอบ', exact: true }).click();
  await expect.poll(() => data.posts.some(item => item.path === `/runs/${run}/cancel`)).toBe(true); await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveValue('คำถามที่หยุดได้'); await expect(panel).toContainText('หยุดการตอบแล้ว');
});

test('citation permissions are checked again before showing any source link', async ({ page }) => {
  const data = await mocked(page); data.denyCitation(); const panel = await open(page); await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('ขอแหล่งข้อมูล'); await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click(); await panel.getByRole('button', { name: 'ข้อมูลโครงการฉบับร่าง', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('ไม่มีสิทธิ์เปิดแหล่งข้อมูลนี้แล้ว'); await expect(panel.getByRole('link', { name: 'เปิดต้นทางที่ตรวจสิทธิ์แล้ว', exact: true })).toHaveCount(0);
});

test('draft proposal shows the exact before/after and saves only on explicit confirmation', async ({ page }) => {
  const data = await mocked(page); await page.goto('/questions?project=PROJECT-DEMO&assistant=open'); const panel = page.getByRole('dialog'); await panel.getByText('เสนอแก้ข้อความฉบับร่าง', { exact: true }).click(); await panel.getByRole('button', { name: 'โหลดข้อความฉบับร่างที่มีสิทธิ์แก้', exact: true }).click();
  await panel.getByLabel('ข้อความที่เสนอ', { exact: true }).fill('ชื่อเรื่องใหม่ตัวอย่าง'); await panel.getByRole('button', { name: 'สร้างข้อเสนอเพื่อดูความแตกต่าง', exact: true }).click(); await expect(panel.locator('.assistant-diff')).toContainText('ชื่อเรื่องเดิมตัวอย่าง'); await expect(panel.locator('.assistant-diff')).toContainText('ชื่อเรื่องใหม่ตัวอย่าง'); expect(data.posts.map(item => item.path)).toEqual(['/proposals']);
  expect(data.posts[0].body).toMatchObject({ entity_id: entity, field_path: 'meta_title.th', expected_updated_at: '2026-10-01T03:00:00Z' }); await panel.getByRole('button', { name: 'ยืนยันบันทึกเป็นฉบับร่าง', exact: true }).click(); await expect(panel).toContainText('บันทึกฉบับร่างแล้ว'); expect(data.posts[1]).toEqual({ path: `/proposals/${proposalId}/confirm`, body: { digest: 'a'.repeat(64), confirmed: true } });
});

test('stale proposals cannot be confirmed again without refreshing the draft', async ({ page }) => {
  const data = await mocked(page); data.makeStale(); await page.goto('/questions?project=PROJECT-DEMO&assistant=open'); const panel = page.getByRole('dialog'); await panel.getByText('เสนอแก้ข้อความฉบับร่าง', { exact: true }).click(); await panel.getByRole('button', { name: 'โหลดข้อความฉบับร่างที่มีสิทธิ์แก้', exact: true }).click(); await panel.getByLabel('ข้อความที่เสนอ', { exact: true }).fill('ชื่อเรื่องใหม่ตัวอย่าง'); await panel.getByRole('button', { name: 'สร้างข้อเสนอเพื่อดูความแตกต่าง', exact: true }).click(); await panel.getByRole('button', { name: 'ยืนยันบันทึกเป็นฉบับร่าง', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('ฉบับร่างเปลี่ยนแล้ว'); await expect(panel.getByRole('button', { name: 'ยืนยันบันทึกเป็นฉบับร่าง', exact: true })).toBeDisabled(); await expect(panel.getByLabel('ข้อความที่เสนอ', { exact: true })).toHaveValue('ชื่อเรื่องใหม่ตัวอย่าง');
});

test('assistant-generated draft suggestions remain proposals until explicit diff confirmation', async ({ page }) => {
  const data = await mocked(page); await page.goto('/questions?project=PROJECT-DEMO&assistant=open'); const panel = page.getByRole('dialog'); await panel.getByText('เสนอแก้ข้อความฉบับร่าง', { exact: true }).click(); await panel.getByRole('button', { name: 'โหลดข้อความฉบับร่างที่มีสิทธิ์แก้', exact: true }).click(); await panel.getByRole('button', { name: 'ให้ผู้ช่วยเสนอข้อความ', exact: true }).click();
  await expect(panel.locator('.assistant-diff')).toContainText('ข้อเสนอจากผู้ช่วยจำลองในเครื่อง'); await expect(panel.locator('.assistant-diff')).toContainText('ชื่อเรื่องเดิมตัวอย่าง'); expect(data.posts).toEqual([{ path: '/proposals/suggest', body: { entity_type: 'project', entity_id: entity, field_path: 'meta_title.th', expected_updated_at: '2026-10-01T03:00:00Z' } }]);
  await expect(panel.getByRole('button', { name: 'ยืนยันบันทึกเป็นฉบับร่าง', exact: true })).toBeEnabled(); expect(data.posts.some(item => item.path.endsWith('/confirm'))).toBe(false);
});

test('assistant keyboard, mobile and reduced-motion behavior retain focus and readable controls', async ({ page }) => {
  await mocked(page, 'viewer'); await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%'; })); await page.goto('/questions'); const trigger = page.getByRole('button', { name: 'ผู้ช่วย Hub', exact: true });
  for (const state of ['normal', 'hover', 'focus']) {
    if (state === 'hover') await trigger.hover();
    if (state === 'focus') await trigger.focus();
    const colors = await trigger.evaluate(element => {
      const style = getComputedStyle(element); const sidebar = getComputedStyle(element.closest('.sidebar')!);
      const luminance = (color: string) => { const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; };
      const background = style.backgroundColor === 'rgba(0, 0, 0, 0)' ? sidebar.backgroundColor : style.backgroundColor;
      const foreground = luminance(style.color); const backdrop = luminance(background);
      return { color: style.color, expected: sidebar.color, ratio: (Math.max(foreground, backdrop) + .05) / (Math.min(foreground, backdrop) + .05) };
    });
    expect(colors.color).toBe(colors.expected); expect(colors.ratio, `${state} contrast`).toBeGreaterThanOrEqual(4.5);
  }
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog'); await expect(panel.getByRole('heading', { name: 'ผู้ช่วย Hub', exact: true })).toBeFocused(); await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toBeVisible(); expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true); await expect(panel.getByText('เสนอแก้ข้อความฉบับร่าง', { exact: true })).toHaveCount(0); await page.keyboard.press('Escape'); await expect(panel).not.toBeVisible(); await expect(trigger).toBeFocused();
});

test('real assistant proxy streams a local fake run and denies extra route/query scopes', async ({ page }) => {
  await session(page, 'viewer'); const config = await page.request.get(`${base}/config`); expect(config.status()).toBe(200); const value = (await config.json()).data; expect(value.mode).toBe('fake'); expect(value.session_key).toBeTruthy();
  const response = await page.request.post(`${base}/runs`, { headers: { Origin: origin }, data: { mode: 'fake', message: 'เผยแพร่โครงการและอนุมัติ Memo ให้ด้วย' } }); expect(response.status()).toBe(200); expect(response.headers()['content-type']).toContain('text/event-stream'); expect(response.headers()['cache-control']).toContain('no-store'); const text = await response.text(); expect(text).toContain('event: status'); expect(text).toContain('event: done'); expect(text).not.toContain('OPENAI_API_KEY');
  expect((await page.request.get(`${base}/config?role=admin`)).status()).toBe(404); expect((await page.request.post(`${base}/publish`, { headers: { Origin: origin }, data: {} })).status()).toBe(404); expect((await page.request.post(`${base}/runs`, { headers: { Origin: 'https://example.invalid' }, data: {} })).status()).toBe(403);
});

test('residential source links show the exact frozen version and never substitute a changed draft', async ({ page }) => {
  await mocked(page); const version = '65000000-0000-4000-8000-000000000005';
  await page.route('**/api/hub/v1/admin/projects/PROJECT-DEMO/versions', route => route.fulfill({ json: { data: [{ version_id: version, version_no: 1, published_at: '2026-09-30T03:00:00Z', payload: { public_name: { th: 'ชื่อโครงการในฉบับเผยแพร่' }, meta_title: { th: 'ชื่อเรื่องที่เผยแพร่แล้ว' }, models: [{ public_model_id: 'MODEL-01', public_name: { th: 'แบบในรุ่นที่อ้างอิง' }, bedrooms: 3 }] } }] } }));
  await page.goto(`/?project=PROJECT-DEMO&version=${version}`); await expect(page.getByRole('heading', { name: 'แหล่งข้อมูลที่อ้างอิง', exact: true })).toBeVisible(); await expect(page.getByRole('main')).toContainText('ชื่อโครงการในฉบับเผยแพร่'); await expect(page.getByRole('main')).toContainText('ฉบับย้อนหลังที่อ้างอิง'); await expect(page.getByRole('main')).toContainText('แบบในรุ่นที่อ้างอิง'); await expect(page.getByRole('main').locator('input,textarea')).toHaveCount(0);
  await page.goto('/?project=PROJECT-DEMO&draft_at=2026-09-01T03%3A00%3A00Z'); await expect(page.getByRole('main').getByRole('alert')).toContainText('ฉบับร่างเปลี่ยนไปจากที่อ้างอิงแล้ว'); await expect(page.getByRole('main')).not.toContainText('ชื่อเรื่องเดิมตัวอย่าง');
  await page.goto('/?project=PROJECT-DEMO&draft_at=2026-10-01T03%3A00%3A00Z'); await expect(page.getByRole('main')).toContainText('ฉบับร่าง ณ เวลาที่อ้างอิง'); await expect(page.getByRole('main')).toContainText('ชื่อเรื่องเดิมตัวอย่าง');
  await page.goto(`/?project=PROJECT-DEMO&version=${proposalId}`); await expect(page.getByRole('main').getByRole('alert')).toContainText('ไม่พบรุ่นข้อมูลที่อ้างอิง'); await expect(page.getByRole('main')).not.toContainText('ชื่อเรื่องเดิมตัวอย่าง');
});
