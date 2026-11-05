import { mockWorkspaceProjection } from './unified-workspace-helpers';
import { expect, test, type Locator, type Page } from '@playwright/test';

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
  let citationDenied = false; let stale = false; let configGate: Promise<void> | null = null;
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
    if (path === '/config') { if (configGate) await configGate; return route.fulfill({ json: { data: config } }); }
    if (path.includes('/citations/')) return route.fulfill(citationDenied ? { status: 403, json: { error: { message: 'ไม่มีสิทธิ์เปิดแหล่งข้อมูลนี้แล้ว' } } } : { json: { data: { id: citation, source: { namespace: 'internal_content', entity_type: 'project', entity_id: entity, version: 'draft-v1' }, source_href: '/?project=PROJECT-DEMO', metadata } } });
    return route.fulfill({ status: 404, json: { error: { message: 'ไม่พบข้อมูลผู้ช่วย' } } });
  });
  return { posts, reads, config, setResponse: (value: string) => { response = value; }, denyCitation: () => { citationDenied = true; }, makeStale: () => { stale = true; }, holdConfig: () => { let release!: () => void; configGate = new Promise<void>(resolve => { release = resolve; }); return release; } };
}
async function open(page: Page) { await page.goto('/questions'); await page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'ผู้ช่วย Hub', exact: true }).getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toBeVisible(); return page.getByRole('dialog', { name: 'ผู้ช่วย Hub', exact: true }); }

async function fullyExposed(locator: Locator) {
  // Visibility alone allows a composer below the fold. Check viewport bounds,
  // clipping ancestors and hit testing without an action that scrolls it into view.
  await expect.poll(() => locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const inside = box.width > 0 && box.height > 0 && box.left >= -1 && box.top >= -1
      && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    let clipped = false;
    for (let parent = getComputedStyle(element).position === 'fixed' ? null : element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent); const rect = parent.getBoundingClientRect();
      const left = rect.left + parent.clientLeft; const top = rect.top + parent.clientTop;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (box.left < left - 2 || box.right > left + parent.clientWidth + 2)) clipped = true;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (box.top < top - 2 || box.bottom > top + parent.clientHeight + 2)) clipped = true;
      // A native modal escapes clipping by ancestors outside its top layer.
      if (parent.matches('dialog:modal, :popover-open')) break;
    }
    return { inside, unobscured: hit === element || !!hit && element.contains(hit), clipped };
  })).toEqual({ inside: true, unobscured: true, clipped: false });
}

