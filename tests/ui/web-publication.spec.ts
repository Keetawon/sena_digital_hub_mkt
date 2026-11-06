import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { clickPublication, confirmPublication, confirmSourceCommand, preparePublication, publishingGrant, realWorkflowApproval, workflowText } from './content-workflow-fixtures';

const headers = { Origin: 'http://127.0.0.1:3000' }, base = '/api/hub/v1/admin';
async function persona(page: Page, role: string) { expect((await page.request.post('/api/local-session', { headers, data: { role } })).ok()).toBeTruthy(); }
async function read(page: Page, route: string) { const response = await page.request.get(route); expect(response.ok(), route).toBeTruthy(); return (await response.json()).data; }
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
  await realWorkflowApproval(page, { kind: 'article', identity: { id: saved.id } });
  await persona(page, 'editor'); return slug;
}

for (const width of [1280, 390]) {
  test(`website review, independent publication and rollback at ${width}px`, async ({ page }) => {
    test.setTimeout(120000); await page.setViewportSize({ width, height: 900 });
    const slug = await article(page), key = `article:${slug}`, reason = `ตรวจเผยแพร่ ${width}`;
    const grant = await publishingGrant();
    try {
      await page.goto('/publish?tab=configuration');
      await page.getByRole('button', { name: 'ลงทะเบียนหน้าเว็บ', exact: true }).click();
      await page.getByRole('textbox', { name: 'รหัสหน้าเว็บ', exact: false }).fill(key);
      await page.getByRole('textbox', { name: 'ที่อยู่หน้าเว็บ', exact: true }).fill('/articles/' + slug);
      await page.getByRole('combobox', { name: 'การใช้เนื้อหาโดย AI' }).selectOption('open');
      await page.getByRole('button', { name: 'บันทึกหน้าเว็บ', exact: true }).click();
      await expect(page.getByText('บันทึกหน้าเว็บแล้ว ยังไม่เผยแพร่', { exact: true })).toBeVisible();
      const registered = (await read(page, `${base}/web`)).pages.find((item: { page_key: string }) => item.page_key === key);
      expect(registered.id).toBeTruthy();
      await realWorkflowApproval(page, { kind: 'page_config', identity: { id: registered.id } });
      await persona(page, grant.role);
      const review = await preparePublication(page, [{ system: 'web', page_key: key }], reason);
      await expect(review.frameLocator('.publication-preview').locator('body')).toContainText('บ้านและพื้นที่ร่วมกัน');
      await expect(review.getByRole('button', { name: workflowText.publish, exact: true })).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.screenshot({ path: `artifacts/project-content-phase8/review-${width}.png`, fullPage: true });
      if (width === 1280) {
        await review.getByRole('checkbox', { name: workflowText.confirm_publication, exact: true }).check();
        await grant.disable();
        await clickPublication(review);
        await expect(review.getByRole('alert')).toBeVisible();
        expect((await read(page, `${base}/web`)).pages.find((p: { page_key: string }) => p.page_key === key).published_version_id).toBeNull();
        await grant.enable();
        await page.reload();
      }
      await confirmPublication(page, review);
      const first = (await read(page, `${base}/web`)).pages.find((p: { page_key: string }) => p.page_key === key).published_version_id;
      expect(first).toBeTruthy();
      await page.screenshot({ path: `artifacts/project-content-phase8/published-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: `${workflowText.web_history} · ${key}`, exact: true }).click();
      const history = page.locator('.publication-history-panel').filter({ has: page.getByRole('heading', { name: `${workflowText.web_history} · ${key}`, exact: true }) });
      await history.getByRole('button', { name: `${workflowText.version} 1`, exact: true }).click();
      await expect(history.frameLocator('.publication-preview').locator('body')).toContainText('บ้านและพื้นที่ร่วมกัน');
      await confirmSourceCommand(page, history.getByRole('button', { name: workflowText.withdraw_page, exact: true }), 'ถอนชั่วคราวเพื่อทดสอบ');
      expect((await read(page, `${base}/web`)).pages.find((p: { page_key: string }) => p.page_key === key).published_version_id).toBeNull();
      await history.getByRole('button', { name: `${workflowText.version} 1`, exact: true }).click();
      await confirmSourceCommand(page, history.getByRole('button', { name: workflowText.restore_version, exact: true }), 'นำฉบับที่ตรวจแล้วกลับมา');
      expect((await read(page, `${base}/web`)).pages.find((p: { page_key: string }) => p.page_key === key).published_version_id).toBe(first);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.screenshot({ path: `artifacts/project-content-phase8/rollback-${width}.png`, fullPage: true });
      await grant.disable(); await persona(page, 'viewer'); await page.reload();
      expect((await page.request.post(`${base}/web/pages/${key}/pointer`, { headers, data: { expected_version_id: null, target_version_id: null, reason: 'Denied' } })).status()).toBe(403);
      expect((await page.request.get(`${base}/web?unexpected=1`)).status()).toBe(404);
    } finally {
      await grant.restore();
    }
  });
}
