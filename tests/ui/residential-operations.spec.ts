import { closeMobileMenu, openMobileMenu } from './hub-navigation-helpers';
import { expect, test, type Page } from '@playwright/test';
import { confirmPublication, confirmSourceCommand, mockReleaseQueue, mockWorkflowReads, preparePublication, refreshSyntheticAuthority, workflowText } from './content-workflow-fixtures';

const api = '/api/hub/v1/admin';
const origin = 'http://127.0.0.1:3000';
const projectId = '61000000-0000-4000-8000-000000000001';
const promotionId = '61000000-0000-4000-8000-000000000002';
const brandId = '61000000-0000-4000-8000-000000000003';
const versionId = '61000000-0000-4000-8000-000000000005';
type Row = Record<string, any>;

async function session(page: Page, role: string) {
  expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role } })).ok()).toBeTruthy();
}
async function fixture(page: Page, role = 'editor') {
  await session(page, role);
  let failNextSave = false;
  const posts: { path: string; method: string; body: Row }[] = [];
  const promotion: Row = { id: promotionId, project_id: projectId, public_project_id: 'SYNTH-HYABC', code: 'SYNTH-HYABC-OFFER', title: { th: 'โปรโมชันบ้านตัวอย่าง', en: 'Existing English title' }, summary: { th: 'รายละเอียดสังเคราะห์', en: 'Existing English summary' }, conditions_public: { th: 'เงื่อนไขสาธิต' }, legal_terms: { th: 'ข้อกฎหมายสาธิต' }, disclaimer: { th: 'ใช้สาธิตเท่านั้น' }, benefit_type: 'discount_amount', benefit_value: '12000.01', benefit_unit: 'THB', stackable: false, priority: 10, starts_at: '2026-10-01T00:01:12.123456+07:00', ends_at: '2026-12-31T23:59:34.654321+07:00', source_offer_key: '000001', draft_revision: 4, updated_at: '2026-10-01T03:00:00Z', published_version_id: null, demo_fields: ['title.th', 'legal_terms.th'], reviews: [{ review_type: 'DATA', review_revision: 4, decision: 'APPROVED', evidence: 'ข้อมูลสังเคราะห์รุ่นสี่', reviewed_at: '2026-10-01T02:00:00Z', reviewed_by: 'synthetic-publisher' }], readiness: { ready: false, missing: [{ field: 'LEGAL', message: 'ยังไม่มีผลตรวจข้อกฎหมายของร่างปัจจุบัน' }] }, published: null, versions: [] };
  const candidates: Row[] = [
    { entity_type: 'brand', entity_id: brandId, public_id: 'SYNTH-FLEXI', title: 'แบรนด์ตัวอย่าง', expected_updated_at: '2026-10-01T03:00:00.123456Z', expected_revision: null, expected_published_version_id: null, demo_fields: ['description.th'], readiness: { ready: true, missing: [] }, demo_excluded_asset_count: 2 },
    { entity_type: 'project', entity_id: projectId, public_id: 'SYNTH-HYABC', title: 'โครงการตัวอย่าง', expected_updated_at: '2026-10-01T04:00:00.123456Z', expected_revision: null, expected_published_version_id: null, demo_fields: ['address.th'], readiness: { ready: false, missing: [{ field: 'brand', message: 'แบรนด์ยังไม่เผยแพร่ จะตรวจอีกครั้งในชุดนี้' }] }, demo_excluded_asset_count: 3, demo_excluded_model_count: 4 },
    { entity_type: 'promotion', entity_id: promotionId, public_id: promotion.code, title: promotion.title, expected_updated_at: null, expected_revision: 4, expected_published_version_id: null, demo_fields: ['title.th'], readiness: { ready: false, missing: [{ field: 'project', message: 'โครงการยังไม่เผยแพร่' }] } },
  ];
  const releases: Row[] = [];
  await page.route(`**${api}/**`, async route => {
    const path = new URL(route.request().url()).pathname.slice(api.length + 1);
    if (path === 'projects') return route.fulfill({ json: { data: [{ id: projectId, public_project_id: 'SYNTH-HYABC', public_name: { th: 'โครงการตัวอย่าง' } }] } });
    if (!/^(promotions|releases)(\/|$)/.test(path)) return route.continue();
    const method = route.request().method();
    if (method !== 'GET') {
      const body = route.request().postDataJSON(); posts.push({ path, method, body });
      if (method === 'PATCH' || path === 'promotions') {
        if (failNextSave) { failNextSave = false; return route.fulfill({ status: 409, json: { error: { message: 'ร่างเปลี่ยนแล้ว กรุณาตรวจรุ่นปัจจุบันก่อนบันทึก' } } }); }
        Object.assign(promotion, body, { draft_revision: promotion.draft_revision + 1, readiness: { ready: false, missing: [{ field: 'review', message: 'ต้องตรวจข้อมูลและข้อกฎหมายของรุ่นใหม่' }] } });
        return route.fulfill({ json: { data: promotion } });
      }
      if (path.endsWith('/review')) {
        promotion.reviews.push({ review_type: body.review_type, review_revision: body.review_revision ?? body.expected_revision, decision: body.decision, evidence: body.evidence, reviewed_at: '2026-10-01T06:00:00Z', reviewed_by: 'synthetic-publisher' });
        promotion.readiness = { ready: true, missing: [] }; return route.fulfill({ json: { data: promotion } });
      }
      throw new Error(`Unexpected legacy mutation: ${method} ${path}`);
    }
    if (path === 'promotions') return route.fulfill({ json: { data: { items: [promotion], total: 1 } } });
    if (path.startsWith('promotions/')) return route.fulfill({ json: { data: promotion } });
    if (path === 'releases/candidates') return route.fulfill({ json: { data: { items: candidates } } });
    if (path === 'releases') return route.fulfill({ json: { data: { items: releases, total: releases.length } } });
    return route.fulfill({ json: { data: releases.find(row => row.id === path.split('/')[1]) } });
  });
  return { posts, promotion, candidates, failSave: () => { failNextSave = true; } };
}

