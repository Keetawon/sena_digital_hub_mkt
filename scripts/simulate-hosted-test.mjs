import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import net from 'node:net';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import {initialiseDisposableDb} from './initialise-disposable-db.mjs';
import {applyMigration,loadMigrations,runMigrations,PROJECT_REF,safeError,mediaWorkerLoginStatements} from './supabase-test-migrations.mjs';
import {createH1AuthFixture,saveH1AuthFixture} from '../tests/fixtures/h1-auth.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const simulationRoot=path.join(root,'.local','hosted-test-simulation');
const connection={host:'127.0.0.1',port:55434,database:'hub_hosted_test_simulation'};
const secret=()=>randomBytes(32).toString('base64url');
const identifier=value=>'"'+value.replaceAll('"','""')+'"';
const denied=error=>error.code==='42501';
const owners={ads_registry_writer:['ads'],ads_export_owner:['ads_export'],ads_finance_writer:['ads'],ads_actuals_writer:['ads','staging'],hub_export_owner:['hub_export']};

export async function simulateHostedTest({keepRunning=false,persistMetadata=true,seed=true,log=console.log}={}) {
  // No environment profile is read; all endpoints and random credentials are local.
  const probe=net.createServer();
  await new Promise((resolve,reject)=>probe.once('error',reject).listen(connection.port,connection.host,resolve));
  await new Promise(resolve=>probe.close(resolve));
  await mkdir(simulationRoot,{recursive:true});
  const directory=await mkdtemp(path.join(simulationRoot,'run-'));
  const adminPassword=secret(),migrationPassword=secret(),runtimePassword=secret();
  const server=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password:adminPassword,port:connection.port,persistent:true,authMethod:'scram-sha-256',initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
  let admin,client,runtime,mediaLogin,metadata,verified=false,held=false;
  try {
    await initialiseDisposableDb(directory,adminPassword);await server.start();
    admin=new pg.Client({...connection,database:'postgres',user:'postgres',password:adminPassword});await admin.connect();
    const actual=(await admin.query("select current_setting('data_directory') as directory")).rows[0].directory;
    assert.equal(path.resolve(actual).toLowerCase(),path.resolve(directory).toLowerCase());verified=true;
    await admin.query(`create role hub_migration_verifier login createrole noinherit nosuperuser nocreatedb noreplication nobypassrls password '${migrationPassword}'`);
    await admin.query(`create database ${identifier(connection.database)} owner hub_migration_verifier`);
    client=new pg.Client({...connection,user:'hub_migration_verifier',password:migrationPassword});await client.connect();
    // Protected, synthetic Auth source for invite confirmation tests only. App roles
    // have no grants; the mock's operator callback writes these rows on verification.
    await createH1AuthFixture(client);
    await assert.rejects(client.query('grant set on parameter app.ads_test_issuing to hub_migration_verifier'),denied);
    await assert.rejects(client.query("create function public.denied_parameter_probe() returns void language sql set app.ads_test_issuing='off' as 'select'"),denied);
    assert.equal((await client.query("select has_parameter_privilege(current_user,'app.ads_test_issuing','SET') allowed")).rows[0].allowed,false);
    log('PASS: managed login reproduces 42501; no custom-parameter privilege is granted.');
    const config={projectRef:PROJECT_REF,runtimePassword,apply:false};
    const migrations=await loadMigrations();
    await runMigrations(client,config,{log,migrations});
    assert.equal((await client.query("select count(*)::int count from pg_namespace where nspname in('hub','ads','hub_deployment')")).rows[0].count,0);
    config.apply=true;
    await runMigrations(client,config,{log,migrations:migrations.slice(0,50)});
    const upgradePassword=(await admin.query("select rolpassword from pg_authid where rolname='hub_runtime'")).rows[0].rolpassword;
    // Populate a source and account before FORCE RLS is strengthened.
    await client.query("insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint) values('SYNTHETIC-UPGRADE','Synthetic upgrade',now(),'synthetic')");
    await client.query("insert into hub.user_account(id,email,status,hub_role) values('00000000-0000-0000-0000-000000000090','upgrade@example.test','ACTIVE','viewer')");
    const upgradeAccount=(await client.query("select to_jsonb(a) row from hub.user_account a where id='00000000-0000-0000-0000-000000000090'")).rows[0].row;
    // Exercise the published Phase 6 checkpoint before applying Accounts C.
    // Both upgrades retain the already-provisioned runtime credential.
    await runMigrations(client,config,{log,migrations:migrations.slice(0,52)});
    // Rehearse the owner's deployed 19 October checkpoint before the content
    // rollout. A failed first migration leaves history, accounts and grants intact.
    await runMigrations(client,config,{log,migrations:migrations.slice(0,56)});
    const contentUpgradeState=async()=>(await client.query(`select
      (select jsonb_agg(to_jsonb(a) order by id) from hub.user_account a) accounts,
      (select jsonb_agg(to_jsonb(p) order by account_id,tab) from hub.account_permission p) permissions,
      (select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from hub.permission_template t) templates`)).rows[0];
    const contentUpgradeBefore=await contentUpgradeState();
    const failedUpgrade=migrations.map(m=>({...m,body:[...m.body]}));
    failedUpgrade[56].body.push('select missing_content_rollout_rollback_probe();');
    await assert.rejects(runMigrations(client,config,{log:()=>{},migrations:failedUpgrade}),error=>error.code==='42883');
    assert.equal((await client.query('select count(*)::int count from hub_deployment.schema_migrations')).rows[0].count,56);
    assert.deepEqual(await contentUpgradeState(),contentUpgradeBefore);
    // One committed migration models a lost operator connection. Recovery must
    // accept this exact canonical prefix without reapplying it or rotating roles.
    await applyMigration(client,migrations[56],config,'hub_migration_verifier');
    await runMigrations(client,config,{log,migrations});
    assert.deepEqual(await contentUpgradeState(),contentUpgradeBefore);
    assert.equal((await client.query('select count(*)::int count from hub.web_pages')).rows[0].count,0);
    assert.equal((await client.query("select count(*)::int count from hub.account_permission where 'knowledge.publish_web'=any(special_actions)")).rows[0].count,0);
    log(`PASS: hosted 56->${migrations.length} failure/recovery preserves accounts, permissions and templates; no page or publisher grant created.`);
    assert.equal((await admin.query("select rolpassword from pg_authid where rolname='hub_runtime'")).rows[0].rolpassword,upgradePassword);
    assert.deepEqual((await client.query("select to_jsonb(a) row from hub.user_account a where id='00000000-0000-0000-0000-000000000090'")).rows[0].row,upgradeAccount);
    assert.equal((await client.query("select count(*)::int count from staging.rem_projects where rem_project_id='SYNTHETIC-UPGRADE'")).rows[0].count,1);
    await client.query("delete from hub.account_permission where account_id='00000000-0000-0000-0000-000000000090'; delete from hub.permission_event where account_id='00000000-0000-0000-0000-000000000090'; delete from hub.user_account where id='00000000-0000-0000-0000-000000000090'; delete from staging.rem_projects where rem_project_id='SYNTHETIC-UPGRADE'");
    assert.equal((await client.query('select count(*)::int count from hub_deployment.schema_migrations')).rows[0].count,migrations.length);
    assert.equal((await client.query("select rolsuper from pg_roles where rolname=current_user")).rows[0].rolsuper,false);
    const baseline=(await client.query("select name,checksum,executed_checksum from hub_deployment.schema_migrations where name like '%0014_%'")).rows[0];
    assert.notEqual(baseline.checksum,baseline.executed_checksum);
    for(const [role,schemas] of Object.entries(owners)) {
      assert.equal((await client.query("select pg_has_role(current_user,$1,'SET') allowed",[role])).rows[0].allowed,false);
      for(const schema of schemas) assert.equal((await client.query("select has_schema_privilege($1,$2,'CREATE') allowed",[role,schema])).rows[0].allowed,false);
    }
    for(const signature of ['ads.cancel_registration(text,text)','ads.set_approval(boolean,text,text)']) {
      assert.equal((await client.query("select has_function_privilege(current_user,$1,'EXECUTE') allowed",[signature])).rows[0].allowed,true);
      for(const role of ['hub_app','admin','editor','publisher','viewer','online_staff','agency','service_consumer']) {
        assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed,false);
      }
    }
    // Reach input validation as the non-superuser operator, with no technical
    // owner membership. Invalid inputs cannot change the issuance switch/data.
    await client.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000090',false)");
    await assert.rejects(client.query("select ads.cancel_registration('SYNTHETIC-NONE','')"),error=>error.code==='23514');
    await assert.rejects(client.query("select ads.set_approval(null,'','')"),error=>error.code==='23514');
    await client.query("select set_config('app.actor_id','',false)");
    const beforePassword=(await admin.query("select rolpassword from pg_authid where rolname='hub_runtime'")).rows[0].rolpassword;
    const replay=[];await runMigrations(client,config,{migrations,log:line=>replay.push(line)});
    assert.equal(replay.some(line=>line.startsWith('Applied:')),false);
    assert.ok((await admin.query("select rolpassword from pg_authid where rolname='hub_runtime'")).rows[0].rolpassword===beforePassword,'Runtime credential must be retained on replay');
    const changed=migrations.map(m=>({...m}));changed[0].checksum='changed';
    await assert.rejects(runMigrations(client,config,{migrations:changed,log:()=>{}}),/checksum changed/);
    await assert.rejects(runMigrations(client,{...config,projectRef:'x'.repeat(20)},{migrations,log:()=>{}}),/approved/);
    const broken={name:'rollback_probe',checksum:'probe',executedChecksum:'probe',body:['create table hub.rollback_probe(x int);','select missing_function_for_atomicity_probe();']};
    await assert.rejects(applyMigration(client,broken,config,'hub_migration_verifier'));
    assert.equal((await client.query("select to_regclass('hub.rollback_probe') relation")).rows[0].relation,null);
    assert.equal((await client.query("select count(*)::int count from hub_deployment.schema_migrations where name='rollback_probe'")).rows[0].count,0);
    for(const role of Object.keys(owners)) assert.equal((await client.query("select pg_has_role(current_user,$1,'SET') allowed",[role])).rows[0].allowed,false);
    log('PASS: all migrations apply without superuser; canonical/variant hashes, exact replay, password retention, rollback and restored owner ACLs verified.');
    runtime=new pg.Client({...connection,user:'hub_runtime',password:runtimePassword});await runtime.connect();
    assert.equal((await runtime.query('select hub.hosted_test_profile() accepted')).rows[0].accepted,true);
    await assert.rejects(runtime.query('select * from hub_deployment.target'),denied);
    await assert.rejects(runtime.query('select * from ads.campaign_registration'),denied);
    for(const role of Object.keys(owners)) await assert.rejects(runtime.query(`set role ${identifier(role)}`),denied);
    for(const role of ['admin','editor','publisher','viewer','online_staff','agency','service_consumer']) await assert.rejects(runtime.query(`set role ${identifier(role)}`),denied);
    assert.deepEqual((await client.query("select r.rolname from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member='hub_runtime'::regrole order by r.rolname")).rows.map(r=>r.rolname),['hub_app']);
    for(const role of ['hub_app']) {
      await runtime.query(`set role ${identifier(role)}`);
      await runtime.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',false)");
      await runtime.query("select set_config('app.ads_test_issuing','on',false)");
      // No account exists yet: even forged role/issuance settings cannot read
      // Registry configuration or authorize a mutation.
      await assert.rejects(runtime.query('select ads.test_issuing_enabled() enabled'),denied);
      await assert.rejects(runtime.query("update ads.setting set value='true' where key='hosted_test_issuing_enabled'"),denied);
      if(role!=='agency') await assert.rejects(runtime.query("select ads.issue_registration('00000000-0000-0000-0000-000000000001','LEADS','KIN')"),denied);
      else await assert.rejects(runtime.query('select * from ads.setting'),denied);
      await runtime.query('reset role');
    }
    await runtime.query('set role hub_app');
    await runtime.query('select hub.residential_environment()');
    await assert.rejects(runtime.query('select hub.residential_local()'),denied);
    await runtime.query('reset role');
    // Simulate a corrupt/mismatched operator target; runtime profile proof fails closed.
    await client.query('begin');
    await client.query("update hub_deployment.target set environment='wrong'");
    assert.equal((await client.query('select hub.hosted_test_profile() accepted')).rows[0].accepted,false);
    await client.query('rollback');
    assert.equal((await client.query("select count(*)::int count from ads.setting where value<>'false'::jsonb")).rows[0].count,0);
    assert.equal((await client.query('select count(*)::int count from hub.projects')).rows[0].count,0);
    log('PASS: caller-forged GUC ignored; runtime/agency cannot enable flags or assume owners; H1 residential allowed while original deferred guard stays closed.');
    const mediaPassword=secret();
    for(const statement of mediaWorkerLoginStatements(mediaPassword,connection.database))await client.query(statement);
    await runMigrations(client,config,{log:()=>{},migrations});
    mediaLogin=new pg.Client({...connection,user:'hub_media_worker_login',password:mediaPassword});await mediaLogin.connect();
    assert.equal((await mediaLogin.query('select current_user name')).rows[0].name,'hub_media_worker_login');
    await mediaLogin.query('set role hub_media_worker');
    assert.equal((await mediaLogin.query('select current_user name')).rows[0].name,'hub_media_worker');
    await assert.rejects(mediaLogin.query('select * from auth.users'),denied);
    await mediaLogin.query('reset role');
    for(const role of ['hub_app','admin','editor','publisher','viewer','online_staff','agency','service_consumer','hub_translation_worker',...Object.keys(owners)])
      await assert.rejects(mediaLogin.query('set role '+identifier(role)),denied);
    assert.equal((await client.query("select pg_has_role('hub_runtime','hub_media_worker','SET') allowed")).rows[0].allowed,false);
    const mediaFlags=(await client.query("select rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit from pg_roles where rolname='hub_media_worker_login'")).rows[0];
    assert.deepEqual(mediaFlags,{rolcanlogin:true,rolinherit:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,rolconnlimit:2});
    log('PASS: dedicated media LOGIN uses the runner SCRAM bootstrap, assumes only its worker role, and cannot read Auth; API cannot assume the worker.');
    if(seed) {
      const {IDENTITIES}=await import('./hosted-test-fixtures.mjs');
      for (const u of IDENTITIES) await saveH1AuthFixture(client,{...u,email_confirmed_at:u.created_at});
      for (const [i,u] of IDENTITIES.entries()) await client.query("insert into hub.user_account(id,email,display_name_th,status,hub_role,agency_code) values($1,$2,$3,'ACTIVE',$4,$5) on conflict(id) do nothing",[u.id,u.email,`ผู้ทดสอบ สมมติ ${i+1}`,u.app_metadata.hub_role,u.app_metadata.hub_agency??null]);
      const {applyH1Seed}=await import('./hosted-test-seed.mjs');
      await applyH1Seed(client);await applyH1Seed(client);
      assert.equal((await client.query("select count(*)::int count from ads.setting where value<>'false'::jsonb")).rows[0].count,0);
      log('PASS: synthetic H1 seed and harmless replay; issuance flags remain false.');
    }
    if(keepRunning) {
      metadata={...connection,environment:'hosted-test-simulation',projectRef:PROJECT_REF,dataDirectory:directory,migrationUser:'hub_migration_verifier',migrationPassword,runtimeUser:'hub_runtime',runtimePassword,adminUser:'postgres',adminPassword,created_at:new Date().toISOString()};
      metadata.runtimeDatabaseUrl=`postgresql://hub_runtime:${runtimePassword}@${connection.host}:${connection.port}/${connection.database}`;
      metadata.migrationDatabaseUrl=`postgresql://hub_migration_verifier:${migrationPassword}@${connection.host}:${connection.port}/${connection.database}`;
      if(persistMetadata) {
        const file=path.join(simulationRoot,'current.json');await writeFile(file,JSON.stringify(metadata,null,2)+'\n',{mode:0o600});
        log('Simulation ready at 127.0.0.1:55434; private connection metadata: .local/hosted-test-simulation/current.json');
      }else log('Simulation ready at 127.0.0.1:55434; connection metadata stays in memory.');
      held=true;
    }
    return {server,metadata,stop:async()=>{
      await server.stop();
      const target=path.resolve(directory),parent=path.resolve(simulationRoot)+path.sep;
      if(!persistMetadata && verified && target.startsWith(parent) && path.basename(target).startsWith('run-')) await rm(target,{recursive:true,force:true});
    },metadataPath:held&&persistMetadata?path.join(simulationRoot,'current.json'):undefined};
  } catch(error) {
    // Assertion text is safe; database detail can include SQL/connection secrets.
    if(error.code==='ERR_ASSERTION') throw error;
    const permission=/^permission denied (?:for (?:schema|table|function|relation|sequence|parameter) [a-zA-Z0-9_.]+|to set role \"[a-zA-Z0-9_]+\")$/.test(error.message??'')?` ${error.message}`:'';
    throw new Error(safeError(error)+permission,{cause:error});
  } finally {
    await mediaLogin?.end().catch(()=>{});await runtime?.end().catch(()=>{});await client?.end().catch(()=>{});await admin?.end().catch(()=>{});
    if(!held) {
      await server.stop().catch(()=>{});
      const target=path.resolve(directory),parent=path.resolve(simulationRoot)+path.sep;
      if(verified && target.startsWith(parent) && path.basename(target).startsWith('run-')) await rm(target,{recursive:true,force:true});
    }
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if(process.argv.slice(2).some(arg=>!['--keep-running','--migrations-only'].includes(arg))) throw new Error('Only --keep-running / --migrations-only are supported.');
    const result=await simulateHostedTest({keepRunning:process.argv.includes('--keep-running'),seed:!process.argv.includes('--migrations-only')});
    if(result.metadataPath) {
      for(const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await result.stop();process.exit(0);});
      await new Promise(()=>{});
    }
  } catch(error) {console.error(error.message);process.exit(1);}
}
