"""Pinned public website evidence -> private content drafts and media suggestions.

No source-sheet writes, live AI, approval or publication. Operators supply an
already verified target/backup and run import_rows in one guarded transaction.
"""
import argparse
import asyncio
from collections import Counter, defaultdict
from contextlib import redirect_stdout
from datetime import datetime, timezone
import importlib
import io
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit
from uuid import NAMESPACE_URL, UUID, uuid5

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
public = importlib.import_module('import-sena-public')
cleanup = importlib.import_module('clean-knowledge')
sheet = importlib.import_module('business-sheet')
REMARK = public.REMARK
CONTRACT = 'sena-website-content-v1'
sha = public.sha
require = sheet.require


def position_suggestion(reference, tags):
    """Page position proposes metadata; it never confirms content or identity."""
    label = ' '.join(str(reference.get(key) or '') for key in ('section', 'label', 'gallery_tab'))
    hint = label + ' ' + unquote(urlsplit(reference['url']).path)
    # A gallery's broad "Floor Plan" tab can contain the project's master plan.
    # Use an explicit label/filename first; a /masterplan/ directory alone also
    # contains ordinary floor plans and is not sufficient evidence.
    specific = str(reference.get('label') or '') + ' ' + unquote(urlsplit(reference['url']).path).rsplit('/', 1)[-1]
    category = 'master_plan' if re.search(r'master[_ -]?plan|ผังโครงการ', specific, re.I) else None
    for key, pattern in [
        ('unit_plan', r'unit[_ -]?plan|type[_ -]?plan|แปลน(?:ห้อง|บ้าน)'),
        ('floor_plan', r'floor[_ -]?plan|แปลนชั้น'),
        ('master_plan', r'master[_ -]?plan|ผังโครงการ'),
        ('brochure', r'\.pdf$|brochure|โบรชัวร์'),
        ('map', r'(?:^|[/ _-])map(?:[/. _-]|$)|แผนที่'),
        ('progress', r'progress|construction|ความคืบหน้า|งานก่อสร้าง'),
        ('promotion_ad', r'promotion|โปรโมชั่น|โปรโมชัน'),
        ('facility', r'facilit|ส่วนกลาง|สิ่งอำนวยความสะดวก'),
        ('aerial', r'aerial|ภาพมุมสูง'),
        ('interior', r'interior|ภายใน|unit_type_gallery'),
        ('exterior', r'exterior|ภายนอก'),
        ('lifestyle', r'lifestyle|ไลฟ์สไตล์'),
        ('surrounding', r'surrounding|บรรยากาศโดยรอบ'),
    ]:
        if category:
            break
        if re.search(pattern, hint, re.I):
            category = key
            break
    proposed_tags = []
    for tag in tags:
        if tag['status'] != 'active' or tag['allowed_categories'] and category not in tag['allowed_categories']:
            continue
        # Thai labels and bounded Latin codes are evidence only. No new tags.
        names = [tag['code'].replace('_', ' '), *tag['label'].values()]
        if any(name and re.search(r'(?<![A-Za-z0-9])' + re.escape(name) + r'(?![A-Za-z0-9])', label, re.I) for name in names):
            proposed_tags.append(tag['code'])
    return {'media_category': category, 'tags': sorted(set(proposed_tags)),
            'image_kind': 'drawing' if category in ('unit_plan', 'floor_plan', 'master_plan', 'map') else 'progress' if category == 'progress' else None,
            'context': {key: reference[key] for key in ('type_label', 'floor_label', 'building_label', 'gallery_tab') if reference.get(key)},
            'label': reference.get('label') or '', 'page_url': reference['page_url'],
            'project_ids': reference['project_ids'], 'confirmed': False}


