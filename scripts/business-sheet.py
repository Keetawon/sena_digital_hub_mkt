"""Owner-approved public business-sheet snapshots. No source-sheet writes."""
from __future__ import annotations

from collections import Counter, defaultdict
import argparse
import asyncio
import csv
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
from pathlib import Path
import sys
import unicodedata
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

SHEET = '1BvPr9mjRt2hm2OUVS29HPIjGShZM8rbuRB77xExv-j4'
TABS = {'Project': '0', 'ProjectGroupMaster': '633899292'}
PROJECT_FIELDS = (
    'BUD', 'Project ID', 'Project', 'Project Name EN', 'Brand', 'Project Type',
    'Project Subtype', 'Project Area', 'Project Investment', 'REM Project Name',
    'LINE OA TAG NAME', 'Super Project Mapping', 'Project Group ID', 'Website URL',
    'CMS ID', 'AREA DISTRICT', 'ZONE-ROAD',
)
GROUP_FIELDS = ('ProjectGroupID', 'MemberCount', 'ProjectID_Set', 'ProjectName_TH', 'ProjectName_EN',
                'Address_TH', 'Address_EN', 'Road_TH', 'Road_EN', 'SubDistrict_TH', 'SubDistrict_EN',
                'District_TH', 'District_EN', 'Province_TH', 'Province_EN', 'PostCode')
CONTRACT = 'sena-business-sheet-v1'
MAX_CSV_BYTES = 5 * 1024 * 1024
ROOT = Path(__file__).resolve().parents[1]


def require(condition, code):
    if not condition:
        raise ValueError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf8')


def export_url(tab):
    require(tab in TABS, 'tab_not_authorized')
    return f'https://docs.google.com/spreadsheets/d/{SHEET}/export?format=csv&gid={TABS[tab]}'


class PublicExportRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        target = urlsplit(newurl)
        host = target.hostname or ''
        require(target.scheme == 'https' and target.port in (None, 443)
                and not target.username and not target.password
                and (host == 'docs.google.com' or host.endswith('.googleusercontent.com')),
                'export_redirect_not_authorized')
        return super().redirect_request(request, response, code, message, headers, newurl)


def fetch_csv(tab):
    request = Request(export_url(tab), headers={'Accept': 'text/csv', 'User-Agent': 'SenaHubBusinessSnapshot/1.0'})
    with build_opener(PublicExportRedirect()).open(request, timeout=45) as response:
        require(response.status == 200, 'export_unavailable')
        raw = response.read(MAX_CSV_BYTES + 1)
        require(len(raw) <= MAX_CSV_BYTES, 'export_too_large')
        require(response.headers.get_content_type() in ('text/csv', 'application/csv', 'text/plain'), 'export_not_csv')
    return raw


def csv_rows(raw):
    rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'), newline=''), strict=True))
    require(bool(rows), 'empty_export')
    headers = rows[0]
    require(all(headers) and len(set(headers)) == len(headers), 'duplicate_or_blank_header')
    require(all(len(row) == len(headers) for row in rows[1:]), 'csv_column_count_mismatch')
    # Never trim identifiers or coerce strings into numbers, dates or formulas.
    return headers, [{'row': number, 'record': dict(zip(headers, values))}
                     for number, values in enumerate(rows[1:], 2) if any(values)]


def suspicious(record):
    findings = []
    for field, value in record.items():
        if any(unicodedata.category(char).startswith('C') and char not in '\r\n\t' for char in value):
            findings.append({'field': field, 'code': 'CONTROL_OR_INVISIBLE_CHARACTER'})
        if (field.casefold().endswith((' en', 'eng', '_en'))) and any('\u0e00' <= char <= '\u0e7f' for char in value):
            findings.append({'field': field, 'code': 'THAI_CHARACTER_IN_ENGLISH_NAME'})
    return findings


