import { workspaceHref, workspaceText } from './unified-workspace-helpers';
import { expect, test, type Page } from '@playwright/test';
import { submitItem, approveItem, workflowText } from './content-workflow-fixtures';

const headers = { Origin: 'http://127.0.0.1:3000' }, api = '/api/hub/v1/admin';
async function persona(page: Page, role: string) { expect((await page.request.post('/api/local-session', { headers, data: { role } })).ok()).toBeTruthy(); }
async function read(page: Page, path: string) { const response = await page.request.get(path); expect(response.ok(), path).toBeTruthy(); return (await response.json()).data; }
async function fits(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy(); }

async function returnSubmitted(page: Page, kind: 'section' | 'faq', id: string) {
  await persona(page, 'publisher');
  const target = { kind, identity: { id } };
  const snapshot = await read(page, `${api}/content-workflow?` + new URLSearchParams({ kind, identity: JSON.stringify(target.identity) }));
  expect(snapshot.state).toBe('IN_REVIEW');
  const response = await page.request.post(`${api}/content-workflow/review`, { headers, data: { ...target, expected_hash: snapshot.expected_hash, decision: 'return', reason: 'Return synthetic submitted text for a new draft' } });
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).data.state).toBe('RETURNED');
  await persona(page, 'editor');
}

