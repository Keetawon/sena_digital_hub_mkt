import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';
await assertDisposableTestDatabase();
// Local TEST only: competing complete releases and draft changes cannot overwrite state.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';

const local = JSON.parse(await readFile('.local/development.json', 'utf8'));
const config = { host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: local.adminPassword };
const [setup, first, second] = [new pg.Client(config), new pg.Client(config), new pg.Client(config)];
const actor = randomUUID(), key = `SQL-RES-RACE-${randomUUID()}`.toUpperCase();
let pending;
let actors;
const begin = async (client, role = 'publisher') => {
  await client.query('begin');
  await client.query("select set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", [role==='editor'?'00000000-0000-0000-0000-000000000001':actors.publisher, key]);
  await client.query(`set local role ${role}`);
};
const rpc = async (client, action, id, payload) => (await client.query('select hub.promotion_command($1,$2,$3::jsonb) value', [action, id, JSON.stringify(payload)])).rows[0].value;
const publish = async (client, members) => (await client.query('select hub.release_publish($1::jsonb,$2,false) value', [JSON.stringify(members), key])).rows[0].value;
let secondPid;
async function releaseLock(promise) {
  pending = promise; pending.catch(() => {});
  let blocked = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = (await setup.query('select wait_event_type from pg_stat_activity where pid=$1', [secondPid])).rows[0];
    if (state?.wait_event_type === 'Lock') { blocked = true; break; }
    await setTimeout(25);
  }
  assert.ok(blocked, 'Second release must wait for the shared parent/member lock');
  await first.query('commit');
  return pending;
}
try {
  await Promise.all([setup.connect(), first.connect(), second.connect()]);
  secondPid = (await second.query('select pg_backend_pid() pid')).rows[0].pid;
  await setup.query("insert into hub.user_account(id,email,status,hub_role) values($1,$2,'ACTIVE','admin')",[actor,actor+'@example.test']);
  await setup.query(await readFile(new URL('./fixtures/content_workflow.sql', import.meta.url), 'utf8'));
  await setup.query("select set_config('app.w4_fixture_scope','SYNTHETIC-W4-DISPOSABLE',false)");
  actors=(await setup.query('select pg_temp.w4_setup($1) value',[actor])).rows[0].value;
  // Reuse the self-contained SQL fixture, replacing every identity/checksum for isolation.
  let fixture = (await readFile(new URL('./residential_demo.sql', import.meta.url), 'utf8')).split('-- Every new table')[0];
  fixture = fixture.replaceAll('00000000-0000-0000-0000-000000000005', actor)
    .replaceAll('SQL-RESIDENTIAL-21', key).replaceAll('sql-residential-project-21', `${key.toLowerCase()}-project`)
    .replaceAll('sql-residential-21', key.toLowerCase()).replaceAll('SYNTHETIC:SQL:000021', key)
    .replaceAll("repeat('7',64)", `'${randomBytes(32).toString('hex')}'`)
    .replaceAll("repeat('8',64)", `'${randomBytes(32).toString('hex')}'`);
  await setup.query(fixture);
  const project = (await setup.query("select current_setting('test.residential_project') id")).rows[0].id;
  await setup.query("select set_config('app.actor_id',$1,true)",[actor]);
  await setup.query('set local role editor');
  const promos = [];
  for (let n = 0; n < 2; n++) {
    const promotion = await rpc(setup, 'create', null, {
      project_id: project, code: `RACE-${actor}-${n}`.toUpperCase(), title: { th: 'โปรโมชั่นสังเคราะห์พร้อมกัน' },
      summary: { th: 'ข้อมูลตัวอย่าง' }, conditions_public: { th: 'เงื่อนไขตัวอย่าง' }, legal_terms: { th: 'กฎหมายสังเคราะห์' },
      disclaimer: { th: 'ไม่ใช่ข้อเสนอขาย' }, benefit_type: n ? 'gift' : 'other', benefit_value: null, benefit_unit: null,
      stackable: true, priority: 100, starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + 86_400_000).toISOString(), source_offer_key: key,
    });
    promos.push(promotion);
  }
  await setup.query('reset role');
  await setup.query('set local role publisher');
  for (const promotion of promos) {
    await setup.query("select set_config('app.actor_id',$1,true)",[actors.reviewer]);
    for (const review_type of ['DATA', 'LEGAL']) await rpc(setup, 'review', promotion.id, {
      expected_revision: 1, review_type, decision: 'APPROVED', evidence: key, change_reason: key,
      expected_scope_hash: promotion.scope.scope_hash,
    });
    await setup.query("select set_config('app.actor_id',$1,true)",[actors.publisher]);
    await rpc(setup, 'publish', promotion.id, { expected_revision: 1, expected_published_version_id: null, change_reason: key });
  }
  await setup.query('commit');
  const members = (await setup.query('select id,published_version_id from hub.public_promotions where created_by=$1 order by id', [actor])).rows.map(row => ({ entity_type: 'promotion', entity_id: row.id, expected_revision: 1, expected_updated_at: null, expected_published_version_id: row.published_version_id }));
  await begin(first); await begin(second);
  const winner = await publish(first, members);
  const stale = await releaseLock(publish(second, members));
  assert.equal(stale.status,'RETURNED');assert.equal(stale.rejected.length,2);assert.ok(stale.rejected.every(item=>item.code==='stale'));
  await second.query('commit'); pending = undefined;
  const rows = (await setup.query('select id,published_version_id from hub.public_promotions where created_by=$1 order by id', [actor])).rows;
  for (const row of rows) assert.equal(row.published_version_id, winner.members.find(m => m.entity_id === row.id).after_version_id);
  assert.equal(Number((await setup.query('select count(*) n from hub.publication_releases where published_by=$1', [actors.publisher])).rows[0].n), 1);
  assert.equal(Number((await setup.query('select count(*) n from hub.promotion_versions where published_by=$1', [actors.publisher])).rows[0].n), 4);
  console.log('PASS: competing complete releases serialize; stale release adds no partial versions or pointers');

  const next = rows.map(row => ({ entity_type: 'promotion', entity_id: row.id, expected_revision: 1, expected_updated_at: null, expected_published_version_id: row.published_version_id }));
  await begin(first, 'editor'); await begin(second);
  await rpc(first, 'update', rows[0].id, { expected_revision: 1, title: { th: 'ฉบับร่างเปลี่ยนระหว่างรอ' } });
  const partial = await releaseLock(publish(second, next));
  assert.equal(partial.rejected.length,1);assert.equal(partial.rejected[0].entity_id,rows[0].id);assert.equal(partial.rejected[0].code,'stale');
  assert.equal(partial.members.length,1);assert.equal(partial.members[0].entity_id,rows[1].id);
  await second.query('commit'); pending = undefined;
  const after=(await setup.query('select id,published_version_id from hub.public_promotions where created_by=$1 order by id', [actor])).rows;
  assert.equal(after[0].published_version_id,rows[0].published_version_id);assert.notEqual(after[1].published_version_id,rows[1].published_version_id);
  assert.equal(Number((await setup.query('select count(*) n from hub.publication_releases where published_by=$1', [actors.publisher])).rows[0].n), 2);
  assert.equal(Number((await setup.query('select count(*) n from hub.promotion_versions where published_by=$1', [actors.publisher])).rows[0].n), 5);
  console.log('PASS: a waiting release rejects the changed item and publishes only its unchanged approved neighbor');
} finally {
  await first.query('rollback').catch(() => {});
  await pending?.catch(() => {});
  await second.query('rollback').catch(() => {});
  await setup.query('rollback').catch(() => {});
  // Isolated fixture cleanup only; application roles cannot disable immutability or FK triggers.
  await setup.query('begin');
  await setup.query("set local session_replication_role='replica'");
  await setup.query('delete from hub.publication_release_members where release_id in(select id from hub.publication_releases where published_by=$1)', [actors?.publisher ?? actor]);
  await setup.query('delete from hub.publication_releases where published_by=$1', [actors?.publisher ?? actor]);
  await setup.query('delete from hub.promotion_reviews where reviewed_by=$1', [actors?.reviewer ?? actor]);
  await setup.query('delete from hub.promotion_versions where published_by=$1', [actors?.publisher ?? actor]);
  await setup.query('delete from hub.public_promotions where created_by=$1', [actor]);
  await setup.query('delete from hub.entity_assets where project_id in(select id from hub.projects where rem_project_id=$1)', [key]);
  await setup.query('delete from hub.entity_versions where project_id in(select id from hub.projects where rem_project_id=$1)', [key]);
  await setup.query('delete from hub.model_types where rem_project_id=$1', [key]);
  await setup.query('delete from hub.projects where rem_project_id=$1', [key]);
  await setup.query('delete from hub.brand_assets where brand_id in(select id from hub.brands where rem_brand_id=$1)', [key]);
  await setup.query('delete from hub.brand_versions where brand_id in(select id from hub.brands where rem_brand_id=$1)', [key]);
  await setup.query('delete from hub.brands where rem_brand_id=$1', [key]);
  await setup.query('delete from hub.assets where created_by=$1', [actor]);
  await setup.query('delete from staging.source_offers where source_offer_key=$1', [key]);
  await setup.query('delete from staging.rem_models where rem_project_id=$1', [key]);
  await setup.query('delete from staging.rem_projects where rem_project_id=$1', [key]);
  await setup.query('delete from staging.rem_brands where rem_brand_id=$1', [key]);
  await setup.query('delete from audit.change_log where actor=any($1::uuid[])', [[actor,...Object.values(actors ?? {})]]);
  await setup.query('delete from hub.account_permission where account_id=any($1::uuid[])', [[actor,...Object.values(actors ?? {})]]);
  await setup.query('delete from hub.permission_event where account_id=any($1::uuid[]) or actor_id=any($1::uuid[])', [[actor,...Object.values(actors ?? {})]]);
  await setup.query('delete from hub.user_account where id=any($1::uuid[])', [[actor,...Object.values(actors ?? {})]]);
  await setup.query('commit');
  await Promise.all([setup.end(), first.end(), second.end()]);
}
