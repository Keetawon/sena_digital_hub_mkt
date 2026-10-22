// Local development only: native PostgreSQL, no system service or Docker required.
import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { applyLocalMigrations } from './local-migrations.mjs';
import { ensureLocalAdminToken } from './local-credentials.mjs';
import { initialiseDisposableDb } from './initialise-disposable-db.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(root, '.local');
await mkdir(local, { recursive: true });
const exists = async (file) => access(file).then(() => true, () => false);
const configFile = path.join(local, 'development.json');
if (!(await exists(configFile))) {
  await writeFile(configFile, JSON.stringify({
    adminPassword: randomBytes(24).toString('hex'),
    runtimePassword: randomBytes(24).toString('hex'),
    editorToken: randomBytes(32).toString('hex'),
    publisherToken: randomBytes(32).toString('hex'),
    viewerToken: randomBytes(32).toString('hex'),
    consumerToken: randomBytes(32).toString('hex'),
  }, null, 2), { mode: 0o600, flag: 'wx' });
}
const config = JSON.parse(await readFile(configFile, 'utf8'));
await ensureLocalAdminToken(config);
const port = 55432;
const databaseDir = path.join(local, 'postgres');
const pg = new EmbeddedPostgres({
  databaseDir, user: 'postgres', password: config.adminPassword, port,
  persistent: true, authMethod: 'scram-sha-256',
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {}, onError: (error) => console.error(String(error)),
});

try {
  if (!(await exists(path.join(databaseDir, 'PG_VERSION')))) await initialiseDisposableDb(databaseDir, config.adminPassword);
  await pg.start();
  const admin = pg.getPgClient('postgres', '127.0.0.1');
  await admin.connect();
  // This development cluster contains no other application's database.
  const db = await admin.query("SELECT 1 FROM pg_database WHERE datname='sena_hub_local'");
  if (!db.rowCount) await admin.query('CREATE DATABASE sena_hub_local');
  await admin.end();
  const client = pg.getPgClient('sena_hub_local', '127.0.0.1');
  await client.connect();
  await applyLocalMigrations(client);
  const runtime = await client.query("SELECT 1 FROM pg_roles WHERE rolname='hub_runtime'");
  if (!runtime.rowCount) await client.query('CREATE ROLE hub_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
  // Generated hexadecimal secret, never supplied as arbitrary SQL text.
  if (!/^[a-f0-9]{48}$/.test(config.runtimePassword)) throw new Error('Invalid local runtime credential');
  await client.query(`ALTER ROLE hub_runtime PASSWORD '${config.runtimePassword}'`);
  await client.query('REVOKE editor,publisher,viewer,admin,online_staff,agency,service_consumer FROM hub_runtime');
  await client.query('GRANT hub_app TO hub_runtime WITH ADMIN FALSE,INHERIT FALSE,SET TRUE');
  await client.end();
  const common = [
    'HUB_ENV=local', 'HUB_AUTH_MODE=demo',
    `HUB_DEMO_EDITOR_TOKEN=${config.editorToken}`,
    `HUB_DEMO_PUBLISHER_TOKEN=${config.publisherToken}`,
    `HUB_DEMO_VIEWER_TOKEN=${config.viewerToken}`,
    `HUB_DEMO_SERVICE_CONSUMER_TOKEN=${config.consumerToken}`,
    `HUB_DEMO_ADMIN_TOKEN=${config.adminToken}`,
    `HUB_DEMO_ONLINE_STAFF_TOKEN=${config.onlineStaffToken}`,
    `HUB_DEMO_AGENCY_KIN_TOKEN=${config.agencyKinToken}`,
    `HUB_DEMO_AGENCY_COMBAY_TOKEN=${config.agencyCombayToken}`,
    `HUB_DEMO_UAT_ADMIN_TOKEN=${config.uatAdminToken}`,
    `HUB_DEMO_UAT_SUSPENDED_TOKEN=${config.uatSuspendedToken}`,
    `HUB_DEMO_UAT_SOMCHAI_TOKEN=${config.uatSomchaiToken}`,
  ].join('\n');
  const environments = [
    ['apps/api/.env', `${common}\nHUB_DATABASE_URL=postgresql://hub_runtime:${config.runtimePassword}@127.0.0.1:${port}/sena_hub_local\nHUB_TEST_DATABASE_URL=postgresql://hub_runtime:${config.runtimePassword}@127.0.0.1:${port}/sena_hub_local\n`],
    ['apps/admin/.env.local', `${common}\nHUB_API_URL=http://127.0.0.1:8000\n`],
  ];
  for (const [name, content] of environments) {
    const target = path.join(root, name);
    if (!(await exists(target))) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, { mode: 0o600, flag: 'wx' });
      console.log(`Created ${name} (ignored by Git; server-side credentials)`);
    }
  }
  console.log(`Local PostgreSQL ready at 127.0.0.1:${port}. Keep this terminal open; Ctrl+C stops it and preserves data.`);
  await new Promise(() => {});
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local database setup failed');
  await pg.stop().catch(() => {});
  process.exitCode = 1;
}
