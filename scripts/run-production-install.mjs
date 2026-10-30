// A fresh, frozen production environment; never sync the developer's .venv.
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const parent=path.join(root,'.local','production-checks');
await mkdir(parent,{recursive:true});
const directory=await mkdtemp(path.join(parent,'run-'));
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|COMSPEC|PROCESSOR_ARCHITECTURE)$/i.test(key)));
Object.assign(env,{PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',UV_NO_ENV_FILE:'1',UV_CACHE_DIR:path.join(root,'.cache','uv')});
function run(command,args){
  const r=spawnSync(command,args,{cwd:directory,env,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});
  // This process has only synthetic settings, no service credentials.
  if(r.stdout)process.stdout.write(r.stdout);
  if(r.stderr)process.stderr.write(r.stderr);
  assert.equal(r.status,0,'Production install/import check failed');
}
try{
  for(const file of ['apps/api/pyproject.toml','apps/api/uv.lock','apps/api/sena_hub_api',
    'scripts/production_runtime_check.py','scripts/operator_diagnostics.py','scripts/run-hosted-media-worker.py','tests/test_production_runtime.py']){
    const target=path.join(directory,file);await mkdir(path.dirname(target),{recursive:true});
    await cp(path.join(root,file),target,{recursive:true,filter:source=>!source.includes('__pycache__')});
  }
  run('uv',['sync','--no-dev','--frozen','--project','apps/api']);
  const python=path.join(directory,'apps/api/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  run(python,['-B','scripts/production_runtime_check.py','imports']);
  run(python,['-B','tests/test_production_runtime.py']);
  console.log('PASS: frozen production install, imports and isolation regressions; no credentials, network or database.');
}finally{
  const actual=await realpath(directory),boundary=await realpath(parent);
  assert.ok(actual.startsWith(boundary+path.sep),'Refuse cleanup outside the owned production check');
  await rm(actual,{recursive:true,force:true,maxRetries:3});
}