def prepare(capture, capture_sha256, business, known_ids, tags, cleanup_records=None):
    """One captured source is replayable in both databases; IDs are exact text."""
    capture = public.inside(capture, ROOT / '.local/knowledge-intake')
    manifest = public.verify(capture, capture_sha256, 'sena-knowledge-preaudit-v1')
    if manifest['source_evidence']['manifest_sha256'] != business['manifest_sha256']:
        raise ValueError('capture_business_snapshot_mismatch')
    pages = public.read(capture / 'pages.json')
    files = public.read(capture / 'file-references.json')
    videos = public.read(capture / 'video-links.json')
    mapping = []
    for item in business['datasets']['business_projects']:
        record = item['record']
        if record['Project ID'] in known_ids:
            mapping.append({'Project ID': record['Project ID'], 'rem': {
                'project_name_rem': record['REM Project Name'], 'source_record': {}}})
    candidates, _, _ = public.build_rows(pages, files, videos, mapping, capture, capture_sha256)
    by_checksum = {row['evidence']['sha256']: row for row in candidates if row['kind'] == 'asset'}
    grouped = defaultdict(list)
    for file in files:
        if file['status'] == 'downloaded':
            grouped[file['sha256']].append(file)
    decisions = {item['sha256']: item for item in cleanup_records or []}
    assets, excluded = [], []
    for checksum, candidate in by_checksum.items():
        evidence = candidate['evidence']
        group = grouped[checksum]
        dimensions = evidence.get('dimensions')
        size = [dimensions['width'], dimensions['height']] if dimensions and all(dimensions.get(k) for k in ('width', 'height')) else None
        decision = decisions.get(checksum, {})
        reason = decision.get('reason') if decision.get('decision') in ('excluded', 'variant') else cleanup.chrome_reason(evidence['url_aliases'], size, evidence['mime'])
        if not reason and evidence['validated_metadata'] is None:
            reason = 'asset_validation_failed'
        if reason:
            excluded.append({'sha256': checksum, 'reason': reason, 'candidate_id': candidate['id']})
            continue
        # Preserve the labels/scopes of smaller pixel-verified variants on their
        # retained original; source capture bytes remain immutable.
        variants = [item for item in decisions.values() if item.get('canonical_sha256') == checksum and item['sha256'] != checksum]
        sources = group + [file for item in variants for file in grouped[item['sha256']]]
        positions = [position_suggestion(ref, tags) for file in sources for ref in file['references']]
        unique = {json.dumps(item, sort_keys=True, ensure_ascii=False): item for item in positions}
        positions = [unique[key] for key in sorted(unique)]
        categories = {item['media_category'] for item in positions if item['media_category']}
        kinds = {item['image_kind'] for item in positions if item['image_kind']}
        assets.append({'sha256': checksum, 'metadata': evidence['validated_metadata'],
                       'candidate_id': candidate['id'], 'blob': group[0]['blob'], 'project_ids': sorted({pid for file in sources for ref in file['references'] for pid in ref['project_ids']} & set(known_ids)),
                       'page_position': {'media_category': next(iter(categories)) if len(categories) == 1 else None,
                         'tags': sorted({tag for item in positions for tag in item['tags']}) if len(categories) == 1 else [],
                         'image_kind': next(iter(kinds)) if len(kinds) == 1 else None,
                         'conflicting_categories': sorted(categories) if len(categories) > 1 else [],
                         'positions': positions, 'taken_at': None, 'confirmed': False},
                       'fetched_at': sorted({file['fetched_at'] for file in sources}), 'source_remark': REMARK})
    structured = []
    fields = ('project_information', 'facilities', 'nearby', 'contacts', 'call_centres', 'unit_types',
              'floor_plans', 'unit_plans', 'construction', 'disclosures', 'promotion_terms', 'tours', 'videos')
    for page in pages:
        ids = sorted(set(page['project_ids']) & set(known_ids))
        if not ids or not page.get('website'):
            continue
        source = {'source_kind': 'sena_public_website', 'source_remark': REMARK,
                  'page_url': page['url'], 'fetched_at': page['fetched_at'], 'capture_sha256': capture_sha256,
                  'source_project_ids': page['project_ids'], 'project_ids': ids, 'confirmed': False}
        website = page['website']
        for field in fields:
            for index, value in enumerate(website.get(field, [])):
                key = f'website-content:{capture_sha256}:{page["url"]}:{field}:{index}'
                structured.append({'source_key': key, 'id': str(uuid5(NAMESPACE_URL, key)),
                                   'kind': field, 'value': value, 'source': source})
        for field in ('concept', 'concept_name', 'description'):
            if website.get(field):
                key = f'website-content:{capture_sha256}:{page["url"]}:{field}'
                structured.append({'source_key': key, 'id': str(uuid5(NAMESPACE_URL, key)),
                                   'kind': field, 'value': website[field], 'source': source})
    excluded_ids = {item['candidate_id'] for item in excluded}
    candidates = [row for row in candidates if row['id'] not in excluded_ids]
    return {'candidates': candidates, 'assets': assets, 'structured': structured,
            'excluded_assets': excluded, 'summary': {'candidates': len(candidates), 'assets': len(assets),
              'eligible_images': sum(a['metadata']['asset_type'] == 'image' for a in assets),
              'excluded_assets': dict(Counter(row['reason'] for row in excluded)),
              'structured': dict(Counter(row['kind'] for row in structured)), 'live_ai_calls': 0}}


def exact_facility(value, taxonomy):
    name = re.sub(r'\s+', ' ', value['name']).strip().casefold()
    matches = [row['code'] for row in taxonomy if row.get('active') and name in {
        re.sub(r'\s+', ' ', str(row.get(key) or '')).strip().casefold() for key in ('code', 'name_th', 'name_en')}]
    return matches[0] if len(matches) == 1 else None


