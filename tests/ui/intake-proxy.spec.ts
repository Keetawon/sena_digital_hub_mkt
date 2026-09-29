import { expect, test, type APIResponse } from '@playwright/test';

const origin = 'http://127.0.0.1:3000';
const project = '/api/hub/v1/admin/projects/proxy-contract-does-not-exist';
const type = `${project}/commercial-types/ctyp_11111111111111111111111111111111`;
const model = `${project}/models/mdl_22222222222222222222222222222222`;
const binding = '33333333-3333-4333-8333-333333333333';
const editorHeaders = { Origin: origin, Cookie: 'sena_local_persona=editor' };

// Exercise the real Next allowlist and FastAPI validation. Missing mandatory
// fields make every write fail before a database mutation; no routes are mocked.
async function safeError(response: APIResponse, status: number, code?: string) {
  expect(response.status()).toBe(status);
  expect(response.headers()['cache-control']).toContain('no-store');
  const body = await response.text();
  // Check without putting a potentially sensitive response in assertion output.
  expect(/HUB_DEMO_|postgres(?:ql)?:\/\/|Bearer\s+[A-Za-z0-9._-]+|BEGIN (?:RSA |EC )?PRIVATE KEY/i.test(body)).toBe(false);
  const payload = JSON.parse(body);
  expect(typeof payload.error?.message).toBe('string');
  if (code) expect(payload.error.code).toBe(code);
  return payload;
}

test('commercial, amenity and existing model write routes reach upstream validation through the real proxy', async ({ request }) => {
  const routes = [
    { method: 'POST', path: `${project}/commercial-types` },
    { method: 'PATCH', path: type },
    { method: 'POST', path: `${type}/assets` },
    { method: 'POST', path: `${type}/assets/${binding}/remove` },
    { method: 'PUT', path: `${project}/facilities/pool` },
    { method: 'POST', path: `${model}/assets` },
    { method: 'POST', path: `${model}/assets/${binding}/remove` },
    { method: 'POST', path: `${project}/prefill` },
  ];
  for (const route of routes) {
    await test.step(`${route.method} ${route.path}`, async () => {
      const response = await request.fetch(route.path, { method: route.method, headers: editorHeaders, data: {} });
      await safeError(response, 422, 'validation_error');
    });
  }
});

test('commercial and model reads reach upstream not-found instead of the proxy allowlist rejection', async ({ request }) => {
  for (const path of [`${project}/commercial-types`, model]) {
    await test.step(path, async () => {
      await safeError(await request.get(path, { headers: editorHeaders }), 404, 'not_found');
    });
  }
});

test('viewer cannot write through newly allowed endpoints', async ({ request }) => {
  const headers = { Origin: origin, Cookie: 'sena_local_persona=viewer' };
  await safeError(await request.put(`${project}/facilities/pool`, { headers, data: {} }), 403, 'forbidden');
  await safeError(await request.post(`${project}/commercial-types`, { headers, data: {} }), 403, 'forbidden');
});

test('unknown endpoints and unsupported consumer persona remain blocked locally', async ({ request }) => {
  const unknown = await safeError(await request.get(`${type}/unsupported`, { headers: editorHeaders }), 404);
  expect(unknown.error.code).toBeUndefined();
  await safeError(await request.get(`${project}/commercial-types`, {
    headers: { Cookie: 'sena_local_persona=service_consumer' },
  }), 401);
});

test('cross-origin commercial and amenity writes are rejected before upstream validation', async ({ request }) => {
  const headers = { Origin: 'https://example.invalid', Cookie: 'sena_local_persona=editor' };
  const commercial = await safeError(await request.post(`${project}/commercial-types`, { headers, data: {} }), 403);
  const facility = await safeError(await request.put(`${project}/facilities/pool`, { headers, data: {} }), 403);
  expect(commercial.error.code).toBeUndefined();
  expect(facility.error.code).toBeUndefined();
});
