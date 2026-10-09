import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Opt-in only: this suite never targets the actual hosted project or normal local DB.
test.describe('H1 disposable managed-permission simulation', () => {
  test.skip(process.env.HUB_HOSTED_TEST_SIMULATION !== '1', 'Requires the isolated H1 Auth/API/database simulation');
  test.use({ baseURL: 'http://127.0.0.1:3001' });
  const origin = 'http://127.0.0.1:3001';
  const roles = [
    ['editor', 'ผู้แก้ไขข้อมูล', true], ['publisher', 'Manager · อนุมัติและเผยแพร่', true],
    ['viewer', 'ผู้อ่านข้อมูล', true], ['admin', 'ผู้ดูแลระบบ', true],
    ['online', 'ทีมออนไลน์', false], ['agency-kin', 'เอเจนซี KIN', false],
    ['agency-combay', 'เอเจนซี COMBAY', false],
  ] as const;

  async function login(page: Page, role: string, next = '/') {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page.getByLabel('อีเมล', { exact: true }).fill(`hub-test-${role}@example.test`);
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill('H1-synthetic-only!');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ออกจากระบบ', exact: true })).toBeVisible();
  }

  test.beforeEach(async ({ page }) => {
    // Fail closed if a browser code path attempts to contact any real service.
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') return route.abort('blockedbyclient');
      return route.continue();
    });
  });

  for (const [role, label, residential] of roles) {
    test(`${role}: verified login, role isolation, no demo selector, logout`, async ({ page }) => {
      await login(page, role);
      await expect(page.locator('.topbar-right')).toContainText(label);
      await expect(page.getByLabel('เลือกบัญชีทดสอบ')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true })).toHaveCount(0);
      expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role: 'admin' } })).status()).toBe(403);
      const projects = await page.request.get('/api/hub/v1/admin/projects');
      expect(projects.status()).toBe(residential ? 200 : 403);
      if (residential) expect((await projects.json()).data.length).toBeGreaterThan(0);
      const registry = await page.request.get('/api/hub/v1/admin/ads/registrations');
      expect(registry.status()).toBe(!residential || role === 'admin' ? 200 : 403);
      const issuance = await page.request.post('/api/hub/v1/admin/ads/registrations', { headers: { Origin: origin }, data: {} });
      expect(issuance.status()).toBe(403);
      await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible();
      expect((await page.request.get('/api/hub/v1/admin/projects')).status()).toBe(401);
    });
  }

  test('H2 modules are unavailable by page and direct API; residential seed is coherent', async ({ page }) => {
    await login(page, 'admin');
    for (const path of ['/ads/finance', '/ads/actuals', '/ads/documents', '/ads/archive', '/ads/exceptions']) {
      await page.goto(path);
      await expect(page.locator('main').getByText('ยังไม่เปิดใช้งานใน H1 · รอเปิดใน H2 ขึ้นไป', { exact: true })).toBeVisible();
    }
    for (const path of ['ads/memos', 'ads/actuals', 'ads/archive', 'assistant/config']) {
      expect((await page.request.get(`/api/hub/v1/admin/${path}`)).status()).toBe(403);
    }
    for (const path of ['brands', 'projects', 'promotions', 'releases']) {
      const response = await page.request.get(`/api/hub/v1/admin/${path}`);
      expect(response.status()).toBe(200);
      const data = (await response.json()).data;
      expect((Array.isArray(data) ? data : data.items).length).toBeGreaterThan(0);
    }
    await page.goto('/ads/registry/new');
    await expect(page.getByText('ยังไม่เปิดการออกชื่อแคมเปญใน H1', { exact: true })).toBeVisible();
    const settings = (await (await page.request.get('/api/hub/v1/admin/ads/settings')).json()).data;
    expect(settings.sena_h_approved).toBe(false); expect(settings.can_issue).toBe(false);
  });

  test('H1 cached progress stays synthetic, paginated and visible in the default scope', async ({page}) => {
    await login(page, 'viewer');
    const response=await page.request.get('/api/hub/v1/admin/projects/progress?page=1&size=10');
    expect(response.status()).toBe(200);
    const data=(await response.json()).data;
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].rem_project_id).toBe('H1-PROJECT-001');
    expect(data.rows[0].source_review).toMatchObject({status_raw:'2',default_scope:true});
    expect(data.rows[0].group_status).toBe('missing');
    expect(data.rows[0].checklist.required).toBeUndefined();
    expect(data.rows[0].models).toBeUndefined();
    const counts=(await (await page.request.get('/api/hub/v1/admin/projects/progress?view=counts')).json()).data;
    expect(counts.counts.all).toBe(1);expect(counts.statuses['2'].count).toBe(1);
    await expect(page.locator('.project-summary-row')).toHaveCount(1);
    await page.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();
    // signOut awaits Auth before assigning /login; a second goto must not race it.
    await page.waitForURL(`${origin}/login`);
    await expect(page.getByRole('heading',{name:'เข้าสู่ระบบ',exact:true})).toBeVisible();
    await login(page,'agency-kin');
    expect((await page.request.get('/api/hub/v1/admin/projects/progress')).status()).toBe(403);
  });

  test('agency inbox preserves source IDs and isolates both agency identities', async ({ page, browser }) => {
    await login(page, 'agency-kin', '/ads/registry/inbox');
    const rows = (await (await page.request.get('/api/hub/v1/admin/ads/registrations')).json()).data;
    const items = Array.isArray(rows) ? rows : rows.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item: { registration: { agency: string } }) => item.registration.agency === 'KIN')).toBe(true);
    const code = items[0].registration.code;
    await page.getByRole('button', { name: `กรอกรหัสสำหรับ ${code}`, exact: true }).click();
    const account = '000H1ACCOUNT', campaign = `000H1-${randomUUID()}`;
    await page.getByLabel('รหัสบัญชีโฆษณา', { exact: true }).fill(account);
    await page.getByLabel('รหัสแคมเปญ', { exact: true }).fill(campaign);
    await page.getByRole('button', { name: 'บันทึกรหัส', exact: true }).click();
    await expect(page.getByText('บันทึกรหัสแล้ว', { exact: true })).toBeVisible();
    const context = await browser.newContext({ baseURL: origin }); const other = await context.newPage();
    try {
      await login(other, 'agency-combay', '/ads/registry/inbox');
      const own = (await (await other.request.get('/api/hub/v1/admin/ads/registrations')).json()).data;
      expect((Array.isArray(own) ? own : own.items).every((item: { registration: { agency: string } }) => item.registration.agency === 'COMBAY')).toBe(true);
      expect((await other.request.get(`/api/hub/v1/admin/ads/registrations/${code}`)).status()).toBe(404);
      await expect(other.getByText(code, { exact: true })).toHaveCount(0);
    } finally { await context.close(); }
  });

  test('forged cached persona is ignored and an expired cookie refreshes through Auth', async ({ page }) => {
    await login(page, 'agency-kin');
    await page.context().addCookies([{ name: 'sena_local_persona', value: 'admin', url: origin }]);
    const cookie = (await page.context().cookies()).find(item => /^sb-.*-auth-token$/.test(item.name));
    expect(Boolean(cookie)).toBe(true);
    const session = JSON.parse(Buffer.from(cookie!.value.replace(/^base64-/, ''), 'base64url').toString());
    session.user.app_metadata = { hub_role: 'admin' };
    await page.context().addCookies([{ ...cookie!, value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}` }]);
    await page.reload();
    await expect(page.locator('.topbar-right')).toContainText('เอเจนซี KIN');
    expect((await page.request.get('/api/hub/v1/admin/projects', { headers: { 'x-hub-role': 'admin' } })).status()).toBe(403);
    session.expires_at = 1;
    await page.context().addCookies([{ ...cookie!, value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}` }]);
    await page.reload();
    await expect(page.locator('.topbar-right')).toContainText('เอเจนซี KIN');
    const refreshed = (await page.context().cookies()).find(item => item.name === cookie!.name);
    const value = JSON.parse(Buffer.from(refreshed!.value.replace(/^base64-/, ''), 'base64url').toString());
    expect(value.expires_at > Date.now() / 1000).toBe(true);
  });

  test('a forged bearer in the browser cookie never authenticates', async ({ page }) => {
    await login(page, 'viewer');
    const cookie = (await page.context().cookies()).find(item => /^sb-.*-auth-token$/.test(item.name));
    expect(Boolean(cookie)).toBe(true);
    const session = JSON.parse(Buffer.from(cookie!.value.replace(/^base64-/, ''), 'base64url').toString());
    const pieces = session.access_token.split('.');
    const claims = JSON.parse(Buffer.from(pieces[1], 'base64url').toString());
    claims.app_metadata = { hub_role: 'admin' };
    pieces[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
    session.access_token = pieces.join('.');
    await page.context().addCookies([{ ...cookie!, value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}` }]);
    expect((await page.request.get('/api/hub/v1/admin/projects')).status()).toBe(401);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible();
  });

  test('login rejects a control-character external return target', async ({ page }) => {
    await login(page, 'editor', '/\t/attacker.example');
    expect(new URL(page.url()).origin).toBe(origin);
    await expect(page.getByRole('heading', { name: 'โครงการที่อยู่อาศัย', exact: true })).toBeVisible();
  });

  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    test(`private logo upload and authenticated preview at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport); await login(page, 'editor');
      const brands = (await (await page.request.get('/api/hub/v1/admin/brands')).json()).data;
      expect((await page.request.get('/api/hub/v1/admin/brands/bulk-preview')).status()).toBe(403);
      await page.goto(`/?brand=${brands[0].public_brand_id}`);
      const slot = page.locator('[data-logo-role="logo_white"]');
      const name = `h1-white-${randomUUID()}.svg`;
      const uploaded = page.waitForResponse(response => response.url() === 'http://127.0.0.1:8001/v1/admin/assets' && response.request().method() === 'POST');
      await slot.getByLabel('เลือกไฟล์ · โลโก้สีขาว', { exact: true }).setInputFiles({ name, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><script>alert(1)</script><rect width="600" height="240" fill="white"/><title>${name}</title></svg>`) });
      expect((await uploaded).status()).toBe(201);
      await expect(slot.locator('.asset-caption > .small-text.muted')).toHaveText(name);
      await expect(slot.locator('img')).toHaveAttribute('src', /^blob:/);
      await slot.locator('img').scrollIntoViewIfNeeded();
      await expect(slot.locator('img')).toHaveJSProperty('naturalWidth', 600);
      const download = page.waitForEvent('download');
      await slot.getByRole('button', { name: `ดาวน์โหลดไฟล์ ${name}`, exact: true }).click();
      expect((await download).suggestedFilename()).toBe(name);
      const data = (await (await page.request.get(`/api/hub/v1/admin/brands/${brands[0].public_brand_id}`)).json()).data;
      const asset = data.assets.find((item: { asset_role: string }) => item.asset_role === 'logo_white');
      expect((await page.request.get(`http://127.0.0.1:8001/v1/admin/assets/${asset.id}/file`)).status()).toBe(401);
      const favicon = page.locator('[data-logo-role="favicon"]');
      const faviconName = `favicon-${randomUUID()}.svg`;
      await favicon.getByLabel('เลือกไฟล์ · ไอคอนเว็บไซต์ (favicon)', { exact: true }).setInputFiles({ name: faviconName, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="gold"/><title>${randomUUID()}</title></svg>`) });
      await expect(favicon.locator('.asset-caption > .small-text.muted')).toHaveText(faviconName);
      await expect(favicon.locator('img')).toHaveCount(2);
      for (const size of [16, 32]) {
        const image = favicon.locator(`img[width="${size}"]`);
        await expect(image).toHaveAttribute('src', /^blob:/); await image.scrollIntoViewIfNeeded();
        await expect(image).toHaveJSProperty('naturalWidth', 512);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
});
