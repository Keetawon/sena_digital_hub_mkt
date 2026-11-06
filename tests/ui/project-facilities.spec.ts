import { fulfilWorkspaceProjection } from './unified-workspace-helpers';
import { openWorkspaceTab } from './unified-workspace-helpers';
import { expect, test, type Page } from '@playwright/test';

const initialTime = '2026-09-20T08:00:00Z';
const savedTime = '2026-09-20T08:01:00Z';

function fixture() {
  const names = [
    ['pool', 'สระว่ายน้ำ'], ['fitness', 'ฟิตเนส'], ['garden', 'สวนส่วนกลาง'],
    ['security', 'ระบบรักษาความปลอดภัย'], ['coworking', 'พื้นที่ทำงานร่วม'],
    ['playground', 'สนามเด็กเล่น'], ['clubhouse', 'คลับเฮาส์'],
  ];
  const items = names.map(([code, name_th], index) => ({
    code, name_th, name_en: code, required: index < 6,
    status: index < 6 ? 'unknown' : 'present',
    description: { th: '', en: 'Preserve English', zh: '保留说明' },
    location_note: '', access_note: '', evidence_note: '', expected_open_date: null as string | null,
    updated_at: null as string | null, updated_by: null,
  }));
  return {
    id: '66000000-0000-4000-8000-000000000005', public_project_id: 'facility-test', public_name: { th: 'โครงการจำลองสิ่งอำนวยความสะดวก' },
    address: { th: 'ที่อยู่จำลอง' }, slug: 'facility-test', latitude: null, longitude: null,
    updated_at: initialTime, published_version_id: null, publication_available: false,
    readiness: { ready: false, percent: 20, missing: [{ field: 'latitude', message: 'ระบุพิกัด' }] },
    source: { rem_project_id: 'FACILITY-TEST', project_name_rem: 'โครงการทดสอบ',
      source_updated_at: null, source_snapshot_at: initialTime, source_record: null,
      intake_manifest_sha256: 'a'.repeat(64) },
    gold_source: null, models: [], assets: [], commercial_types: [],
    facilities: {
      review_status: 'draft', checklist_version: 1, expected_count: 6, collected_count: 0,
      items, missing: items.filter(item => item.required).map(item => ({
        field: `facilities.${item.code}`, message: `ระบุสถานะ${item.name_th}`,
      })),
    },
  };
}

