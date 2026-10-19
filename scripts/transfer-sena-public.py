"""Narrow public-website transfer to the approved TEST deployment.

Preparation is offline. The private operator wrapper supplies a verified TEST
connection and a fresh backup receipt. No local REM/DW snapshots, accounts,
human decisions, publication, email, retrieval chunks or embeddings are copied.
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import ssl
import sys
from urllib.parse import unquote, urlsplit
from uuid import UUID

import asyncpg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
from sena_hub_api.auth import Settings, HOSTED_TEST_REF
from sena_hub_api.r2_assets import R2Assets, BUCKET, KNOWLEDGE_MAX_BYTES

spec = importlib.util.spec_from_file_location('public_source_import', ROOT / 'scripts/import-sena-public.py')
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
CONTRACT = 'sena-public-hosted-transfer-v1'
BASE = ROOT / '.local/sena-public-import/20261015'
PACKAGES = {
    'prepared-main': '8dad505a8bca20745d04cc6003dd5dc08cecc4c1688ae7ed1a877dc681bcda3c',
    'prepared-k9bk2-final': 'b464b1b1a0576b45cc60530cd2648b4518e2b901dfa7ce1b4754b31a1ecebbe2',
}
SHEET_SHA = 'e1891da293412de8c6c742f0b75a3e401310dc4f132ea345fb7f469c97453f69'
CONFIRMATION = 'IMPORT PUBLIC CONTENT TO ' + HOSTED_TEST_REF


def require(condition, code):
    if not condition:
        raise ValueError(code)


def public_identity(draft, sheet):
    """The existing FK requires an identity stub, NOT a REM/DW business record."""
    pid = draft['rem_project_id']
    matches = [r for r in sheet['rows'] if r.get('Project ID') == pid]
    require(bool(matches), 'missing_public_project_identity')
    # The sheet can use one exact project ID for SH/TH public pages. Preserve
    # both public names/rows instead of guessing a new phase or discarding one.
    name = {lang: ' / '.join(dict.fromkeys(r[key].strip() for r in matches if r.get(key, '').strip()))
            for lang, key in (('th', 'Project'), ('en', 'Project Name EN'))}
    name = {k: v for k, v in name.items() if v}
    require(bool(name.get('th')), 'missing_public_project_name')
    url = source.source_url(draft['sources'][0]['url'])
    return {'project_id': pid, 'name': name, 'source_url': url,
            'fetched_at': sheet['fetched_at'], 'source_record': {
                'source_kind': 'sena_public_website', 'source_remark': source.REMARK,
                'source_url': url, 'sheet_rows': [r['sheet_row'] for r in matches],
                'sheet_sha256': sheet['source_sha256'], 'rem_status_unverified': True}}


def sanitize_candidate(row):
    row = deepcopy(row)
    require(set(row) == {'id', 'source_key', 'kind', 'project_ids', 'programme_ids', 'topic',
                         'source_url', 'source_ref', 'evidence', 'holds'}, 'unexpected_candidate_fields')
    require(row['evidence'].get('source_kind') == 'sena_public_website', 'non_public_candidate')
    require(row['evidence'].get('source_remark') == source.REMARK, 'source_remark_missing')
    source.source_url(row['source_url'])
    row['evidence'].pop('locations', None)
    if row['kind'] == 'asset':
        require(0 < row['evidence']['bytes'] <= KNOWLEDGE_MAX_BYTES, 'file_outside_storage_limit')
        row['evidence']['storage_bucket'] = BUCKET
    # Refuse unexpected private records/paths rather than silently laundering them.
    text = json.dumps(row, ensure_ascii=False)
    require(not any(word in text for word in ('source_record', 'local-rem:', '.local',
            'user_account', 'app_metadata', 'user_metadata', 'access_token', 'secret_access_key')),
            'non_public_evidence_field')
    def has_local_path(value):
        if isinstance(value, str):
            return bool(re.search(r'(?:^|\s)[A-Za-z]:[\\/]', value))
        if isinstance(value, dict):
            return any(has_local_path(v) for v in value.values())
        if isinstance(value, list):
            return any(has_local_path(v) for v in value)
        return False
    require(not has_local_path(row), 'local_filesystem_path')
    return row


def prepare(folder):
    folder = source.inside(folder, ROOT / '.local')
    sheet_raw = (BASE / 'sheet-projects.json').read_bytes()
    require(source.sha(sheet_raw) == SHEET_SHA, 'sheet_snapshot_changed')
    sheet = json.loads(sheet_raw)
    rows, drafts, locations, lineage = [], [], {}, []
    for name, digest in PACKAGES.items():
        package = BASE / name
        manifest = source.verify(package, digest, source.CONTRACT)
        capture = source.inside(manifest['capture']['folder'], ROOT / '.local/knowledge-intake')
        source.verify(capture, manifest['capture']['manifest_sha256'], 'sena-knowledge-preaudit-v1')
        lineage.append({'package_manifest_sha256': digest,
                        'capture_manifest_sha256': manifest['capture']['manifest_sha256'],
                        'mapping_sha256': manifest['mapping_sha256']})
        for row in source.read(package / 'candidates.json'):
            if row['kind'] == 'asset':
                e = row['evidence']
                location = e['locations'][0]
                parent = source.inside(location['package'], ROOT / '.local/knowledge-intake')
                file = source.inside(parent / location['blob'], parent)
                raw = file.read_bytes()
                require(source.sha(raw) == e['sha256'] and len(raw) == e['bytes'], 'asset_integrity_failed')
                locations[e['sha256']] = str(file)
            rows.append(sanitize_candidate(row))
        drafts.extend(source.read(package / 'drafts.json'))
    require(len({r['id'] for r in rows}) == len(rows), 'duplicate_candidate_identity')
    identities = [public_identity(d, sheet) for d in drafts]
    ids = {i['project_id'] for i in identities}
    require(len(ids) == len(drafts), 'duplicate_project_draft')
    require(all(set(r['project_ids']) <= ids for r in rows), 'unknown_project_in_evidence')
    files = {r['evidence']['sha256']: r['evidence']['bytes'] for r in rows if r['kind'] == 'asset'}
    counts = {'projects': len(drafts), 'candidates': len(rows), 'kinds': dict(Counter(r['kind'] for r in rows)),
              'unique_files': len(files), 'file_bytes': sum(files.values()),
              'held_assets': sum(bool(r['evidence'].get('file_validation_error')) for r in rows if r['kind'] == 'asset')}
    folder.mkdir(parents=True, exist_ok=False)
    for filename, value in [('candidates.json', rows), ('drafts.json', drafts), ('identities.json', identities)]:
        source.write(folder / filename, value)
    manifest = {'contract_version': CONTRACT, 'target_project_ref': HOSTED_TEST_REF,
                'source_kind': 'sena_public_website', 'source_remark': source.REMARK,
                'source_evidence': {k: sheet[k] for k in ('source_url', 'sheet', 'column', 'fetched_at', 'source_sha256')},
                'lineage': lineage, 'counts': counts, 'files': {}}
    for file in sorted(folder.glob('*.json')):
        raw = file.read_bytes()
        manifest['files'][file.name] = {'sha256': source.sha(raw), 'bytes': len(raw)}
    source.write(folder / 'manifest.json', manifest)
    # This sidecar is local-only and is NEVER stored in the DB or in R2.
    source.write(folder / 'local-file-locations.json', locations)
    digest = source.sha((folder / 'manifest.json').read_bytes())
    print(json.dumps({'status': 'offline_prepared', 'manifest_sha256': digest, **counts}), flush=True)


def load_package(folder, digest):
    folder = source.inside(folder, ROOT / '.local')
    manifest = source.verify(folder, digest, CONTRACT)
    require(manifest['target_project_ref'] == HOSTED_TEST_REF, 'wrong_target')
    require(set(manifest['files']) == {'candidates.json', 'drafts.json', 'identities.json'}, 'unexpected_package_files')
    rows = source.read(folder / 'candidates.json')
    require(all(sanitize_candidate(r) == r for r in rows), 'unsanitized_candidate')
    return manifest, rows, source.read(folder / 'drafts.json'), source.read(folder / 'identities.json')


def public_card(identity):
    return {'name': identity['name'], 'status': {'raw': None, 'label': 'ยังไม่ยืนยันสถานะจาก REM',
            'as_of': None, 'source_ref': identity['source_url']},
            'source_kind': 'sena_public_website', 'source_remark': source.REMARK,
            'location': None, 'bedroom_range': None, 'area_sqm_range': None, 'facility_codes': [],
            'nearby_places': [], 'contacts': [], 'mode': 'DRAFT_PREVIEW', 'publication_version_id': None}


async def preserved_state(db):
    # Hash inside PostgreSQL. No account/profile payload leaves the database.
    tables = ('hub.user_account', 'hub.user_account_event', 'hub.account_permission', 'hub.permission_event',
              'hub.entity_versions', 'hub.knowledge_reviews', 'hub.knowledge_asset_links',
              'rag.knowledge_preview_chunks', 'staging.rem_models', 'staging.dw_projects')
    return {table: await db.fetchval(f"SELECT md5(coalesce(string_agg(v::text,'|' ORDER BY v::text),'')) FROM (SELECT to_jsonb(t) v FROM {table} t) q") for table in tables}


async def import_rows(db, actor, digest, manifest, rows, drafts, identities):
    """Operator transaction; draft mutations only through permission-checked RPCs.

    Supabase's operator cannot SET ROLE hub_app. Do not grant that membership:
    these SECURITY DEFINER functions check the table-backed actor regardless of
    the caller's login. Restricted runtime reads are verified separately.
    """
    await db.execute('SELECT pg_advisory_xact_lock(710054)')
    if await db.fetchval('SELECT EXISTS(SELECT 1 FROM staging.knowledge_batches WHERE manifest_sha256=$1)', digest):
        require(await db.fetchval('SELECT count(*) FROM staging.knowledge_candidates WHERE batch_sha256=$1', digest) == len(rows), 'incomplete_replayed_batch')
        return {'replay': True, 'created_projects': [], 'filled_projects': [], 'preserved_projects': []}
    before = await preserved_state(db)
    await db.execute("SELECT set_config('app.actor_id',$1,true)", str(actor))
    await db.execute("SELECT set_config('app.change_reason',$1,true)",
                     'Public SENA website import: source evidence and drafts only; no human approval')
    await db.execute('INSERT INTO staging.knowledge_batches VALUES($1,$2,now())', digest, manifest)
    by_id = {i['project_id']: i for i in identities}
    for identity in identities:
        # Existing reference rows are never replaced by a public-source stub.
        await db.execute('''INSERT INTO staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint,source_record)
            VALUES($1,$2,$3,$4,$5) ON CONFLICT(rem_project_id) DO NOTHING''', identity['project_id'], identity['name']['th'],
            datetime.fromisoformat(identity['fetched_at'].replace('Z', '+00:00')),
            source.sha(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()), identity['source_record'])
    await db.executemany('''INSERT INTO staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,programme_ids,topic,source_url,source_ref,evidence,holds)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)''',
        [(UUID(r['id']), digest, r['source_key'], r['kind'], r['project_ids'], r['programme_ids'], r['topic'], r['source_url'], r['source_ref'], r['evidence'], r['holds']) for r in rows])
    await db.executemany('INSERT INTO rag.project_fact_cards(rem_project_id,batch_sha256,payload) VALUES($1,$2,$3) ON CONFLICT(rem_project_id) DO NOTHING',
                        [(i['project_id'], digest, public_card(i)) for i in identities])
    result = {'replay': False, 'created_projects': [], 'filled_projects': [], 'preserved_projects': []}
    await db.fetchval("SELECT hub.require_permission('projects','edit')")
    await db.fetchval("SELECT hub.require_permission('knowledge','view')")
    for draft in drafts:
        pid = draft['rem_project_id']
        project = await db.fetchrow('SELECT id,updated_at,website_content FROM hub.projects WHERE rem_project_id=$1 AND deleted_at IS NULL', pid)
        created = project is None
        if created:
            identifier = await db.fetchval('SELECT hub.create_project_from_rem($1)', pid)
            project = await db.fetchrow('SELECT id,updated_at,website_content FROM hub.projects WHERE id=$1', identifier)
            result['created_projects'].append(pid)
        if any(project['website_content'].values()):
            result['preserved_projects'].append(pid)
            continue
        changes = {'website_content': draft['website_content']}
        if created:
            changes['public_name'] = by_id[pid]['name']
            if len(draft['sources']) == 1:
                site = draft['sources'][0]['website']
                for key, limit in (('address', 10000), ('title', 250), ('description', 1000)):
                    if site.get(key):
                        changes[{'address': 'address', 'title': 'meta_title', 'description': 'meta_description'}[key]] = {'th': site[key][:limit]}
        await db.fetchval('SELECT hub.patch_project($1,$2,$3)', project['id'], changes, project['updated_at'])
        result['filled_projects'].append(pid)
    require(await preserved_state(db) == before, 'protected_state_changed')
    return result


def checked_dsn(value):
    url = urlsplit(value)
    direct = url.hostname == f'db.{HOSTED_TEST_REF}.supabase.co' and unquote(url.username or '') == 'postgres'
    pooler = re.fullmatch(r'aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com', url.hostname or '') and unquote(url.username or '') == f'postgres.{HOSTED_TEST_REF}'
    require(url.scheme in {'postgres', 'postgresql'} and (direct or pooler) and url.port in {None, 5432}
            and url.path == '/postgres' and url.password and not url.query and not url.fragment, 'wrong_test_database')
    return value


async def connect(dsn):
    context = ssl.create_default_context(cafile=os.environ['HUB_TRANSFER_CA_FILE'])
    db = await asyncpg.connect(dsn, ssl=context, timeout=20, command_timeout=180,
                              server_settings={'application_name': 'sena-public-content-transfer'})
    # The session pooler can use a private plaintext backend hop. Verify THIS
    # client's certificate-checked TLS socket, not pg_stat_ssl on that backend.
    tls = db._transport.get_extra_info('ssl_object')
    if not (tls and tls.context.check_hostname and tls.context.verify_mode == ssl.CERT_REQUIRED
            and tls.version() and tls.getpeercert()):
        await db.close()
        raise ValueError('database_tls_required')
    for name in ('json', 'jsonb'):
        await db.set_type_codec(name, schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
    return db


async def preflight(db):
    require(await db.fetchval('SELECT current_database()') == 'postgres', 'wrong_database')
    require(await db.fetchval('SELECT hub.hosted_test_profile()'), 'hosted_profile_required')
    require(await db.fetchval('SELECT count(*) FROM hub_deployment.schema_migrations') == 55, 'unreviewed_schema')
    actors = await db.fetch('''SELECT a.id FROM hub.user_account a JOIN auth.users u ON u.id=a.id
        WHERE a.status='ACTIVE' AND a.can_manage_users AND u.email_confirmed_at IS NOT NULL
        AND lower(a.email)=lower(u.email)''')
    require(len(actors) == 1, 'expected_one_verified_operator_admin')
    actor = actors[0]['id']
    async with db.transaction():
        await db.execute("SELECT set_config('app.actor_id',$1,true)", str(actor))
        require(await db.fetchval("SELECT hub.can('projects','edit') AND hub.can('knowledge','view')"), 'operator_permission_missing')
    return actor


def upload_files(folder, rows, storage):
    locations = source.read(folder / 'local-file-locations.json')
    evidence = {r['evidence']['sha256']: r['evidence'] for r in rows if r['kind'] == 'asset'}
    def upload(e):
        file = source.inside(locations[e['sha256']], ROOT / '.local/knowledge-intake')
        data = file.read_bytes()
        require(source.sha(data) == e['sha256'] and len(data) == e['bytes'], 'local_asset_changed')
        return storage.install_knowledge(data, e)
    done = created = 0
    # Six bounded workers, immutable conditional PUT + full read/hash verification.
    with ThreadPoolExecutor(max_workers=6) as pool:
        pending = [pool.submit(upload, e) for e in evidence.values()]
        for future in as_completed(pending):
            created += int(future.result())
            done += 1
            if done % 100 == 0 or done == len(evidence):
                print(json.dumps({'r2_verified': done, 'r2_total': len(evidence), 'created': created}), flush=True)
    return {'verified': done, 'created': created, 'existing': done - created}


async def hosted(args):
    require(args.hosted and args.confirm == CONFIRMATION, 'explicit_test_target_confirmation_required')
    manifest, rows, drafts, identities = load_package(args.package, args.manifest_sha256)
    dsn = checked_dsn(os.environ['HUB_TRANSFER_OPERATOR_DSN'])
    runtime_dsn = os.environ['HUB_TRANSFER_RUNTIME_DSN']
    settings = Settings(database_url=runtime_dsn + '?sslmode=verify-full', auth_mode='supabase', environment='hosted-test',
        supabase_url=f'https://{HOSTED_TEST_REF}.supabase.co', admin_origin='https://72.62.253.205',
        r2_credentials_file=os.environ['HUB_TRANSFER_R2_FILE'], r2_private_bucket_confirmed=True)
    db = await connect(dsn)
    try:
        actor = await preflight(db)
        runtime = await connect(runtime_dsn)
        try:
            async with runtime.transaction():
                await runtime.execute('SET LOCAL ROLE hub_app')
                await runtime.execute("SELECT set_config('app.actor_id',$1,true)", str(actor))
                require(await runtime.fetchval("SELECT hub.can('projects','edit') AND hub.can('knowledge','view')"), 'runtime_permission_missing')
                require(not await runtime.fetchval('SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user'), 'runtime_must_be_restricted')
        finally:
            await runtime.close()
        storage = R2Assets(settings)
        storage.require_private_bucket()
        if args.command == 'check':
            print(json.dumps({'status': 'hosted_readonly_preflight_passed', **manifest['counts']}), flush=True)
            return
        backup = source.read(args.backup_receipt)
        require(backup['status'] == 'backed_up' and backup['target_project_ref'] == HOSTED_TEST_REF
                and backup['manifest_sha256'] == args.manifest_sha256, 'matching_backup_required')
        dump = source.inside(args.backup_receipt.parent / 'supabase-before-content.dump', ROOT / '.local/backups')
        require(source.sha(dump.read_bytes()) == backup['dump_sha256'], 'backup_changed')
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(backup['at'].replace('Z', '+00:00'))).total_seconds()
        require(0 <= age < 86400, 'fresh_backup_required')
        # Close the DB connection during file transfer; reconnect and recheck authority.
        await db.close()
        uploaded = await asyncio.to_thread(upload_files, args.package, rows, storage)
        db = await connect(dsn)
        actor = await preflight(db)
        async with db.transaction():
            result = await import_rows(db, actor, args.manifest_sha256, manifest, rows, drafts, identities)
        receipt = {'status': 'committed', 'at': datetime.now(timezone.utc).isoformat(),
                   'manifest_sha256': args.manifest_sha256, 'counts': manifest['counts'], 'r2': uploaded, **result}
        source.write(args.package / 'transfer-receipt.json', receipt)
        print(json.dumps(receipt), flush=True)
    finally:
        await db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'check', 'apply'))
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--manifest-sha256')
    parser.add_argument('--hosted', action='store_true')
    parser.add_argument('--confirm')
    parser.add_argument('--backup-receipt', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'prepare':
            prepare(args.package)
        else:
            asyncio.run(hosted(args))
    except Exception as error:
        # Never print DB/provider exception details, request URLs or environment.
        code = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z_]+', str(error)) else getattr(error, 'sqlstate', None) or type(error).__name__
        print(json.dumps({'status': 'failed', 'code': code, 'details': 'withheld'}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
