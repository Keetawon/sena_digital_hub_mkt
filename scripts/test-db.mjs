import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { provisionDwReader } from './provision-dw-reader.mjs';

// Only the fixed local TEST login; never print or pass its password to a command.
await provisionDwReader();
const config = JSON.parse(await readFile(new URL('../.local/development.json', import.meta.url), 'utf8'));
const connection = new pg.Client({ host: '127.0.0.1', user: 'postgres', password: config.adminPassword, port: 55432, database: 'sena_hub_local' });
try {
  await connection.connect();
  connection.on('notice', (notice) => console.log(notice.message));
  await connection.query(await readFile(new URL('../supabase/tests/core_slice.sql', import.meta.url), 'utf8'));
  console.log('PASS: PostgreSQL role isolation, publication, rollback and validity checks');
  await connection.query(await readFile(new URL('../supabase/tests/source_selection.sql', import.meta.url), 'utf8'));
  console.log('PASS: source selection, human model review and stale-edit protection');
  await connection.query(await readFile(new URL('../supabase/tests/asset_library.sql', import.meta.url), 'utf8'));
  console.log('PASS: asset rights, binding isolation and published file eligibility');
  await connection.query(await readFile(new URL('../supabase/tests/brands.sql', import.meta.url), 'utf8'));
  console.log('PASS: brand/company identity, requests, immutable brand publication and dependent project eligibility');
  await connection.query(await readFile(new URL('../supabase/tests/project_prefill.sql', import.meta.url), 'utf8'));
  console.log('PASS: Gold defaults, bilingual fields, source revisions and preservation of edited values');
  await connection.query(await readFile(new URL('../supabase/tests/model_media.sql', import.meta.url), 'utf8'));
  console.log('PASS: model media scope, publication isolation, multiple plans and rights withdrawal');
  await connection.query(await readFile(new URL('../supabase/tests/project_media_collections.sql', import.meta.url), 'utf8'));
  console.log('PASS: multiple project media per role, idempotent append, primary removal and publication rights');
  await connection.query(await readFile(new URL('../supabase/tests/marketing_unit_types.sql', import.meta.url), 'utf8'));
  console.log('PASS: commercial types, shared source references, atomic intake and private scoped media');
  await connection.query(await readFile(new URL('../supabase/tests/project_facilities.sql', import.meta.url), 'utf8'));
  console.log('PASS: facility taxonomy, known absence, stale writes and private draft collection');
  await connection.query(await readFile(new URL('../supabase/tests/ads_registry.sql', import.meta.url), 'utf8'));
  console.log('PASS: ads registry agency isolation, frozen names, native binding and DW export permissions');
  await connection.query(await readFile(new URL('../supabase/tests/ads_media_lines.sql', import.meta.url), 'utf8'));
  console.log('PASS: ads finance role isolation, revisions, memos, assignments, imports and private exports');
  await connection.query(await readFile(new URL('../supabase/tests/ads_actuals.sql', import.meta.url), 'utf8'));
  console.log('PASS: TEST actuals snapshots, staff isolation, finding workflow and document follow-ups');
  await connection.query(await readFile(new URL('../supabase/tests/dw_reader.sql', import.meta.url), 'utf8'));
  console.log('PASS: local DW login, fifteen export views, private-table isolation and read-only enforcement');
} finally {
  await connection.end();
}
