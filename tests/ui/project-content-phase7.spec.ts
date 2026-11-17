import { projectUpload, uploadHeaders } from "./upload-fixtures";
import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { submitItem, approveItem, workflowText } from './content-workflow-fixtures';

const headers = { Origin: 'http://127.0.0.1:3000' }, api = '/api/hub/v1/admin';
async function persona(page: Page, role: string) { expect((await page.request.post('/api/local-session', { headers, data: { role } })).ok()).toBeTruthy(); }
async function read(page: Page, path: string) { const response = await page.request.get(path); expect(response.ok(), path).toBeTruthy(); return (await response.json()).data; }
async function put(page: Page, path: string, expected_revision: number, changes: unknown) {
  const response = await page.request.put(path, { headers, data: { expected_revision, changes } });expect(response.ok(), path).toBeTruthy();return (await response.json()).data;
}
async function project(page: Page) { return (await read(page, `${api}/projects`)).find((r: { source: { rem_project_id: string } }) => r.source.rem_project_id === 'DEMO-001'); }
async function fits(page: Page, screenshot: string, region?: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  const path = `artifacts/project-content-phase7/${screenshot}.png`;
  if (region) await region.screenshot({ path });
  else await page.screenshot({ path, fullPage: true });
}

for (const width of [1280, 390]) {
  test(`Facility details, photos, cover and stale drafts at ${width}px`, async ({ page }) => {
    test.setTimeout(120000);await page.setViewportSize({ width, height: 900 });await persona(page, 'publisher');
    const code = `c4_ui_facility_${width}`, title = `ส่วนกลางสมมติ ${width}`;
    await put(page, `${api}/place-references/facilities/${code}`, 0, { name_th: title, name_en: `Synthetic facility ${width}`, group_code: 'recreation', icon_code: 'building' });
    await persona(page, 'editor');const p = await project(page), base = `${api}/projects/${p.public_project_id}`, amenities = `${base}/amenities`;
    await page.goto(`/content?project=${p.public_project_id}&tab=facilities`);
    await page.getByRole('button', { name: `แก้ไข ${title}`, exact: true }).click();
    await page.locator('#c4-facility-status').selectOption('planned');
    await page.locator('#c4-facility-expected_open_date').fill('2030-01-01');
    await page.locator('#c4-facility-status').selectOption('present');
    await expect(page.locator('#c4-facility-expected_open_date')).toHaveCount(0);
    await page.locator('#c4-facility-display_name-th').fill(title);
    await page.locator('#c4-facility-display_name-en').fill(`Synthetic facility ${width}`);
    await page.locator('#c4-facility-location_label-th').fill('ชั้น 1 · ข้อมูลสมมติ');
    await page.locator('#c4-facility-size_sqm').fill('42.5');
    await page.locator('#c4-facility-opening_hours-th').fill('08:00–20:00');
    await page.locator('#c4-facility-applies_to_project_ids').selectOption(['DEMO-001', 'DEMO-002']);
    await page.getByLabel('การใช้งาน ชื่อที่แสดง', { exact: true }).click();
    await expect(page.locator('.content-field-info[open]').getByText(/ผู้รับผิดชอบ: การตลาด/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'ทำเล', exact: true })).toBeDisabled();
    await fits(page, `facility-edit-${width}`, page.getByRole('heading', { name: 'แก้ไขสิ่งอำนวยความสะดวก', exact: true }).locator('..'));
    await page.getByRole('button', { name: 'บันทึกข้อมูล', exact: true }).click();
    await expect(page.getByText('บันทึกสิ่งอำนวยความสะดวกแล้ว', { exact: true })).toBeVisible();
    const facility = (await read(page, amenities)).facilities.find((f: { code: string }) => f.code === code);
    expect(facility.expected_open_date).toBeNull();expect(facility.applies_to_project_ids).toEqual(['DEMO-001', 'DEMO-002']);
    await page.getByRole('button', { name: `ภาพ ${title}`, exact: true }).click();
    await page.getByRole('link', { name: 'เพิ่มภาพส่วนกลาง', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'ใช้กับ', exact: true })).toHaveValue('facility');
    await expect(page.getByRole('combobox', { name: 'เลือกรายการจากข้อมูลโครงการ', exact: true })).toHaveValue(code);
    await page.getByText('ข้อมูลที่จะใช้กับไฟล์ใหม่ / ไฟล์ที่เลือก', { exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'หมวดสื่อ', exact: true })).toHaveValue('facility');
    await expect(page.getByRole('checkbox', { name: title, exact: true })).toBeChecked();
    await page.goto(`/content?project=${p.public_project_id}&tab=facilities`);

    for (const [index, color] of ['#1c4c55', '#74426b'].entries()) {
      const upload = await page.request.post(`${api}/assets`, { headers: { ...headers, ...uploadHeaders({ v: 1, kind: 'media_target', project_ref: p.public_project_id, target_type: 'facility', target_key: code, category: 'facility', usage: 'gallery' }), 'Content-Type': 'image/svg+xml', 'X-Filename': `c4-${width}-${index}.svg` },
        data: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/><text x="10" y="90" fill="white">Synthetic ${randomUUID()}</text></svg>`) });
      expect(upload.ok()).toBeTruthy();const asset = (await upload.json()).data;
      await put(page, `${base}/media/assets/${asset.id}`, asset.media_revision ?? 0, { media_category: 'facility', tags: [code], caption: { th: `ภาพสมมติ ${index}`, en: `Synthetic image ${index}` }, alt_text: { th: 'ภาพสมมติสำหรับทดสอบ' }, metadata_state: 'confirmed' });
      await put(page, `${base}/media/links/${randomUUID()}`, 0, { asset_id: asset.id, target_type: 'facility', target_key: code, sort: index, is_primary: index === 0 });
    }
    await page.reload();await page.getByRole('button', { name: `ภาพ ${title}`, exact: true }).click();
    const photos = page.getByRole('region', { name: `ภาพส่วนกลาง ${code}` });
    await expect(photos.getByText('2 ภาพที่ผูกไว้ · เลือกภาพปกแล้ว', { exact: true })).toBeVisible();
    await photos.getByRole('button', { name: 'ตั้งเป็นภาพปก', exact: true }).last().click();
    await expect(photos.getByText('เปลี่ยนภาพปกแล้ว', { exact: true })).toBeVisible();
    await photos.getByRole('button', { name: 'แก้คำบรรยายภาพ', exact: true }).first().click();
    await photos.locator('#c4-caption-th').fill('คำบรรยายที่ตรวจสมมติ');await photos.locator('#c4-caption-en').fill('Reviewed synthetic caption');
    await photos.getByRole('button', { name: 'บันทึกคำบรรยาย', exact: true }).click();
    await expect(photos.getByText('บันทึกคำบรรยายภาพแล้ว', { exact: true })).toBeVisible();
    await photos.getByRole('button', { name: 'แก้ลำดับภาพ', exact: true }).first().click();
    await photos.locator('#c4-photo-sort').fill('5');
    await expect(page.getByRole('button', { name: 'ทำเล', exact: true })).toBeDisabled();
    await photos.getByRole('button', { name: 'บันทึกลำดับภาพ', exact: true }).click();
    await expect(photos.getByText('บันทึกลำดับภาพแล้ว', { exact: true })).toBeVisible();
    await fits(page, `facility-photos-${width}`, photos);
    const links = (await read(page, `${base}/media`)).links.filter((l: { target_type: string; target_key: string }) => l.target_type === 'facility' && l.target_key === code);
    expect(links.filter((l: { is_primary: boolean }) => l.is_primary)).toHaveLength(1);
    expect(links.map((l: { sort: number }) => l.sort).sort()).toEqual([1, 5]);
    await page.getByRole('button', { name: `ภาพ ${title}`, exact: true }).click();
    await page.getByRole('button', { name: `แก้ไข ${title}`, exact: true }).click();
    await page.locator('#c4-facility-size_sqm').fill('99');
    await put(page, `${amenities}/facilities/${code}`, facility.revision, { size_sqm: 60 });
    await page.getByRole('button', { name: 'บันทึกข้อมูล', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'ข้อมูลที่กรอกยังอยู่' })).toBeVisible();
    await expect(page.locator('#c4-facility-size_sqm')).toHaveValue('99');
    await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await persona(page, 'viewer');await page.reload();
    await expect(page.getByRole('button', { name: `แก้ไข ${title}`, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: `ภาพ ${title}`, exact: true }).click();
    await expect(photos.getByRole('link', { name: 'เพิ่มภาพส่วนกลาง', exact: true })).toHaveCount(0);
    await expect(photos.getByRole('link', { name: 'ดูเช็กลิสต์ภาพ', exact: true })).toBeVisible();
    await expect(photos.getByRole('button', { name: 'ตั้งเป็นภาพปก', exact: true })).toHaveCount(0);
    expect((await page.request.put(`${amenities}/facilities/${code}`, { headers, data: { expected_revision: 1, changes: { status: 'absent' } } })).status()).toBe(403);
  });

  test(`Feature metrics and approved entered solar scenarios at ${width}px`, async ({ page }) => {
    test.setTimeout(120000);await page.setViewportSize({ width, height: 900 });await persona(page, 'editor');
    const p = await project(page), base = `${api}/projects/${p.public_project_id}/amenities`, profile = `สถานการณ์สมมติ ${width}`;
    await page.goto(`/content?project=${p.public_project_id}&tab=features`);
    const existing = (await read(page, base)).features.find((f: { feature_code: string }) => f.feature_code === 'ev_charger');
    await page.getByRole('button', { name: existing ? 'แก้ไข เครื่องชาร์จรถไฟฟ้า' : 'เพิ่มคุณสมบัติโครงการ', exact: true }).click();
    await page.locator('#c4-feature-code').selectOption('ev_charger');await page.locator('#c4-feature-status').selectOption('present');
    await page.locator('#c4-metric-count').fill('1.5');
    expect(await page.locator('#c4-metric-count').evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
    await page.locator('#c4-metric-count').fill('2');await page.locator('#c4-metric-power_kw').fill('22');await page.locator('#c4-metric-current_type').selectOption('AC');
    await page.locator('#c4-feature-detail-th').fill('จุดชาร์จสมมติ 2 จุด');await page.locator('#c4-feature-source_note-th').fill('เอกสารสมมติสำหรับทดสอบ');
    await fits(page, `feature-metrics-${width}`);await page.getByRole('button', { name: 'บันทึกข้อมูล', exact: true }).click();
    await expect(page.getByText('บันทึกคุณสมบัติโครงการแล้ว', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'เพิ่มสถานการณ์ประมาณการโซลาร์', exact: true }).click();
    for (const [key, value] of Object.entries({ system_kw: '5', battery_kwh: '10', bill_before: '4000', bill_after: '2500', saving_pct: '17' })) await page.locator(`#c4-solar_estimate-${key}`).fill(value);
    await page.locator('#c4-solar_estimate-usage_profile-th').fill(profile);
    await page.locator('#c4-solar_estimate-assumptions-th').fill('ข้อมูลสมมติ ไม่ใช่การคำนวณผลประหยัด');
    await page.locator('#c4-solar_estimate-source_note-th').fill('เอกสารอ้างอิงสมมติ');await page.locator('#c4-solar_estimate-as_of').fill('2026-10-21');
    await fits(page, `solar-entered-${width}`);await page.getByRole('button', { name: 'บันทึกข้อมูล', exact: true }).click();
    await expect(page.getByText('บันทึกสถานการณ์ประมาณการโซลาร์แล้ว', { exact: true })).toBeVisible();
    const saved = (await read(page, base)).solar.find((s: { usage_profile: { th: string } }) => s.usage_profile.th === profile);
    expect(saved.saving_pct).toBe(17);expect(saved.state).toBe('draft');expect(saved.ai_exposure).toBe('web_only');
    expect((await page.request.post(`${base}/solar/${saved.id}/review`, { headers, data: { expected_revision: saved.revision, decision: 'approve' } })).status()).toBe(403);
    const submittedCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: `ข้อมูล ณ ${saved.as_of}`, exact: true }) }).filter({ has: page.getByText(profile, { exact: true }) });
    await submitItem(submittedCard, 'solar');
    await persona(page, 'publisher');await page.reload();
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: `ข้อมูล ณ ${saved.as_of}`, exact: true }) }).filter({ has: page.getByText(profile, { exact: true }) });
    await approveItem(page, card, 'solar'); await expect(card).toContainText('อนุมัติสถานการณ์แล้ว');
    await expect(page.getByRole('button', { name: 'ทำเล', exact: true })).toBeEnabled();
    await fits(page, `solar-approved-${width}`);
    await card.getByRole('button', { name: 'ถอนสถานการณ์', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: workflowText.confirm, exact: true })).toBeDisabled();
    await page.getByRole('dialog').getByRole('textbox', { name: workflowText.reason, exact: true }).fill('Withdraw synthetic scenario after independent review');
    await page.getByRole('dialog').getByRole('button', { name: workflowText.confirm, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(card).toContainText('ถอนแล้ว');
    await page.getByRole('button', { name: 'ทำเล', exact: true }).click();
    await page.getByText('จัดการข้อมูลอ้างอิง', { exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'ประเภทข้อมูลอ้างอิง', exact: true })).toHaveValue('rail_lines');
  });

  test(`Reference CSV preview, coordinates and nearby place draft at ${width}px`, async ({ page }) => {
    test.setTimeout(120000);await page.setViewportSize({ width, height: 900 });await persona(page, 'publisher');
    const p = await project(page), station = `c4_station_${width}`, name = `สถานีสมมติ ${width}`;
    await page.goto(`/content?project=${p.public_project_id}&tab=places`);
    await page.getByText('จัดการข้อมูลอ้างอิง', { exact: true }).click();
    const download = page.waitForEvent('download');await page.getByRole('button', { name: 'ดาวน์โหลดแม่แบบ CSV', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('place-references.csv');
    const template = (await read(page, `${api}/place-references/template`)).content.trim();
    const text = `${template}\nrail_stations,${station},0,${name},Synthetic station ${width},mrt_blue,,13.7563,100.5018,planned,2030-01-01,Synthetic fixture only,2026-10-21\n`;
    await page.getByLabel('เลือกไฟล์ CSV', { exact: true }).setInputFiles({ name: 'synthetic-references.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
    await page.getByRole('button', { name: 'ตรวจรายการนำเข้า', exact: true }).click();
    await expect(page.getByText('ผ่านการตรวจ 1 รายการ · ยังไม่บันทึก', { exact: true })).toBeVisible();
    expect((await read(page, `${api}/place-references`)).rail_stations.some((r: { code: string }) => r.code === station)).toBe(false);
    await fits(page, `reference-preview-${width}`);await page.getByRole('button', { name: 'ยืนยันนำเข้า 1 รายการ', exact: true }).click();
    await expect(page.getByText('นำเข้า 1 รายการแล้ว', { exact: true })).toBeVisible();
    await persona(page, 'editor');await page.reload();
    await page.getByRole('button', { name: `เลือกสถานี ${name}`, exact: true }).click();
    await expect(page.locator('#c4-place-status')).toHaveValue('planned');await expect(page.locator('#c4-place-distance_method')).toHaveValue('straight_line');
    await page.locator('#c4-place-distance_m').fill('350');await page.locator('#c4-place-distance_method').selectOption('road');
    await page.locator('#c4-place-travel_minutes').fill('5');await page.locator('#c4-place-travel_mode').selectOption('walk');
    await page.locator('#c4-place-show_on_web').check();await fits(page, `place-edit-${width}`);
    await page.getByRole('button', { name: 'บันทึกข้อมูล', exact: true }).click();
    await expect(page.getByText('บันทึกสถานที่ใกล้เคียงแล้ว', { exact: true })).toBeVisible();
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card).toContainText('อยู่ในแผน');await expect(card).toContainText('350 เมตร · ตามถนน');await fits(page, `place-saved-${width}`);
    await page.getByText('ดูข้อมูลอ้างอิง', { exact: true }).click();await expect(page.getByLabel('เลือกไฟล์ CSV', { exact: true })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'ประเภทข้อมูลอ้างอิง', exact: true }).selectOption('rail_stations');
    const referenceCard = page.getByRole('article').filter({ has: page.getByText(station, { exact: true }) });
    await expect(referenceCard).toContainText('แหล่งข้อมูล: Synthetic fixture only');
    await expect(referenceCard).toContainText('พิกัดอ้างอิง: 13.7563, 100.5018');
    await persona(page, 'agency_kin');
    expect((await page.request.get(`${api}/projects/${p.public_project_id}/amenities`)).status()).toBe(403);
    expect((await page.request.get(`${api}/place-references`)).status()).toBe(403);
    await page.reload();await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  });
}