async function openFixture(page: Page, role: 'editor' | 'viewer' = 'editor') {
  const project = fixture();
  const writes: { code: string; body: Record<string, unknown> }[] = [];
  const unexpectedWrites: string[] = [];
  await page.context().addCookies([{ name: 'sena_local_persona', value: role, url: 'http://127.0.0.1:3000' }]);
  // Domain requests are intercepted; identity reads retain the real capability projection.
  await page.route('**/api/hub/**', async route => {
    if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === '/api/hub/v1/admin/content/fields') return route.continue();
    if (await fulfilWorkspaceProjection(route, project)) return;
    const request = route.request();
    if(new URL(request.url()).pathname==='/api/hub/v1/me')return route.continue();
    const path = new URL(request.url()).pathname.replace('/api/hub/v1/admin/', '');
    // Workflow projections are limited to this project and its saved facility codes.
    if (request.method() === 'GET' && path === 'content-workflow/items') {
      const query = new URL(request.url()).searchParams;
      expect(query.get('level')).toBe('project'); expect(query.get('id')).toBe(project.public_project_id);
      expect(query.get('phase')).toBe(project.source.rem_project_id);
      return route.fulfill({ json: { data: { scope: { level: 'project', id: project.public_project_id, phase: project.source.rem_project_id }, items: [], next_cursor: null } } });
    }
    if (request.method() === 'GET' && path === 'content-workflow') {
      const query = new URL(request.url()).searchParams, kind = query.get('kind'), identity = JSON.parse(query.get('identity')!);
      const facility = kind === 'facility' ? project.facilities.items.find(item => item.code === identity.facility_code && item.updated_at) : null;
      expect(kind === 'project' || Boolean(facility), 'Only the project and saved known facilities have workflow snapshots').toBe(true);
      expect(identity).toEqual(facility ? { project_id: project.id, facility_code: facility.code } : { id: project.id });
      return route.fulfill({ json: { data: { kind, identity, expected_hash: 'a'.repeat(64),
        source_revision: null, source_updated_at: facility?.updated_at ?? project.updated_at, source_tab: 'projects', source_tabs: ['projects'], state: 'DRAFT',
        version_id: null, version_no: null, approved_by: null, approved_at: null, decision_reason: null,
        self_approval: false, needs_reapproval: false, can_edit: false, can_submit: false, can_approve: false,
        can_return: false, can_withdraw: false, can_save_approve: false, approval_requires_reason: false, history: [] } } });
    }
    // The outer Media tab can load before its canonical-media button is chosen.
    // This fixture has no media; preserve all native facility writers below.
    if (request.method() === 'GET' && ['projects/facility-test/media', 'projects/facility-test/media/jobs', 'projects/facility-test/media/ai-state'].includes(path)) {
      const data = path.endsWith('/jobs') ? [] : path.endsWith('/ai-state')
        ? { cap_usd: 0, spent_usd: 0, remaining_usd: 0, ceiling_usd: 0, provider_configured: false, budget_exhausted: false }
        : { project: { id: '66000000-0000-4000-8000-000000000005', public_project_id: project.public_project_id, name: project.public_name, updated_at: project.updated_at },
          assets: [], links: [], clips: [], context: { facilities: [], commercial_types: [], buildings: [], promotions: [], selling_points: [], features: [], places: [] },
          tags: [], requirements: [], checklist: { items: [], recommended_score: 0, required_missing: 0, broken_links: [], unknown_coverage: [] } };
      return route.fulfill({ json: { data } });
    }
    const facility = path.match(/^projects\/facility-test\/facilities\/([^/]+)$/);
    if (request.method() === 'PUT' && facility) {
      const body = request.postDataJSON();
      writes.push({ code: facility[1], body });
      const item = project.facilities.items.find(value => value.code === facility[1]);
      if (!item || body.updated_at !== project.updated_at) {
        await route.fulfill({ status: 409, json: { error: { code: 'conflict', message: 'ข้อมูลเปลี่ยนไปแล้ว' } } });
        return;
      }
      const { updated_at: _revision, ...changes } = body;
      Object.assign(item, changes, { updated_at: savedTime });
      project.updated_at = savedTime;
      project.facilities.collected_count = project.facilities.items.filter(value => value.required && value.status !== 'unknown').length;
      project.facilities.missing = project.facilities.items.filter(value => value.required && value.status === 'unknown').map(value => ({
        field: `facilities.${value.code}`, message: `ระบุสถานะ${value.name_th}`,
      }));
      await route.fulfill({ json: { data: project } });
    } else if (request.method() !== 'GET') {
      unexpectedWrites.push(`${request.method()} ${path}`);
      await route.fulfill({ status: 500, json: { error: { message: 'Unexpected fixture write' } } });
    } else {
      await route.fulfill({ json: { data: path === 'projects/facility-test' ? project : [] } });
    }
  });
  await page.goto('/?project=facility-test');
  await openWorkspaceTab(page, 'supplementary');
  await expect(page.locator('#facilities')).toBeVisible();
  return { project, writes, unexpectedWrites };
}