def project_rows(raw):
    headers, rows = csv_rows(raw)
    require(set(PROJECT_FIELDS) <= set(headers), 'project_header_contract_changed')
    result, exceptions = [], []
    for row in rows:
        record = {field: row['record'][field] for field in PROJECT_FIELDS}
        item = {'row': row['row'], 'record': record, 'findings': suspicious(record)}
        identity = record['Project ID']
        if not identity.strip():
            exceptions.append({**item, 'code': 'PROJECT_ID_MISSING'})
            continue
        if identity != identity.strip():
            item['findings'].append({'field': 'Project ID', 'code': 'IDENTIFIER_WHITESPACE_PRESERVED'})
        aliases = defaultdict(list)
        for spelling in record['Super Project Mapping'].split('|'):
            if spelling.strip():
                aliases[spelling.strip().casefold()].append(spelling)
        item['alias_candidates'] = [{'lookup': key, 'source_spellings': list(dict.fromkeys(values)), 'confirmed': False}
                                    for key, values in sorted(aliases.items())]
        result.append(item)
    duplicates = {key for key, count in Counter(item['record']['Project ID'] for item in result).items() if count > 1}
    for item in result:
        if item['record']['Project ID'] in duplicates:
            item['findings'].append({'field': 'Project ID', 'code': 'MULTIPLE_SOURCE_ROWS_FOR_EXACT_ID'})
    return result, exceptions


def group_rows(raw):
    headers, rows = csv_rows(raw)
    require(len(headers) == 16 and set(headers) == set(GROUP_FIELDS), 'group_header_contract_changed')
    result = []
    for row in rows:
        record = row['record']
        findings = suspicious(record)
        members = record['ProjectID_Set'].split(',') if record['ProjectID_Set'] else []
        count = int(record['MemberCount']) if record['MemberCount'].isascii() and record['MemberCount'].isdecimal() else None
        if not record['ProjectGroupID'].strip():
            findings.append({'field': 'ProjectGroupID', 'code': 'GROUP_ID_MISSING'})
        if record['ProjectGroupID'] != record['ProjectGroupID'].strip() or any(member != member.strip() for member in members):
            findings.append({'field': 'ProjectID_Set', 'code': 'IDENTIFIER_WHITESPACE_PRESERVED'})
        if count is None and record['MemberCount'] or count is not None and count != len(members):
            findings.append({'field': 'MemberCount', 'code': 'GROUP_MEMBER_COUNT_MISMATCH'})
        if any(not member.strip() for member in members) or len(set(members)) != len(members):
            findings.append({'field': 'ProjectID_Set', 'code': 'GROUP_MEMBER_ID_INVALID'})
        result.append({**row, 'findings': findings, 'members': members, 'member_count': count})
    return headers, result


def write_package(parent, projects_raw, groups_raw, extracted_at=None):
    """An immutable package contains only the two authorized tab exports."""
    stamp = extracted_at or datetime.now(timezone.utc).isoformat()
    instant = datetime.fromisoformat(stamp)
    require(instant.tzinfo is not None, 'snapshot_timezone_required')
    projects, exceptions = project_rows(projects_raw)
    columns, groups = group_rows(groups_raw)
    payloads = {'Project.csv': projects_raw, 'ProjectGroupMaster.csv': groups_raw,
                'projects.json': encoded(projects), 'project_groups.json': encoded(groups), 'exceptions.json': encoded(exceptions)}
    manifest = {'contract_version': CONTRACT, 'source_system': 'business_sheet', 'spreadsheet_id': SHEET,
                'extracted_at': stamp,
                'source_snapshot_date': instant.astimezone(timezone(timedelta(hours=7))).date().isoformat(),
                'tabs': {tab: {'gid': gid, 'url': export_url(tab)} for tab, gid in TABS.items()},
                'project_fields': list(PROJECT_FIELDS), 'group_fields': columns,
                'counts': {'projects': len(projects), 'project_groups': len(groups), 'exceptions': len(exceptions)},
                'files': {name: {'sha256': sha(raw), 'bytes': len(raw)} for name, raw in payloads.items()}}
    manifest_raw = encoded(manifest)
    folder = Path(parent) / (stamp.replace(':', '-').replace('+', '_') + '-' + sha(manifest_raw)[:12])
    folder.mkdir(parents=True, exist_ok=False)
    for name, raw in {**payloads, 'manifest.json': manifest_raw, 'manifest.sha256': (sha(manifest_raw) + '  manifest.json\n').encode()}.items():
        with (folder / name).open('xb') as output:
            output.write(raw)
    return folder, sha(manifest_raw), manifest


