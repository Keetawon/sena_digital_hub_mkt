// Freeze TEST contracts only. No hosted target or credential arguments are accepted.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { localTarget, readerFile, exportViews, assertLocalTarget } from './provision-dw-reader.mjs';
import { seedDwContract } from './seed-dw-contract.mjs';

const root = new URL('../', import.meta.url);
const output = new URL('supabase/tests/fixtures/ads_export/', root);
const sha256 = value => createHash('sha256').update(value).digest('hex');
async function readCredentials(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error('Local credential file could not be read or parsed; credential content is not logged'); }
}
let admin;
let reader;

// Deny export if anything outside the explicitly synthetic fixture vocabulary is
// present. These checks run in the SAME snapshot subsequently read by the login.
// Only check counts leave the privileged session; no base rows are exported.
const syntheticChecks = {
  scope_members: "select count(*) from ads.scope_member where member_id not in ('C-DEMO-TEST1','C-DEMO-TEST2','00001','00002','000TESTBRAND','TESTCONTENT','TESTUNIT') or (parent_group_id is not null and parent_group_id not in ('C-DEMO-TEST1','C-DEMO-TEST2'))",
  scope_provenance: "select count(*) from ads.scope_code where not (source_fingerprint='local-synthetic-p1' or (source_fingerprint is null and kind in ('MULTI_PHASE','ZONE'))) or label_en !~ '^(TEST |MULTI PROJECT$)'",
  registration_labels: "select count(*) from ads.campaign_registration where label !~ '^(TEST |SYNTHETIC |MOTION |MULTI PROJECT$)'",
  native_ids: "select count(*) from ads.native_binding where account_id !~ '^000' or campaign_id !~ '^000'",
  memo_evidence: "select count(*) from ads.memo where coalesce(evidence_ref,'') !~ '^SYNTHETIC' or (subject !~* 'synthetic' and subject not like '%สังเคราะห์%')",
  line_members: "select count(*) from ads.media_line_component where (rem_project_id is not null and rem_project_id not in ('00001','00002')) or (formatted_mapping is not null and formatted_mapping not in ('C-DEMO-TEST1','C-DEMO-TEST2'))",
  account_ids: "select (select count(*) from ads.ad_account where account_id !~ '^000')+(select count(*) from ads.channel_account where coalesce(account_id,'') !~ '^000')",
  mapping_evidence: "select count(*) from ads.account_mapping where coalesce(evidence_ref,'') !~ '^SYNTHETIC'",
  commitment_vendor: "select count(*) from ads.recurring_commitment where vendor !~* 'synthetic' and vendor not like '%สังเคราะห์%'",
  correction_evidence: "select count(*) from ads.correction where coalesce(evidence_ref,'') !~ '^SYNTHETIC'",
  statement_evidence: "select count(*) from ads.card_statement_control where operator_ref !~ '^SYNTHETIC' or coalesce(evidence_ref,'') !~ '^SYNTHETIC'",
  card_import_provenance: "select count(*) from staging.ads_card_batch where source_file !~ '^synthetic' or profile_id !~ '^SYNTHETIC'",
  ledger_import_provenance: "select count(*) from staging.ads_ledger_batch where source_file !~ '^synthetic' or profile_id !~ '^SYNTHETIC'",
  cost_provenance: "select count(*) from ads.cost_record c where c.source_row_id is null or not exists(select 1 from staging.ads_card_row r join staging.ads_card_batch b on b.id=r.batch_id where r.id=c.source_row_id and b.profile_id ~ '^SYNTHETIC')",
};

