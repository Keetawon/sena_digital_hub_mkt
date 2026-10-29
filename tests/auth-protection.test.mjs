import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sealAuth,compareAuth,checkAuthPrivileges,protectedReadOnlySnapshot} from '../scripts/auth-protection.mjs';
import {authWriteMatches,assertNoAuthWrites} from '../scripts/auth-write-check.mjs';
import {createH1AuthFixture,saveH1AuthFixture} from './fixtures/h1-auth.mjs';

test('protected read-only capture uses one repeatable snapshot and closes it on failure',async()=>{
  const queries=[],db={query:async sql=>{queries.push(sql);return {rows:[]};}};
  await assert.rejects(protectedReadOnlySnapshot(db,{rule:'invalid'}),/Complete H5h/);
  assert.deepEqual(queries,['begin isolation level repeatable read read only','rollback']);
});

const shape={tables:['users','identities','mfa_factors','sessions','refresh_tokens','mfa_amr_claims','flow_state','audit_log_entries'],columns:'synthetic',constraints:'synthetic'};
const fixture=()=>({users:[{id:'user-1',email:'synthetic@example.test',encrypted_password:'synthetic-digest',role:'authenticated',aud:'authenticated',
  raw_app_meta_data:{provider:'email'},raw_user_meta_data:{},banned_until:null,deleted_at:null,confirmed_at:'synthetic-confirmed',updated_at:'old',last_sign_in_at:'old'}],
  identities:[],mfa_factors:[],sessions:[{id:'session-1',user_id:'user-1'}],refresh_tokens:[{id:'token-1',user_id:'user-1',session_id:'session-1',revoked:false}],
  mfa_amr_claims:[{id:'claim-1',session_id:'session-1'}],flow_state:[],audit_log_entries:[]});
const compare=(a,b,s=shape)=>compareAuth(sealAuth(a,shape),sealAuth(b,s));

