import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { ensureLocalAdminToken } from './local-credentials.mjs';

export async function applyLocalMigrations(client) {
  await client.query('CREATE TABLE IF NOT EXISTS public.local_migrations (name text PRIMARY KEY, checksum text NOT NULL)');
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const applied = await client.query('SELECT checksum FROM public.local_migrations WHERE name=$1', [name]);
    if (applied.rowCount) {
      if (applied.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}. Add a new migration.`);
      continue;
    }
    try { await client.query(sql); }
    catch (error) {
      // Schema diagnostics only: never dump the connection, query parameters or config.
      throw new Error(`Migration ${name}: ${error.message} (SQL position ${error.position || error.internalPosition || 'unknown'}; ${error.where || 'no context'})`);
    }
    await client.query('INSERT INTO public.local_migrations VALUES ($1,$2)', [name, checksum]);
    console.log(`Applied ${name}`);
  }
  // These fixtures are local development data, never part of a deployment migration.
  for (const [name, file] of [
    ['local-accounts-v1', 'sample-accounts.sql'],
    ['local-seed', '../supabase/seed.sql'],
    ['local-intake-samples', 'sample-intake.sql'],
    ['local-brand-samples', 'sample-brands.sql'],
    ['local-ads-registry-samples', 'sample-ads-registry.sql'],
  ]) {
    const fixture = await client.query('SELECT 1 FROM public.local_migrations WHERE name=$1', [name]);
    if (!fixture.rowCount) {
      await client.query(await readFile(new URL(file, import.meta.url), 'utf8'));
      await client.query('INSERT INTO public.local_migrations VALUES ($1,$2)', [name, 'synthetic-only']);
      console.log(`Loaded ${name}. No enterprise data imported.`);
    }
  }
  const runtime = await client.query("SELECT 1 FROM pg_roles WHERE rolname='hub_runtime'");
  if (runtime.rowCount) {
    await client.query('REVOKE editor,publisher,viewer,admin,online_staff,agency,service_consumer FROM hub_runtime');
    await client.query('GRANT hub_app TO hub_runtime WITH ADMIN FALSE,INHERIT FALSE,SET TRUE');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(await readFile(new URL('../.local/development.json', import.meta.url), 'utf8'));
  const client = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: config.adminPassword });
  try { await client.connect(); await applyLocalMigrations(client); await ensureLocalAdminToken(config); }
  finally { await client.end(); }
}
