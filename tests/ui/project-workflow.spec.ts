import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:3000';

async function selectLoadedRole(page: Page, role: string) {
  // The selector updates before its full-page navigation. Wait for the new
  // document so a dashboard click cannot land on the page being replaced.
  const navigation = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
  await page.getByLabel('เลือกบัญชีทดสอบ').selectOption(role);
  await navigation;
  await page.waitForLoadState('domcontentloaded');
}

async function enter(page: Page, role: 'editor' | 'publisher' | 'viewer') {
  await page.goto('/');
  await expect(page.getByText('พื้นที่ทดสอบในเครื่อง', { exact: true })).toBeVisible();
  await selectLoadedRole(page, role);
  await expect(page.getByLabel('ค้นหาโครงการ แบรนด์ หรือรหัส REM')).toBeVisible();
  const response = await page.request.get('/api/hub/v1/admin/projects');
  expect(response.ok()).toBeTruthy();
  const project = (await response.json()).data.find((item: { source: { rem_project_id: string } }) => item.source.rem_project_id === 'DEMO-001');
  expect(project).toBeDefined();
  expect(project.source.rem_project_id).toBe('DEMO-001');
  // This original synthetic seed has no REM ProjectStatus, so opt into unknowns.
  // Its controlled value follows the URL update, so assert the eventual state.
  const includeOther = page.getByRole('checkbox', { name: 'แสดงโครงการปิด ถูกลบ และไม่ทราบสถานะ' });
  await includeOther.click();
  await expect(includeOther).toBeChecked();
  await page.getByLabel('ค้นหาโครงการ แบรนด์ หรือรหัส REM').fill('DEMO-001');
  await page.locator(`.project-dashboard a.project-row-action[href^="/?project=${project.public_project_id}&"]`).click();
  await expect(page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)')).toBeVisible();
  return project;
}

async function switchRole(page: Page, role: string) {
  await selectLoadedRole(page, role);
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toBeEnabled();
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue(role);
  await page.getByRole('tab', { name: /ข้อมูลหลัก/ }).click();
  await expect(page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)')).toBeVisible();
}

async function publish(page: Page, reason: string) {
  await page.getByRole('tab', { name: /เผยแพร่และประวัติ/ }).click();
  await page.getByRole('button', { name: 'เผยแพร่ข้อมูล', exact: true }).click();
  await page.getByLabel('เหตุผลในการดำเนินการ').fill(reason);
  await page.getByRole('button', { name: 'ยืนยันเผยแพร่ข้อมูล', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('เผยแพร่ข้อมูลแล้ว ผู้ใช้งาน API จะเห็นเวอร์ชันนี้', { exact: true })).toBeVisible();
}

test('Thai draft → publish → isolated edit → rollback → withdrawal', async ({ page }) => {
  const original = await enter(page, 'editor');
  const adminPath = `/api/hub/v1/admin/projects/${original.public_project_id}`;
  const publicPath = `/api/hub/v1/projects/${original.public_project_id}`;
  try {
    const translated = await page.request.patch(adminPath, { headers: { Origin: origin }, data: {
      updated_at: original.updated_at,
      public_name: { ...original.public_name, en: 'Synthetic English translation to preserve' },
    } });
    expect(translated.ok()).toBeTruthy();
    await page.reload();
    await page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)').fill('โครงการจำลอง — ทดสอบเวอร์ชันแรก');
    await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
    await expect(page.getByText('บันทึกข้อมูลร่างแล้ว ข้อมูลที่เผยแพร่ยังคงเป็นเวอร์ชันเดิม', { exact: true })).toBeVisible();
    await switchRole(page, 'publisher');
    await publish(page, 'ทดสอบการเผยแพร่ข้อมูลจำลองครั้งแรก');
    const first = await (await page.request.get(publicPath)).json();
    expect(first.data.public_name.th).toBe('โครงการจำลอง — ทดสอบเวอร์ชันแรก');
    expect(first.data.public_name.en).toBe('Synthetic English translation to preserve');

    await switchRole(page, 'editor');
    await page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)').fill('โครงการจำลอง — ทดสอบเวอร์ชันที่สอง');
    await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
    await expect(page.getByText('บันทึกข้อมูลร่างแล้ว ข้อมูลที่เผยแพร่ยังคงเป็นเวอร์ชันเดิม', { exact: true })).toBeVisible();
    const unchanged = await (await page.request.get(publicPath)).json();
    expect(unchanged.data).toEqual(first.data);
    await switchRole(page, 'publisher');
    await publish(page, 'ทดสอบการเผยแพร่ข้อมูลจำลองครั้งที่สอง');
    expect((await (await page.request.get(publicPath)).json()).data.public_name.th).toBe('โครงการจำลอง — ทดสอบเวอร์ชันที่สอง');

    await page.getByRole('tab', { name: /เผยแพร่และประวัติ/ }).click();
    const previous = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `เวอร์ชัน ${first.meta.entity_version}`, exact: true }) });
    await previous.getByRole('button', { name: 'คืนค่าเวอร์ชันนี้', exact: true }).click();
    await page.getByLabel('เหตุผลในการดำเนินการ').fill('ทดสอบคืนค่าเวอร์ชันข้อมูลจำลอง');
    await page.getByRole('button', { name: 'ยืนยันคืนค่าเวอร์ชัน', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await (await page.request.get(publicPath)).json()).data).toEqual(first.data);
    await page.getByRole('tab', { name: /เผยแพร่และประวัติ/ }).click();
    await page.getByRole('button', { name: 'ถอนการเผยแพร่', exact: true }).click();
    await page.getByLabel('เหตุผลในการดำเนินการ').fill('สิ้นสุดการทดสอบข้อมูลจำลอง');
    await page.getByRole('button', { name: 'ยืนยันถอนการเผยแพร่', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await page.request.get(publicPath)).status()).toBe(404);
  } finally {
    // Restore editable sample values; keep the audit history as evidence.
    await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role: 'editor' } });
    const current = (await (await page.request.get(adminPath)).json()).data;
    const restored = await page.request.patch(adminPath, { headers: { Origin: origin }, data: { updated_at: current.updated_at, public_name: original.public_name } });
    expect(restored.ok()).toBeTruthy();
  }
});