for(const column of ['updated_at','last_sign_in_at'])test(column+' only is recorded activity',()=>{
  const a=fixture(),b=fixture();b.users[0][column]='new';const r=compare(a,b);
  assert.equal(r.status,'passed');assert.deepEqual(r.tables.find(t=>t.table==='auth.users').activity_changed_columns,[column]);
  assert.ok(!JSON.stringify(r).includes('synthetic@example.test'));
});
for(const table of ['sessions','refresh_tokens','mfa_amr_claims','flow_state','audit_log_entries'])for(const operation of ['added','removed'])test(table+' '+operation+' is activity',()=>{
  const a=fixture(),b=fixture();
  if(table==='sessions'){
    if(operation==='added')b.sessions.push({id:'session-2',user_id:'user-1'});
    else {a.sessions.push({id:'session-2',user_id:'user-1'});}
  }else{
    const row={id:table+'-2',user_id:'user-1',session_id:'session-1'};
    if(operation==='added')b[table].push(row);else a[table].push(row);
  }
  const r=compare(a,b),entry=r.tables.find(t=>t.table==='auth.'+table);
  assert.equal(r.status,'passed');assert.equal(entry.changed,true);assert.equal(entry.row_count_delta,operation==='added'?1:-1);assert.equal(r.orphan_check.passed,true);
});
for(const [column,value] of Object.entries({email:'different@example.test',encrypted_password:'changed',role:'admin',aud:'different',raw_app_meta_data:{role:'admin'},raw_user_meta_data:{name:'changed'},banned_until:'changed',deleted_at:'changed',confirmed_at:'changed',recovery_token:'changed',email_change_sent_at:'changed'}))test(column+' is a strict STOP',()=>{
  const a=fixture(),b=fixture();b.users[0][column]=value;const r=compare(a,b);
  assert.equal(r.status,'STOP');assert.ok(r.tables.find(t=>t.table==='auth.users').strict_changed_columns.includes(column));
});
test('new user, identity, MFA factor, unknown table and schema shape are strict',()=>{
  for(const table of ['users','identities','mfa_factors','new_auth_table']){
    const a=fixture(),b=fixture();(b[table]??=[]).push({id:'new',user_id:'user-1'});assert.equal(compare(a,b).status,'STOP');
  }
  assert.equal(compare(fixture(),fixture(),{...shape,constraints:'changed'}).status,'STOP');
});
test('orphan activity user or session is a STOP, nullable pre-auth flow is valid',()=>{
  for(const [table,row] of [['sessions',{id:'orphan',user_id:'missing'}],['refresh_tokens',{id:'orphan',user_id:'missing'}],['mfa_amr_claims',{id:'orphan',session_id:'missing'}],['flow_state',{id:'orphan',user_id:'missing'}],['audit_log_entries',{id:'orphan',payload:{user_id:'missing'}}]]){
    const a=fixture(),b=fixture();b[table].push(row);assert.ok(compare(a,b).strict_differences.includes('orphan_activity_row'));
  }
  const b=fixture();b.flow_state.push({id:'pre-auth',user_id:null});assert.equal(compare(fixture(),b).status,'passed');
});
test('global sign-out cascade passes without exposing any activity value',()=>{
  const a=fixture(),b=fixture();for(const table of ['sessions','refresh_tokens','mfa_amr_claims'])b[table]=[];
  b.users[0].updated_at='private-activity-value';const r=compare(a,b);
  assert.equal(r.status,'passed');assert.equal(r.tables.length,Object.keys(a).length);
  assert.ok(!JSON.stringify(r).includes('private-activity-value'));assert.ok(!JSON.stringify(r).includes('token-1'));
});
test('privilege postflight fails on a synthetic grant or ownership',()=>{
  assert.equal(checkAuthPrivileges([{role:'hub_runtime',object:'auth.users',insert:false,update:false,delete:false,truncate:false,owns_object:false}]).status,'passed');
  for(const field of ['insert','update','delete','truncate','owns_object'])assert.equal(checkAuthPrivileges([{role:'hub_runtime',object:'auth.users',[field]:true}]).status,'STOP');
});
for(const source of [
  'INSERT INTO auth.users VALUES (1);','UPDATE ONLY "auth"."users" SET role=1;', 'DELETE FROM auth.users;',
  'TRUNCATE TABLE auth.sessions;', 'COPY auth.users FROM STDIN;', 'CREATE TABLE auth.new_table(id int);',
  'ALTER TABLE auth.users ADD COLUMN bad int;', 'DROP FUNCTION auth.uid();','CREATE SCHEMA auth;',
  'GRANT SELECT ON auth.users TO hub_runtime;', 'REVOKE ALL ON SCHEMA auth FROM hub_runtime;',
  'CREATE TRIGGER bad AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION hub.bad();',
  "DO $$ BEGIN EXECUTE 'UPDATE auth.users SET role=1'; END $$;", "db.query('UPDATE ' + 'auth.users SET role=1');",
  "execute format('UPDATE %I.%I SET role=1', 'auth', 'users')", 'SET search_path=auth; INSERT INTO users VALUES(1);',
  'CREATE POLICY bad ON auth.users USING (true);','ALTER TABLE hub.bad SET SCHEMA auth;',
  'CREATE TABLE hub.bad(user_id uuid REFERENCES auth.users(id));','DROP TABLE hub.bad, auth.users;',
  "execute 'up' || 'date ' || 'auth.users SET role=1';", 'MERGE INTO auth.users u USING hub.x x ON true WHEN MATCHED THEN DELETE;',
])test('static Auth write rejection: '+source.slice(0,45),()=>assert.throws(()=>assertNoAuthWrites(source),/Auth write rejected/));
test('Auth read helpers, qualified reads and comments pass',()=>{
  for(const source of ['SELECT auth.uid(),auth.jwt();','SELECT email FROM auth.users;',"execute 'select email from auth.users where id=$1' into x using y;",'-- UPDATE auth.users SET bad=1;\nSELECT auth.uid();','/* CREATE TRIGGER x ON auth.users */ SELECT 1;'])assert.deepEqual(authWriteMatches(source),[]);
});
test('synthetic Auth fixtures reject remote targets and a wrong loopback database before SQL',async()=>{
  for(const connectionParameters of [{host:'db.example.test',port:5432,database:'postgres'},
    {host:'127.0.0.1',port:55434,database:'postgres'}]){
    const queries=[],db={connectionParameters,query:async sql=>queries.push(sql)};
    await assert.rejects(createH1AuthFixture(db));await assert.rejects(saveH1AuthFixture(db,{email:'synthetic@example.test'}));
    assert.deepEqual(queries,[]);
  }
  let reads=0;
  const db={connectionParameters:{host:'127.0.0.1',port:55434,database:'hub_hosted_test_simulation'},query:async()=>{
    reads++;return {rows:[{host:'127.0.0.1',port:5432,name:'postgres'}]};}};
  await assert.rejects(createH1AuthFixture(db));assert.equal(reads,1);
});
