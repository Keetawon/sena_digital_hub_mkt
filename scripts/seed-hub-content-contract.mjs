// Invented localhost contract examples, prepared through the normal guarded workflow.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const contentFixture = Object.freeze({
  brand: '00000-HUB-EXPORT-BRAND', project: '00000-HUB-EXPORT-PROJECT',
  marker: 'SYNTHETIC-HUB-CONTENT-CONTRACT-V1',
  brandName: 'แบรนด์สมมติสำหรับสัญญา DW', projectName: 'โครงการสมมติสำหรับสัญญา DW',
});

export async function seedHubContentContract(client) {
  const f = contentFixture;
  const existing = (await client.query('select b.id,b.public_brand_id,b.published_version_id,p.id project_id,p.public_project_id,p.published_version_id project_version from hub.brands b left join hub.projects p on p.rem_project_id=$2 where b.rem_brand_id=$1', [f.brand, f.project])).rows;
  if (existing.length) {
    assert.equal(existing.length, 1);
    const provenance = (await client.query('select source_record from staging.rem_brands where rem_brand_id=$1', [f.brand])).rows[0];
    assert.deepEqual(provenance?.source_record, { synthetic_only: true, fixture: f.marker });
    assert.ok(existing[0].published_version_id && existing[0].project_version, 'Existing fixture is incomplete or withdrawn; do not reset it');
    return existing[0];
  }
  assert.equal((await client.query('select 1 from staging.rem_brands where rem_brand_id=$1 union all select 1 from staging.rem_projects where rem_project_id=$2', [f.brand, f.project])).rowCount, 0, 'Conflicting synthetic source identity');
  const evidence = { synthetic_only: true, fixture: f.marker };
  await client.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true),set_config('app.change_reason',$1,true)", [f.marker]);
  await client.query('insert into staging.rem_brands(rem_brand_id,brand_name_rem,brand_name_en_rem,source_updated_at,source_fingerprint,source_record) values($1,$2,$3,now(),$4,$5)', [f.brand, 'ชื่อต้นทางสมมติ', 'Synthetic source label', f.marker, evidence]);
  await client.query('insert into staging.rem_projects(rem_project_id,project_name_rem,rem_brand_id,source_updated_at,source_fingerprint,source_record) values($1,$2,$3,now(),$4,$5)', [f.project, 'โครงการต้นทางสมมติ', f.brand, f.marker, evidence]);
  await client.query('insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint,source_record) values($1,$2,$3,now(),$4,$5)', [f.project, '00000-HUB-EXPORT-MODEL', 'แบบต้นทางสมมติ', f.marker, evidence]);
  await client.query('set local role admin');
  const brand = (await client.query('select hub.create_brand_from_rem($1) id', [f.brand])).rows[0].id;
  await client.query('select hub.update_brand_draft(id,$2,updated_at) from hub.brands where id=$1', [brand, { public_name: { th: f.brandName, en: 'Synthetic DW contract brand' }, description: { th: 'ข้อมูลสังเคราะห์สำหรับทดสอบสัญญาเท่านั้น' }, slug: 'synthetic-hub-export-brand' }]);
  const assets = {};
  for (const role of ['logo_primary', 'logo_white', 'logo_mono', 'favicon', 'hero', 'thumbnail']) {
    const checksum = createHash('sha256').update(`${f.marker}:${role}`).digest('hex');
    const asset = (await client.query('select hub.register_uploaded_asset($1) result', [{ original_filename: `${f.marker}-${role}.png`, mime_type: 'image/png', asset_type: 'image', storage_path: `${checksum}.png`, checksum, file_size: 100, width: 32, height: 32 }])).rows[0].result.asset.id;
    assets[role] = asset;
    if (role !== 'hero' && role !== 'thumbnail') await client.query('select hub.bind_brand_asset(id,$2,$3,$4,updated_at) from hub.brands where id=$1', [brand, asset, role, { th: 'โลโก้สมมติสำหรับทดสอบ' }]);
  }
  await client.query('set local role publisher');
  await client.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true)");
  for (const asset of Object.values(assets)) await client.query("select hub.review_asset(id,updated_at,'approved',$2,null,null,$2) from hub.assets where id=$1", [asset, f.marker]);
  await client.query('select hub.publish_brand($1,$2)', [brand, f.marker]);
  await client.query('set local role editor');
  await client.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true)");
  const project = (await client.query('select hub.create_project_from_rem($1) id', [f.project])).rows[0].id;
  await client.query('select hub.assign_project_brand(id,$2,updated_at) from hub.projects where id=$1', [project, brand]);
  await client.query('select hub.patch_project(id,$2,updated_at) from hub.projects where id=$1', [project, { public_name: { th: f.projectName }, slug: 'synthetic-hub-export-project', address: { th: 'ที่อยู่สมมติสำหรับทดสอบ' }, latitude: 0, longitude: 0, ad_disclaimer: { th: 'ข้อมูลสังเคราะห์ ไม่ใช่ข้อเสนอขาย' } }]);
  const model = (await client.query('select public_model_id from hub.model_types where project_id=$1', [project])).rows[0].public_model_id;
  await client.query('select hub.update_model(id,$2,$3,updated_at) from hub.projects where id=$1', [project, model, { public_name: { th: 'แบบสมมติสำหรับทดสอบ' }, bedrooms: 1, bathrooms: 1, usable_area_sqm: 32 }]);
  await client.query("select hub.review_model(id,$2,updated_at,'CONFIRMED',$3) from hub.projects where id=$1", [project, model, f.marker]);
  for (const role of ['hero', 'thumbnail']) await client.query('select hub.bind_project_asset(id,$2,$3,$4,updated_at) from hub.projects where id=$1', [project, assets[role], role, { th: 'ภาพสมมติสำหรับทดสอบ' }]);
  await client.query('set local role publisher');
  await client.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true)");
  await client.query('select hub.publish_project($1,$2)', [project, f.marker]);
  await client.query('reset role');
  return (await client.query('select b.id,b.public_brand_id,b.published_version_id,p.id project_id,p.public_project_id,p.published_version_id project_version from hub.brands b cross join hub.projects p where b.id=$1 and p.id=$2', [brand, project])).rows[0];
}