test('assistant entry is staff-only and loads capabilities only when opened', async ({ page }) => {
  for (const role of ['editor', 'publisher', 'viewer', 'admin', 'online_staff']) {
    const data = await mocked(page, role); await page.goto('/questions'); await expect(page.locator('.sidebar').getByRole('button', { name: 'ผู้ช่วย Hub', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true })).toBeVisible(); expect(data.reads).toEqual([]);
    await page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true }).click(); await expect.poll(() => data.reads.includes('/config')).toBe(true); await page.getByRole('button', { name: 'ปิดผู้ช่วย', exact: true }).click(); await page.unrouteAll();
  }
  for (const role of ['agency_kin', 'agency_combay']) {
    await session(page, role); const reads: string[] = []; const capture = (request: { url: () => string }) => { if (request.url().includes('/assistant/')) reads.push(request.url()); }; page.on('request', capture);
    await page.goto('/ads/registry'); await expect(page.getByRole('button', { name: 'ผู้ช่วย Hub', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true })).toHaveCount(0); expect(reads).toEqual([]); page.off('request', capture);
    expect((await page.request.get(`${base}/config`)).status()).toBe(403); expect((await page.request.post(`${base}/runs`, { headers: { Origin: origin }, data: { mode: 'fake', message: 'สวัสดี' } })).status()).toBe(403);
  }
  await page.context().clearCookies(); await page.goto('/questions');
  await expect(page.getByRole('button', { name: 'ผู้ช่วย Hub', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true })).toHaveCount(0);
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`chat composer opens focused without scrolling at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await mocked(page); await page.goto('/questions');
    const floating = page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true });
    await fullyExposed(floating); await floating.click();
    const panel = page.getByRole('dialog', { name: 'ผู้ช่วย Hub', exact: true });
    const composer = panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง');
    await expect(composer).toBeFocused(); await fullyExposed(composer);
    await fullyExposed(panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }));
    await expect(panel).toHaveJSProperty('scrollTop', 0);
    await expect(panel.getByRole('tab', { name: 'แชท', exact: true })).toHaveAttribute('aria-selected', 'true');
    const about = panel.locator('details').filter({ has: page.getByText('เกี่ยวกับผู้ช่วยนี้', { exact: true }) });
    await expect(about).not.toHaveAttribute('open');
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press('Escape'); await expect(panel).not.toBeVisible(); await expect(floating).toBeFocused();
  });
}

test('delayed configuration still focuses the pinned composer when it becomes available', async ({ page }) => {
  const data = await mocked(page); const release = data.holdConfig();
  await page.goto('/questions'); await page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'ผู้ช่วย Hub', exact: true });
  await expect(panel).toContainText('กำลังตรวจการตั้งค่าผู้ช่วย');
  await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveCount(0);
  release(); const composer = panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง');
  await expect(composer).toBeFocused(); await fullyExposed(composer);
});

test('mobile editor entry uses reserved space and clears language and tab controls as Thai text grows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await mocked(page);
  const response = await page.request.get('/api/hub/v1/admin/projects'); expect(response.ok()).toBeTruthy();
  const project = (await response.json()).data.find((item: { source?: { rem_project_id?: string } }) => item.source?.rem_project_id === 'DEMO-001');
  expect(project, 'Existing synthetic project, no business edits').toBeDefined();
  let release!: () => void; const loaded = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/hub/v1/admin/projects/${project.public_project_id}`, async route => { await loaded; await route.continue(); });
  await page.goto(`/?project=${project.public_project_id}`);
  const floating = page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true });
  const bar = page.locator('.project-save-bar');
  await expect(bar).toHaveCount(0); await fullyExposed(floating);
  release(); await expect(bar).toBeVisible();
  await expect(page.locator('[data-project-assistant]')).toContainText('ถามผู้ช่วย');
  await expect(page.locator('.assistant-floating')).toHaveCount(0);
  await floating.scrollIntoViewIfNeeded(); await fullyExposed(floating);
  const clear = async () => floating.evaluate(button => {
    const a = button.getBoundingClientRect();
    return [...document.querySelectorAll('.language-chip,.project-tabs')].every(item => {
      const b = item.getBoundingClientRect();
      return a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
    });
  });
  expect(await clear()).toBeTruthy();
  await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; });
  await floating.scrollIntoViewIfNeeded(); expect(await clear()).toBeTruthy();
  await floating.click(); await expect(page.getByRole('dialog', { name: 'ผู้ช่วย Hub', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(floating).toBeFocused();

});

test('floating trigger reopens one conversation and receives focus after closing', async ({ page }) => {
  const data = await mocked(page); const panel = await open(page);
  const floating = page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true });
  const composer = panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง');
  await composer.fill('ข้อความที่ยังไม่ส่ง'); await page.keyboard.press('Escape'); await expect(floating).toBeFocused();
  await floating.click(); await expect(page.getByRole('dialog', { name: 'ผู้ช่วย Hub', exact: true })).toHaveCount(1);
  await expect(composer).toHaveValue('ข้อความที่ยังไม่ส่ง'); await expect(composer).toBeFocused();
  await composer.press('Enter'); await expect(panel.locator('.assistant-turn')).toHaveCount(1);
  await expect.poll(() => data.posts.length).toBe(1); await panel.getByRole('button', { name: 'ปิดผู้ช่วย', exact: true }).click();
  await expect(floating).toBeFocused(); await floating.click();
  await expect(panel.locator('.assistant-turn')).toHaveCount(1); await expect.poll(() => data.reads.filter(path => path === '/config').length).toBeGreaterThanOrEqual(3);
});

test('Enter sends once, Shift+Enter inserts a newline and suggestion chips only fill the composer', async ({ page }) => {
  const data = await mocked(page); const panel = await open(page); const composer = panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง');
  for (const label of ['โครงการนี้พร้อมเผยแพร่หรือยัง', 'งบโฆษณาของโครงการนี้เดือนนี้', 'อธิบายชื่อแคมเปญนี้', 'โครงการนี้มีโปรโมชันอะไร']) {
    await panel.getByRole('button', { name: label, exact: true }).click();
    await expect(composer).toHaveValue(label); await expect(composer).toBeFocused(); expect(data.posts).toEqual([]);
    await expect(panel.getByRole('button', { name: 'เปลี่ยนบริบทอย่างชัดเจน', exact: true })).toHaveAttribute('title', 'ยังไม่เลือกบริบท');
  }
  await composer.fill('บรรทัดแรก'); await composer.press('Shift+Enter'); await composer.pressSequentially('บรรทัดที่สอง');
  await expect(composer).toHaveValue('บรรทัดแรก\nบรรทัดที่สอง'); expect(data.posts).toEqual([]);
  await composer.press('Enter'); await expect.poll(() => data.posts.filter(item => item.path === '/runs').length).toBe(1);
  expect(data.posts[0].body.message).toBe('บรรทัดแรก\nบรรทัดที่สอง'); expect(data.posts[0].body.context).toEqual({}); await expect(composer).toHaveValue('');
});

