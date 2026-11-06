import { workflowText } from './content-workflow-fixtures';
import { fulfilWorkspaceProjection } from './unified-workspace-helpers';
import { openWorkspaceTab } from './unified-workspace-helpers';
import { progressFixture } from './progress-fixture';
import { expect, test, type Page } from '@playwright/test';

const stamp = '2026-10-05T00:00:00Z';
const base = '/api/hub/v1/admin/';
const nativeProjectIds: Record<string, string> = { P01: '66000000-0000-4000-8000-000000000002', P11: '66000000-0000-4000-8000-000000000012' };
const gap = { field: 'latitude', message: 'ระบุพิกัดโครงการ' };
const source = { status_raw: '2', status_label: 'พร้อมอยู่', default_scope: true, is_deleted: false, flags: [], exceptions: [] };
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  public_project_id: id, rem_project_id: id, name: `โครงการ ${id}`, brand_name: 'แบรนด์จำลอง', rem_brand_id: '00025',
  rem_project_group_id: 'G', marketing_project_group_id: 'MARKETING-G', marketing_group_name_th: 'กลุ่มจำลอง', group_mismatch: true, group_status: 'marketing_reference',
  new_from_rem: false, filling: true, awaiting_publisher: true, published: false, needs_attention: false,
  has_unpublished_changes: true, withdrawn: false, attention: [], gaps: { core: [gap], media: [], models: [], brand: [] },
  confirmed_models: 0, total_models: 1, amenities: null, waiting_on: ['editor', 'publisher'], updated_at: stamp,
  first_seen_at: stamp, age_days: 0, age_basis: 'first_import', source_review: source, ...extra,
});

