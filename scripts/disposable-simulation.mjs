import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function isSimulationConnection(db) {
  const c=db.connectionParameters??db.options;
  return c?.host==='127.0.0.1' && Number.isInteger(Number(c.port)) && Number(c.port)>=1024
    && Number(c.port)<=65535 && Number(c.port)!==55432 && c.database==='hub_hosted_test_simulation';
}

export async function assertSimulationDatabase(db,{checkDataDirectory=false}={}) {
  assert.ok(isSimulationConnection(db),'Disposable H1 loopback connection required');
  const c=db.connectionParameters??db.options;
  const actual=(await db.query('select host(inet_server_addr()) host,inet_server_port() port,current_database() name')).rows[0];
  assert.equal(actual.host,'127.0.0.1');assert.equal(actual.port,Number(c.port));assert.equal(actual.name,c.database);
  const marker=(await db.query('select run_id,data_directory from public.disposable_test_run')).rows;
  assert.equal(marker.length,1,'Disposable H1 marker required');
  const base=await realpath(fileURLToPath(new URL('../.local/hosted-test-simulation',import.meta.url)));
  const directory=await realpath(marker[0].data_directory);
  assert.equal(path.dirname(directory),base);assert.ok(path.basename(directory).startsWith('run-'));
  const file=JSON.parse(await readFile(path.join(directory,'run.json'),'utf8'));
  assert.equal(marker[0].run_id,file.run_id,'Stale disposable H1 marker');
  if(checkDataDirectory)assert.equal(await realpath((await db.query('show data_directory')).rows[0].data_directory),directory);
}
