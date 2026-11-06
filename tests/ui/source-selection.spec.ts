import { openWorkspaceTab, entityRef } from './unified-workspace-helpers';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const origin = 'http://127.0.0.1:3000';
const actor = '00000000-0000-0000-0000-000000000001';
const headers = { Origin: origin };

type Model = {
  id: string; public_model_id: string; rem_model_id: string;
  public_name: Record<string, string>; model_name_rem: string;
  bedrooms: number | null; match_status: string;
  verified_by: string | null; verified_at: string | null;
};
type Project = {
  id: string; public_project_id: string; updated_at: string;
  public_name: Record<string, string>; models: Model[];
  readiness: { ready: boolean; missing: { field: string; message: string }[] };
};

async function fixture() {
  const local = JSON.parse(await readFile('.local/development.json', 'utf8'));
  const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: local.adminPassword });
  await db.connect();
  const sourceId = `E2E-INTAKE-${randomUUID()}`;
  const otherId = `${sourceId}-OTHER`;
  const name = `โครงการทดสอบการรับข้อมูล ${sourceId.slice(-8)}`;
  await db.query("select set_config('app.actor_id',$1,false),set_config('app.change_reason',$2,false)", [actor, sourceId]);
  async function addSourceModel(modelId: string, modelName: string, project = sourceId) {
    await db.query('insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint) values($1,$2,$3,now(),$4)', [project, modelId, modelName, `${sourceId}-${modelId}`]);
  }
  async function cleanup() {
    // Only these uniquely generated fixtures are removed. Published/demo records
    // and audit evidence are retained; these tests never publish a fixture.
    try {
      await db.query('begin');
      await db.query('delete from hub.model_types where rem_project_id=any($1::text[])', [[sourceId, otherId]]);
      await db.query('delete from hub.projects where rem_project_id=any($1::text[])', [[sourceId, otherId]]);
      await db.query('delete from staging.rem_models where rem_project_id=any($1::text[])', [[sourceId, otherId]]);
      await db.query('delete from staging.rem_projects where rem_project_id=any($1::text[])', [[sourceId, otherId]]);
      await db.query('commit');
    } catch (error) { await db.query('rollback'); throw error; }
    finally { await db.end(); }
  }
  try {
    await db.query('insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint) values($1,$2,now(),$1),($3,$4,now(),$3)', [sourceId, name, otherId, `${name} อีกโครงการ`]);
    await addSourceModel('MODEL-A', 'แบบต้นทาง เอ');
    await addSourceModel('MODEL-B', 'แบบต้นทาง บี');
    await addSourceModel('MODEL-OTHER', 'แบบของอีกโครงการ', otherId);
  } catch (error) { await cleanup(); throw error; }
  return { db, sourceId, otherId, name, addSourceModel, cleanup };
}

async function enter(page: Page, role: 'editor' | 'viewer') {
  await page.goto('/website?view=projects');
  const changed = page.waitForResponse(response => response.url().endsWith('/api/local-session') && response.request().method() === 'POST');
  await page.getByLabel('เลือกบัญชีทดสอบ').selectOption(role);
  expect((await changed).ok()).toBeTruthy();
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toBeEnabled();
  await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveValue(role);
  await expect(page.getByRole('button', { name: 'เลือกโครงการจากต้นทาง', exact: true })).toBeVisible();
}