test('residential workspaces deny online staff and agencies without fetching content', async ({ page }) => {
  for (const role of ['online_staff', 'agency_kin', 'agency_combay']) {
    await session(page, role); const requests: string[] = [];
    const capture = (request: { url: () => string }) => { if (/\/api\/hub\/v1\/admin\/(promotions|releases|publication-queue)(\/|\?|$)/.test(request.url())) requests.push(request.url()); };
    page.on('request', capture);
    for (const path of ['promotions', 'releases', 'publish']) { expect((await page.goto(`/${path}`))?.status()).toBe(403); await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงหน้านี้', exact: true })).toBeVisible(); await expect(page.getByRole('navigation', { name: 'งานเนื้อหาที่อยู่อาศัย' })).toHaveCount(0); }
    expect(requests).toEqual([]); page.off('request', capture);
    for (const path of ['promotions', 'releases', 'releases/candidates?demo_mode=true', 'publication-queue']) expect((await page.request.get(`${api}/${path}`)).status()).toBe(403);
  }
});

test('promotion draft retains other locales, exact timestamps, source IDs and money; edits invalidate reviews', async ({ page }) => {
  const { posts, promotion } = await fixture(page); const startsAt = promotion.starts_at; const endsAt = promotion.ends_at;
  await page.goto('/promotions');
  await openMobileMenu(page);
  await expect(page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('link', { name: 'โปรโมชั่น', exact: true })).toHaveAttribute('aria-current', 'page');
  await closeMobileMenu(page);
  const opener = page.getByRole('button', { name: 'โปรโมชันบ้านตัวอย่าง', exact: true }); await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('note', { name: 'ข้อมูลตัวอย่าง: ชื่อโปรโมชัน (ภาษาไทย) · ข้อกำหนดทางกฎหมาย (ภาษาไทย)' })).toBeVisible();
  await expect(dialog.getByLabel('เริ่มใช้สิทธิ์', { exact: true })).toHaveValue('2026-10-01T00:01');
  await dialog.getByLabel('ชื่อโปรโมชัน (ภาษาไทย)', { exact: true }).fill('เปลี่ยนชื่อไทยเท่านั้น');
  await dialog.getByRole('button', { name: 'บันทึกร่างโปรโมชัน' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body.title).toEqual({ th: 'เปลี่ยนชื่อไทยเท่านั้น', en: 'Existing English title' });
  expect(posts[0].body.summary.en).toBe('Existing English summary');
  expect(posts[0].body.starts_at).toBe(startsAt); expect(posts[0].body.ends_at).toBe(endsAt);
  expect(posts[0].body.benefit_value).toBe('12000.01'); expect(posts[0].body.source_offer_key).toBe('000001');
  expect(posts[0].body.expected_revision).toBe(4); expect(posts[0].body).not.toHaveProperty('code');
  await expect(dialog).toContainText('ต้องตรวจข้อมูลและข้อกฎหมายของรุ่นใหม่');
  await expect(dialog).toContainText('ไม่ใช่ผลตรวจของร่างปัจจุบัน');
  await expect(dialog.getByRole('button', { name: 'เผยแพร่โปรโมชันนี้', exact: true })).toHaveCount(0);
});

test('stale promotion save keeps edits and escape asks before discarding', async ({ page }) => {
  const fixtureData = await fixture(page); fixtureData.failSave();
  await page.goto(`/promotions?promotion=${promotionId}`); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('ชื่อโปรโมชัน (ภาษาไทย)', { exact: true }).fill('ร่างที่ยังต้องเก็บไว้');
  await dialog.getByRole('button', { name: 'บันทึกร่างโปรโมชัน' }).click();
  await expect(dialog.getByRole('alert')).toContainText('ร่างเปลี่ยนแล้ว');
  await expect(dialog.getByLabel('ชื่อโปรโมชัน (ภาษาไทย)', { exact: true })).toHaveValue('ร่างที่ยังต้องเก็บไว้');
  page.once('dialog', confirm => confirm.dismiss()); await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  page.once('dialog', confirm => confirm.accept()); await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
});

test('partial draft can be saved without claiming it is ready to publish', async ({ page }) => {
  const { posts } = await fixture(page);
  await page.goto(`/promotions?promotion=${promotionId}`); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('ข้อกำหนดทางกฎหมาย (ภาษาไทย)', { exact: true }).fill('');
  await dialog.getByRole('button', { name: 'บันทึกร่างโปรโมชัน' }).click();
  await expect.poll(() => posts.length).toBe(1); expect(posts[0].body.legal_terms.th).toBe('');
  await expect(dialog).toContainText('ยังไม่พร้อมเผยแพร่');
});

test('publisher review evidence remains recoverable when closing an unsaved form', async ({ page }) => {
  await fixture(page, 'publisher'); await page.goto(`/promotions?promotion=${promotionId}`); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('หลักฐานการตรวจ').fill('หลักฐานที่ยังไม่บันทึก');
  page.once('dialog', confirmation => confirmation.dismiss()); await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible(); await expect(dialog.getByLabel('หลักฐานการตรวจ')).toHaveValue('หลักฐานที่ยังไม่บันทึก');
  page.once('dialog', confirmation => confirmation.accept()); await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
});

test('promotion form focuses a Thai error summary and validates uppercase code and Bangkok window', async ({ page }) => {
  const { posts } = await fixture(page); await page.goto('/promotions'); await page.getByRole('button', { name: 'สร้างโปรโมชัน', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'บันทึกร่างโปรโมชัน' }).click();
  await expect(dialog.getByRole('alert')).toBeFocused(); await expect(dialog.getByRole('alert').getByRole('link', { name: 'ชื่อโปรโมชัน (ภาษาไทย)' })).toBeVisible();
  await dialog.getByLabel('โครงการ', { exact: true }).selectOption(projectId);
  await dialog.getByLabel('รหัสโปรโมชัน', { exact: true }).fill('lowercase');
  for (const label of ['ชื่อโปรโมชัน', 'รายละเอียดโดยย่อ', 'เงื่อนไขสำหรับลูกค้า', 'ข้อกำหนดทางกฎหมาย', 'ข้อความสงวนสิทธิ์']) await dialog.getByLabel(`${label} (ภาษาไทย)`, { exact: true }).fill('ข้อมูลตัวอย่าง');
  await dialog.getByLabel('เริ่มใช้สิทธิ์', { exact: true }).fill('2026-10-15T09:00'); await dialog.getByLabel('สิ้นสุดสิทธิ์ (ไม่รวมเวลานี้)', { exact: true }).fill('2026-10-14T09:00');
  await dialog.getByRole('button', { name: 'บันทึกร่างโปรโมชัน' }).click(); await expect(dialog.getByRole('alert')).toContainText('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น'); expect(posts).toHaveLength(0);
  await dialog.getByLabel('รหัสโปรโมชัน', { exact: true }).fill('NEW-SYNTH-OFFER'); await dialog.getByLabel('สิ้นสุดสิทธิ์ (ไม่รวมเวลานี้)', { exact: true }).fill('2026-10-16T09:00');
  await dialog.getByRole('button', { name: 'บันทึกร่างโปรโมชัน' }).click(); await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body.starts_at).toBe('2026-10-15T09:00:00+07:00'); expect(posts[0].body.ends_at).toBe('2026-10-16T09:00:00+07:00');
});

