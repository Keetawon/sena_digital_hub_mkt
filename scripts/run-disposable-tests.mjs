// Fixed loopback ports preserve the production local-only guards. A running
// working DB/app causes a fail-closed refusal, never a fallback to shared data.
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir,mkdtemp,readdir,realpath,rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID,randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn,execFile } from 'node:child_process';
import { once } from 'node:events';
import EmbeddedPostgres from 'embedded-postgres';
import { applyLocalMigrations } from './local-migrations.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),[mode,...extra]=process.argv.slice(2);
assert.ok(['api','db','ui','all'].includes(mode),'Use api, db, ui or all');
const assistantFixtures=extra.includes('--assistant-fixtures');
if(assistantFixtures){assert.equal(mode,'api','Assistant fixtures require the disposable API suite');extra.splice(extra.indexOf('--assistant-fixtures'),1);}
assert.ok(!['db','all'].includes(mode)||extra.length===0,'Extra arguments are supported for api and ui only');
const ports=[55432,8000,3000];
for(const port of ports)await new Promise((resolve,reject)=>{
  const server=createServer();server.once('error',()=>reject(new Error(`Port ${port} is in use. Stop the local working DB/API/admin first; tests never use an existing server.`)));
  server.listen(port,'127.0.0.1',()=>server.close(resolve));
});
const config=JSON.parse(await readFile(path.join(root,'.local/development.json'),'utf8'));
const base=path.join(root,'.local/test-runs');await mkdir(base,{recursive:true});
const directory=await mkdtemp(path.join(base,'run-')),dataDirectory=path.join(directory,'postgres'),runId=randomUUID();
await writeFile(path.join(directory,'run.json'),JSON.stringify({run_id:runId,database_directory:dataDirectory,created_at:new Date().toISOString()}));
const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('HUB_')||key.startsWith('NEXT_PUBLIC_SUPABASE_')||key==='OPENAI_API_KEY')delete env[key];
const dsn=`postgresql://hub_runtime:${config.runtimePassword}@127.0.0.1:55432/sena_hub_local`;
Object.assign(env,{HUB_ENV:'local',HUB_AUTH_MODE:'demo',HUB_DATABASE_URL:dsn,HUB_TEST_DATABASE_URL:dsn,
  HUB_API_URL:'http://127.0.0.1:8000',HUB_DISPOSABLE_TEST_RUN:directory,HUB_COORDINATE_TEST:'1',HUB_PROGRESS_TEST:'1'});
