import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import {readdir,mkdtemp,realpath,symlink,lstat,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {PROVIDER_KEY_NAMES,scrubProviderKeys} from '../scripts/provider-keys.mjs';
import {apiTestArguments} from '../scripts/api-test-selection.mjs';

const tests=path.resolve('apps/api/tests'),file=path.resolve(tests,'test_naming.py');
test('API selection defaults to the full test directory',()=>{
  assert.deepEqual(apiTestArguments([]),[tests]);
});
test('an explicit API test file replaces the default directory and is resolved',()=>{
  assert.deepEqual(apiTestArguments(['apps/api/tests/test_naming.py']),[file]);
  assert.deepEqual(apiTestArguments(['-x',file]),['-x',file]);
});
test('an API node id replaces the default directory and keeps its selector',()=>{
  assert.deepEqual(apiTestArguments(['apps/api/tests/test_naming.py::test_x']),[file+'::test_x']);
});
test('-k and other option operands retain the default directory',()=>{
  assert.deepEqual(apiTestArguments(['-k','permission and not inactive','-x']),[tests,'-k','permission and not inactive','-x']);
  assert.deepEqual(apiTestArguments(['--tb','short','-o','cache_dir=.local/cache']),[tests,'--tb','short','-o','cache_dir=.local/cache']);
});
test('all explicit paths are bounded, including node ids and traversal',()=>{
  for(const outside of ['../outside.py','apps/api/tests/../../../scripts/test-db.mjs','apps/api/tests-other/test_x.py',path.resolve('scripts/test-db.mjs')+'::test_x']){
    assert.throws(()=>apiTestArguments(['apps/api/tests/test_naming.py',outside]),/outside apps\/api\/tests/);
  }
});
test('outside API paths are refused by the real entry point before database creation',()=>{
  const runs=()=>readdir('.local/test-runs').catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  return (async()=>{
    const before=await runs();
    for(const outside of ['../outside.py','apps/api/tests/../../../scripts/test-db.mjs']){
      const result=spawnSync(process.execPath,['scripts/run-disposable-tests.mjs','api',outside],{encoding:'utf8',windowsHide:true});
      assert.notEqual(result.status,0);assert.match(result.stderr,/outside apps\/api\/tests; refused before database setup/);
      assert.doesNotMatch(result.stdout,/Applied|Loaded|PASS:/);
    }
    assert.deepEqual(await runs(),before);
  })();
});

test('every per-agent provider key is removed from test child environments',()=>{
  const env=Object.fromEntries(PROVIDER_KEY_NAMES.map(name=>[name,'synthetic-private-test-value']));
  env.FUTURE_OPENAI_API_KEY='synthetic-future-value';env.UNRELATED='keep';
  assert.deepEqual(scrubProviderKeys(env),{UNRELATED:'keep'});
});

test('aliased runner paths and Windows drive-letter case refuse before database setup',async t=>{
  const repo=await realpath('.'),temporary=await mkdtemp(path.join(await realpath(tmpdir()),'sena-runner-alias-'));
  const link=path.join(temporary,'repo'),runs=()=>readdir('.local/test-runs').catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  const refused=async(label,runner)=>{
    const before=await runs();
    const result=spawnSync(process.execPath,[runner,'api','../outside.py'],{cwd:repo,encoding:'utf8',windowsHide:true});
    assert.equal(result.error,undefined);assert.notEqual(result.status,0);
    assert.match(result.stderr,/outside apps\/api\/tests; refused before database setup/);
    assert.doesNotMatch(result.stdout+result.stderr,/Applied|Loaded|PASS:/);
    assert.deepEqual(await runs(),before);
    t.diagnostic(`${label}: exit ${result.status}; ${result.stderr.match(/^Error: API test path.*$/m)[0]}`);
  };
  try{
    const relative=path.relative(repo,temporary);
    assert.ok(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'Alias temporary directory must be outside the repo');
    await symlink(repo,link,process.platform==='win32'?'junction':'dir');
    await refused(process.platform==='win32'?'directory junction':'directory symlink',path.join(link,'scripts/run-disposable-tests.mjs'));
    if(process.platform==='win32'){
      const runner=path.join(repo,'scripts/run-disposable-tests.mjs');assert.match(runner,/^[A-Za-z]:/);
      const drive=runner[0]===runner[0].toUpperCase()?runner[0].toLowerCase():runner[0].toUpperCase();
      await refused('swapped drive-letter case',drive+runner.slice(1));
    }
  }finally{
    try{
      const info=await lstat(link).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(info){
        assert.ok(info.isSymbolicLink());
        // Remove only the link, never traverse its repository target.
        if(process.platform==='win32')await rmdir(link);else await unlink(link);
      }
    }finally{await rmdir(temporary);}
  }
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
