import { uploadText } from '../../apps/admin/lib/upload-text';
import { closeMobileMenu, openMobileMenu } from './hub-navigation-helpers';
import { openWorkspaceTab } from './unified-workspace-helpers';
import { mockWorkspaceProjection } from './unified-workspace-helpers';
import { expect, test, type Page } from '@playwright/test';
import { mockWorkflowReads, refreshSyntheticAuthority, sourceHistory, workflowText } from './content-workflow-fixtures';

const api = '/api/hub/v1/admin';
const origin = 'http://127.0.0.1:3000';
type Row = Record<string, any>;
const stamp = '2026-10-02T03:00:00Z';
const logo = { id: '76000000-0000-4000-8000-000000000001', binding_id: '76000000-0000-4000-8000-000000000002', asset_role: 'logo_primary', is_primary: true, alt_text: { th: 'โลโก้แบรนด์สมมติ' }, display_order: 0, public_url: '/demo-assets/brand-logo.svg', original_filename: 'synthetic-brand-review.svg', mime_type: 'image/svg+xml', rights_status: 'approved', effective_from: null, effective_to: null };

// Mock the same public-only RPC contract used by the live review screen.
function attachPreview(row: Row) {
  row.publication_preview = { public_brand_id: row.public_brand_id, public_name: row.public_name, description: row.description,
    slug: row.slug, status: row.status, assets: [...row.assets].sort((a, b) => a.asset_role.localeCompare(b.asset_role) || a.display_order - b.display_order || a.id.localeCompare(b.id))
      .map(asset => ({ public_asset_id: asset.id.replaceAll('-', '').padEnd(64, '0'), asset_role: asset.asset_role,
        is_primary: asset.is_primary, alt_text: asset.alt_text, display_order: asset.display_order, public_url: asset.public_url,
        mime_type: asset.mime_type, effective_from: asset.effective_from, effective_to: asset.effective_to })) };
}
function brand(key: string, title: string): Row {
  return {
    id: `77000000-0000-4000-8000-00000000000${['ready', 'changed', 'missing', 'same', 'stopped', 'withdrawn'].indexOf(key) + 1}`, public_brand_id: `brd_${key}`, rem_brand_id: `000-${key}`,
    public_name: { th: title, en: `Synthetic ${key}` }, description: { th: 'รายละเอียดแบรนด์สมมติสำหรับทดสอบเท่านั้น' },
    slug: `synthetic-${key}`, status: 'active', updated_at: stamp, published_version_id: null,
    publication_available: false, readiness: { ready: true, percent: 100, missing: [] }, assets: [{ ...logo }], projects: [],
    source: { rem_brand_id: `000-${key}`, brand_name_rem: title, brand_name_en_rem: null, is_deleted: false, source_updated_at: stamp, source_snapshot_at: stamp, source_fingerprint: key, source_record: null, intake_manifest_sha256: null },
  };
}

