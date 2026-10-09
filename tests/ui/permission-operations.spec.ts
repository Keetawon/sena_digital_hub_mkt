import { expect, test } from '@playwright/test';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

for (const [tab, pagePath, apiPath, command] of [
  ['finance', '/ads/finance', '/v1/admin/ads/memos', '/v1/admin/ads/memos'],
  ['archive', '/ads/archive', '/v1/admin/ads/archive', '/v1/admin/ads/archive'],
]) test(`${tab} revocation blocks the next proxy request and preserves the session`, async ({ page, context }) => {
  const run = process.env.HUB_DISPOSABLE_TEST_RUN;
  expect(run).toBeTruthy();
  const directory = await realpath(run!);
  expect(directory.startsWith(await realpath('.local/test-runs') + path.sep)).toBe(true);
  const marker = JSON.parse(await readFile(path.join(directory, 'run.json'), 'utf8'));
  const config = JSON.parse(await readFile('.local/development.json', 'utf8'));
  const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: config.adminPassword });
  const actor = '00000000-0000-0000-0000-000000000006';
  let previous: { can_view: boolean; can_edit: boolean; can_approve: boolean } | undefined;
  try {
    await db.connect();
    expect(await realpath((await db.query('show data_directory')).rows[0].data_directory)).toBe(await realpath(path.join(directory, 'postgres')));
    expect((await db.query('select run_id from public.disposable_test_run')).rows[0].run_id).toBe(marker.run_id);
    previous = (await db.query("select can_view,can_edit,can_approve from hub.account_permission where account_id=$1 and tab=$2", [actor, tab])).rows[0];
    await context.addCookies([{ name: 'sena_local_persona', value: 'online_staff', url: 'http://127.0.0.1:3000' }]);
    await page.goto(pagePath);
    expect((await page.request.get('/api/hub' + apiPath)).status()).toBe(200);
    await db.query("update hub.account_permission set can_edit=false where account_id=$1 and tab=$2", [actor, tab]);
    expect((await page.request.post('/api/hub' + command, {
      headers: { Origin: 'http://127.0.0.1:3000' }, data: {},
    })).status()).toBe(403);
    expect((await page.request.get('/api/hub' + apiPath)).status()).toBe(200);
    await db.query("update hub.account_permission set can_view=false,can_approve=false where account_id=$1 and tab=$2", [actor, tab]);
    expect((await page.request.get('/api/hub' + apiPath)).status()).toBe(403);
    const account = (await (await page.request.get('/api/hub/v1/me')).json()).data;
    expect(account.status).toBe('ACTIVE');
    expect(account.capabilities.tabs[tab].view).toBe(false);
    expect(account.capabilities.tabs.registry.view).toBe(true);
  } finally {
    if (previous) await db.query("update hub.account_permission set can_view=$2,can_edit=$3,can_approve=$4 where account_id=$1 and tab=$5", [actor, previous.can_view, previous.can_edit, previous.can_approve, tab]);
    await db.end();
  }
});
