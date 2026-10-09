import { expect, test } from '@playwright/test';

for (const [refreshStatus, sourceReload] of [[200, false], [401, false], [403, false], [403, true]] as const) {
test(`assistant ${sourceReload ? 'source reload' : 'focus refresh'} ${refreshStatus} removes revoked evidence but keeps unsent questions and authored drafts`, async ({ page }) => {
  const origin = 'http://127.0.0.1:3000';
  const base = '/api/hub/v1/admin/assistant';
  const run = '65000000-0000-4000-8000-000000000051';
  let revoked = false;
  let checks = 0;
  expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role: 'editor' } })).ok()).toBeTruthy();
  await page.route('**/api/hub/v1/admin/projects/PROJECT-CACHE', route => revoked && sourceReload ? route.fulfill({ status: 403, json: { error: { message: 'ไม่มีสิทธิ์ใช้ผู้ช่วยแล้ว' } } }) : route.fulfill({ json: { data: {
    id: '65000000-0000-4000-8000-000000000052', public_project_id: 'PROJECT-CACHE', updated_at: '2026-10-09T00:00:00Z',
    meta_title: { th: 'ข้อความต้นทางที่เคยมีสิทธิ์ดู' }, demo_fields: ['meta_title.th'],
  } } }));
  await page.route('**/api/hub/v1/admin/assistant/**', route => {
    const path = new URL(route.request().url()).pathname.slice(base.length);
    if (path === '/config') {
      checks++;
      if (revoked && refreshStatus !== 200) return route.fulfill({ status: refreshStatus, json: { error: { message: 'ไม่มีสิทธิ์ใช้ผู้ช่วยแล้ว' } } });
      return route.fulfill({ json: { data: {
        session_key: revoked ? 'synthetic-capabilities-after' : 'synthetic-capabilities-before',
        mode: 'fake', live_available: false, allowed_tools: revoked ? [] : ['get_project'],
        proposal_fields: revoked ? {} : { project: ['meta_title.th'] }, live_questions: [], message_th: 'ข้อมูลสมมติ',
      } } });
    }
    if (path === '/runs') {
      const frame = (event: string, data: object) => `event: ${event}\ndata: ${JSON.stringify({ run_id: run, ...data })}\n\n`;
      return route.fulfill({ contentType: 'text/event-stream', body:
        frame('status', { state: 'running', message_th: 'กำลังตรวจข้อมูล' }) +
        frame('answer_delta', { block_id: 'synthetic', text: 'คำตอบเดิมจากข้อมูลโครงการสมมติ', metadata: { synthetic: true }, citation_ids: [] }) +
        frame('done', { status: 'DONE', provider: 'fake', usage: {} }),
      });
    }
    return route.fulfill({ status: 404, json: { error: { message: 'ไม่พบรายการ' } } });
  });
  await page.goto('/questions?project=PROJECT-CACHE&assistant=open');
  const panel = page.getByRole('dialog', { name: 'ผู้ช่วย Hub', exact: true });
  const composer = panel.getByLabel('คำถามสำหรับโหมดจำลองในเครื่อง');
  await composer.fill('ถามจากข้อมูลสมมติ');
  await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click();
  await expect(panel.locator('.assistant-answer')).toHaveText('คำตอบเดิมจากข้อมูลโครงการสมมติ');
  await composer.fill('คำถามที่ยังไม่ได้ส่ง');
  await panel.getByRole('tab', { name: 'เสนอแก้ร่าง', exact: true }).click();
  await panel.getByRole('button', { name: 'โหลดข้อความฉบับร่างที่มีสิทธิ์แก้', exact: true }).click();
  await panel.getByLabel('ข้อความที่เสนอ', { exact: true }).fill('ข้อความที่ฉันพิมพ์เองและยังไม่บันทึก');
  await panel.getByLabel('เหตุผลที่เสนอ', { exact: true }).fill('เหตุผลที่ฉันพิมพ์เอง');
  revoked = true;
  const before = checks;
  if (sourceReload) await panel.getByRole('button', { name: 'โหลดฉบับร่างล่าสุดเพื่อทบทวนใหม่', exact: true }).click();
  else {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => checks).toBeGreaterThan(before);
  }
  await expect(panel.locator('.assistant-answer')).toHaveCount(0);
  await expect(panel).not.toContainText('ข้อความต้นทางที่เคยมีสิทธิ์ดู');
  await panel.getByText('ข้อความร่างที่คุณพิมพ์ไว้และยังไม่ได้บันทึก', { exact: true }).click();
  await expect(panel.getByRole('textbox', { name: 'ข้อความที่พิมพ์ไว้', exact: true })).toHaveValue('ข้อความที่ฉันพิมพ์เองและยังไม่บันทึก');
  await expect(panel.getByRole('textbox', { name: 'เหตุผลที่พิมพ์ไว้', exact: true })).toHaveValue('เหตุผลที่ฉันพิมพ์เอง');
  await panel.getByRole('tab', { name: 'แชท', exact: true }).click();
  await expect(composer).toHaveValue('คำถามที่ยังไม่ได้ส่ง');
  if (refreshStatus === 200) await expect(panel.getByRole('status')).toContainText('สิทธิ์เปลี่ยนแล้ว');
  else await expect(panel.getByRole('alert')).toContainText('ไม่มีสิทธิ์ใช้ผู้ช่วยแล้ว');
  expect(await page.evaluate(() => sessionStorage.getItem('hub-assistant-context:synthetic-capabilities-before'))).toBeNull();
});
}
