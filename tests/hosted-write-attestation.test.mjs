import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {freeLoopbackPort,startPostgresOnFreePort} from '../scripts/disposable-ports.mjs';
import EmbeddedPostgres from 'embedded-postgres';
import {createServer} from 'node:net';
import {initialiseDisposableDb} from '../scripts/initialise-disposable-db.mjs';
import {attestedTransaction,rehearseTransaction,validateManifest} from '../scripts/hosted-write-attestation.mjs';
import {securityWatch,workerAttribution} from '../scripts/hosted-security-watch.mjs';

test('free-port startup retries only bind collisions and never stops another listener',async t=>{
 const ports=[],listener=createServer();
 const start=t.mock.method(EmbeddedPostgres.prototype,'start',async function(){
  ports.push(this.options.port);
  if(ports.length===1){
   await new Promise((resolve,reject)=>listener.once('error',reject).listen(this.options.port,'127.0.0.1',resolve));
   this.options.onLog('could not bind: Address already in use');throw new Error('synthetic collision');
  }
 });
 try{
  const result=await startPostgresOnFreePort({});
  assert.equal(ports.length,2);assert.notEqual(ports[0],ports[1]);assert.equal(result.port,ports[1]);assert.ok(listener.listening);
  start.mock.mockImplementation(async()=>{throw new Error('synthetic non-port failure');});
  await assert.rejects(startPostgresOnFreePort({}),/startup failed/);
  assert.equal(start.mock.callCount(),3);
  const port=await freeLoopbackPort();assert.ok(port>=1024&&port<=65535);
 }finally{start.mock.restore();await new Promise(resolve=>listener.close(resolve));}
});