def verify_package(folder, expected):
    folder = Path(folder)
    require(not folder.is_symlink(), 'package_symlink')
    folder = folder.resolve()
    require(all(not item.is_symlink() and item.is_file() for item in folder.iterdir()), 'package_symlink_or_directory')
    manifest_raw = (folder / 'manifest.json').read_bytes()
    require(sha(manifest_raw) == expected, 'manifest_hash_mismatch')
    manifest = json.loads(manifest_raw)
    require(manifest['contract_version'] == CONTRACT and manifest['spreadsheet_id'] == SHEET, 'wrong_source_contract')
    require(manifest['tabs'] == {tab: {'gid': gid, 'url': export_url(tab)} for tab, gid in TABS.items()}, 'wrong_tab_contract')
    instant = datetime.fromisoformat(manifest['extracted_at'])
    require(instant.tzinfo is not None, 'snapshot_timezone_required')
    require(manifest['source_snapshot_date'] == instant.astimezone(timezone(timedelta(hours=7))).date().isoformat(), 'snapshot_date_mismatch')
    names = {'Project.csv', 'ProjectGroupMaster.csv', 'projects.json', 'project_groups.json', 'exceptions.json'}
    require(set(manifest['files']) == names, 'package_file_contract_changed')
    require({p.name for p in folder.iterdir()} == names | {'manifest.json', 'manifest.sha256'}, 'unexpected_package_file')
    require((folder / 'manifest.sha256').read_text().split() == [expected, 'manifest.json'], 'manifest_sidecar_mismatch')
    for name, meta in manifest['files'].items():
        path = folder / name
        require(not path.is_symlink(), 'package_symlink')
        raw = path.read_bytes()
        require(len(raw) == meta['bytes'] and sha(raw) == meta['sha256'], 'package_member_mismatch')
    projects, exceptions = project_rows((folder / 'Project.csv').read_bytes())
    headers, groups = group_rows((folder / 'ProjectGroupMaster.csv').read_bytes())
    require(manifest['counts'] == {'projects': len(projects), 'project_groups': len(groups), 'exceptions': len(exceptions)}, 'snapshot_count_mismatch')
    require(manifest['project_fields'] == list(PROJECT_FIELDS) and manifest['group_fields'] == headers, 'normalized_header_mismatch')
    for name, value in [('projects.json', projects), ('project_groups.json', groups), ('exceptions.json', exceptions)]:
        require((folder / name).read_bytes() == encoded(value), 'normalized_source_mismatch')
    return {'manifest_sha256': expected, 'manifest': manifest,
            'datasets': {'business_projects': projects, 'business_project_groups': groups, 'exceptions': exceptions}}


# Match the DW projection's names; never load its financial or sales-email fields.
DW_FIELDS = {
    'BUD': 'marketing_bud', 'Project ID': 'project_id', 'Project': 'commercial_project_name',
    'Project Name EN': 'commercial_project_name_eng', 'Brand': 'commercial_brand',
    'Project Type': 'commercial_project_type', 'Project Subtype': 'commercial_project_subtype',
    'Project Area': 'commercial_project_area', 'Project Investment': 'commercial_investment_type',
    'REM Project Name': 'project_name', 'LINE OA TAG NAME': 'line_oa_tag_name',
    'Super Project Mapping': 'super_project_mapping', 'Project Group ID': 'marketing_project_group_id',
    'Website URL': 'commercial_website_url', 'CMS ID': 'cms_id',
    'AREA DISTRICT': 'area_district', 'ZONE-ROAD': 'zone_road',
}