test('viewer cannot edit, editor cannot publish and source values stay read-only', async ({ page }) => {
  const project = await enter(page, 'viewer');
  await expect(page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true })).toHaveCount(0);
  await expect(page.locator('#gold-project_id')).toContainText('DEMO-001');
  await expect(page.locator('.source-field input')).toHaveCount(0);
  await switchRole(page, 'editor');
  await page.getByRole('tab', { name: /เผยแพร่และประวัติ/ }).click();
  await expect(page.getByRole('button', { name: 'เผยแพร่ข้อมูล', exact: true })).toHaveCount(0);
  const denied = await page.request.post(`/api/hub/v1/admin/projects/${project.public_project_id}/publish`, { headers: { Origin: origin }, data: { change_reason: 'must fail as editor' } });
  expect(denied.status()).toBe(403);
  expect((await page.request.get('/api/hub/v1/admin/projects?unexpected=1')).status()).toBe(404);
});

test('mobile layout, Thai labels and keyboard tab navigation remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enter(page, 'editor');
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const content = page.getByRole('tab', { name: /ข้อมูลหลัก/ });
  await content.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /รูปภาพ/ })).toBeFocused();
  await expect(page.getByRole('tab', { name: /รูปภาพ/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /เผยแพร่และประวัติ/ })).toBeFocused();
  await expect(page.getByRole('tab', { name: /เผยแพร่และประวัติ/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(content).toBeFocused();
  await page.screenshot({ path: 'artifacts/hub-mobile.png', fullPage: true });
});

test('test-session setup rejects cross-origin requests', async ({ request }) => {
  const denied = await request.post('/api/local-session', { headers: { Origin: 'https://example.invalid' }, data: { role: 'publisher' } });
  expect(denied.status()).toBe(403);
  const absent = await request.post('/api/local-session', { data: { role: 'publisher' } });
  expect(absent.status()).toBe(403);
});

test('cancelling a test-role switch preserves unsaved Thai edits', async ({ page }) => {
  await enter(page, 'editor');
  await page.screenshot({ path: 'artifacts/hub-desktop.png', fullPage: true });
  await page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)').fill('ข้อมูลร่างที่ยังไม่ได้บันทึก');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByLabel('เลือกบัญชีทดสอบ').selectOption('publisher');
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue('editor');
  await expect(page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)')).toHaveValue('ข้อมูลร่างที่ยังไม่ได้บันทึก');
  await expect(page.getByText('มีข้อมูลที่ยังไม่ได้บันทึก', { exact: true })).toBeVisible();
});
