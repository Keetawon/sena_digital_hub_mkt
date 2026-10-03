import { expect, test, type Page } from '@playwright/test';

const time = '2026-09-18T08:00:00Z';
const model = (id: string) => ({ id, public_model_id: id, rem_model_id: id, model_name_rem: id, public_name: { th: `แบบ ${id}` }, bedrooms: null, bathrooms: null, usable_area_sqm: null, parking_spaces: null, match_status: 'SUGGESTED', source_updated_at: null, source_snapshot_at: time, source_record: null, intake_manifest_sha256: 'a'.repeat(64) });
const binding = (id: string, owner: string | null, role: string) => ({ id, binding_id: id, public_model_id: owner, asset_role: role, original_filename: `${id}.pdf`, mime_type: 'application/pdf', rights_status: 'pending', public_url: null, alt_text: { th: id }, display_order: 0 });
const fixture = () => ({
  public_project_id: 'form-test', public_name: { th: 'ชื่อที่ทีมงานแก้แล้ว', en: 'Edited name', zh: '保留名称' }, address: { th: 'ที่อยู่ที่แก้แล้ว', en: 'Edited address', zh: '保留地址' }, slug: 'form-test', latitude: null, longitude: null,
  updated_at: time, published_version_id: null, publication_available: false,
  readiness: { ready: false, percent: 25, missing: [{ field: 'slug', message: 'กรอกรหัส URL' }, { field: 'models.model-A', message: 'ตรวจสอบแบบ A' }] },
  source: { rem_project_id: 'TEST-PROJECT', project_name_rem: 'ชื่อทางการ REM', source_updated_at: null, source_snapshot_at: time, source_record: null, intake_manifest_sha256: 'a'.repeat(64) },
  gold_source: { source_relation: 'gold.dim_project', source_snapshot_at: time, source_fingerprint: 'b'.repeat(64), provenance: { type: 'synthetic test fixture', quality_warnings: ['ตรวจการสะกดภาษาไทยเทียบกับ REM', null, { ignored: true }] }, record: { commercial_brand: 'แบรนด์จำลอง', project_id: 'TEST-PROJECT', rem_project_group_id: 'GROUP-1', project_name: 'ชื่อทางการ REM', project_name_eng: 'Official REM name', commercial_project_name: 'ค่าเริ่มต้นไทย', commercial_project_name_eng: 'Default English', moo: null, road: 'ถนนจำลอง', district: 'เขตจำลอง', province: 'จังหวัดจำลอง', postcode: '10000', road_eng: 'Sample road', district_eng: 'Sample district', province_eng: 'Sample province', latitude: 13.5, longitude: 100.5 }, model_groups: [{ model_ids: ['model-A'], model_name: 'กลุ่มแบบจำลอง', model_name_eng: 'Test group', model_type_ids: ['CON1'], minimum_model_area: 25, maximum_model_area: 30, model_attribute_variant: true }] },
  models: [{ ...model('model-B'), public_name: { th: 'model-B' } }, model('model-A10'), model('model-A'), model('model-A2')], assets: [binding('project-plan', null, 'master_plan'), binding('model-a-plan', 'model-A', 'floor_plan'), binding('model-b-plan', 'model-B', 'floor_plan')],
});

async function openFixture(page: Page, gold = true) {
  const project = fixture();
  await page.context().addCookies([{ name: 'sena_local_persona', value: 'editor', url: 'http://127.0.0.1:3000' }]);
  await page.route('**/api/hub/v1/admin/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/hub/v1/admin/', '');
    if (route.request().method() === 'PATCH') {
      Object.assign(project, route.request().postDataJSON());
      await route.fulfill({ json: { data: project } });
    } else if (path === 'projects/form-test') {
      await route.fulfill({ json: { data: { ...project, gold_source: gold ? project.gold_source : null } } });
    } else await route.fulfill({ json: { data: [] } });
  });
  await page.goto('/?project=form-test');
  await expect(page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)', { exact: true })).toBeVisible();
  return project;
}

