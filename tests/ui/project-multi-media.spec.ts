import { fulfilWorkspaceProjection } from './unified-workspace-helpers';
import { openWorkspaceTab } from './unified-workspace-helpers';
import { expect, test, type Page } from '@playwright/test';

const projectId = 'multi-media-test';
const projectPath = `projects/${projectId}`;
const initialRevision = '2026-09-21T08:00:00Z';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1kAAAAASUVORK5CYII=', 'base64');
const file = (name: string, mimeType = 'image/png') => ({ name, mimeType, buffer: Buffer.concat([png, Buffer.from(name)]) });
const asset = (name: string, mime_type = 'image/png') => ({
  id: `asset-${name}`, original_filename: name, mime_type, public_url: null, checksum: 'a'.repeat(64),
  file_size: png.length, width: 1, height: 1, rights_status: 'pending', rights_notes: null,
  updated_at: initialRevision, effective_from: null, effective_to: null, reviewed_by: null,
  reviewed_at: null, review_reason: null, storage_path: null,
});
const binding = (image: ReturnType<typeof asset>, role: string, order = 0, alt = 'ภาพเดิม') => ({
  ...image, binding_id: `binding-${image.id}-${role}`, asset_role: role, public_model_id: null,
  display_order: order, alt_text: { th: alt },
});

