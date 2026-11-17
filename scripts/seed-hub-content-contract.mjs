// Invented localhost contract examples, prepared through the normal guarded workflow.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export const contentFixture = Object.freeze({
  brand: '00000-HUB-EXPORT-BRAND', project: '00000-HUB-EXPORT-PROJECT',
  marker: 'SYNTHETIC-HUB-CONTENT-CONTRACT-V1',
  brandName: 'แบรนด์สมมติสำหรับสัญญา DW', projectName: 'โครงการสมมติสำหรับสัญญา DW',
});

// Caller already owns its verified synthetic-seed transaction. No connection/config IO.
export async function syntheticWorkflowActors(client, manager) {
  await client.query('reset role');
  await client.query("select set_config('app.actor_id',$1,true)", [manager]);
  const actors = { author: manager, reviewer: randomUUID(), publisher: randomUUID() };
  for (const purpose of ['reviewer', 'publisher']) {
    const id = actors[purpose];
    await client.query("insert into hub.user_account(id,email,display_name_th,status,hub_role) values($1,$2,$3,'ACTIVE',$4)",
      [id, `synthetic-w4-${purpose}-${id}@example.test`, `Synthetic W4 ${purpose}`, purpose === 'reviewer' ? 'publisher' : 'viewer']);
    const tabs = Object.fromEntries(['projects', 'brands', 'knowledge', 'promotions'].map(tab => [tab, purpose === 'reviewer' ? ['view', 'approve'] : ['view']]));
    tabs.releases = ['view'];
    if (purpose === 'publisher') tabs.knowledge.push('knowledge.publish_web');
    await client.query("select hub.configure_account_access(id,jsonb_build_object('updated_at',updated_at,'tabs',$2::jsonb,'can_manage_users',false,'note','Explicit synthetic fixture persona')) from hub.user_account where id=$1", [id, JSON.stringify(tabs)]);
  }
  return actors;
}

export async function approveSyntheticItem(client, actors, kind, identity) {
  await client.query('reset role');
  await client.query("select set_config('app.actor_id',$1,true)", [actors.author]);
  let item = (await client.query('select hub.content_workflow_read($1,$2::jsonb) value', [kind, JSON.stringify(identity)])).rows[0].value;
  if (['APPROVED', 'PUBLISHED'].includes(item.state) && !item.needs_reapproval) return item;
  if (item.state !== 'IN_REVIEW') await client.query('select hub.content_workflow_submit($1,$2::jsonb,$3)', [kind, JSON.stringify(identity), item.expected_hash]);
  await client.query("select set_config('app.actor_id',$1,true)", [actors.reviewer]);
  item = (await client.query('select hub.content_workflow_read($1,$2::jsonb) value', [kind, JSON.stringify(identity)])).rows[0].value;
  const approved = (await client.query("select hub.content_workflow_review($1,$2::jsonb,$3,'approve','Independent synthetic fixture approval') value", [kind, JSON.stringify(identity), item.expected_hash])).rows[0].value;
  assert.equal(approved.state, 'APPROVED'); assert.equal(approved.self_approval, false);
  return approved;
}