test('unknown and absent are distinct; saved status updates collection with revision and other locales preserved', async ({ page }) => {
  const { project, writes, unexpectedWrites } = await openFixture(page);
  const section = page.locator('#facilities');
  await expect(section.locator('.count')).toHaveText('0/6');
  await expect(page.locator('#facilities-clubhouse')).toContainText('มี');
  const pool = page.getByRole('group', { name: 'สถานะสระว่ายน้ำ', exact: true });
  await expect(pool.getByRole('radio', { name: 'ยังไม่ทราบ', exact: true })).toBeChecked();
  await pool.getByRole('radio', { name: 'ไม่มี', exact: true }).check();
  await expect(section.locator('.count')).toHaveText('0/6');
  expect(writes).toEqual([]);
  await expect(page.getByRole('group', { name: 'สถานะฟิตเนส', exact: true }).getByRole('radio', { name: 'มี', exact: true })).toBeDisabled();
  await page.getByText('รายละเอียดและแหล่งข้อมูล (ถ้ามี)', { exact: true }).click();
  await page.getByLabel('รายละเอียดสระว่ายน้ำ', { exact: true }).fill('ตรวจสอบแล้ว โครงการไม่มีสระว่ายน้ำ');
  await section.getByRole('button', { name: 'บันทึกสิ่งอำนวยความสะดวก', exact: true }).click();
  await expect(section.locator('.notice.success[role="status"]')).toHaveText('บันทึกสิ่งอำนวยความสะดวกเป็นร่างแล้ว');
  await expect(pool.getByRole('radio', { name: 'ไม่มี', exact: true })).toBeChecked();
  await expect(section.locator('.count')).toHaveText('1/6');
  expect(writes[0]).toEqual({ code: 'pool', body: {
    updated_at: initialTime, status: 'absent',
    description: { th: 'ตรวจสอบแล้ว โครงการไม่มีสระว่ายน้ำ', en: 'Preserve English', zh: '保留说明' },
    location_note: '', access_note: '', evidence_note: '', expected_open_date: null,
  } });
  await page.getByRole('group', { name: 'สถานะฟิตเนส', exact: true }).getByRole('radio', { name: 'มี', exact: true }).check();
  await section.getByRole('button', { name: 'บันทึกสิ่งอำนวยความสะดวก', exact: true }).click();
  await expect(section.locator('.count')).toHaveText('2/6');
  expect(writes[1].body.updated_at).toBe(savedTime);
  expect(project.published_version_id).toBeNull();
  expect(unexpectedWrites).toEqual([]);
});

