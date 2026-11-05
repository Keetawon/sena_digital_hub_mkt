import { openWorkspaceTab } from './unified-workspace-helpers';
import { expect, test, type Page } from '@playwright/test';

const headers = { Origin: 'http://127.0.0.1:3000' };
const api = '/api/hub/v1/admin';
async function persona(page: Page, role: string) {
  expect((await page.request.post('/api/local-session', { headers, data: { role } })).ok()).toBeTruthy();
}
async function read(page: Page, path: string) {
  const response = await page.request.get(path);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}
async function patch(page: Page, path: string, data: Record<string, unknown>) {
  const current = await read(page, path);
  expect((await page.request.patch(path, { headers, data: { ...data, updated_at: current.updated_at } })).ok()).toBeTruthy();
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
}

for (const width of [1280, 390]) {
  test(`English editorial inputs persist and every outgoing field is reviewable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await persona(page, 'editor');
    const project = (await read(page, `${api}/projects`)).find((row: { source: { rem_project_id: string } }) => row.source.rem_project_id === 'DEMO-001');
    expect(project).toBeTruthy();
    const base = `${api}/projects/${project.public_project_id}`;
    const original = await read(page, base);
    const brand = (await read(page, `${api}/brands`)).find((row: { id: string }) => row.id === original.brand_id);
    const brandBase = `${api}/brands/${brand.public_brand_id}`;
    const pool = original.facilities.items.find((item: { code: string }) => item.code === 'pool');
    const suffix = `Synthetic English ${width}`;
    try {
      await page.goto(`/?project=${project.public_project_id}`);
      await page.getByLabel('ข้อความกำกับโฆษณา (ภาษาอังกฤษ)', { exact: true }).fill(`${suffix} disclaimer`);
      await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
      await expect(page.getByText('บันทึกข้อมูลร่างแล้ว ข้อมูลที่เผยแพร่ยังคงเป็นเวอร์ชันเดิม', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true })).toBeDisabled();
      await fits(page);
      await page.screenshot({ path: `artifacts/project-content-phase1/project-english-${width}.png`, fullPage: true });
      await openWorkspaceTab(page, 'supplementary');
      await page.getByLabel('ชื่อเรื่องสำหรับผู้ใช้งานข้อมูล (ภาษาอังกฤษ)', { exact: true }).fill(`${suffix} title`);
      await page.getByLabel('คำอธิบายย่อ (ภาษาอังกฤษ)', { exact: true }).fill(`${suffix} description`);
      await expect(page.getByText('ข้อความอ้างอิงภายใน Hub สำหรับตรวจและเรียบเรียง ไม่ส่งออกเว็บไซต์หรือ AI')).toBeVisible();
      await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
      await expect(page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true })).toBeDisabled();
      const saved = await read(page, base);
      expect(saved.ad_disclaimer.en).toBe(`${suffix} disclaimer`);
      expect(saved.meta_title.en).toBe(`${suffix} title`);
      expect(saved.meta_description.en).toBe(`${suffix} description`);
      expect(saved.ad_disclaimer.th).toBe(original.ad_disclaimer.th);
      await fits(page);
      await page.screenshot({ path: `artifacts/project-content-phase1/seo-english-${width}.png`, fullPage: true });

      await page.getByRole('button', { name: 'รายละเอียด สระว่ายน้ำ', exact: true }).click();
      await page.getByLabel('รายละเอียดสระว่ายน้ำ (ภาษาอังกฤษ)', { exact: true }).fill(`${suffix} pool`);
      expect(await page.locator('#facilities .table-scroll').evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
      await page.getByRole('button', { name: 'บันทึกสิ่งอำนวยความสะดวก', exact: true }).click();
      await expect(page.locator('#facilities').getByRole('status')).toHaveText('บันทึกสิ่งอำนวยความสะดวกเป็นร่างแล้ว');
      await expect(page.getByText(`${suffix} pool`, { exact: true })).toBeVisible();
      expect((await read(page, base)).facilities.items.find((item: { code: string }) => item.code === 'pool').description.en).toBe(`${suffix} pool`);
      await fits(page);
      await page.locator('#facilities-pool').screenshot({ path: `artifacts/project-content-phase1/facility-english-${width}.png` });

      await page.goto(`/?brand=${brand.public_brand_id}`);
      await page.getByLabel('คำอธิบายแบรนด์ (ภาษาอังกฤษ)', { exact: true }).fill(`${suffix} brand`);
      await page.getByRole('button', { name: 'บันทึกข้อมูลแบรนด์', exact: true }).click();
      await expect(page.getByRole('region', { name: 'บันทึกการแก้ไขแบรนด์' })).toHaveCount(0);
      expect((await read(page, brandBase)).description.en).toBe(`${suffix} brand`);
      await fits(page);
      await page.screenshot({ path: `artifacts/project-content-phase1/brand-english-${width}.png`, fullPage: true });

      await persona(page, 'publisher');
      await page.reload();
      await openWorkspaceTab(page, 'history');
      await page.getByRole('button', { name: 'เผยแพร่แบรนด์', exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('heading', { name: 'เผยแพร่แบรนด์', exact: true })).toBeInViewport();
      const brandPreview = page.getByRole('region', { name: 'เปรียบเทียบข้อมูลแบรนด์' });
      const brandDraft = await read(page, brandBase);
      expect(brandDraft.publication_preview_redacted).toBe(false);
      for (const key of Object.keys(brandDraft.publication_preview)) await expect(brandPreview.locator(`[data-field="${key}"]`)).toHaveCount(1);
      await expect(brandPreview).toContainText(`${suffix} brand`);
      await fits(page);
      await page.screenshot({ path: `artifacts/project-content-phase1/brand-review-${width}.png`, fullPage: false });
      await page.keyboard.press('Escape');

      await page.goto(`/?project=${project.public_project_id}`);
      await openWorkspaceTab(page, 'history');
      await page.getByRole('button', { name: 'เผยแพร่ข้อมูล', exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('heading', { name: 'เผยแพร่ข้อมูล', exact: true })).toBeInViewport();
      const comparison = page.getByRole('region', { name: 'เปรียบเทียบข้อมูลโครงการ' });
      const draft = await read(page, base);
      expect(draft.publication_preview_redacted).toBe(false);
      for (const key of Object.keys(draft.publication_preview)) await expect(comparison.locator(`[data-field="${key}"]`)).toHaveCount(1);
      for (const value of ['disclaimer', 'title', 'description']) await expect(comparison).toContainText(`${suffix} ${value}`);
      await expect(comparison).not.toContainText('website_content');
      await expect(comparison).not.toContainText('[object Object]');
      await fits(page);
      expect(await page.getByRole('dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBeTruthy();
      await page.screenshot({ path: `artifacts/project-content-phase1/project-review-${width}.png`, fullPage: false });
      await page.keyboard.press('Escape');

      await persona(page, 'viewer');
      await page.goto(`/?project=${project.public_project_id}`);
      await expect(page.getByLabel('ข้อความกำกับโฆษณา (ภาษาอังกฤษ)', { exact: true })).toHaveValue(`${suffix} disclaimer`);
      await expect(page.getByLabel('ข้อความกำกับโฆษณา (ภาษาอังกฤษ)', { exact: true })).toBeDisabled();
    } finally {
      await persona(page, 'editor');
      await patch(page, base, { ad_disclaimer: original.ad_disclaimer, meta_title: original.meta_title, meta_description: original.meta_description });
      await patch(page, brandBase, { description: brand.description });
      const current = await read(page, base);
      expect((await page.request.put(`${base}/facilities/pool`, { headers, data: { updated_at: current.updated_at,
        status: pool.status, description: pool.description, location_note: pool.location_note, access_note: pool.access_note,
        expected_open_date: pool.expected_open_date, evidence_note: pool.evidence_note } })).ok()).toBeTruthy();
    }
  });
}
