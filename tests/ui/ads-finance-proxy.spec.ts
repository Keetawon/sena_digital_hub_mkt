import { expect, test } from '@playwright/test';

const base = '/api/hub/v1/admin/ads';
const absent = '00000000-0000-4000-8000-999999999999';
const headers = { Origin: 'http://127.0.0.1:3000', Cookie: 'sena_local_persona=online_staff' };

test('finance collections and filters reach the real staff API through the Hub proxy', async ({ request }) => {
  for (const path of ['memos?q=SYNTHETIC&limit=1&offset=0', 'media-lines?month=2099-09-01&agency=KIN&bud=C1&limit=1', 'ad-accounts', 'channel-accounts', 'commitments', 'card-statements', 'card-imports', 'ledger-imports', 'cost-records', 'document-requirements', 'corrections', 'memo-identifiers', 'line-assignments']) {
    const response = await request.get(`${base}/${path}`, { headers });
    expect(response.status(), path).toBe(200);
    expect((await response.json()).data).toBeInstanceOf(Array);
  }
});

test('finance writes reach typed validation and missing-record checks without storing test data', async ({ request }) => {
  for (const path of ['memos', 'media-lines', 'ad-accounts', 'channel-accounts', 'commitments', 'card-statements', `card-imports/${absent}/confirm`, `card-imports/${absent}/replace`, `card-import-rows/${absent}/classify`, `cost-records/${absent}/allocations`, `ad-accounts/${absent}/versions/close`]) {
    const response = await request.post(`${base}/${path}`, { headers, data: {} });
    expect(response.status(), path).toBe(422);
  }
  const response = await request.patch(`${base}/memos/${absent}`, { headers, data: { expected_version: 1, subject: 'ข้อมูลสังเคราะห์ที่ไม่ถูกบันทึก' } });
  expect(response.status()).toBe(404);
  expect((await response.json()).error.code).toBe('finance_not_found');
});

test('finance proxy preserves agency denial, same-origin writes and a closed route/query allowlist', async ({ request }) => {
  const denied = await request.get(`${base}/memos`, { headers: { ...headers, Cookie: 'sena_local_persona=agency_kin' } });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error.code).toBe('finance_forbidden');
  expect((await request.post(`${base}/memos`, { headers: { ...headers, Origin: 'https://example.invalid' }, data: {} })).status()).toBe(403);
  for (const path of ['finance-command', 'statement-upload', 'memos?actor_id=forged', 'memos?limit=1&limit=2']) {
    expect((await request.get(`${base}/${path}`, { headers })).status(), path).toBe(404);
  }
});
