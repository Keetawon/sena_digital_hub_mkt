import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

await assertDisposableTestDatabase();
const python = process.platform === 'win32' ? 'apps/api/.venv/Scripts/python.exe' : 'apps/api/.venv/bin/python';
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: [path.resolve('apps/api'), path.resolve('apps/api/tests'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) };
const result = await promisify(execFile)(python, ['-B', '-c', 'import asyncio; from test_content_scopes import concurrency_scenarios; asyncio.run(concurrency_scenarios())'], { env, windowsHide: true, maxBuffer: 1024 * 1024 });
if (result.stdout) process.stdout.write(result.stdout);
console.log('PASS: scope confirmation serializes with source writes and a waiting read observes the committed restriction');
