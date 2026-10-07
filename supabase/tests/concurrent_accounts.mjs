import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';

await assertDisposableTestDatabase();
const config=JSON.parse(await readFile('.local/development.json','utf8'));
const connection={host:'127.0.0.1',port:55432,database:'sena_hub_local',user:'postgres',password:config.adminPassword};
const setup=new pg.Client(connection), first=new pg.Client(connection), second=new pg.Client(connection);
const a=randomUUID(),b=randomUUID();
let originals=[];
try {
  await Promise.all([setup.connect(),first.connect(),second.connect()]);
  originals=(await setup.query("select id from hub.user_account where status='ACTIVE' and hub_role='admin'")).rows;
  await setup.query("update hub.user_account set status='SUSPENDED' where status='ACTIVE' and hub_role='admin'");
  await setup.query("insert into hub.user_account(id,email) values($1,'admin-a@example.test')",[a]);
  const python=process.platform==='win32'?'apps/api/.venv/Scripts/python.exe':'apps/api/.venv/bin/python';
  const promote=()=>promisify(execFile)(python,['scripts/hub-accounts.py','promote-admin','--email','admin-a@example.test'],{windowsHide:true});
  await promote();
  assert.equal((await setup.query('select hub_role from hub.user_account where id=$1',[a])).rows[0].hub_role,'admin');
  await assert.rejects(promote(),{code:1},'Bootstrap refuses a second first-admin promotion');
  await setup.query("insert into hub.user_account(id,email,status,hub_role) values($1,'admin-b@example.test','ACTIVE','admin')",[b]);
  const stamps=(await setup.query('select id,updated_at::text from hub.user_account where id=any($1)',[[a,b]])).rows;
  for(const [client,id] of [[first,a],[second,b]]) {
    await client.query('begin');await client.query('set local role admin');
    await client.query("select set_config('app.actor_id',$1,true)",[id]);
  }
  await first.query("select hub.decide_account($1,'suspend',null,null,'concurrent test',$2)",[b,stamps.find(r=>r.id===b).updated_at]);
  const losing=second.query("select hub.decide_account($1,'suspend',null,null,'concurrent test',$2)",[a,stamps.find(r=>r.id===a).updated_at]);
  losing.catch(()=>{});
  await first.query('commit');
  await assert.rejects(losing,{code:'42501'});
  await second.query('rollback');
  assert.equal((await setup.query("select count(*)::int count from hub.user_account where status='ACTIVE' and hub_role='admin'")).rows[0].count,1);
  // The surviving last admin cannot suspend or demote itself either.
  await first.query('begin');await first.query('set local role admin');
  await first.query("select set_config('app.actor_id',$1,true)",[a]);
  await assert.rejects(first.query("select hub.decide_account($1,'role','viewer',null,'self',$2)",[a,stamps.find(r=>r.id===a).updated_at]),{code:'42501'});
  console.log('PASS: concurrent cross-suspension leaves one active admin; last-admin self-demotion is blocked');
} finally {
  await first.query('rollback').catch(()=>{});await second.query('rollback').catch(()=>{});
  await setup.query("update hub.user_account set status='ACTIVE' where id=any($1)",[originals.map(r=>r.id)]);
  await setup.query('delete from hub.user_account_event where account_id=any($1) or actor_id=any($1)',[[a,b]]);
  await setup.query('delete from hub.user_account where id=any($1)',[[a,b]]);
  await Promise.all([setup.end(),first.end(),second.end()]);
}