async function fixture(page: Page, role = 'publisher') {
  const rows = [...Array.from({ length: 12 }, (_, index) => item(`P${String(index + 1).padStart(2, '0')}`)),
    item('SPACE', { marketing_project_group_id: 'MARKETING-G ' }), item('OTHER-BRAND', { rem_brand_id: '25' }),
    item('CONFLICT', { group_status: 'conflict' }), item('MISSING', { group_status: 'missing', marketing_project_group_id: null }),
    item('CLOSED', { source_review: { ...source, status_raw: '3', default_scope: false } }),
    item('NEW', { public_project_id: null, new_from_rem: true, filling: false })];
  const asset = { id: 'synthetic-image', original_filename: 'synthetic.png', mime_type: 'image/png', public_url: '/demo-assets/brand-logo.svg', rights_status: 'pending', rights_notes: null, updated_at: stamp, effective_from: null, effective_to: null };
  const project = (id: string) => ({ id: nativeProjectIds[id], public_project_id: id, public_name: { th: `โครงการ ${id}` }, slug: id, updated_at: stamp,
    published_version_id: null, publication_available: false, readiness: { ready: false, percent: 0, missing: [gap] },
    source: { rem_project_id: id, project_name_rem: id }, models: [],
    assets: [{ ...asset, binding_id: 'bound', asset_role: 'hero', alt_text: { th: 'ภาพจำลอง' }, display_order: 0 }] });
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.context().addCookies([{ name: 'sena_local_persona', value: role, url: 'http://127.0.0.1:3000' }]);
  await page.route('**/api/hub/**', async route => {
    if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === '/api/hub/v1/admin/content/fields') return route.continue();
    if (await fulfilWorkspaceProjection(route, project)) return;
    if(new URL(route.request().url()).pathname==='/api/hub/v1/me')return route.continue();
    const path = new URL(route.request().url()).pathname.replace(base, '');
    // Only the two saved projects opened by these tests, and their shared synthetic file/binding.
    if (route.request().method() === 'GET') {
      const url = new URL(route.request().url()), publicId = url.searchParams.get('id');
      if (path === 'content-workflow/items' && url.searchParams.get('level') === 'project' && publicId && Object.hasOwn(nativeProjectIds, publicId)
        && (!url.searchParams.has('phase') || url.searchParams.get('phase') === publicId)) {
        return route.fulfill({ json: { data: { scope: { level: 'project', id: publicId, phase: publicId }, items: [], next_cursor: null } } });
      }
      const targets = [...Object.values(nativeProjectIds).map(id => ({ kind: 'project', id })), { kind: 'asset', id: asset.id }, { kind: 'project_asset', id: 'bound' }];
      const target = targets.find(item => item.kind === url.searchParams.get('kind') && JSON.stringify({ id: item.id }) === url.searchParams.get('identity'));
      if (path === 'content-workflow' && target) {
        return route.fulfill({ json: { data: {
          kind: target.kind, identity: { id: target.id }, source_tab: 'projects', source_tabs: ['projects'], state: 'DRAFT', expected_hash: 'a'.repeat(64),
          source_revision: null, source_updated_at: stamp, version_id: null, version_no: null, approved_by: null, approved_at: null,
          decision_reason: null, self_approval: false, needs_reapproval: false, can_edit: false, can_submit: false,
          can_approve: false, can_return: false, can_withdraw: false, can_save_approve: false, approval_requires_reason: true, history: [],
        } } });
      }
    }
    // The outer Media tab reads this workspace before canonical media is selected.
    // Keep this exact fixture projection separate from the existing native writers.
    if (route.request().method() === 'GET' && ['projects/P01/media', 'projects/P01/media/jobs', 'projects/P01/media/ai-state'].includes(path)) {
      const owner = project('P01');
      const data = path.endsWith('/jobs') ? [] : path.endsWith('/ai-state')
        ? { cap_usd: 0, spent_usd: 0, remaining_usd: 0, ceiling_usd: 0, provider_configured: false, budget_exhausted: false }
        : { project: { id: '66000000-0000-4000-8000-000000000002', public_project_id: owner.public_project_id, name: owner.public_name, updated_at: owner.updated_at },
          assets: owner.assets.map(asset => ({ ...asset, media_category: ['master_plan', 'floor_plan'].includes(asset.asset_role) ? asset.asset_role : 'exterior',
            caption: {}, image_kind: null, taken_at: null, people: 'unknown', third_party_marks: 'unknown', credit: {}, tags: [],
            metadata_state: 'needs_review', ai_exposure: 'internal', marketing_publication: false, media_revision: 1, ai_suggestion: null })),
          links: [], clips: [], context: { facilities: [], commercial_types: [], buildings: [], promotions: [], selling_points: [], features: [], places: [] },
          tags: [], requirements: [], checklist: { items: [], recommended_score: 0, required_missing: 0, broken_links: [], unknown_coverage: [] } };
      return route.fulfill({ json: { data } });
    }
    if (route.request().method() !== 'GET') {
      writes.push({ path, body: route.request().postDataJSON() });
      if (path === 'assets/synthetic-image/review') { asset.rights_status = 'approved'; return route.fulfill({ json: { data: asset } }); }
      return route.fulfill({ status: 403, json: { error: { message: 'ชุดทดสอบไม่อนุญาต' } } });
    }
    const data = path === 'projects/progress' ? progressFixture(route.request().url(), rows) : path === 'brands/completeness' ? {
      rows: [{ public_brand_id: 'BRAND', rem_brand_id: '00025', name_th: 'แบรนด์จำลอง', name_en: '', residential_project_count: 17,
        status: 'missing_data', reason_codes: [], readiness: { ready: false, percent: 0, missing: [] }, checks: {}, optional_logos: [], updated_at: stamp, updated_by: null }], counts: { total: 1 },
    } : path === 'assets/synthetic-image' ? asset : path === 'assets' ? [asset] : path === 'sources/projects' ? [{ rem_project_id: 'NEW', project_name_rem: 'โครงการ NEW', model_count: 0, public_project_id: null, source_record: null }] :
      /^projects\/[^/]+$/.test(path) ? project(path.split('/')[1]) : [];
    await route.fulfill({ json: { data } });
  });
  return { rows, writes };
}

test('brand expansion preserves exact IDs, shared groups, conflicts and scope through navigation', async ({ page }) => {
  const { writes } = await fixture(page);
  await page.goto('/?view=brands&bq=แบรนด์');
  await page.getByRole('button', { name: 'แสดงกลุ่มโครงการ', exact: true }).click();
  const groups = page.getByRole('region', { name: 'กลุ่มโครงการของแบรนด์' });
  await expect(groups).toContainText('กลุ่มนี้มีสมาชิกต่างแบรนด์');
  await expect(groups.getByRole('link', { name: 'เปิดกลุ่ม', exact: false })).toHaveCount(4);
  await expect(groups).toContainText('กลุ่มที่ต้องตรวจสอบ');
  await expect(groups).toContainText('ยังไม่มีกลุ่มยืนยัน');
  await expect(groups).toContainText('รหัสมีช่องว่าง:');
  await page.screenshot({ path: 'artifacts/brand-group-expansion.png', fullPage: true });
  const open = groups.locator('a').filter({ hasText: 'เปิดกลุ่ม' });
  const exactGroup = open.filter({ has: page.locator('span', { hasText: /^ MARKETING-G · กลุ่มจำลอง$/ }) });
  await exactGroup.click();
  expect(new URL(page.url()).searchParams.get('rem_brand')).toBe('00025');
  expect(new URL(page.url()).searchParams.get('group')).toBe('MARKETING-G');
  await expect(page.locator('.project-dashboard tbody tr')).toHaveCount(10);
  await expect(page.locator('.project-dashboard')).not.toContainText('OTHER-BRAND');
  await page.locator('#projects-top-page').selectOption('2');
  await expect(page.locator('.project-dashboard tbody tr')).toHaveCount(3);
  await page.screenshot({ path: 'artifacts/group-project-list.png', fullPage: true });
  await page.getByRole('link', { name: 'โครงการ P11', exact: true }).click();
  await expect(page.locator('#workspace-tab-data')).toBeVisible();
  await expect(page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)')).toBeDisabled();
  await page.getByRole('link', { name: 'กลับรายการก่อนหน้า', exact: true }).click();
  await expect(page.locator('#projects-top-page')).toHaveValue('2');
  await page.getByRole('link', { name: 'กลับรายการก่อนหน้า', exact: true }).click();
  await expect(page.getByLabel('ค้นหาชื่อหรือรหัสแบรนด์')).toHaveValue('แบรนด์');
  await expect(page.getByRole('button', { name: 'ซ่อนกลุ่มโครงการ' })).toHaveAttribute('aria-expanded', 'true');
  expect(writes).toEqual([]);
});

