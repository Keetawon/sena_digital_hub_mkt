import { uploadFileError, uploadContextHeader } from "../../apps/admin/lib/upload-context";
import { retryBusyUpload } from "../../apps/admin/lib/upload-retry";
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { Node, SourceFile, FunctionDeclaration, CallExpression } from '../../apps/admin/node_modules/typescript';

const requireAdmin = createRequire(resolve('apps/admin/package.json'));
const ts = requireAdmin('typescript') as typeof import('../../apps/admin/node_modules/typescript');
const sourceText = 'Synthetic denied source must not be delivered';
const failureMessage = 'Synthetic current authority denial';
type Caller = 'home' | 'knowledge' | 'commercial' | 'asset';
type Outcome = 'invalidated' | 'ordinary' | 'false-flag' | 'string-flag' | 'success';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

function find<T extends Node>(root: Node, matches: (node: Node) => node is T): T {
  const found: T[] = [];
  function visit(node: Node) { if (matches(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(root);
  if (found.length !== 1) throw new Error(`Expected one actual source callback, found ${found.length}`);
  return found[0];
}

function functionNode(source: SourceFile | Node, name: string) {
  return find(source, (node): node is FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
}

function actualCode(caller: Caller | 'asset-dialog') {
  const paths = { home: 'workspace-home', knowledge: 'knowledge-review', commercial: 'commercial-types', asset: 'project-assets', 'asset-dialog': 'project-assets' };
  const path = `apps/admin/components/${paths[caller]}.tsx`;
  const source = ts.createSourceFile(path, readFileSync(resolve(path), 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  if (caller === 'home') {
    const owner = functionNode(source, 'HomeContent');
    const effect = find(owner, (node): node is CallExpression => ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
      && node.arguments[0]?.getText(source).includes('/api/hub/v1/admin/content/home?'));
    return `exports.execute = ${effect.arguments[0].getText(source)};`;
  }
  const owner = caller === 'commercial' ? functionNode(source, 'CommercialMedia') : caller === 'asset-dialog' ? functionNode(source, 'UploadDialog') : source;
  const name = caller === 'knowledge' ? 'api' : caller === 'asset' ? 'uploadAsset' : 'upload';
  // Execute the real production callback, including its catch/finally logic.
  // This avoids rendering unrelated editors or copying transport behavior.
  return `${functionNode(owner, name).getText(source).replace(/^export /, '')}\nexports.execute = ${name};`;
}

function compile(code: string, globals: Record<string, unknown>) {
  const module = { exports: {} as { execute: (...args: unknown[]) => unknown } };
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  Object.assign(globals, { module, exports: module.exports, AbortController, Event, Error });
  runInNewContext(output, globals);
  return module.exports.execute;
}

function harness(caller: Caller, files = [new File(['synthetic'], 'allowed.png', { type: 'image/png' })]) {
  const terminal = gate();
  const state = { events: [] as Event[], data: null as unknown, error: '', selected: files, pending: false, libraryLoads: 0,
    calls: [] as { path: string; init?: RequestInit }[], response: Response.json({ data: { id: 'allowed-asset', text: 'Allowed neighbour' }, meta: { reused: true } }) };
  const globals: Record<string, unknown> = {
    uploadFileError, uploadContextHeader, uploadContext: { v: 1, kind: "intake" }, setUploadResults() {},
    retryBusyUpload, setUploadWaiting() {},
    query: 'limit=10', disabled: false, workflowBusy: false, pending: false, canEdit: true, files, fileRef: { current: { value: 'selected-files' } },
    window: { dispatchEvent(event: Event) { state.events.push(event); } },
    setData(value: unknown) { state.data = value; if (value !== null) terminal.release(); },
    setError(value: string | boolean) { state.error = String(value); if (value) terminal.release(); },
    setPending(value: boolean) { state.pending = value; globals.pending = value; },
    setNotice() {}, setFiles(value: File[]) { state.selected = value; globals.files = value; },
    loadLibrary: async () => { state.libraryLoads++; },
  };
  const requested = gate();
  const transport = async (path: string, init?: RequestInit) => {
    state.calls.push({ path, init }); requested.release(); return state.response;
  };
  globals.fetch = transport; globals.assetFetch = transport;
  if (caller === "commercial") globals.uploadAsset = compile(actualCode("asset"), globals);
  const execute = compile(actualCode(caller), globals);
  let cleanup: (() => void) | undefined;
  function start(): Promise<unknown> {
    if (caller === 'home') { cleanup = execute() as () => void; return terminal.promise.then(() => state.data); }
    return Promise.resolve(caller === 'knowledge' ? execute('projects/PROJECT-A') : caller === 'asset' ? execute(files[0], { v: 1, kind: 'intake' }) : execute({ preventDefault() {} }));
  }
  return { state, globals, requested: requested.promise, start, cancel: () => cleanup?.() };
}

function delayed(outcome: Outcome) {
  const release = gate();
  const flag = outcome === 'invalidated' ? true : outcome === 'false-flag' ? false : outcome === 'string-flag' ? 'true' : undefined;
  const data = { id: 'allowed-asset', text: outcome === 'success' ? 'Allowed neighbour' : sourceText };
  const body = outcome === 'success' ? { data, meta: { reused: true } } : { data, error: { code: 'synthetic_denial', message: failureMessage, ...(flag === undefined ? {} : { invalidate_access: flag }) } };
  return { release: release.release, data, response: new Response(new ReadableStream<Uint8Array>({ async start(controller) {
    await release.promise; controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close();
  } }), { status: outcome === 'success' ? 200 : 403, headers: { 'Content-Type': 'application/json' } }) };
}

for (const caller of ['home', 'knowledge', 'commercial', 'asset'] as const) {
  for (const outcome of ['invalidated', 'ordinary', 'false-flag', 'string-flag', 'success'] as const) {
    test(`${caller}: delayed ${outcome} body emits only the explicit authority-loss signal`, async () => {
      const fixture = harness(caller), body = delayed(outcome);
      fixture.state.response = body.response;
      const result = fixture.start().then(value => ({ value, error: null }), error => ({ value: null, error }));
      await fixture.requested;
      expect(fixture.state.events).toHaveLength(0);
      expect(fixture.state.data).toBeNull();
      body.release();
      const completed = await result;
      expect(fixture.state.events).toHaveLength(outcome === 'invalidated' ? 1 : 0);
      for (const event of fixture.state.events) {
        expect(event.type).toBe('hub-content-access-invalidated');
        expect('detail' in event).toBe(false);
        expect(Object.keys(event)).toEqual([]);
      }
      if (outcome === 'success') {
        if (caller === 'home' || caller === 'knowledge') expect(completed.value).toEqual(body.data);
        if (caller === 'asset') expect(completed.value).toEqual({ asset: body.data, reused: true, upload: null });
        if (caller === 'commercial') { expect(fixture.state.selected).toEqual([]); expect(fixture.state.libraryLoads).toBe(1); }
      } else {
        expect(fixture.state.data).toBeNull();
        if (caller === 'home') expect(fixture.state.error).toBe('true');
        if (caller === 'knowledge' || caller === 'asset') expect(completed.error).toMatchObject({ message: failureMessage });
        if (caller === 'commercial') {
          expect(fixture.state.error).toContain(failureMessage);
          expect(fixture.state.selected.map(file => file.name)).toEqual(['allowed.png']);
          expect(fixture.state.libraryLoads).toBe(0);
          expect(fixture.state.pending).toBe(false);
        }
      }
      expect(fixture.state.calls).toHaveLength(1); // No implicit retry after invalidation.
      fixture.cancel();
    });
  }
}

test('an abandoned home request cannot invalidate a newer page when its old body finishes', async () => {
  const fixture = harness('home'), body = delayed('invalidated');
  fixture.state.response = body.response;
  void fixture.start(); await fixture.requested;
  fixture.cancel(); body.release();
  // The real response JSON finishes; the source callback sees its aborted signal.
  await expect.poll(() => body.response.bodyUsed).toBe(true);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(fixture.state.events).toHaveLength(0);
  expect(fixture.state.data).toBeNull();
});

test('commercial upload preserves only unfinished files after an ordinary partial failure and retries them explicitly', async () => {
  const files = ['first.png', 'second.png', 'third.png'].map(name => new File(['synthetic'], name, { type: 'image/png' }));
  const fixture = harness('commercial', files);
  let attempt = 0;
  fixture.globals.assetFetch = async (_path: string, init: RequestInit) => {
    fixture.state.calls.push({ path: _path, init }); attempt++;
    return attempt === 2 ? Response.json({ error: { message: 'Synthetic ordinary failure' } }, { status: 403 }) : Response.json({ data: { id: `asset-${attempt}` } });
  };
  await fixture.start();
  expect(fixture.state.events).toHaveLength(0);
  expect(fixture.state.selected).toEqual(files.slice(1));
  expect(fixture.state.libraryLoads).toBe(0);
  expect(fixture.state.calls).toHaveLength(2);
  await fixture.start();
  expect(fixture.state.calls.map(call => (call.init!.body as File).name)).toEqual(['first.png', 'second.png', 'second.png', 'third.png']);
  expect(fixture.state.selected).toEqual([]);
  expect(fixture.state.libraryLoads).toBe(1);
});

test('commercial authority denial stops the batch and never automatically retries the remaining files', async () => {
  const files = ['first.png', 'second.png', 'third.png'].map(name => new File(['synthetic'], name, { type: 'image/png' }));
  const fixture = harness('commercial', files);
  let attempt = 0;
  fixture.globals.assetFetch = async (path: string, init: RequestInit) => {
    fixture.state.calls.push({ path, init }); attempt++;
    return attempt === 1 ? Response.json({ data: { id: 'first-asset' } }) : Response.json({ error: { message: failureMessage, invalidate_access: true } }, { status: 403 });
  };
  await fixture.start();
  expect(fixture.state.events).toHaveLength(1);
  expect(fixture.state.calls).toHaveLength(2);
  expect(fixture.state.selected).toEqual(files.slice(1));
  expect(fixture.state.libraryLoads).toBe(0);
});

test('single-file dialog retains the selected file on an ordinary failure and only invokes completion on explicit retry', async () => {
  const file = new File(['synthetic'], 'retry.png', { type: 'image/png' });
  const state = { calls: 0, completed: 0, pending: false, error: '' };
  const execute = compile(actualCode('asset-dialog'), {
    file, purpose: undefined, context: { v: 1, kind: "intake" }, uploadFileError, acceptedTypes: ['image/png'], maxFileSize: 10 * 1024 * 1024,
    setWaiting() {},
    setError(value: string) { state.error = value; }, setPending(value: boolean) { state.pending = value; },
    uploadAsset: async (selected: File) => { expect(selected).toBe(file); state.calls++; if (state.calls === 1) throw new Error('Synthetic ordinary failure'); return { asset: { id: 'allowed' }, reused: true }; },
    onUploaded: async () => { state.completed++; },
  });
  await execute({ preventDefault() {} });
  expect(state.completed).toBe(0); expect(state.pending).toBe(false); expect(state.error).toBe('Synthetic ordinary failure');
  await execute({ preventDefault() {} });
  expect(state.calls).toBe(2); expect(state.completed).toBe(1);
});
