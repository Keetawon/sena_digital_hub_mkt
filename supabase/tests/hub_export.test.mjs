import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
await assertDisposableTestDatabase();
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { localTarget, hubExportViews, readerFile, verifyReader } from '../../scripts/provision-dw-reader.mjs';
import { contentFixture, seedHubContentContract } from '../../scripts/seed-hub-content-contract.mjs';

const folder = new URL('./fixtures/hub_export/', import.meta.url);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const columns = identity => [identity, identity === 'rem_brand_id' ? 'public_brand_id' : 'public_project_id',
  'public_name_th', 'public_name_en', 'slug', 'published_version_id', 'published_at', 'logo_roles_present'];

test('published fixtures freeze both exact projections, text IDs, null English and provenance', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', folder), 'utf8'));
  assert.equal(manifest.contract_version, 'hub-published-content-v1');
  assert.equal(manifest.environment, 'local-test');
  assert.equal(manifest.source_key, 'hub');
  assert.equal(manifest.synthetic_only, true);
  assert.match(manifest.hub_commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(manifest.transaction, { role: 'dw_hub_reader', isolation: 'repeatable read', read_only: true, timezone: 'UTC', snapshot_shared_with_provenance_checks: true });
  assert.deepEqual(manifest.views.map(v => v.view), hubExportViews.map(v => `hub_export.${v}`));
  for (const view of manifest.views) {
    const bytes = await readFile(new URL(view.file, folder)), rows = JSON.parse(bytes);
    assert.equal(bytes.length, view.bytes);
    assert.equal(sha256(bytes), view.sha256);
    assert.equal(rows.length, view.row_count);
    assert.ok(rows.length > 0);
    const identity = view.view.endsWith('brand_published') ? 'rem_brand_id' : 'rem_project_id';
    assert.deepEqual(view.columns.map(c => c.name), columns(identity));
    assert.deepEqual(view.columns.map(c => c.postgres_type), ['text', 'text', 'text', 'text', 'text', 'uuid', 'timestamp with time zone', 'text[]']);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row), columns(identity));
      assert.equal(typeof row[identity], 'string');
      assert.ok(row[identity] === 'DEMO-BRAND-01' || row[identity].startsWith('00000-HUB-EXPORT-'));
      assert.deepEqual(row.logo_roles_present, [...new Set(row.logo_roles_present)].sort());
      assert.ok(row.logo_roles_present.every(role => ['favicon', 'logo_mono', 'logo_primary', 'logo_white'].includes(role)));
      assert.ok(Number.isFinite(Date.parse(row.published_at)));
    }
    if (identity === 'rem_project_id') assert.equal(rows[0].public_name_en, null);
  }
  for (const entry of [...manifest.migration_checksums, ...manifest.generator_checksums]) {
    const bytes = await readFile(new URL(`../../${entry.file}`, import.meta.url));
    assert.equal(sha256(bytes.toString('utf8').replace(/\r\n/g, '\n')), entry.normalized_lf_sha256, entry.file);
  }
});