def group_record(item, stamp):
    source = item['record']
    return {'project_group_id': source['ProjectGroupID'], 'project_name_th': source['ProjectName_TH'],
            'project_name_en': source['ProjectName_EN'], 'member_count': item['member_count'],
            'project_id_set': item['members'], 'source_snapshot_at': stamp,
            'business_sheet_record': source, 'source_system': 'business_sheet',
            'source_row_number': item['row'], 'findings': item['findings']}


def group_business_value(record):
    return {key: record.get(key) for key in ('project_group_id', 'project_name_th', 'project_name_en',
                                             'member_count', 'project_id_set', 'business_sheet_record')}


def project_business_value(record):
    return sorted([item['record'] for item in record['rows']], key=lambda value: encoded(value))


async def plan(db, package):
    """No guessed identity matches and no updates to an accepted mirror or draft."""
    digest = package['manifest_sha256']
    existing = await db.fetchrow('SELECT manifest,datasets FROM staging.intake_batches WHERE manifest_sha256=$1', digest)
    if existing:
        require(all(existing[key] == package[key] for key in ('manifest', 'datasets')), 'immutable_snapshot_mismatch')
        receipt = await db.fetchval('SELECT outcomes FROM staging.project_intake_receipts WHERE manifest_sha256=$1', digest)
        require(receipt is not None, 'snapshot_without_receipt')
        return {'status': 'already_staged', 'manifest_sha256': digest, 'replayed_receipt': receipt}, None
    latest = await db.fetchval("SELECT max(manifest->>'extracted_at') FROM staging.intake_batches WHERE manifest->>'source_system'='business_sheet'")
    if latest:
        require(datetime.fromisoformat(package['manifest']['extracted_at']) > datetime.fromisoformat(latest), 'out_of_order_business_snapshot')
    rem = {row['rem_project_id']: dict(row) for row in await db.fetch('SELECT rem_project_id,project_name_rem FROM staging.rem_projects')}
    gold = {row['rem_project_id']: row['record'] for row in await db.fetch('''SELECT rem_project_id,
        (SELECT coalesce(jsonb_object_agg(k,v),'{}') FROM jsonb_each(source_record) e(k,v) WHERE k=ANY($1::text[])) record
        FROM staging.dw_projects''', list(DW_FIELDS.values()))}
    humans = {row['rem_project_id']: row['public_name'] for row in await db.fetch('SELECT rem_project_id,public_name FROM hub.projects WHERE deleted_at IS NULL')}
    groups = {row['project_group_id']: row['source_record'] for row in await db.fetch('SELECT project_group_id,source_record FROM staging.dw_project_groups')}
    accepted_memberships = defaultdict(set)
    for group_id, record in groups.items():
        members = record.get('project_id_set') or []
        require(isinstance(members, list), 'accepted_group_contract_changed')
        for member in members:
            accepted_memberships[member].add(group_id)
    previous_projects = {row['rem_project_id']: row['record'] for row in await db.fetch('''SELECT DISTINCT ON(rem_project_id)
        rem_project_id,record FROM staging.project_intake_evidence WHERE kind='business_projects' ORDER BY rem_project_id,id DESC''')}
    previous_groups = {row['project_group_id']: row['record'] for row in await db.fetch('''SELECT DISTINCT ON(e.project_group_id)
        e.project_group_id,e.record FROM staging.project_group_evidence e JOIN staging.intake_batches b USING(manifest_sha256)
        WHERE b.manifest->>'source_system'='business_sheet' ORDER BY e.project_group_id,e.id DESC''')}
    incoming = defaultdict(list)
    for item in package['datasets']['business_projects']:
        incoming[item['record']['Project ID']].append(item)
    result = {'status': 'validated_dry_run', 'manifest_sha256': digest, 'source_system': 'business_sheet',
              'projects': [], 'groups': [], 'exceptions': package['datasets']['exceptions'],
              'human_edits_changed': 0, 'rem_identities_changed': 0, 'account_permissions_changed': 0}
    project_actions, group_actions = [], []
    stamp = package['manifest']['extracted_at']
    for identity, rows in sorted(incoming.items()):
        old = previous_projects.get(identity)
        record = {'source_system': 'business_sheet', 'source_snapshot_at': stamp, 'rows': rows}
        changes, conflicts = [], []
        if old:
            unchanged = project_business_value(old) == project_business_value(record)
            if not unchanged:
                changes.append({'field': 'source_rows', 'before': project_business_value(old), 'after': project_business_value(record)})
        else:
            accepted = gold.get(identity, {})
            for item in rows:
                for field, value in item['record'].items():
                    before = accepted.get(DW_FIELDS[field])
                    if field == 'Project ID':
                        before = identity if identity in rem else None
                    if field == 'REM Project Name' and before is None:
                        before = rem.get(identity, {}).get('project_name_rem')
                    if (before or '') != value:
                        changes.append({'row': item['row'], 'field': field, 'before': before, 'after': value})
            unchanged = not changes
        if identity not in rem:
            conflicts.append({'code': 'UNKNOWN_EXACT_PROJECT_ID'})
        for item in rows:
            fields = item['record']
            accepted = gold.get(identity, {})
            for field in ('Project', 'Project Name EN', 'Brand', 'Project Group ID'):
                before = accepted.get(DW_FIELDS[field])
                if before and fields[field] and before != fields[field]:
                    conflicts.append({'code': 'REFERENCE_VALUE_CONFLICT', 'row': item['row'], 'field': field, 'before': before, 'after': fields[field]})
            for locale, field in [('th', 'Project'), ('en', 'Project Name EN')]:
                human = (humans.get(identity) or {}).get(locale)
                if human and fields[field] and human != fields[field]:
                    conflicts.append({'code': 'HUMAN_NAME_PRESERVED', 'row': item['row'], 'field': field, 'before': human, 'after': fields[field]})
            gid = fields['Project Group ID']
            claimed = [g for g in package['datasets']['business_project_groups'] if g['record']['ProjectGroupID'] == gid]
            if gid and (len(claimed) != 1 or identity not in claimed[0]['members']):
                conflicts.append({'code': 'GROUP_MEMBERSHIP_CONFLICT', 'row': item['row'], 'group_id': gid})
        disposition = 'conflict' if conflicts else 'unchanged' if unchanged else 'new' if identity not in rem else 'changed'
        result['projects'].append({'project_id': identity, 'outcome': disposition, 'changes': changes, 'conflicts': conflicts,
                                   'source_rows': [item['row'] for item in rows]})
        if old is None or not unchanged:
            record['conflicts'] = conflicts
            project_actions.append((identity, 'new' if identity not in rem else 'baseline' if unchanged else 'changed', record, old))
    group_ids = Counter(item['record']['ProjectGroupID'] for item in package['datasets']['business_project_groups'])
    claimed_members = defaultdict(set)
    for item in package['datasets']['business_project_groups']:
        for member in item['members']:
            claimed_members[member].add(item['record']['ProjectGroupID'])
    for item in package['datasets']['business_project_groups']:
        record = group_record(item, stamp)
        identity = record['project_group_id']
        conflicts = list(item['findings'])
        if not identity.strip() or group_ids[identity] != 1:
            result['groups'].append({'group_id': identity, 'outcome': 'conflict', 'source_row': item['row'],
                                     'conflicts': conflicts + [{'code': 'GROUP_ID_MISSING_OR_DUPLICATED'}]})
            continue
        old = previous_groups.get(identity) or groups.get(identity)
        if old:
            for key in ('project_name_th', 'project_name_en', 'project_id_set'):
                before, after = old.get(key), record[key]
                same = set(before or []) == set(after) if key == 'project_id_set' else (before or '') == after
                if before and not same:
                    conflicts.append({'code': 'GROUP_REFERENCE_CONFLICT', 'field': key, 'before': before, 'after': after})
        for member in item['members']:
            if len(claimed_members[member]) > 1:
                conflicts.append({'code': 'MULTIPLE_GROUP_MEMBERSHIP', 'project_id': member})
            if member not in rem:
                conflicts.append({'code': 'GROUP_MEMBER_OUTSIDE_REM_SNAPSHOT', 'project_id': member})
            others = accepted_memberships[member] - {identity}
            if others:
                conflicts.append({'code': 'EXISTING_GROUP_MEMBERSHIP_CONFLICT', 'project_id': member,
                                  'existing_group_ids': sorted(others)})
        unchanged = old is not None and group_business_value(old) == group_business_value(record)
        disposition = 'conflict' if conflicts else 'unchanged' if unchanged else 'new' if old is None else 'changed'
        result['groups'].append({'group_id': identity, 'outcome': disposition, 'source_row': item['row'], 'conflicts': conflicts})
        if not unchanged:
            record['conflicts'] = conflicts
            # New invalid identities/members remain evidence; no competing accepted master.
            can_insert = identity not in groups and not conflicts
            group_actions.append((identity, 'new' if old is None else 'changed', record, old, can_insert))
    result['counts'] = {kind: dict(Counter(row['outcome'] for row in result[kind])) for kind in ('projects', 'groups')}
    result['appended_project_evidence'] = len(project_actions)
    result['appended_group_evidence'] = len(group_actions)
    result['new_group_references'] = sum(action[-1] for action in group_actions)
    return result, (project_actions, group_actions)


