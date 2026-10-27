import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const headers = { Origin: 'http://127.0.0.1:3000' }, base = '/api/hub/v1/admin';
async function persona(page: Page, role: string) { expect((await page.request.post('/api/local-session', { headers, data: { role } })).ok()).toBeTruthy(); }
async function read(page: Page, route: string) { const response = await page.request.get(route); expect(response.ok(), route).toBeTruthy(); return (await response.json()).data; }
async function operator() {
  const directory = await realpath(process.env.HUB_DISPOSABLE_TEST_RUN!);
  expect(directory.startsWith(await realpath('.local/test-runs') + path.sep)).toBe(true);
  const marker = JSON.parse(await readFile(path.join(directory, 'run.json'), 'utf8'));
  const config = JSON.parse(await readFile('.local/development.json', 'utf8'));
  const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: config.adminPassword });
  await db.connect();
  expect(await realpath((await db.query('show data_directory')).rows[0].data_directory)).toBe(await realpath(path.join(directory, 'postgres')));
  expect((await db.query('select run_id from public.disposable_test_run')).rows[0].run_id).toBe(marker.run_id);
  return db;
}
async function article(page: Page) {
  await persona(page, 'editor');
  const slug = `synthetic-web-${randomUUID()}`;
  const response = await page.request.post(`${base}/articles`, { headers, data: { slug, category: 'design', title: { th: 'บ้านและพื้นที่ร่วมกัน', en: 'A shared home' }, excerpt: { th: 'พื้นที่สำหรับทุกคน', en: 'Space for everyone' }, ai_exposure: 'open', blocks: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'บ้านที่ใส่ใจทุกคน' }] }] } } });
  expect(response.ok()).toBeTruthy(); const saved = (await response.json()).data;
  for (let i = 0; i < 12; i++) {
    const current = await read(page, `${base}/articles/${saved.id}`), t = current.translations.find((t: { editable: boolean; th_text: string; translation_state: string }) => t.editable && t.th_text.trim() && t.translation_state !== 'reviewed');
    if (!t) break;
    expect((await page.request.post(`${base}/content/translations/${t.id}/review`, { headers, data: { expected_revision: t.revision, th_version: t.th_version, english: t.entered_en || 'A home for everyone' } })).ok()).toBeTruthy();
  }
  let current = await read(page, `${base}/articles/${saved.id}`);
  expect((await page.request.post(`${base}/articles/${saved.id}/submit`, { headers, data: { expected_revision: current.revision } })).ok()).toBeTruthy();
  await persona(page, 'publisher'); current = await read(page, `${base}/articles/${saved.id}`);
  expect((await page.request.post(`${base}/articles/${saved.id}/review`, { headers, data: { expected_revision: current.revision, decision: 'approve' } })).ok()).toBeTruthy();
  await persona(page, 'editor'); return slug;
}

