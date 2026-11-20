import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { uploadText } from '../../apps/admin/lib/upload-text';

const headers = { Origin: 'http://127.0.0.1:3000' }, api = '/api/hub/v1/admin';
async function persona(page: Page, role: string) { expect((await page.request.post('/api/local-session', { headers, data: { role } })).ok()).toBeTruthy(); }
async function read(page: Page, path: string) { const response = await page.request.get(path); expect(response.ok(), path).toBeTruthy(); return (await response.json()).data; }
async function fits(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy(); }
const file = (name: string, color: string) => ({ name, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/><text x="10" y="90" fill="white">Synthetic ${randomUUID()}</text></svg>`) });

for (const width of [1280, 390]) {
  test(`Shared mailbox accepts all domains with advisory webmail warnings at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    const project = (await read(page, `${api}/projects`)).find((row: { source: { rem_project_id: string } }) => row.source.rem_project_id === 'DEMO-001');
    const contacts = `${api}/projects/${project.public_project_id}/contacts`;
    const label = `กล่องกลางสมมติ ${width}`, address = `synthetic-phase3-${width}@gmail.com`;
    expect((await page.request.post(contacts, { headers, data: { expected_revision: 0, changes: { channel: 'email', value: address, shared_mailbox_confirmed: false } } })).status()).toBe(422);
    await page.goto(`/content?project=${project.public_project_id}&tab=contacts`);
    await page.getByRole('button', { name: 'เพิ่มช่องทางติดต่อ', exact: true }).click();
    await page.locator('#contact-channel').selectOption('email');
    const confirmation = page.getByLabel('ยืนยันว่าเป็นกล่องอีเมลส่วนกลางของบริษัท ไม่ใช่ที่อยู่ส่วนบุคคล', { exact: true });
    for (const domain of ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com']) {
      await page.locator('#contact-value').fill(`synthetic-phase3-${width}@${domain.toUpperCase()}`);
      await expect(page.locator('#contact-mailbox-warning')).toBeVisible();
    }
    await page.locator('#contact-value').fill(address);
    await page.locator('#contact-label-th').fill(label);
    await expect(page.getByRole('button', { name: 'บันทึกช่องทางติดต่อ', exact: true })).toBeEnabled();
    expect(await confirmation.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
    await confirmation.check(); await fits(page);
    await page.screenshot({ path: `artifacts/project-content-phase3/mailbox-warning-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'บันทึกช่องทางติดต่อ', exact: true }).click();
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
    await expect(card).toContainText(address);
    await expect(card).toContainText('ข้อควรระวัง');
    await card.getByRole('button', { name: 'แก้ไข อีเมลส่วนกลางบริษัท', exact: true }).click();
    await page.locator('#contact-value').fill(`synthetic-phase3-${width}@unlisted-group.example`);
    await expect(page.locator('#contact-mailbox-warning')).toHaveCount(0);
    await expect(confirmation).not.toBeChecked();
    await confirmation.check();
    await page.getByRole('button', { name: 'บันทึกช่องทางติดต่อ', exact: true }).click();
    await expect(card).toContainText('unlisted-group.example');
    await expect(card.getByText(/ข้อควรระวัง/)).toHaveCount(0);
    await fits(page);
    expect((await read(page, `${api}/questions`)).questions.some((item: { id: string }) => item.id === 'Q76')).toBe(false);
  });

  test(`Media batch context, retry, immutable rights and read denial at ${width}px`, async ({ page }) => {
    test.setTimeout(120000); await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    const project = (await read(page, `${api}/projects`)).find((row: { source: { rem_project_id: string } }) => row.source.rem_project_id === 'DEMO-001');
    const base = `${api}/projects/${project.public_project_id}`, media = `${base}/media`;
    let original = await read(page, base);
    const pool = original.facilities.items.find((item: { code: string }) => item.code === 'pool');
    expect((await page.request.put(`${base}/facilities/pool`, { headers, data: { updated_at: original.updated_at, status: 'present', description: { th: 'ส่วนกลางสมมติสำหรับทดสอบสื่อ' } } })).ok()).toBeTruthy();
    const uploaded: string[] = [];
    let failed = false;
    await page.route('**/api/hub/v1/admin/assets', async route => {
      if (route.request().method() === 'POST') uploaded.push(decodeURIComponent(route.request().headers()['x-filename']));
      await route.continue();
    });
    await page.route(`**/api/hub/v1/admin/projects/${project.public_project_id}/media/links/*`, async route => {
      if (route.request().method() === 'PUT' && !failed) { failed = true; return route.fulfill({ status: 503, json: { error: { message: 'ทดสอบข้อผิดพลาดการผูกไฟล์ กรุณาลองใหม่' } } }); }
      return route.continue();
    });
    let metadataWrites = 0;
    await page.route(`**/api/hub/v1/admin/projects/${project.public_project_id}/media/assets/*`, async route => {
      if (route.request().method() === 'PUT' && ++metadataWrites === 3) {
        const saved = await route.fetch(); expect(saved.ok()).toBeTruthy();
        return route.fulfill({ status: 503, json: { error: { message: 'ทดสอบคำตอบหลังบันทึกข้อมูลสูญหาย' } } });
      }
      return route.continue();
    });
    const names = [`phase3-${width}-first.svg`, `phase3-${width}-second.svg`, `phase3-${width}-third.svg`];
    try {
      await page.goto(`/media?project=${project.public_project_id}`);
      await expect(page.getByRole('heading', { name: 'รายการภาพที่ยังขาด' })).toBeVisible();
      await fits(page); await page.screenshot({ path: `artifacts/project-content-phase3/checklist-${width}.png`, fullPage: true });
      await page.getByRole('link', { name: 'เติมภาพ · ภาพส่วนกลางที่มี', exact: true }).first().click();
      await expect(page.getByRole('heading', { name: 'เตรียมภาพก่อนอัปโหลด' })).toBeVisible();
      await expect(page.getByText(uploadText.pixel_limits, { exact: false })).toBeVisible();
      const defaults = page.getByRole('group', { name: 'บริบทเริ่มต้นของไฟล์ใหม่', exact: true });
      await expect(defaults.getByLabel('ใช้กับ', { exact: true })).toHaveValue('facility');
      await defaults.getByLabel('เลือกรายการจากข้อมูลโครงการ').selectOption('pool');
      await defaults.getByText('ข้อมูลที่จะใช้กับไฟล์ใหม่ / ไฟล์ที่เลือก', { exact: true }).click();
      await defaults.locator('#batch-alt-th').fill('ภาพสระว่ายน้ำสมมติ');
      await defaults.locator('#batch-alt-en').fill('Synthetic pool image');
      await defaults.getByLabel('สระว่ายน้ำ', { exact: true }).check();
      await defaults.getByLabel('ตรวจยืนยันข้อมูลภาพแล้ว', { exact: false }).check();
      await defaults.getByLabel('เลือกหลายไฟล์', { exact: false }).setInputFiles([file(names[0], '#165A52'), file(names[1], '#A1864A'), file(names[2], '#437A69')]);
      await defaults.locator('#batch-caption-th').fill('คำบรรยายจากการใช้ข้อมูลชุดเดียวกัน');
      await defaults.getByRole('button', { name: 'แทนที่ข้อมูลและบริบทของไฟล์ที่เลือก' }).click();
      await expect(page.getByRole('button', { name: 'ภาพและเอกสาร', exact: true })).toBeDisabled();
      const first = page.getByRole('article', { name: 'ไฟล์ 1', exact: true });
      await expect(first.locator('textarea[id$="-caption-th"]')).toHaveValue('คำบรรยายจากการใช้ข้อมูลชุดเดียวกัน');
      await first.getByLabel('เป็นภาพปกส่วนกลาง', { exact: false }).check();
      await first.getByLabel('การใช้งาน หมวดสื่อ', { exact: true }).click();
      await expect(first.locator('details[open]').getByText(/ผู้รับผิดชอบ: การตลาด/)).toBeVisible();
      await first.locator('details[open] > div').scrollIntoViewIfNeeded();
      await fits(page); await page.screenshot({ path: `artifacts/project-content-phase3/batch-${width}.png`, fullPage: false });
      const failedLink = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes(`${media}/links/`) && response.status() === 503);
      await page.getByRole('button', { name: 'อัปโหลดและบันทึกข้อมูล', exact: true }).click();
      await failedLink;
      await expect(first.getByRole('alert')).toContainText('ทดสอบข้อผิดพลาดการผูกไฟล์');
      await expect(page.getByRole('article', { name: 'ไฟล์ 2', exact: true }).locator(':scope > [role="status"]')).toHaveText('บันทึกแล้ว');
      await expect(page.getByRole('article', { name: 'ไฟล์ 3', exact: true }).getByRole('alert')).toContainText('คำตอบหลังบันทึกข้อมูลสูญหาย');
      await page.getByRole('button', { name: 'ลองบันทึกไฟล์ที่ยังไม่สำเร็จอีกครั้ง' }).click();
      await expect(first.locator(':scope > [role="status"]')).toHaveText('บันทึกแล้ว');
      await expect(page.getByRole('article', { name: 'ไฟล์ 3', exact: true }).locator(':scope > [role="status"]')).toHaveText('บันทึกแล้ว');
      expect(uploaded).toEqual(names);
      expect(metadataWrites).toBe(3);
      const saved = await read(page, media);
      const mediaAssets = saved.assets.filter((asset: { original_filename: string }) => names.includes(asset.original_filename));
      expect(mediaAssets).toHaveLength(3);
      expect(mediaAssets.every((asset: { rights_status: string; metadata_state: string; media_category: string }) => asset.rights_status === 'pending' && asset.metadata_state === 'confirmed' && asset.media_category === 'facility')).toBeTruthy();
      expect(saved.links.filter((link: { asset_id: string; is_primary: boolean }) => mediaAssets.some((asset: { id: string }) => asset.id === link.asset_id) && link.is_primary)).toHaveLength(1);
      await page.getByRole('button', { name: 'ภาพและเอกสาร', exact: true }).click();
      await expect(page.getByRole('heading', { name: names[0], exact: true })).toBeVisible();
      await fits(page); await page.screenshot({ path: `artifacts/project-content-phase3/library-${width}.png`, fullPage: true });
      await page.route(`**/api/hub/v1/admin/projects/${project.public_project_id}/media`, async route => {
        const response = await route.fetch(), payload = await response.json();
        const asset = payload.data.assets.find((item: { original_filename: string }) => item.original_filename === names[0]);
        expect(asset).toBeDefined();
        asset.ai_suggestion = { media_category: 'exterior', tags: ['day'], proposed_tags: [], caption: { th: 'คำแนะนำสมมติ' }, alt_text: { th: 'ภายนอกสมมติ' }, confidence: 0.6, model: 'synthetic-provider', suggested_at: '2026-10-21T00:00:00Z', source_revision: asset.media_revision };
        await route.fulfill({ response, json: payload });
      });
      await page.reload();
      const suggestionCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: names[0], exact: true }) });
      await expect(suggestionCard.getByRole('alert')).toContainText('คำแนะนำต่างจากหมวดหรือส่วนกลาง');
      await expect(suggestionCard.getByText(/ความมั่นใจ 60%/)).toBeHidden();
      await suggestionCard.getByText('รายละเอียดคำแนะนำ', { exact: true }).click();
      await expect(suggestionCard.getByText(/ความมั่นใจ 60%/)).toBeVisible();
      await fits(page); await page.screenshot({ path: `artifacts/project-content-phase3/suggestion-${width}.png`, fullPage: true });
      await page.unroute(`**/api/hub/v1/admin/projects/${project.public_project_id}/media`);
      await persona(page, 'viewer'); await page.goto(`/media?project=${project.public_project_id}&tab=upload`);
      await expect(page.getByLabel('เลือกหลายไฟล์', { exact: false })).toBeDisabled();
      expect((await page.request.put(`${media}/assets/${mediaAssets[0].id}`, { headers, data: { expected_revision: mediaAssets[0].media_revision, changes: { caption: { th: 'unauthorized' } } } })).status()).toBe(403);
      await persona(page, 'agency_kin');
      expect((await page.request.get(media)).status()).toBe(403);
      expect((await page.request.get(`${api}/assets/${mediaAssets[0].id}/file`)).status()).toBe(403);
    } finally {
      await page.unroute(`**/api/hub/v1/admin/projects/${project.public_project_id}/media/links/*`);
      await persona(page, 'editor');
      const latest = await read(page, media);
      const ids = latest.assets.filter((asset: { original_filename: string }) => names.includes(asset.original_filename)).map((asset: { id: string }) => asset.id);
      for (const link of latest.links.filter((link: { asset_id: string }) => ids.includes(link.asset_id))) expect((await page.request.post(`${media}/links/${link.id}/remove`, { headers, data: { expected_revision: link.revision } })).ok()).toBeTruthy();
      original = await read(page, base);
      expect((await page.request.put(`${base}/facilities/pool`, { headers, data: { updated_at: original.updated_at, status: pool.status, description: pool.description, location_note: pool.location_note, access_note: pool.access_note, evidence_note: pool.evidence_note, expected_open_date: pool.expected_open_date } })).ok()).toBeTruthy();
    }
  });

  test(`Media tags, approval, coverage rules and broken clips at ${width}px`, async ({ page }) => {
    test.setTimeout(90000); await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    const project = (await read(page, `${api}/projects`)).find((row: { source: { rem_project_id: string } }) => row.source.rem_project_id === 'DEMO-001');
    const media = `${api}/projects/${project.public_project_id}/media`;
    const code = `synthetic_media_${width}`, clipName = `คลิปสมมติ ${width}`;
    await page.goto(`/media?project=${project.public_project_id}&tab=rules`);
    await page.getByRole('button', { name: 'เสนอแท็กใหม่', exact: true }).click();
    await page.getByLabel('รหัสป้ายกำกับ', { exact: true }).fill(code);
    await page.locator('#tag-label-th').fill(`มุมพักผ่อนสมมติ ${width}`);
    await page.locator('#tag-label-en').fill(`Synthetic resting area ${width}`);
    await page.getByRole('button', { name: 'บันทึกข้อเสนอแท็ก', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: code })).toContainText('รออนุมัติ');
    await persona(page, 'publisher'); await page.reload();
    await page.getByRole('listitem').filter({ hasText: code }).getByRole('button', { name: 'อนุมัติแท็ก', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: code })).toContainText('ใช้งาน');
    await page.getByRole('listitem').filter({ hasText: code }).getByRole('button', { name: 'เลิกใช้แท็ก', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: code })).toContainText('เลิกใช้');
    await page.getByRole('listitem').filter({ hasText: code }).getByRole('button', { name: 'อนุมัติแท็ก', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: code })).toContainText('ใช้งาน');
    const before = (await read(page, `${api}/media/requirements`)).find((rule: { rule_key: string }) => rule.rule_key === 'map');
    await page.getByRole('button', { name: 'แก้ไขเกณฑ์ · แผนที่', exact: true }).click();
    await page.getByLabel('จำนวนเป้าหมาย', { exact: true }).fill(String(before.target_count + 1));
    await expect(page.getByLabel('เป็นเงื่อนไขเผยแพร่', { exact: false })).toBeDisabled();
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase3/rules-${width}.png`, fullPage: false });
    await page.getByRole('button', { name: 'บันทึกเกณฑ์ภาพ', exact: true }).click();
    await expect(page.getByRole('group', { name: 'แก้ไขเกณฑ์ภาพ', exact: true })).toBeHidden();
    const after = (await read(page, `${api}/media/requirements`)).find((rule: { rule_key: string }) => rule.rule_key === 'map');
    expect(after.target_count).toBe(before.target_count + 1);
    expect((await page.request.put(`${api}/media/requirements/map`, { headers, data: { expected_revision: after.revision, changes: { target_count: before.target_count } } })).ok()).toBeTruthy();
    await persona(page, 'editor'); await page.goto(`/media?project=${project.public_project_id}&tab=clips`);
    await page.getByRole('button', { name: 'เพิ่มคลิปหรือทัวร์', exact: true }).click();
    await page.getByLabel('ลิงก์', { exact: true }).fill('https://www.youtube.com/watch?v=abcdefghijk');
    await page.locator('#clip-title-th').fill(clipName);
    await page.locator('#clip-title-en').fill(`Synthetic clip ${width}`);
    await page.getByRole('button', { name: 'บันทึกคลิป', exact: true }).click();
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: clipName, exact: true }) });
    await expect(card).toBeVisible();
    await card.getByLabel(`ผลตรวจด้วยตนเอง · ${clipName}`, { exact: true }).selectOption('broken');
    await card.getByRole('button', { name: 'บันทึกผลตรวจลิงก์', exact: true }).click();
    await expect(card).toContainText('ซ่อนจากร่าง');
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase3/clips-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'ภาพที่ยังขาด', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ลิงก์ที่ถูกซ่อน', exact: true })).toBeVisible();
    const clip = (await read(page, media)).clips.find((item: { title: { th: string } }) => item.title.th === clipName);
    expect((await page.request.put(`${media}/clips/${clip.id}`, { headers, data: { expected_revision: clip.revision, changes: { state: 'WITHDRAWN' } } })).ok()).toBeTruthy();
  });
}
