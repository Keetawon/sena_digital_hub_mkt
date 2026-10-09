import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

test('populated content upgrade preserves accounts and asset editors, audits backfill and drains deferred cache work',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const base=path.join(root,'.local/test-runs');
  await mkdir(base,{recursive:true});
  await new Promise((resolve,reject)=>{
    const probe=createServer();probe.once('error',()=>reject(new Error('Upgrade test port 55435 is occupied')));
    probe.listen(55435,'127.0.0.1',()=>probe.close(resolve));
  });
  const directory=await mkdtemp(path.join(base,'upgrade-'));
  const dataDirectory=path.join(directory,'postgres');
  const config=JSON.parse(await readFile(path.join(root,'.local/development.json'),'utf8'));
  const server=new EmbeddedPostgres({databaseDir:dataDirectory,user:'postgres',password:config.adminPassword,
    port:55435,persistent:true,authMethod:'scram-sha-256',initdbFlags:['--encoding=UTF8','--locale=C'],
    postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
  let started=false,db;
  try{
    await server.initialise();await server.start();started=true;
    db=server.getPgClient('postgres','127.0.0.1');await db.connect();
    assert.equal(await realpath((await db.query('SHOW data_directory')).rows[0].data_directory),await realpath(dataDirectory));
    const migrations=path.join(root,'supabase/migrations');
    for(const name of (await readdir(migrations)).filter(name=>name.endsWith('.sql')&&name<'202610090047_content_permissions.sql').sort())
      await db.query(await readFile(path.join(migrations,name),'utf8'));
    for(const file of ['scripts/sample-accounts.sql','supabase/seed.sql','scripts/sample-intake.sql','scripts/sample-brands.sql'])
      await db.query(await readFile(path.join(root,file),'utf8'));
    const accounts=async()=>(await db.query('select to_jsonb(a) row from hub.user_account a order by id')).rows;
    const editors=async()=>(await db.query('select id,updated_at,updated_by from hub.assets order by id')).rows;
    const beforeAccounts=await accounts(),beforeEditors=await editors();
    assert.ok(beforeAccounts.length>=8&&beforeEditors.length>=3);
    const bound=(await db.query('select asset_id from hub.entity_assets union select asset_id from hub.brand_assets')).rows.map(row=>row.asset_id);
    assert.ok(bound.length>0);
    await db.query("select set_config('app.actor_id','',false),set_config('app.change_reason','',false)");
    await db.query(await readFile(path.join(migrations,'202610090047_content_permissions.sql'),'utf8'));
    assert.deepEqual(await accounts(),beforeAccounts);
    assert.deepEqual(await editors(),beforeEditors);
    assert.equal(Number((await db.query('select count(*) from hub.assets where id=any($1::uuid[]) and first_bound_at is not null',[bound])).rows[0].count),bound.length);
    assert.equal((await db.query("select tgenabled::text from pg_trigger where tgrelid='hub.assets'::regclass and tgname='touch'")).rows[0].tgenabled,'O');
    assert.equal(Number((await db.query('select count(*) from hub.project_progress_dirty')).rows[0].count),0);
    assert.equal(Number((await db.query("select count(*) from audit.change_log where table_name='hub.assets' and actor is null and reason='Phase 2 migration: historical asset binding backfill'")).rows[0].count),bound.length);
  }finally{
    if(db)await db.end();if(started)await server.stop();
    const actual=await realpath(directory),allowed=await realpath(base);
    assert.ok(actual.startsWith(allowed+path.sep)&&path.basename(actual).startsWith('upgrade-'));
    await rm(actual,{recursive:true,force:true});
  }
});