async function fixture(page: Page, role = 'publisher') {
  expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role } })).ok()).toBeTruthy();
  const rows = [brand('ready', 'รอเผยแพร่ครั้งแรก'), brand('changed', 'เผยแพร่แล้วมีชื่อใหม่'), brand('missing', 'ยังขาดข้อมูล'), brand('same', 'ฉบับร่างตรงกับที่เผยแพร่'), brand('stopped', 'แบรนด์หยุดแสดง'), brand('withdrawn', 'แบรนด์ถอนการเผยแพร่')];
  const versions: Record<string, Row[]> = Object.fromEntries(rows.map(row => [row.public_brand_id, []]));
  for (const key of ['changed', 'same', 'stopped', 'withdrawn']) {
    const row = rows.find(item => item.public_brand_id === `brd_${key}`)!;
    const payload = structuredClone(row);
    row.published_version_id = row.id.replace('77000000', '78000000'); row.publication_available = !['stopped', 'withdrawn'].includes(key);
    versions[row.public_brand_id] = [{ version_id: row.published_version_id, version_no: 1, published_at: stamp, publisher: 'ผู้เผยแพร่สมมติ', change_reason: 'ข้อมูลสังเคราะห์ทดสอบเท่านั้น', payload }];
  }
  rows[5].published_version_id = null;
  versions.brd_changed[0].payload.public_name = { en: 'Synthetic changed', th: 'ชื่อก่อนเผยแพร่' };
  rows[2].readiness = { ready: false, percent: 80, missing: [{ field: 'description.th', message: 'กรอกคำอธิบายแบรนด์ภาษาไทย' }] };
  rows[2].description = {};
  // Admin-only metadata and JSON object/array ordering cannot create a false edit.
  const whiteLogo = { ...logo, id: '76000000-0000-4000-8000-000000000003', asset_role: 'logo_white', is_primary: false, display_order: 1 };
  versions.brd_same[0].payload.assets.push(whiteLogo);
  rows[3].assets = [{ ...whiteLogo, checksum: 'new-admin-metadata' }, { ...logo, binding_id: 'different-binding-metadata', asset_effective_from: stamp }];
  rows[3].public_name = { en: 'Synthetic same', th: 'ฉบับร่างตรงกับที่เผยแพร่' };
  let failVersions = false;
  const writes: string[] = [];
  await page.route(`**${api}/brands**`, async route => {
    rows.forEach(attachPreview);
    Object.values(versions).flat().forEach(version => attachPreview(version.payload));
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') { writes.push(path); return route.fulfill({ status: 409, json: { error: { message: 'ชุดทดสอบนี้อ่านข้อมูลเท่านั้น' } } }); }
    if (path === `${api}/brands`) return route.fulfill({ json: { data: rows } });
    if (path === `${api}/brands/completeness`) {
      const dashboardRows = rows.map((row, index) => ({ id: row.id, public_brand_id: row.public_brand_id, rem_brand_id: row.rem_brand_id, name_th: row.public_name.th, name_en: row.public_name.en, residential_project_count: 1,
        status: row.publication_available ? index === 1 ? 'published_changes' : 'published' : row.readiness.ready ? 'ready' : 'missing_data', readiness: row.readiness,
        checks: { name_th_confirmed: true, description: index !== 2, slug: true, primary_logo: true, logo_rights: true }, optional_logos: [], reason_codes: [], updated_at: stamp, updated_by: 'synthetic-editor',
        publication_available: row.publication_available, has_unpublished_changes: index === 0 || index === 1, published_version_id: row.published_version_id })).sort((a, b) => b.readiness.missing.length - a.readiness.missing.length || a.rem_brand_id.localeCompare(b.rem_brand_id));
      return route.fulfill({ json: { data: { rows: dashboardRows, counts: { total: 6, missing_data: 1, ready: 4, published: 2, published_changes: 1, not_created: 0 } } } });
    }
    const key = path.slice(`${api}/brands/`.length).split('/')[0];
    if (path.endsWith('/versions')) return failVersions ? route.fulfill({ status: 503, json: { error: { message: 'โหลดเวอร์ชันสำหรับตรวจสอบไม่สำเร็จ' } } }) : route.fulfill({ json: { data: versions[key] ?? [] } });
    return route.fulfill({ json: { data: rows.find(row => row.public_brand_id === key) } });
  });
  await page.route(`**${api}/brand-requests`, route => route.fulfill({ json: { data: [] } }));
  await mockWorkspaceProjection(page, rows);
  await mockWorkflowReads(page, { role, publish: role === 'publisher' });
  return { rows, versions, writes, failVersions: (value: boolean) => { failVersions = value; } };
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`publisher opens an incomplete brand and its logo rights review at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); const data = await fixture(page);
    const pendingLogo = { ...logo, rights_status: 'pending', updated_at: stamp, rights_notes: null };
    data.rows[2].assets = [pendingLogo];
    data.rows[2].readiness.missing.push({ field: 'assets.logo_primary', message: 'ตรวจสิทธิ์โลโก้หลักก่อนเผยแพร่' });
    await page.route(`**${api}/assets/${logo.id}`, route => route.fulfill({ json: { data: pendingLogo } }));
    await page.goto('/?view=brands');
    await refreshSyntheticAuthority(page);
    await expect(page.getByRole('checkbox', { name: 'เลือกเผยแพร่ ยังขาดข้อมูล', exact: true })).toBeDisabled();
    await page.getByRole('link', { name: 'เปิดตรวจแบรนด์ ยังขาดข้อมูล', exact: true }).click();
    await expect(page).toHaveURL(/\/website\/brand\/brd_missing\?.*return_to=/);
    await expect(page.locator('.detail-heading')).toContainText('ยังขาดข้อมูล');
    await openWorkspaceTab(page, 'history');
    await expect(page.locator('.brand-readiness')).toContainText('ตรวจสิทธิ์โลโก้หลักก่อนเผยแพร่');
    await expect(page.getByRole('button', { name: workflowText.publish, exact: true })).toHaveCount(0);
    await page.locator('#workspace-tab-media').click();
    await page.getByRole('checkbox', { name: `เลือกอนุมัติ ${logo.original_filename}`, exact: true }).check();
    await page.getByRole('button', { name: 'อนุมัติใช้โลโก้ที่เลือก (1)', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'อนุมัติใช้โลโก้', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'ยืนยันอนุมัติ 1 ไฟล์', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: uploadText.evidence_load, exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'ยืนยันอนุมัติ 1 ไฟล์', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
    expect(data.writes).toEqual([]);
  });

  test(`brand review queue has overlapping counts and publisher menu badge at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); const data = await fixture(page); await page.goto('/?view=brands');
    await refreshSyntheticAuthority(page);
    const filters: [string, number, string[]][] = [
      ['ทั้งหมด', 6, ['ยังขาดข้อมูล', 'เผยแพร่แล้วมีชื่อใหม่', 'รอเผยแพร่ครั้งแรก', 'ฉบับร่างตรงกับที่เผยแพร่', 'แบรนด์หยุดแสดง', 'แบรนด์ถอนการเผยแพร่']],
      ['พร้อมเผยแพร่', 4, ['เผยแพร่แล้วมีชื่อใหม่', 'รอเผยแพร่ครั้งแรก', 'แบรนด์หยุดแสดง', 'แบรนด์ถอนการเผยแพร่']],
      ['ยังขาดข้อมูล', 1, ['ยังขาดข้อมูล']],
      ['เผยแพร่แล้ว', 2, ['เผยแพร่แล้วมีชื่อใหม่', 'ฉบับร่างตรงกับที่เผยแพร่']],
      ['เผยแพร่แล้วมีการแก้ไข', 1, ['เผยแพร่แล้วมีชื่อใหม่']],
    ];
    for (const [label, count, titles] of filters) {
      const filter = page.getByRole('button', { name: `${label} ${count}`, exact: true });
      await expect(filter).toBeVisible(); await filter.click(); await expect(filter).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.brand-table-row td[data-label="ชื่อแบรนด์"] a')).toHaveText(titles);
    }
    await page.getByRole('button', { name: 'ทั้งหมด 6', exact: true }).click();
    await expect(page.locator('.brand-table-row').filter({ has: page.getByRole('link', { name: 'ฉบับร่างตรงกับที่เผยแพร่', exact: true }) }).getByText(/มีการแก้ไขรอเผยแพร่/)).toHaveCount(0);
    await expect(page.locator('.brand-table-row').filter({ has: page.getByRole('link', { name: 'แบรนด์ถอนการเผยแพร่', exact: true }) }).getByText(/มีการแก้ไขรอเผยแพร่/)).toHaveCount(0);
    await openMobileMenu(page);
    const menu = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
    const link = menu.locator('.hub-brand-count-link');
    await expect(link).toHaveAttribute('href', '/website?view=brands');
    await expect(link).toHaveAttribute('title', 'รอเผยแพร่ 2 แบรนด์');
    await expect(link.locator('.hub-nav-count')).toHaveText('2');
    if (viewport.width === 390) { await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'เปิดเมนู', exact: true })).toBeFocused(); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(data.writes).toEqual([]);
  });
}

