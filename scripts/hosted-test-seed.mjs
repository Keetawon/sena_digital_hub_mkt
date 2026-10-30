import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { FIXTURE_SOURCE, syntheticAssets } from './hosted-test-fixtures.mjs';
import {operatorTransaction} from './hosted-write-attestation.mjs';

// Caller supplies an already-verified connection. This module never opens a connection,
// reads cloud credentials, provisions users, or enables issuance.
export async function applyH1Seed(client,attestation) {
  const sql = await readFile(new URL('../supabase/hosted-test/h1-seed.sql', import.meta.url), 'utf8');
  const assets = syntheticAssets().map(({ bytes, ...metadata }) => metadata);
  const checksum = createHash('sha256').update(sql).update(JSON.stringify(assets)).digest('hex');
  const quote = text => `"${text.replaceAll('"', '""')}"`;
  const proof=await operatorTransaction(client,attestation,async client=>{
    await client.query("select pg_advisory_xact_lock(hashtextextended('hosted-h1-seed-v1',0))");
    const { rows: [target] } = await client.query("select hub.hosted_test_profile() as allowed,current_user as operator,current_setting('role') as role");
    if (!target.allowed || target.role !== 'none') throw new Error('H1 seed requires the verified TEST deployment operator.');
    const { rows: [owner] } = await client.query("select pg_get_userbyid(nspowner)=current_user as allowed from pg_namespace where nspname='hub_deployment'");
    if (!owner?.allowed) throw new Error('H1 seed requires deployment ownership.');
    const memberships = (await client.query(`select r.rolname,m.admin_option,m.inherit_option,m.set_option,pg_get_userbyid(m.grantor) as grantor
      from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member=current_user::regrole and r.rolname=any($1)`, [['admin','publisher']])).rows;
    for (const role of ['admin','publisher']) await client.query(`grant ${role} to ${quote(target.operator)} with inherit false,set true`);
    async function restoreMemberships() {
      for (const role of ['admin','publisher']) {
        const before = memberships.find(row => row.rolname === role && row.grantor === target.operator);
        await client.query(before
          ? `grant ${role} to ${quote(target.operator)} with admin ${before.admin_option},inherit ${before.inherit_option},set ${before.set_option}`
          : `revoke ${role} from ${quote(target.operator)} granted by ${quote(target.operator)}`);
      }
    }
    // The verified deployment owner inspects configuration before any accounts
    // exist. Application reads require a real ACTIVE Registry account.
    const { rows: [flags] } = await client.query("select jsonb_build_object('sena_h_approved',exists(select 1 from ads.setting where key='sena_h_approved' and value='true'::jsonb)) as settings,exists(select 1 from ads.setting where key='hosted_test_issuing_enabled' and value='true'::jsonb) as test");
    await client.query('set local role admin');
    const codes = (await client.query("select ads.sn_code(2026,90001) as code,90001 as sequence_no,'KIN' as agency union all select ads.sn_code(2026,90002),90002,'COMBAY'")).rows;
    await client.query('reset role');
    if (flags.test || flags.settings.sena_h_approved) throw new Error('H1 requires approval and TEST issuance off.');
    await client.query('create table if not exists hub_deployment.h1_seed(source text primary key,checksum text not null,manifest jsonb not null,applied_at timestamptz not null default now()); revoke all on hub_deployment.h1_seed from public');
    const previous = (await client.query('select checksum,manifest from hub_deployment.h1_seed where source=$1', [FIXTURE_SOURCE])).rows[0];
    if (previous) {
      if (previous.checksum !== checksum) throw new Error('H1 seed checksum changed; explicit reconciliation required.');
      await restoreMemberships();
      return { status: 'REPLAY_NO_OP', ...previous.manifest };
    }
    if ((await client.query('select 1 from hub.brands union all select 1 from hub.projects limit 1')).rowCount) throw new Error('H1 first seed requires empty residential data.');
    const temporaryPolicies = ['vocab', 'scope_code', 'scope_member', 'campaign_registration', 'campaign_name', 'code_sequence'];
    for (const table of temporaryPolicies) await client.query(`create policy h1_seed_operator on ads.${table} to ${quote(target.operator)} using(true) with check(true)`);
    await client.query('create temporary table h1_seed_assets(payload jsonb) on commit drop; create temporary table h1_seed_codes(code text,sequence_no integer,agency text) on commit drop');
    for (const asset of assets) await client.query('insert into h1_seed_assets values($1)', [asset]);
    for (const row of codes) await client.query('insert into h1_seed_codes values($1,$2,$3)', [row.code,row.sequence_no,row.agency]);
    await client.query(sql);
    for (const table of temporaryPolicies) await client.query(`drop policy h1_seed_operator on ads.${table}`);
    const counts = (await client.query(`select (select count(*)::int from hub.brands) brands,(select count(*)::int from hub.projects) projects,
      (select count(*)::int from hub.model_types) models,(select count(*)::int from hub.public_promotions) promotions,
      (select count(*)::int from hub.publication_releases) releases,(select count(*)::int from hub.assets) assets`)).rows[0];
    const manifest = { environment: 'hosted-test', synthetic_only: true, source: FIXTURE_SOURCE, checksum, counts,
      campaign_codes: codes.map(r => r.code), assets: assets.map(a => ({ id:a.id,checksum:a.checksum,storage_path:a.storage_path })), exported_at: new Date().toISOString() };
    if (counts.brands !== 1 || counts.projects !== 1 || counts.promotions !== 1 || counts.releases !== 1 || counts.assets !== 3) throw new Error('H1 seed counts do not match its contract.');
    await client.query('insert into hub_deployment.h1_seed(source,checksum,manifest) values($1,$2,$3)', [FIXTURE_SOURCE,checksum,manifest]);
    await restoreMemberships();
    return { status: 'APPLIED', ...manifest };
  });return proof.result;
}