def unit_values(value):
    """Explicit labelled dimensions only; no price or REM allocation inference."""
    text = ' '.join([str(value.get('size_text') or ''), str(value.get('detail') or ''), *map(str, value.get('specification_text', []))])
    result = {}
    area = re.search(r'(?<![\d.,])(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?))?\s*(?:ตร\.?\s*ม\.?|sq\.?\s*m\.?)', text, re.I)
    if area:
        low, high = float(area[1]), float(area[2] or area[1])
        if 0 < low <= high <= 100000:
            result.update(area_min_sqm=low, area_max_sqm=high)
    for field, label in [('bedrooms', r'ห้องนอน|bed\s*room'), ('bathrooms', r'ห้องน้ำ|bath\s*room'),
                         ('parking_spaces', r'ที่จอดรถ|car\s*park'), ('storeys', r'ชั้น|store[yi]s?')]:
        match = re.search(r'(?<![\d.])(\d{1,2})\s*(?:' + label + r')(?![A-Za-z])', text, re.I)
        if match and (field != 'storeys' or int(match[1]) > 0):
            result[field] = int(match[1])
    for room in value.get('rooms', []):
        label = str(room.get('label') or room.get('name') or '')
        number = str(room.get('count_text', ''))
        for field, pattern in [('bedrooms', 'ห้องนอน'), ('bathrooms', 'ห้องน้ำ')]:
            if pattern in label and re.fullmatch(r'\d{1,2}', number):
                result[field] = int(number)
    return result


def asset_source(asset, capture_sha256):
    positions = asset['page_position']['positions']
    require(bool(positions), 'asset_source_missing')
    return {'source_kind': 'sena_public_website', 'source_remark': REMARK,
            'page_url': positions[0]['page_url'], 'fetched_at': asset['fetched_at'][0],
            'capture_sha256': capture_sha256, 'confirmed': False, 'source_project_ids': asset['project_ids'],
            'positions': positions, 'taken_at': None}


async def register_asset(db, asset, storage, capture_sha256, batch_sha256, projects):
    """Bytes have been checksum-verified/conditionally installed before this call."""
    metadata, suggestion = asset['metadata'], asset['page_position']
    require(storage['checksum'] == metadata['checksum'] and storage['verified'] is True, 'unverified_storage')
    require(storage['storage_bucket'] in ('local-originals', 'r2-test-content'), 'wrong_asset_store')
    require(storage['storage_path'] == metadata['storage_path'] or storage['storage_bucket'] == 'r2-test-content'
            and storage['storage_path'] == 'knowledge/' + metadata['checksum'], 'wrong_asset_path')
    await db.execute('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', metadata['checksum'])
    row = await db.fetchrow('SELECT * FROM hub.assets WHERE checksum=$1 AND deleted_at IS NULL FOR UPDATE', metadata['checksum'])
    created = row is None
    if created:
        identity = uuid5(NAMESPACE_URL, 'website-asset:' + metadata['checksum'])
        hosted = storage['storage_bucket'] == 'r2-test-content'
        require(storage['storage_bucket'] in ('local-originals', 'r2-test-content'), 'wrong_asset_store')
        await db.execute('''INSERT INTO hub.assets(id,original_filename,mime_type,public_url,rights_status,
            asset_type,storage_bucket,storage_path,checksum,file_size,width,height,language,owner_id,provenance,source_system,
            media_category,image_kind,metadata_state,ai_exposure,marketing_publication)
            VALUES($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10,$11,'th',hub.permission_actor(),'public_website',$12,$13,$14,'needs_review',$15,$16)''',
            identity, metadata['original_filename'], metadata['mime_type'], '/v1/assets/' + str(identity) + '/file',
            metadata['asset_type'], storage['storage_bucket'], storage['storage_path'], metadata['checksum'], metadata['file_size'],
            metadata.get('width'), metadata.get('height'), 'hub-hosted-test' if hosted else 'hub-local', suggestion['media_category'],
            suggestion['image_kind'], 'web_only' if metadata['asset_type'] == 'image' else 'internal',
            metadata['asset_type'] == 'image' and suggestion['media_category'] not in (None, 'legal_document', 'brochure'))
        row = await db.fetchrow('SELECT * FROM hub.assets WHERE id=$1', identity)
    # Reused registry rows are never updated: human metadata and rights win.
    source = asset_source(asset, capture_sha256)
    for rem_id in asset['project_ids']:
        project = projects.get(rem_id)
        if not project:
            continue
        contexts = []
        for position in suggestion['positions']:
            if rem_id not in position['project_ids']:
                continue
            proposed = position['context']
            target_type, target_key = 'project', str(project['id'])
            if proposed.get('type_label'):
                match = await db.fetchval("SELECT id FROM hub.commercial_types WHERE project_id=$1 AND public_name->>'th'=$2 AND deleted_at IS NULL", project['id'], proposed['type_label'])
                if match:
                    target_type, target_key = 'commercial_type', str(match)
            elif position.get('media_category') == 'facility':
                matches = await db.fetch("SELECT facility_code FROM hub.project_facilities WHERE project_id=$1 AND display_name->>'th'=$2 AND status='present'", project['id'], position.get('label', ''))
                if len(matches) == 1:
                    target_type, target_key = 'facility', matches[0]['facility_code']
            contexts.append((target_type, target_key))
        for target_type, target_key in sorted(set(contexts) or {('project', str(project['id']))}):
            exists = await db.fetchval('''SELECT EXISTS(SELECT 1 FROM hub.asset_links WHERE project_id=$1 AND asset_id=$2
                AND target_type=$3 AND target_key=$4 AND usage='gallery' AND deleted_at IS NULL)''', project['id'], row['id'], target_type, target_key)
            if not exists:
                await db.execute('''INSERT INTO hub.asset_links(project_id,asset_id,target_type,target_key,usage,ai_exposure,binding_confirmed,website_source)
                    VALUES($1,$2,$3,$4,'gallery','internal',false,$5)''', project['id'], row['id'], target_type, target_key, source)
        await db.execute('''INSERT INTO hub.website_asset_suggestions(project_id,asset_id,batch_sha256,page_position,source)
            VALUES($1,$2,$3,$4,$5)''', project['id'], row['id'], batch_sha256, suggestion, source)
    return {'asset_id': str(row['id']), 'created': created}


