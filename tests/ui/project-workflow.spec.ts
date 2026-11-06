import { openWorkspaceTab } from './unified-workspace-helpers';
import { expect, test, type Page } from '@playwright/test';
import { approveLegacySource, confirmPublication, confirmSourceCommand, persona, preparePublication, publishingGrant, readData, sourceHistory, workflowText } from './content-workflow-fixtures';

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
  await page.goto('/website?view=projects');
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
  await openWorkspaceTab(page, 'data');
  await expect(page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)')).toBeVisible();
}

async function publish(page: Page, publicId: string, reason: string) {
  const project = await approveLegacySource(page, 'project', publicId);
  await persona(page, 'viewer');
  const review = await preparePublication(page, [{ system: 'release', entity_type: 'project', entity_id: project.id }], reason);
  await confirmPublication(page, review);
}

test('Thai draft → publish → isolated edit → rollback → withdrawal', async ({ page }) => {
  test.setTimeout(120_000);
  const original = await enter(page, 'editor');
  const adminPath = `/api/hub/v1/admin/projects/${original.public_project_id}`;
  const publicPath = `/api/hub/v1/projects/${original.public_project_id}`;
  const grant = await publishingGrant();
  try {
    const translated = await page.request.patch(adminPath, { headers: { Origin: origin }, data: {
      updated_at: original.updated_at,
      public_name: { ...original.public_name, en: 'Synthetic English translation to preserve' },
    } });
    expect(translated.ok()).toBeTruthy();
    // Only the two named positive DEMO-001 images opt in for this publication.
    for (const [id, assetRole] of [
      ['10000000-0000-0000-0000-000000000001', 'hero'],
      ['10000000-0000-0000-0000-000000000002', 'thumbnail'],
    ]) {
      const source = await readData(page, adminPath), media = await readData(page, `${adminPath}/media`);
      const binding = source.assets.find((item: { id: string; asset_role: string }) => item.id === id && item.asset_role === assetRole);
      const asset = media.assets.find((item: { id: string }) => item.id === id);
      expect(binding).toBeTruthy(); expect(asset).toBeTruthy();
      const confirmed = await page.request.put(`${adminPath}/media/assets/${id}`, { headers: { Origin: origin }, data: {
        expected_revision: asset.media_revision,
        changes: { media_category: 'exterior', alt_text: binding.alt_text, metadata_state: 'confirmed', marketing_publication: true, ai_exposure: 'web_only' },
      } });
      expect(confirmed.ok()).toBeTruthy();
    }
    await page.reload();
    await page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)').fill('โครงการจำลอง — ทดสอบเวอร์ชันแรก');
    await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
    await expect(page.getByText('บันทึกข้อมูลร่างแล้ว ข้อมูลที่เผยแพร่ยังคงเป็นเวอร์ชันเดิม', { exact: true })).toBeVisible();
    await publish(page, original.public_project_id, 'ทดสอบการเผยแพร่ข้อมูลจำลองครั้งแรก');
    const first = await (await page.request.get(publicPath)).json();
    const firstVersion = (await readData(page, adminPath)).published_version_id;
    expect(first.data.public_name.th).toBe('โครงการจำลอง — ทดสอบเวอร์ชันแรก');
    expect(first.data.public_name.en).toBe('Synthetic English translation to preserve');

    await persona(page, 'editor'); await page.goto(`/?project=${original.public_project_id}`);
    await page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)').fill('โครงการจำลอง — ทดสอบเวอร์ชันที่สอง');
    await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
    await expect(page.getByText('บันทึกข้อมูลร่างแล้ว ข้อมูลที่เผยแพร่ยังคงเป็นเวอร์ชันเดิม', { exact: true })).toBeVisible();
    const unchanged = await (await page.request.get(publicPath)).json();
    expect(unchanged.data).toEqual(first.data);
    await publish(page, original.public_project_id, 'ทดสอบการเผยแพร่ข้อมูลจำลองครั้งที่สอง');
    expect((await (await page.request.get(publicPath)).json()).data.public_name.th).toBe('โครงการจำลอง — ทดสอบเวอร์ชันที่สอง');

    let history = await sourceHistory(page, 'project', original.public_project_id);
    await history.locator(`[data-source-version="${firstVersion}"]`).click();
    await confirmSourceCommand(page, history.getByRole('button', { name: workflowText.restore_version, exact: true }), 'ทดสอบคืนค่าเวอร์ชันข้อมูลจำลอง');
    expect((await (await page.request.get(publicPath)).json()).data).toEqual(first.data);
    history = await sourceHistory(page, 'project', original.public_project_id);
    await confirmSourceCommand(page, history.getByRole('button', { name: workflowText.withdraw_page, exact: true }), 'สิ้นสุดการทดสอบข้อมูลจำลอง');
    expect((await page.request.get(publicPath)).status()).toBe(404);
  } finally {
    await grant.restore();
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
  await openWorkspaceTab(page, 'history');
  await expect(page.getByRole('button', { name: workflowText.publish, exact: true })).toHaveCount(0);
  const denied = await page.request.post(`/api/hub/v1/admin/projects/${project.public_project_id}/publish`, { headers: { Origin: origin }, data: { change_reason: 'must fail as editor' } });
  expect(denied.status()).toBe(403);
  await page.goto('/publish');
  await expect(page.locator('.publication-workspace > form')).toHaveCount(0);
  await expect(page.getByRole('button', { name: workflowText.publish, exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/hub/v1/admin/projects?unexpected=1')).status()).toBe(404);
});

test('mobile layout, Thai labels and keyboard tab navigation remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enter(page, 'editor');
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const content = page.locator('#workspace-tab-data');
  await content.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#workspace-tab-unit-types')).toBeFocused();
  await expect(page.locator('#workspace-tab-unit-types')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.locator('#workspace-tab-history')).toBeFocused();
  await expect(page.locator('#workspace-tab-history')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(page.locator('#workspace-tab-overview')).toBeFocused();
  await page.keyboard.press('ArrowRight');
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