test('source reviewer records separate legal review and an independent publisher confirms the exact revision', async ({ page }) => {
  const { posts, promotion, candidates } = await fixture(page, 'publisher');
  promotion.starts_at = '2026-10-01T00:00:00+07:00'; promotion.ends_at = '2027-11-01T00:00:00+07:00';
  await page.goto(`/promotions?promotion=${promotionId}`); const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'บันทึกร่างโปรโมชัน', exact: true })).toHaveCount(0);
  await dialog.getByLabel('หัวข้อการตรวจ', { exact: true }).selectOption('LEGAL'); await dialog.getByLabel('หลักฐานการตรวจ').fill('หลักฐานข้อกฎหมายสังเคราะห์'); await dialog.getByLabel('เหตุผลการดำเนินการ').fill('สาธิตการตรวจรุ่นปัจจุบัน');
  await dialog.getByRole('button', { name: 'บันทึกผลการตรวจ', exact: true }).click(); await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body).toMatchObject({ expected_revision: 4, review_type: 'LEGAL', decision: 'APPROVED' });
  expect(promotion.reviews.map((row: Row) => [row.review_type, row.review_revision, row.decision])).toEqual([['DATA', 4, 'APPROVED'], ['LEGAL', 4, 'APPROVED']]);
  await expect(dialog.getByRole('button', { name: 'เผยแพร่โปรโมชันนี้', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: workflowText.queue, exact: true })).toHaveAttribute('href', `/publish?source=promotion&id=${promotionId}`);
  await session(page, 'viewer'); await mockWorkflowReads(page, { role: 'viewer', publish: true });
  const outgoing = { ...candidates[2], preview: { code: promotion.code, title: promotion.title, draft_revision: promotion.draft_revision, reviews: promotion.reviews } };
  const queue = await mockReleaseQueue(page, [outgoing]);
  await page.goto('/publish'); await refreshSyntheticAuthority(page);
  const review = await preparePublication(page, [{ system: 'release', entity_type: 'promotion', entity_id: promotionId }], 'สาธิตฉบับเผยแพร่ที่แยกจากร่าง');
  await expect(review.locator('[data-field="draft_revision"]')).toContainText('4');
  expect(queue.writes).toHaveLength(1); expect(posts).toHaveLength(1);
  await confirmPublication(page, review);
  expect(queue.writes[1].body).toEqual({ publication_id: queue.publicationId, expected_digest: queue.digest });
  expect(queue.releases[0].members).toEqual([{ entity_type: 'promotion', entity_id: promotionId, public_id: promotion.code, before_version_id: null, after_version_id: expect.any(String) }]);
});

