import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { contentAllowsApi, contentAllowsQuery } from '../../apps/admin/lib/content-routes';
import { h1AllowsApi, h1Unavailable } from '../../apps/admin/lib/hosted-config';
import { capabilityKey, contentScopeExpired, emptyCapabilities, type HubAccount } from '../../apps/admin/lib/hub-permissions';

const requireAdmin = createRequire(resolve('apps/admin/package.json'));
const compiler = requireAdmin('typescript') as { transpileModule(source: string, options: object): { outputText: string }; ModuleKind: { CommonJS: number }; ScriptTarget: { ES2022: number } };
const next = requireAdmin('next/server') as { NextRequest: new (url: string, init?: RequestInit) => Request; NextResponse: typeof Response };
const origin = 'http://127.0.0.1:3000';
const uuid = '66000000-0000-4000-8000-000000000001';
const privateText = 'Synthetic private content never delivered after revocation';

function signal() {
  let release!: () => void;
  const promise = new Promise<void>(done => { release = done; });
  return { promise, release };
}

function account(): HubAccount {
  return { id: 'synthetic-account', status: 'ACTIVE', role: 'editor', capabilities: { ...emptyCapabilities, published_consumer: true,
    tabs: { projects: { view: true, edit: true }, brands: { view: true }, knowledge: { view: true }, registry: { view: true } } },
    content_scope: { fingerprint: 'scope-one', expires_at: null } };
}