async function detail(page: Page, publicId: string): Promise<Project> {
  const response = await page.request.get(`/api/hub/v1/admin/projects/${publicId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}

async function createFromChooser(page: Page, data: Awaited<ReturnType<typeof fixture>>) {
  await page.getByRole('button', { name: 'เลือกโครงการจากต้นทาง', exact: true }).click();
  await page.getByLabel('ค้นหาชื่อหรือรหัสโครงการต้นทาง').fill(data.sourceId);
  const source = page.locator('#source-picker li').filter({ has: page.getByRole('heading', { name: data.name, exact: true }) });
  await expect(source).toBeVisible();
  await expect(page.getByText('ตรวจแหล่งข้อมูลของแต่ละรายการ · ยังไม่ได้เชื่อม DW สด', { exact: true })).toBeVisible();
  await source.getByRole('button', { name: 'เลือกโครงการนี้', exact: true }).click();
  const commercialName = page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)', { exact: true });
  await expect(commercialName).toHaveValue(''); // No Gold snapshot: never silently use the REM name.
  await commercialName.fill(data.name);
  await page.getByRole('button', { name: 'บันทึกข้อมูลร่าง', exact: true }).click();
  await expect(page.getByText('บันทึกข้อมูลร่างแล้ว ข้อมูลที่เผยแพร่ยังคงเป็นเวอร์ชันเดิม', { exact: true })).toBeVisible();
  const publicId = entityRef(page, 'project');
  expect(publicId).toBeTruthy();
  return detail(page, publicId!);
}

function modelCard(page: Page, name: string) {
  return page.getByRole('article', { name, exact: true });
}

async function selectModel(page: Page, publicModelId: string) {
  await openWorkspaceTab(page, 'unit-types');
  await page.locator(`.rem-model-table tr[data-model-id="${publicModelId}"] button`).click();
  const inline = page.getByRole('region', { name: 'แก้ไขรายละเอียดแบบ', exact: true });
  if (await inline.count()) await inline.getByRole('button', { name: 'ยกเลิก', exact: true }).click();

}

test('staged project intake, model enrichment and explicit mapping decisions', async ({ page }) => {
  test.setTimeout(90_000);
  const data = await fixture();
  try {
    await enter(page, 'editor');
    await page.getByRole('button', { name: 'เลือกโครงการจากต้นทาง', exact: true }).click();
    await page.getByLabel('ค้นหาชื่อหรือรหัสโครงการต้นทาง').fill(data.sourceId);
    await expect(page.getByRole('heading', { name: data.name, exact: true })).toBeVisible();
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/source-chooser.png', fullPage: true });
    await page.getByRole('button', { name: 'ปิดรายการต้นทาง', exact: true }).click();
    let project = await createFromChooser(page, data);
    const first = project.models.find(model => model.rem_model_id === 'MODEL-A')!;
    const second = project.models.find(model => model.rem_model_id === 'MODEL-B')!;
    expect(project.models).toHaveLength(2);
    expect(project.models.every(model => model.match_status === 'SUGGESTED' && !model.verified_by)).toBeTruthy();
    for (const model of project.models) {
      await selectModel(page, model.public_model_id);
      await expect(modelCard(page, model.public_name.th).getByText('รอตรวจสอบ', { exact: true })).toBeVisible();
    }
    await selectModel(page, first.public_model_id);
    await expect(modelCard(page, 'แบบต้นทาง เอ').locator('.model-source')).toContainText('MODEL-A');
    await expect(modelCard(page, 'แบบต้นทาง เอ').getByRole('textbox')).toHaveCount(0);

    // Supply an English translation first; the Thai-only editor must preserve it.
    const translated = await page.request.patch(`/api/hub/v1/admin/projects/${project.public_project_id}/models/${first.public_model_id}`, {
      headers, data: { updated_at: project.updated_at, public_name: { ...first.public_name, en: 'Original English model name' } },
    });
    expect(translated.ok()).toBeTruthy();
    await page.reload();
    await selectModel(page, first.public_model_id);
    await modelCard(page, 'แบบต้นทาง เอ').getByRole('button', { name: 'แก้ไขรายละเอียดแบบ', exact: true }).click();
    let dialog = page.locator('.inline-model-editor, dialog[open]');
    await expect(dialog.locator('.snapshot-list').getByText('แบบต้นทาง เอ', { exact: true })).toBeVisible();
    await dialog.getByLabel('ชื่อแบบที่ใช้เผยแพร่ (ภาษาไทย)', { exact: true }).fill('บ้านตัวอย่างสำหรับทดสอบ');
    await dialog.getByLabel('จำนวนห้องนอน', { exact: true }).fill('2.5');
    await dialog.getByLabel('จำนวนห้องน้ำ', { exact: true }).fill('2');
    await dialog.getByLabel('พื้นที่ใช้สอย (ตร.ม.)', { exact: true }).fill('125.5');
    await dialog.getByLabel('จำนวนที่จอดรถ', { exact: true }).fill('1');
    await dialog.getByRole('button', { name: 'บันทึกรายละเอียดแบบ', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    project = await detail(page, project.public_project_id);
    let current = project.models.find(model => model.public_model_id === first.public_model_id)!;
    expect(current.public_name).toEqual({ th: 'บ้านตัวอย่างสำหรับทดสอบ', en: 'Original English model name' });
    expect(current.bedrooms).toBe(2.5);
    expect(current.model_name_rem).toBe('แบบต้นทาง เอ');
    expect(current.match_status).toBe('SUGGESTED');

    await modelCard(page, current.public_name.th).getByRole('button', { name: 'ตรวจสอบการจับคู่', exact: true }).click();
    dialog = page.locator('.inline-model-editor, dialog[open]');
    await dialog.getByLabel('เหตุผลในการตรวจสอบ').fill('ตรวจรหัสและชื่อแบบจากข้อมูลจำลองแล้ว');
    await page.screenshot({ path: 'artifacts/model-review-dialog.png' });
    await dialog.getByRole('button', { name: 'บันทึกผลตรวจสอบ', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    project = await detail(page, project.public_project_id);
    current = project.models.find(model => model.public_model_id === first.public_model_id)!;
    expect(current.match_status).toBe('CONFIRMED');
    expect(current.verified_by).toBe(actor);
    expect(current.verified_at).toBeTruthy();
    expect(project.readiness.missing.some(item => item.field === `models.${first.id}.match_status`)).toBeFalsy();
    await expect(modelCard(page, current.public_name.th).locator('.review-evidence')).toContainText('สมชาย แก้ไข');

    await selectModel(page, second.public_model_id);
    await modelCard(page, 'แบบต้นทาง บี').getByRole('button', { name: 'ตรวจสอบการจับคู่', exact: true }).click();
    dialog = page.locator('.inline-model-editor, dialog[open]');
    await dialog.getByRole('radio', { name: 'ปฏิเสธการจับคู่', exact: true }).check();
    await expect(dialog.getByRole('status')).toContainText('ไม่รวมในการเผยแพร่ครั้งใหม่');
    await dialog.getByLabel('เหตุผลในการตรวจสอบ').fill('ไม่ใช้แบบนี้ในการเผยแพร่ชุดทดสอบ');
    await dialog.getByRole('button', { name: 'บันทึกผลตรวจสอบ', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(modelCard(page, 'แบบต้นทาง บี').getByText('ปฏิเสธการจับคู่', { exact: true })).toBeVisible();
    project = await detail(page, project.public_project_id);
    expect(project.models.find(model => model.id === second.id)?.match_status).toBe('REJECTED');
    expect(project.readiness.missing.some(item => item.field.startsWith(`models.${second.id}.`))).toBeFalsy();

    await data.addSourceModel('MODEL-C', 'แบบเพิ่มเติมภายหลัง');
    await page.getByRole('button', { name: 'เลือกแบบเพิ่มเติมจากต้นทาง', exact: true }).click();
    dialog = page.locator('.inline-model-editor, dialog[open]');
    await dialog.getByLabel('แบบที่ยังไม่ได้เลือกในโครงการนี้').selectOption('MODEL-C');
    await dialog.getByRole('button', { name: 'เพิ่มแบบที่เลือก', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    project = await detail(page, project.public_project_id);
    await selectModel(page, project.models.find(model => model.rem_model_id === 'MODEL-C')!.public_model_id);
    await expect(modelCard(page, 'แบบเพิ่มเติมภายหลัง').getByText('รอตรวจสอบ', { exact: true })).toBeVisible();

    await page.goto('/website?view=projects');
    await page.getByRole('button', { name: 'เลือกโครงการจากต้นทาง', exact: true }).click();
    await page.getByLabel('ค้นหาชื่อหรือรหัสโครงการต้นทาง').fill(data.sourceId);
    const source = page.locator('#source-picker li').filter({ has: page.getByRole('heading', { name: data.name, exact: true }) });
    await expect(source.getByRole('button', { name: 'เลือกโครงการนี้', exact: true })).toHaveCount(0);
    await source.getByRole('link', { name: 'เปิดโครงการที่มีอยู่', exact: true }).click();
    await expect(page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)', { exact: true })).toHaveValue(data.name);
    expect(entityRef(page, 'project')).toBe(project.public_project_id);
    expect((await data.db.query('select count(*)::int as count from hub.projects where rem_project_id=$1', [data.sourceId])).rows[0].count).toBe(1);
    expect((await detail(page, project.public_project_id)).models).toHaveLength(3);
  } finally { await data.cleanup(); }
});

test('model changes preserve unsaved project edits and retain stale-dialog input', async ({ page }) => {
  const data = await fixture();
  try {
    await enter(page, 'editor');
    const project = await createFromChooser(page, data);
    await page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)', { exact: true }).fill('ชื่อโครงการที่ยังไม่ได้บันทึก');
    await selectModel(page, project.models.find(model => model.rem_model_id === 'MODEL-A')!.public_model_id);
    await expect(page.getByRole('button', { name: 'เลือกแบบเพิ่มเติมจากต้นทาง', exact: true })).toBeDisabled();
    for (const button of await page.getByRole('button', { name: 'แก้ไขรายละเอียดแบบ', exact: true }).all()) await expect(button).toBeDisabled();
    for (const button of await page.getByRole('button', { name: 'ตรวจสอบการจับคู่', exact: true }).all()) await expect(button).toBeDisabled();
    await openWorkspaceTab(page, 'data');
    await page.getByLabel('ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)', { exact: true }).fill(data.name);
    await selectModel(page, project.models.find(model => model.rem_model_id === 'MODEL-A')!.public_model_id);
    await modelCard(page, 'แบบต้นทาง เอ').getByRole('button', { name: 'แก้ไขรายละเอียดแบบ', exact: true }).click();
    const dialog = page.locator('.inline-model-editor, dialog[open]');
    await dialog.getByLabel('ชื่อแบบที่ใช้เผยแพร่ (ภาษาไทย)', { exact: true }).fill('ข้อความที่ต้องเก็บเมื่อเกิดข้อขัดแย้ง');
    const changed = await page.request.patch(`/api/hub/v1/admin/projects/${project.public_project_id}`, {
      headers, data: { updated_at: project.updated_at, meta_title: { th: 'ข้อมูลจากอีกหน้าต่าง' } },
    });
    expect(changed.ok()).toBeTruthy();
    const conflict = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/models/'));
    await dialog.getByRole('button', { name: 'บันทึกรายละเอียดแบบ', exact: true }).click();
    expect((await conflict).status()).toBe(409);
    await expect(dialog.getByRole('alert')).toContainText('ข้อมูลเปลี่ยนไปแล้ว');
    await expect(dialog.getByLabel('ชื่อแบบที่ใช้เผยแพร่ (ภาษาไทย)', { exact: true })).toHaveValue('ข้อความที่ต้องเก็บเมื่อเกิดข้อขัดแย้ง');
    await expect(dialog.getByRole('alert')).toBeFocused();
    page.once('dialog', confirmation => confirmation.accept());
    await dialog.locator('.model-error-summary').getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await openWorkspaceTab(page, 'supplementary');
    await expect(page.getByLabel('ชื่อเรื่องสำหรับผู้ใช้งานข้อมูล', { exact: true })).toHaveValue('ข้อมูลจากอีกหน้าต่าง');
    await selectModel(page, project.models.find(model => model.rem_model_id === 'MODEL-A')!.public_model_id);
    await expect(modelCard(page, 'แบบต้นทาง เอ')).toBeVisible();
  } finally { await data.cleanup(); }
});

test('viewer cannot create or review mappings and model routes enforce project ownership', async ({ page }) => {
  const data = await fixture();
  try {
    await enter(page, 'editor');
    const create = async (sourceId: string): Promise<Project> => {
      const response = await page.request.post('/api/hub/v1/admin/projects', { headers, data: { rem_project_id: sourceId } });
      expect(response.ok()).toBeTruthy();
      return (await response.json()).data;
    };
    const project = await create(data.sourceId);
    const other = await create(data.otherId);
    const foreignModel = other.models[0].public_model_id;
    const base = `/api/hub/v1/admin/projects/${project.public_project_id}`;
    const crossProject = await page.request.patch(`${base}/models/${foreignModel}`, { headers, data: { updated_at: project.updated_at, bedrooms: 9 } });
    expect(crossProject.status()).toBe(404);
    const crossReview = await page.request.post(`${base}/models/${foreignModel}/review`, { headers, data: { updated_at: project.updated_at, decision: 'CONFIRMED', change_reason: 'must not cross project boundary' } });
    expect(crossReview.status()).toBe(404);
    await enter(page, 'viewer');
    await page.getByRole('button', { name: 'เลือกโครงการจากต้นทาง', exact: true }).click();
    await expect(page.locator('#source-picker').getByRole('button', { name: 'เลือกโครงการนี้', exact: true })).toHaveCount(0);
    await page.goto(`/?project=${project.public_project_id}`);
    for (const model of project.models) {
      await selectModel(page, model.public_model_id);
      await expect(modelCard(page, model.public_name.th)).toBeVisible();
      await expect(modelCard(page, model.public_name.th).getByRole('button', { name: 'รูปภาพและแปลนของแบบนี้', exact: true })).toBeVisible();
      await expect(modelCard(page, model.public_name.th).getByRole('button', { name: /แก้ไขรายละเอียดแบบ|ตรวจสอบการจับคู่/ })).toHaveCount(0);
    }
    await expect(page.locator('.rem-model-table tbody tr')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'เลือกแบบเพิ่มเติมจากต้นทาง', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'แก้ไขรายละเอียดแบบ', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'ตรวจสอบการจับคู่', exact: true })).toHaveCount(0);
    const deniedCreate = await page.request.post('/api/hub/v1/admin/projects', { headers, data: { rem_project_id: data.sourceId } });
    expect(deniedCreate.status()).toBe(403);
    const deniedReview = await page.request.post(`${base}/models/${project.models[0].public_model_id}/review`, { headers, data: { updated_at: project.updated_at, decision: 'CONFIRMED', change_reason: 'must fail for viewer' } });
    expect(deniedReview.status()).toBe(403);
    expect((await detail(page, project.public_project_id)).models.every(model => model.match_status === 'SUGGESTED')).toBeTruthy();
  } finally { await data.cleanup(); }
});
