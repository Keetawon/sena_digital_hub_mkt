import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:3000';
const base = '/api/hub/v1/admin/assistant';
const project = 'PROJECT-SCOPE-RACE';
const run = '65000000-0000-4000-8000-000000000071';
const citation = '65000000-0000-4000-8000-000000000072';
const sourceText = 'Synthetic previously permitted source';
const authored = 'My unsaved authored draft';
const unsent = 'My unsent question';

function gate() {
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { entered = resolve; });
  return { release, entered, waiting, requested };
}

function frame(event: string, value: object) {
  return `event: ${event}\ndata: ${JSON.stringify({ run_id: run, ...value })}\n\n`;
}

const answer = (text = sourceText) => frame('citation', { id: citation, label_th: 'Synthetic saved citation' })
  + frame('answer_delta', { block_id: 'source', text, metadata: { visibility: 'DRAFT', version: 'saved-v1' }, citation_ids: [citation] });
const complete = frame('done', { status: 'DONE', provider: 'fake', usage: {} });

async function fixture(page: Page) {
  expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role: 'editor' } })).ok()).toBeTruthy();
  const accountResponse = await page.request.get('/api/hub/v1/me');
  expect(accountResponse.ok()).toBeTruthy();
  const me = (await accountResponse.json()).data;
  let account = me;
  let configCalls = 0;
  const config = { session_key: 'scope-before', scope_expires_at: null as string | null, mode: 'fake',
    live_available: false, allowed_tools: ['get_project'], proposal_fields: { project: ['meta_title.th'] } as Record<string, string[]>,
    live_questions: [], message_th: 'Synthetic current configuration' };
  const held = new Map<string, ReturnType<typeof gate>>();
  const hold = (kind: string) => { const pending = gate(); held.set(kind, pending); return pending; };
  async function wait(kind: string) {
    const pending = held.get(kind);
    if (pending) { held.delete(kind); pending.entered(); await pending.waiting; }
  }
  const proposal = { id: '65000000-0000-4000-8000-000000000073', entity_type: 'project',
    entity_id: '65000000-0000-4000-8000-000000000074', field_path: 'meta_title.th',
    old_text: sourceText, new_text: authored, expected_updated_at: '2026-11-05T00:00:00Z', status: 'PROPOSED', digest: 'a'.repeat(64) };
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: structuredClone(account) } }));
  await page.route(`**/api/hub/v1/admin/projects/${project}`, async route => {
    const data = { id: proposal.entity_id, public_project_id: project, updated_at: proposal.expected_updated_at,
      meta_title: { th: sourceText }, demo_fields: ['meta_title.th'] };
    await wait('source');
    await route.fulfill({ json: { data } });
  });
  await page.route('**/api/hub/v1/admin/assistant/**', async route => {
    const path = new URL(route.request().url()).pathname.slice(base.length);
    if (path === '/config') {
      configCalls++;
      const data = structuredClone(config);
      await wait('config');
      return route.fulfill({ json: { data } });
    }
    if (path === '/runs') return route.fulfill({ contentType: 'text/event-stream', body: frame('status', { state: 'running' }) + answer() + complete });
    if (path.endsWith('/cancel')) return route.fulfill({ json: { data: { status: 'CANCELLED' } } });
    if (path.includes('/citations/')) {
      await wait('citation');
      return route.fulfill({ json: { data: { source_href: `/website/project/${project}?tab=data`, metadata: { visibility: 'DRAFT', version: 'saved-v1' } } } });
    }
    if (path === '/proposals' || path === '/proposals/suggest') {
      await wait(path === '/proposals' ? 'proposal' : 'suggest');
      return route.fulfill({ json: { data: structuredClone(proposal) } });
    }
    if (path.endsWith('/confirm')) {
      await wait('confirm');
      return route.fulfill({ json: { data: { proposal: { ...proposal, status: 'APPLIED' } } } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'synthetic_missing' } } });
  });
  return {
    config, hold, calls: () => configCalls,
    revoke: () => { config.session_key = 'scope-after'; config.allowed_tools = []; config.proposal_fields = {}; },
    changeScope: () => { account = { ...me, content_scope: { fingerprint: 'scope-with-same-base-grants', expires_at: null } }; },
  };
}