STRICT = ('hub.user_account', 'hub.user_account_event', 'hub.account_permission', 'hub.permission_event', 'hub.account_invite',
          'hub.permission_template', 'hub.knowledge_reviews', 'hub.knowledge_asset_links', 'hub.entity_versions', 'hub.brand_versions',
          'rag.knowledge_preview_chunks', 'staging.rem_projects', 'staging.rem_brands', 'staging.rem_models', 'staging.dw_projects', 'staging.dw_project_groups')
APPEND = ('hub.projects', 'hub.brands', 'hub.model_types', 'hub.assets', 'hub.entity_assets', 'hub.brand_assets',
          'staging.knowledge_candidates', 'staging.knowledge_batches', 'hub.project_facilities', 'hub.commercial_type_assets',
          'hub.commercial_types', 'hub.faqs', 'hub.content_sections', 'hub.contacts', 'hub.project_places', 'hub.project_progress',
          'hub.project_disclosures', 'hub.media_links', 'hub.media_link_targets', 'hub.asset_links')


async def protected_rows(db):
    tables = (*STRICT, *APPEND)
    if await db.fetchval("SELECT to_regclass('auth.users') IS NOT NULL"):
        tables = (*tables, 'auth.users')
    result = {}
    for table in tables:
        # Adding related drafts invokes the existing project touch trigger. Only
        # those expected touch fields are excluded from old project-content checks;
        # Auth and all account/permission columns remain strict.
        value = "to_jsonb(t)-array['updated_at','updated_by']" if table == 'hub.projects' else 'to_jsonb(t)'
        result[table] = Counter(await db.fetchval(f"SELECT coalesce(array_agg(md5(({value})::text)),'{{}}'::text[]) FROM {table} t"))
    return result


async def import_rows(db, actor, digest, manifest, data, storage):
    require(manifest['contract_version'] == CONTRACT, 'wrong_website_package')
    await db.execute('SELECT pg_advisory_xact_lock(710054)')
    await db.execute("SELECT set_config('app.actor_id',$1,true)", str(actor))
    await db.execute("SELECT set_config('app.change_reason',$1,true)", 'Public SENA website: unconfirmed source suggestions; no rights approval or publication')
    await db.fetchval("SELECT hub.require_permission('projects','edit')")
    replay = await db.fetchval('SELECT outcomes FROM staging.website_content_receipts WHERE batch_sha256=$1', digest)
    if replay:
        return {'status': 'already_applied', 'receipt': replay}
    protected = await protected_rows(db)
    old_settings = await db.fetchval("SELECT jsonb_object_agg(key,value) FROM ads.setting")
    prices = await db.fetchval('SELECT count(*) FROM hub.project_prices')
    await db.execute('INSERT INTO staging.knowledge_batches(manifest_sha256,manifest) VALUES($1,$2)', digest, manifest)
    rem_ids = sorted({pid for row in data['structured'] for pid in row['source']['project_ids']} | {pid for asset in data['assets'] for pid in asset['project_ids']})
    known = set(await db.fetchval('SELECT array_agg(rem_project_id) FROM staging.rem_projects') or [])
    require(set(rem_ids) <= known, 'REM_scope_changed')
    projects, created_projects = {}, []
    for rem_id in rem_ids:
        row = await db.fetchrow('SELECT * FROM hub.projects WHERE rem_project_id=$1 AND deleted_at IS NULL FOR UPDATE', rem_id)
        if row is None:
            identity = await db.fetchval('SELECT hub.create_project_from_rem($1)', rem_id)
            row = await db.fetchrow('SELECT * FROM hub.projects WHERE id=$1', identity)
            created_projects.append(rem_id)
        projects[rem_id] = row
    taxonomy = [dict(row) for row in await db.fetch('SELECT * FROM hub.facility_taxonomy')]
    wired, candidates = [], json.loads(json.dumps(data['candidates']))
    for candidate in candidates:
        if candidate['kind'] == 'asset' and storage[candidate['evidence']['sha256']]['storage_bucket'] == 'r2-test-content':
            candidate['evidence'].update(storage_provider='r2', storage_bucket='r2-test-content', locations=[])
    for item in data['structured']:
        outcomes = [await wire_text(db, projects[rem_id], item, taxonomy) for rem_id in item['source']['project_ids']]
        wired.extend(outcomes)
        candidates.append(structured_candidate(item, outcomes))
    registered = []
    for asset in data['assets']:
        registered.append(await register_asset(db, asset, storage[asset['sha256']], manifest['capture']['manifest_sha256'], digest, projects))
    await db.executemany('''INSERT INTO staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,programme_ids,topic,source_url,source_ref,evidence,holds)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)''', [(UUID(row['id']), digest, row['source_key'], row['kind'], row['project_ids'],
        row['programme_ids'], row['topic'], row['source_url'], row['source_ref'], row['evidence'], row['holds']) for row in candidates])
    faq = importlib.import_module('generate-faq-clusters')
    clusters = faq.build_clusters(**await faq.load_inputs(db))
    faq_result = await db.fetchval('SELECT staging.replace_faq_clusters($1,$2,$3)', clusters['generation_sha256'], clusters['algorithm'], clusters['clusters'])
    after = await protected_rows(db)
    for table, before in protected.items():
        require(not (before - after[table]) and (table in APPEND or before == after[table]), 'protected_content_changed:' + table)
    require(prices == await db.fetchval('SELECT count(*) FROM hub.project_prices'), 'website_prices_forbidden')
    require(old_settings == await db.fetchval('SELECT jsonb_object_agg(key,value) FROM ads.setting'), 'settings_changed')
    result = {'status': 'applied', 'created_projects': created_projects, 'candidates': len(candidates),
              'assets_created': sum(row['created'] for row in registered), 'assets_reused': sum(not row['created'] for row in registered),
              'text_outcomes': dict(Counter(row['outcome'] for row in wired)), 'text_records': dict(Counter(row.get('table') for row in wired if row['outcome'] == 'draft')),
              'faq': faq_result, 'conflicts': [row for row in wired if row['outcome'] == 'conflict'], 'live_ai_calls': 0,
              'protected_tables': len(protected), 'protected_existing_rows': 'preserved', 'prices_created': 0}
    await db.execute('INSERT INTO staging.website_content_receipts(batch_sha256,outcomes) VALUES($1,$2)', digest, result)
    return result