async def stage_package(db, package, *, apply=False):
    async with db.transaction(isolation='serializable', readonly=not apply):
        if apply:
            await db.execute("SELECT pg_advisory_xact_lock(hashtext('sena_hub_reviewed_pilot_intake'))")
            await db.execute('LOCK TABLE staging.rem_projects,staging.dw_projects,staging.dw_project_groups IN SHARE ROW EXCLUSIVE MODE')
        result, actions = await plan(db, package)
        if not apply or actions is None:
            return result
        digest = package['manifest_sha256']
        projects, groups = actions
        await db.execute('INSERT INTO staging.intake_batches(manifest_sha256,manifest,datasets) VALUES($1,$2,$3)', digest, package['manifest'], package['datasets'])
        await db.executemany('''INSERT INTO staging.project_intake_evidence
            (manifest_sha256,kind,rem_project_id,source_id,outcome,record,previous_record) VALUES($1,'business_projects',$2,'',$3,$4,$5)''',
            [(digest, *row) for row in projects])
        await db.executemany('''INSERT INTO staging.project_group_evidence
            (manifest_sha256,project_group_id,outcome,record,previous_record) VALUES($1,$2,$3,$4,$5)''',
            [(digest, *row[:4]) for row in groups])
        await db.executemany('INSERT INTO staging.dw_project_groups(project_group_id,source_record,manifest_sha256) VALUES($1,$2,$3)',
            [(identity, record, digest) for identity, _, record, _, can_insert in groups if can_insert])
        result['status'] = 'staged'
        result['review_basis'] = 'owner_H2_2026-10-27_source_snapshot_only'
        await db.execute('INSERT INTO staging.project_intake_receipts(manifest_sha256,outcomes) VALUES($1,$2)', digest, result)
        return result