test('unsaved facility work survives tabs and blocks conflicting project and media changes until cancelled', async ({ page }) => {
  const { writes, unexpectedWrites } = await openFixture(page);
  const section = page.locator('#facilities');
  await openWorkspaceTab(page, 'supplementary');
  await page.getByRole('button', { name: 'รายละเอียด สระว่ายน้ำ', exact: true }).click();
  await page.getByLabel('รายละเอียดสระว่ายน้ำ', { exact: true }).fill('ข้อมูลที่ยังไม่บันทึก');
  await expect(page.locator('#public_name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true })).toBeDisabled();
  await openWorkspaceTab(page, 'media');
  await expect(page.locator('#assets').getByRole('button', { name: 'อัปโหลดไฟล์', exact: true })).toBeDisabled();
  await openWorkspaceTab(page, 'media');
  await expect(page.locator('#assets').getByRole('button', { name: 'เปิดคลังสื่อ', exact: true })).toBeEnabled();
  await openWorkspaceTab(page, 'unit-types');
  await openWorkspaceTab(page, 'history');
  await openWorkspaceTab(page, 'supplementary');
  await expect(page.getByLabel('รายละเอียดสระว่ายน้ำ', { exact: true })).toHaveValue('ข้อมูลที่ยังไม่บันทึก');
  await section.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await expect(section.locator('form')).toHaveCount(0);
  await expect(page.locator('#public_name')).toBeEnabled();
  await openWorkspaceTab(page, 'media');
  await expect(page.locator('#assets').getByRole('button', { name: 'อัปโหลดไฟล์', exact: true })).toBeEnabled();
  await openWorkspaceTab(page, 'supplementary');
  await page.getByRole('button', { name: 'รายละเอียด สระว่ายน้ำ', exact: true }).click();
  await expect(page.getByLabel('รายละเอียดสระว่ายน้ำ', { exact: true })).toHaveValue('');
  expect(writes).toEqual([]);
  expect(unexpectedWrites).toEqual([]);
});

test('opening date is available only for planned amenities and cleared before saving another status', async ({ page }) => {
  const { writes, unexpectedWrites } = await openFixture(page);
  const section = page.locator('#facilities');
  const status = page.getByRole('group', { name: 'สถานะสระว่ายน้ำ', exact: true });
  const date = page.getByLabel('วันที่คาดว่าจะเปิดใช้ (ถ้าทราบ)', { exact: true });
  await expect(date).toHaveCount(0);
  await status.getByRole('radio', { name: 'อยู่ในแผน', exact: true }).check();
  await date.fill('2027-01-15');
  await status.getByRole('radio', { name: 'ไม่มี', exact: true }).check();
  await expect(date).toHaveCount(0);
  await status.getByRole('radio', { name: 'อยู่ในแผน', exact: true }).check();
  await expect(date).toHaveValue('');
  await date.fill('2027-02-15');
  await status.getByRole('radio', { name: 'มี', exact: true }).check();
  await section.getByRole('button', { name: 'บันทึกสิ่งอำนวยความสะดวก', exact: true }).click();
  await expect(section.locator('.count')).toHaveText('1/6');
  expect(writes[0].body.expected_open_date).toBeNull();
  expect(writes[0].body.status).toBe('present');
  expect(unexpectedWrites).toEqual([]);
});

test('viewer sees explicit statuses and collection counts without editing controls', async ({ page }) => {
  const { writes, unexpectedWrites } = await openFixture(page, 'viewer');
  const section = page.locator('#facilities');
  await expect(section.locator('.count')).toHaveText('0/6');
  await expect(page.locator('#facilities-pool')).toContainText('ยังไม่ทราบ');
  await expect(page.locator('#facilities-clubhouse')).toContainText('มี');
  await expect(section.getByRole('button')).toHaveCount(0);
  await expect(section.getByRole('radio')).toHaveCount(0);
  await expect(section.locator('form')).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(unexpectedWrites).toEqual([]);
});

test('a stale radio choice stays editable after rejection and cancel restores the saved status', async ({ page }) => {
  const { project, writes } = await openFixture(page);
  const section = page.locator('#facilities');
  const pool = page.getByRole('group', { name: 'สถานะสระว่ายน้ำ', exact: true });
  await pool.getByRole('radio', { name: 'มี', exact: true }).check();
  project.updated_at = savedTime;
  await section.getByRole('button', { name: 'บันทึกสิ่งอำนวยความสะดวก', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('ข้อมูลเปลี่ยนไปแล้ว');
  await expect(pool.getByRole('radio', { name: 'มี', exact: true })).toBeChecked();
  await expect(pool.getByRole('radio', { name: 'ไม่มี', exact: true })).toBeEnabled();
  expect(writes[0].body.updated_at).toBe(initialTime);
  expect(project.facilities.items[0].status).toBe('unknown');
  await section.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await expect(pool.getByRole('radio', { name: 'ยังไม่ทราบ', exact: true })).toBeChecked();
  await expect(section.locator('.count')).toHaveText('0/6');
});

test('facility list and expanded planned editor fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await openFixture(page);
  const pool = page.getByRole('group', { name: 'สถานะสระว่ายน้ำ', exact: true });
  await pool.getByRole('radio', { name: 'ยังไม่ทราบ', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(pool.getByRole('radio', { name: 'อยู่ในแผน', exact: true })).toBeChecked();
  await expect(page.getByLabel('วันที่คาดว่าจะเปิดใช้ (ถ้าทราบ)', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(await page.locator('#facilities').evaluate(node => node.scrollWidth <= node.clientWidth)).toBeTruthy();
  expect(await pool.locator('label').evaluateAll(labels => labels.every(label => label.getBoundingClientRect().height >= 44))).toBeTruthy();
});