for (const width of [1280, 390]) {
  test(`Project core drafts, reviewed English and version conflicts at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    const project = (await read(page, `${api}/projects`)).find((row: { source: { rem_project_id: string } }) => row.source.rem_project_id === 'DEMO-001');
    const base = `${api}/projects/${project.public_project_id}`;
    await page.goto(workspaceHref({ level: 'project', id: project.public_project_id, phase: project.source.rem_project_id, tab: 'data', section: 'facts' }));
    await expect(page.getByRole('heading', { name: 'ข้อเท็จจริงของโครงการ / เฟสนี้' })).toBeVisible();
    await page.getByRole('button', { name: 'แก้ไข จำนวนยูนิตทั้งหมด', exact: true }).click();
    await page.getByLabel('ยืนยันแหล่งจำนวนยูนิต').selectOption('marketing');
    await page.locator('#fact-unit_total').fill('100');
    await page.getByLabel('วันที่ข้อมูล', { exact: true }).fill('2026-10-21');
    await page.getByLabel('เหตุผลที่ใช้ค่าต่างจาก REM').fill('ข้อมูลสมมติสำหรับทดสอบหน้าจอ');
    await expect(page.getByRole('button', { name: 'อาคาร', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'บันทึกข้อเท็จจริง' }).click();
    await expect(page.getByText('บันทึกข้อเท็จจริงแล้ว', { exact: true })).toBeVisible();
    const current = await read(page, `${base}/content`);
    const units = current.facts.find((row: { fact_key: string }) => row.fact_key === 'project.unit_total');
    expect(units.value_number).toBe(100);
    expect((await page.request.put(`${base}/facts/project.unit_total`, { headers, data: { expected_revision: units.revision - 1, changes: { value_number: 99, as_of: '2026-10-21', unit_count_choice: 'marketing' } } })).status()).toBe(409);
    await page.getByLabel('การใช้งาน จำนวนยูนิตทั้งหมด').first().click();
    await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'จำนวนยูนิตทั้งหมด', exact: true }) }).getByText(/ผู้รับผิดชอบ: การตลาด/)).toBeVisible();
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase2/facts-${width}.png`, fullPage: true });

    await page.getByRole('button', { name: 'อาคาร', exact: true }).click();
    await page.getByRole('button', { name: 'เพิ่มอาคาร', exact: true }).click();
    await page.locator('#building-name-th').fill(`อาคารทดสอบ ${width}`);
    await page.locator('#building-name-en').fill(`Test building ${width}`);
    await page.getByLabel('จำนวนชั้น', { exact: true }).fill('20');
    await page.getByLabel('จำนวนยูนิต', { exact: true }).fill('100');
    await page.getByRole('button', { name: 'บันทึกอาคาร', exact: true }).click();
    await expect(page.getByText('บันทึกข้อมูลอาคารแล้ว', { exact: true })).toBeVisible();
    const buildingCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: `อาคารทดสอบ ${width}`, exact: true }) });
    await expect(buildingCard).toContainText('ยังไม่ทราบ');
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase2/buildings-${width}.png`, fullPage: true });

    await page.getByRole('button', { name: 'เนื้อหาและจุดขาย', exact: true }).click();
    await page.getByRole('button', { name: /^(เพิ่ม|แก้ไข) แนะนำโครงการ$/ }).click();
    await page.locator('#section-body-th').fill(`โครงการสมมติ ${width} เพื่อการอยู่อาศัย`);
    await page.locator('#section-body-en').fill(`Synthetic project ${width} for living`);
    await page.getByRole('button', { name: 'บันทึกเนื้อหา', exact: true }).click();
    await expect(page.getByText('บันทึกฉบับแล้ว ยังไม่มีการเผยแพร่ขึ้นเว็บไซต์', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'เพิ่มจุดขาย', exact: true }).click();
    await page.locator('#point-title-th').fill(`จุดขายสมมติ ${width}`);
    await page.locator('#point-detail-th').fill('พื้นที่สีเขียวสำหรับการพักผ่อน');
    await page.getByRole('button', { name: 'บันทึกจุดขาย', exact: true }).click();
    await expect(page.getByRole('heading', { name: `จุดขายสมมติ ${width}`, exact: true })).toBeVisible();
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase2/narrative-${width}.png`, fullPage: true });

    await page.getByRole('button', { name: 'ภาษาอังกฤษ', exact: true }).click();
    const translation = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'แนะนำโครงการ', exact: true }) });
    await translation.getByRole('button', { name: 'ตรวจคำแปล', exact: true }).click();
    await translation.getByLabel('คำแปลภาษาอังกฤษที่ยืนยัน').fill(`Synthetic project ${width} for living`);
    await translation.getByRole('button', { name: 'ยืนยันตรวจภาษาอังกฤษ' }).click();
    await expect(translation.getByText('ตรวจภาษาอังกฤษแล้ว', { exact: true })).toBeVisible();
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase2/english-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'เนื้อหาและจุดขาย', exact: true }).click();
    await submitItem(page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'แนะนำโครงการ', exact: true }) }), 'section');
    await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'แนะนำโครงการ', exact: true }) })).toContainText(workspaceText.IN_REVIEW);

    await page.getByRole('button', { name: 'ช่องทางติดต่อ', exact: true }).click();
    await page.getByRole('button', { name: 'เพิ่มช่องทางติดต่อ', exact: true }).click();
    await page.locator('#contact-value').fill('02-000-0000');
    await page.locator('#contact-label-th').fill(`ติดต่อทดสอบ ${width}`);
    await page.getByRole('button', { name: 'บันทึกช่องทางติดต่อ', exact: true }).click();
    await expect(page.getByText('บันทึกช่องทางติดต่อแล้ว', { exact: true })).toBeVisible();
    const contact = page.getByRole('article').filter({ has: page.getByRole('heading', { name: `ติดต่อทดสอบ ${width}`, exact: true }) });
    await contact.getByRole('button', { name: 'แก้ไข โทรศัพท์', exact: true }).click();
    await page.locator('#contact-value').fill('02-111-1111');
    await page.getByRole('button', { name: 'บันทึกช่องทางติดต่อ', exact: true }).click();
    await expect(contact).toContainText('02-111-1111');
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase2/contacts-${width}.png`, fullPage: true });
    await persona(page, 'viewer'); await page.reload();
    await expect(page.getByText('สิทธิ์ดูข้อมูลเท่านั้น', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'เพิ่มช่องทางติดต่อ', exact: true })).toHaveCount(0);
    expect((await page.request.post(`${base}/contacts`, { headers, data: { expected_revision: 0, changes: { channel: 'phone', value: '02-222-2222' } } })).status()).toBe(403);
    await persona(page, 'editor');
    const submitted = (await read(page, `${base}/content`)).sections.find((item: { section_key: string }) => item.section_key === 'section.project_intro');
    expect(submitted).toBeTruthy();
    await returnSubmitted(page, 'section', submitted.id);
  });

  test(`FAQ question approval, corporate editor, preview and submitted history at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    const key = `synthetic_ui_${width}`, question = `แนวคิดของ SENA ทดสอบ ${width} คืออะไร`, english = `What is the SENA concept ${width}?`;
    await page.goto('/faq?tab=bank');
    await page.getByRole('button', { name: 'เสนอคำถามใหม่', exact: true }).click();
    await page.getByLabel('รหัสคำถาม', { exact: true }).fill(key);
    await page.getByLabel('ระดับคำตอบเริ่มต้น').selectOption('corporate');
    await page.locator('#bank-question-th').fill(question); await page.locator('#bank-question-en').fill(english);
    await page.getByRole('button', { name: 'บันทึกข้อเสนอคำถาม', exact: true }).click();
    await expect(page.getByRole('heading', { name: question, exact: true })).toBeVisible();
    expect((await page.request.post(`${api}/faq/questions/${key}/approve`, { headers, data: { expected_revision: 1, decision: 'approved' } })).status()).toBe(403);
    await submitItem(page.getByRole('article').filter({ has: page.getByRole('heading', { name: question, exact: true }) }), 'question');
    await persona(page, 'publisher'); await page.reload();
    await approveItem(page, page.getByRole('article').filter({ has: page.getByRole('heading', { name: question, exact: true }) }), 'question');
    await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: question, exact: true }) })).toContainText('อนุมัติแล้ว');
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase2/question-bank-${width}.png`, fullPage: true });
    await persona(page, 'editor'); await page.goto(workspaceHref({ level: 'corporate', id: 'sena', tab: 'faq', question_key: key }));
    await page.locator(`[data-workspace-question="${key}"]`).getByRole('button', { name: workspaceText.newFaq, exact: true }).click();
    await expect(page.getByLabel('คำถามมาตรฐานที่อนุมัติแล้ว')).toHaveValue(key);
    await page.locator('#faq-short_answer-th').fill('SENA ให้ความสำคัญกับการอยู่อาศัยที่สะดวกสบาย');
    await page.locator('#faq-short_answer-en').fill('SENA focuses on comfortable living.');
    await page.locator('#faq-detail-th').fill('เนื้อหาสมมติสำหรับตรวจหน้าจอเท่านั้น');
    await page.getByLabel('แหล่งอ้างอิงใหม่', { exact: true }).fill('หลักฐานการตลาดสมมติ');
    await page.getByLabel('ลิงก์แหล่งอ้างอิง', { exact: true }).fill('https://example.com/marketing');
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase2/faq-editor-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'บันทึกคำตอบ', exact: true }).click();
    await expect(page.getByRole('button', { name: 'แก้ไขเป็นฉบับใหม่', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ตัวอย่างบนเว็บไซต์', exact: true }).click();
    await expect(page.getByRole('region', { name: 'ตัวอย่าง FAQ บนเว็บไซต์' })).toContainText('SENA ให้ความสำคัญ');
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase2/faq-preview-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'แหล่งข้อมูล', exact: true }).click();
    await expect(page.getByText('หลักฐานการตลาดสมมติ', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ภาษาอังกฤษ', exact: true }).click();
    for (const [label, value] of [['คำถาม', english], ['คำตอบสั้น', 'SENA focuses on comfortable living.']]) {
      const item = page.getByRole('article').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
      await item.getByRole('button', { name: 'ตรวจคำแปล', exact: true }).click();
      await item.getByLabel('คำแปลภาษาอังกฤษที่ยืนยัน').fill(value);
      await item.getByRole('button', { name: 'ยืนยันตรวจภาษาอังกฤษ', exact: true }).click();
      await expect(item.getByText('ตรวจภาษาอังกฤษแล้ว', { exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'คำตอบและขอบเขต', exact: true }).click();
    await submitItem(page, 'faq');
    await expect(page.getByRole('button', { name: 'แก้ไขเป็นฉบับใหม่', exact: true })).toBeDisabled();
    const faqId = new URL(page.url()).searchParams.get('faq');
    expect(faqId).toBeTruthy();
    const submittedFaq = await read(page, `${api}/faq/${faqId}`);
    expect((await page.request.put(`${api}/faq/${faqId}`, { headers, data: { expected_revision: submittedFaq.revision, changes: { detail: { th: 'Denied mutation of submitted text' } } } })).status()).toBe(422);
    await returnSubmitted(page, 'faq', faqId!);
    await page.reload();
    await page.getByRole('button', { name: 'แก้ไขเป็นฉบับใหม่', exact: true }).click();
    await page.locator('#faq-detail-th').fill('รายละเอียดฉบับใหม่ยังไม่เผยแพร่');
    await page.getByRole('button', { name: 'บันทึกคำตอบ', exact: true }).click();
    await expect(page.getByRole('button', { name: 'แก้ไขเป็นฉบับใหม่', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ประวัติ', exact: true }).click();
    await expect(page.getByText(new RegExp(`ฉบับ 1 · ${workspaceText.RETURNED}`))).toBeVisible();
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase2/faq-history-${width}.png`, fullPage: true });
    await persona(page, 'viewer'); await page.reload();
    await expect(page.getByRole('button', { name: 'แก้ไขเป็นฉบับใหม่', exact: true })).toHaveCount(0);
    await page.goto('/content/fields');
    await expect(page.getByRole('heading', { name: 'ทะเบียนฟิลด์', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /แก้ไขข้อกำหนด/ })).toHaveCount(0);
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase2/registry-${width}.png`, fullPage: true });

    await persona(page, 'editor'); await page.goto('/faq?tab=glossary');
    await page.getByRole('button', { name: 'เสนอคำแปลมาตรฐาน', exact: true }).click();
    await page.getByLabel('รหัสคำ', { exact: true }).fill(`20_ui_${width}`);
    await page.locator('#glossary-term-th').fill(`ชื่อสมมติ ${width}`);
    await page.locator('#glossary-term-en').fill(`Synthetic name ${width}`);
    await page.getByRole('button', { name: 'บันทึกคำมาตรฐาน', exact: true }).click();
    await expect(page.getByRole('heading', { name: `ชื่อสมมติ ${width}`, exact: true })).toBeVisible();
    await submitItem(page.getByRole('article').filter({ has: page.getByRole('heading', { name: `ชื่อสมมติ ${width}`, exact: true }) }), 'glossary');
    await persona(page, 'publisher'); await page.reload();
    await approveItem(page, page.getByRole('article').filter({ has: page.getByRole('heading', { name: `ชื่อสมมติ ${width}`, exact: true }) }), 'glossary');
    await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: `ชื่อสมมติ ${width}`, exact: true }) })).toContainText('อนุมัติใช้แล้ว');
    await fits(page); await page.screenshot({ path: `artifacts/project-content-phase2/glossary-${width}.png`, fullPage: true });
  });
}