if(assistantFixtures)env.HUB_ASSISTANT_TEST='1';
for(const [role,key] of Object.entries({EDITOR:'editorToken',PUBLISHER:'publisherToken',VIEWER:'viewerToken',SERVICE_CONSUMER:'consumerToken',ADMIN:'adminToken',ONLINE_STAFF:'onlineStaffToken',AGENCY_KIN:'agencyKinToken',AGENCY_COMBAY:'agencyCombayToken'})){
  assert.ok(config[key],`Missing local ${role} credential; run dev:db setup first`);env[`HUB_DEMO_${role}_TOKEN`]=config[key];
}
// Optional UAT identities are seeded only by their dedicated fixtures. Fresh
// random tokens prevent Next's generated env fallback, without changing the
// historical eight-account baseline used by the rest of the suites.
for(const persona of ['UAT_ADMIN','UAT_SUSPENDED','UAT_SOMCHAI'])env[`HUB_DEMO_${persona}_TOKEN`]=randomBytes(32).toString('hex');
const server=new EmbeddedPostgres({databaseDir:dataDirectory,user:'postgres',password:config.adminPassword,port:55432,persistent:true,authMethod:'scram-sha-256',
  initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
const probePassword=randomBytes(24).toString('hex');
const probeEnv={...env,HUB_TEST_PROBE_DATABASE_URL:`postgresql://hub_permission_probe:${probePassword}@127.0.0.1:55432/sena_hub_local`};
const children=[];let started=false,closing=false,exitCode=0;
function launch(command,args,cwd=root,childEnv=env){const p=spawn(command,args,{cwd,env:childEnv,stdio:'inherit',windowsHide:true});children.push(p);return p;}
async function run(command,args,cwd=root,childEnv=env){const p=launch(command,args,cwd,childEnv);const [code]=await once(p,'exit');if(code!==0)throw new Error(`Test command failed with exit code ${code}`);}
async function ready(url,p){for(let i=0;i<180;i++){if(p.exitCode!==null)throw new Error('Test service exited during startup');try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw new Error('Test service startup timeout');}
async function stop(){
  if(closing)return;closing=true;
  for(const p of children.reverse())if(p.exitCode===null){
    if(process.platform==='win32')await new Promise(resolve=>execFile('taskkill',['/PID',String(p.pid),'/T','/F'],{windowsHide:true},()=>resolve()));else p.kill('SIGTERM');
  }
  if(started)await server.stop();
  // Verify the resolved path before recursive removal. Only this new run is owned.
  const actual=await realpath(directory),allowed=await realpath(base);
  assert.ok(actual.startsWith(allowed+path.sep)&&path.basename(actual).startsWith('run-'));
  await rm(actual,{recursive:true,force:true});
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await stop();process.exit(130);});
try{
  await server.initialise();await server.start();started=true;
  const bootstrap=server.getPgClient('postgres','127.0.0.1');await bootstrap.connect();
  assert.equal(await realpath((await bootstrap.query('SHOW data_directory')).rows[0].data_directory),await realpath(dataDirectory));
  await bootstrap.query('CREATE DATABASE sena_hub_local');await bootstrap.end();
  const db=server.getPgClient('sena_hub_local','127.0.0.1');await db.connect();
  try{
    await db.query('CREATE TABLE public.disposable_test_run(run_id text PRIMARY KEY)');await db.query('INSERT INTO public.disposable_test_run VALUES ($1)',[runId]);
    await applyLocalMigrations(db);
    assert.match(config.runtimePassword,/^[a-f0-9]{48}$/);
    await db.query(`CREATE ROLE hub_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${config.runtimePassword}'`);
    await db.query('GRANT hub_app TO hub_runtime WITH ADMIN FALSE,INHERIT FALSE,SET TRUE');
    // Disposable-only stronger principal for explicit historical-role probes.
    // Its credential is never passed to the API, Next, UI or working DB setup.
    await db.query(`CREATE ROLE hub_permission_probe LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${probePassword}'`);
    await db.query('GRANT editor,publisher,viewer,service_consumer,admin,online_staff,agency,hub_app TO hub_permission_probe WITH ADMIN FALSE,INHERIT FALSE,SET TRUE');
  }finally{await db.end();}
  const uv=['--cache-dir','.cache/uv','run','--project','apps/api'];
  if(mode==='ui'||mode==='all'||assistantFixtures){
    // These checked-in synthetic packs support the live local UI and optional
    // populated assistant readers; the working database is never a fixture.
    await run('uv',[...uv,'python','scripts/stage-ads-actuals.py','--package','supabase/tests/fixtures/ads_actuals','--apply']);
    await run('uv',[...uv,'python','scripts/seed-document-demo.py']);
    await run('uv',[...uv,'python','scripts/run-document-worker.py','--drain']);
  }
  if(mode==='api'||mode==='all')await run('uv',[...uv,'pytest','apps/api/tests','-q','--basetemp',path.join(directory,'pytest'),'-o',`cache_dir=${path.join(directory,'pytest-cache')}`,...extra],root,probeEnv);
  if(mode==='db'||mode==='all'){
    await run(process.execPath,['--test','tests/disposable-test-guard.test.mjs']);
    await run(process.execPath,['--test','tests/content-upgrade.test.mjs']);
    await run(process.execPath,['scripts/test-db.mjs']);
    const concurrency=(await readdir(path.join(root,'supabase/tests'))).filter(n=>/^concurrent_.*\.mjs$/.test(n)).sort();
    for(const name of concurrency)await run(process.execPath,[`supabase/tests/${name}`]);
    await run(process.execPath,['--test','supabase/tests/dw_fixtures.test.mjs','supabase/tests/hub_export.test.mjs','supabase/tests/brand_completeness.test.mjs']);
  }
  if(mode==='ui'||mode==='all'){
    const api=launch('uv',[...uv,'uvicorn','sena_hub_api.main:create_app','--factory','--host','127.0.0.1','--port','8000','--no-access-log']);
    await ready('http://127.0.0.1:8000/health',api);
    const admin=launch(process.execPath,[path.join(root,'apps/admin/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3000'],path.join(root,'apps/admin'));
    await ready('http://127.0.0.1:3000',admin);
    await run(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test',...extra]);
  }
  console.log('PASS: disposable tests complete; the working database and file stores were never used.');
}catch(error){console.error(error instanceof Error?error.message:'Disposable tests failed');exitCode=1;}
// embedded-postgres installs a beforeExit hook that defaults to zero. Exit only
// after our awaited cleanup, with the actual test result preserved.
finally{await stop();process.exit(exitCode);}
