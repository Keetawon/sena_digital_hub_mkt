import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';
import {PROVIDER_KEY_NAMES,scrubProviderKeys} from '../scripts/provider-keys.mjs';

test('every per-agent provider key is removed from test child environments',()=>{
  const env=Object.fromEntries(PROVIDER_KEY_NAMES.map(name=>[name,'synthetic-private-test-value']));
  env.FUTURE_OPENAI_API_KEY='synthetic-future-value';env.UNRELATED='keep';
  assert.deepEqual(scrubProviderKeys(env),{UNRELATED:'keep'});
});

test('direct test execution refuses a missing disposable marker before connecting',()=>{
  const env={...process.env};delete env.HUB_DISPOSABLE_TEST_RUN;
  const result=spawnSync(process.execPath,['scripts/test-db.mjs'],{env,encoding:'utf8',windowsHide:true});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Tests require a disposable database/);
  assert.doesNotMatch(result.stderr,/ECONNREFUSED|password/);
});

test('a running database is never reused, even when a caller supplies a test flag',async()=>{
  const probe=createServer();let owned=false;
  await new Promise((resolve,reject)=>{
    probe.once('error',error=>error.code==='EADDRINUSE'?resolve():reject(error));
    probe.listen(55432,'127.0.0.1',()=>{owned=true;resolve();});
  });
  try{
    const result=spawnSync(process.execPath,['scripts/run-disposable-tests.mjs','api'],{env:{...process.env,HUB_DISPOSABLE_TEST_RUN:'forged'},encoding:'utf8',windowsHide:true});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Port 55432 is in use/);
    assert.doesNotMatch(result.stdout,/Applied|Loaded/);
  }finally{if(owned)await new Promise(resolve=>probe.close(resolve));}
});