test('DW sees frozen publications, original project logo roles and eligibility; ACLs deny private reads and writes', async () => {
  // SET ROLE authorization uses session_user; test escalation with the real login.
  await verifyReader(JSON.parse(await readFile(readerFile, 'utf8')));
  const config = JSON.parse(await readFile(new URL('../../.local/development.json', import.meta.url), 'utf8'));
  const db = new pg.Client({ ...localTarget, user: 'postgres', password: config.adminPassword });
  const f = contentFixture;
  await db.connect();
  try {
    await db.query('begin');
    const fixture = await seedHubContentContract(db);
    const role = async name => {
      await db.query(`set local role ${name}`);
      const actor = { admin: '00000000-0000-0000-0000-000000000005', editor: '00000000-0000-0000-0000-000000000001', publisher: '00000000-0000-0000-0000-000000000002' }[name];
      if (actor) await db.query("select set_config('app.actor_id',$1,true)", [actor]);
    };
    const published = async () => {
      await role('dw_hub_reader');
      const brands = (await db.query('select * from hub_export.brand_published where rem_brand_id=$1', [f.brand])).rows;
      const projects = (await db.query('select * from hub_export.project_published where rem_project_id=$1', [f.project])).rows;
      await db.query('reset role');
      return { brands, projects };
    };
    const before = await published();
    assert.equal(before.brands.length, 1);
    assert.equal(before.projects.length, 1);
    assert.equal(before.projects[0].model_catalogue_complete, true);
    assert.equal(before.projects[0].model_catalogue_complete, true);
    assert.equal(before.brands[0].published_version_id, fixture.published_version_id);
    assert.equal(before.projects[0].published_version_id, fixture.project_version);
    assert.deepEqual(before.brands[0].logo_roles_present, ['favicon', 'logo_mono', 'logo_primary', 'logo_white']);
    assert.deepEqual(before.projects[0].logo_roles_present, before.brands[0].logo_roles_present);
    // A brand with only an unpublished draft is never exported.
    await db.query("insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_fingerprint) values('00000-HUB-EXPORT-DRAFT','Synthetic unpublished','synthetic')");
    await role('admin');
    await db.query("select hub.create_brand_from_rem('00000-HUB-EXPORT-DRAFT')");
    await role('dw_hub_reader');
    assert.equal((await db.query("select * from hub_export.brand_published where rem_brand_id='00000-HUB-EXPORT-DRAFT'")).rowCount, 0);
    await db.query('reset role');
    await role('editor');
    await db.query('select hub.update_brand_draft(id,$2,updated_at) from hub.brands where id=$1', [fixture.id, { public_name: { th: 'ฉบับร่างสมมติเปลี่ยนแล้ว', en: 'Changed synthetic draft' }, slug: 'synthetic-hub-export-changed' }]);
    await db.query('select hub.patch_project(id,$2,updated_at) from hub.projects where id=$1', [fixture.project_id, { public_name: { th: 'โครงการฉบับร่างสมมติ' }, slug: 'synthetic-hub-export-project-changed' }]);
    await db.query("select hub.unbind_brand_asset(b.id,a.id,b.updated_at) from hub.brands b join hub.brand_assets a on a.brand_id=b.id and a.asset_role='logo_white' and a.deleted_at is null where b.id=$1", [fixture.id]);
    assert.deepEqual(await published(), before);
    await role('publisher');
    await db.query('select hub.publish_brand($1,$2)', [fixture.id, f.marker]);
    const next = await published();
    assert.equal(next.brands[0].public_name_th, 'ฉบับร่างสมมติเปลี่ยนแล้ว');
    assert.notEqual(next.brands[0].published_version_id, before.brands[0].published_version_id);
    assert.deepEqual(next.brands[0].logo_roles_present, ['favicon', 'logo_mono', 'logo_primary']);
    assert.deepEqual(next.projects, before.projects);
    await role('publisher');
    await db.query('select hub.withdraw_brand($1,$2)', [fixture.id, f.marker]);
    assert.deepEqual(await published(), { brands: [], projects: [] });
    await role('publisher');
    await db.query('select hub.rollback_brand($1,$2,$3)', [fixture.id, fixture.published_version_id, f.marker]);
    assert.deepEqual(await published(), before);
    await role('publisher');
    await db.query('select hub.withdraw_project($1,$2)', [fixture.project_id, f.marker]);
    assert.deepEqual((await published()).projects, []);
    await role('publisher');
    await db.query('select hub.rollback_project($1,$2,$3)', [fixture.project_id, fixture.project_version, f.marker]);
    assert.deepEqual(await published(), before);
    await db.query('update staging.rem_brands set is_deleted=null where rem_brand_id=$1', [f.brand]);
    assert.deepEqual(await published(), { brands: [], projects: [] });
    await db.query('update staging.rem_brands set is_deleted=false where rem_brand_id=$1', [f.brand]);
    const logo = (await db.query("select id from hub.assets where original_filename=$1", [`${f.marker}-logo_primary.png`])).rows[0].id;
    await role('publisher');
    await db.query("select hub.review_asset(id,updated_at,'revoked',$2,null,null,$2) from hub.assets where id=$1", [logo, f.marker]);
    assert.deepEqual(await published(), { brands: [], projects: [] });
    await role('publisher');
    await db.query("select hub.review_asset(id,updated_at,'approved',$2,null,null,$2) from hub.assets where id=$1", [logo, f.marker]);
    assert.deepEqual(await published(), before);
    // A SET ROLE probe deliberately runs in READ WRITE; ACLs must be sufficient.
    await role('dw_hub_reader');
    assert.equal((await db.query('show transaction_read_only')).rows[0].transaction_read_only, 'off');
    for (const view of hubExportViews) assert.equal((await db.query("select has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed", [`hub_export.${view}`])).rows[0].allowed, false);
    for (const sql of ['select * from hub.brands', 'select * from staging.intake_batches', 'select * from public_api.brands',
      "select public_api.asset_file('00000000-0000-0000-0000-000000000000')",
      'create table hub_export.must_not_exist(id int)',
      ...hubExportViews.flatMap(view => [`delete from hub_export.${view} where false`, `update hub_export.${view} set slug=slug where false`, `insert into hub_export.${view} select * from hub_export.${view} where false`])]) {
      await db.query('savepoint denial');
      await assert.rejects(db.query(sql), error => error.code === '42501' || sql.includes('hub_export.') && ['55000', '0A000'].includes(error.code));
      await db.query('rollback to savepoint denial');
      await db.query('release savepoint denial');
    }
    await db.query('reset role');
    for (const name of ['admin', 'editor', 'publisher', 'viewer', 'online_staff', 'agency', 'service_consumer']) {
      assert.equal((await db.query("select has_schema_privilege($1,'hub_export','USAGE,CREATE') allowed", [name])).rows[0].allowed, false);
    }
  } finally { await db.query('rollback').catch(() => {}); await db.end(); }
});
