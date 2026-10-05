// Shared by every test entry point before it can write local fixtures.
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function assertDisposableTestDatabase() {
  const run=process.env.HUB_DISPOSABLE_TEST_RUN;
  assert.ok(run,'Tests require a disposable database. Use npm run test:api, test:db or test:ui.');
  const base=await realpath(path.join(root,'.local/test-runs'));
  const directory=await realpath(run);
  assert.ok(directory.startsWith(base+path.sep),'Test run must be inside .local/test-runs');
  const marker=JSON.parse(await readFile(path.join(directory,'run.json'),'utf8'));
  const config=JSON.parse(await readFile(path.join(root,'.local/development.json'),'utf8'));
  const db=new pg.Client({host:'127.0.0.1',port:55432,database:'sena_hub_local',user:'postgres',password:config.adminPassword});
  try {
    await db.connect();
    assert.equal(await realpath((await db.query('SHOW data_directory')).rows[0].data_directory),await realpath(path.join(directory,'postgres')),'Refusing the working database');
    assert.equal((await db.query('SELECT run_id FROM public.disposable_test_run')).rows[0]?.run_id,marker.run_id,'Stale disposable test marker');
  } finally {await db.end();}
  return directory;
}
