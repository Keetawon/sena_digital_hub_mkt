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
    public_project_id: 'facility-test', public_name: { th: 'โครงการจำลองสิ่งอำนวยความสะดวก' },
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
  // Every Hub request is intercepted: these tests never write a real project.
  await page.route('**/api/hub/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/hub/v1/admin/', '');
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
  await page.getByRole('tab', { name: /ข้อมูลเสริม/ }).click();
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
  await expect(section.getByRole('status')).toHaveText('บันทึกสิ่งอำนวยความสะดวกเป็นร่างแล้ว');
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
  await page.getByRole('tab', { name: /ข้อมูลเสริม/ }).click();
  await page.getByRole('button', { name: 'รายละเอียด สระว่ายน้ำ', exact: true }).click();
  await page.getByLabel('รายละเอียดสระว่ายน้ำ', { exact: true }).fill('ข้อมูลที่ยังไม่บันทึก');
  await expect(page.locator('#public_name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: /รูปภาพ/ }).click();
  await expect(page.locator('#assets').getByRole('button', { name: 'อัปโหลดไฟล์', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: /รูปภาพ/ }).click();
  await expect(page.locator('#assets').getByRole('button', { name: 'เปิดคลังสื่อ', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: /แบบที่อยู่อาศัย/ }).click();
  await page.getByRole('tab', { name: /เผยแพร่และประวัติ/ }).click();
  await page.getByRole('tab', { name: /ข้อมูลเสริม/ }).click();
  await expect(page.getByLabel('รายละเอียดสระว่ายน้ำ', { exact: true })).toHaveValue('ข้อมูลที่ยังไม่บันทึก');
  await section.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await expect(section.locator('form')).toHaveCount(0);
  await expect(page.locator('#public_name')).toBeEnabled();
  await page.getByRole('tab', { name: /รูปภาพ/ }).click();
  await expect(page.locator('#assets').getByRole('button', { name: 'อัปโหลดไฟล์', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: /ข้อมูลเสริม/ }).click();
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