async function open(page: Page) {
  await page.goto(`/questions?project=${project}&assistant=open`);
  await expect(page.locator('.assistant-panel')).toBeVisible();
  return page.locator('.assistant-panel');
}

async function refresh(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('hub-accounts-changed')));
}

async function draft(page: Page) {
  const panel = page.locator('.assistant-panel');
  await panel.locator('#assistant-question').fill(unsent);
  await panel.locator('#assistant-tab-draft').click();
  await panel.locator('.assistant-proposal > button').click();
  await expect(panel.locator('.assistant-proposal')).toContainText(sourceText);
  await panel.locator('#assistant-draft-new').fill(authored);
  await panel.locator('#assistant-draft-reason').fill('My authored reason');
  return panel;
}

async function preserved(panel: ReturnType<Page['locator']>) {
  await expect(panel.locator('.assistant-answer')).toHaveCount(0);
  await expect(panel).not.toContainText(sourceText);
  const recovery = panel.locator('details:has(textarea[readonly])');
  await recovery.locator('summary').click();
  await expect(recovery.locator('textarea').nth(0)).toHaveValue(authored);
  await expect(recovery.locator('textarea').nth(1)).toHaveValue('My authored reason');
  await panel.locator('#assistant-tab-chat').click();
  await expect(panel.locator('#assistant-question')).toHaveValue(unsent);
}

test('refresh requested during config await rejects the old completion and performs the queued refresh', async ({ page }) => {
  const state = await fixture(page);
  const pending = state.hold('config');
  const panel = await open(page);
  await pending.requested;
  state.config.session_key = 'scope-newer-config';
  state.config.message_th = 'Synthetic newer configuration';
  await refresh(page);
  pending.release();
  await expect.poll(state.calls).toBeGreaterThanOrEqual(2);
  await expect(panel.locator('.assistant-about')).toContainText('Synthetic newer configuration');
  await expect(panel.locator('.assistant-about')).not.toContainText('Synthetic current configuration');
  await expect(panel.locator('#assistant-question')).toBeEditable();
});

test('late source reload cannot restore revoked text and preserves authored drafts and question', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  const panel = await draft(page);
  const pending = state.hold('source');
  await panel.locator('.assistant-proposal > button').click();
  await pending.requested;
  state.revoke(); await refresh(page);
  await expect(panel.locator('.assistant-proposal')).toHaveCount(0);
  pending.release();
  await preserved(panel);
});

for (const kind of ['proposal', 'suggest', 'confirm'] as const) {
  test(`late ${kind} response cannot restore a revoked before/after pane`, async ({ page }) => {
    const state = await fixture(page);
    await open(page);
    const panel = await draft(page);
    if (kind === 'confirm') {
      await panel.locator('.assistant-proposal form button[type=submit]').click();
      await expect(panel.locator('.assistant-diff')).toBeVisible();
    }
    const pending = state.hold(kind);
    if (kind === 'proposal') await panel.locator('.assistant-proposal form button[type=submit]').click();
    else if (kind === 'suggest') await panel.locator('.assistant-proposal form button[type=button]').click();
    else await panel.locator('.assistant-proposal > section button').click();
    await pending.requested;
    state.revoke(); await refresh(page);
    await expect(panel.locator('.assistant-proposal')).toHaveCount(0);
    pending.release();
    await preserved(panel);
  });
}

test('late citation response cannot restore a revoked source link', async ({ page }) => {
  const state = await fixture(page);
  const panel = await open(page);
  await panel.locator('#assistant-question').fill('Synthetic query');
  await panel.locator('.assistant-composer button[type=submit]').click();
  await expect(panel.locator('.assistant-answer')).toHaveText(sourceText);
  const pending = state.hold('citation');
  await panel.locator('.assistant-citations button').click();
  await pending.requested;
  state.revoke(); await refresh(page);
  await expect(panel.locator('.assistant-answer')).toHaveCount(0);
  pending.release();
  await expect(panel.locator('.assistant-citation-link')).toHaveCount(0);
});

