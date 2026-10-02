// Preview first; apply accepts only the exact explicitly confirmed preview hash.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { localTarget, assertLocalTarget } from './provision-dw-reader.mjs';
const root=new URL('../',import.meta.url),folder=new URL('.local/brand-bulk/',root);
const args=process.argv.slice(2),config=JSON.parse(await readFile(new URL('.local/development.json',root),'utf8'));
assert.ok(args.length===0 || args.length===2 && args[0]==='--confirm-preview' && /^[a-f0-9]{64}$/.test(args[1]),'Use no arguments to preview or --confirm-preview <confirmed hash>');
const db=new pg.Client({...localTarget,user:'postgres',password:config.adminPassword});
try {
  await db.connect();assertLocalTarget((await db.query('select current_database() database,host(inet_server_addr()) host,inet_server_port() port')).rows[0]);
  await db.query('begin');await db.query('set local role admin');await db.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true)");
  if(args.length) {
    const saved=JSON.parse(await readFile(new URL(`${args[1]}.json`,folder),'utf8'));
    const result=(await db.query('select hub.brand_bulk_create($1,$2,true,$3) result',[saved.manifest_sha256,args[1],'ผู้ดูแลยืนยันรายการพรีวิวสร้างฉบับร่างจาก DW ภายในเครื่อง'])).rows[0].result;
    await db.query('commit');console.log(JSON.stringify(result));
  } else {
    const preview=(await db.query('select hub.brand_bulk_preview() preview')).rows[0].preview;
    await db.query('rollback');await mkdir(folder,{recursive:true});
    await writeFile(new URL(`${preview.preview_sha256}.json`,folder),JSON.stringify(preview,null,2)+'\n');
    const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const reasons={deleted:'ต้นทางถูกลบ',unknown_status:'ยังไม่ทราบสถานะ',blank_name:'ไม่มีชื่อภาษาไทย',duplicate:'ชื่อซ้ำ',no_residential_project:'ไม่มีโครงการที่อยู่อาศัย',already_created:'มีแบรนด์แล้ว เก็บงานเดิม',archived:'เก็บถาวรแล้ว'};
    await writeFile(new URL(`${preview.preview_sha256}.html`,folder),`<!doctype html><html lang="th"><meta charset="utf-8"><title>พรีวิวสร้างฉบับร่างแบรนด์</title><style>body{font:16px/1.6 Tahoma,sans-serif;margin:24px;color:#152826}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #ccc;text-align:left}code{overflow-wrap:anywhere}th{background:#eff8f7}</style><h1>พรีวิวสร้างฉบับร่างแบรนด์ ${preview.create_count} รายการ · ภายในเครื่องเท่านั้น</h1><p>ชื่อไทย/อังกฤษเป็นค่าจากต้นทาง ยังไม่ยืนยัน แก้ไขได้ · slug เป็นข้อเสนอจากชื่อต้นทางภาษาอังกฤษ · คำอธิบายและโลโก้ว่าง · ไม่เผยแพร่</p><p>รายการที่ไม่สร้างมีเหตุผลในตาราง งานที่มีอยู่ไม่ถูกแก้ไข</p><code>${preview.preview_sha256}</code><table><thead><tr><th>REM ID</th><th>ชื่อไทย</th><th>ชื่ออังกฤษ</th><th>slug ที่เสนอ</th><th>โครงการที่อยู่อาศัย</th><th>ผล</th></tr></thead><tbody>${preview.rows.map(r=>`<tr>${[r.rem_brand_id,r.public_name.th,r.public_name.en,r.suggested_slug,r.residential_project_count,r.eligible?'จะสร้างฉบับร่าง':r.reason_codes.map(c=>reasons[c]).join(' · ')].map(v=>`<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></html>`);
    console.log(JSON.stringify({create_count:preview.create_count,preview_sha256:preview.preview_sha256,preview_file:`.local/brand-bulk/${preview.preview_sha256}.html`,excluded:preview.rows.filter(r=>!r.eligible).map(r=>({rem_brand_id:r.rem_brand_id,reasons:r.reason_codes}))},null,2));
  }
} catch(error) {await db.query('rollback').catch(()=>{});console.error(`Local brand preview/create failed (${error.code??error.name}); credentials and SQL are not logged.`);process.exitCode=1;}
finally {await db.end();}
