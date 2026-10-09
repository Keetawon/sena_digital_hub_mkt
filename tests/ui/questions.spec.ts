import { expect, test, type Page } from '@playwright/test';

const api = '/api/hub/v1/admin/questions';
const origin = 'http://127.0.0.1:3000';
const excluded = ['Q9', 'Q10', 'Q11', 'Q12', 'Q18', 'Q20'];

async function session(page: Page, role: string) {
  const response = await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role } });
  expect(response.ok()).toBeTruthy();
}

test('all five staff roles read the same pending questions without changing financial permissions', async ({ page }) => {
  let expectedIds: string[] | undefined;
  for (const role of ['editor', 'publisher', 'viewer', 'online_staff', 'admin']) {
    await session(page, role);
    const response = await page.request.get(api);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const questions = (await response.json()).data.questions as { id: string; status: string; links: { href: string; label: string }[] }[];
    expect(questions.length).toBeGreaterThan(0);
    const ids = questions.map(question => question.id);
    if (expectedIds) expect(ids).toEqual(expectedIds);
    expectedIds = ids;
    for (const id of excluded) expect(ids).not.toContain(id);
    for (const question of questions) {
      expect(question.status).toBe('PENDING');
      for (const link of question.links) { expect(link.href).toMatch(/^\/(?!\/)/); expect(link.label).toMatch(/[ก-๙]/); }
    }
    await page.goto('/questions');
    await expect(page.getByRole('heading', { name: 'คำถามที่รอคำตอบ', exact: true })).toBeVisible();
    await expect(page.locator('.question-card')).toHaveCount(ids.length);
    const navigation = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
    await expect(navigation.getByRole('link', { name: 'คำถามที่รอคำตอบ', exact: true })).toHaveAttribute('aria-current', 'page');
    for (const id of excluded) await expect(page.locator(`article#${id}`)).toHaveCount(0);
    if (['editor', 'publisher', 'viewer'].includes(role)) {
      expect((await page.request.get('/api/hub/v1/admin/ads/memos')).status()).toBe(403);
      for (const label of ['งบและค่าใช้จ่าย', 'ผลใช้จ่ายรายเดือน', 'ติดตามเอกสาร', 'คลังเอกสาร', 'รายการที่ต้องตรวจสอบ']) {
        await expect(navigation.getByRole('link', { name: label, exact: true, includeHidden: true })).toHaveCount(0);
      }
    }
  }
  for (const label of ['พี่โน้ต', 'ฝ่ายการเงิน', 'เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล', 'ทีมมีเดีย', 'ทีมการตลาด', 'ทีมไอที']) {
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
  }
});

test('agency and unrecognized service sessions cannot fetch or render staff questions', async ({ page, context }) => {
  for (const role of ['agency_kin', 'agency_combay']) {
    await session(page, role);
    const requests: string[] = [];
    const capture = (request: { url: () => string }) => { if (request.url().includes(api)) requests.push(request.url()); };
    page.on('request', capture);
    expect((await page.goto('/questions'))?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงหน้านี้', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('link', { name: 'คำถามที่รอคำตอบ', exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.locator('.question-card')).toHaveCount(0);
    expect(requests).toEqual([]);
    page.off('request', capture);
    expect((await page.request.get(api)).status()).toBe(403);
    await page.goto('/ads/registry');
    await expect(page.getByRole('button', { name: /^รอคำตอบ / })).toHaveCount(0);
  }
  // The local-session boundary does not issue a service-consumer browser identity.
  await context.addCookies([{ name: 'sena_local_persona', value: 'service_consumer', url: origin }]);
  await page.goto('/questions');
  await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงคำถามของทีมงาน', exact: true })).toBeVisible();
  expect((await page.request.get(api)).status()).toBe(401);
  await context.clearCookies();
  expect((await page.request.get(api)).status()).toBe(401);
});

test('registry remark preserves approval banner, opens by keyboard and returns focus on Escape', async ({ page }) => {
  await session(page, 'online_staff');
  await page.goto('/ads/registry');
  await expect(page.getByLabel('สถานะการอนุมัติรูปแบบชื่อ')).toContainText('รออนุมัติรูปแบบชื่อ');
  const badge = page.getByRole('button', { name: 'รอคำตอบ Q2', exact: true });
  await badge.focus();
  await page.keyboard.press('Enter');
  const popover = page.getByRole('dialog');
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('heading')).toBeFocused();
  await expect(popover.getByText('ผู้รับผิดชอบ:', { exact: true })).toBeVisible();
  await expect(popover.getByText('ระหว่างรอคำตอบ:', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover).not.toBeVisible();
  await expect(badge).toBeFocused();
  await badge.click();
  await popover.getByRole('button', { name: 'ปิดคำถาม Q2', exact: true }).click();
  await expect(badge).toBeFocused();
  await badge.click();
  await popover.getByRole('link', { name: 'ดูคำถามทั้งหมด', exact: true }).click();
  await expect(page).toHaveURL(/\/questions#Q2$/);
  await expect(page.locator('article#Q2')).toBeVisible();
});

test('finance reuses the pending-question component for the document matrix', async ({ page }) => {
  await session(page, 'admin');
  await page.goto('/ads/finance?view=document-requirements');
  await page.getByRole('button', { name: 'รอคำตอบ Q24', exact: true }).click();
  const popover = page.getByRole('dialog');
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('heading')).toBeFocused();
  await expect(popover.getByText('ระหว่างรอคำตอบ:', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'รอคำตอบ Q24', exact: true })).toBeFocused();
});

test('questions proxy only permits a read with no arbitrary query or subpath', async ({ page }) => {
  await session(page, 'admin');
  expect((await page.request.get(`${api}?status=ALL`)).status()).toBe(404);
  expect((await page.request.get(`${api}/Q2`)).status()).toBe(404);
  expect((await page.request.post(api, { headers: { Origin: origin }, data: {} })).status()).toBe(404);
});

test('questions expose retry on load failure and use one provider request per page', async ({ page }) => {
  await session(page, 'viewer');
  let calls = 0;
  await page.route(`**${api}`, route => {
    calls += 1;
    return calls === 1 ? route.fulfill({ status: 503, json: { error: { message: 'บริการทดสอบไม่พร้อม' } } }) : route.fulfill({ json: { data: { questions: [{ id: 'Q2', status: 'PENDING', owner_group: 'note', owner_th: 'พี่โน้ต', question_th: 'คำถามสังเคราะห์สำหรับทดสอบ', default_th: 'ใช้ข้อมูลสาธิตระหว่างรอคำตอบ', links: [{ href: '/ads/registry', label: 'ทะเบียนแคมเปญ' }] }] } } });
  });
  await page.goto('/questions');
  await expect(page.locator('.questions-page').getByRole('alert')).toContainText('โหลดรายการคำถามไม่สำเร็จ');
  await page.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'คำถามสังเคราะห์สำหรับทดสอบ', exact: true })).toBeVisible();
  expect(calls).toBe(2);
});

test('question cards and popover fit small screens with large Thai text and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%'; }));
  await session(page, 'online_staff');
  await page.goto('/questions');
  await expect(page.locator('article#Q2')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/ads/registry');
  const badge = page.getByRole('button', { name: 'รอคำตอบ Q2', exact: true });
  await badge.click();
  const popover = page.getByRole('dialog');
  await expect(popover.getByRole('heading')).toBeFocused();
  expect(await popover.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  const box = await popover.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(await popover.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(badge).toBeFocused();
});