test('expired published snapshot remains distinguishable from an edited draft and consumer eligibility', async ({ page }) => {
  const { promotion } = await fixture(page, 'viewer');
  promotion.published_version_id = versionId; promotion.publication_available = false;
  promotion.published = { id: versionId, version_no: 1, published_at: '2020-10-01T00:00:00+07:00', payload: { ...promotion, title: { th: 'ฉบับเก่าที่หมดอายุ' }, starts_at: '2020-10-01T00:00:00+07:00', ends_at: '2020-11-01T00:00:00+07:00', published: null } };
  await page.goto('/promotions'); await expect(page.locator('.registry-table')).toContainText('มีฉบับเผยแพร่ · งดแสดงขณะนี้');
  await page.getByRole('button', { name: 'โปรโมชันบ้านตัวอย่าง', exact: true }).click(); const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('หมดอายุแล้ว'); await expect(dialog).toContainText('ฉบับเก่าที่หมดอายุ');
  await expect(dialog).toContainText('โปรโมชันบ้านตัวอย่าง'); await expect(dialog).toContainText('มีฉบับเผยแพร่ · งดแสดงขณะนี้');
});

test('queue retains selection on preparation failure, rejects only a stale item, and rolls back the accepted set', async ({ page }) => {
  const data = await fixture(page, 'viewer');
  await mockWorkflowReads(page, { role: 'viewer', publish: true });
  const queue = await mockReleaseQueue(page, data.candidates); queue.failNextPrepare();
  await page.goto('/publish'); await refreshSyntheticAuthority(page);
  for (const item of data.candidates) await page.locator(`[data-publication-target="release:${item.entity_type}:${item.entity_id}"]`).getByRole('checkbox').check();
  const form = page.locator('.publication-workspace > form'), prepare = form.getByRole('button', { name: `${workflowText.prepare_review} (3)`, exact: true });
  const reason = 'ชุดสาธิตเดียวกันทั้งสามรายการ';
  await expect(prepare).toBeDisabled(); await form.getByRole('textbox', { name: workflowText.reason, exact: true }).fill(reason); await prepare.click();
  await expect(page.locator('.publication-workspace > [role="alert"]')).toContainText(workflowText.stale_item);
  for (const item of data.candidates) await expect(page.locator(`[data-publication-target="release:${item.entity_type}:${item.entity_id}"]`).getByRole('checkbox')).toBeChecked();
  await expect(form.getByRole('textbox', { name: workflowText.reason, exact: true })).toHaveValue(reason);
  expect(queue.releases).toEqual([]);
  await prepare.click();
  const review = page.getByRole('region', { name: workflowText.review_publication, exact: true });
  await expect(review.locator('.publication-reviewed-page')).toHaveCount(3);
  expect(queue.writes).toHaveLength(2);
  for (const call of queue.writes) expect(call).toEqual({ path: 'publication-queue/prepare', body: { selections: data.candidates.map(({ entity_type, entity_id }) => ({ system: 'release', entity_type, entity_id })), reason } });
  queue.rejectStale(projectId); await confirmPublication(page, review);
  await expect(review).toContainText(workflowText.stale_item);
  await expect(review).toContainText(workflowText.partial_publication);
  expect(queue.writes[2]).toEqual({ path: 'publication-queue/publish', body: { publication_id: queue.publicationId, expected_digest: queue.digest } });
  expect(queue.releases[0].members.map((row: Row) => row.entity_id)).toEqual([brandId, promotionId]);
  await page.getByRole('button', { name: `${workflowText.detail} · ${reason}`, exact: true }).last().click();
  const history = page.locator('.publication-history-panel').filter({ has: page.getByRole('heading', { name: `${workflowText.release_history} · ${reason}`, exact: true }) });
  await expect(history).toContainText('SYNTH-FLEXI'); await expect(history).toContainText('SYNTH-HYABC-OFFER');
  await expect(history.locator('.publication-history > li')).toHaveCount(2);
  await confirmSourceCommand(page, history.getByRole('button', { name: workflowText.rollback_release, exact: true }), 'คืนค่าหลังสาธิต');
  expect(queue.writes[3]).toEqual({ path: `releases/${queue.releaseId}/rollback`, body: { change_reason: 'คืนค่าหลังสาธิต' } });
  await expect(history).toContainText(workflowText.rolled_back);
  expect(data.posts).toEqual([]);
});