test('about is collapsed and the draft tab preserves unsaved text separately from chat', async ({ page }) => {
  const data = await mocked(page); await page.goto('/questions?project=PROJECT-DEMO&assistant=open');
  const panel = page.getByRole('dialog', { name: 'ผู้ช่วย Hub', exact: true });
  const about = panel.locator('details').filter({ has: page.getByText('เกี่ยวกับผู้ช่วยนี้', { exact: true }) });
  await expect(about).not.toHaveAttribute('open'); await panel.getByText('เกี่ยวกับผู้ช่วยนี้', { exact: true }).click();
  await expect(about).toHaveAttribute('open', ''); await expect(about).toContainText('ไม่ได้เรียกโมเดลจริง');
  await panel.getByText('เกี่ยวกับผู้ช่วยนี้', { exact: true }).click();
  await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('คำถามที่ยังไม่ส่ง');
  await panel.getByRole('tab', { name: 'เสนอแก้ร่าง', exact: true }).click();
  await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).not.toBeVisible();
  await panel.getByRole('button', { name: 'โหลดข้อความฉบับร่างที่มีสิทธิ์แก้', exact: true }).click();
  await panel.getByLabel('ข้อความที่เสนอ', { exact: true }).fill('ข้อความร่างที่ยังไม่ยืนยัน');
  await panel.getByRole('tab', { name: 'แชท', exact: true }).click(); await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toBeVisible();
  await expect(panel.getByRole('tab', { name: 'แชท', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveValue('คำถามที่ยังไม่ส่ง');
  await panel.getByRole('tab', { name: 'เสนอแก้ร่าง', exact: true }).click();
  await expect(panel.getByLabel('ข้อความที่เสนอ', { exact: true })).toHaveValue('ข้อความร่างที่ยังไม่ยืนยัน');
  // A same-document history reopen starts in chat, retaining the mounted draft.
  await page.evaluate(() => { const url = new URL(location.href); url.searchParams.delete('assistant'); history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(panel).not.toBeVisible(); await page.goBack();
  await expect(panel.getByRole('tab', { name: 'แชท', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toBeFocused(); await fullyExposed(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง'));
  await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveValue('คำถามที่ยังไม่ส่ง');
  await panel.getByRole('tab', { name: 'เสนอแก้ร่าง', exact: true }).click();
  await expect(panel.getByLabel('ข้อความที่เสนอ', { exact: true })).toHaveValue('ข้อความร่างที่ยังไม่ยืนยัน'); expect(data.posts).toEqual([]);
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
  const data = await mocked(page); const panel = await open(page); await panel.getByRole('button', { name: 'เปลี่ยนบริบทอย่างชัดเจน', exact: true }).click(); await panel.getByLabel('รหัสบริบทตามต้นทาง').fill('PROJECT-DEMO'); await panel.getByRole('button', { name: 'ใช้บริบทนี้', exact: true }).click();
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

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`live permitted-question picker stays in the composer at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); const data = await mocked(page); data.config.live_available = true;
    data.config.live_questions.push({ id: 'second-approved-demo', label_th: 'คำถามสมมติที่ระบบอนุญาตข้อสอง' });
    const panel = await open(page); await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('ข้อความอิสระที่ห้ามส่งไปโมเดลจริง');
    await panel.getByLabel('วิธีตอบคำถาม').selectOption('live');
    const picker = panel.getByLabel('คำถามข้อมูลสมมติที่อนุญาต');
    await expect(picker).toBeFocused(); await fullyExposed(picker); await fullyExposed(panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }));
    await expect(panel).toHaveJSProperty('scrollTop', 0);
    await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveCount(0);
    await picker.selectOption('second-approved-demo'); await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click();
    await expect.poll(() => data.posts.length).toBe(1); expect(data.posts[0].body).toEqual({ mode: 'live', golden_id: 'second-approved-demo' });
  });
}

test('context popover Escape closes only the context editor and restores its trigger', async ({ page }) => {
  await mocked(page); const panel = await open(page);
  const context = panel.getByRole('button', { name: 'เปลี่ยนบริบทอย่างชัดเจน', exact: true }); await context.click();
  const editor = page.getByRole('dialog', { name: 'บริบทผู้ช่วย', exact: true });
  await expect(editor).toBeVisible(); await editor.getByLabel('รหัสบริบทตามต้นทาง').fill('UNSAVED-CONTEXT');
  await page.keyboard.press('Escape'); await expect(editor).not.toBeVisible(); await expect(panel).toBeVisible(); await expect(context).toBeFocused();
  await expect(panel.getByRole('button', { name: 'เปลี่ยนบริบทอย่างชัดเจน', exact: true })).toHaveAttribute('title', 'ยังไม่เลือกบริบท');
});

test('provider errors and no-answer states preserve the unsent text without inventing zero values', async ({ page }) => {
  const data = await mocked(page); data.setResponse(frame('status', { message_th: 'ตรวจข้อมูล' }) + frame('error', { code: 'unavailable', message_th: 'ยังไม่มีข้อมูลที่ยืนยันได้สำหรับคำถามนี้' })); const panel = await open(page);
  await expect(panel.getByLabel('วิธีตอบคำถาม').locator('option[value=live]')).toBeDisabled(); await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('เดางบให้หน่อย'); await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('ยังไม่มีข้อมูลที่ยืนยันได้'); await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveValue('เดางบให้หน่อย'); await expect(panel.locator('.assistant-answer')).toHaveCount(0);
  data.setResponse(frame('status', { message_th: 'ตรวจข้อมูล' }) + frame('done', { status: 'NO_ANSWER', provider: 'fake' })); await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click(); await expect(panel.locator('.assistant-turn')).toHaveCount(2); await expect(panel.locator('.assistant-turn').last()).toContainText('ยังไม่มีข้อมูลที่ยืนยันได้สำหรับคำถามนี้');
});

test('stopping a streaming answer cancels the run and retains the question', async ({ page }) => {
  const data = await mocked(page); await page.addInitScript(({ endpoint, first }) => { const original = window.fetch.bind(window); window.fetch = async (input, init) => { if (String(input) === `${endpoint}/runs`) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(first)); init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError'))); } }), { headers: { 'Content-Type': 'text/event-stream' } }); return original(input, init); }; }, { endpoint: base, first: frame('status', { message_th: 'กำลังค้นข้อมูล', mode: 'fake' }) });
  const panel = await open(page); await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('คำถามที่หยุดได้'); await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click(); await expect(panel.getByRole('button', { name: 'หยุดการตอบ', exact: true })).toBeVisible(); await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toBeDisabled(); await expect(panel.getByRole('button', { name: 'ส่งคำถาม', exact: true })).toBeDisabled(); await panel.getByRole('button', { name: 'หยุดการตอบ', exact: true }).click();
  await expect.poll(() => data.posts.some(item => item.path === `/runs/${run}/cancel`)).toBe(true); await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toHaveValue('คำถามที่หยุดได้'); await expect(panel).toContainText('หยุดการตอบแล้ว');
});

test('citation permissions are checked again before showing any source link', async ({ page }) => {
  const data = await mocked(page); data.denyCitation(); const panel = await open(page); await panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง').fill('ขอแหล่งข้อมูล'); await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click(); await panel.getByRole('button', { name: 'ข้อมูลโครงการฉบับร่าง', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('ไม่มีสิทธิ์เปิดแหล่งข้อมูลนี้แล้ว'); await expect(panel.getByRole('link', { name: 'เปิดต้นทางที่ตรวจสิทธิ์แล้ว', exact: true })).toHaveCount(0);
});

test('draft proposal shows the exact before/after and saves only on explicit confirmation', async ({ page }) => {
  const data = await mocked(page); await page.goto('/questions?project=PROJECT-DEMO&assistant=open'); const panel = page.getByRole('dialog'); await panel.getByRole('tab', { name: 'เสนอแก้ร่าง', exact: true }).click(); await panel.getByRole('button', { name: 'โหลดข้อความฉบับร่างที่มีสิทธิ์แก้', exact: true }).click();
  await panel.getByLabel('ข้อความที่เสนอ', { exact: true }).fill('ชื่อเรื่องใหม่ตัวอย่าง'); await panel.getByRole('button', { name: 'สร้างข้อเสนอเพื่อดูความแตกต่าง', exact: true }).click(); await expect(panel.locator('.assistant-diff')).toContainText('ชื่อเรื่องเดิมตัวอย่าง'); await expect(panel.locator('.assistant-diff')).toContainText('ชื่อเรื่องใหม่ตัวอย่าง'); expect(data.posts.map(item => item.path)).toEqual(['/proposals']);
  expect(data.posts[0].body).toMatchObject({ entity_id: entity, field_path: 'meta_title.th', expected_updated_at: '2026-10-01T03:00:00Z' }); await panel.getByRole('button', { name: 'ยืนยันบันทึกเป็นฉบับร่าง', exact: true }).click(); await expect(panel).toContainText('บันทึกฉบับร่างแล้ว'); expect(data.posts[1]).toEqual({ path: `/proposals/${proposalId}/confirm`, body: { digest: 'a'.repeat(64), confirmed: true } });
});

test('stale proposals cannot be confirmed again without refreshing the draft', async ({ page }) => {
  const data = await mocked(page); data.makeStale(); await page.goto('/questions?project=PROJECT-DEMO&assistant=open'); const panel = page.getByRole('dialog'); await panel.getByRole('tab', { name: 'เสนอแก้ร่าง', exact: true }).click(); await panel.getByRole('button', { name: 'โหลดข้อความฉบับร่างที่มีสิทธิ์แก้', exact: true }).click(); await panel.getByLabel('ข้อความที่เสนอ', { exact: true }).fill('ชื่อเรื่องใหม่ตัวอย่าง'); await panel.getByRole('button', { name: 'สร้างข้อเสนอเพื่อดูความแตกต่าง', exact: true }).click(); await panel.getByRole('button', { name: 'ยืนยันบันทึกเป็นฉบับร่าง', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('ฉบับร่างเปลี่ยนแล้ว'); await expect(panel.getByRole('button', { name: 'ยืนยันบันทึกเป็นฉบับร่าง', exact: true })).toBeDisabled(); await expect(panel.getByLabel('ข้อความที่เสนอ', { exact: true })).toHaveValue('ชื่อเรื่องใหม่ตัวอย่าง');
});

test('assistant-generated draft suggestions remain proposals until explicit diff confirmation', async ({ page }) => {
  const data = await mocked(page); await page.goto('/questions?project=PROJECT-DEMO&assistant=open'); const panel = page.getByRole('dialog'); await panel.getByRole('tab', { name: 'เสนอแก้ร่าง', exact: true }).click(); await panel.getByRole('button', { name: 'โหลดข้อความฉบับร่างที่มีสิทธิ์แก้', exact: true }).click(); await panel.getByRole('button', { name: 'ให้ผู้ช่วยเสนอข้อความ', exact: true }).click();
  await expect(panel.locator('.assistant-diff')).toContainText('ข้อเสนอจากผู้ช่วยจำลองในเครื่อง'); await expect(panel.locator('.assistant-diff')).toContainText('ชื่อเรื่องเดิมตัวอย่าง'); expect(data.posts).toEqual([{ path: '/proposals/suggest', body: { entity_type: 'project', entity_id: entity, field_path: 'meta_title.th', expected_updated_at: '2026-10-01T03:00:00Z' } }]);
  await expect(panel.getByRole('button', { name: 'ยืนยันบันทึกเป็นฉบับร่าง', exact: true })).toBeEnabled(); expect(data.posts.some(item => item.path.endsWith('/confirm'))).toBe(false);
});

test('assistant keyboard, mobile and reduced-motion behavior retain focus and readable controls', async ({ page }) => {
  await mocked(page, 'viewer'); await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%'; })); await page.goto('/questions'); const trigger = page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true });
  for (const state of ['normal', 'hover', 'focus']) {
    if (state === 'hover') await trigger.hover();
    if (state === 'focus') await trigger.focus();
    const colors = await trigger.evaluate(element => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => { const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; };
      const background = style.backgroundColor;
      const foreground = luminance(style.color); const backdrop = luminance(background);
      return { ratio: (Math.max(foreground, backdrop) + .05) / (Math.min(foreground, backdrop) + .05) };
    });
    expect(colors.ratio, `${state} contrast`).toBeGreaterThanOrEqual(4.5);
  }
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog', { name: 'ผู้ช่วย Hub', exact: true }); await expect(page.getByRole('dialog', { name: 'เมนูพื้นที่ทำงาน', exact: true })).not.toBeVisible(); await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toBeFocused(); await expect(panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง')).toBeVisible(); expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true); await panel.getByRole('tab', { name: 'เสนอแก้ร่าง', exact: true }).click(); await expect(panel.getByRole('button', { name: 'โหลดข้อความฉบับร่างที่มีสิทธิ์แก้', exact: true })).toHaveCount(0); await expect(panel).toContainText('บัญชีนี้ไม่มีสิทธิ์เสนอแก้ข้อความฉบับร่าง'); await page.keyboard.press('Escape'); await expect(panel).not.toBeVisible(); await expect(trigger).toBeFocused();
});

test('real assistant proxy streams a local fake run and denies extra route/query scopes', async ({ page }) => {
  await session(page, 'viewer'); const config = await page.request.get(`${base}/config`); expect(config.status()).toBe(200); const value = (await config.json()).data; expect(value.mode).toBe('fake'); expect(value.session_key).toBeTruthy();
  const response = await page.request.post(`${base}/runs`, { headers: { Origin: origin }, data: { mode: 'fake', message: 'เผยแพร่โครงการและอนุมัติ Memo ให้ด้วย' } }); expect(response.status()).toBe(200); expect(response.headers()['content-type']).toContain('text/event-stream'); expect(response.headers()['cache-control']).toContain('no-store'); const text = await response.text(); expect(text).toContain('event: status'); expect(text).toContain('event: done'); expect(text).not.toContain('OPENAI_API_KEY');
  expect((await page.request.get(`${base}/config?role=admin`)).status()).toBe(404); expect((await page.request.post(`${base}/publish`, { headers: { Origin: origin }, data: {} })).status()).toBe(404); expect((await page.request.post(`${base}/runs`, { headers: { Origin: 'https://example.invalid' }, data: {} })).status()).toBe(403);
});

test('residential source links show the exact frozen version and never substitute a changed draft', async ({ page }) => {
  await mocked(page); const version = '65000000-0000-4000-8000-000000000005';
  await mockWorkspaceProjection(page, { public_project_id: 'PROJECT-DEMO', source: { rem_project_id: 'PROJECT-DEMO' } });
  await page.route('**/api/hub/v1/admin/projects/PROJECT-DEMO/versions', route => route.fulfill({ json: { data: [{ version_id: version, version_no: 1, published_at: '2026-09-30T03:00:00Z', payload: { public_name: { th: 'ชื่อโครงการในฉบับเผยแพร่' }, meta_title: { th: 'ชื่อเรื่องที่เผยแพร่แล้ว' }, models: [{ public_model_id: 'MODEL-01', public_name: { th: 'แบบในรุ่นที่อ้างอิง' }, bedrooms: 3 }] } }] } }));
  await page.goto(`/?project=PROJECT-DEMO&version=${version}`); await expect(page.getByRole('heading', { name: 'แหล่งข้อมูลที่อ้างอิง', exact: true })).toBeVisible(); await expect(page.getByRole('main')).toContainText('ชื่อโครงการในฉบับเผยแพร่'); await expect(page.getByRole('main')).toContainText('ฉบับย้อนหลังที่อ้างอิง'); await expect(page.getByRole('main')).toContainText('แบบในรุ่นที่อ้างอิง'); await expect(page.getByRole('main').locator('input,textarea')).toHaveCount(0);
  await page.goto('/?project=PROJECT-DEMO&draft_at=2026-09-01T03%3A00%3A00Z'); await expect(page.getByRole('main').getByRole('alert')).toContainText('ฉบับร่างเปลี่ยนไปจากที่อ้างอิงแล้ว'); await expect(page.getByRole('main')).not.toContainText('ชื่อเรื่องเดิมตัวอย่าง');
  await page.goto('/?project=PROJECT-DEMO&draft_at=2026-10-01T03%3A00%3A00Z'); await expect(page.getByRole('main')).toContainText('ฉบับร่าง ณ เวลาที่อ้างอิง'); await expect(page.getByRole('main')).toContainText('ชื่อเรื่องเดิมตัวอย่าง');
  await page.goto(`/?project=PROJECT-DEMO&version=${proposalId}`); await expect(page.getByRole('main').getByRole('alert')).toContainText('ไม่พบรุ่นข้อมูลที่อ้างอิง'); await expect(page.getByRole('main')).not.toContainText('ชื่อเรื่องเดิมตัวอย่าง');
});