test('logo content changes count as edits while readonly metadata and ordering do not', async ({ page }) => {
  const data = await fixture(page);
  const secondWhite = { ...logo, id: '76000000-0000-4000-8000-000000000004', asset_role: 'logo_white', is_primary: false, display_order: 2, alt_text: { th: 'โลโก้สีขาวรองเดิม' } };
  data.rows[3].assets.push(structuredClone(secondWhite)); data.versions.brd_same[0].payload.assets.push(structuredClone(secondWhite));
  await page.goto('/?brand=brd_same');
  await expect(page.locator('.detail-heading')).toContainText('ฉบับร่างตรงกับที่เผยแพร่');
  await expect(page.locator('.detail-heading').getByText('มีการแก้ไขรอเผยแพร่', { exact: true })).toHaveCount(0);
  data.rows[3].assets[2].alt_text = { th: 'คำอธิบายโลโก้สีขาวรองที่แก้ไข' };
  await page.reload(); await expect(page.locator('.detail-heading').getByText('มีการแก้ไขรอเผยแพร่', { exact: true })).toBeVisible();
  const history = await sourceHistory(page, 'brand', 'brd_same');
  const comparison = history.getByRole('region', { name: `${workflowText.before} / ${workflowText.after}`, exact: true });
  await expect(comparison.locator('[data-field="assets"]')).toHaveClass(/changed/);
  await expect(comparison.locator('[data-field="assets"]')).toContainText('คำอธิบายโลโก้สีขาวรองที่แก้ไข');
  await expect(comparison.locator('[data-field="assets"]')).toContainText('โลโก้สีขาวรองเดิม');
  for (const field of ['public_name', 'description', 'slug', 'status']) await expect(comparison.locator(`[data-field="${field}"]`)).not.toHaveClass(/changed/);
  expect(data.writes).toEqual([]);
});

