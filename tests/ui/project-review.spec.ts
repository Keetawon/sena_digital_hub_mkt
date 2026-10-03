import { expect, test } from '@playwright/test';
import { projectChanges } from '../../apps/admin/components/project-review';
import type { Project } from '../../apps/admin/components/hub-admin';

const time = '2026-10-03T08:00:00Z';
const fixture = (): Project => ({ public_project_id: 'review-test', public_name: { th: 'ชื่อใหม่', en: 'New' },
  slug: 'review-test', updated_at: time, published_version_id: 'version-1', publication_available: true,
  readiness: { ready: true, percent: 100, missing: [] }, address: { th: 'กรุงเทพมหานคร' }, latitude: 13.7563, longitude: 100.5018,
  models: [], assets: [], ad_disclaimer: { th: 'ข้อความจำลอง' } });

test('comparison excludes staff metadata and optional modules, detects multilingual and media changes', () => {
  const before = fixture(), after = structuredClone(before);
  after.updated_at = '2026-10-04T08:00:00Z'; after.readiness.ready = false; after.demo_fields = { internal: true };
  expect(projectChanges(after, before)).toEqual([]);
  after.public_name.en = 'Changed'; after.longitude = 101;
  expect(projectChanges(after, before).map(item => item.key)).toEqual(['public_name', 'longitude']);
  after.assets = [{ id: 'a', binding_id: 'b', asset_role: 'hero', rights_status: 'approved', public_url: null,
    original_filename: 'sample.png', mime_type: 'image/png', alt_text: { th: 'ภาพจำลอง' }, display_order: 0 }];
  expect(projectChanges(after, before).map(item => item.key)).toContain('assets');
});

test('publish preview lists changed fields, role attribution and ready text; opening it writes nothing', async ({ page }) => {
  const project = fixture(), live = { ...fixture(), public_name: { th: 'ชื่อเดิม', en: 'New' } };
  const writes: string[] = [];
  await page.context().addCookies([{ name: 'sena_local_persona', value: 'publisher', url: 'http://127.0.0.1:3000' }]);
  await page.route('**/api/hub/**', async route => {
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/projects/review-test') ? project : path.endsWith('/projects/review-test/versions') ? [{ version_id: 'version-1', version_no: 1,
      published_at: time, publisher: '00000000-0000-0000-0000-000000000002', change_reason: 'ตัวอย่าง', payload: live }] : [];
    await route.fulfill({ json: { data } });
  });
  await page.goto('/?project=review-test');
  await expect(page.locator('.detail-heading .status-badge')).toHaveText('มีการแก้ไขที่ยังไม่เผยแพร่');
  await page.getByRole('tab', { name: /เผยแพร่และประวัติ/ }).click();
  await expect(page.locator('.readiness-compact-number')).toHaveText('พร้อมเผยแพร่ · ไม่มีรายการค้าง');
  await expect(page.locator('.project-save-bar')).toHaveCount(0);
  await expect(page.locator('.version-list')).toContainText('ผู้เผยแพร่');
  await expect(page.locator('.version-list')).not.toContainText('00000000-');
  await page.getByRole('button', { name: 'เผยแพร่ข้อมูล', exact: true }).click();
  const diff = page.getByRole('region', { name: 'เปรียบเทียบข้อมูลโครงการ' });
  await expect(diff.locator('[data-field]')).toHaveCount(1);
  await expect(diff).toContainText('ชื่อเดิม'); await expect(diff).toContainText('ชื่อใหม่');
  await page.getByRole('dialog').getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  expect(writes).toEqual([]);
  project.published_version_id = null; project.publication_available = false;
  await page.reload();
  await expect(page.locator('.detail-heading .status-badge')).toHaveText('ถอนการเผยแพร่แล้ว');
});

test('five tabs and one-row mobile save bar fit; optional fields stay on the optional tab', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.context().addCookies([{ name: 'sena_local_persona', value: 'editor', url: 'http://127.0.0.1:3000' }]);
  await page.route('**/api/hub/**', route => route.fulfill({ json: { data: route.request().url().endsWith('/projects/review-test') ? { ...fixture(), published_version_id: null } : [] } }));
  await page.goto('/?project=review-test');
  await expect(page.getByRole('tab')).toHaveCount(5);
  await page.getByRole('tab', { name: /ข้อมูลเสริม/ }).click();
  await expect(page.locator('#meta_title')).toBeVisible();
  await expect(page.locator('#slug')).toBeHidden();
  const bar = page.locator('.project-save-bar');
  await bar.scrollIntoViewIfNeeded();
  const bounds = await bar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().top));
  expect(new Set(bounds).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