test('H5i attests own writes and ignores concurrent Auth activity',async t=>{
 const base=path.resolve('.local/test-runs');await mkdir(base,{recursive:true});
 const directory=await mkdtemp(path.join(base,'attestation-')),dataDirectory=path.join(directory,'postgres');
 const config=JSON.parse(await readFile('.local/development.json','utf8'));
 const runId=randomUUID();await writeFile(path.join(directory,'run.json'),JSON.stringify({run_id:runId}),{flag:'wx'});
 let db,other,server,port;
 try{
  await initialiseDisposableDb(dataDirectory,config.adminPassword);
  ({server,port}=await startPostgresOnFreePort({databaseDir:dataDirectory,user:'postgres',password:config.adminPassword,persistent:true,authMethod:'scram-sha-256',initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],onError:()=>{}}));
  const admin=server.getPgClient('postgres','127.0.0.1');await admin.connect();await admin.query('create database sena_hub_local');await admin.end();
  db=server.getPgClient('sena_hub_local','127.0.0.1');await db.connect();other=server.getPgClient('sena_hub_local','127.0.0.1');await other.connect();
  assert.equal(await realpath((await db.query('show data_directory')).rows[0].data_directory),await realpath(dataDirectory));
  await db.query('create table public.disposable_test_run(run_id text primary key)');
  await db.query('insert into public.disposable_test_run values($1)',[runId]);
  await db.query(`create schema auth;create schema hub;
   create table auth.users(id int primary key,email text,last_sign_in_at text,recovery_token text);
   create table auth.identities(id int primary key,user_id int,updated_at text);
   insert into auth.users values(1,'synthetic@example.test','before','before');insert into auth.identities values(1,1,'before');
   create table hub.allowed(id int);create table hub.denied(id int);insert into hub.allowed values(1);insert into hub.denied values(1);
   create function public.synthetic_auth_write() returns void language sql security definer as $$update auth.users set recovery_token='synthetic-change' where id=1$$;
   create function public.synthetic_auth_trigger() returns trigger language plpgsql security definer as $$begin update auth.users set recovery_token='trigger-change' where id=1;return new;end$$;`);
  await db.query(`alter table auth.users add column created_at timestamptz default now(),add column raw_app_meta_data jsonb default '{"provider":"synthetic"}';
   alter table auth.identities add column created_at timestamptz default now(),add column provider text default 'synthetic';
   create schema audit;create table audit.change_log(id int,occurred_at timestamptz default now(),actor uuid,database_role text,table_name text,operation text,before_row jsonb,after_row jsonb);`);
  const sources={'scripts/hosted-write-attestation.mjs':createHash('sha256').update(await readFile('scripts/hosted-write-attestation.mjs')).digest('hex')};
  const body=c=>c.query('insert into hub.allowed values(2)');
  const rehearsal=await rehearseTransaction(db,{prefix:0,sources},body),manifest=rehearsal.manifest;
  await t.test('rehearsal rolls back; allowed write commits and records counters',async()=>{
   assert.equal((await db.query('select count(*) n from hub.allowed')).rows[0].n,'1');
   const r=await attestedTransaction(db,manifest,body);assert.equal(r.receipt.status,'committed');assert.equal(r.receipt.write_set[0].relation,'hub.allowed');assert.ok(r.receipt.write_set[0].inserted>=1);
  });
  await t.test('Auth allowlist is refused',()=>assert.throws(()=>validateManifest({...manifest,allowlist:['auth.users']}),/Auth/));
  const fail=async(callback,violation)=>{
   const before=(await db.query('select count(*) n from hub.allowed')).rows[0].n;
   await assert.rejects(attestedTransaction(db,manifest,async c=>{await body(c);await callback(c);}),e=>{
    assert.equal(e.receipt.rolled_back,true);assert.equal(e.receipt.violation,violation);return true;
   });assert.equal((await db.query('select count(*) n from hub.allowed')).rows[0].n,before);
  };
  await t.test('non-allowed Hub write rolls the whole transaction back',()=>fail(c=>c.query('insert into hub.denied values(2)'),'write_set'));
  await t.test('direct Auth write rolls back',()=>fail(c=>c.query("update auth.users set email='changed@example.test' where id=1"),'write_set'));
  await t.test('SECURITY DEFINER Auth write rolls back',()=>fail(c=>c.query('select public.synthetic_auth_write()'),'write_set'));
  await t.test('trigger Auth write rolls back',async()=>{
   await db.query('create trigger synthetic_auth after insert on hub.allowed for each row execute function public.synthetic_auth_trigger()');
   try{await fail(async()=>{},'write_set');}finally{await db.query('drop trigger synthetic_auth on hub.allowed');}
  });
  await t.test('dynamic Auth TRUNCATE rolls back through same-snapshot hashes',()=>fail(c=>c.query("do $$begin execute 'TRUNCATE '||quote_ident('auth')||'.'||quote_ident('identities');end$$"),'same_snapshot_auth'));
  await t.test('concurrent committed sign-in, new user, identity and recovery change pass',async()=>{
   const r=await attestedTransaction(db,manifest,async c=>{
    await other.query("begin;update auth.users set last_sign_in_at='later',recovery_token='later' where id=1;insert into auth.users values(2,'new@example.test','later',null);update auth.identities set updated_at='later' where id=1;insert into auth.identities values(2,2,'later');commit");await body(c);
   });assert.equal(r.receipt.auth_unchanged,true);
  });
  await t.test('Auth activity between batches passes',async()=>{
   await other.query("update auth.users set last_sign_in_at='later-still' where id=1");
   assert.equal((await attestedTransaction(db,manifest,body)).receipt.status,'committed');
  });
  await t.test('asyncpg adapter uses the same attestation and rollback decisions',async()=>{
   const child=spawn('uv',['--cache-dir','.cache/uv','run','--project','apps/api','python','tests/fixtures/attestation-bridge.py'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
   let output='';child.stdout.on('data',part=>output+=part);child.stderr.resume();
   const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
   child.stdin.end(JSON.stringify({connection:{host:'127.0.0.1',port,user:'postgres',password:config.adminPassword,database:'sena_hub_local'},directory,manifest}));
   assert.equal(await closed,0,'Bridge fixture failed: '+output);
   assert.deepEqual(JSON.parse(output),{allowed:true,hub_rollback:true,auth_rollback:true,unguarded_refused:true});
  });
  await t.test('unexpected role or grant fails catalog check',async()=>{
   await fail(c=>c.query('create role hub_attestation_reader nologin'),'catalog');
   await fail(c=>c.query('grant select on hub.allowed to public'),'catalog');
  });
  await t.test('unexpected policy fails catalog check',()=>fail(c=>c.query('create policy unexpected_policy on hub.allowed for select using(true)'),'catalog'));
  await t.test('a new Auth object and an Auth write privilege roll back',async()=>{
   await fail(c=>c.query('create table auth.unapproved(id int)'),'catalog');
   await fail(c=>c.query('create role hub_auth_writer;grant insert on auth.users to hub_auth_writer'),'auth_privilege');
  });
  await t.test('final function definitions are checked after a dynamic rewrite',()=>fail(c=>c.query(
   "do $$begin execute replace('create function hub.rewritten() returns void language sql as $body$ update __SCHEMA__.users set recovery_token=null $body$', '__SCHEMA__', 'auth');end$$"),'final_definition'));
  await t.test('external catalog features require an explicit declaration even in rehearsal',async()=>{
   const external=c=>c.query('create foreign data wrapper attested_fdw no handler;create server attested_server foreign data wrapper attested_fdw;create user mapping for current_user server attested_server');
   await assert.rejects(rehearseTransaction(db,{prefix:0,sources},external),e=>e.receipt.violation==='external_catalog'&&e.receipt.rolled_back);
   const proof=await rehearseTransaction(db,{prefix:0,sources,external_features:['foreign_wrapper:attested_fdw','foreign_server:attested_server','user_mapping:attested_server/$deployment']},external);
   assert.equal((await attestedTransaction(db,proof.manifest,external)).receipt.status,'committed');
  });
  await t.test('a catalog change between batches is observed without failing our unchanged batch',async()=>{
   await other.query('create role hub_between_batches nologin');
   const result=await attestedTransaction(db,manifest,body);
   assert.ok(result.receipt.catalog.before['role:hub_between_batches']);assert.deepEqual(result.receipt.catalog.changes,[]);
  });
  await t.test('rehearsed role, grant and policy changes pass',async()=>{
   const change=c=>c.query('create role hub_attestation_reader nologin;grant select on hub.allowed to hub_attestation_reader;create policy expected_policy on hub.allowed for select to hub_attestation_reader using(true)');
   const proof=await rehearseTransaction(db,{prefix:0,sources},change);
   assert.equal((await attestedTransaction(db,proof.manifest,change)).receipt.status,'committed');
  });
  await t.test('security watch reports counts and ids; worker attribution rejects another queue',async()=>{
   await db.query(`insert into audit.change_log(id,actor,database_role,table_name,operation,before_row,after_row)
    values(1,'00000000-0000-0000-0000-000000000001','hub_app','hub.user_account','UPDATE',
    '{"id":"00000000-0000-0000-0000-000000000002","status":"PENDING","email":"private@example.test"}',
    '{"id":"00000000-0000-0000-0000-000000000002","status":"ACTIVE","email":"private@example.test"}');
    insert into audit.change_log(id,database_role,table_name,operation,after_row) values(2,'hub_media_worker','hub.media_jobs','UPDATE','{"kind":"image_suggestion"}');`);
   const report=await securityWatch(db,'2020-01-01T00:00:00Z');
   assert.deepEqual(report.new_auth_users_by_provider,[{provider:'synthetic',count:2}]);
   assert.deepEqual(report.new_auth_identities_by_provider,[{provider:'synthetic',count:2}]);
   assert.equal(report.account_assignment_changes[0].acting_user_id,'00000000-0000-0000-0000-000000000001');
   assert.doesNotMatch(JSON.stringify(report),/private@example|recovery_token|updated_at|last_sign_in_at/);
   assert.equal(report.postgres_can_write_auth,true);assert.equal(report.informational_only,true);
   assert.equal((await workerAttribution(db,'2020-01-01T00:00:00Z')).status,'passed');
   await db.query("insert into audit.change_log(id,database_role,table_name,operation,after_row) values(3,'hub_media_worker','hub.media_jobs','UPDATE','{\"kind\":\"translation\"}')");
   assert.equal((await workerAttribution(db,'2020-01-01T00:00:00Z')).status,'STOP');
  });
 }finally{
  if(other)await other.end().catch(()=>{});if(db)await db.end().catch(()=>{});if(server)await server.stop();
  const actual=await realpath(directory);assert.ok(actual.startsWith(await realpath(base)+path.sep)&&path.basename(actual).startsWith('attestation-'));
  await rm(actual,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 }
});
