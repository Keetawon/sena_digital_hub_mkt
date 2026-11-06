import { fulfilWorkspaceProjection } from './unified-workspace-helpers';
import { openWorkspaceTab } from './unified-workspace-helpers';
import { expect, test, type Page } from '@playwright/test';

const snapshotTime = '2026-09-17T15:45:42.124034+00:00';
const snapshotLabel = 'สำเนา REM ที่ตรวจสอบหลักฐานแล้ว';
const sampleLabel = 'ข้อมูลจำลองสำหรับเครื่องพัฒนา';
const evidence = { source_record: null, intake_manifest_sha256: 'a'.repeat(64), source_updated_at: null, source_snapshot_at: snapshotTime };
const source = { ...evidence, rem_project_id: 'PROVENANCE-TEST', project_name_rem: 'โครงการทดสอบป้ายสำเนา', model_count: 1, public_project_id: null, rem_brand_id: '000003', rem_company_id: null, brand_name_rem: null, company_name_rem: null };
const brand = { ...evidence, rem_brand_id: '000003', brand_name_rem: 'แบรนด์ทดสอบป้ายสำเนา', brand_name_en_rem: null, is_deleted: false, residential_project_count: 1, public_brand_id: null };

test('public website identity does not claim a REM snapshot or synthetic content', async ({ page }) => {
  await mockStaffReads(page, { 'sources/projects': [{ ...source, source_record: { source_kind: 'sena_public_website' } }] });
  await page.goto('/website?view=projects');
  await page.getByRole('button', { name: 'เลือกโครงการจากต้นทาง', exact: true }).click();
  const row = page.locator('#source-picker li').filter({ hasText: source.project_name_rem });
  await expect(row).toContainText('ดึงจากเว็บไซต์สาธารณะ SENA');
  await expect(row).toContainText('ยังไม่ยืนยันสถานะ REM');
  await expect(row).not.toContainText(snapshotLabel);
  await expect(row).not.toContainText(sampleLabel);
});

test('empty default view offers other source statuses without inventing active status', async ({ page }) => {
  await mockStaffReads(page, {});
  await page.route('**/api/hub/v1/admin/projects/progress?**', async route => {
    const query = new URL(route.request().url()).searchParams;
    const facets = { counts: { all: 0 }, status_total: 1, statuses: { unknown: { label: 'ไม่ทราบสถานะ', count: 1 } }, brands: [], groups: [] };
    await route.fulfill({ json: { data: query.get('view') === 'counts'
      ? facets : { rows: [], total: 0, pages: 1, page: 1, facets } } });
  });
  await page.goto('/website?view=projects');
  await expect(page.getByText('อาจมีโครงการที่ปิด ถูกลบ หรือยังไม่ทราบสถานะต้นทาง')).toBeVisible();
  await page.getByRole('button', { name: 'รวมโครงการสถานะอื่น', exact: true }).click();
  await expect(page).toHaveURL(/pother=1/);
  await expect(page.getByLabel('แสดงโครงการปิด ถูกลบ และไม่ทราบสถานะ')).toBeChecked();
});

async function mockStaffReads(page: Page, responses: Record<string, unknown>) {
  const project = responses['projects/project-test'] as { id?: string; updated_at: string; models: { id: string }[] } | undefined;
  if (project) responses['projects/project-test'] = { ...project, id: '67000000-0000-4000-8000-000000000001',
    models: project.models.map(model => ({ ...model, id: '67000000-0000-4000-8000-000000000002' })) };
  responses['brands/completeness'] = { rows: [], counts: { total: 0, missing_data: 0, ready: 0, published: 0, published_changes: 0, not_created: 0 } };
  await page.context().addCookies([{ name: 'sena_local_persona', value: 'editor', url: 'http://127.0.0.1:3000' }]);
  await page.route('**/api/hub/v1/admin/**', async route => {
    if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === '/api/hub/v1/admin/content/fields') return route.continue();
    if (await fulfilWorkspaceProjection(route, id => (responses[`projects/${id}`] ?? responses[`brands/${id}`]) as any)) return;
    expect(route.request().method()).toBe('GET');
    const path = new URL(route.request().url()).pathname.replace('/api/hub/v1/admin/', '');
    const url = new URL(route.request().url());
    if (project && path === 'content-workflow/items' && url.searchParams.get('level') === 'project' && url.searchParams.get('id') === 'project-test'
      && (!url.searchParams.has('phase') || url.searchParams.get('phase') === source.rem_project_id)) {
      return route.fulfill({ json: { data: { scope: { level: 'project', id: 'project-test', phase: source.rem_project_id }, items: [], next_cursor: null } } });
    }
    const kind = url.searchParams.get('kind'), identity = url.searchParams.get('identity');
    const targetId = kind === 'project' ? '67000000-0000-4000-8000-000000000001' : kind === 'model' ? '67000000-0000-4000-8000-000000000002' : null;
    if (project && path === 'content-workflow' && targetId && identity === JSON.stringify({ id: targetId })) {
      return route.fulfill({ json: { data: {
        kind, identity: { id: targetId }, source_tab: 'projects', source_tabs: ['projects'], state: 'DRAFT', expected_hash: 'a'.repeat(64),
        source_revision: null, source_updated_at: project.updated_at, version_id: null, version_no: null, approved_by: null, approved_at: null,
        decision_reason: null, self_approval: false, needs_reapproval: false, can_edit: false, can_submit: false,
        can_approve: false, can_return: false, can_withdraw: false, can_save_approve: false, approval_requires_reason: true, history: [],
      } } });
    }
    await route.fulfill({ json: { data: responses[path] ?? [] } });
  });
}