for (const width of [1280, 390]) {
  test(`website review, independent publication and rollback at ${width}px`, async ({ page }) => {
    test.setTimeout(120000); await page.setViewportSize({ width, height: 900 });
    const slug = await article(page), key = `article:${slug}`, reason = `ตรวจเผยแพร่ ${width}`;
    const db = await operator();
    const publisher = '00000000-0000-0000-0000-000000000002';
    const previous = (await db.query("select special_actions from hub.account_permission where account_id=$1 and tab='knowledge'", [publisher])).rows[0].special_actions;
    try {
      await page.goto('/faq?tab=publication');
      await page.getByRole('button', { name: 'ลงทะเบียนหน้าเว็บ', exact: true }).click();
      await page.getByRole('textbox', { name: 'รหัสหน้าเว็บ', exact: false }).fill(key);
      await page.getByRole('textbox', { name: 'ที่อยู่หน้าเว็บ', exact: true }).fill('/articles/' + slug);
      await page.getByRole('combobox', { name: 'การใช้เนื้อหาโดย AI' }).selectOption('open');
      await page.getByRole('button', { name: 'บันทึกหน้าเว็บ', exact: true }).click();
      await expect(page.getByText('บันทึกหน้าเว็บแล้ว ยังไม่เผยแพร่', { exact: true })).toBeVisible();
      await page.getByRole('textbox', { name: 'เหตุผลการเผยแพร่หรือเปลี่ยนฉบับ', exact: true }).fill(reason);
      await page.getByRole('button', { name: 'เตรียมชุดตรวจทุกหน้าที่เปลี่ยน', exact: true }).click();
      const review = page.getByRole('region', { name: 'ตรวจชุดเผยแพร่', exact: true });
      await expect(review.locator('.web-html-preview')).toContainText('บ้านและพื้นที่ร่วมกัน');
      await expect(review.getByRole('button', { name: 'เผยแพร่ขึ้นเว็บ', exact: true })).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.screenshot({ path: `artifacts/project-content-phase8/review-${width}.png`, fullPage: true });
      await db.query("update hub.account_permission set special_actions=array_append(special_actions,'knowledge.publish_web') where account_id=$1 and tab='knowledge'", [publisher]);
      await persona(page, 'publisher'); await page.reload();
      if (width === 1280) {
        await review.getByRole('checkbox', { name: 'ตรวจทุกหน้าและรายชื่อเฟสแล้ว ยืนยันเผยแพร่ชุดนี้' }).check();
        await db.query("update hub.account_permission set special_actions=$2 where account_id=$1 and tab='knowledge'", [publisher, previous]);
        await review.getByRole('button', { name: 'เผยแพร่ขึ้นเว็บ', exact: true }).click();
        await expect(page.getByRole('alert')).toBeVisible();
        expect((await read(page, `${base}/web`)).pages.find((p: { page_key: string }) => p.page_key === key).published_version_id).toBeNull();
        await db.query("update hub.account_permission set special_actions=array_append(special_actions,'knowledge.publish_web') where account_id=$1 and tab='knowledge'", [publisher]);
        await page.reload();
      }
      await review.getByRole('checkbox', { name: 'ตรวจทุกหน้าและรายชื่อเฟสแล้ว ยืนยันเผยแพร่ชุดนี้' }).check();
      await review.getByRole('button', { name: 'เผยแพร่ขึ้นเว็บ', exact: true }).click();
      await expect(page.getByText('เผยแพร่ทุกหน้าในชุดแล้ว', { exact: true })).toBeVisible();
      await page.screenshot({ path: `artifacts/project-content-phase8/published-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: `ประวัติ ${key}`, exact: true }).click();
      const history = page.getByRole('region', { name: 'ประวัติหน้าเว็บ', exact: true });
      await history.getByRole('button', { name: 'ตรวจฉบับ 1', exact: true }).click();
      await expect(history.locator('.web-html-preview')).toContainText('บ้านและพื้นที่ร่วมกัน');
      await page.getByRole('textbox', { name: 'เหตุผลการเผยแพร่หรือเปลี่ยนฉบับ', exact: true }).fill('ถอนชั่วคราวเพื่อทดสอบ');
      await history.getByRole('checkbox', { name: 'ตรวจฉบับและเหตุผลก่อนเปลี่ยนการเผยแพร่แล้ว' }).check();
      await history.getByRole('button', { name: 'ถอนหน้าเว็บ', exact: true }).click();
      await expect(page.getByText('ถอนหน้าเว็บแล้ว', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: `ประวัติ ${key}`, exact: true }).click();
      await history.getByRole('button', { name: 'ตรวจฉบับ 1', exact: true }).click();
      await page.getByRole('textbox', { name: 'เหตุผลการเผยแพร่หรือเปลี่ยนฉบับ', exact: true }).fill('นำฉบับที่ตรวจแล้วกลับมา');
      await history.getByRole('checkbox', { name: 'ตรวจฉบับและเหตุผลก่อนเปลี่ยนการเผยแพร่แล้ว' }).check();
      await history.getByRole('button', { name: 'ใช้ฉบับ 1', exact: true }).click();
      await expect(page.getByText('เปลี่ยนเป็นฉบับที่ตรวจแล้ว', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.screenshot({ path: `artifacts/project-content-phase8/rollback-${width}.png`, fullPage: true });
      await persona(page, 'viewer'); await page.reload();
      expect((await page.request.post(`${base}/web/pages/${key}/pointer`, { headers, data: { expected_version_id: null, target_version_id: null, reason: 'Denied' } })).status()).toBe(403);
      expect((await page.request.get(`${base}/web?unexpected=1`)).status()).toBe(404);
    } finally {
      await db.query("update hub.account_permission set special_actions=$2 where account_id=$1 and tab='knowledge'", [publisher, previous]); await db.end();
    }
  });
}
