import { expect, test } from '@playwright/test';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

test('registry revocation is effective on the next proxy request and keeps the account signed in', async ({ page, context }) => {
  const run = process.env.HUB_DISPOSABLE_TEST_RUN;
  expect(run).toBeTruthy();
  const directory = await realpath(run!);
  expect(directory.startsWith(await realpath('.local/test-runs') + path.sep)).toBe(true);
  const marker = JSON.parse(await readFile(path.join(directory, 'run.json'), 'utf8'));
  const config = JSON.parse(await readFile('.local/development.json', 'utf8'));
  const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: config.adminPassword });
  const actor = '00000000-0000-0000-0000-000000000006';
  let previous: { can_view: boolean; can_edit: boolean } | undefined;
  try {
    await db.connect();
    expect(await realpath((await db.query('show data_directory')).rows[0].data_directory)).toBe(await realpath(path.join(directory, 'postgres')));
    expect((await db.query('select run_id from public.disposable_test_run')).rows[0].run_id).toBe(marker.run_id);
    previous = (await db.query("select can_view,can_edit from hub.account_permission where account_id=$1 and tab='registry'", [actor])).rows[0];
    await context.addCookies([{ name: 'sena_local_persona', value: 'online_staff', url: 'http://127.0.0.1:3000' }]);
    await page.goto('/ads/registry');
    expect((await page.request.get('/api/hub/v1/admin/ads/registrations')).status()).toBe(200);
    await db.query("update hub.account_permission set can_edit=false where account_id=$1 and tab='registry'", [actor]);
    expect((await page.request.post('/api/hub/v1/admin/ads/registrations', {
      headers: { Origin: 'http://127.0.0.1:3000' }, data: {},
    })).status()).toBe(403);
    expect((await page.request.get('/api/hub/v1/admin/ads/registrations')).status()).toBe(200);
    await db.query("update hub.account_permission set can_view=false where account_id=$1 and tab='registry'", [actor]);
    expect((await page.request.get('/api/hub/v1/admin/ads/registrations')).status()).toBe(403);
    const account = (await (await page.request.get('/api/hub/v1/me')).json()).data;
    expect(account.status).toBe('ACTIVE');
    expect(account.capabilities.tabs.registry.view).toBe(false);
    expect(account.capabilities.tabs.finance.view).toBe(true);
  } finally {
    if (previous) await db.query("update hub.account_permission set can_view=$2,can_edit=$3 where account_id=$1 and tab='registry'", [actor, previous.can_view, previous.can_edit]);
    await db.end();
  }
});

test('agency profile cannot widen Registry reads by passing another agency or grant internal access', async ({ page, context }) => {
  await context.addCookies([{ name: 'sena_local_persona', value: 'online_staff', url: 'http://127.0.0.1:3000' }]);
  const codes: Record<string, string> = {};
  for (const agency of ['KIN', 'COMBAY']) {
    const created = await page.request.post('/api/hub/v1/admin/ads/registrations', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data: { scope_kind: 'A', scope_id: '30000000-0000-0000-0000-000000000001', objective: 'LEADS', agency },
    });
    expect(created.status()).toBe(201);
    codes[agency] = (await created.json()).data.registration.code;
  }
  await context.addCookies([{ name: 'sena_local_persona', value: 'agency_kin', url: 'http://127.0.0.1:3000' }]);
  await page.goto('/ads/registry');
  const other = await page.request.get('/api/hub/v1/admin/ads/registrations?agency=COMBAY');
  expect(other.status()).toBe(200);
  expect((await other.json()).data).toEqual([]);
  const own = await page.request.get('/api/hub/v1/admin/ads/registrations?agency=KIN');
  expect(own.status()).toBe(200);
  expect((await own.json()).data.some((row: { registration: { code: string } }) => row.registration.code === codes.KIN)).toBe(true);
  expect((await page.request.get(`/api/hub/v1/admin/ads/registrations/${codes.COMBAY}`)).status()).toBe(404);
  expect((await page.request.post('/api/hub/v1/admin/ads/registrations', {
    headers: { Origin: 'http://127.0.0.1:3000' }, data: {},
  })).status()).toBe(403);
  expect((await page.request.get('/api/hub/v1/admin/projects')).status()).toBe(403);
});
