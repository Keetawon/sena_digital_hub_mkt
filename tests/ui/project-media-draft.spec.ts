import { expect, test, type Page } from '@playwright/test';

const initialRevision = '2026-09-21T00:00:00Z';
const projectId = 'media-draft-test';
const projectPath = `projects/${projectId}`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1kAAAAASUVORK5CYII=', 'base64');
const asset = (id: string) => ({
  id, original_filename: `${id}.png`, mime_type: 'image/png', public_url: null,
  checksum: 'a'.repeat(64), file_size: png.length, width: 1, height: 1,
  rights_status: 'pending', rights_notes: null, updated_at: initialRevision,
  effective_from: null, effective_to: null, reviewed_by: null, reviewed_at: null,
  review_reason: null, storage_path: null,
});
const binding = (image: ReturnType<typeof asset>, role: string, owner: string | null = null, alt = 'ภาพจำลอง') => ({
  ...image, binding_id: `binding-${image.id}`, asset_role: role, public_model_id: owner,
  alt_text: { th: alt }, display_order: 0,
});

async function openFixture(page: Page) {
  const project = {
    public_project_id: projectId, public_name: { th: 'โครงการจำลอง', en: 'Saved name', zh: '保留名称' },
    address: { th: 'ที่อยู่เดิม', en: 'Saved address', zh: '保留地址' },
    slug: projectId, latitude: null, longitude: null, updated_at: initialRevision,
    ad_disclaimer: { th: 'เงื่อนไขจำลอง', en: 'Keep disclaimer' },
    meta_title: { th: 'ชื่อเรื่องเดิม', zh: '保留标题' },
    meta_description: { th: 'คำอธิบายเดิม', en: 'Keep description' },
    published_version_id: null, publication_available: false,
    readiness: { ready: false, missing: [{ field: 'assets.hero', message: 'ตรวจสิทธิ์ภาพหลัก' }] },
    source: { rem_project_id: 'SYNTHETIC-MEDIA', project_name_rem: 'ชื่ออ้างอิงจำลอง', source_snapshot_at: initialRevision, source_updated_at: null },
    assets: [] as ReturnType<typeof binding>[],
    models: [{ id: 'model-A', public_model_id: 'model-A', rem_model_id: 'A1', model_name_rem: 'A1', public_name: { th: 'แบบเอ' }, bedrooms: 1, bathrooms: 1, usable_area_sqm: 30, parking_spaces: 1, match_status: 'CONFIRMED', source_snapshot_at: initialRevision, source_updated_at: null }],
  };
  const library = [asset('replacement')];
  const writes: { method: string; path: string; body: any }[] = [];
  let revision = 0;
  const advance = () => { project.updated_at = `2026-09-21T00:00:0${++revision}Z`; };
  let remoteEditOnBind = false;
  await page.context().addCookies([{ name: 'sena_local_persona', value: 'editor', url: 'http://127.0.0.1:3000' }]);
  // Keep every admin operation synthetic, including previews and uploads.
  await page.route('**/api/hub/v1/admin/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/hub/v1/admin/', '');
    const method = request.method();
    if (method === 'GET') {
      if (/^assets\/[^/]+\/file$/.test(path)) return route.fulfill({ contentType: 'image/png', body: png });
      return route.fulfill({ json: { data: path === 'assets' ? library : path === projectPath || path === `${projectPath}/models/model-A` ? project : [] } });
    }
    if (path === 'assets' && method === 'POST') {
      expect(request.postDataBuffer()).toEqual(png);
      const uploaded = asset('uploaded');
      library.push(uploaded);
      writes.push({ method, path, body: null });
      return route.fulfill({ status: 201, json: { data: uploaded, meta: { reused: false } } });
    }
    const body = request.postDataJSON();
    writes.push({ method, path, body });
    if (remoteEditOnBind && path.endsWith('/assets')) {
      remoteEditOnBind = false;
      project.public_name.en = 'Name saved by another editor';
      project.public_name.zh = '其他编辑保存的名称';
      project.address.en = 'Address saved by another editor';
      advance();
    }
    if (body.updated_at !== project.updated_at) return route.fulfill({ status: 409, json: { error: { code: 'conflict', message: 'ข้อมูลโครงการเปลี่ยนแปลงแล้ว กรุณาตรวจสอบข้อมูลล่าสุด' } } });
    if (method === 'PATCH' && path === projectPath) Object.assign(project, body);
    else if (method === 'POST' && path.endsWith('/assets')) {
      const owner = path.includes('/models/') ? 'model-A' : null;
      const selected = library.find(item => item.id === body.asset_id)!;
      expect(selected).toBeTruthy();
      project.assets.push(binding(selected, body.asset_role, owner, body.alt_text.th));
    } else if (method === 'POST' && path.endsWith('/remove')) {
      const bindingId = path.split('/').at(-2);
      project.assets = project.assets.filter(item => item.binding_id !== bindingId);
    } else throw new Error(`Unexpected mocked write: ${method} ${path}`);
    advance();
    return route.fulfill({ json: { data: project } });
  });
  await page.goto(`/?project=${projectId}`);
  await expect(page.locator('#public_name')).toHaveValue('โครงการจำลอง');
  return { project, writes, conflictOnNextBind: () => { remoteEditOnBind = true; } };
}