test('Thailand coordinates reject zero and outside bounds, accept pasted pairs and open Maps', async ({ page }) => {
  const project = await openFixture(page);
  const latitude = page.locator('#latitude'), longitude = page.locator('#longitude');
  for (const [lat, lng, invalid] of [['0', '0', '#latitude'], ['4.99', '100', '#latitude'], ['21.01', '100', '#latitude'], ['13', '96.99', '#longitude'], ['13', '106.01', '#longitude']]) {
    await latitude.fill(lat);
    await longitude.fill(lng);
    await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
    await expect(page.locator(invalid)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator(invalid)).toBeFocused();
    expect(project.latitude).toBeNull();
    await expect(page.getByRole('link', { name: /เปิดใน Google Maps/ })).toHaveCount(0);
  }
  for (const [lat, lng] of [['5', '97'], ['21', '106']]) {
    await latitude.fill(lat);
    await longitude.fill(lng);
    await longitude.blur();
    await expect(page.getByRole('link', { name: /เปิดใน Google Maps/ })).toHaveAttribute('href', `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lng}`);
  }
  await longitude.evaluate(node => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text', ' 13.7563, 100.5018 ');
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(latitude).toHaveValue('13.7563');
  await expect(longitude).toHaveValue('100.5018');
  await expect(page.getByRole('link', { name: /เปิดใน Google Maps/ })).toHaveAttribute('rel', 'noopener noreferrer');
  await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
  await expect(page.getByText('บันทึกข้อมูลร่างแล้ว ข้อมูลที่เผยแพร่ยังคงเป็นเวอร์ชันเดิม', { exact: true })).toBeVisible();
  expect(project.latitude).toBe(13.7563);
  expect(project.longitude).toBe(100.5018);
});

test('ordered source fields, bilingual draft and unsaved edits survive all three tabs', async ({ page }) => {
  const project = await openFixture(page);
  const fields = page.locator('.project-fields input, .project-fields textarea');
  expect(await fields.evaluateAll(nodes => nodes.map(node => node.id))).toEqual(['gold-commercial_brand', 'gold-project_id', 'gold-rem_project_group_id', 'gold-project_name', 'public_name', 'gold-project_name_eng', 'public_name_en', 'address', 'address_en', 'latitude', 'longitude']);
  await expect(page.locator('#gold-project_name')).toHaveAttribute('readonly', '');
  await expect(page.locator('#public_name')).toHaveValue('ชื่อที่ทีมงานแก้แล้ว');
  await page.locator('#public_name_en').fill('Revised English');
  await page.locator('#address_en').fill('Revised address');
  const content = page.getByRole('tab', { name: 'ข้อมูลโครงการ', exact: true });
  await content.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /แบบที่อยู่อาศัย/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'เผยแพร่และประวัติ', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(content).toBeFocused();
  await expect(page.locator('#public_name_en')).toHaveValue('Revised English');
  await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
  await expect(page.getByText('บันทึกข้อมูลร่างแล้ว ข้อมูลที่เผยแพร่ยังคงเป็นเวอร์ชันเดิม', { exact: true })).toBeVisible();
  expect(project.public_name).toEqual({ th: 'ชื่อที่ทีมงานแก้แล้ว', en: 'Revised English', zh: '保留名称' });
  expect(project.address).toEqual({ th: 'ที่อยู่ที่แก้แล้ว', en: 'Revised address', zh: '保留地址' });
  expect(await page.locator('.project-details').evaluate(node => node.closest('form')?.nextElementSibling?.id)).toBe('assets');
  await page.screenshot({ path: 'artifacts/project-form-desktop.png', fullPage: true });
});

test('readiness links reveal correct tab and advanced field; model plans stay scoped', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('tab', { name: /แบบที่อยู่อาศัย/ }).click();
  await page.getByText('รหัสแบบและข้อมูลอ้างอิง REM', { exact: true }).click();
  const modelSelector = page.getByLabel('เลือกแบบที่ต้องการจัดการ', { exact: true });
  await expect(modelSelector).toHaveValue('model-A');
  expect(await modelSelector.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['model-A', 'model-A2', 'model-A10', 'model-B']);
  await expect(modelSelector.locator('option[value="model-B"]')).toHaveText('model-B');
  await page.getByRole('tab', { name: 'ข้อมูลโครงการ', exact: true }).click();
  await expect(page.locator('#assets')).toContainText('project-plan.pdf');
  await expect(page.locator('#assets')).not.toContainText('model-a-plan.pdf');
  await page.getByRole('tab', { name: 'เผยแพร่และประวัติ', exact: true }).click();
  await page.locator('.readiness-groups summary').filter({ hasText: 'ข้อมูลโครงการ' }).click();
  await page.getByRole('link', { name: 'กรอกรหัส URL', exact: true }).click();
  await expect(page.locator('#slug')).toBeVisible();
  await expect(page.locator('#slug')).toBeFocused();
  await page.getByRole('tab', { name: 'เผยแพร่และประวัติ', exact: true }).click();
  await page.locator('.readiness-groups summary').filter({ hasText: 'แบบที่อยู่อาศัย' }).click();
  await page.getByRole('link', { name: 'ตรวจสอบแบบ A', exact: true }).click();
  await expect(page.getByRole('tab', { name: /แบบที่อยู่อาศัย/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#model-media')).toContainText('model-a-plan.pdf');
  await expect(page.locator('#model-media')).not.toContainText('model-b-plan.pdf');
  await page.getByText('ข้อมูลแบบจาก DW สำหรับตรวจสอบ', { exact: true }).click();
  await expect(page.locator('.gold-model-evidence')).toContainText('ต้นทางมีหลายกลุ่มหรือหลายรูปแบบ');
  await page.getByLabel('เลือกแบบที่ต้องการจัดการ', { exact: true }).selectOption('model-B');
  await expect(page.locator('#model-media')).toContainText('model-b-plan.pdf');
  await expect(page.locator('#model-media')).not.toContainText('model-a-plan.pdf');
  await page.getByRole('tab', { name: 'เผยแพร่และประวัติ', exact: true }).click();
  await page.getByRole('link', { name: 'ตรวจสอบแบบ A', exact: true }).click();
  await expect(page.getByLabel('เลือกแบบที่ต้องการจัดการ', { exact: true })).toHaveValue('model-A');
});

test('missing Gold is explicit and the mobile tabs do not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFixture(page, false);
  await expect(page.locator('#gold-project_id')).toHaveValue('ยังไม่มีข้อมูลจาก DW');
  await expect(page.locator('#public_name')).toHaveValue('ชื่อที่ทีมงานแก้แล้ว');
  await expect(page.getByRole('button', { name: 'เติมค่าเริ่มต้นจาก DW', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'artifacts/project-form-mobile.png', fullPage: true });
});

test('reviewed defaults appear without writes; save-and-continue advances only after a successful save', async ({ page }) => {
  const project = { ...fixture(), public_name: { th: 'ชื่อที่ทีมงานแก้แล้ว', en: '', zh: '保留名称' }, address: { th: '', en: '', zh: '保留地址' }, gold_prefill_changes: {
    public_name: { th: 'ชื่อที่ทีมงานแก้แล้ว', en: 'Default English', zh: '保留名称' },
    address: { th: 'ถนนจำลอง เขตจำลอง จังหวัดจำลอง 10000', en: 'Sample road Sample district Sample province 10000', zh: '保留地址' },
    latitude: 13.5, longitude: 100.5,
  } };
  let writes = 0;
  let failSave = true;
  await page.context().addCookies([{ name: 'sena_local_persona', value: 'editor', url: 'http://127.0.0.1:3000' }]);
  await page.route('**/api/hub/v1/admin/**', async route => {
    if (route.request().method() !== 'GET') {
      writes++;
      if (failSave) return route.fulfill({ status: 409, json: { error: { message: 'ข้อมูลเปลี่ยนแปลง กรุณาตรวจสอบ' } } });
      Object.assign(project, route.request().postDataJSON(), { gold_prefill_changes: {} });
    }
    return route.fulfill({ json: { data: route.request().url().endsWith('/projects/form-test') ? project : [] } });
  });
  await page.goto('/?project=form-test');
  await expect(page.locator('#public_name')).toHaveValue('ชื่อที่ทีมงานแก้แล้ว');
  await expect(page.locator('#public_name_en')).toHaveValue('Default English');
  await expect(page.locator('#address')).toHaveValue(project.gold_prefill_changes.address.th);
  await expect(page.locator('#address_en')).toHaveValue(project.gold_prefill_changes.address.en);
  await expect(page.locator('#latitude')).toHaveValue('13.5');
  await expect(page.locator('#longitude')).toHaveValue('100.5');
  expect(writes).toBe(0);
  await page.locator('#public_name_en').fill('Reviewed English');
  await page.getByRole('button', { name: 'บันทึกและไปต่อ', exact: true }).click();
  await expect(page.locator('.notice[role="alert"]')).toContainText('ข้อมูลเปลี่ยนแปลง');
  await expect(page.getByRole('tab', { name: 'ข้อมูลโครงการ', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#public_name_en')).toHaveValue('Reviewed English');
  failSave = false;
  await page.getByRole('button', { name: 'บันทึกและไปต่อ', exact: true }).click();
  await expect(page.getByRole('tab', { name: /แบบที่อยู่อาศัย/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#models-panel')).toBeFocused();
  expect(project.public_name.en).toBe('Reviewed English');
  expect(project.address.zh).toBe('保留地址');
  await page.getByRole('button', { name: 'ถัดไป: ตรวจความพร้อม', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'เผยแพร่และประวัติ', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(project.published_version_id).toBeNull();
});

test('adding a second model plan uses the selected model route and retains existing plans', async ({ page }) => {
  const project = await openFixture(page);
  const qualityNote = page.getByRole('note', { name: 'ข้อควรตรวจสอบจาก DW' });
  await expect(qualityNote).toContainText('ตรวจการสะกดภาษาไทยเทียบกับ REM');
  await expect(qualityNote.getByRole('listitem')).toHaveCount(1);
  const asset = { ...binding('additional-plan', null, 'floor_plan'), checksum: 'c'.repeat(64), file_size: 200, width: null, height: null, updated_at: time, effective_from: null, effective_to: null };
  await page.route('**/api/hub/v1/admin/assets', route => route.fulfill({ json: { data: [asset] } }));
  await page.route('**/api/hub/v1/admin/projects/form-test/models/model-A/assets', async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ asset_id: 'additional-plan', asset_role: 'floor_plan', alt_text: { th: 'แปลนแบบ A อาคารทดสอบ ชั้น 3' }, updated_at: time });
    project.assets.push(binding('additional-plan', 'model-A', 'floor_plan'));
    await route.fulfill({ json: { data: project } });
  });
  await page.getByRole('tab', { name: /แบบที่อยู่อาศัย/ }).click();
  await page.getByText('รหัสแบบและข้อมูลอ้างอิง REM', { exact: true }).click();
  const media = page.locator('#model-media');
  await media.getByRole('button', { name: 'เปิดคลังสื่อ', exact: true }).click();
  await media.getByRole('button', { name: 'เลือกใช้กับแบบที่อยู่อาศัย', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('บทบาทของไฟล์').selectOption('floor_plan');
  await expect(dialog).not.toContainText('จะแทนที่');
  await dialog.getByLabel('คำอธิบายภาพ (ภาษาไทย)', { exact: true }).fill('แปลนแบบ A อาคารทดสอบ ชั้น 3');
  await dialog.getByRole('button', { name: 'ผูกไฟล์กับแบบที่อยู่อาศัย', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(media.locator('.bound-assets')).toContainText('additional-plan.pdf');
  await expect(media.locator('.bound-assets')).toContainText('model-a-plan.pdf');
  await expect(media.locator('.bound-assets')).not.toContainText('model-b-plan.pdf');
  expect(project.published_version_id).toBeNull();
});