try {
  const config = await readCredentials(new URL('.local/development.json', root));
  const credentials = await readCredentials(readerFile);
  assertLocalTarget(credentials);
  assert.equal(credentials.environment, 'local-test');
  assert.equal(credentials.username, 'dw_hub_reader');
  for (const key of Object.keys(localTarget)) if (key in config) assert.equal(config[key], localTarget[key]);
  assert.ok(process.argv.slice(2).every(value => value === '--seed'), 'Only --seed is accepted');
  admin = new pg.Client({ ...localTarget, user: 'postgres', password: config.adminPassword });
  reader = new pg.Client({ ...localTarget, user: credentials.username, password: credentials.password });
  await admin.connect();
  const identity = (await admin.query('select current_database() database,host(inet_server_addr()) host,inet_server_port() port')).rows[0];
  assertLocalTarget(identity);
  assert.deepEqual((await admin.query("select value from ads.setting where key='sena_h_approved'")).rows, [{ value: false }]);
  if (process.argv.includes('--seed')) {
    await admin.query('begin');
    await seedDwContract(admin);
    await admin.query('commit');
  }
  await admin.query('begin isolation level repeatable read read only');
  const provenance = {};
  for (const [name, sql] of Object.entries(syntheticChecks)) {
    const count = Object.values((await admin.query(sql)).rows[0])[0];
    assert.equal(String(count), '0', `Non-synthetic rows detected by ${name}; refusing all fixture output`);
    provenance[name] = 'passed';
  }
  const snapshot = (await admin.query('select pg_export_snapshot() snapshot')).rows[0].snapshot;
  assert.match(snapshot, /^[0-9A-F-]+$/);
  await reader.connect();
  await reader.query('begin isolation level repeatable read read only');
  await reader.query(`set transaction snapshot '${snapshot}'`);
  await reader.query("set local timezone='UTC'");
  assert.equal((await reader.query('select current_user username')).rows[0].username, 'dw_hub_reader');
  assert.equal((await reader.query('show transaction_read_only')).rows[0].transaction_read_only, 'on');
  const actualViews = (await reader.query("select viewname from pg_views where schemaname='ads_export' order by viewname")).rows.map(row => row.viewname);
  assert.deepEqual(actualViews, [...exportViews]);
  const migrationChecksums = [];
  for (const name of (await readdir(new URL('supabase/migrations/', root))).filter(value => value.endsWith('.sql')).sort()) {
    const bytes = await readFile(new URL(`supabase/migrations/${name}`, root));
    const checksum = sha256(bytes);
    const applied = (await admin.query('select checksum from public.local_migrations where name=$1', [name])).rows;
    assert.deepEqual(applied, [{ checksum }], `Migration is not applied exactly: ${name}`);
    migrationChecksums.push({ file: name, sha256: checksum, normalized_lf_sha256: sha256(bytes.toString('utf8').replace(/\r\n/g, '\n')) });
  }
  const exportedAt = new Date().toISOString();
  const files = [];
  const views = [];
  for (const view of exportViews) {
    const columns = (await reader.query(`select a.attname name,pg_catalog.format_type(a.atttypid,a.atttypmod) postgres_type,
      not a.attnotnull nullable,coalesce(nullif(t.typbasetype,0),t.oid)::int type_oid
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      join pg_type t on t.oid=a.atttypid where n.nspname='ads_export' and c.relname=$1 and a.attnum>0 and not a.attisdropped order by a.attnum`, [view])).rows;
    const fields = columns.map(column => {
      const identifier = `v.${pg.escapeIdentifier(column.name)}`;
      let expression = identifier;
      if (column.type_oid === 1700 || column.type_oid === 20) expression = `${identifier}::text`;
      // pg's default JSON parser uses IEEE-754 numbers. Convert embedded money
      // inside SQL before transport and keep the resulting row JSON as raw text.
      const moneyKey = { budget_items: 'amount', cost_breakdown: 'amount', memo_covers: 'cap_amount' }[column.name];
      if (moneyKey) expression = `(select coalesce(jsonb_agg(x || jsonb_build_object('${moneyKey}',x->>'${moneyKey}') order by x::text),'[]'::jsonb) from jsonb_array_elements(${identifier}) x)`;
      column.fixture_encoding = column.type_oid === 1700 || column.type_oid === 20 ? 'decimal_string' : moneyKey ? `json_array; ${moneyKey}=decimal_string` : 'json';
      delete column.type_oid;
      return `${pg.escapeLiteral(column.name)},${expression}`;
    });
    const result = await reader.query(`select row_json from (select jsonb_build_object(${fields.join(',')})::text row_json from ads_export.${pg.escapeIdentifier(view)} v) rows order by row_json collate "C"`);
    const content = `[\n${result.rows.map(row => `  ${row.row_json}`).join(',\n')}\n]\n`;
    const file = `${view}.json`;
    files.push({ file, content });
    views.push({ view: `ads_export.${view}`, destination: `hub__${view}`, file, columns, row_count: result.rowCount, exported_at: exportedAt, sha256: sha256(content) });
  }
  await reader.query('commit');
  await admin.query('commit');
  const manifest = { format_version: 1, environment: 'local-test', source_key: 'hub', synthetic_only: true,
    exported_at: exportedAt, hub_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim(),
    transaction: { role: 'dw_hub_reader', isolation: 'repeatable read', read_only: true, timezone: 'UTC', snapshot_shared_with_provenance_checks: true },
    date_semantics: 'Business months are first-day Asia/Bangkok dates; timestamp strings are UTC.',
    serialization: 'JSON arrays; numeric/bigint and nested monetary fields are decimal strings; source IDs remain text. View nullability is catalog-declared, not inferred from the sample.',
    synthetic_provenance_checks: provenance, migration_checksums: migrationChecksums,
    generator_checksums: await Promise.all(['export-dw-fixtures.mjs', 'seed-dw-contract.mjs'].map(async file => {
      const bytes = await readFile(new URL(`scripts/${file}`, root));
      return { file: `scripts/${file}`, sha256: sha256(bytes), normalized_lf_sha256: sha256(bytes.toString('utf8').replace(/\r\n/g, '\n')) };
    })), views };
  await mkdir(output, { recursive: true });
  for (const { file, content } of files) await writeFile(new URL(file, output), content, 'utf8');
  await writeFile(new URL('manifest.json', output), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Frozen ${views.length} ads_export views, ${views.reduce((sum, view) => sum + view.row_count, 0)} synthetic rows.`);
  for (const view of views) console.log(`${view.view}: ${view.row_count}`);
  console.log('supabase/tests/fixtures/ads_export/manifest.json');
} catch (error) {
  await reader?.query('rollback').catch(() => {});
  await admin?.query('rollback').catch(() => {});
  console.error(`DW fixture export failed (${error.code ?? error.name}); credentials and source rows are not logged.`);
  process.exitCode = 1;
} finally { await reader?.end().catch(() => {}); await admin?.end().catch(() => {}); }