export async function approveSyntheticEntity(client, actors, kind, id) {
  assert.ok(['project', 'brand'].includes(kind));
  await client.query('reset role'); await client.query("select set_config('app.actor_id',$1,true)", [actors.author]);
  const table = kind === 'project' ? 'projects' : 'brands', column = kind === 'project' ? 'public_project_id' : 'public_brand_id';
  const value = (await client.query(`select hub.${kind}_detail(${column}) value from hub.${table} where id=$1`, [id])).rows[0].value;
  const targets = [{ kind, identity: { id } }];
  const assets = (rows, binding) => { for (const asset of rows ?? []) targets.push({ kind: 'asset', identity: { id: asset.id } }, { kind: binding, identity: { id: asset.binding_id } }); };
  const preview = value.publication_preview;
  const included = asset => preview.assets.some(row => row.public_asset_id === `ast_${asset.checksum ?? createHash('sha256').update(asset.id).digest('hex')}` && row.asset_role === asset.asset_role && (row.public_model_id ?? null) === (asset.public_model_id ?? null));
  assets(value.assets.filter(included), kind === 'project' ? 'project_asset' : 'brand_asset');
  if (kind === 'project') {
    for (const model of value.models.filter(model => preview.models.some(row => row.public_model_id === model.public_model_id))) {
      const row = (await client.query('select id from hub.model_types where project_id=$1 and public_model_id=$2', [id, model.public_model_id])).rows[0];
      targets.push({ kind: 'model', identity: { id: row.id } }); assets(model.assets, 'project_asset');
    }
    for (const item of (value.facilities?.items ?? []).filter(row => row.updated_at)) targets.push({ kind: 'facility', identity: { project_id: id, facility_code: item.code ?? item.facility_code } });
  }
  const seen = new Set();
  for (const target of targets) {
    const key = JSON.stringify(target);
    if (!seen.has(key)) { await approveSyntheticItem(client, actors, target.kind, target.identity); seen.add(key); }
  }
}

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
  const actors = await syntheticWorkflowActors(client, '00000000-0000-0000-0000-000000000005');
  await client.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true),set_config('app.change_reason',$1,true)", [f.marker]);
  await client.query('insert into staging.rem_brands(rem_brand_id,brand_name_rem,brand_name_en_rem,source_updated_at,source_fingerprint,source_record) values($1,$2,$3,now(),$4,$5)', [f.brand, 'ชื่อต้นทางสมมติ', 'Synthetic source label', f.marker, evidence]);
  await client.query('insert into staging.rem_projects(rem_project_id,project_name_rem,rem_brand_id,source_updated_at,source_fingerprint,source_record) values($1,$2,$3,now(),$4,$5)', [f.project, 'โครงการต้นทางสมมติ', f.brand, f.marker, evidence]);
  await client.query('insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint,source_record) values($1,$2,$3,now(),$4,$5)', [f.project, '00000-HUB-EXPORT-MODEL', 'แบบต้นทางสมมติ', f.marker, evidence]);
  await client.query('set local role admin');
  const brand = (await client.query('select hub.create_brand_from_rem($1) id', [f.brand])).rows[0].id;
  const project = (await client.query('select hub.create_project_from_rem($1) id', [f.project])).rows[0].id;
  await client.query('select hub.update_brand_draft(id,$2,updated_at) from hub.brands where id=$1', [brand, { public_name: { th: f.brandName, en: 'Synthetic DW contract brand' }, description: { th: 'ข้อมูลสังเคราะห์สำหรับทดสอบสัญญาเท่านั้น' }, slug: 'synthetic-hub-export-brand' }]);
  // Metadata-only historical contract fixture: invented hashes and no stored bytes.
  // It cannot enter the file processor; real operator uploads use the W9 API.
  const assets = {};
  for (const role of ['logo_primary', 'logo_white', 'logo_mono', 'favicon', 'hero', 'thumbnail']) {
    const checksum = createHash('sha256').update(`${f.marker}:${role}`).digest('hex');
    const asset = (await client.query('select hub.register_uploaded_asset($1) result', [{ original_filename: `${f.marker}-${role}.png`, mime_type: 'image/png', asset_type: 'image', storage_path: `${checksum}.png`, checksum, file_size: 100, width: 32, height: 32 }])).rows[0].result.asset.id;
    assets[role] = asset;
    if (role !== 'hero' && role !== 'thumbnail') await client.query('select hub.bind_brand_asset(id,$2,$3,$4,updated_at) from hub.brands where id=$1', [brand, asset, role, { th: 'โลโก้สมมติสำหรับทดสอบ' }]);
    else await client.query('select hub.bind_project_asset(id,$2,$3,$4,updated_at) from hub.projects where id=$1',[project,asset,role,{th:'ภาพสมมติสำหรับทดสอบ'}]);
  }
  // Confirm only these named synthetic publication assets through the ordinary
  // metadata writer. Upload/approval defaults remain internal and unconfirmed.
  await client.query('set local role hub_app');
  for (const [role, asset] of Object.entries(assets)) {
    await client.query(`select hub.media_save_asset(p.public_project_id,a.id,a.media_revision,
      jsonb_build_object('media_category',$3::text,'metadata_state','confirmed','marketing_publication',true,
        'ai_exposure','web_only','alt_text',coalesce(
          (select b.alt_text from hub.brand_assets b where b.asset_id=a.id and b.deleted_at is null limit 1),
          (select b.alt_text from hub.entity_assets b where b.asset_id=a.id and b.deleted_at is null limit 1))))
      from hub.projects p cross join hub.assets a where p.id=$1 and a.id=$2`,
      [project, asset, ['hero', 'thumbnail'].includes(role) ? 'exterior' : 'promotion_ad']);
  }
  await client.query('set local role publisher');
  await client.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true)");
  for (const asset of Object.values(assets)) await client.query("select hub.review_asset(id,updated_at,'approved',$2,null,null,$2) from hub.assets where id=$1", [asset, f.marker]);
  await approveSyntheticEntity(client, actors, 'brand', brand);
  await client.query("select set_config('app.actor_id',$1,true)", [actors.publisher]);
  await client.query('select hub.publish_brand($1,$2)', [brand, f.marker]);
  await client.query('set local role editor');
  await client.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true)");
  await client.query('select hub.assign_project_brand(id,$2,updated_at) from hub.projects where id=$1', [project, brand]);
  await client.query('select hub.patch_project(id,$2,updated_at) from hub.projects where id=$1', [project, { public_name: { th: f.projectName }, slug: 'synthetic-hub-export-project', address: { th: 'ที่อยู่สมมติสำหรับทดสอบ' }, latitude: 13.7563, longitude: 100.5018, ad_disclaimer: { th: 'ข้อมูลสังเคราะห์ ไม่ใช่ข้อเสนอขาย' } }]);
  const model = (await client.query('select public_model_id from hub.model_types where project_id=$1', [project])).rows[0].public_model_id;
  await client.query('select hub.update_model(id,$2,$3,updated_at) from hub.projects where id=$1', [project, model, { public_name: { th: 'แบบสมมติสำหรับทดสอบ' }, bedrooms: 1, bathrooms: 1, usable_area_sqm: 32 }]);
  await client.query("select hub.review_model(id,$2,updated_at,'CONFIRMED',$3) from hub.projects where id=$1", [project, model, f.marker]);
  for (const role of ['hero', 'thumbnail']) await client.query('select hub.bind_project_asset(id,$2,$3,$4,updated_at) from hub.projects where id=$1', [project, assets[role], role, { th: 'ภาพสมมติสำหรับทดสอบ' }]);
  await client.query('set local role publisher');
  await client.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true)");
  await approveSyntheticEntity(client, actors, 'project', project);
  await client.query("select set_config('app.actor_id',$1,true)", [actors.publisher]);
  await client.query('select hub.publish_project($1,$2)', [project, f.marker]);
  await client.query('reset role');
  return (await client.query('select b.id,b.public_brand_id,b.published_version_id,p.id project_id,p.public_project_id,p.published_version_id project_version from hub.brands b cross join hub.projects p where b.id=$1 and p.id=$2', [brand, project])).rows[0];
}