def crawl_input(package):
    urls, gaps = defaultdict(set), []
    for item in package['datasets']['business_projects']:
        record = item['record']
        value, identity = record['Website URL'], record['Project ID']
        if not value or value == 'N/A':
            gaps.append({'row': item['row'], 'project_id': identity, 'source_url': value, 'code': 'WEBSITE_URL_MISSING'})
            continue
        try:
            url = urlsplit(value)
            host = url.hostname or ''
            valid = (value == value.strip() and url.scheme == 'https' and not url.username and not url.password
                     and url.port in (None, 443) and (host == 'sena.co.th' or host.endswith('.sena.co.th')))
        except ValueError:
            valid = False
        if not valid:
            gaps.append({'row': item['row'], 'project_id': identity, 'source_url': value, 'code': 'WEBSITE_URL_NOT_ALLOWED'})
            continue
        urls[value].add(identity)
    return {'schema_version': 1, 'max_pages': 500,
            'source_evidence': {'source_system': 'business_sheet', 'manifest_sha256': package['manifest_sha256'],
                                'snapshot_at': package['manifest']['extracted_at']},
            'pages': [{'url': url, 'project_ids': sorted(ids), 'programme_ids': [], 'extractor': 'sena_project_v1'}
                      for url, ids in sorted(urls.items())], 'file_refs': []}, gaps