test('scope deadline clears evidence immediately while the fresh config request is still pending', async ({ page }) => {
  const epoch = new Date('2026-11-05T03:00:00Z');
  await page.clock.install({ time: epoch });
  await page.clock.pauseAt(epoch);
  const state = await fixture(page);
  state.config.scope_expires_at = new Date(epoch.getTime() + 5_000).toISOString();
  const panel = await open(page);
  await panel.locator('#assistant-question').fill('Synthetic query');
  await panel.locator('.assistant-composer button[type=submit]').click();
  await expect(panel.locator('.assistant-answer')).toHaveText(sourceText);
  await panel.locator('#assistant-question').fill(unsent);
  state.revoke(); state.config.scope_expires_at = null;
  const pending = state.hold('config');
  await page.clock.fastForward(6_000);
  await pending.requested;
  await expect(panel.locator('.assistant-answer')).toHaveCount(0);
  await expect(panel.locator('#assistant-question')).toHaveValue(unsent);
  pending.release();
  await expect(panel.locator('#assistant-question')).toBeEditable();
});

test('same base grants with a changed scope fingerprint clear the mounted source view', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  const panel = await draft(page);
  state.changeScope();
  await refresh(page);
  await expect(panel).not.toContainText(sourceText);
  await expect(panel.locator('.assistant-diff')).toHaveCount(0);
  await expect(panel.locator('#assistant-question')).toHaveValue(unsent);
});

type StreamHarness = Window & { scopeStreams: ReadableStreamDefaultController<Uint8Array>[] };
async function bufferedStreams(page: Page) {
  await page.addInitScript(() => {
    const current = window as unknown as StreamHarness;
    current.scopeStreams = [];
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === '/api/hub/v1/admin/assistant/runs' && init?.method === 'POST') {
        // Deliberately ignore abort for this response to exercise a buffered
        // completion that arrives after the client has changed authority.
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { current.scopeStreams.push(controller); } }),
          { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return original(input, init);
    };
  });
}

async function push(page: Page, text: string, index = 0, close = false) {
  await page.evaluate(({ text, index, close }) => {
    const controller = (window as unknown as StreamHarness).scopeStreams[index];
    controller.enqueue(new TextEncoder().encode(text));
    if (close) controller.close();
  }, { text, index, close });
}

test('old buffered stream frames cannot restore answers or clear the newer unsent question', async ({ page }) => {
  await bufferedStreams(page);
  const state = await fixture(page);
  const panel = await open(page);
  await panel.locator('#assistant-question').fill('Original request');
  await panel.locator('.assistant-composer button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as StreamHarness).scopeStreams.length)).toBe(1);
  await push(page, frame('status', { state: 'running' }));
  state.config.session_key = 'scope-after';
  await refresh(page);
  await expect(panel.locator('#assistant-question')).toBeEditable();
  await panel.locator('#assistant-question').fill(unsent);
  await push(page, answer() + complete, 0, true);
  await expect(panel.locator('.assistant-answer')).toHaveCount(0);
  await expect(panel.locator('#assistant-question')).toHaveValue(unsent);
  // An allowed neighbour with the new identity still completes normally.
  await panel.locator('.assistant-composer button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as StreamHarness).scopeStreams.length)).toBe(2);
  await push(page, answer('Synthetic currently permitted neighbour') + complete, 1, true);
  await expect(panel.locator('.assistant-answer')).toHaveText('Synthetic currently permitted neighbour');
});

test('server invalidation frame clears already displayed source data and keeps unsent input', async ({ page }) => {
  await bufferedStreams(page);
  await fixture(page);
  const panel = await open(page);
  await panel.locator('#assistant-question').fill(unsent);
  await panel.locator('.assistant-composer button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as StreamHarness).scopeStreams.length)).toBe(1);
  await push(page, answer());
  await expect(panel.locator('.assistant-answer')).toHaveText(sourceText);
  await push(page, frame('error', { code: 'assistant_permissions_changed', invalidate_access: true })
    + answer('Synthetic denied buffered tail') + complete, 0, true);
  await expect(panel.locator('.assistant-answer')).toHaveCount(0);
  await expect(panel.locator('.assistant-citation-link')).toHaveCount(0);
  await expect(panel.locator('#assistant-question')).toHaveValue(unsent);
});