test('viewer sees residential drafts without write controls; mobile reduced-motion detail returns focus', async ({ page }) => {
  await fixture(page, 'viewer'); await page.setViewportSize({ width: 375, height: 812 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/promotions'); await expect(page.getByRole('button', { name: 'สร้างโปรโมชัน', exact: true })).toHaveCount(0);
  const opener = page.getByRole('button', { name: 'โปรโมชันบ้านตัวอย่าง', exact: true }); await opener.focus(); await page.keyboard.press('Enter'); const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'โปรโมชันบ้านตัวอย่าง', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(await dialog.locator('.registry-card').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'บันทึกร่างโปรโมชัน', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(opener).toBeFocused(); await expect(page).not.toHaveURL(/promotion=/);
  await page.goto('/publish'); await expect(page.getByRole('button', { name: workflowText.publish, exact: true })).toHaveCount(0);
  await expect(page.locator('.publication-workspace > form')).toHaveCount(0);
});

test('residential proxy enforces methods, bounded queries and publisher-only mutations', async ({ page }) => {
  await session(page, 'viewer');
  for (const path of ['promotions?limit=101', 'promotions?project_id=not-a-uuid', 'promotions?limit=5&limit=6', 'releases/candidates?demo_mode=yes', 'releases?status=PUBLISHED']) expect((await page.request.get(`${api}/${path}`)).status()).toBe(404);
  expect((await page.request.post(`${api}/promotions`, { headers: { Origin: origin }, data: {} })).status()).toBe(403);
  for (const role of ['editor', 'admin']) { await session(page, role); expect((await page.request.post(`${api}/releases/publish`, { headers: { Origin: origin }, data: {} })).status()).toBe(403); expect((await page.request.post(`${api}/promotions/${promotionId}/review`, { headers: { Origin: origin }, data: {} })).status()).toBe(403); }
  for (const role of ['editor', 'publisher', 'admin', 'viewer']) { await session(page, role); for (const command of ['prepare', 'publish']) expect((await page.request.post(`${api}/publication-queue/${command}`, { headers: { Origin: origin }, data: {} })).status()).toBe(403); }
});
