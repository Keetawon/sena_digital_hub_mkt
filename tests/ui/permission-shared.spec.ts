import { expect, test } from '@playwright/test';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const origin = 'http://127.0.0.1:3000';
const api = '/api/hub/v1';
const viewer = '00000000-0000-0000-0000-000000000003';
const online = '00000000-0000-0000-0000-000000000006';

async function withAccount(actor: string, run: (db: pg.Client) => Promise<void>) {
  const directory = await realpath(process.env.HUB_DISPOSABLE_TEST_RUN ?? 'missing-disposable-run');
  expect(directory.startsWith(await realpath('.local/test-runs') + path.sep)).toBe(true);
  const marker = JSON.parse(await readFile(path.join(directory, 'run.json'), 'utf8'));
  const config = JSON.parse(await readFile('.local/development.json', 'utf8'));
  const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: config.adminPassword });
  let original: { manager: boolean; tabs: pg.QueryResultRow[] } | undefined;
  try {
    await db.connect();
    expect(await realpath((await db.query('show data_directory')).rows[0].data_directory)).toBe(await realpath(path.join(directory, 'postgres')));
    expect((await db.query('select run_id from public.disposable_test_run')).rows[0].run_id).toBe(marker.run_id);
    original = {
      manager: (await db.query('select can_manage_users from hub.user_account where id=$1', [actor])).rows[0].can_manage_users,
      tabs: (await db.query('select tab,can_view,can_edit,can_approve,special_actions from hub.account_permission where account_id=$1', [actor])).rows,
    };
    await run(db);
  } finally {
    if (original) {
      for (const row of original.tabs) await db.query('update hub.account_permission set can_view=$3,can_edit=$4,can_approve=$5,special_actions=$6 where account_id=$1 and tab=$2', [actor, row.tab, row.can_view, row.can_edit, row.can_approve, row.special_actions]);
      await db.query('update hub.user_account set can_manage_users=$2 where id=$1', [actor, original.manager]);
    }
    await db.end();
  }
}

test('Questions revocation denies the next proxy read while the account and Brands stay available', async ({ page, context }) => {
  await withAccount(viewer, async db => {
    await context.addCookies([{ name: 'sena_local_persona', value: 'viewer', url: origin }]);
    await page.goto('/questions');
    expect((await page.request.get(`${api}/admin/questions`)).status()).toBe(200);
    await db.query("update hub.account_permission set can_view=false where account_id=$1 and tab='questions'", [viewer]);
    expect((await page.request.get(`${api}/admin/questions`)).status()).toBe(403);
    expect((await page.request.get(`${api}/admin/brands`)).status()).toBe(200);
    const me = (await (await page.request.get(`${api}/me`)).json()).data;
    expect(me.status).toBe('ACTIVE');
    expect(me.capabilities.tabs.questions.view).toBe(false);
  });
});

test('hidden Brands cannot be downloaded as CSV while Projects remain visible', async ({ page, context }) => {
  await withAccount(viewer, async db => {
    await context.addCookies([{ name: 'sena_local_persona', value: 'viewer', url: origin }]);
    const csv = `${api}/admin/brands/completeness.csv?status=all`;
    const before = await page.request.get(csv);
    expect(before.status()).toBe(200);
    expect(before.headers()['content-type']).toContain('text/csv');
    await db.query("update hub.account_permission set can_view=false where account_id=$1 and tab='brands'", [viewer]);
    const after = await page.request.get(csv);
    expect(after.status()).toBe(403);
    expect(after.headers()['content-type']).not.toContain('text/csv');
    expect((await page.request.get(`${api}/admin/projects`)).status()).toBe(200);
  });
});

test('Finance form loads bounded choices without Registry view or Registry requests', async ({ page, context }) => {
  await withAccount(online, async db => {
    await context.addCookies([{ name: 'sena_local_persona', value: 'online_staff', url: origin }]);
    await db.query("update hub.account_permission set can_view=false,can_edit=false where account_id=$1 and tab='registry'", [online]);
    const registryRequests: string[] = [];
    page.on('request', request => {
      if (/\/api\/hub\/v1\/admin\/ads\/(vocab|scopes)(?:\?|$)/.test(request.url())) registryRequests.push(request.url());
    });
    const references = page.waitForResponse(response => response.url() === `${origin}${api}/admin/ads/finance-references` && response.request().method() === 'GET');
    await page.goto('/ads/finance?view=memos&record=new');
    const response = await references;
    expect(response.status()).toBe(200);
    const data = (await response.json()).data;
    const bud = data.vocab.find((row: { vocab_type: string }) => row.vocab_type === 'BUD');
    expect(bud).toBeTruthy();
    const field = page.getByRole('dialog').getByLabel('BUD ผู้ขอ', { exact: false });
    await expect(field.locator(`option[value="${bud.code}"]`)).toHaveCount(1);
    await field.selectOption(bud.code);
    await expect(field).toHaveValue(bud.code);
    expect(registryRequests).toEqual([]);
    expect((await page.request.get(`${api}/admin/ads/vocab`)).status()).toBe(403);
    expect((await page.request.get(`${api}/admin/ads/memos`)).status()).toBe(200);
  });
});

test('manage-users-only viewer can use the Accounts proxy without receiving any data tab', async ({ page, context }) => {
  await withAccount(viewer, async db => {
    await db.query("update hub.account_permission set can_view=false,can_edit=false,can_approve=false,special_actions='{}' where account_id=$1", [viewer]);
    await db.query('update hub.user_account set can_manage_users=true where id=$1', [viewer]);
    await context.addCookies([{ name: 'sena_local_persona', value: 'viewer', url: origin }]);
    const response = await page.request.get(`${api}/admin/accounts`);
    expect(response.status()).toBe(200);
    expect((await response.json()).data.actor_id).toBe(viewer);
    expect((await page.request.get(`${api}/admin/permissions/catalog`)).status()).toBe(200);
    for (const resource of ['projects', 'brands', 'questions', 'ads/memos', 'ads/registrations']) {
      expect((await page.request.get(`${api}/admin/${resource}`)).status()).toBe(403);
    }
    const me = (await (await page.request.get(`${api}/me`)).json()).data;
    expect(me.status).toBe('ACTIVE');
    expect(me.role).toBe('viewer');
    expect(me.capabilities.can_manage_users).toBe(true);
  });
});