async function openFixture(page: Page, failure?: { stage: 'upload' | 'bind'; filename: string }) {
  const original = asset('existing.png');
  const project = {
    id: '66000000-0000-4000-8000-000000000004', public_project_id: projectId, public_name: { th: 'โครงการจำลอง', en: 'Saved English', zh: '保留名称' },
    address: { th: 'ที่อยู่จำลอง', en: 'Saved address' }, slug: projectId, latitude: null, longitude: null,
    updated_at: initialRevision, published_version_id: null, publication_available: false,
    readiness: { ready: false, missing: [{ field: 'assets.hero', message: 'ตรวจสิทธิ์ภาพหลัก' }] },
    source: { rem_project_id: 'SYNTHETIC-MULTI', project_name_rem: 'โครงการจำลอง', source_snapshot_at: initialRevision, source_updated_at: null },
    models: [], assets: [binding(original, 'hero')],
  };
  const library = [original];
  const uploads: string[] = [];
  const writes: { path: string; method: string; body: any }[] = [];
  let revision = 0;
  let failed = false;
  const advance = () => { project.updated_at = `2026-09-21T08:00:${String(++revision).padStart(2, '0')}Z`; };
  await page.context().addCookies([{ name: 'sena_local_persona', value: 'editor', url: 'http://127.0.0.1:3000' }]);
  // All uploads, bindings and project edits are synthetic; no real project writes.
  await page.route('**/api/hub/v1/admin/**', async route => {
    if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === '/api/hub/v1/admin/content/fields') return route.continue();
    if (await fulfilWorkspaceProjection(route, project)) return;
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/hub/v1/admin/', '');
    const method = request.method();
    if (method === 'GET') {
      // Only workflow reads for the current synthetic source objects; no authority or write mocks.
      if (path === 'content-workflow/items') {
        const query = new URL(request.url()).searchParams;
        expect(query.get('level')).toBe('project'); expect(query.get('id')).toBe(projectId);
        expect(query.get('phase')).toBe(project.source.rem_project_id);
        return route.fulfill({ json: { data: { scope: { level: 'project', id: projectId, phase: project.source.rem_project_id }, items: [], next_cursor: null } } });
      }
      if (path === 'content-workflow') {
        const query = new URL(request.url()).searchParams, kind = query.get('kind'), identity = JSON.parse(query.get('identity')!);
        const owner = kind === 'project' ? project : kind === 'project_asset' ? project.assets.find(item => item.binding_id === identity.id)
          : kind === 'asset' ? library.find(item => item.id === identity.id) : null;
        expect(owner, 'Workflow reads must belong to this finite fixture').toBeTruthy();
        expect(identity).toEqual({ id: kind === 'project_asset' ? (owner as ReturnType<typeof binding>).binding_id : owner!.id });
        return route.fulfill({ json: { data: { kind, identity, expected_hash: 'a'.repeat(64),
          source_revision: kind === 'asset' ? 1 : null, source_updated_at: project.updated_at, source_tab: 'projects', source_tabs: ['projects'], state: 'DRAFT',
          version_id: null, version_no: null, approved_by: null, approved_at: null, decision_reason: null,
          self_approval: false, needs_reapproval: false, can_edit: false, can_submit: false, can_approve: false,
          can_return: false, can_withdraw: false, can_save_approve: false, approval_requires_reason: false, history: [] } } });
      }
      // Exact read-only companion responses; canonical binding writers below stay unchanged.
      if ([`${projectPath}/media`, `${projectPath}/media/jobs`, `${projectPath}/media/ai-state`].includes(path)) {
        const data = path.endsWith('/jobs') ? [] : path.endsWith('/ai-state')
          ? { cap_usd: 0, spent_usd: 0, remaining_usd: 0, ceiling_usd: 0, provider_configured: false, budget_exhausted: false }
          : { project: { id: '66000000-0000-4000-8000-000000000004', public_project_id: project.public_project_id, name: project.public_name, updated_at: project.updated_at },
            assets: project.assets.map(asset => ({ ...asset, media_category: ['master_plan', 'floor_plan'].includes(asset.asset_role) ? asset.asset_role : 'exterior',
              caption: {}, image_kind: null, taken_at: null, people: 'unknown', third_party_marks: 'unknown', credit: {}, tags: [],
              metadata_state: 'needs_review', ai_exposure: 'internal', marketing_publication: false, media_revision: 1, ai_suggestion: null })),
            links: [], clips: [], context: { facilities: [], commercial_types: [], buildings: [], promotions: [], selling_points: [], features: [], places: [] },
            tags: [], requirements: [], checklist: { items: [], recommended_score: 0, required_missing: 0, broken_links: [], unknown_coverage: [] } };
        return route.fulfill({ json: { data } });
      }
      if (/^assets\/[^/]+\/file$/.test(path)) return route.fulfill({ contentType: 'image/png', body: png });
      return route.fulfill({ json: { data: path === projectPath ? project : path === 'assets' ? library : [] } });
    }
    if (path === 'assets' && method === 'POST') {
      const filename = decodeURIComponent(request.headers()['x-filename']);
      uploads.push(filename);
      if (!failed && failure?.stage === 'upload' && filename === failure.filename) {
        failed = true;
        return route.fulfill({ status: 503, json: { error: { message: 'อัปโหลดไฟล์นี้ไม่สำเร็จ กรุณาลองอีกครั้ง' } } });
      }
      const uploaded = asset(filename, request.headers()['content-type']);
      library.push(uploaded);
      return route.fulfill({ status: 201, json: { data: uploaded, meta: { reused: false } } });
    }
    const body = request.postDataJSON();
    writes.push({ path, method, body });
    if (body.updated_at !== project.updated_at) return route.fulfill({ status: 409, json: { error: { code: 'conflict', message: 'ข้อมูลโครงการเปลี่ยนแปลงแล้ว' } } });
    if (method === 'POST' && path === `${projectPath}/assets`) {
      const selected = library.find(item => item.id === body.asset_id)!;
      expect(selected).toBeTruthy();
      if (!failed && failure?.stage === 'bind' && selected.original_filename === failure.filename) {
        failed = true;
        return route.fulfill({ status: 503, json: { error: { message: 'เพิ่มไฟล์กับโครงการไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุด' } } });
      }
      const existing = project.assets.find(item => item.id === selected.id && item.asset_role === body.asset_role);
      expect(existing, 'retry must not append a successfully bound file again').toBeUndefined();
      project.assets.push(binding(selected, body.asset_role, project.assets.filter(item => item.asset_role === body.asset_role).length, body.alt_text.th));
    } else if (method === 'PATCH' && path === projectPath) Object.assign(project, body);
    else throw new Error(`Unexpected synthetic write: ${method} ${path}`);
    advance();
    return route.fulfill({ json: { data: project } });
  });
  await page.goto(`/?project=${projectId}`);
  await expect(page.locator('#public_name')).toHaveValue('โครงการจำลอง');
  return { project, uploads, writes };
}

