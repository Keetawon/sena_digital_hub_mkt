import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { applyMigration, loadMigrations, runMigrations } from '../scripts/supabase-test-migrations.mjs';

test('isolated non-superuser migration, dry-run, replay, rollback and runtime isolation', { skip: process.env.HUB_RUN_MIGRATION_INTEGRATION !== '1' }, async () => {
  // This test refuses every server except the separate, throwaway local cluster.
  const connection = { host: '127.0.0.1', port: 55434, database: 'postgres', user: 'postgres' };
  const admin = new pg.Client(connection);
  await admin.connect();
  let client;
  try {
    const { rows: [server] } = await admin.query("select current_setting('data_directory') as directory");
    assert.match(server.directory.replaceAll('\\', '/'), /\/\.local\/supabase-runner-test-postgres$/);
    assert.equal((await admin.query("select 1 from pg_roles where rolname in ('editor','hub_migration_verifier')")).rowCount, 0, 'test cluster must be fresh');
    await admin.query('create role hub_migration_verifier login createrole noinherit nosuperuser nocreatedb noreplication nobypassrls');
    await admin.query('create database hub_migration_runner_test owner hub_migration_verifier');
    client = new pg.Client({ ...connection, database: 'hub_migration_runner_test', user: 'hub_migration_verifier' });
    await client.connect();
    const config = { projectRef: 'abcdefghijklmnopqrst', runtimePassword: 'x'.repeat(40), apply: false };
    const logs = [], log = message => logs.push(message);
    const migrations = await loadMigrations();
    await assert.rejects(runMigrations(client, config, { log, migrations }), /SET ON PARAMETER/);
    assert.equal((await client.query("select 1 from pg_namespace where nspname in ('hub','hub_deployment','ads')")).rowCount, 0);
    // Explicit prerequisite only on this isolated test cluster. Hosted bootstrap
    // needs its managed administrator; the runner never grants itself this ACL.
    await admin.query('grant set on parameter app.ads_test_issuing to hub_migration_verifier');
    await runMigrations(client, config, { log, migrations });
    assert.equal((await client.query("select 1 from pg_namespace where nspname in ('hub','hub_deployment','ads')")).rowCount, 0);
    assert.equal((await client.query("select 1 from pg_roles where rolname='hub_runtime'")).rowCount, 0);
    config.apply = true;
    await runMigrations(client, config, { log, migrations });
    assert.equal((await client.query('select count(*)::int as count from hub_deployment.schema_migrations')).rows[0].count, 14);
    assert.deepEqual((await client.query("select current_user as actor, rolsuper from pg_roles where rolname=current_user")).rows[0], { actor: 'hub_migration_verifier', rolsuper: false });
    assert.equal((await client.query('select count(*)::int as count from hub.projects')).rows[0].count, 0);
    for (const owner of ['ads_registry_writer', 'ads_export_owner']) {
      assert.equal((await client.query('select pg_has_role(current_user,$1,\'SET\') as allowed', [owner])).rows[0].allowed, false);
      assert.equal((await client.query('select has_schema_privilege($1,$2,\'CREATE\') as allowed', [owner, owner === 'ads_export_owner' ? 'ads_export' : 'ads'])).rows[0].allowed, false);
    }
    const { rows: [runtime] } = await admin.query("select rolpassword from pg_authid where rolname='hub_runtime'");
    assert.match(runtime.rolpassword, /^SCRAM-SHA-256\$4096:/);
    assert.doesNotMatch(runtime.rolpassword, /xxxxxxxx/);
    for (const role of ['admin', 'online_staff']) assert.equal((await client.query("select has_function_privilege($1,'ads.issue_registration(uuid,text,text,text,text,boolean)','EXECUTE') as allowed", [role])).rows[0].allowed, true);
    for (const view of ['campaign_registration', 'campaign_name', 'native_binding', 'scope_code', 'scope_member']) assert.equal((await client.query("select has_table_privilege('ads_export_reader',$1,'SELECT') as allowed", [`ads_export.${view}`])).rows[0].allowed, true);
    logs.length = 0;
    await runMigrations(client, config, { log, migrations });
    assert.equal(logs.some(line => line.startsWith('Applied:')), false, 'replay must not rerun SQL');
    const changed = migrations.map(row => ({ ...row }));
    changed[0].checksum = 'edited';
    await assert.rejects(runMigrations(client, config, { log, migrations: changed }), /checksum changed/);
    const broken = { name: 'atomicity_probe', checksum: 'probe', body: ['create table hub.rollback_probe(x int);', 'select missing_function_for_atomicity_probe();'] };
    await assert.rejects(applyMigration(client, broken, config, 'hub_migration_verifier'));
    assert.equal((await client.query("select to_regclass('hub.rollback_probe') as relation")).rows[0].relation, null);
    assert.equal((await client.query("select 1 from hub_deployment.schema_migrations where name='atomicity_probe'")).rowCount, 0);
    const runtimeClient = new pg.Client({ ...connection, database: 'hub_migration_runner_test', user: 'hub_runtime' });
    await runtimeClient.connect();
    try {
      await assert.rejects(runtimeClient.query('select * from ads.campaign_registration'), error => error.code === '42501');
      await runtimeClient.query('set role agency');
      assert.equal((await runtimeClient.query('select count(*)::int as count from ads.campaign_registration')).rows[0].count, 0);
      await runtimeClient.query('reset role');
      await runtimeClient.query('set role online_staff');
      assert.equal((await runtimeClient.query('select ads.test_issuing_enabled() as test')).rows[0].test, false);
      assert.equal((await runtimeClient.query('select ads.registry_settings() as settings')).rows[0].settings.sena_h_approved, false);
      await runtimeClient.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',false)");
      await assert.rejects(runtimeClient.query("select ads.issue_registration('00000000-0000-0000-0000-000000000001','LEADS','KIN')"), error => error.code === '42501');
      await runtimeClient.query('reset role');
      await assert.rejects(runtimeClient.query('set role ads_registry_writer'), error => error.code === '42501');
      await assert.rejects(runtimeClient.query('select * from hub_deployment.schema_migrations'), error => error.code === '42501');
    } finally { await runtimeClient.end(); }
  } finally {
    if (client) await client.end();
    // Never delete anything until the server path was verified and this test's
    // unique verifier role/database was created above.
    if (client) {
      await admin.query('drop database hub_migration_runner_test');
      await admin.query('revoke set on parameter app.ads_test_issuing from hub_migration_verifier');
      await admin.query("do $$ declare r text; begin foreach r in array array['hub_runtime','editor','publisher','viewer','service_consumer','admin','online_staff','agency','ads_registry_writer','ads_export_owner','ads_export_reader','hub_migration_verifier'] loop execute format('drop role if exists %I',r); end loop; end $$");
    }
    await admin.end();
  }
});
