import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const headers = { Origin: 'http://127.0.0.1:3000' }, base = '/api/hub/v1/admin';
async function persona(page: Page, role: string) { expect((await page.request.post('/api/local-session', { headers, data: { role } })).ok()).toBeTruthy(); }
async function read(page: Page, path: string) { const response = await page.request.get(path); expect(response.ok(), path).toBeTruthy(); return (await response.json()).data; }
async function fits(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy(); }
async function finishEnglish(page: Page, id: string) {
  for (let count = 0; count < 30; count++) {
    const article = await read(page, `${base}/articles/${id}`);
    const t = article.translations.find((item: { editable: boolean; th_text: string; translation_state: string }) => item.editable && item.th_text.trim() && item.translation_state !== 'reviewed');
    if (!t) return;
    const response = await page.request.post(`${base}/content/translations/${t.id}/review`, { headers, data: { expected_revision: t.revision, th_version: t.th_version, english: t.entered_en || 'Synthetic article text' } });
    expect(response.ok()).toBeTruthy();
  }
  throw new Error('Translation review did not finish');
}

for (const width of [1280, 390]) {
  test(`article author, English review, independent approval and history at ${width}px`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    await page.goto('/articles');
    await page.getByRole('button', { name: 'สร้างบทความ', exact: true }).click();
    await page.getByRole('textbox', { name: 'ชื่อในที่อยู่เว็บ', exact: false }).fill(`synthetic-article-${randomUUID()}`);
    await page.locator('#article-title-th').fill('แนวคิดการอยู่อาศัยสำหรับครอบครัว');
    await page.locator('#article-title-en').fill('A home for family life');
    await page.locator('#article-excerpt-th').fill('พื้นที่สำหรับการพักผ่อนและการใช้ชีวิตร่วมกัน');
    await page.locator('#article-excerpt-en').fill('Space for rest and shared moments');
    const body = page.getByRole('textbox', { name: 'เนื้อหาบทความภาษาไทย', exact: true });
    await body.fill('บ้านที่เข้าใจการใช้ชีวิตของทุกคน');
    await body.press('Control+End'); await body.press('Enter');
    await page.getByRole('button', { name: 'รายการลำดับ', exact: true }).click();
    await expect(body.locator('ol')).toBeVisible();
    await page.keyboard.insertText('พื้นที่พักผ่อน');
    await expect(body.locator('ol')).toContainText('พื้นที่พักผ่อน');
    await body.press('Enter'); await body.press('Enter');
    await page.getByRole('button', { name: 'แทรกตาราง', exact: true }).click();
    await body.locator('th').first().click(); await page.keyboard.insertText('การใช้งาน');
    await page.locator('#article-author-th').fill('ทีมการตลาด'); await page.locator('#article-author-en').fill('Marketing team');
    await fits(page); await page.screenshot({ path: `artifacts/project-content-articles/editor-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'บันทึกบทความ', exact: true }).click();
    await expect(page.getByText('บันทึกฉบับร่างแล้ว ตรวจภาษาอังกฤษก่อนส่งตรวจ', { exact: true })).toBeVisible();
    const id = new URL(page.url()).searchParams.get('article')!;
    const saved = await read(page, `${base}/articles/${id}`);
    expect(saved.version.blocks.th.content.some((node: { type: string }) => node.type === 'table')).toBeTruthy();
    await expect(page.getByRole('button', { name: 'ส่งตรวจบทความ', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'ตรวจภาษาอังกฤษ', exact: true }).click();
    await page.getByRole('button', { name: 'ตรวจคำแปล', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'คำแปลภาษาอังกฤษที่ยืนยัน', exact: true }).fill('Marketing team');
    await page.getByRole('button', { name: 'ยืนยันตรวจภาษาอังกฤษ', exact: true }).click();
    await expect(page.getByText('ตรวจยืนยันภาษาอังกฤษแล้ว', { exact: true })).toBeVisible();
    await finishEnglish(page, id); await page.reload();
    await page.getByRole('button', { name: 'ตัวอย่างบทความ', exact: true }).click();
    await expect(page.locator('.article-preview h1')).toHaveText('แนวคิดการอยู่อาศัยสำหรับครอบครัว');
    await expect(page.locator('.article-preview table')).toBeVisible();
    await page.getByRole('combobox', { name: 'ภาษาตัวอย่าง', exact: true }).selectOption('en');
    await expect(page.locator('.article-preview h1')).toHaveText('A home for family life');
    await fits(page); await page.screenshot({ path: `artifacts/project-content-articles/preview-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'เนื้อหาบทความ', exact: true }).click();
    await page.getByRole('button', { name: 'ส่งตรวจบทความ', exact: true }).click();
    await expect(page.getByText('ส่งตรวจแล้ว ผู้อนุมัติคนอื่นจะตรวจเนื้อหาฉบับนี้', { exact: true })).toBeVisible();
    await persona(page, 'publisher'); await page.reload();
    await page.getByRole('button', { name: 'อนุมัติเนื้อหา', exact: true }).click();
    await expect(page.getByText('อนุมัติเนื้อหาแล้ว ยังไม่เผยแพร่เว็บไซต์', { exact: true })).toBeVisible();
    await fits(page); await page.screenshot({ path: `artifacts/project-content-articles/approved-${width}.png`, fullPage: true });
    await persona(page, 'editor'); await page.reload();
    await page.getByRole('button', { name: 'แก้ไขบทความ', exact: true }).click();
    await page.locator('#article-title-th').fill('แนวคิดที่ปรับปรุงแล้ว');
    await page.getByRole('button', { name: 'บันทึกบทความ', exact: true }).click();
    await expect(page.getByText('บันทึกฉบับร่างแล้ว ตรวจภาษาอังกฤษก่อนส่งตรวจ', { exact: true })).toBeVisible();
    const changed = await read(page, `${base}/articles/${id}`);
    expect(changed.version.version_no).toBe(2); expect(changed.approved_version_id).toBe(saved.version.id);
    await page.getByRole('button', { name: 'ประวัติ', exact: true }).click();
    const history = page.getByRole('region', { name: 'ประวัติบทความ', exact: true });
    await history.locator('summary').filter({ hasText: 'ฉบับ 1' }).click();
    await expect(history.getByRole('heading', { name: 'แนวคิดการอยู่อาศัยสำหรับครอบครัว', exact: true })).toBeVisible();
    await persona(page, 'viewer'); await page.reload();
    await expect(page.getByRole('button', { name: 'แก้ไขบทความ', exact: true })).toHaveCount(0);
    expect((await page.request.get(`${base}/articles/${id}/preview?unexpected=1`)).status()).toBe(404);
    expect((await page.request.post(`${base}/articles/${id}/publish`, { headers, data: {} })).status()).toBe(404);
  });
}