def local_package_path(value):
    path = Path(value).resolve()
    require(path.is_relative_to((ROOT / '.local').resolve()), 'package_must_be_under_ignored_local')
    return path


async def run_local(package, apply=False):
    """CLI is confined to the existing working cluster; hosted uses the same stage_package."""
    import asyncpg
    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
    db = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local',
                               user='postgres', password=config['adminPassword'], timeout=15)
    try:
        require(Path(await db.fetchval('SHOW data_directory')).resolve() == (ROOT / '.local/postgres').resolve(), 'wrong_local_cluster')
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        return await stage_package(db, package, apply=apply)
    finally:
        await db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['fetch', 'verify', 'plan', 'apply', 'crawl-input'])
    parser.add_argument('--package', type=Path)
    parser.add_argument('--manifest-sha256')
    args = parser.parse_args()
    if args.operation == 'fetch':
        require(args.package is None and args.manifest_sha256 is None, 'fetch_has_fixed_destination')
        parent = local_package_path(ROOT / '.local/business-sheet-intake')
        folder, digest, manifest = write_package(parent, fetch_csv('Project'), fetch_csv('ProjectGroupMaster'))
        verify_package(folder, digest)
        print(json.dumps({'status': 'verified_snapshot', 'package': str(folder.relative_to(ROOT)),
                          'manifest_sha256': digest, 'counts': manifest['counts']}))
        return
    require(args.package is not None and args.manifest_sha256 is not None, 'package_and_checksum_required')
    package = verify_package(local_package_path(args.package), args.manifest_sha256)
    if args.operation == 'verify':
        print(json.dumps({'status': 'verified_snapshot', 'manifest_sha256': package['manifest_sha256'],
                          'counts': package['manifest']['counts']}))
        return
    receipts = ROOT / '.local/business-sheet-receipts' / package['manifest_sha256']
    receipts.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    if args.operation == 'crawl-input':
        value, gaps = crawl_input(package)
        payload = encoded(value)
        output = receipts / f'crawl-input-{stamp}.json'
        with output.open('xb') as stream:
            stream.write(payload)
        with (receipts / f'url-gaps-{stamp}.json').open('xb') as stream:
            stream.write(encoded(gaps))
        print(json.dumps({'input': str(output.relative_to(ROOT)), 'input_sha256': sha(payload),
                          'distinct_urls': len(value['pages']), 'url_gaps': len(gaps)}))
        return
    result = asyncio.run(run_local(package, apply=args.operation == 'apply'))
    receipt = receipts / f'{args.operation}-{stamp}.json'
    with receipt.open('xb') as stream:
        stream.write(encoded(result))
    print(json.dumps({'status': result['status'], 'counts': result.get('counts'),
                      'receipt': str(receipt.relative_to(ROOT)), 'manifest_sha256': package['manifest_sha256']}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not leak database connection strings, provider responses or source rows.
        print(json.dumps({'status': 'STOP', 'error_class': type(error).__name__, 'details_withheld': True}))
        raise SystemExit(1) from None
