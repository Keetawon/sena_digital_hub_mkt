import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Execute the real dev entry point in isolation. Credentials exist only in
// memory; intercept credential-file writes before they reach the workspace or OS temp.
async function probe(initialised) {
  const assert = (await import('node:assert/strict')).default;
  const fs = (await import('node:fs/promises')).default;
  const childProcess = (await import('node:child_process')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { EventEmitter } = await import('node:events');
  const { randomBytes } = await import('node:crypto');
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const password = randomBytes(24).toString('hex');
  const config = { adminPassword: password };
  for (const key of ['adminToken', 'onlineStaffToken', 'agencyKinToken', 'agencyCombayToken', 'uatAdminToken', 'uatSuspendedToken', 'uatSomchaiToken']) config[key] = randomBytes(32).toString('hex');
  const missing = () => Object.assign(new Error('Synthetic missing file'), { code: 'ENOENT' });
  const readFile = fs.readFile;
  fs.readFile = async (file, ...args) => {
    if (String(file).endsWith('development.json')) return JSON.stringify(config);
    if (/\.env(?:\.local)?$/.test(String(file))) throw missing();
    return readFile(file, ...args);
  };
  fs.access = async file => { if (String(file).endsWith('PG_VERSION') && !initialised) throw missing(); };
  fs.mkdir = async () => {};
  let writes = 0, spawns = 0, starts = 0;
  fs.writeFile = fs.appendFile = async () => { writes++; throw new Error('Filesystem write forbidden in initializer probe'); };
  childProcess.spawn = (file, args, options) => {
    spawns++;
    assert.match(file, /initdb(?:\.exe)?$/);
    assert.ok(args.includes('-W'), 'initdb must prompt through stdin');
    assert.ok(!args.some(arg => arg.includes(password) || arg.includes('pwfile')), 'No password or password-file argument');
    assert.deepEqual(options.stdio, ['pipe', 'ignore', 'ignore']);
    assert.equal(options.windowsHide, true);
    const child = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.end = input => {
      assert.ok(input === `${password}\n${password}\n`, 'Both initdb prompts must receive the in-memory credential');
      queueMicrotask(() => child.emit('close', 0));
    };
    return child;
  };
  syncBuiltinESMExports();
  EmbeddedPostgres.prototype.initialise = async () => { throw new Error('File-based initializer forbidden'); };
  EmbeddedPostgres.prototype.start = async () => { starts++; throw new Error('Probe stops before starting PostgreSQL'); };
  EmbeddedPostgres.prototype.stop = async () => {};
  const messages = []; console.log = console.error = (...args) => messages.push(args.join(' '));
  await import('../scripts/local-db.mjs');
  assert.equal(writes, 0, 'No temporary credential file may be written');
  assert.equal(spawns, initialised ? 0 : 1, 'Only a new data directory needs initdb');
  assert.equal(starts, 1, 'Both paths must retain pg.start()');
  assert.ok(!messages.some(message => message.includes(password)), 'No credential may be logged');
}

for (const initialised of [false, true]) {
  test(`local DB ${initialised ? 'preserves an initialized directory' : 'initializes through stdin'} without a password file`, () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `(${probe.toString()})(${initialised}).then(()=>process.exit(0),()=>process.exit(1));`],
      { cwd: new URL('.', import.meta.url), encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, 'Isolated initializer probe must pass without real filesystem writes or service startup');
  });
}