function harness(hosted = false) {
  const state = { account: account(), authorityStatus: 200, now: Date.parse('2026-11-05T03:00:00Z'), meReads: 0, contentReads: 0, invalidations: 0,
    resource: (_url: URL): Response | Promise<Response> => Response.json({ data: { text: privateText } }) };
  const fetched = signal();
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.cache).toBe('no-store');
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin);
    if (url.pathname === '/v1/me') {
      state.meReads++;
      return Response.json(state.authorityStatus === 200 ? { data: structuredClone(state.account) } : { error: {} }, { status: state.authorityStatus });
    }
    state.contentReads++; fetched.release();
    return state.resource(url);
  };
  // Execute the actual route and actual uncached /me reader. Only environment
  // identity adapters and network transport are synthetic; no config is loaded.
  const modules: Record<string, unknown> = {
    'next/server': next,
    '@/lib/content-routes': { contentAllowsApi, contentAllowsQuery },
    '@/lib/local-session': { getLocalRole: async () => 'editor', getRoleToken: () => 'synthetic-bearer', hasSameLocalOrigin: () => true,
      isLocalMode: () => !hosted, isLoopback: (host: string) => host === '127.0.0.1', localRequestOrigin: () => true },
    '@/lib/hosted-session': { getHostedIdentity: async () => ({ token: 'synthetic-bearer' }) },
    '@/lib/hosted-config': { h1AllowsApi, h1Unavailable, hostedConfig: () => ({ apiOrigin: 'http://127.0.0.1:8000', adminOrigin: origin }), isHostedMode: () => hosted },
  };
  function load(name: string, path: string) {
    const module = { exports: {} };
    const code = compiler.transpileModule(readFileSync(resolve(path), 'utf8'), { compilerOptions: { module: compiler.ModuleKind.CommonJS, target: compiler.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: (key: string) => {
      if (!(key in modules)) throw new Error(`Unowned test dependency: ${key}`);
      return modules[key];
    }, fetch: fakeFetch, process: { env: { HUB_API_URL: 'http://127.0.0.1:8000' } }, URL, URLSearchParams, Request, Response, Headers,
    ReadableStream, TextDecoder, TextEncoder, AbortController, AbortSignal, setTimeout, clearTimeout, Event,
    window: { dispatchEvent(event: Event) { expect(event.type).toBe('hub-content-access-invalidated'); expect('detail' in event).toBe(false); state.invalidations++; } },
    Date: { now: () => state.now, parse: Date.parse } }, { filename: path });
    modules[name] = module.exports;
    return module.exports;
  }
  load('@/lib/hub-permissions', 'apps/admin/lib/hub-permissions.ts');
  load('@/lib/hub-account', 'apps/admin/lib/hub-account.ts');
  load('@/lib/content-scope-text', 'apps/admin/lib/content-scope-text.ts');
  const route = load('proxy', 'apps/admin/app/api/hub/[...path]/route.ts') as Record<string, (request: Request, context: { params: Promise<{ path: string[] }> }) => Promise<Response>>;
  const call = (path: string, method = 'GET', body?: object) => route[method](new next.NextRequest(`${origin}/api/hub/${path}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  }), { params: Promise.resolve({ path: path.split('?')[0].split('/') }) });
  const helper = load('request', 'apps/admin/components/hub-request.ts') as { request<T>(path: string): Promise<T> };
  return { state, fetched: fetched.promise, call, request: helper.request };
}

function delayedBody(contentType: string, body: string) {
  const ready = signal();
  const response = new Response(new ReadableStream<Uint8Array>({ async start(controller) {
    await ready.promise; controller.enqueue(new TextEncoder().encode(body)); controller.close();
  } }), { headers: { 'Content-Type': contentType, 'Content-Disposition': 'inline; filename="synthetic.png"' } });
  return { response, release: ready.release };
}

test('authority key includes scope and deadline while an absent scope stays unrestricted', () => {
  const before = account();
  expect(capabilityKey(before)).not.toBe(capabilityKey({ ...before, content_scope: { fingerprint: 'scope-two', expires_at: null } }));
  const expiry = '2026-11-05T03:00:00Z';
  const timed = { ...before, content_scope: { fingerprint: 'scope-one', expires_at: expiry } };
  expect(capabilityKey(before)).not.toBe(capabilityKey(timed));
  expect(contentScopeExpired(timed, Date.parse(expiry) - 1)).toBe(false);
  expect(contentScopeExpired(timed, Date.parse(expiry))).toBe(true);
  expect(contentScopeExpired({ ...before, content_scope: undefined }, Date.parse(expiry))).toBe(false);
  expect(contentScopeExpired({ ...before, content_scope: { fingerprint: 'bad', expires_at: 'invalid' } })).toBe(true);
});

for (const change of ['scope', 'capability', 'suspend', 'identity', 'expiry', 'unavailable'] as const) {
  test(`private JSON held at the proxy is discarded on ${change}`, async () => {
    const fixture = harness();
    if (change === 'expiry') fixture.state.account.content_scope!.expires_at = new Date(fixture.state.now + 1_000).toISOString();
    const body = delayedBody('application/json', JSON.stringify({ data: { text: privateText } }));
    fixture.state.resource = () => body.response;
    const pending = fixture.call('v1/admin/projects/PROJECT-A');
    await fixture.fetched;
    if (change === 'scope') fixture.state.account.content_scope!.fingerprint = 'scope-two';
    if (change === 'capability') fixture.state.account.capabilities!.tabs.projects.view = false;
    if (change === 'suspend') fixture.state.account.status = 'SUSPENDED';
    if (change === 'identity') fixture.state.account.id = 'another-account';
    if (change === 'expiry') fixture.state.now += 1_000;
    if (change === 'unavailable') fixture.state.authorityStatus = 503;
    body.release();
    const response = await pending;
    expect(response.status).toBe(change === 'unavailable' ? 503 : 403);
    const result = await response.json();
    expect(result.error.invalidate_access).toBe(true);
    expect(JSON.stringify(result)).not.toContain(privateText);
    expect(fixture.state.meReads).toBe(2);
  });
}

for (const [path, type] of [[`v1/admin/assets/${uuid}/thumbnail`, 'image/png'], [`v1/admin/web/publications/${uuid}/preview`, 'text/html'], ['v1/admin/brands/completeness.csv', 'text/csv']]) {
  test(`delayed ${type} is guarded and an unchanged allowed neighbour retains its headers`, async () => {
    for (const denied of [true, false]) {
      const fixture = harness();
      fixture.state.account.content_scope = null;
      const body = delayedBody(type, privateText);
      fixture.state.resource = () => body.response;
      const pending = fixture.call(path);
      await fixture.fetched;
      if (denied) fixture.state.account.capabilities!.tabs.projects.view = false;
      body.release();
      const response = await pending;
      expect(response.status).toBe(denied ? 403 : 200);
      const received = await response.text();
      if (denied) expect(received).not.toContain(privateText);
      else {
        expect(received).toBe(privateText);
        expect(response.headers.get('Content-Type')).toContain(type);
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        if (type === 'text/html') expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
        if (type === 'text/csv') expect(response.headers.get('Content-Disposition')).toContain('brand-completeness.csv');
      }
    }
  });
}

test('ordinary object denial is not promoted to global authority loss', async () => {
  const fixture = harness();
  fixture.state.resource = () => Response.json({ error: { code: 'object_denied' } }, { status: 403 });
  const response = await fixture.call('v1/admin/projects/PROJECT-A');
  expect(response.status).toBe(403);
  expect((await response.json()).error).toEqual({ code: 'object_denied' });
});

test('shared request helper sends only explicit content-free invalidation and still rejects the response', async () => {
  const fixture = harness();
  fixture.state.resource = () => Response.json({ error: { code: 'object_denied' } }, { status: 403 });
  await expect(Promise.resolve(fixture.request('v1/admin/projects/PROJECT-A'))).rejects.toMatchObject({ status: 403, code: 'object_denied' });
  expect(fixture.state.invalidations).toBe(0);
  fixture.state.resource = () => Response.json({ error: { code: 'content_authority_changed', invalidate_access: true } }, { status: 403 });
  await expect(Promise.resolve(fixture.request('v1/admin/projects/PROJECT-A'))).rejects.toMatchObject({ status: 403, code: 'content_authority_changed' });
  expect(fixture.state.invalidations).toBe(1);
});

test('expired starting authority denies before fetching any private resource', async () => {
  const fixture = harness();
  fixture.state.account.content_scope!.expires_at = new Date(fixture.state.now).toISOString();
  expect((await fixture.call('v1/admin/projects/PROJECT-A')).status).toBe(403);
  expect(fixture.state.contentReads).toBe(0);
});

test('H1 private authentication loss during the resource request invalidates cached source', async () => {
  const fixture = harness(true);
  fixture.state.resource = () => Response.json({ error: { message: privateText } }, { status: 401 });
  const response = await fixture.call('v1/admin/projects/PROJECT-A');
  expect(response.status).toBe(401);
  const body = await response.json();
  expect(body.error.invalidate_access).toBe(true);
  expect(JSON.stringify(body)).not.toContain(privateText);
});

for (const hosted of [false, true]) {
  test(`account-own projection is read exactly once in ${hosted ? 'H1' : 'local'} transport`, async () => {
    const fixture = harness(hosted);
    expect((await fixture.call('v1/me')).status).toBe(200);
    expect(fixture.state.meReads).toBe(1);
    expect(fixture.state.contentReads).toBe(0);
  });
}

test('unrelated operations and own access-request do not acquire a content scope dependency', async () => {
  const fixture = harness();
  fixture.state.account.content_scope!.expires_at = new Date(fixture.state.now - 1).toISOString();
  expect((await fixture.call('v1/admin/ads/settings')).status).toBe(200);
  expect((await fixture.call('v1/me/access-request', 'POST', { reason: 'Synthetic request' })).status).toBe(200);
  expect(fixture.state.meReads).toBe(0);
});

test('unclassified paths and extra queries fail before resource or authority reads', async () => {
  const fixture = harness();
  expect((await fixture.call('v1/admin/content/unmapped')).status).toBe(404);
  expect((await fixture.call('v1/admin/projects/PROJECT-A?unmapped=1')).status).toBe(404);
  expect(fixture.state.meReads).toBe(0);
  expect(fixture.state.contentReads).toBe(0);
});

for (const partial of [true, false]) {
  test(`assistant ${partial ? 'partial frame' : 'queued next frame'} is discarded after scope changes`, async () => {
    const fixture = harness();
    let source!: ReadableStreamDefaultController<Uint8Array>, cancelled = false;
    fixture.state.resource = () => new Response(new ReadableStream<Uint8Array>({ start(controller) { source = controller; }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    const response = await fixture.call('v1/admin/assistant/runs', 'POST', { message: 'Synthetic prompt' });
    const reader = response.body!.getReader();
    const encode = (value: string) => new TextEncoder().encode(value);
    if (!partial) {
      source.enqueue(encode('event: status\ndata: {"state":"running"}\n\n'));
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: status');
    }
    const waiting = reader.read();
    source.enqueue(encode(`event: answer_delta\ndata: {"text":"${privateText}"}`));
    fixture.state.account.content_scope!.fingerprint = 'scope-two';
    source.enqueue(encode('\r\n\r\n'));
    const received = new TextDecoder().decode((await waiting).value);
    expect(received).toMatch(/^event: error\n/);
    expect(received).toContain('"invalidate_access":true');
    expect(received).not.toContain(privateText);
    expect((await reader.read()).done).toBe(true);
    await expect.poll(() => cancelled).toBe(true);
  });
}

test('allowed assistant frames preserve frame boundaries and complete normally', async () => {
  const fixture = harness();
  const text = 'event: answer_delta\ndata: {"text":"allowed-neighbour"}\n\nevent: done\ndata: {}\n\n';
  fixture.state.resource = () => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
  const response = await fixture.call('v1/admin/assistant/runs', 'POST', { message: 'Synthetic prompt' });
  expect(await response.text()).toBe(text);
  expect(fixture.state.meReads).toBe(3);
});
