// Runs the H1 profile entirely on loopback. Never loads .env.supabase-test or creates Auth users.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createMockSupabase } from './hosted-test-mock.mjs';
import { SIMULATION_PUBLIC_KEY, SIMULATION_STORAGE_KEY } from './hosted-test-fixtures.mjs';
import { simulateHostedTest } from './simulate-hosted-test.mjs';
import pg from 'pg';

const root=fileURLToPath(new URL('../',import.meta.url)), args=process.argv.slice(2);
const component=args.includes('--api-only')?'api':args.includes('--admin-only')?'admin':null;
if(args.some(x=>!['--test','--existing-simulation','--api-only','--admin-only'].includes(x)) || (component && !args.includes('--existing-simulation'))) throw new Error('Invalid local simulation arguments');
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
  const ports=component==='api'?[8001]:component==='admin'?[3001]:[54329,8001,3001,...(args.includes('--existing-simulation')?[]:[55434])];
  for(const port of ports)await new Promise((resolve,reject)=>{
    const probe=createServer();probe.once('error',()=>reject(new Error(`Local H1 port ${port} is already in use; stop its prior simulation first.`)));
    probe.listen(port,'127.0.0.1',()=>probe.close(resolve));
  });
  if(!args.includes('--existing-simulation'))database=await simulateHostedTest({keepRunning:true,seed:true});
  const config=JSON.parse(await readFile(path.join(root,'.local/hosted-test-simulation/current.json'),'utf8'));
  if(config.host!=='127.0.0.1'||config.port!==55434||config.database!=='hub_hosted_test_simulation'||config.environment!=='hosted-test-simulation')throw new Error('Not the fixed local H1 simulation');
  const dsn=new URL(config.runtimeDatabaseUrl);
  if(!['postgres:','postgresql:'].includes(dsn.protocol)||dsn.search||dsn.hash||dsn.hostname!=='127.0.0.1'||dsn.port!=='55434'||dsn.pathname!=='/hub_hosted_test_simulation'||dsn.username!=='hub_runtime')throw new Error('Unsafe local simulation connection');
  const env={...process.env};
  for(const name of Object.keys(env))if(name.startsWith('HUB_')||name.startsWith('NEXT_PUBLIC_SUPABASE_')||name==='OPENAI_API_KEY')delete env[name];
  Object.assign(env,{HUB_AUTH_GOOGLE:'1',HUB_AUTH_PASSWORD:'1',HUB_ENV_LABEL:'LOCAL H1',HUB_ENV:'hosted-test',HUB_AUTH_MODE:'supabase',HUB_HOSTED_TEST_SIMULATION:'1',HUB_DATABASE_URL:config.runtimeDatabaseUrl,
    HUB_SUPABASE_URL:'http://127.0.0.1:54329',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54329',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:SIMULATION_PUBLIC_KEY,
    HUB_SUPABASE_STORAGE_KEY:SIMULATION_STORAGE_KEY,HUB_ADMIN_ORIGIN:'http://127.0.0.1:3001',HUB_API_URL:'http://127.0.0.1:8001'});
  // Next automatically loads .env.local; explicitly suppress demo-token fallbacks.
  for(const role of ['EDITOR','PUBLISHER','VIEWER','SERVICE_CONSUMER','ADMIN','ONLINE_STAFF','AGENCY_KIN','AGENCY_COMBAY'])env[`HUB_DEMO_${role}_TOKEN`]='';
  if(!component) {
    identityDb=new pg.Pool({host:config.host,port:config.port,database:config.database,user:config.migrationUser,password:config.migrationPassword});
    mock=createMockSupabase({onIdentity: async user => {
      if(!user.email.endsWith('@example.test'))throw new Error('Synthetic identities only');
      await identityDb.query('insert into auth.users(id,email,email_confirmed_at,created_at) values($1,$2,$3,$4) on conflict(id) do update set email=excluded.email,email_confirmed_at=excluded.email_confirmed_at', [user.id,user.email,user.email_confirmed_at??null,user.created_at]);
    }});mock.listen(54329,'127.0.0.1');await once(mock,'listening');
  }
  if(component!=='admin') {
    apiProcess=child('uv',['--cache-dir','.cache/uv','run','--project','apps/api','uvicorn','sena_hub_api.main:create_app','--factory','--host','127.0.0.1','--port','8001','--no-proxy-headers','--no-access-log'],env);
    await ready('http://127.0.0.1:8001/health',apiProcess);
  }
  if(component!=='api') {
    adminProcess=child(process.execPath,[path.join(root,'apps/admin/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3001'],env,path.join(root,'apps/admin'));
    await ready('http://127.0.0.1:3001/login',adminProcess);
  }
  if(args.includes('--test')) {
    const tests=child(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','tests/ui/hosted-h1.spec.ts','tests/ui/accounts-h1.spec.ts','tests/ui/accounts-followup-h1.spec.ts','tests/ui/accounts-redesign-h1.spec.ts','--output',path.join(root,'artifacts/playwright-h1')],{...env,PLAYWRIGHT_CHANNEL:'msedge'});
    const [code]=await once(tests,'exit');
    if(code!==0) {await stop();process.exit(code??1);}
    // Restart only this runner's owned Next process to exercise configuration-off
    // behavior through real SSR/proxy/browser paths, preserving the local mock DB.
    const exited=once(adminProcess,'exit');
    if(process.platform==='win32') await new Promise(resolve=>execFile('taskkill',['/PID',String(adminProcess.pid),'/T','/F'],{windowsHide:true},()=>resolve()));
    else adminProcess.kill('SIGTERM');
    await exited;
    const off={...env,HUB_AUTH_PASSWORD:'0',HUB_AUTH_GOOGLE:'0'};
    adminProcess=child(process.execPath,[path.join(root,'apps/admin/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3001'],off,path.join(root,'apps/admin'));
    await ready('http://127.0.0.1:3001/login',adminProcess);
    const flagTests=child(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','tests/ui/accounts-flags-h1.spec.ts','--output',path.join(root,'artifacts/playwright-h1-flags')],{...off,PLAYWRIGHT_CHANNEL:'msedge'});
    const [flagCode]=await once(flagTests,'exit');
    if(flagCode!==0) {await stop();process.exit(flagCode??1);}
    // Restore enabled providers for the OAuth outage/retry check.
    const flagsAdminExited=once(adminProcess,'exit');
    if(process.platform==='win32') await new Promise(resolve=>execFile('taskkill',['/PID',String(adminProcess.pid),'/T','/F'],{windowsHide:true},()=>resolve()));
    else adminProcess.kill('SIGTERM');
    await flagsAdminExited;
    adminProcess=child(process.execPath,[path.join(root,'apps/admin/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3001'],env,path.join(root,'apps/admin'));
    await ready('http://127.0.0.1:3001/login',adminProcess);
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
}catch(error){console.error(error instanceof Error && /^(Local H1|A local H1|Not the fixed local|Unsafe local simulation)/.test(error.message)?error.message:'Local H1 process failed; connection details withheld.');await stop();process.exit(1);}