test('unavailable version reads stay unknown and exact retained actions wait for snapshots to reload', async ({ page }) => {
  const data = await fixture(page); data.failVersions(true); await page.goto('/?view=brands');
  await refreshSyntheticAuthority(page);
  await expect(page.getByRole('button', { name: 'พร้อมเผยแพร่ 4', exact: true })).toBeVisible();
  await openMobileMenu(page);
  await expect(page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).locator('.hub-nav-count')).toHaveText('…');
  await closeMobileMenu(page);
  data.failVersions(false); await page.reload();
  await expect(page.getByRole('button', { name: 'พร้อมเผยแพร่ 4', exact: true })).toBeVisible();
  data.failVersions(true); const history = await sourceHistory(page, 'brand', 'brd_changed');
  await expect(history.getByRole('alert')).toBeVisible();
  await expect(history.locator('[data-source-version]')).toHaveCount(0);
  await expect(history.getByRole('button', { name: workflowText.restore_version, exact: true })).toHaveCount(0);
  await expect(history).toContainText('เผยแพร่แล้วมีชื่อใหม่');
  await expect(history).not.toContainText('ชื่อก่อนเผยแพร่');
  data.failVersions(false); await history.getByRole('button', { name: workflowText.retry, exact: true }).click();
  await expect(history.locator(`[data-source-version="${data.versions.brd_changed[0].version_id}"]`)).toBeVisible();
  await expect(history.locator('[data-field="public_name"]')).toHaveClass(/changed/);
  await expect(history).toContainText('ชื่อก่อนเผยแพร่');
  expect(data.writes).toEqual([]);
});