def contact_value(kind, value):
    if isinstance(value, str):
        value = {'text': value, 'label': value}
    url = str(value.get('url') or '')
    label = str(value.get('label') or '')
    if kind == 'call_centres':
        extension = re.search(r'(?:#|ต่อ|กด)\s*(\d{1,8})', str(value.get('text') or value.get('label') or value))
        return {'channel': 'call_center_ext', 'value': extension[1], 'url': None, 'label': {'th': '1775 · ' + label[:260]}} if extension else None
    parsed = urlsplit(url)
    if parsed.scheme == 'tel':
        number = unquote(parsed.path)
        return {'channel': 'phone', 'value': number, 'url': url, 'label': {'th': label[:300]}} if re.fullmatch(r'[+0-9 ()-]{2,50}', number) else None
    if parsed.scheme == 'mailto':
        number = unquote(parsed.path)
        return {'channel': 'email', 'value': number, 'url': 'mailto:' + number, 'label': {'th': label[:300]}} if re.fullmatch(r'[^\s@?]+@[^\s@?]+\.[^\s@?]+', number) and len(number) <= 254 else None
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443):
        return None
    channels = {'line.me': 'line_oa', 'lin.ee': 'line_oa', 'facebook.com': 'facebook', 'www.facebook.com': 'facebook',
                'fb.com': 'facebook', 'instagram.com': 'instagram', 'www.instagram.com': 'instagram',
                'tiktok.com': 'tiktok', 'www.tiktok.com': 'tiktok', 'youtube.com': 'youtube', 'www.youtube.com': 'youtube',
                'youtu.be': 'youtube', 'm.me': 'messenger', 'messenger.com': 'messenger', 'www.messenger.com': 'messenger'}
    channel = channels.get(parsed.hostname)
    return {'channel': channel, 'value': label or url, 'url': url, 'label': {'th': label[:300]}} if channel else None


def structured_candidate(item, wiring):
    kind = {'facilities': 'facility', 'nearby': 'nearby', 'disclosures': 'section', 'promotion_terms': 'promotion'}.get(item['kind'], 'fact')
    source = item['source']
    return {'id': item['id'], 'source_key': item['source_key'], 'kind': kind, 'project_ids': source['project_ids'],
            'programme_ids': [], 'topic': 'media_documents' if item['kind'] in ('tours', 'videos', 'floor_plans', 'unit_plans') else 'design',
            'source_url': source['page_url'], 'source_ref': item['source_key'],
            'evidence': {'source_kind': 'sena_public_website', 'source_remark': REMARK, 'fetched_at': source['fetched_at'],
                         'website_item_kind': item['kind'], 'website_value': item['value'], 'website_source': source, 'website_wiring': wiring},
            'holds': ['needs_phase_decision'] if len(source['source_project_ids']) > 1 else []}


