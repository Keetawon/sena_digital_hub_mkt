// Freeze the two published-content views only; fixed localhost and invented content.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { localTarget, readerFile, hubExportViews, assertLocalTarget } from './provision-dw-reader.mjs';
import { contentFixture, seedHubContentContract } from './seed-hub-content-contract.mjs';

const root = new URL('../', import.meta.url), output = new URL('supabase/tests/fixtures/hub_export/', root);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const checksum = async file => {
  const bytes = await readFile(new URL(file, root));
  return { file, sha256: sha256(bytes), normalized_lf_sha256: sha256(bytes.toString('utf8').replace(/\r\n/g, '\n')) };
};
let admin, reader;
try {
  assert.ok(process.argv.slice(2).every(arg => arg === '--seed') && process.argv.length <= 3, 'Only --seed is supported');
  const config = JSON.parse(await readFile(new URL('.local/development.json', root), 'utf8'));
  const credentials = JSON.parse(await readFile(readerFile, 'utf8'));
  assertLocalTarget(credentials);
  for (const key of Object.keys(localTarget)) if (key in config) assert.equal(config[key], localTarget[key]);
  assert.equal(credentials.environment, 'local-test');
  assert.equal(credentials.username, 'dw_hub_reader');
  admin = new pg.Client({ ...localTarget, user: 'postgres', password: config.adminPassword });
  reader = new pg.Client({ ...localTarget, user: credentials.username, password: credentials.password });
  await admin.connect();
  assertLocalTarget((await admin.query('select current_database() database,host(inet_server_addr()) host,inet_server_port() port')).rows[0]);
  if (process.argv.includes('--seed')) {
    await admin.query('begin');
    await seedHubContentContract(admin);
    await admin.query('commit');
  }
  await admin.query('begin isolation level repeatable read read only');
  // Check the complete eligible export set, including public text, in the same
  // snapshot the real DW login reads. Real staged dictionaries need not be removed.
  const brandViolations = (await admin.query(`select count(*)::int count from hub_export.brand_published v
    left join staging.rem_brands s using(rem_brand_id)
    where ((v.rem_brand_id=$1 and v.public_name_th=$2 and v.public_name_en='Synthetic DW contract brand'
      and v.slug='synthetic-hub-export-brand' and s.source_fingerprint=$3 and s.source_record=$4::jsonb)
      or (v.rem_brand_id='DEMO-BRAND-01' and v.public_name_th='แบรนด์จำลอง — สำหรับทดสอบเท่านั้น'
      and v.public_name_en='Synthetic demonstration brand' and v.slug='synthetic-demo-brand'
      and s.source_fingerprint='synthetic-brand-01' and s.intake_manifest_sha256 is null)) is not true`,
    [contentFixture.brand, contentFixture.brandName, contentFixture.marker, { synthetic_only: true, fixture: contentFixture.marker }])).rows[0].count;
  const projectViolations = (await admin.query(`select count(*)::int count from hub_export.project_published v
    left join staging.rem_projects s using(rem_project_id)
    where v.rem_project_id is distinct from $1 or v.public_name_th is distinct from $2 or v.public_name_en is not null
      or v.slug is distinct from 'synthetic-hub-export-project' or s.source_fingerprint is distinct from $3 or s.source_record is distinct from $4::jsonb`,
    [contentFixture.project, contentFixture.projectName, contentFixture.marker, { synthetic_only: true, fixture: contentFixture.marker }])).rows[0].count;
  assert.equal(brandViolations, 0, 'Unreviewed/non-synthetic published brand content; refusing fixtures');
  assert.equal(projectViolations, 0, 'Unreviewed/non-synthetic published project content; refusing fixtures');
  const snapshot = (await admin.query('select pg_export_snapshot() snapshot')).rows[0].snapshot;
  assert.match(snapshot, /^[0-9A-F-]+$/);
  await reader.connect();
  await reader.query('begin isolation level repeatable read read only');
  await reader.query(`set transaction snapshot '${snapshot}'`);
  await reader.query("set local timezone='UTC'");
  assert.equal((await reader.query('select current_user username')).rows[0].username, 'dw_hub_reader');
  assert.deepEqual((await reader.query("select viewname from pg_views where schemaname='hub_export' order by viewname")).rows.map(row => row.viewname), hubExportViews);
  const migrationChecksums = [];
  for (const name of (await readdir(new URL('supabase/migrations/', root))).filter(name => name.endsWith('.sql')).sort()) {
    const entry = await checksum(`supabase/migrations/${name}`);
    assert.deepEqual((await admin.query('select checksum from public.local_migrations where name=$1', [name])).rows, [{ checksum: entry.sha256 }], 'Migration checksum differs');
    migrationChecksums.push(entry);
  }
  const exportedAt = new Date().toISOString(), files = [], views = [];
  for (const view of hubExportViews) {
    const columns = (await reader.query(`select a.attname name,pg_catalog.format_type(a.atttypid,a.atttypmod) postgres_type,not a.attnotnull nullable
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='hub_export' and c.relname=$1 and a.attnum>0 and not a.attisdropped order by a.attnum`, [view])).rows;
    const result = await reader.query(`select row_to_json(v)::text row_json from hub_export.${pg.escapeIdentifier(view)} v order by row_to_json(v)::text collate "C"`);
    assert.ok(result.rowCount > 0, 'Seed an example for each published view');
    const content = `[\n${result.rows.map(row => `  ${row.row_json}`).join(',\n')}\n]\n`, file = `${view}.json`;
    files.push({ file, content });
    views.push({ view: `hub_export.${view}`, destination: `hub__${view}`, file, columns, row_count: result.rowCount, bytes: Buffer.byteLength(content), exported_at: exportedAt, sha256: sha256(content) });
  }
  await reader.query('commit');
  await admin.query('commit');
  const manifest = { format_version: 1, contract_version: 'hub-published-content-v1', environment: 'local-test', source_key: 'hub', synthetic_only: true,
    hub_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim(), exported_at: exportedAt,
    transaction: { role: 'dw_hub_reader', isolation: 'repeatable read', read_only: true, timezone: 'UTC', snapshot_shared_with_provenance_checks: true },
    semantics: 'Current consumer-eligible immutable publications; project logo roles come from its frozen brand snapshot. UTC timestamps, exact text source IDs, optional English names remain null. No asset locators/files or rights evidence.',
    synthetic_provenance_checks: { complete_published_brand_set: 'passed', complete_published_project_set: 'passed' },
    migration_checksums: migrationChecksums,
    generator_checksums: await Promise.all(['scripts/export-hub-content-fixtures.mjs', 'scripts/seed-hub-content-contract.mjs', 'scripts/provision-dw-reader.mjs'].map(checksum)), views };
  await mkdir(output, { recursive: true });
  for (const { file, content } of files) await writeFile(new URL(file, output), content, 'utf8');
  await writeFile(new URL('manifest.json', output), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Frozen ${views.length} hub_export views, ${views.reduce((total, view) => total + view.row_count, 0)} synthetic rows.`);
} catch (error) {
  await reader?.query('rollback').catch(() => {});
  await admin?.query('rollback').catch(() => {});
  console.error(`Published fixture export failed (${error.code ?? error.name}); credentials, SQL and source rows are not logged.`);
  process.exitCode = 1;
} finally { await reader?.end().catch(() => {}); await admin?.end().catch(() => {}); }
