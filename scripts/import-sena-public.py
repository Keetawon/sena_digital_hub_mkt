"""Public SENA capture -> local project drafts + immutable Knowledge evidence.

No network fetch, email, embedding, review, rights approval or publication. Prepare
is offline. Apply defaults to a read-only plan, accepts only the working loopback
cluster, and requires a fresh backup before its atomic database transaction.
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, UUID, uuid5

import asyncpg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
from sena_hub_api.assets import validate_file
from sena_hub_api.knowledge_retrieval import safe_text, STATUS

ACTOR = UUID('00000000-0000-0000-0000-000000000001')  # Existing synthetic local editor.
CONTRACT = 'sena-public-project-import-v1'
REMARK = 'ดึงจากเว็บไซต์สาธารณะ SENA'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + '\n', encoding='utf-8')


def inside(path, parent):
    path, parent = Path(path).resolve(), Path(parent).resolve()
    if not path.is_relative_to(parent) or path == parent:
        raise ValueError('path_outside_local_evidence')
    return path


def source_url(value):
    url = urlsplit(value)
    host = (url.hostname or '').lower()
    if url.scheme != 'https' or url.username or url.password or url.port not in (None, 443) or not (host == 'sena.co.th' or host.endswith('.sena.co.th')):
        raise ValueError('source_outside_sena_public_websites')
    return value


def verify(folder, expected, contract):
    folder = folder.resolve()
    raw = (folder / 'manifest.json').read_bytes()
    if sha(raw) != expected:
        raise ValueError('manifest_hash_mismatch')
    manifest = json.loads(raw)
    if manifest['contract_version'] != contract:
        raise ValueError('unsupported_contract')
    for name, meta in manifest['files'].items():
        raw = inside(folder / name, folder).read_bytes()
        if sha(raw) != meta['sha256'] or len(raw) != meta['bytes']:
            raise ValueError('evidence_hash_or_size_mismatch')
        if meta.get('rows') is not None and len(json.loads(raw)) != meta['rows']:
            raise ValueError('evidence_row_count_mismatch')
    return manifest


def build_rows(pages, files, videos, mapping, capture, capture_hash):
    """Exact source IDs only. Shared phases stay explicitly unresolved evidence."""
    known = {r['Project ID']: r for r in mapping if r.get('rem') and r.get('Project ID')}
    candidates, drafts = [], defaultdict(list)

    def add(key, kind, pids, evidence, url, fetched_at, holds=(), topic='design'):
        original_ids = sorted(set(pids))
        ids = sorted(set(pids) & known.keys())
        if not ids:
            return
        source_url(url)
        source_key = f'sena-public:{capture_hash}:{key}'
        candidates.append({'id': str(uuid5(NAMESPACE_URL, source_key)), 'source_key': source_key,
            'kind': kind, 'project_ids': ids, 'programme_ids': [], 'topic': topic,
            'source_url': url, 'source_ref': source_key,
            'evidence': {**evidence, 'source_kind': 'sena_public_website', 'source_remark': REMARK,
                         'fetched_at': fetched_at, 'source_project_ids': original_ids},
            'holds': sorted(set(holds) | ({'needs_phase_decision'} if len(original_ids) > 1 else set()))})

    seen_pages = set()
    for n, page in enumerate(pages):
        if not page.get('sections'):
            add(f'page:{n}:unavailable', 'gap', page['project_ids'],
                {'gap_code': 'PUBLIC_WEBSITE_PAGE_UNAVAILABLE',
                 'detail': 'URL ต้นทางยังเก็บเนื้อหาไม่ได้ ดูรายงานการดึงข้อมูลและตรวจลิงก์โครงการ',
                 'owner': 'Web team', 'http_status': page.get('status')},
                page['url'], page.get('fetched_at'), topic='identity')
            continue
        url = source_url(page.get('final_url') or page['url'])
        fetched = page['fetched_at']
        pids = page['project_ids']
        website = page.get('website') or {}
        # Some microsites link both /project and /project/. Keep genuinely
        # different pages, but do not create a second review for identical text.
        signature = (url.rstrip('/'), tuple(sorted(pids)), sha(json.dumps(
            [page['sections'], website], sort_keys=True, ensure_ascii=False).encode()))
        if signature in seen_pages:
            continue
        seen_pages.add(signature)
        parts = []
        for i, section in enumerate(page['sections']):
            text = section['text'].strip()
            if not text:
                continue
            _, holds = safe_text(text)
            add(f'page:{n}:section:{i}', 'section', pids,
                {'title': {'th': section['heading']}, 'body': {'th': text}, 'summary': {'th': text[:220]},
                 'source_text': text, 'locator': section['locator'], 'source_timezone': 'unknown'},
                url, fetched, holds)
            parts.append(section['heading'] + '\n' + text)
        for i, faq in enumerate(website.get('faqs', [])):
            _, holds = safe_text(faq['answer'])
            add(f'page:{n}:faq:{i}', 'faq', pids,
                {'canonical_question': {'th': faq['question']}, 'alt_questions': {'th': []},
                 'short_answer': {'th': faq['answer']}, 'live_fact_key': None, 'source_refs': [url + '#' + faq['locator']]},
                url, fetched, holds)
        # A scope warning is visible in the editable copy; phase-specific claims
        # are never turned into confirmed model, price, facility or unit fields.
        prefix = 'ต้นทาง: ' + url
        if len(set(pids)) > 1:
            prefix += '\nหน้าเว็บใช้ร่วมหลายระยะ (' + ', '.join(pids) + ') ต้องตรวจขอบเขตก่อนใช้'
        body = prefix + '\n\n' + '\n\n'.join(parts)
        for pid in set(pids) & known.keys():
            drafts[pid].append({'url': url, 'fetched_at': fetched, 'text': body, 'website': website})

    grouped = defaultdict(list)
    for file in files:
        if file['status'] == 'downloaded':
            grouped[file['sha256']].append(file)
        else:
            refs = file['references']
            add('unavailable-file:' + sha(file['url'].encode()), 'gap',
                [pid for ref in refs for pid in ref['project_ids']],
                {'gap_code': 'PUBLIC_WEBSITE_FILE_UNAVAILABLE',
                 'detail': 'ต้นทางอ้างถึงสื่อนี้ แต่ยังดาวน์โหลดไม่ได้หรือไม่อนุญาตให้เก็บอัตโนมัติ',
                 'requested_url': file['url'], 'http_status': file.get('http_status'), 'owner': 'Web team'},
                refs[0]['page_url'], file.get('fetched_at'), topic='media_documents')
    for digest, group in grouped.items():
        file = group[0]
        ids = sorted({pid for f in group for ref in f['references'] for pid in ref['project_ids']})
        if not set(ids) & known.keys():
            continue
        raw = inside(capture / file['blob'], capture).read_bytes()
        if sha(raw) != digest or len(raw) != file['bytes']:
            raise ValueError('asset_integrity_failed')
        metadata, error = None, None
        extension = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf'}.get(file['mime'], 'bin')
        try:
            metadata = validate_file(raw, file['mime'], digest + '.' + extension)
        except Exception:
            error = 'ต้นฉบับยังไม่ผ่านขีดจำกัดหรือการตรวจไฟล์ ต้องตรวจแยกก่อนอนุมัติสิทธิ์'
        labels = [r.get('label', '') for f in group for r in f['references'] if r.get('label')]
        evidence = {k: file.get(k) for k in ('sha256', 'bytes', 'mime', 'dimensions')}
        evidence.update(locations=[{'package': str(capture.resolve()), 'blob': file['blob']}],
            url_aliases=[f['url'] for f in group], validated_metadata=metadata, file_validation_error=error,
            classification={'role': 'brochure' if extension == 'pdf' else 'gallery',
                            'alt_th': labels[0][:500] if labels else 'สื่อจากเว็บไซต์สาธารณะ SENA · รอตรวจ',
                            'people': 'unknown', 'third_party_marks': 'unknown', 'stock_imagery': 'unknown'})
        add('asset:' + digest, 'asset', ids, evidence, file['url'], file['fetched_at'], topic='media_documents')
    for i, video in enumerate(videos):
        # Keep the public video link as evidence; never contact the video host.
        refs = video['references']
        for j, ref in enumerate(refs):
            add(f'video:{i}:{j}', 'fact', ref['project_ids'],
                {'fact_key': 'video_link', 'source_value': video['url'], 'as_of': None, 'owner': 'MKT project owner'},
                ref['page_url'], None, topic='media_documents')

    prepared_drafts = []
    for pid, sources in sorted(drafts.items()):
        # Multiple website URLs for the same exact REM ID are retained, not guessed.
        content = '\n\n'.join(s['text'] for s in sources)
        if len(content) > 200000:
            raise ValueError('project_text_exceeds_editable_limit:' + pid)
        prepared_drafts.append({'rem_project_id': pid, 'website_content': {'th': content}, 'sources': sources})
    cards = []
    for pid in sorted(drafts):
        rem = known[pid]['rem']
        raw = rem.get('source_record') or {}
        status = raw.get('ProjectStatus')
        status = int(status) if str(status).isdigit() else None
        cards.append({'rem_project_id': pid, 'payload': {
            'name': {'th': rem['project_name_rem'], 'en': raw.get('ProjectNameEng')},
            'status': {'raw': status, 'label': STATUS.get(status, 'ไม่ทราบสถานะ'), 'as_of': None,
                       'source_ref': 'local-rem:' + pid},
            'location': None, 'bedroom_range': None, 'area_sqm_range': None, 'facility_codes': [], 'nearby_places': [],
            'contacts': [], 'mode': 'DRAFT_PREVIEW', 'publication_version_id': None}})
    return candidates, prepared_drafts, cards


def prepare(args):
    capture = inside(args.capture, ROOT / '.local/knowledge-intake')
    manifest = verify(capture, args.capture_sha256, 'sena-knowledge-preaudit-v1')
    raw_mapping = args.mapping.read_bytes()
    if sha(raw_mapping) != args.mapping_sha256:
        raise ValueError('mapping_hash_mismatch')
    mapping = json.loads(raw_mapping)
    pages = read(capture / 'pages.json')
    rows, drafts, cards = build_rows(pages, read(capture / 'file-references.json'),
        read(capture / 'video-links.json'), mapping, capture, args.capture_sha256)
    out = inside(args.out, ROOT / '.local/sena-public-import')
    out.mkdir(parents=True, exist_ok=False)
    write(out / 'candidates.json', rows)
    write(out / 'drafts.json', drafts)
    write(out / 'fact-cards.json', cards)
    attempted = {pid for p in pages for pid in p['project_ids']}
    gaps = [{'sheet_row': r['sheet_row'], 'project_id': r.get('Project ID'),
             'reason': 'missing_REM_ID' if not r.get('rem') else
                       'fetch_failed' if r.get('Project ID') in attempted else
                       'no_website_url' if not r.get('Website URL', '').startswith('https://') else 'not_in_this_capture',
             'url': r.get('Website URL')} for r in mapping
            if not r.get('rem') or r.get('Project ID') not in {d['rem_project_id'] for d in drafts}]
    summary = {'candidates': len(rows), 'kinds': dict(Counter(r['kind'] for r in rows)),
               'project_drafts': len(drafts), 'gaps': gaps, 'crawl': manifest['summary'],
               'embedding_calls': 0, 'human_approvals': 0, 'published': 0}
    write(out / 'summary.json', summary)
    package = {'contract_version': CONTRACT, 'created_at': datetime.now(timezone.utc).isoformat(),
        'capture': {'folder': str(capture), 'manifest_sha256': args.capture_sha256},
        'mapping_sha256': args.mapping_sha256, 'source_evidence': manifest.get('source_evidence'), 'files': {}}
    for path in sorted(out.iterdir()):
        raw = path.read_bytes()
        package['files'][path.name] = {'sha256': sha(raw), 'bytes': len(raw)}
    write(out / 'manifest.json', package)
    print(json.dumps({'package': str(out), 'manifest_sha256': sha((out / 'manifest.json').read_bytes()), **summary}, ensure_ascii=False))


async def connect_working():
    config = read(ROOT / '.local/development.json')
    db = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local', user='postgres', password=config['adminPassword'])
    if Path(await db.fetchval('SHOW data_directory')).resolve() != (ROOT / '.local/postgres').resolve() or await db.fetchval('SELECT current_database()') != 'sena_hub_local':
        await db.close()
        raise ValueError('working_local_only_guard')
    for typename in ('json', 'jsonb'):
        await db.set_type_codec(typename, schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
    return db, config


async def preserved_state(db):
    result = {}
    for table in ('hub.user_account', 'hub.user_account_event', 'hub.account_permission', 'hub.permission_event',
                  'staging.rem_projects', 'staging.rem_models', 'hub.entity_versions', 'hub.knowledge_reviews', 'hub.knowledge_asset_links'):
        value = await db.fetchval(f'SELECT coalesce(jsonb_agg(v ORDER BY v::text),\'[]\'::jsonb)::text FROM (SELECT to_jsonb(t) v FROM {table} t) rows')
        result[table] = sha(value.encode())
    return result


def backup_working(config):
    folder = ROOT / '.local/backups' / ('sena-public-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    folder.mkdir(parents=True)
    dump = folder / 'sena_hub_local.dump'
    binary = ROOT / '.local/tools/postgresql-17.11/pg_dump.exe'
    env = {**os.environ, 'PGPASSWORD': config['adminPassword']}
    result = subprocess.run([str(binary), '-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'sena_hub_local', '-Fc', '-f', str(dump)], env=env, capture_output=True)
    if result.returncode or not dump.is_file() or not dump.stat().st_size:
        raise ValueError('local_backup_failed')
    return dump


async def import_rows(db, digest, manifest, rows, drafts, cards):
    """Called inside one operator transaction; draft writes use real hub_app checks."""
    await db.execute('SELECT pg_advisory_xact_lock(710054)')
    if await db.fetchval('SELECT EXISTS(SELECT 1 FROM staging.knowledge_batches WHERE manifest_sha256=$1)', digest):
        return {'replay': True, 'created_projects': [], 'filled_projects': [], 'preserved_projects': []}
    existing_ids = set(await db.fetchval('SELECT array_agg(rem_project_id) FROM staging.rem_projects') or [])
    if not {d['rem_project_id'] for d in drafts} <= existing_ids:
        raise ValueError('REM_mapping_changed')
    await db.execute('INSERT INTO staging.knowledge_batches VALUES($1,$2,now())', digest, manifest)
    await db.executemany('''INSERT INTO staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,programme_ids,topic,source_url,source_ref,evidence,holds)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)''',
        [(UUID(r['id']), digest, r['source_key'], r['kind'], r['project_ids'], r['programme_ids'], r['topic'], r['source_url'], r['source_ref'], r['evidence'], r['holds']) for r in rows])
    await db.executemany('INSERT INTO rag.project_fact_cards(rem_project_id,batch_sha256,payload) VALUES($1,$2,$3) ON CONFLICT(rem_project_id) DO NOTHING',
        [(r['rem_project_id'], digest, r['payload']) for r in cards])
    result = {'replay': False, 'created_projects': [], 'filled_projects': [], 'preserved_projects': []}
    await db.execute("SELECT set_config('app.actor_id',$1,true)", str(ACTOR))
    await db.execute("SELECT set_config('app.change_reason',$1,true)", 'Public SENA website import: draft source only; no human approval')
    await db.execute('SET LOCAL ROLE hub_app')
    try:
        await db.fetchval("SELECT hub.require_permission('projects','edit')")
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
            # Existing human fields are untouched. Only a newly created draft
            # receives factual text defaults; never derive coordinates or dates.
            if created and len(draft['sources']) == 1:
                site = draft['sources'][0]['website']
                if site.get('address'):
                    changes['address'] = {'th': site['address']}
                if site.get('title'):
                    changes['meta_title'] = {'th': site['title'][:250]}
                if site.get('description'):
                    changes['meta_description'] = {'th': site['description'][:1000]}
            await db.fetchval('SELECT hub.patch_project($1,$2,$3)', project['id'], changes, project['updated_at'])
            result['filled_projects'].append(pid)
    finally:
        await db.execute('RESET ROLE')
    return result


async def apply(args):
    folder = inside(args.package, ROOT / '.local/sena-public-import')
    manifest = verify(folder, args.manifest_sha256, CONTRACT)
    capture = inside(Path(manifest['capture']['folder']), ROOT / '.local/knowledge-intake')
    verify(capture, manifest['capture']['manifest_sha256'], 'sena-knowledge-preaudit-v1')
    rows, drafts, cards = (read(folder / name) for name in ('candidates.json', 'drafts.json', 'fact-cards.json'))
    if len({r['id'] for r in rows}) != len(rows):
        raise ValueError('duplicate_candidate_identity')
    db, config = await connect_working()
    try:
        summary = {**read(folder / 'summary.json'), 'apply': args.apply}
        if not args.apply:
            summary['existing_projects'] = await db.fetchval('SELECT count(*) FROM hub.projects WHERE rem_project_id=ANY($1)', [d['rem_project_id'] for d in drafts])
            print(json.dumps(summary, ensure_ascii=False))
            return
        backup = backup_working(config)
        before = await preserved_state(db)
        # Validate all bytes again before installation. No original or existing
        # private file is overwritten; content-addressed copies are harmless on rollback.
        assets = ROOT / '.local/knowledge-assets'
        assets.mkdir(exist_ok=True)
        for row in rows:
            if row['kind'] != 'asset':
                continue
            evidence = row['evidence']
            loc = evidence['locations'][0]
            path = inside(Path(loc['package']) / loc['blob'], capture)
            if sha(path.read_bytes()) != evidence['sha256']:
                raise ValueError('asset_integrity_failed')
            target = inside(assets / evidence['sha256'], assets)
            if target.exists():
                if sha(target.read_bytes()) != evidence['sha256']:
                    raise ValueError('existing_asset_mismatch')
            else:
                with target.open('xb') as stream, path.open('rb') as source:
                    shutil.copyfileobj(source, stream)
        async with db.transaction():
            result = await import_rows(db, args.manifest_sha256, manifest, rows, drafts, cards)
            if await preserved_state(db) != before:
                raise ValueError('protected_state_changed_rolling_back')
            if not await db.fetchval("SELECT EXISTS(SELECT 1 FROM staging.rem_projects WHERE rem_project_id='BNA7')"):
                raise ValueError('BNA7_missing_rolling_back')
        receipt = {**summary, **result, 'backup': str(backup), 'preserved_state': before,
                   'manifest_sha256': args.manifest_sha256, 'BNA7_present': True}
        write(folder / 'receipt.json', receipt)
        print(json.dumps(receipt, ensure_ascii=False))
    finally:
        await db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('prepare')
    p.add_argument('--capture', type=Path, required=True)
    p.add_argument('--capture-sha256', required=True)
    p.add_argument('--mapping', type=Path, required=True)
    p.add_argument('--mapping-sha256', required=True)
    p.add_argument('--out', type=Path, required=True)
    p = commands.add_parser('apply')
    p.add_argument('--package', type=Path, required=True)
    p.add_argument('--manifest-sha256', required=True)
    p.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare(args)
    else:
        asyncio.run(apply(args))