async function editText(page: Page) {
  await page.locator('#public_name').fill('ชื่อที่กำลังแก้ไข');
  await page.locator('#public_name_en').fill('Unsaved English name');
  await page.locator('#address').fill('ที่อยู่ที่กำลังแก้ไข');
  await page.locator('#address_en').fill('Unsaved English address');
}

async function expectLocalText(page: Page) {
  await expect(page.locator('#public_name')).toHaveValue('ชื่อที่กำลังแก้ไข');
  await expect(page.locator('#public_name_en')).toHaveValue('Unsaved English name');
  await expect(page.locator('#address')).toHaveValue('ที่อยู่ที่กำลังแก้ไข');
  await expect(page.locator('#address_en')).toHaveValue('Unsaved English address');
}

async function chooseReplacement(page: Page) {
  await page.getByRole('tab', { name: /รูปภาพ/ }).click();
  const media = page.locator('#assets');
  await media.getByRole('button', { name: 'เปิดคลังสื่อ', exact: true }).click();
  await media.getByLabel('ค้นหาชื่อไฟล์ในคลัง', { exact: true }).fill('replacement');
  await media.locator('[data-asset-library] article').filter({ hasText: 'replacement.png' }).getByRole('button', { name: 'เลือกใช้กับโครงการ', exact: true }).click();
  await page.getByRole('dialog').getByLabel('คำอธิบายภาพ (ภาษาไทย)', { exact: true }).fill('ภาพทดแทนจำลอง');
}