test('source pickers distinguish reviewed snapshots from samples and do not invent source time', async ({ page }) => {
  await mockStaffReads(page, {
    'sources/projects': [source, { ...source, rem_project_id: 'KUBON', project_name_rem: 'โครงการทดสอบป้ายจำลอง', intake_manifest_sha256: null }],
    'sources/brands': [brand, { ...brand, rem_brand_id: '36', brand_name_rem: 'แบรนด์ทดสอบป้ายจำลอง', intake_manifest_sha256: null }],
  });
  await page.goto('/website?view=projects');
  await page.getByRole('button', { name: 'เลือกโครงการจากต้นทาง', exact: true }).click();
  const realProject = page.locator('#source-picker li').filter({ hasText: source.project_name_rem });
  const sampleProject = page.locator('#source-picker li').filter({ hasText: 'โครงการทดสอบป้ายจำลอง' });
  await expect(realProject).toContainText(snapshotLabel);
  await expect(realProject).not.toContainText(sampleLabel);
  await expect(realProject).toContainText('ยังยืนยันเวลา/เขตเวลาต้นทางไม่ได้');
  await expect(realProject).toContainText('เวลาสกัดสำเนาต้นทาง');
  await expect(sampleProject).toContainText(sampleLabel);
  await page.goto('/?view=brands');
  await page.getByRole('button', { name: 'ดูแบรนด์จากต้นทาง', exact: true }).click();
  const realBrand = page.locator('#brand-source-picker li').filter({ hasText: brand.brand_name_rem });
  const sampleBrand = page.locator('#brand-source-picker li').filter({ hasText: 'แบรนด์ทดสอบป้ายจำลอง' });
  await expect(realBrand).toContainText(snapshotLabel);
  await expect(realBrand).toContainText('ยังยืนยันเวลา/เขตเวลาต้นทางไม่ได้');
  await expect(realBrand).toContainText('เวลาสกัดสำเนาต้นทาง');
  await expect(sampleBrand).toContainText(sampleLabel);
});

test('model evidence keeps raw area separate from blank approved specifications', async ({ page }) => {
  const model = { ...evidence, id: 'test-model', public_model_id: 'model-test', rem_model_id: 'A1-1', model_name_rem: 'A1-1', public_name: {}, bedrooms: null, bathrooms: null, usable_area_sqm: null, parking_spaces: null, match_status: 'SUGGESTED', verified_by: null, verified_at: null, source_record: { model_type_id: 'CON4', model_area: '27.00' } };
  await mockStaffReads(page, {
    'projects/project-test': { public_project_id: 'project-test', public_name: {}, slug: '', updated_at: snapshotTime, published_version_id: null, publication_available: false, readiness: { ready: false, percent: 0, missing: [] }, source, models: [model], assets: [] },
  });
  await page.goto('/?project=project-test');
  await expect(page.locator('.source-provenance')).toContainText(snapshotLabel);
  await openWorkspaceTab(page, 'unit-types');
  await page.locator('.rem-model-table').getByRole('button', { name: 'A1-1', exact: true }).click();
  const dialog = page.getByRole('region', { name: 'แก้ไขรายละเอียดแบบ', exact: true });
  await expect(dialog).toContainText('CON4');
  await expect(dialog).toContainText('27.00');
  await expect(dialog).toContainText('ยังไม่ยืนยันหน่วยและความหมาย');
  await expect(dialog.getByLabel('พื้นที่ใช้สอย (ตร.ม.)', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('จำนวนห้องนอน', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('จำนวนห้องน้ำ', { exact: true })).toHaveValue('');
});
