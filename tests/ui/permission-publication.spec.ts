import { expect, test } from '@playwright/test';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

test('knowledge permission revocation reaches the browser on the next request without signing out', async ({ page, context }) => {
  const run = process.env.HUB_DISPOSABLE_TEST_RUN;
  expect(run).toBeTruthy();
  const directory = await realpath(run!);
  const base = await realpath('.local/test-runs');
  expect(directory.startsWith(base + path.sep)).toBe(true);
  const marker = JSON.parse(await readFile(path.join(directory, 'run.json'), 'utf8'));
  const config = JSON.parse(await readFile('.local/development.json', 'utf8'));
  const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: config.adminPassword });
  const viewer = '00000000-0000-0000-0000-000000000003';
  let verified = false, previous: boolean | undefined;
  try {
    await db.connect();
    expect(await realpath((await db.query('show data_directory')).rows[0].data_directory)).toBe(await realpath(path.join(directory, 'postgres')));
    expect((await db.query('select run_id from public.disposable_test_run')).rows[0].run_id).toBe(marker.run_id);
    verified = true;
    previous = (await db.query("select can_view from hub.account_permission where account_id=$1 and tab='knowledge'", [viewer])).rows[0].can_view;
    expect(previous).toBe(true);
    await context.addCookies([{ name: 'sena_local_persona', value: 'viewer', url: 'http://127.0.0.1:3000' }]);
    await page.goto('/knowledge');
    expect((await page.request.get('/api/hub/v1/admin/knowledge/projects')).status()).toBe(200);
    await db.query("update hub.account_permission set can_view=false where account_id=$1 and tab='knowledge'", [viewer]);
    expect((await page.reload())?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงหน้านี้', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/knowledge$/);
    const account = (await (await page.request.get('/api/hub/v1/me')).json()).data;
    expect(account.status).toBe('ACTIVE');expect(account.capabilities.tabs.knowledge.view).toBe(false);
    expect((await page.request.get('/api/hub/v1/admin/knowledge/projects')).status()).toBe(403);
    expect((await page.request.post('/api/hub/v1/admin/knowledge/preview', {
      headers: { Origin: 'http://127.0.0.1:3000' }, data: { question: 'Synthetic permission test' },
    })).status()).toBe(403);
    expect((await page.request.get('/api/hub/v1/admin/projects')).status()).toBe(200);
  } finally {
    if (verified && previous !== undefined) await db.query("update hub.account_permission set can_view=$2 where account_id=$1 and tab='knowledge'", [viewer, previous]);
    await db.end();
  }
});

test('publication and knowledge mutations use their separate boxes through the real proxy', async ({ page, context }) => {
  const headers = { Origin: 'http://127.0.0.1:3000' };
  await context.addCookies([{ name: 'sena_local_persona', value: 'publisher', url: 'http://127.0.0.1:3000' }]);
  await page.goto('/releases');
  expect((await page.request.get('/api/hub/v1/admin/releases/candidates')).status()).toBe(200);
  expect((await page.request.post('/api/hub/v1/admin/promotions', { headers, data: {} })).status()).toBe(403);
  expect((await page.request.post('/api/hub/v1/admin/knowledge/candidates/00000000-0000-4000-8000-000000000000/review', { headers, data: {} })).status()).toBe(403);
  await context.addCookies([{ name: 'sena_local_persona', value: 'admin', url: 'http://127.0.0.1:3000' }]);
  expect((await page.request.post('/api/hub/v1/admin/releases/publish', { headers, data: {} })).status()).toBe(403);
  expect((await page.request.post('/api/hub/v1/admin/knowledge/rights/approve', { headers, data: {} })).status()).toBe(403);
});
