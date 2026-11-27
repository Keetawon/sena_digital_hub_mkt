import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { workflowControl, workflowText, submitItem, approveItem } from './content-workflow-fixtures';

const headers = { Origin: 'http://127.0.0.1:3000' }, api = '/api/hub/v1/admin';
const today = new Date().toISOString().slice(0, 10);
async function persona(page: Page, role: string) { expect((await page.request.post('/api/local-session', { headers, data: { role } })).ok()).toBeTruthy(); }
async function read(page: Page, path: string) { const response = await page.request.get(path); expect(response.ok(), path).toBeTruthy(); return (await response.json()).data; }
async function fits(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy(); }
async function open(page: Page) {
  const project = (await read(page, `${api}/projects`)).find((p: { source: { rem_project_id: string } }) => p.source.rem_project_id === 'DEMO-001');
  await page.goto(`/content?project=${project.public_project_id}&tab=commercial`);
  await expect(page.getByRole('heading', { name: 'ข้อมูลขายและกฎหมายของเฟสนี้' })).toBeVisible();
  return project;
}

for (const width of [1280, 390]) {
  test(`C5 Legal upload stays private and drafts preserve unknowns at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    const project = await open(page), base = `${api}/projects/${project.public_project_id}/commercial`;
    const data = await read(page, base);
    await page.getByRole('button', { name: data.records.disclosures.length ? 'แก้ไขฉบับ' : 'เพิ่มข้อมูลตามกฎหมาย', exact: true }).click();
    await page.getByLabel('บริษัทเจ้าของโครงการ', { exact: true }).fill('บริษัทตัวอย่างสำหรับทดสอบ');
    await page.getByLabel('บริษัทเจ้าของโครงการ (ภาษาอังกฤษ)', { exact: true }).fill('Synthetic company');
    await page.getByLabel('โฉนด', { exact: true }).fill('0007\n0010');
    await page.getByLabel('เลขที่ดิน', { exact: true }).fill('0009');
    await page.getByLabel('อัปโหลดเอกสาร Legal ส่วนตัว').setInputFiles({ name: `synthetic-legal-${width}.png`, mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGNUje5nwAaYsIoOWgkA2DgBH/WttugAAAAASUVORK5CYII=', 'base64') });
    await expect(page.getByText('อัปโหลดเอกสารส่วนตัวแล้ว กดบันทึกร่างเพื่อแนบกับฉบับนี้', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ผู้ลงทุน', exact: true })).toBeDisabled();
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase9/legal-form-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(page.getByText('บันทึกร่างแล้ว ตรวจภาษาอังกฤษก่อนส่งตรวจ', { exact: true })).toBeVisible();
    const saved = (await read(page, base)).records.disclosures[0];
    expect(saved.title_deeds).toEqual(['0007', '0010']); expect(saved.registered_capital).toBeNull();
    expect(saved.legal_document_asset_id).toBeTruthy();
    await expect(page.getByRole('link', { name: 'เปิดเอกสารส่วนตัว', exact: true })).toBeVisible();
    await expect(workflowControl(page, 'disclosure').getByRole('button', { name: workflowText.submit, exact: true })).toBeDisabled();
    await persona(page, 'viewer'); await open(page);
    await expect(page.getByRole('link', { name: 'เปิดเอกสารส่วนตัว', exact: true })).toHaveCount(0);
    const viewer = await read(page, base);
    expect(viewer.legal_documents).toEqual([]); expect(viewer.records.disclosures[0].legal_document_asset_id).toBeUndefined();
    expect((await page.request.get(`${api}/assets/${saved.legal_document_asset_id}/file`)).status()).toBe(404);
    await persona(page, 'publisher'); await open(page);
    await expect(page.getByRole('link', { name: 'เปิดเอกสารส่วนตัว', exact: true })).toBeVisible();
    expect((await page.request.get(`${api}/assets/${saved.legal_document_asset_id}/file`)).ok()).toBeTruthy();
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase9/legal-review-${width}.png`, fullPage: true });
  });

  test(`C5 programme English review, approval, construction and investor at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    const project = await open(page), key = `synthetic-${width}-${randomUUID().slice(0, 8)}`;
    await page.getByRole('button', { name: 'โครงการบริการ', exact: true }).click();
    await expect(page.getByText(/ยูนิตที่เสนอจาก REM: ยังไม่มีข้อมูล/)).toBeVisible();
    await page.getByRole('button', { name: 'เพิ่มโครงการบริการ', exact: true }).click();
    await page.locator('#commercial-programme_key').fill(key);
    await page.getByLabel('เข้าร่วม', { exact: true }).selectOption('true');
    await page.getByLabel('รายเดือนเริ่มต้น', { exact: true }).fill('6000');
    await page.getByLabel('ที่มา', { exact: true }).fill(`Synthetic programme ${width}`);
    await page.getByLabel('ที่มา (ภาษาอังกฤษ)', { exact: true }).fill(`Synthetic programme ${width}`);
    await page.getByLabel('วันที่ข้อมูล', { exact: true }).fill(today);
    await page.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(page.getByText('บันทึกร่างแล้ว ตรวจภาษาอังกฤษก่อนส่งตรวจ', { exact: true })).toBeVisible();
    const translation = page.getByRole('region', { name: 'ตรวจภาษาอังกฤษ', exact: true }).getByRole('article').filter({ hasText: `Synthetic programme ${width}` });
    await translation.getByRole('button', { name: 'ตรวจคำแปล', exact: true }).click();
    await translation.getByRole('button', { name: 'ยืนยันตรวจภาษาอังกฤษ', exact: true }).click();
    await expect(page.getByText('ตรวจยืนยันภาษาอังกฤษแล้ว', { exact: true })).toBeVisible();
    const card = page.getByRole('article').filter({ has: page.getByText(key, { exact: true }) });
    await submitItem(card, 'programme');
    await persona(page, 'publisher'); await open(page); await page.getByRole('button', { name: 'โครงการบริการ', exact: true }).click();
    await approveItem(page, card, 'programme');
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase9/programme-approved-${width}.png`, fullPage: true });
    await persona(page, 'editor'); await open(page); await page.getByRole('button', { name: 'ความคืบหน้าก่อสร้าง', exact: true }).click();
    await page.getByRole('button', { name: 'เพิ่มความคืบหน้าก่อสร้าง', exact: true }).click();
    await page.getByLabel('องค์ประกอบงาน', { exact: true }).selectOption(width === 1280 ? 'structure' : 'architecture');
    await page.getByLabel('ความคืบหน้า', { exact: true }).fill('42.5');
    await page.getByLabel('วันที่ข้อมูล', { exact: true }).fill(today);
    await page.getByLabel('แหล่งข้อมูล', { exact: true }).selectOption('construction');
    await page.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(page.getByText('บันทึกร่างแล้ว ตรวจภาษาอังกฤษก่อนส่งตรวจ', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ผู้ลงทุน', exact: true }).click();
    await expect(page.getByText(/ประมาณการ ไม่รับประกัน/).first()).toBeVisible();
    await expect(page.locator('#section-body-section\\.investor_intro-th')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ย่อ ข้อมูลสำหรับผู้ลงทุน', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'แก้ไข ประมาณการผลตอบแทนค่าเช่า', exact: true })).toBeVisible();
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase9/investor-${width}.png`, fullPage: true });
  });

  test(`C5 real promotion scope, windows, English and banner context at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    const project = (await read(page, `${api}/projects`)).find((p: { source: { rem_project_id: string } }) => p.source.rem_project_id === 'DEMO-001');
    const text = { th: `Synthetic promotion ${width}`, en: `Synthetic promotion ${width}` };
    const created = await page.request.post(`${api}/promotions`, { headers, data: { project_id: project.id, code: `C5-${width}-${randomUUID().slice(0, 8).toUpperCase()}`, synthetic: false,
      title: text, summary: text, conditions_public: text, legal_terms: text, disclaimer: text, benefit_type: 'other', starts_at: '2026-10-01T00:00:00Z', ends_at: '2027-01-01T00:00:00Z' } });
    expect(created.status()).toBe(201); const row = (await created.json()).data;
    await page.goto(`/promotions?promotion=${row.id}`);
    await expect(page.getByText(/โปรโมชันจริง · ตรวจ DATA และ LEGAL/)).toBeVisible();
    await page.getByRole('button', { name: 'แก้ไขขอบเขตและช่วงเวลา', exact: true }).click();
    await expect(page.locator('#promotion-title')).toBeEnabled(); // One form keeps copy and scope editable together.
    await page.getByLabel('กลุ่มเป้าหมาย', { exact: true }).selectOption('livnex');
    await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await page.getByRole('button', { name: 'แก้ไขขอบเขตและช่วงเวลา', exact: true }).click();
    await expect(page.getByLabel('กลุ่มเป้าหมาย', { exact: true })).toHaveValue('general');
    await page.getByLabel('กลุ่มเป้าหมาย', { exact: true }).selectOption('investor');
    const targets = page.getByRole('group', { name: 'โครงการเพิ่มเติม', exact: true });
    await targets.getByRole('checkbox').first().check();
    await page.getByLabel('เริ่มจอง', { exact: true }).fill('2026-10-22'); await page.getByLabel('สิ้นสุดจอง', { exact: true }).fill('2026-11-22');
    await page.getByRole('button', { name: 'บันทึกขอบเขตและช่วงเวลา', exact: true }).click();
    await expect(page.getByRole('button', { name: 'แก้ไขขอบเขตและช่วงเวลา', exact: true })).toBeVisible();
    const saved = await read(page, `${api}/promotions/${row.id}`);
    expect(saved.audience).toBe('investor'); expect(saved.targets.length).toBe(1); expect(saved.booking_to).toBe('2026-11-22');
    expect(saved.synthetic).toBe(false); expect(saved.readiness.ready).toBe(false);
    await expect(page.getByRole('button', { name: 'ตรวจคำแปล', exact: true })).toHaveCount(5);
    await page.getByRole('button', { name: 'แก้ไขขอบเขตและช่วงเวลา', exact: true }).scrollIntoViewIfNeeded();
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase9/promotion-${width}.png` });
    await page.getByRole('link', { name: 'อัปโหลดหรือเลือกแบนเนอร์โปรโมชัน', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'เตรียมภาพก่อนอัปโหลด', exact: true })).toBeVisible();
    await expect(page.getByLabel('เลือกรายการจากข้อมูลโครงการ', { exact: true })).toHaveValue(row.id);
    await expect(page.getByLabel('การใช้งาน', { exact: true })).toHaveValue('banner');
    expect(new URL(page.url()).searchParams.get('target_key')).toBe(row.id);
    expect(new URL(page.url()).searchParams.get('category')).toBe('promotion_ad');
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase9/banner-context-${width}.png`, fullPage: true });
  });
}
