import { projectUpload, uploadHeaders } from "./upload-fixtures";
import { openWorkspaceTab } from './unified-workspace-helpers';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { workflowControl, workflowText, submitItem, approveItem } from './content-workflow-fixtures';

const headers = { Origin: 'http://127.0.0.1:3000' }, api = '/api/hub/v1/admin';
async function persona(page: Page, role: string) { expect((await page.request.post('/api/local-session', { headers, data: { role } })).ok()).toBeTruthy(); }
async function read(page: Page, path: string) { const response = await page.request.get(path); expect(response.ok(), path).toBeTruthy(); return (await response.json()).data; }
async function fits(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy(); }
async function open(page: Page, project: string, name?: string) {
  await page.goto(`/?project=${project}`); await openWorkspaceTab(page, 'unit-types');
  await page.getByRole('button', { name: name ? `เปิด 6 ขั้นตอน · ${name}` : 'สร้างแบบด้วย 6 ขั้นตอน', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'ขั้นตอนแบบขาย' })).toBeVisible();
}
async function reviewEnglish(page: Page, base: string, owner: string) {
  const data = await read(page, `${base}/unit-types`);
  for (const text of data.translations.filter((t: { owner_key: string; th_text: string }) => t.owner_key === owner && t.th_text.trim())) {
    const response = await page.request.post(`${api}/content/translations/${text.id}/review`, { headers,
      data: { expected_revision: text.revision, th_version: text.th_version, english: text.entered_en ?? text.th_text } });
    expect(response.ok(), `English review ${text.field_key}`).toBeTruthy();
  }
}

