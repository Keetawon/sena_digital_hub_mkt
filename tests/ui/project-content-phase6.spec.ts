import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const headers = { Origin: 'http://127.0.0.1:3000' }, api = '/api/hub/v1/admin';
const today = new Date().toISOString().slice(0, 10), expired = new Date(Date.now() - 190 * 86400000).toISOString().slice(0, 10);
async function persona(page: Page, role: string) { expect((await page.request.post('/api/local-session', { headers, data: { role } })).ok()).toBeTruthy(); }
async function read(page: Page, path: string) { const response = await page.request.get(path); expect(response.ok(), path).toBeTruthy(); return (await response.json()).data; }
async function fits(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy(); }

for (const width of [1280, 390]) {
  test(`FAQ coverage hides expired facts, claims one gap and refreshes a zero value at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    const project = (await read(page, `${api}/projects`)).find((p: { source: { rem_project_id: string } }) => p.source.rem_project_id === 'DEMO-001');
    const publicId = project.public_project_id, key = `synthetic_coverage_${width}_${randomUUID().slice(0, 8).replaceAll('-', '')}`;
    const label = `ค่าส่วนกลางสำหรับทดสอบ ${width}`;
    let content = await read(page, `${api}/projects/${publicId}/content`);
    let fact = content.facts.find((f: { fact_key: string }) => f.fact_key === 'project.common_fee');
    expect((await page.request.put(`${api}/projects/${publicId}/facts/project.common_fee`, { headers, data: { expected_revision: fact?.revision ?? 0, changes: { value_number: 25, unit: 'THB/sqm/month', as_of: expired } } })).ok()).toBeTruthy();
    expect((await page.request.put(`${api}/faq/questions/${key}`, { headers, data: { expected_revision: 0, changes: { topic: 'design', default_level: 'project', question_template: { th: label }, answer_kind: 'fact', fact_keys: ['project.common_fee'], is_core: true, show_on_project_pages: true } } })).ok()).toBeTruthy();
    await persona(page, 'publisher');
    expect((await page.request.post(`${api}/faq/questions/${key}/approve`, { headers, data: { expected_revision: 1, decision: 'approved' } })).ok()).toBeTruthy();
    await persona(page, 'editor');
    const created = await page.request.post(`${api}/faq`, { headers, data: { expected_revision: 0, changes: { question_key: key, scope_type: 'project', scope_id: 'DEMO-001', applies_to_project_ids: ['DEMO-001'], question: { th: label }, short_answer: { th: '{project} มีค่าส่วนกลาง {common_fee}' }, answer_kind: 'fact', fact_keys: ['project.common_fee'] } } });
    expect(created.ok()).toBeTruthy();
    await page.goto('/faq?tab=coverage');
    const coverage = page.getByRole('region', { name: 'ความครบของ FAQ', exact: true });
    await expect(coverage.getByText('รอข้อเท็จจริง', { exact: true }).first()).toBeVisible();
    await coverage.getByRole('button', { name: project.public_name.th, exact: true }).click();
    const preview = page.getByRole('region', { name: 'ตัวอย่าง FAQ ของโครงการ', exact: true });
    await expect(preview.getByRole('heading', { name: 'คำตอบที่ซ่อนจากตัวอย่าง' })).toBeVisible();
    await expect(preview.getByText(/ค่าส่วนกลาง 25/)).toHaveCount(0);
    const task = page.getByRole('region', { name: 'งานข้อเท็จจริงที่ขาด', exact: true }).getByRole('article').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
    await task.getByRole('button', { name: 'รับงานนี้', exact: true }).click();
    await expect(task).toContainText('กำลังดำเนินการ');
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase6/gap-${width}.png`, fullPage: true });
    content = await read(page, `${api}/projects/${publicId}/content`); fact = content.facts.find((f: { fact_key: string }) => f.fact_key === 'project.common_fee');
    expect((await page.request.put(`${api}/projects/${publicId}/facts/project.common_fee`, { headers, data: { expected_revision: fact.revision, changes: { value_number: 0, unit: 'THB/sqm/month', as_of: today } } })).ok()).toBeTruthy();
    await page.getByRole('button', { name: 'ตรวจข้อมูลล่าสุด', exact: true }).click();
    await expect(task).toContainText('แก้ครบแล้ว');
    const card = preview.getByRole('article').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
    await expect(card).toContainText('ค่าส่วนกลาง 0 บาท/ตร.ม./เดือน');
    await expect(card).toContainText('ข้อมูล ณ');
    await page.getByRole('combobox', { name: 'ภาษาของคำตอบ', exact: true }).selectOption('en');
    await expect(card).toContainText('บางข้อความใช้ภาษาไทยแทน');
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase6/preview-${width}.png`, fullPage: true });
    await persona(page, 'viewer'); await page.reload();
    await expect(page.getByRole('button', { name: 'รับงานนี้', exact: true })).toHaveCount(0);
    expect((await page.request.get(`${api}/faq-coverage?unexpected=1`)).status()).toBe(404);
    expect((await page.request.get(`${api}/faq-composition/${publicId}?locale=fr`)).status()).toBe(404);
  });

  test(`FAQ applicability controls retain explicit reviewed phase IDs at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    const key = `synthetic_rule_${width}_${randomUUID().slice(0, 8)}`;
    expect((await page.request.put(`${api}/faq/questions/${key}`, { headers, data: { expected_revision: 0, changes: { topic: 'design', default_level: 'corporate', question_template: { th: 'แนวคิดของ {project}' }, answer_kind: 'text', is_core: false, show_on_project_pages: true } } })).ok()).toBeTruthy();
    await persona(page, 'publisher');
    expect((await page.request.post(`${api}/faq/questions/${key}/approve`, { headers, data: { expected_revision: 1, decision: 'approved' } })).ok()).toBeTruthy();
    await persona(page, 'editor'); await page.goto('/website/corporate/sena?tab=faq&faq=new');
    await page.getByLabel('คำถามมาตรฐานที่อนุมัติแล้ว').selectOption(key);
    await page.locator('#faq-short_answer-th').fill('{project} ให้ความสำคัญกับการอยู่อาศัย');
    await page.getByText('เลือกโครงการด้วยเงื่อนไข', { exact: true }).click();
    await page.getByRole('listbox', { name: 'ประเภทที่อยู่อาศัยในเงื่อนไข', exact: true }).selectOption('condominium');
    await expect(page.getByLabel('เฟส REM ที่คำตอบนี้ใช้', { exact: false })).toBeDisabled();
    await page.getByRole('button', { name: 'ดูรายชื่อเฟสที่ตรงเงื่อนไข', exact: true }).click();
    await expect(page.getByText(/ตรงเงื่อนไข \d+ เฟส · ยังไม่ตรึงเพื่อเผยแพร่/)).toBeVisible();
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase6/rule-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'บันทึกคำตอบ', exact: true }).click();
    await expect(page.getByText('บันทึกฉบับร่างแล้ว ตรวจภาษาอังกฤษก่อนส่งตรวจ', { exact: true })).toBeVisible();
    const id = new URL(page.url()).searchParams.get('faq');
    const saved = await read(page, `${api}/faq/${id}`);
    expect(saved.version.applicability_rule).toEqual({ product_forms: ['condominium'] });
    await page.getByRole('button', { name: 'แก้ไขเป็นฉบับใหม่', exact: true }).click();
    await expect(page.getByRole('listbox', { name: 'ประเภทที่อยู่อาศัยในเงื่อนไข', exact: true })).toHaveValues(['condominium']);
    await page.getByRole('button', { name: 'ล้างเงื่อนไข', exact: true }).click();
    await expect(page.getByLabel('เฟส REM ที่คำตอบนี้ใช้', { exact: false })).toBeEnabled();
  });
}