for (const level of ['edit', 'view']) {
  test(`article ${level} revocation preserves authored rich text and clears the editor`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 }); await persona(page, 'editor');
    const original = await read(page, '/api/hub/v1/me'); let account = structuredClone(original), checks = 0;
    await page.route('**/api/hub/v1/me', route => { checks++; return route.fulfill({ json: { data: account } }); });
    let releaseNames = () => {}, namesHeld = false;
    const pendingNames = new Promise<void>(resolve => { releaseNames = resolve; });
    await page.route('**/api/hub/v1/accounts/display-names', async route => {
      if (account.id === original.id && !account.capabilities.tabs.knowledge.edit) { namesHeld = true; await pendingNames; }
      return route.fulfill({ json: { data: [] } });
    });
    try {
      await page.goto('/articles?article=new');
      const authored = 'ข้อความบทความที่ฉันยังไม่ได้บันทึก';
      await page.getByRole('textbox', { name: 'เนื้อหาบทความภาษาไทย', exact: true }).fill(authored);
      const before = checks; account.capabilities.tabs.knowledge.edit = false;
      if (level === 'view') account.capabilities.tabs.knowledge.view = false;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect.poll(() => checks).toBeGreaterThan(before);
      await expect(page.locator('[contenteditable="true"][data-permission-recovery]')).toHaveCount(0);
      const recovered = page.getByRole('complementary', { name: 'ข้อความที่คุณกรอก', exact: true });
      await expect(recovered.getByRole('textbox', { name: 'เนื้อหาบทความภาษาไทย', exact: true })).toHaveValue(authored);
      await fits(page); await page.screenshot({ path: `artifacts/project-content-articles/revoked-${level}-390.png`, fullPage: true });
      await expect.poll(() => namesHeld).toBeTruthy();
      account = { ...original, id: '65000000-0000-4000-8000-000000000098' };
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      releaseNames();
      await expect(recovered).toHaveCount(0);
    } finally { releaseNames(); }
  });
}

test('article failed save keeps the body, and dirty navigation can be cancelled', async ({ page }) => {
  await persona(page, 'editor'); await page.goto('/articles?article=new');
  await page.getByRole('textbox', { name: 'ชื่อในที่อยู่เว็บ', exact: false }).fill('synthetic-unsaved');
  await page.locator('#article-title-th').fill('บทความที่ยังไม่บันทึก');
  const body = page.getByRole('textbox', { name: 'เนื้อหาบทความภาษาไทย', exact: true });
  await body.fill('ข้อความต้องยังอยู่เมื่อบันทึกไม่สำเร็จ');
  await page.route('**/api/hub/v1/admin/articles', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 409, json: { error: { message: 'ข้อมูลเปลี่ยนแล้ว กรุณาตรวจอีกครั้ง' } } }) : route.continue());
  await page.getByRole('button', { name: 'บันทึกบทความ', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'ข้อมูลเปลี่ยนแล้ว' })).toBeVisible();
  await expect(body).toHaveText('ข้อความต้องยังอยู่เมื่อบันทึกไม่สำเร็จ');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'กลับรายการบทความ', exact: true }).click();
  await expect(body).toBeVisible(); await expect(page).toHaveURL(/article=new/);
});