test('out-of-scope group selection keeps the toggle and source action stays read-only for viewers', async ({ page }) => {
  const { writes } = await fixture(page, 'viewer');
  await page.goto('/?view=brands&bopen=00025&bother=1');
  await page.locator('.project-group-list a[href*="group=MARKETING-G&"]').first().click();
  await expect(page.getByRole('checkbox', { name: 'แสดงโครงการปิด ถูกลบ และไม่ทราบสถานะ' })).toBeChecked();
  await page.getByLabel('ค้นหาโครงการ แบรนด์ หรือรหัส REM').fill('NEW');
  await page.getByRole('button', { name: 'ดูต้นทาง', exact: true }).click();
  await expect(page.getByLabel('ค้นหาชื่อหรือรหัสโครงการต้นทาง')).toHaveValue('NEW');
  await expect(page.getByRole('button', { name: 'เลือกโครงการนี้' })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('publisher approves an attached project file while content is incomplete, without publishing', async ({ page }) => {
  const { writes } = await fixture(page);
  await page.goto('/?project=P01');
  await openWorkspaceTab(page, 'media');
  await page.getByRole('button', { name: 'อนุมัติใช้ไฟล์', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'อนุมัติใช้ไฟล์', exact: true });
  await expect(dialog.getByLabel('หมายเหตุเพิ่มเติม (ไม่บังคับ)')).toBeVisible();
  await dialog.getByRole('button', { name: 'ยืนยันอนุมัติ 1 ไฟล์' }).click();
  await expect(dialog.getByText('อนุมัติใช้ไฟล์แล้ว', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ path: 'assets/synthetic-image/review', body: { decision: 'approved', updated_at: stamp, change_reason: 'อนุมัติใช้ไฟล์โดยผู้เผยแพร่' } });
  await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  await openWorkspaceTab(page, 'history');
  // N6 centralizes publication; source history links to its filtered queue.
  const queue = page.locator('.publication-actions').getByRole('link', { name: workflowText.queue, exact: true });
  await expect(queue).toHaveAttribute('href', '/publish?source=project&id=P01');
  expect(writes).toHaveLength(1);
});

test('project table has a sticky header, pagination and no mobile document overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await fixture(page, 'viewer');
  await page.goto('/website?view=projects');
  await expect(page.locator('.project-dashboard tbody tr')).toHaveCount(10);
  const header = page.locator('.project-progress-table th').first();
  expect(await header.evaluate(element => getComputedStyle(element).position)).toBe('sticky');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#projects-top-page')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'artifacts/group-project-mobile.png', fullPage: true });
  await page.goto('/?project=P01&return_to=https%3A%2F%2Fexample.com');
  await expect(page.locator('a.back-link')).toHaveAttribute('href', '/website');
});

test('marketing names are shown in rows and filters while REM differences are flagged', async ({ page }) => {
  await fixture(page, 'viewer');
  await page.goto('/website?view=projects');
  await expect(page.locator('#project-group-filter option[value="MARKETING-G"]')).toHaveText('MARKETING-G · กลุ่มจำลอง');
  const row = page.locator('.project-summary-row').first();
  await expect(row).toContainText('กลุ่มการตลาด: MARKETING-G · กลุ่มจำลอง');
  await expect(row).toContainText('รหัสกลุ่มไม่ตรงกัน · REM: G');
  await page.getByLabel('กลุ่มการตลาด', {exact:true}).selectOption('MARKETING-G ');
  await expect(page.locator('.project-summary-row')).toHaveCount(1);
  await expect(page.locator('.project-summary-row')).toContainText('SPACE');
});