async def wire_text(db, project, item, taxonomy):
    """Never update an existing human row, including deliberately cleared values."""
    kind, value, source = item['kind'], item['value'], item['source']
    pid, public_id = project['id'], project['public_project_id']
    identity = uuid5(NAMESPACE_URL, item['source_key'] + ':' + project['rem_project_id'])
    result = {'project_id': project['rem_project_id'], 'outcome': 'needs_review'}
    if len(source['source_project_ids']) > 1:
        return {**result, 'reason': 'shared_phase_scope_unconfirmed'}
    row_source = {**source, 'source_value': value}

    async def create(table, fields, collision, *args):
        if await db.fetchval(collision, *args):
            return {**result, 'outcome': 'conflict', 'reason': 'existing_content_preserved', 'table': table}
        keys = list(fields)
        await db.execute(f"INSERT INTO hub.{table}({','.join(keys)}) VALUES({','.join('$'+str(i+1) for i in range(len(keys)))})", *fields.values())
        return {**result, 'outcome': 'draft', 'table': table, 'id': str(fields.get('id') or fields.get('facility_code'))}

    if kind in ('concept', 'concept_name', 'description') and isinstance(value, str):
        key = {'concept': 'section.concept_detail', 'concept_name': 'section.concept_name', 'description': 'section.project_intro'}[kind]
        if not await db.fetchval('SELECT EXISTS(SELECT 1 FROM hub.field_catalog WHERE field_key=$1 AND status=\'active\')', key):
            return {**result, 'reason': 'narrative_field_unavailable'}
        if await db.fetchval("SELECT EXISTS(SELECT 1 FROM hub.content_sections WHERE scope_type='project' AND scope_id=$1 AND section_key=$2)", public_id, key):
            return {**result, 'outcome': 'conflict', 'reason': 'existing_narrative_preserved'}
        if len(value) > 12000:
            return {**result, 'reason': 'narrative_exceeds_field_limit'}
        row = await db.fetchval("SELECT hub.save_content_section('project',$1,$2,0,$3)", public_id, key,
                                {'body': {'th': value}, 'ai_exposure': 'internal', 'source_ref': source['page_url']})
        await db.execute('UPDATE hub.content_sections SET website_source=$1 WHERE id=$2', row_source, UUID(row['id']))
        return {**result, 'outcome': 'draft', 'table': 'content_sections', 'id': row['id']}
    if kind == 'facilities':
        code = exact_facility(value, taxonomy)
        if not code or len(value['name']) > 300 or len(value.get('location_label', '')) > 1000:
            return {**result, 'reason': 'facility_taxonomy_match_required'}
        return await create('project_facilities', {'project_id': pid, 'facility_code': code, 'status': 'present',
            'display_name': {'th': value['name']}, 'location_label': {'th': value.get('location_label', '')},
            'evidence_note': REMARK + '\n' + source['page_url'], 'ai_exposure': 'internal', 'website_source': row_source},
            'SELECT EXISTS(SELECT 1 FROM hub.project_facilities WHERE project_id=$1 AND facility_code=$2)', pid, code)
    if kind == 'nearby':
        text = value.get('text', '').strip()
        if not text or len(text) > 300:
            return {**result, 'reason': 'place_name_needs_review'}
        # Keep distance text in source evidence. No method, status or date is guessed.
        return await create('project_places', {'id': identity, 'project_id': pid, 'name': {'th': text},
            'category': None, 'status': None, 'as_of': None, 'show_on_web': False, 'ai_exposure': 'internal', 'website_source': row_source},
            "SELECT EXISTS(SELECT 1 FROM hub.project_places WHERE project_id=$1 AND name->>'th'=$2)", pid, text)
    if kind in ('contacts', 'call_centres'):
        contact = contact_value(kind, value)
        if not contact:
            return {**result, 'reason': 'contact_format_needs_review'}
        return await create('contacts', {'id': identity, 'scope_type': 'project', 'scope_id': public_id, **contact,
            'shared_mailbox_confirmed': False, 'ai_exposure': 'internal', 'website_source': row_source},
            "SELECT EXISTS(SELECT 1 FROM hub.contacts WHERE scope_type='project' AND scope_id=$1 AND channel=$2 AND value=$3)", public_id, contact['channel'], contact['value'])
    if kind == 'unit_types':
        label = value.get('label', '').strip()
        if not label or len(label) > 300:
            return {**result, 'reason': 'unit_type_label_needs_review'}
        return await create('commercial_types', {'id': identity, 'project_id': pid, 'public_name': {'th': label},
            'description': {'th': value.get('detail', '')[:4000]}, **unit_values(value), 'source_notes': REMARK + '\n' + source['page_url'],
            'status': 'draft', 'price_mode': 'hidden', 'ai_exposure': 'internal', 'website_source': row_source},
            "SELECT EXISTS(SELECT 1 FROM hub.commercial_types WHERE project_id=$1 AND deleted_at IS NULL AND lower(btrim(public_name->>'th'))=lower(btrim($2)))", pid, label)
    if kind == 'construction':
        label = str(value.get('component_label') or '')
        component = next((code for code, pattern in [('overall', r'ภาพรวม|overall'), ('structure', r'โครงสร้าง|structure'),
            ('architecture', r'สถาปัต|architect'), ('systems', r'ระบบ|system'), ('landscape', r'ภูมิทัศน์|landscape')] if re.search(pattern, label, re.I)), 'other')
        number = value.get('percent_text', '')
        percent = float(number) if re.fullmatch(r'\d+(?:\.\d+)?', str(number)) else None
        if percent is None or not 0 <= percent <= 100:
            return {**result, 'reason': 'progress_value_needs_review'}
        return await create('project_progress', {'id': identity, 'project_id': pid, 'component': component, 'percent': percent,
            'as_of': None, 'source': 'website_import', 'state': 'draft', 'ai_exposure': 'internal', 'website_source': row_source},
            'SELECT EXISTS(SELECT 1 FROM hub.project_progress WHERE project_id=$1 AND component=$2)', pid, component)
    if kind == 'disclosures':
        text = value.get('text') or ''
        return await create('project_disclosures', {'id': identity, 'project_id': pid, 'notes': {'th': text[:4000]},
            'basis': 'website_import', 'state': 'draft', 'ai_exposure': 'internal', 'website_source': row_source},
            'SELECT EXISTS(SELECT 1 FROM hub.project_disclosures WHERE project_id=$1)', pid)
    if kind in ('tours', 'videos'):
        url = value.get('url') or ''
        host = urlsplit(url).hostname
        provider = {'www.youtube.com': 'youtube', 'youtube.com': 'youtube', 'youtu.be': 'youtube',
                    'my.matterport.com': 'matterport', 'matterport.com': 'matterport', 'kuula.co': 'kuula'}.get(host)
        if not provider:
            return {**result, 'reason': 'media_provider_needs_review'}
        meta = value.get('provider_metadata') or {}
        result = await create('media_links', {'id': identity, 'project_id': pid, 'provider': provider,
            'kind': 'tour_360' if kind == 'tours' else 'walkthrough', 'url': url, 'title': {'th': value.get('label', '')[:500]},
            'owner_type': None, 'link_status': meta.get('link_status', 'unknown'), 'provider_metadata': meta or None,
            'metadata_source': 'provider' if meta else 'manual',
            'metadata_fetched_at': datetime.fromisoformat(value['metadata_fetched_at']) if meta else None,
            'external_id': meta.get('external_id'), 'embed_url': meta.get('embed_url'),
            'state': 'DRAFT', 'ai_exposure': 'internal', 'website_source': row_source},
            'SELECT EXISTS(SELECT 1 FROM hub.media_links WHERE project_id=$1 AND url=$2)', pid, url)
        if result['outcome'] == 'draft':
            await db.execute("INSERT INTO hub.media_link_targets(media_link_id,project_id,target_type,target_key) VALUES($1,$2,'project',$3)", identity, pid, str(pid))
        return result
    return result


