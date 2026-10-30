import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedWritePathInventory,rawWriteTransactions} from '../scripts/hosted-write-path-check.mjs';
import {catalogSnapshot} from '../scripts/hosted-write-attestation.mjs';

test('every hosted operator transaction uses the shared H5i helper',async()=>{
 const inventory=await hostedWritePathInventory();assert.deepEqual(inventory.violations,[]);
 assert.ok(inventory.inspected.includes('scripts/supabase-test-migrations.mjs'));
 assert.ok(inventory.inspected.includes('scripts/transfer-hub-km.py'));
});
test('catalog normalization preserves grant flags across managed bootstrap role names',async()=>{
 const snapshot=async(operator,bootstrap,admin=true)=>catalogSnapshot({query:async sql=>{
  if(sql.startsWith('select current_user operator'))return {rows:[{operator,bootstrap,database:'synthetic'}]};
  if(sql.includes('from pg_auth_members'))return {rows:[{key:`hub_media_worker_login/${operator}/${bootstrap}`,
   value:{role:'hub_media_worker_login',member:operator,grantor:bootstrap,admin,inherit:false,set:false}}]};
  return {rows:[]};
 }});
 const local=await snapshot('hub_migration_verifier','postgres');
 assert.deepEqual(local,await snapshot('postgres','supabase_admin'));
 assert.notDeepEqual(local,await snapshot('postgres','supabase_admin',false));
 assert.ok(local['membership:hub_media_worker_login/$deployment/$bootstrap']);
});
test('raw JavaScript/Python writes fail; read-only and shared helpers pass',()=>{
 for(const source of ["await db.query('begin')","await db.query(`BEGIN ISOLATION LEVEL SERIALIZABLE`)",
  "await db.query('commit')","await db.execute('BEGIN')","await db.execute('BEGIN READ ONLY; SET TRANSACTION READ WRITE')",
  'async with db.transaction():',"db.transaction(readonly=not apply)","db.transaction(readonly=True if read else False)"])
  assert.ok(rawWriteTransactions(source).length);
 for(const source of ["await db.query('begin read only')",'async with db.transaction(readonly=True):',
  'await attestedTransaction(db,manifest,body)','async with AttestedTransaction(db,manifest):'])
  assert.deepEqual(rawWriteTransactions(source),[]);
});