test('dirty project text survives upload, another image and removal; save uses the latest media revision', async ({ page }) => {
  const fixture = await openFixture(page);
  await editText(page);
  await page.getByRole('tab', { name: /รูปภาพ/ }).click();
  const media = page.locator('#assets');
  await expect(media.getByRole('button', { name: 'อัปโหลดไฟล์', exact: true })).toBeEnabled();
  await media.getByRole('button', { name: 'อัปโหลดไฟล์', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('เลือกไฟล์ภาพหรือ PDF', { exact: true }).setInputFiles({ name: 'uploaded.png', mimeType: 'image/png', buffer: png });
  await dialog.getByLabel('คำอธิบายภาพ (ภาษาไทย) · uploaded.png', { exact: true }).fill('ภาพหลักจำลอง');
  await dialog.getByRole('button', { name: 'อัปโหลดและเพิ่มไฟล์', exact: true }).click();
  await expect(dialog).toContainText('เพิ่มแล้ว 1 จาก 1 ไฟล์');
  await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(media.locator('.bound-assets')).toContainText('uploaded.png');
  await expectLocalText(page);

  await chooseReplacement(page);
  dialog = page.getByRole('dialog');
  await expect(dialog).not.toContainText('จะแทนที่');
  await dialog.getByRole('button', { name: 'บันทึกไฟล์กับโครงการ', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(media.locator('.bound-assets')).toContainText('replacement.png');
  await expect(media.locator('.bound-assets')).toContainText('uploaded.png');
  await expectLocalText(page);

  await media.locator('.bound-assets article').filter({ hasText: 'replacement.png' }).getByRole('button', { name: 'นำออกจากโครงการ', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'ยืนยันนำออกจากโครงการ', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(media.locator('.bound-assets')).toContainText('uploaded.png');
  await expect(media.locator('.bound-assets')).not.toContainText('replacement.png');
  await expectLocalText(page);
  expect(fixture.project.public_name.en).toBe('Saved name');
  expect(fixture.writes.filter(write => write.method === 'PATCH')).toHaveLength(0);
  expect(fixture.writes.filter(write => write.path !== 'assets').map(write => write.body.updated_at)).toEqual([initialRevision, '2026-09-21T00:00:01Z', '2026-09-21T00:00:02Z']);

  await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
  await expect(page.getByText('บันทึกข้อมูลร่างแล้ว ข้อมูลที่เผยแพร่ยังคงเป็นเวอร์ชันเดิม', { exact: true })).toBeVisible();
  const saved = fixture.writes.at(-1)!;
  expect(saved.method).toBe('PATCH');
  expect(saved.body.updated_at).toBe('2026-09-21T00:00:03Z');
  expect(saved.body.public_name).toEqual({ th: 'ชื่อที่กำลังแก้ไข', en: 'Unsaved English name', zh: '保留名称' });
  expect(saved.body.address).toEqual({ th: 'ที่อยู่ที่กำลังแก้ไข', en: 'Unsaved English address', zh: '保留地址' });
  expect(saved.body.ad_disclaimer.en).toBe('Keep disclaimer');
  expect(saved.body.meta_title.zh).toBe('保留标题');
  expect(saved.body.meta_description.en).toBe('Keep description');
  expect(fixture.project.published_version_id).toBeNull();
});

test('refreshing a media conflict preserves local text without allowing it to overwrite another editor', async ({ page }) => {
  const fixture = await openFixture(page);
  await editText(page);
  await chooseReplacement(page);
  fixture.conflictOnNextBind();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'บันทึกไฟล์กับโครงการ', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('ข้อมูลโครงการเปลี่ยนแปลงแล้ว');
  page.once('dialog', confirmation => confirmation.accept());
  await dialog.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expectLocalText(page);
  await expect(page.locator('.notice.error[role="alert"]')).toContainText('ข้อมูลโครงการถูกแก้ไขจากที่อื่น');

  await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
  await expect(page.locator('.notice.error[role="alert"]')).toContainText('ข้อมูลโครงการเปลี่ยนแปลงแล้ว');
  await expectLocalText(page);
  const attemptedSave = fixture.writes.at(-1)!;
  expect(attemptedSave.method).toBe('PATCH');
  expect(attemptedSave.body.updated_at).toBe(initialRevision);
  expect(fixture.project.public_name.en).toBe('Name saved by another editor');
  expect(fixture.project.public_name.zh).toBe('其他编辑保存的名称');
  expect(fixture.project.address.en).toBe('Address saved by another editor');
  expect(fixture.project.assets).toHaveLength(0);
});

test('model-scoped plan binding also preserves dirty project text and advances its save revision', async ({ page }) => {
  const fixture = await openFixture(page);
  await editText(page);
  await page.getByRole('tab', { name: /แบบที่อยู่อาศัย/ }).click();
  const media = page.locator('#model-media');
  await expect(media.getByRole('button', { name: 'อัปโหลดไฟล์', exact: true })).toBeEnabled();
  await media.getByRole('button', { name: 'เปิดคลังสื่อ', exact: true }).click();
  await media.getByRole('button', { name: 'เลือกใช้กับแบบที่อยู่อาศัย', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('บทบาทของไฟล์', { exact: true }).selectOption('floor_plan');
  await dialog.getByLabel('คำอธิบายภาพ (ภาษาไทย)', { exact: true }).fill('แปลนแบบเอจำลอง');
  await dialog.getByRole('button', { name: 'ผูกไฟล์กับแบบที่อยู่อาศัย', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(media.locator('.bound-assets')).toContainText('replacement.png');
  expect(fixture.writes[0].path).toBe(`${projectPath}/models/model-A/assets`);
  await page.getByRole('tab', { name: /ข้อมูลหลัก/ }).click();
  await expect(page.locator('#assets .bound-assets')).toHaveCount(0);
  await expectLocalText(page);
  await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
  await expect(page.getByText('บันทึกข้อมูลร่างแล้ว ข้อมูลที่เผยแพร่ยังคงเป็นเวอร์ชันเดิม', { exact: true })).toBeVisible();
  expect(fixture.writes.at(-1)?.body.updated_at).toBe('2026-09-21T00:00:01Z');
  expect(fixture.project.public_name.en).toBe('Unsaved English name');
  expect(fixture.project.public_name.zh).toBe('保留名称');
});