async def enrich_links(structured):
    """Documented YouTube metadata only. No AI and no Matterport fetch."""
    from sena_hub_api.media_worker import fetch_clip_metadata, MediaError
    cache, gaps = {}, []
    for item in structured:
        if item['kind'] not in ('tours', 'videos'):
            continue
        value = item['value']
        url = urljoin(item['source']['page_url'], value.get('url', ''))
        parsed = urlsplit(url)
        if parsed.hostname in ('www.youtube-nocookie.com', 'youtube-nocookie.com') and re.fullmatch(r'/embed/[A-Za-z0-9_-]{11}', parsed.path):
            url = urlunsplit(('https', 'www.youtube.com', parsed.path, '', ''))
        value['url'] = url
        if urlsplit(url).hostname not in ('youtube.com', 'www.youtube.com', 'youtu.be'):
            continue
        if url not in cache:
            try:
                cache[url] = await fetch_clip_metadata('youtube', url)
            except MediaError as error:
                cache[url] = None
                gaps.append({'url': url, 'reason': str(error), 'kind': 'youtube_metadata'})
            await asyncio.sleep(1)
        if cache[url]:
            value.update(provider_metadata=cache[url], metadata_fetched_at=datetime.now(timezone.utc).isoformat())
    return gaps


def prepare_package(args):
    capture = public.inside(args.capture, ROOT / '.local/knowledge-intake')
    public.verify(capture, args.capture_sha256, 'sena-knowledge-preaudit-v1')
    business = sheet.verify_package(public.inside(args.business_package, ROOT / '.local/business-sheet-intake'), args.business_sha256)
    refs_path = public.inside(args.references, ROOT / '.local')
    raw = refs_path.read_bytes()
    require(sha(raw) == args.references_sha256, 'reference_snapshot_changed')
    refs = json.loads(raw)
    require(set(refs) == {'known_project_ids', 'media_tags'}, 'unexpected_reference_fields')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    folder = ROOT / '.local/website-content-intake' / (stamp + '-' + args.capture_sha256[:12])
    folder.mkdir(parents=True, exist_ok=False)
    files = public.read(capture / 'file-references.json')
    grouped = defaultdict(list)
    for file in files:
        if file['status'] == 'downloaded':
            grouped[file['sha256']].append(file)
    collection = []
    for checksum, group in grouped.items():
        first = group[0]
        collection.append({'sha256': checksum, 'bytes': first['bytes'], 'mime': first['mime'],
            'locations': [{'package': str(capture), 'blob': first['blob']}],
            'references': [{**reference, 'url': file['url']} for file in group for reference in file['references']]})
    public.write(folder / 'collection-files.json', collection)
    public.write(folder / 'collection-summary.json', {'captures': [{'folder': str(capture), 'manifest_sha256': args.capture_sha256}]})
    output = io.StringIO()
    with redirect_stdout(output):
        cleanup.prepare(folder / 'collection-summary.json')
    clean_folder = public.inside(Path(json.loads(output.getvalue())['folder']), ROOT / '.local/knowledge-cleanup')
    clean = public.read(clean_folder / 'records.json')
    data = prepare(capture, args.capture_sha256, business, refs['known_project_ids'], refs['media_tags'], clean)
    data['provider_gaps'] = asyncio.run(enrich_links(data['structured']))
    data['summary']['eligible_images'] = sum(asset['metadata']['asset_type'] == 'image' and
        asset['page_position']['media_category'] not in (None, 'legal_document', 'brochure') for asset in data['assets'])
    data['summary']['image_assets'] = sum(asset['metadata']['asset_type'] == 'image' for asset in data['assets'])
    data['summary']['unknown_exact_project_ids'] = sorted({row['record']['Project ID'] for row in business['datasets']['business_projects']} - set(refs['known_project_ids']))
    public.write(folder / 'content.json', data)
    public.write(folder / 'cleanup-records.json', clean)
    public.write(folder / 'references.json', refs)
    members = {}
    for name in ('content.json', 'cleanup-records.json', 'references.json', 'collection-files.json', 'collection-summary.json'):
        raw = (folder / name).read_bytes()
        members[name] = {'sha256': sha(raw), 'bytes': len(raw)}
    manifest = {'contract_version': CONTRACT, 'created_at': datetime.now(timezone.utc).isoformat(),
                'capture': {'folder': str(capture), 'manifest_sha256': args.capture_sha256},
                'business_manifest_sha256': args.business_sha256, 'references_sha256': args.references_sha256,
                'preparer_sha256': sha(Path(__file__).read_bytes()), 'cleanup_sha256': sha(Path(cleanup.__file__).read_bytes()),
                'files': members, 'counts': data['summary'], 'reviewed': False, 'live_ai_calls': 0}
    with (folder / 'manifest.json').open('xb') as stream:
        stream.write(sheet.encoded(manifest))
    digest = sha((folder / 'manifest.json').read_bytes())
    verify_package(folder, digest)
    return {'package': str(folder.relative_to(ROOT)), 'manifest_sha256': digest, **data['summary']}