for (const width of [1280, 390]) {
  test(`Unit wizard, room plans, English review and separate approval at ${width}px`, async ({ page }) => {
    test.setTimeout(180000); await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    const project = (await read(page, `${api}/projects`)).find((p: { source: { rem_project_id: string } }) => p.source.rem_project_id === 'DEMO-001');
    const base = `${api}/projects/${project.public_project_id}`, name = `บ้านสมมติ ${width}`;
    await open(page, project.public_project_id);
    const wizard = page.getByRole('region', { name: 'แบบขาย 6 ขั้นตอน' });
    await wizard.locator('#unit-name-th').fill(name); await wizard.locator('#unit-name-en').fill(`Test house ${width}`);
    await wizard.getByRole('combobox', { name: 'ประเภทที่อยู่อาศัย', exact: true }).selectOption('house');
    await wizard.locator('#unit-category').selectOption('single_house');
    await wizard.getByLabel('พื้นที่ใช้สอยต่ำสุด (ตร.ม.)', { exact: true }).fill('120');
    await wizard.getByLabel('พื้นที่ใช้สอยสูงสุด (ตร.ม.)', { exact: true }).fill('130');
    await wizard.getByLabel('จำนวนชั้นของบ้าน', { exact: true }).fill('2');
    await wizard.getByLabel('ความสูงเพดาน (ม.)', { exact: true }).fill('2.7');
    await wizard.getByLabel('ห้องแต่งตัว', { exact: true }).check();
    await fits(page); await wizard.screenshot({ path: `artifacts/project-content-phase5/details-${width}.png` });
    await wizard.getByRole('button', { name: '2. แนวคิดและจุดเด่น', exact: true }).click();
    await wizard.locator('#unit-description-th').fill('บ้านสำหรับครอบครัว');
    await wizard.locator('#unit-description-en').fill('A family home');
    await wizard.getByRole('button', { name: 'บันทึกร่างแบบขาย', exact: true }).click();
    await expect(wizard.getByText('บันทึกร่างแล้ว ตรวจภาษาอังกฤษก่อนส่งตรวจ', { exact: true })).toBeVisible();
    let data = await read(page, `${base}/unit-types`), item = data.types.find((t: { public_name: { th: string } }) => t.public_name.th === name);
    expect(item.bedrooms).toBeNull(); expect(item.bathrooms).toBeNull();
    const firstEnglish = wizard.locator('.content-card').filter({ hasText: 'รอคำแปลและการตรวจ' }).first();
    await firstEnglish.getByRole('button', { name: 'ตรวจคำแปล', exact: true }).click();
    await firstEnglish.getByRole('button', { name: 'ยืนยันตรวจภาษาอังกฤษ', exact: true }).click();
    await expect(firstEnglish).not.toContainText('กำลังบันทึก');
    await expect(wizard.getByText('ตรวจยืนยันภาษาอังกฤษแล้ว', { exact: true })).toBeVisible();
    await reviewEnglish(page, base, item.id);
    await open(page, project.public_project_id, name);
    await wizard.getByRole('button', { name: '5. เชื่อมแบบ REM', exact: true }).click();
    await expect(wizard.getByText(/ห้องหรือบ้านว่างให้สอบถามฝ่ายขาย/)).toBeVisible();
    if (await wizard.locator('.unit-source input').count()) {
      await wizard.locator('.unit-source input').first().check();
      await wizard.getByRole('button', { name: 'บันทึกร่างแบบขาย', exact: true }).click();
      await expect(wizard.getByText('บันทึกร่างแล้ว ตรวจภาษาอังกฤษก่อนส่งตรวจ', { exact: true })).toBeVisible();
    }
    await fits(page); await wizard.screenshot({ path: `artifacts/project-content-phase5/rem-${width}.png` });
    const filename = `phase5-plan-${width}-${randomUUID()}.svg`;
    const upload = await page.request.post(`${api}/assets`, { headers: { ...headers, ...uploadHeaders({ v: 1, kind: 'commercial_type', project_ref: project.public_project_id, ref: item.public_commercial_type_id, category: 'floor_plan', purpose: 'floor_plan' }), 'Content-Type': 'image/svg+xml', 'X-Filename': encodeURIComponent(filename) },
      data: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#fff"/><text x="20" y="90">Synthetic plan ${randomUUID()}</text></svg>` });
    expect(upload.status()).toBe(201);
    await wizard.getByRole('button', { name: '3. แปลนแต่ละชั้น', exact: true }).click();
    await wizard.getByRole('button', { name: 'เลือกจากคลังสื่อ', exact: true }).click();
    await wizard.getByRole('button', { name: `ใช้ไฟล์ ${filename}`, exact: true }).click();
    await wizard.getByLabel('ชื่อแปลนหรือภาพ', { exact: true }).fill('แปลนชั้นล่าง');
    await wizard.getByLabel('คำอธิบายไฟล์ (ไทย)', { exact: true }).fill('แปลนชั้นล่างของบ้าน');
    await wizard.getByRole('combobox', { name: 'ชั้นของแบบบ้าน', exact: true }).selectOption('1');
    await wizard.getByRole('combobox', { name: 'ประเภทห้องในภาพ', exact: true }).selectOption('living_room');
    await wizard.getByLabel('คำบรรยายภาพ (ไทย)', { exact: true }).fill('แปลนพื้นที่นั่งเล่น');
    await wizard.getByLabel('คำบรรยายภาพ (อังกฤษ)', { exact: true }).fill('Living area plan');
    await wizard.getByRole('button', { name: 'ผูกไฟล์กับแบบขาย', exact: true }).click();
    await expect(wizard.getByText('ผูกไฟล์กับแบบขายฉบับร่างแล้ว ยังไม่เผยแพร่ไฟล์', { exact: true })).toBeVisible();
    data = await read(page, `${base}/unit-types`); item = data.types.find((t: { public_name: { th: string } }) => t.public_name.th === name);
    expect(item.assets[0].floor_number).toBe(1); expect(item.assets[0].caption.en).toBe('Living area plan'); expect(item.assets[0].room_tag).toBe('living_room');
    await fits(page); await wizard.screenshot({ path: `artifacts/project-content-phase5/plans-${width}.png` });
    await wizard.getByRole('button', { name: '4. ภาพห้องและ 360', exact: true }).click();
    await expect(wizard.getByRole('button', { name: 'เพิ่มคลิปหรือทัวร์', exact: true })).toBeVisible();
    await wizard.getByRole('button', { name: '6. ราคาและส่งตรวจ', exact: true }).click();
    await expect(wizard.getByRole('option', { name: /ราคา REM อัตโนมัติ/ })).toBeDisabled();
    await expect(workflowControl(wizard, 'unit_type').getByRole('button', { name: workflowText.submit, exact: true })).toBeEnabled();
    await submitItem(wizard, 'unit_type');
    await expect(wizard.getByText('ฉบับที่ส่งตรวจแก้ไขไม่ได้ ผู้อนุมัติส่งกลับก่อนเริ่มแก้ไข')).toBeVisible();
    await persona(page, 'publisher'); await open(page, project.public_project_id, name);
    await wizard.getByRole('button', { name: '6. ราคาและส่งตรวจ', exact: true }).click();
    await approveItem(page, wizard, 'unit_type');
    await wizard.getByText('ประวัติแบบขาย 1 ฉบับ', { exact: true }).click();
    await expect(wizard.locator('.unit-snapshot')).toContainText('ประเภทแบบ');
    await expect(wizard.locator('.unit-snapshot')).toContainText('บ้านเดี่ยว');
    await fits(page); await wizard.screenshot({ path: `artifacts/project-content-phase5/approval-${width}.png` });
    expect((await page.request.patch(`${base}/commercial-types/${item.public_commercial_type_id}`, { headers, data: { updated_at: data.project.updated_at, bedrooms: 2 } })).status()).toBe(403);
  });

  test(`Marketing price validity, preserved errors and approval at ${width}px`, async ({ page }) => {
    test.setTimeout(120000); await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    const project = (await read(page, `${api}/projects`)).find((p: { source: { rem_project_id: string } }) => p.source.rem_project_id === 'DEMO-001');
    const base = `${api}/projects/${project.public_project_id}`, name = `แบบราคา ${width}`;
    const current = await read(page, base);
    expect((await page.request.post(`${base}/commercial-types`, { headers, data: { updated_at: current.updated_at, types: [{ public_name: { th: name, en: `Price type ${width}` }, description: { th: 'บ้านทดสอบ', en: 'Test house' }, category: 'single_house', product_form: 'house', price_mode: 'manual' }] } })).ok()).toBeTruthy();
    let data = await read(page, `${base}/unit-types`), item = data.types.find((t: { public_name: { th: string } }) => t.public_name.th === name);
    await open(page, project.public_project_id, name);
    const wizard = page.getByRole('region', { name: 'แบบขาย 6 ขั้นตอน' });
    await wizard.getByRole('button', { name: '6. ราคาและส่งตรวจ', exact: true }).click();
    await wizard.getByRole('button', { name: 'เพิ่มราคา Marketing', exact: true }).click();
    await wizard.getByLabel('ราคา (บาท)', { exact: true }).fill('1800000'); await wizard.getByLabel('ขนาดที่อ้างอิงราคา (ตร.ม.)', { exact: true }).fill('120');
    const start = await wizard.getByLabel('เริ่มใช้ราคา', { exact: true }).inputValue();
    const end = new Date(`${start}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 61);
    await wizard.getByLabel('วันหมดอายุราคา', { exact: true }).fill(end.toISOString().slice(0, 10));
    for (const [key, thai, english] of [['display_text', 'ราคาเริ่มต้น', 'Starting price'], ['basis', 'แบบบ้านที่ระบุ', 'Specified house type'], ['condition_text', 'เฉพาะยูนิตที่ร่วมรายการ', 'Participating units only']]) {
      await wizard.locator(`#price-${key}-th`).fill(thai); await wizard.locator(`#price-${key}-en`).fill(english);
    }
    await wizard.getByRole('button', { name: 'บันทึกราคา', exact: true }).click();
    await expect(wizard.getByRole('alert')).toBeVisible(); await expect(wizard.getByLabel('ราคา (บาท)', { exact: true })).toHaveValue('1800000');
    end.setUTCDate(end.getUTCDate() - 1); await wizard.getByLabel('วันหมดอายุราคา', { exact: true }).fill(end.toISOString().slice(0, 10));
    await fits(page); await wizard.screenshot({ path: `artifacts/project-content-phase5/price-${width}.png` });
    await wizard.getByRole('button', { name: 'บันทึกราคา', exact: true }).click();
    await expect(wizard.getByRole('button', { name: 'แก้ไขราคา', exact: true })).toBeVisible();
    data = await read(page, `${base}/unit-types`); const price = data.prices.find((p: { commercial_type_id: string }) => p.commercial_type_id === item.id);
    expect(price.valid_to).toBe(end.toISOString().slice(0, 10)); expect(price.ai_exposure).toBe('web_only');
    await reviewEnglish(page, base, price.id); await open(page, project.public_project_id, name);
    await wizard.getByRole('button', { name: '6. ราคาและส่งตรวจ', exact: true }).click();
    await submitItem(wizard, 'price');
    await expect(wizard.getByRole('button', { name: 'แก้ไขราคา', exact: true })).toHaveCount(0);
    await persona(page, 'publisher'); await open(page, project.public_project_id, name); await wizard.getByRole('button', { name: '6. ราคาและส่งตรวจ', exact: true }).click();
    await approveItem(page, wizard, 'price'); await expect(wizard.getByRole('button', { name: 'ถอนราคา', exact: true })).toBeVisible();
    await persona(page, 'viewer'); await open(page, project.public_project_id, name); await wizard.getByRole('button', { name: '6. ราคาและส่งตรวจ', exact: true }).click();
    await expect(wizard.getByRole('button', { name: 'เพิ่มราคา Marketing', exact: true })).toHaveCount(0);
    await expect(wizard.getByRole('button', { name: 'ถอนราคา', exact: true })).toHaveCount(0); await fits(page);
  });
}
