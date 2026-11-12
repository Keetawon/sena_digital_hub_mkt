// Runs the H1 profile entirely on loopback. Never loads .env.supabase-test or creates Auth users.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import {assertSimulationDatabase} from './disposable-simulation.mjs';
import { createMockSupabase } from './hosted-test-mock.mjs';
import { SIMULATION_PUBLIC_KEY } from './hosted-test-fixtures.mjs';
import { R2_SIMULATION } from './hosted-test-r2.mjs';
import { simulateHostedTest } from './simulate-hosted-test.mjs';
import pg from 'pg';
import { scrubProviderKeys } from './provider-keys.mjs';
import {saveH1AuthFixture} from '../tests/fixtures/h1-auth.mjs';
import {authWriteInventory} from './auth-write-check.mjs';
import {safeError} from './supabase-test-migrations.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)), args=process.argv.slice(2);
const component=args.includes('--api-only')?'api':args.includes('--admin-only')?'admin':null;
const smokeOnly=args.includes('--smoke-only');
if(args.some(x=>!['--test','--existing-simulation','--api-only','--admin-only','--smoke-only'].includes(x)) || (component && !args.includes('--existing-simulation')) || (smokeOnly&&args.length!==1)) throw new Error('Invalid local simulation arguments');
const children=[];let database,mock,closing=false,adminProcess,apiProcess,identityDb;
function child(command,arguments_,env,cwd=root) {
  const process_=spawn(command,arguments_,{cwd,env,stdio:'inherit',windowsHide:true});children.push(process_);return process_;
}
async function stop() {
  if(closing)return;closing=true;
  for(const p of children.reverse()) if(p.exitCode===null) {
    if(process.platform==='win32') await new Promise(resolve=>execFile('taskkill',['/PID',String(p.pid),'/T','/F'],{windowsHide:true},()=>resolve()));
    else p.kill('SIGTERM');
  }
  if(mock)await new Promise(resolve=>mock.close(resolve));
  await identityDb?.end();
  await database?.stop();
}
async function ready(url,process_) {
  for(let i=0;i<180;i++) {
    if(process_.exitCode!==null)throw new Error('A local H1 process stopped before readiness');
    try {const r=await fetch(url,{redirect:'manual'});if(r.status===200)return;}catch{/* Startup only. */}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('Local H1 readiness timed out');
}
try {
  if((await authWriteInventory()).status!=='passed')throw new Error('H5h Auth-write release gate failed');
  if(!args.includes('--existing-simulation'))database=await simulateHostedTest({keepRunning:true,persistMetadata:false,seed:true});
  const config=database?.metadata??JSON.parse(await readFile(path.join(root,'.local/hosted-test-simulation/current.json'),'utf8'));
  if(config.host!=='127.0.0.1'||!Number.isInteger(config.port)||config.port<1024||config.port===55432||config.database!=='hub_hosted_test_simulation'||config.environment!=='hosted-test-simulation')throw new Error('Not the fixed local H1 simulation');
  const dsn=new URL(config.runtimeDatabaseUrl);
  if(!['postgres:','postgresql:'].includes(dsn.protocol)||dsn.search||dsn.hash||dsn.hostname!=='127.0.0.1'||Number(dsn.port)!==config.port||dsn.pathname!=='/hub_hosted_test_simulation'||dsn.username!=='hub_runtime')throw new Error('Unsafe local simulation connection');
  const {auth:authPort,api:apiPort,admin:adminPort}=config.ports??{};
  const ports=[authPort,apiPort,adminPort];
  if(ports.some(p=>!Number.isInteger(p)||p<1024||p>65535||[55432,8000,3000,config.port].includes(p))||new Set(ports).size!==3)throw new Error('Unsafe local simulation ports');
  const authOrigin=`http://127.0.0.1:${authPort}`,apiOrigin=`http://127.0.0.1:${apiPort}`,adminOrigin=`http://127.0.0.1:${adminPort}`;
  identityDb=new pg.Pool({host:config.host,port:config.port,database:config.database,user:config.adminUser,password:config.adminPassword});
  await assertSimulationDatabase(identityDb,{checkDataDirectory:true});
  const env={...process.env};
  scrubProviderKeys(env);
  for(const name of Object.keys(env))if(name.startsWith('HUB_')||name.startsWith('NEXT_PUBLIC_SUPABASE_'))delete env[name];
  Object.assign(env,{HUB_AUTH_GOOGLE:'1',HUB_AUTH_PASSWORD:'1',HUB_ENV_LABEL:'LOCAL H1',HUB_ENV:'hosted-test',HUB_AUTH_MODE:'supabase',HUB_HOSTED_TEST_SIMULATION:'1',HUB_DATABASE_URL:config.runtimeDatabaseUrl,
    HUB_SUPABASE_URL:authOrigin,NEXT_PUBLIC_SUPABASE_URL:authOrigin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:SIMULATION_PUBLIC_KEY,
    HUB_SUPABASE_STORAGE_KEY:'',HUB_R2_CREDENTIALS_FILE:'memory:h1-r2',HUB_H1_R2_CONFIG:JSON.stringify({...R2_SIMULATION,endpoint_url:authOrigin+'/r2'}),
    HUB_R2_PRIVATE_BUCKET_CONFIRMED:'1',HUB_ADMIN_ORIGIN:adminOrigin,HUB_API_URL:apiOrigin});
  // Next automatically loads .env.local; explicitly suppress demo-token fallbacks.
  for(const role of ['EDITOR','PUBLISHER','VIEWER','SERVICE_CONSUMER','ADMIN','ONLINE_STAFF','AGENCY_KIN','AGENCY_COMBAY','UAT_ADMIN','UAT_SUSPENDED','UAT_SOMCHAI'])env[`HUB_DEMO_${role}_TOKEN`]='';
  if(!component) {
    mock=createMockSupabase({adminOrigin,onIdentity: async user => {
      if(!user.email.endsWith('@example.test'))throw new Error('Synthetic identities only');
      await saveH1AuthFixture(identityDb,user);
    }});mock.listen(authPort,'127.0.0.1');await once(mock,'listening');
  }
  if(smokeOnly||args.includes('--test')) {
    const actor=(await identityDb.query("select id::text actor_id,hub_role role,hub.permission_projection(a) capabilities from hub.user_account a where status='ACTIVE' and hub_role='admin' order by id limit 1")).rows[0];
    const project=(await identityDb.query('select public_project_id public_id from hub.projects order by id limit 1')).rows[0];
    if(!actor||!project)throw new Error('Local H1 smoke fixtures missing');
    const smoke=child('uv',['--cache-dir','.cache/uv','run','--project','apps/api','python','tests/h1-ai-state-smoke.py'],{...env,HUB_H1_SMOKE_CONTEXT:JSON.stringify({...actor,...project})});
    const [code]=await once(smoke,'exit');
    if(code!==0){await stop();process.exit(code??1);}
    if(smokeOnly){await stop();console.log('PASS: H1 ai-state smoke tests complete');process.exit(0);}
  }
  if(component!=='admin') {
    apiProcess=child('uv',['--cache-dir','.cache/uv','run','--project','apps/api','python','scripts/run-h1-api.py'],env);
    await ready(apiOrigin+'/health',apiProcess);
  }
  if(component!=='api') {
    adminProcess=child(process.execPath,[path.join(root,'apps/admin/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(adminPort)],env,path.join(root,'apps/admin'));
    await ready(adminOrigin+'/login',adminProcess);
  }
  if(args.includes('--test')) {
    const tests=child(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','tests/ui/hosted-h1.spec.ts','tests/ui/accounts-h1.spec.ts','tests/ui/accounts-followup-h1.spec.ts','tests/ui/accounts-redesign-h1.spec.ts','tests/ui/auth-design-h1.spec.ts','tests/ui/workspace-home-h1.spec.ts','tests/ui/unified-workspace-h1.spec.ts','tests/ui/unified-publication-h1.spec.ts','tests/ui/publication-navigation-h1.spec.ts','tests/ui/business-workspace-h1.spec.ts','tests/ui/content-scopes-h1.spec.ts','tests/ui/content-bu-notices-h1.spec.ts','--output',path.join(root,'artifacts/playwright-h1')],{...env,PLAYWRIGHT_CHANNEL:'msedge'});
    const [code]=await once(tests,'exit');
    if(code!==0) {await stop();process.exit(code??1);}
    // Restart only this runner's owned Next process to exercise configuration-off
    // behavior through real SSR/proxy/browser paths, preserving the local mock DB.
    const exited=once(adminProcess,'exit');
    if(process.platform==='win32') await new Promise(resolve=>execFile('taskkill',['/PID',String(adminProcess.pid),'/T','/F'],{windowsHide:true},()=>resolve()));
    else adminProcess.kill('SIGTERM');
    await exited;
    const off={...env,HUB_AUTH_PASSWORD:'0',HUB_AUTH_GOOGLE:'0'};
    adminProcess=child(process.execPath,[path.join(root,'apps/admin/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(adminPort)],off,path.join(root,'apps/admin'));
    await ready(adminOrigin+'/login',adminProcess);
    const flagTests=child(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','tests/ui/accounts-flags-h1.spec.ts','--output',path.join(root,'artifacts/playwright-h1-flags')],{...off,PLAYWRIGHT_CHANNEL:'msedge'});
    const [flagCode]=await once(flagTests,'exit');
    if(flagCode!==0) {await stop();process.exit(flagCode??1);}
    // Restore enabled providers for the OAuth outage/retry check.
    const flagsAdminExited=once(adminProcess,'exit');
    if(process.platform==='win32') await new Promise(resolve=>execFile('taskkill',['/PID',String(adminProcess.pid),'/T','/F'],{windowsHide:true},()=>resolve()));
    else adminProcess.kill('SIGTERM');
    await flagsAdminExited;
    adminProcess=child(process.execPath,[path.join(root,'apps/admin/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(adminPort)],env,path.join(root,'apps/admin'));
    await ready(adminOrigin+'/login',adminProcess);
    // Replace only this runner's API with a test-owned loopback outage double.
    const apiExited=once(apiProcess,'exit');
    if(process.platform==='win32') await new Promise(resolve=>execFile('taskkill',['/PID',String(apiProcess.pid),'/T','/F'],{windowsHide:true},()=>resolve()));
    else apiProcess.kill('SIGTERM');
    await apiExited;
    const outage=child(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','tests/ui/accounts-outage-h1.spec.ts','--output',path.join(root,'artifacts/playwright-h1-outage')],{...env,HUB_ACCOUNT_OUTAGE_TEST:'1',PLAYWRIGHT_CHANNEL:'msedge'});
    const [outageCode]=await once(outage,'exit');await stop();process.exit(outageCode??1);
  }else{
    console.log(`H1 local ${component??'demo'} ready. No hosted requests or provisioning. Ctrl+C stops owned processes.`);
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await stop();process.exit(0);});
    await new Promise(()=>{});
  }
}catch(error){console.error(safeError(error,{step:'local_h1'}));await stop();process.exit(1);}