def verify_package(folder, digest):
    folder = public.inside(folder, ROOT / '.local/website-content-intake')
    manifest = public.verify(folder, digest, CONTRACT)
    capture = public.inside(Path(manifest['capture']['folder']), ROOT / '.local/knowledge-intake')
    public.verify(capture, manifest['capture']['manifest_sha256'], 'sena-knowledge-preaudit-v1')
    require(manifest['live_ai_calls'] == 0, 'unexpected_ai_evidence')
    data = public.read(folder / 'content.json')
    for asset in data['assets']:
        raw = public.inside(capture / asset['blob'], capture).read_bytes()
        require(sha(raw) == asset['sha256'] == asset['metadata']['checksum'], 'asset_checksum_changed')
        require(public.validate_file(raw, asset['metadata']['mime_type'], asset['metadata']['original_filename']) == asset['metadata'], 'asset_validation_changed')
    return manifest, data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='operation', required=True)
    prepare_command = commands.add_parser('prepare')
    for name in ('capture', 'business-package', 'references'):
        prepare_command.add_argument('--' + name, type=Path, required=True)
    for name in ('capture-sha256', 'business-sha256', 'references-sha256'):
        prepare_command.add_argument('--' + name, required=True)
    verify_command = commands.add_parser('verify')
    verify_command.add_argument('--package', type=Path, required=True)
    verify_command.add_argument('--manifest-sha256', required=True)
    args = parser.parse_args()
    if args.operation == 'prepare':
        result = prepare_package(args)
    else:
        manifest, _ = verify_package(args.package, args.manifest_sha256)
        result = {'status': 'verified', 'manifest_sha256': args.manifest_sha256, 'counts': manifest['counts']}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'STOP', 'error_class': type(error).__name__, 'details_withheld': True}))
        raise SystemExit(1) from None
