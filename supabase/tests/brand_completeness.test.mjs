import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
await assertDisposableTestDatabase();
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { localTarget } from '../../scripts/provision-dw-reader.mjs';

test('confirmed local intake: reasons, source flags, one audit per brand, safe replay, readiness counts and atomic publish', async () => {
  const config=JSON.parse(await readFile(new URL('../../.local/development.json',import.meta.url),'utf8'));
  const db=new pg.Client({...localTarget,user:'postgres',password:config.adminPassword});
  const hash=createHash('sha256').update('SYNTHETIC-BULK-BRAND-28').digest('hex');
  const prefix='00000-BULK-28-';
  await db.connect();
  try {
    await db.query('begin');
    await db.query('insert into staging.intake_batches(manifest_sha256,manifest,datasets) values($1,$2,$3)',[hash,{contract_version:'rem-brand-master-test-v1',synthetic_only:true},{brands:[],exceptions:[]}]);
    for(const [key,thai,english,status,count] of [
      ['a','แบรนด์สมมติ bulk ก','Synthetic Bulk Alpha',false,1],['b','แบรนด์สมมติ bulk ข',null,false,2],
      ['deleted','แบรนด์สมมติลบ','Synthetic Bulk Deleted',true,1],['unknown','แบรนด์สมมติไม่ทราบ','Synthetic Bulk Unknown',null,1],
      ['blank','  ','Synthetic Bulk Blank',false,1],['dup1','แบรนด์สมมติชื่อซ้ำ','Synthetic Bulk Dup One',false,1],
      ['dup2',' แบรนด์สมมติชื่อซ้ำ ','Synthetic Bulk Dup Two',false,1],['unused','แบรนด์สมมติไม่ได้ใช้','Synthetic Bulk Unused',false,0]]) {
      await db.query('insert into staging.rem_brands(rem_brand_id,brand_name_rem,brand_name_en_rem,is_deleted,source_fingerprint,intake_manifest_sha256,source_record) values($1,$2,$3,$4,$5,$6,$7)',[prefix+key,thai,english,status,'synthetic-bulk-28',hash,{synthetic_only:true,residential_project_count:count}]);
    }
    const role=async name=>{await db.query(`set local role ${name}`);if(['admin','editor','publisher'].includes(name))await db.query("select set_config('app.actor_id',$1,true)",[{'admin':'00000000-0000-0000-0000-000000000005','editor':'00000000-0000-0000-0000-000000000001','publisher':'00000000-0000-0000-0000-000000000002'}[name]]);};
    const denial=async(query,args,code)=>{await db.query('savepoint denied');await assert.rejects(db.query(query,args),e=>e.code===code);await db.query('rollback to savepoint denied');await db.query('release savepoint denied');};
    await role('editor');await denial('select hub.brand_bulk_preview($1)',[hash],'42501');
    await role('admin');const preview=(await db.query('select hub.brand_bulk_preview($1) p',[hash])).rows[0].p;
    assert.equal(preview.create_count,2);assert.equal(preview.rows.length,8);
    const reason=key=>preview.rows.find(r=>r.rem_brand_id===prefix+key).reason_codes;
    assert.deepEqual(reason('deleted'),['deleted']);assert.deepEqual(reason('unknown'),['unknown_status']);assert.deepEqual(reason('blank'),['blank_name']);
    assert.deepEqual(reason('dup1'),['duplicate']);assert.deepEqual(reason('dup2'),['duplicate']);assert.deepEqual(reason('unused'),['no_residential_project']);
    await denial('select hub.brand_bulk_create($1,$2,false,$3)',[hash,preview.preview_sha256,'Synthetic bulk test'],'22023');
    await denial('select hub.brand_bulk_create($1,$2,true,$3)',[hash,'0'.repeat(64),'Synthetic bulk test'],'40001');
    await db.query('reset role');await db.query('update staging.rem_brands set brand_name_rem=$2 where rem_brand_id=$1',[prefix+'a','ชื่อสมมติเปลี่ยนระหว่างพรีวิว']);
    await role('admin');await denial('select hub.brand_bulk_create($1,$2,true,$3)',[hash,preview.preview_sha256,'Synthetic bulk test'],'40001');
    await db.query('reset role');await db.query('update staging.rem_brands set brand_name_rem=$2 where rem_brand_id=$1',[prefix+'a','แบรนด์สมมติ bulk ก']);
    await role('admin');assert.equal((await db.query('select hub.brand_bulk_create($1,$2,true,$3) r',[hash,preview.preview_sha256,'Synthetic bulk test'])).rows[0].r.created_count,2);
    let brands=(await db.query('select * from hub.brands where rem_brand_id like $1 order by rem_brand_id',[prefix+'%'])).rows;
    assert.equal(brands.length,2);
    for(const b of brands){assert.deepEqual(b.description,{});assert.equal(b.published_version_id,null);assert.equal(b.source_name_provenance.manifest_sha256,hash);assert.ok(b.unconfirmed_source_names.includes('th'));}
    assert.equal(brands[1].slug,'');assert.deepEqual(brands[1].public_name,{th:'แบรนด์สมมติ bulk ข'});
    await db.query('reset role');
    const audits=(await db.query("select actor,database_role,operation from audit.change_log where table_name='hub.brands' and after_row->>'id'=any($1::text[])",[brands.map(b=>b.id)])).rows;
    assert.equal(audits.length,2);assert.ok(audits.every(a=>a.actor==='00000000-0000-0000-0000-000000000005'&&a.database_role==='admin'&&a.operation==='INSERT'));
    await role('editor');
    await db.query('select hub.update_brand_draft(id,$2,updated_at) from hub.brands where id=$1',[brands[0].id,{description:{th:'รายละเอียดสมมติ'}}]);
    assert.deepEqual((await db.query('select unconfirmed_source_names from hub.brands where id=$1',[brands[0].id])).rows[0].unconfirmed_source_names,['en','th']);
    await db.query('select hub.update_brand_draft(id,$2,updated_at) from hub.brands where id=$1',[brands[0].id,{public_name:{...brands[0].public_name,th:'ชื่อที่ผู้แก้ไขยืนยันแล้ว'}}]);
    assert.deepEqual((await db.query('select unconfirmed_source_names from hub.brands where id=$1',[brands[0].id])).rows[0].unconfirmed_source_names,['en']);
    await db.query('select hub.confirm_brand_source_names(id,updated_at) from hub.brands where id=$1',[brands[0].id]);
    assert.deepEqual((await db.query('select unconfirmed_source_names from hub.brands where id=$1',[brands[0].id])).rows[0].unconfirmed_source_names,[]);
    await role('admin');const before=(await db.query('select * from hub.brands where rem_brand_id like $1 order by rem_brand_id',[prefix+'%'])).rows;
    assert.equal((await db.query('select hub.brand_bulk_create($1,$2,true,$3) r',[hash,preview.preview_sha256,'Synthetic replay'])).rows[0].r.created_count,0);
    assert.deepEqual((await db.query('select * from hub.brands where rem_brand_id like $1 order by rem_brand_id',[prefix+'%'])).rows,before);
    assert.equal((await db.query('select hub.brand_bulk_preview($1) p',[hash])).rows[0].p.create_count,0);
    const dashboard=(await db.query('select hub.brand_completeness() d')).rows[0].d;
    assert.equal(dashboard.counts.total,dashboard.rows.length);
    assert.equal(dashboard.counts.missing_data,dashboard.rows.filter(r=>r.status!=='not_created'&&!r.readiness.ready).length);
    assert.equal(dashboard.counts.ready,dashboard.rows.filter(r=>r.status!=='not_created'&&r.readiness.ready&&(!r.publication_available||r.has_unpublished_changes)).length);
    assert.equal(dashboard.counts.published,dashboard.rows.filter(r=>r.publication_available).length);
    assert.equal(dashboard.counts.not_created,dashboard.rows.filter(r=>r.status==='not_created').length);
    assert.equal(dashboard.rows.find(r=>r.rem_brand_id===prefix+'a').checks.name_th_confirmed,true);
    assert.equal(dashboard.rows.find(r=>r.rem_brand_id===prefix+'b').checks.name_th_confirmed,false);
    // Give one member full ordinary readiness; no provenance flag bypass changes that gate.
    const asset=(await db.query('select hub.register_uploaded_asset($1) r',[{original_filename:'synthetic-bulk-28.png',mime_type:'image/png',asset_type:'image',storage_path:'f'.repeat(64)+'.png',checksum:'f'.repeat(64),file_size:10,width:32,height:32}])).rows[0].r.asset.id;
    await db.query('select hub.bind_brand_asset(id,$2,$3,$4,updated_at) from hub.brands where id=$1',[brands[0].id,asset,'logo_primary',{th:'โลโก้สมมติ'}]);
    await role('publisher');await db.query("select hub.review_asset(id,updated_at,'approved',$2,null,null,$2) from hub.assets where id=$1",[asset,'Synthetic bulk rights']);
    await db.query('reset role');
    let members=(await db.query("select jsonb_build_object('entity_type','brand','entity_id',id,'expected_updated_at',updated_at,'expected_published_version_id',published_version_id) m from hub.brands where id=any($1::uuid[]) order by id",[brands.map(b=>b.id)])).rows.map(r=>r.m);
    const releases=(await db.query('select count(*)::int n from hub.publication_releases')).rows[0].n;
    await role('publisher');await denial('select hub.release_publish($1,$2,false)',[JSON.stringify(members),'Synthetic not-ready batch'],'23514');
    await db.query('reset role');assert.equal((await db.query('select count(*)::int n from hub.publication_releases')).rows[0].n,releases);
    assert.ok((await db.query('select published_version_id from hub.brands where id=any($1::uuid[])',[brands.map(b=>b.id)])).rows.every(b=>b.published_version_id===null));
    await role('editor');await db.query('select hub.update_brand_draft(id,$2,updated_at) from hub.brands where id=$1',[brands[1].id,{description:{th:'รายละเอียดสมมติ ข'},slug:'synthetic-bulk-beta'}]);
    await db.query('select hub.bind_brand_asset(id,$2,$3,$4,updated_at) from hub.brands where id=$1',[brands[1].id,asset,'logo_primary',{th:'โลโก้สมมติ ข'}]);
    await db.query('reset role');members=(await db.query("select jsonb_build_object('entity_type','brand','entity_id',id,'expected_updated_at',updated_at,'expected_published_version_id',published_version_id) m from hub.brands where id=any($1::uuid[]) order by id",[brands.map(b=>b.id)])).rows.map(r=>r.m);
    await role('publisher');const release=(await db.query('select hub.release_publish($1,$2,false) r',[JSON.stringify(members),'Synthetic ready batch'])).rows[0].r;
    assert.equal(release.members.length,2);assert.equal(release.demo_mode,false);
    await role('viewer');const final=(await db.query('select hub.brand_completeness() d')).rows[0].d;
    assert.ok(final.rows.filter(r=>r.rem_brand_id.startsWith(prefix)&&r.public_brand_id).every(r=>r.status==='published'&&r.readiness.percent===100));
    await role('service_consumer');await denial('select hub.brand_completeness()',[],'42501');
  }finally{await db.query('rollback').catch(()=>{});await db.end();}
});