async function selectFiles(page: Page, files: ReturnType<typeof file>[], purpose = 'hero') {
  await openWorkspaceTab(page, 'media');
  await page.locator(`input[name="assets-purpose"][value="${purpose}"]`).check();
  await page.locator('#assets').getByRole('button', { name: 'อัปโหลดไฟล์', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('เลือกไฟล์ภาพหรือ PDF', { exact: true })).toHaveAttribute('multiple', '');
  await dialog.getByLabel('เลือกไฟล์ภาพหรือ PDF', { exact: true }).setInputFiles(files);
  return dialog;
}

async function captionAll(page: Page, names: string[]) {
  for (const name of names) await page.getByRole('dialog').getByLabel(`คำอธิบายภาพ (ภาษาไทย) · ${name}`, { exact: true }).fill(`คำอธิบาย ${name}`);
}

test('two hero uploads retain the existing image and dirty project text; later save uses the final binding revision', async ({ page }) => {
  const fixture = await openFixture(page);
  await page.locator('#public_name').fill('ชื่อที่ยังไม่บันทึก');
  await page.locator('#public_name_en').fill('Unsaved English');
  const dialog = await selectFiles(page, [file('first.png'), file('second.png')]);
  await captionAll(page, ['first.png', 'second.png']);
  await page.screenshot({ path: 'artifacts/project-multi-media-desktop.png' });
  await dialog.getByRole('button', { name: 'อัปโหลดและเพิ่มไฟล์', exact: true }).click();
  await expect(dialog).toContainText('เพิ่มแล้ว 2 จาก 2 ไฟล์');
  await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(page.locator('#assets .bound-assets article')).toHaveCount(3);
  expect(fixture.project.assets.map(item => [item.original_filename, item.display_order])).toEqual([['existing.png', 0], ['first.png', 1], ['second.png', 2]]);
  expect(fixture.writes.map(write => write.body.updated_at)).toEqual([initialRevision, '2026-09-21T08:00:01Z']);
  await expect(page.locator('#public_name')).toHaveValue('ชื่อที่ยังไม่บันทึก');
  await expect(page.locator('#public_name_en')).toHaveValue('Unsaved English');
  expect(fixture.project.public_name.en).toBe('Saved English');
  expect(fixture.writes.every(write => write.method === 'POST')).toBeTruthy();
  await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
  await expect(page.getByText('บันทึกข้อมูลร่างแล้ว ข้อมูลที่เผยแพร่ยังคงเป็นเวอร์ชันเดิม', { exact: true })).toBeVisible();
  expect(fixture.writes.at(-1)).toMatchObject({ method: 'PATCH', body: { updated_at: '2026-09-21T08:00:02Z', public_name: { th: 'ชื่อที่ยังไม่บันทึก', en: 'Unsaved English', zh: '保留名称' } } });
  expect(fixture.project.published_version_id).toBeNull();
});

test('a failed binding retries the uploaded file without uploading or binding successful files again', async ({ page }) => {
  const fixture = await openFixture(page, { stage: 'bind', filename: 'second.png' });
  const dialog = await selectFiles(page, [file('first.png'), file('second.png')]);
  await captionAll(page, ['first.png', 'second.png']);
  await dialog.getByRole('button', { name: 'อัปโหลดและเพิ่มไฟล์', exact: true }).click();
  await expect(dialog).toContainText('เพิ่มแล้ว 1 จาก 2 ไฟล์');
  await expect(dialog.getByLabel('คำอธิบายภาพ (ภาษาไทย) · second.png', { exact: true })).toHaveValue('คำอธิบาย second.png');
  await dialog.getByRole('button', { name: 'โหลดข้อมูลล่าสุดเพื่อทำต่อ', exact: true }).click();
  await dialog.getByRole('button', { name: 'ลองอีกครั้งเฉพาะไฟล์ที่ยังไม่สำเร็จ', exact: true }).click();
  await expect(dialog).toContainText('เพิ่มแล้ว 2 จาก 2 ไฟล์');
  expect(fixture.uploads).toEqual(['first.png', 'second.png']);
  expect(fixture.writes.map(write => write.body.asset_id)).toEqual(['asset-first.png', 'asset-second.png', 'asset-second.png']);
  expect(fixture.writes.at(-1)?.body.updated_at).toBe('2026-09-21T08:00:01Z');
  expect(fixture.project.assets).toHaveLength(3);
});

test('an upload failure keeps other successes and retries only the failed upload', async ({ page }) => {
  const fixture = await openFixture(page, { stage: 'upload', filename: 'second.png' });
  const dialog = await selectFiles(page, [file('first.png'), file('second.png'), file('third.png')]);
  await captionAll(page, ['first.png', 'second.png', 'third.png']);
  await dialog.getByRole('button', { name: 'อัปโหลดและเพิ่มไฟล์', exact: true }).click();
  await expect(dialog).toContainText('เพิ่มแล้ว 2 จาก 3 ไฟล์');
  await dialog.getByRole('button', { name: 'ลองอีกครั้งเฉพาะไฟล์ที่ยังไม่สำเร็จ', exact: true }).click();
  await expect(dialog).toContainText('เพิ่มแล้ว 3 จาก 3 ไฟล์');
  expect(fixture.uploads).toEqual(['first.png', 'second.png', 'third.png', 'second.png']);
  expect(fixture.writes.map(write => write.body.asset_id)).toEqual(['asset-first.png', 'asset-third.png', 'asset-second.png']);
  expect(fixture.project.assets).toHaveLength(4);
});

for (const problem of ['missing caption', 'invalid file']) {
  test(`${problem} in a later queue item prevents every upload and project write`, async ({ page }) => {
    const fixture = await openFixture(page);
    const invalidFile = problem === 'invalid file';
    const second = invalidFile ? file('invalid.svg', 'image/svg+xml') : file('second.png');
    const dialog = await selectFiles(page, [file('valid.png'), second]);
    await captionAll(page, invalidFile ? ['valid.png', second.name] : ['valid.png']);
    await dialog.getByRole('button', { name: 'อัปโหลดและเพิ่มไฟล์', exact: true }).click();
    await expect(dialog.getByRole('alert').first()).toBeVisible();
    expect(fixture.uploads).toHaveLength(0);
    expect(fixture.writes).toHaveLength(0);
    expect(fixture.project.assets).toHaveLength(1);
  });
}

for (const purpose of ['thumbnail', 'master_plan', 'floor_plan']) {
  test(`${purpose} accepts multiple files in the selected slot`, async ({ page }) => {
    if (purpose === 'thumbnail') await page.setViewportSize({ width: 375, height: 900 });
    const fixture = await openFixture(page);
    const second = purpose === 'thumbnail' ? file('second.png') : file('second.pdf', 'application/pdf');
    const dialog = await selectFiles(page, [file('first.png'), second], purpose);
    await captionAll(page, ['first.png', second.name]);
    if (purpose === 'thumbnail') {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
      for (const button of await dialog.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: 'artifacts/project-multi-media-mobile.png' });
    }
    await dialog.getByRole('button', { name: 'อัปโหลดและเพิ่มไฟล์', exact: true }).click();
    await expect(dialog).toContainText('เพิ่มแล้ว 2 จาก 2 ไฟล์');
    expect(fixture.project.assets.filter(item => item.asset_role === purpose).map(item => item.original_filename)).toEqual(['first.png', second.name]);
    expect(fixture.project.assets.find(item => item.id === 'asset-existing.png')?.asset_role).toBe('hero');
    expect(fixture.writes.map(write => write.body.asset_role)).toEqual([purpose, purpose]);
  });
}
