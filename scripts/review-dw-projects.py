"""Read-only gate for a reviewed DW project/model package. Never applies data."""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
FILES = {'projects.json', 'models.json', 'gold_projects.json', 'gold_models.json', 'exceptions.json', 'review.json'}
PROJECT_COLUMNS = 'ProjectID ProjectName ProjectNameEng ProjectType BrandID CompanyID ProjectGroupID ProjectStatus isDeleteRaw CreateDate ModifyDate isDeleted'.split()
MODEL_COLUMNS = 'ProjectID ModelID ModelName ModelNameEng ModelTypeID ModelArea isDeleteRaw CreateDate ModifyDate isDeleted ModelTypeName ModelTypeNameEng'.split()
GROUP_COLUMNS = 'project_group_id project_name_th project_name_en member_count project_id_set source_snapshot_at'.split()
STATUS = {'0': 'พรีเซล', '1': 'กำลังก่อสร้าง', '2': 'พร้อมอยู่', '3': 'ปิดโครงการ'}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON object key')
        result[key] = value
    return result


def decode(raw):
    return json.loads(raw, object_pairs_hook=unique_object)


def utc(value):
    stamp = datetime.fromisoformat(value)
    require(stamp.tzinfo is not None and stamp.utcoffset() == timezone.utc.utcoffset(stamp), 'Metadata timestamp must be UTC')
    return stamp


def identity_conflicts(data):
    raw = {r['ProjectID']: r for r in data['projects']}
    findings = defaultdict(set)
    for item in data['exceptions']:
        findings[item['keys'].get('ProjectID', item['keys'].get('project_id'))].add(item['issue_code'])
    conflicts = []
    for wrapper in data['gold_projects']:
        project = wrapper['project_id']; gold = wrapper['gold']
        if gold is None:
            continue
        if project not in raw:
            conflicts.append(project); continue
        allowed = 'GOLD_PROJECT_IDENTITY_OR_GROUP_CONFLICT' in findings[project]
        if (gold.get('project_identity_conflict') or gold.get('project_group_conflict')) and not allowed:
            conflicts.append(project)
        for field, source in [('rem_brand_id', 'BrandID'), ('company_id', 'CompanyID'), ('rem_project_group_id', 'ProjectGroupID')]:
            if gold.get(field) != raw[project][source] and not allowed:
                if field == 'rem_brand_id' and 'PROJECT_BRAND_MISSING' in findings[project]:
                    continue
                conflicts.append(project)
    return sorted(set(conflicts))


def identity_conflicts(data):
    raw = {r['ProjectID']: r for r in data['projects']}
    findings = defaultdict(set)
    for item in data['exceptions']:
        findings[item['keys'].get('ProjectID', item['keys'].get('project_id'))].add(item['issue_code'])
    conflicts = []
    for wrapper in data['gold_projects']:
        project = wrapper['project_id']; gold = wrapper['gold']
        if gold is None:
            continue
        if project not in raw:
            conflicts.append(project); continue
        allowed = 'GOLD_PROJECT_IDENTITY_OR_GROUP_CONFLICT' in findings[project]
        if (gold.get('project_identity_conflict') or gold.get('project_group_conflict')) and not allowed:
            conflicts.append(project)
        for field, source in [('rem_brand_id', 'BrandID'), ('company_id', 'CompanyID'), ('rem_project_group_id', 'ProjectGroupID')]:
            if gold.get(field) != raw[project][source] and not allowed:
                if field == 'rem_brand_id' and 'PROJECT_BRAND_MISSING' in findings[project]:
                    continue
                conflicts.append(project)
    return sorted(set(conflicts))


def load_package(folder: Path, reviewed_hash: str):
    require(bool(re.fullmatch('[0-9a-f]{64}', reviewed_hash)), 'An explicit reviewed manifest SHA-256 is required')
    raw = {'manifest.json': (folder / 'manifest.json').read_bytes()}
    require(digest(raw['manifest.json']) == reviewed_hash, 'Reviewed manifest hash mismatch')
    manifest = decode(raw['manifest.json'])
    require(manifest['contract_version'] == 'rem-project-model-review-v1', 'Unsupported project/model contract')
    require(manifest['environment'] == 'local_review' and type(manifest['synthetic']) is bool, 'Unexpected package environment')
    files = FILES | ({'project_groups.json'} if 'project_groups' in manifest['counts'] else set())
    require(set(manifest['files']) == files, 'Unexpected payload file set')
    require({p.name for p in folder.iterdir()} == files | {'manifest.json', 'manifest.sha256'}, 'Incomplete or extra package files')
    raw['manifest.sha256'] = (folder / 'manifest.sha256').read_bytes()
    require(raw['manifest.sha256'].decode('ascii').split() == [reviewed_hash, 'manifest.json'], 'Manifest sidecar mismatch')
    datasets = {}
    for filename, metadata in manifest['files'].items():
        content = (folder / filename).read_bytes()
        require(len(content) == metadata['bytes'] and digest(content) == metadata['sha256'], 'Payload hash or size mismatch: ' + filename)
        value = decode(content)
        rows = [value] if filename == 'review.json' else value
        require(isinstance(rows, list) and len(rows) == metadata['row_count'], 'Payload count mismatch: ' + filename)
        require(all(isinstance(row, dict) and set(row) == set(metadata['columns']) for row in rows), 'Payload columns mismatch: ' + filename)
        datasets[filename[:-5]] = value
        raw[filename] = content
    for name, columns, identity in [('projects', PROJECT_COLUMNS, ('ProjectID',)), ('models', MODEL_COLUMNS, ('ProjectID', 'ModelID'))]:
        require(manifest['files'][name + '.json']['columns'] == columns, 'Unexpected raw column contract')
        rows = datasets[name]
        keys = [tuple(row[k] for k in identity) for row in rows]
        require(all(all(isinstance(k, str) and k.strip() for k in key) for key in keys) and len(keys) == len(set(keys)), 'Blank or duplicate raw identity')
        for row in rows:
            require(all(value is None or isinstance(value, str) for key, value in row.items() if key != 'isDeleted'), 'Raw source fields must remain text/null')
            expected = {'0': False, '1': True}.get(row['isDeleteRaw'], 'unknown')
            require(type(row['isDeleted']) is type(expected) and row['isDeleted'] == expected, 'Deletion evidence mismatch')
            for field in ('CreateDate', 'ModifyDate'):
                if row[field] is not None:
                    require(datetime.fromisoformat(row[field]).tzinfo is None, 'REM source timezone was invented')
    require(datasets['projects'], 'Empty project package')
    project_ids = {r['ProjectID'] for r in datasets['projects']}
    require(all(r['ProjectType'] in ('C', 'H') and r['ProjectID'] not in ('B2B', 'B2C', 'B2G') for r in datasets['projects']), 'Out-of-scope project')
    require(all(r['ProjectID'] in project_ids for r in datasets['models']), 'Raw model without exact project')
    require(len(manifest['gold_project_columns']) == manifest['gold_project_nested_column_count'] == 105, 'Unexpected Gold project column contract')
    require(all(r['gold'] is None or set(r['gold']) == set(manifest['gold_project_columns']) for r in datasets['gold_projects']), 'Nested Gold columns mismatch')
    require(all(r['gold'] is None or r['gold']['project_id'] == r['project_id'] for r in datasets['gold_projects']), 'Gold wrapper identity conflict')
    for name, key in [('gold_projects', 'project_id'), ('gold_models', 'project_model_key'), ('exceptions', 'exception_key')]:
        values = [r[key] for r in datasets[name]]
        require(all(isinstance(v, str) and v.strip() for v in values) and len(values) == len(set(values)), 'Invalid or duplicate ' + name + ' key')
    for row in datasets['gold_models']:
        require(isinstance(row['project_id'], str), 'Gold project identity must be text')
        for field in ('model_ids', 'model_type_ids', 'model_names_eng'):
            require(isinstance(row[field], list) and all(isinstance(v, str) for v in row[field]), 'Gold identifier/name arrays must contain text')
        require(row['technical_model_count'] == len(row['model_ids']) and len(set(row['model_ids'])) == len(row['model_ids']), 'Gold technical-model count mismatch')
    counts = manifest['counts']
    if 'project_groups' in datasets:
        groups = datasets['project_groups']
        columns = manifest['files']['project_groups.json']['columns']
        require(len(columns) == len(GROUP_COLUMNS) and set(columns) == set(GROUP_COLUMNS), 'Unexpected group column contract')
        require(type(counts['project_groups']) is int and counts['project_groups'] == len(groups), 'Manifest count mismatch: project_groups')
        ids = [r['project_group_id'] for r in groups]
        require(all(isinstance(v, str) and v.strip() for v in ids) and len(ids) == len(set(ids)), 'Blank or duplicate group identity')
        for group in groups:
            require(all(group[k] is None or isinstance(group[k], str) for k in ('project_name_th', 'project_name_en')), 'Group names must be text/null')
            require(group['member_count'] is None or type(group['member_count']) is int and group['member_count'] >= 0, 'Invalid group member count')
            members = group['project_id_set']
            require(members is None or isinstance(members, list) and all(isinstance(v, str) and v.strip() for v in members)
                    and len(members) == len(set(members)), 'Invalid group member identities')
            require(datetime.fromisoformat(group['source_snapshot_at']).tzinfo is not None, 'Group snapshot needs an explicit timezone')
    for name in ('projects', 'models', 'gold_projects', 'gold_models', 'exceptions'):
        require(counts[name] == len(datasets[name]), 'Manifest count mismatch: ' + name)
    require(counts['gold_project_rows'] == sum(r['gold'] is not None for r in datasets['gold_projects']), 'Gold row count mismatch')
    require(counts['missing_gold_project_rows'] == sum(r['gold'] is None for r in datasets['gold_projects']), 'Missing Gold count mismatch')
    require(counts['exceptions_by_type'] == dict(Counter(r['issue_code'] for r in datasets['exceptions'])), 'Exception counts disagree')
    require(all(r['disposition'] == 'REVIEW_REQUIRED' for r in datasets['exceptions']), 'Unexpected exception disposition')
    require(datasets['review']['counts'] == counts, 'Review counts disagree')
    require(not identity_conflicts(datasets), 'Unreviewed Gold identity/group conflict')
    require(not identity_conflicts(datasets), 'Unreviewed Gold identity/group conflict')
    require(manifest['consistency']['cross_database_consistent_snapshot'] is False, 'A shared REM/DW snapshot must not be claimed')
    utc(manifest['extracted_at'])
    for system in ('rem', 'dw'):
        window = manifest['sources'][system]
        if system == 'rem' and manifest['consistency'].get('rem_isolation') == 'NOT READ':
            require(window['read_started_at'] is None and window['read_finished_at'] is None
                    and all(value is None for value in window['identity'].values()), 'Unread REM must have no invented read evidence')
            require(manifest['consistency']['dw_isolation'] == 'REPEATABLE READ READ ONLY', 'DW-only export requires one read-only repeatable-read snapshot')
            continue
        require(utc(window['read_started_at']) <= utc(window['read_finished_at']), 'Invalid source read window')
    return {'manifest_sha256': reviewed_hash, 'manifest': manifest, 'datasets': datasets, 'raw_files': raw}


def group_findings(data):
    """Dictionary membership is evidence, never authority to create or rebind projects."""
    if 'project_groups' not in data:
        return []
    projects = {r['ProjectID'] for r in data['projects']}
    groups = {r['project_group_id']: r for r in data['project_groups']}
    findings = [{'code': 'GROUP_MEMBER_OUTSIDE_PACKAGE', 'group_id': gid, 'project_id': pid}
                for gid, row in groups.items() for pid in row['project_id_set'] or [] if pid not in projects]
    for wrapper in data['gold_projects']:
        gid = (wrapper['gold'] or {}).get('marketing_project_group_id')
        if gid and gid not in groups:
            findings.append({'code': 'MARKETING_GROUP_MISSING', 'group_id': gid, 'project_id': wrapper['project_id']})
        elif gid and groups[gid]['project_id_set'] is not None and wrapper['project_id'] not in groups[gid]['project_id_set']:
            findings.append({'code': 'GROUP_MEMBERSHIP_MISMATCH', 'group_id': gid, 'project_id': wrapper['project_id']})
    return findings


def reconcile(raw, gold):
    groups = defaultdict(list)
    for row in gold:
        for model_id in row['model_ids']:
            groups[(row['project_id'], model_id)].append(row['project_model_key'])
    keys = {(r['ProjectID'], r['ModelID']) for r in raw}
    absent = [{'ProjectID': r['ProjectID'], 'ModelID': r['ModelID'], 'isDeleted': r['isDeleted'], 'ModelID_length': len(r['ModelID'])}
              for r in raw if (r['ProjectID'], r['ModelID']) not in groups]
    multiple = [{'ProjectID': key[0], 'ModelID': key[1], 'groups': values} for key, values in groups.items() if key in keys and len(values) > 1]
    orphan = [{'project_id': key[0], 'model_id': key[1], 'groups': values} for key, values in groups.items() if key not in keys]
    return {'raw_count': len(raw), 'gold_group_count': len(gold), 'raw_in_exactly_one_group': sum(len(groups.get(key, [])) == 1 for key in keys),
            'raw_without_group': absent, 'raw_in_multiple_groups': multiple, 'gold_ids_without_raw': orphan,
            'ungrouped_deleted_count': sum(r['isDeleted'] is True for r in absent),
            'exact_coverage_passes': not (absent or multiple or orphan)}


def coverage_conflicts(package, discard_deleted=False):
    """Only the owner's deleted-model policy and explicit whitespace findings waive coverage."""
    data = package['datasets']; check = reconcile(data['models'], data['gold_models'])
    allowed = {(e['keys'].get('ProjectID', e['keys'].get('project_id')), e['keys'].get('ModelID'))
               for e in data['exceptions'] if e['issue_code'] == 'GOLD_MODEL_ID_MISSING_REM'}
    raw_keys = {(r['ProjectID'], r['ModelID']) for r in data['models']}
    orphan_keys = {(r['project_id'], r['model_id']) for r in check['gold_ids_without_raw']}
    # Whitespace is compared only to explain an explicit finding, never to create a join.
    accepted_spaces = {key for key in allowed & orphan_keys
                       if sum(p == key[0] and m != key[1] and m.rstrip() == key[1] for p, m in raw_keys) == 1}
    unexplained = [r for r in check['raw_without_group'] if not (discard_deleted and r['isDeleted'] is True)
                   and (r['ProjectID'], r['ModelID'].rstrip()) not in accepted_spaces]
    return unexplained or check['raw_in_multiple_groups'] or [r for r in check['gold_ids_without_raw']
                                                            if (r['project_id'], r['model_id']) not in accepted_spaces]


def compare_packages(before, after):
    """Compare evidence only; these counts are not database apply receipts."""
    result = {'previous_manifest_sha256': before['manifest_sha256'], 'database_applied': False, 'datasets': {}}
    for name, keys in [('projects', ('ProjectID',)), ('models', ('ProjectID', 'ModelID')),
                       ('gold_projects', ('project_id',)), ('gold_models', ('project_model_key',))]:
        old = {tuple(row[k] for k in keys): row.get('gold', row) for row in before['datasets'][name]}
        new = {tuple(row[k] for k in keys): row.get('gold', row) for row in after['datasets'][name]}
        common = old.keys() & new.keys()
        financial_changes = []
        for key in sorted(common):
            if name.startswith('gold_') and old[key] is not None and new[key] is not None:
                fields = set(old[key]) | set(new[key])
                fields = [f for f in fields if ('price' in f or f.endswith('_unit_count'))
                          and f not in ('price_as_of_date', 'price_source', 'average_price_source')]
                if any(old[key].get(f) != new[key].get(f) for f in fields):
                    financial_changes.append(dict(zip(keys, key)))
        result['datasets'][name] = {'file_bytes_identical': before['raw_files'][name + '.json'] == after['raw_files'][name + '.json'],
                                   'identical_rows': sum(old[k] == new[k] for k in common), 'changed_rows': sum(old[k] != new[k] for k in common),
                                   'new_rows': len(new.keys() - old.keys()), 'missing_rows': len(old.keys() - new.keys()),
                                   'price_or_unit_count_changed_rows': len(financial_changes), 'private_changed_keys': financial_changes}
    return result


def equivalent(field, before, after):
    if before == after:
        return True
    if before is None or after is None:
        return False
    if field in ('CreateDate', 'ModifyDate'):
        return datetime.fromisoformat(before) == datetime.fromisoformat(after)
    # Compare decimal representations only for measures, never for identifiers.
    if any(part in field for part in ('area', 'price', 'latitude', 'longitude')) or field == 'ModelArea':
        try:
            return Decimal(str(before)) == Decimal(str(after))
        except InvalidOperation:
            pass
    return False


def changes(before, after, mapping=None):
    mapping = mapping or {key: key for key in sorted(before.keys() & after.keys())}
    return [{'field': new, 'before': before.get(old), 'after': after.get(new)} for old, new in mapping.items()
            if not equivalent(new, before.get(old), after.get(new))]


def compare_hyabc(package, tables):
    data = package['datasets']
    incoming = next(r for r in data['projects'] if r['ProjectID'] == 'HYABC')
    mirror = next(r for r in tables['staging.rem_projects'] if r['rem_project_id'] == 'HYABC')
    batch = next(r for r in tables['staging.intake_batches'] if r['manifest_sha256'] == mirror['intake_manifest_sha256'])
    pilot = next(r['record'] for r in batch['datasets']['projects']['rows'] if r['record']['project_id'] == 'HYABC')
    require(mirror['source_record'] == pilot, 'HYABC mirror differs from immutable pilot evidence')
    raw_before = [r['record'] for r in batch['datasets']['models']['rows'] if r['record']['project_id'] == 'HYABC']
    mirrors = {r['rem_model_id']: r for r in tables['staging.rem_models'] if r['rem_project_id'] == 'HYABC'}
    require(all(mirrors.get(r['model_id'], {}).get('source_record') == r for r in raw_before), 'HYABC model mirror differs from immutable pilot evidence')
    raw_after = [r for r in data['models'] if r['ProjectID'] == 'HYABC']
    gold_before = next(r for r in tables['staging.dw_projects'] if r['rem_project_id'] == 'HYABC')
    gold_after = next(r['gold'] for r in data['gold_projects'] if r['project_id'] == 'HYABC')
    groups_after = [r for r in data['gold_models'] if r['project_id'] == 'HYABC']
    project_map = {'project_id': 'ProjectID', 'project_name_th': 'ProjectName', 'project_name_en': 'ProjectNameEng', 'project_type': 'ProjectType',
                   'brand_id': 'BrandID', 'company_id': 'CompanyID', 'project_status': 'ProjectStatus', 'is_deleted': 'isDeleted',
                   'source_created_at': 'CreateDate', 'source_modified_at': 'ModifyDate'}
    model_map = {'project_id': 'ProjectID', 'model_id': 'ModelID', 'model_name_th': 'ModelName', 'model_name_en': 'ModelNameEng',
                 'model_type_id': 'ModelTypeID', 'model_area': 'ModelArea', 'is_deleted': 'isDeleted', 'source_created_at': 'CreateDate', 'source_modified_at': 'ModifyDate'}
    before_ids = {r['model_id'] for r in raw_before}
    after_by_id = {r['ModelID']: r for r in raw_after}
    model_changes = [{'ModelID': r['model_id'], 'changes': changes(r, after_by_id[r['model_id']], model_map)} for r in raw_before if r['model_id'] in after_by_id]
    groups_by_key = {r['project_model_key']: r for r in groups_after}
    identity_fields = ['project_id', 'rem_brand_id', 'company_id', 'rem_project_group_id', 'marketing_project_group_id', 'commercial_brand']
    gold_identity = changes(gold_before['source_record'], gold_after, {key: key for key in identity_fields})
    rem_group_matches = incoming['ProjectGroupID'] == gold_before['source_record']['rem_project_group_id']
    group_conflicts = [{'project_model_key': r['project_model_key'], 'before_model_ids': r['model_ids'], 'after_model_ids': groups_by_key.get(r['project_model_key'], {}).get('model_ids')}
                       for r in gold_before['model_groups'] if r['model_ids'] != groups_by_key.get(r['project_model_key'], {}).get('model_ids')]
    project_changes = changes(pilot, incoming, project_map)
    identity_changes = [c for c in project_changes if c['field'] in ('ProjectID', 'BrandID', 'CompanyID', 'ProjectType')]
    return {'pilot_manifest_sha256': batch['manifest_sha256'], 'status_raw': incoming['ProjectStatus'], 'status_label': STATUS.get(incoming['ProjectStatus'], 'ไม่ทราบสถานะ'),
            'status_is_expected_2': incoming['ProjectStatus'] == '2', 'pilot_raw_count': len(raw_before), 'package_raw_count': len(raw_after),
            'old_gold_group_count': len(gold_before['model_groups']), 'package_gold_group_count': len(groups_after),
            'raw_model_ids_match': before_ids == set(after_by_id), 'model_ids': sorted(after_by_id),
            'pilot_raw_project_changes': project_changes, 'pilot_raw_model_changes': [r for r in model_changes if r['changes']],
            'gold_identity_changes': gold_identity, 'gold_group_identity_conflicts': group_conflicts,
            'rem_group_matches_reviewed': rem_group_matches,
            'gold_project_value_changes': changes(gold_before['source_record'], gold_after),
            'gold_model_value_changes': [{'project_model_key': r['project_model_key'], 'changes': changes(r, groups_by_key[r['project_model_key']])} for r in gold_before['model_groups'] if r['project_model_key'] in groups_by_key],
            'local_synthetic_models_preserved': [r['rem_model_id'] for r in tables['staging.rem_models'] if r['rem_project_id'] == 'HYABC' and r['source_record'].get('synthetic_only') is True],
            'identity_matches': not(identity_changes or gold_identity or group_conflicts) and rem_group_matches and before_ids == set(after_by_id) and len(raw_after) == len(groups_after) == 13}


async def local_evidence():
    import asyncpg
    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf8'))
    db = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local', user='postgres', password=config['adminPassword'])
    try:
        require(Path(await db.fetchval('SHOW data_directory')).resolve() == (ROOT / '.local/postgres').resolve(), 'Refusing a database other than the local working cluster')
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        async with db.transaction(isolation='repeatable_read', readonly=True):
            return {table: [r['record'] for r in await db.fetch(f'SELECT to_jsonb(t) record FROM {table} t')] for table in
                    ('staging.rem_projects', 'staging.rem_models', 'staging.dw_projects', 'staging.intake_batches')}
    finally:
        await db.close()


def report(package, tables=None, discard_deleted=False):
    data = package['datasets']; projects = data['projects']
    reconciliation = reconcile(data['models'], data['gold_models'])
    hyabc = compare_hyabc(package, tables) if tables else None
    blockers = []
    if coverage_conflicts(package, discard_deleted):
        blockers.append('EXACT_RAW_TO_GOLD_COVERAGE_FAILED')
    if hyabc is None:
        blockers.append('LOCAL_HYABC_COMPARISON_NOT_RUN')
    elif not hyabc['identity_matches'] or not hyabc['status_is_expected_2']:
        blockers.append('HYABC_IDENTITY_OR_STATUS_CONFLICT')
    status_counts = [{'raw': raw, 'label': STATUS.get(raw, 'ไม่ทราบสถานะ'), 'count': count,
                      'non_deleted_count': sum(r['ProjectStatus'] == raw and r['isDeleted'] is False for r in projects)}
                     for raw, count in sorted(Counter(r['ProjectStatus'] for r in projects).items(), key=lambda item: str(item[0]))]
    return {'mode': 'DRY_RUN_ONLY', 'manifest_sha256': package['manifest_sha256'], 'synthetic': package['manifest']['synthetic'], 'counts': package['manifest']['counts'],
            'consistency': package['manifest']['consistency'],
            'bronze_load_watermarks': package['manifest']['sources']['dw'].get('identity', {}).get('bronze_load_watermarks'),
            'gold_source_watermarks': package['manifest'].get('gold_source_watermarks'),
            'source_read_windows': {key: {field: value for field, value in item.items() if field.startswith('read_')} for key, item in package['manifest']['sources'].items()},
            'counts_by_status': status_counts, 'default_scope_count': sum(r['isDeleted'] is False and r['ProjectStatus'] in ('0', '1', '2') for r in projects),
            'deleted_project_count': sum(r['isDeleted'] is True for r in projects),
            'unknown_status_projects': [{'ProjectID': r['ProjectID'], 'ProjectStatus': r['ProjectStatus']} for r in projects if r['ProjectStatus'] not in STATUS], 'exceptions': data['exceptions'],
            'reconciliation': reconciliation, 'hyabc': hyabc, 'apply_gate_passes': not blockers, 'blockers': blockers,
            'database_writes': 0, 'drafts_created': 0, 'publications_created': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--compare-local', action='store_true', help='Read the guarded local working DB after package integrity passes')
    parser.add_argument('--previous-package', type=Path, help='Optional earlier package for an offline evidence comparison')
    parser.add_argument('--previous-manifest-sha256')
    parser.add_argument('--discard-deleted-ungrouped-models', action='store_true')
    args = parser.parse_args()
    package = load_package(args.package, args.manifest_sha256)  # Always before connecting.
    require(bool(args.previous_package) == bool(args.previous_manifest_sha256), 'Previous package and reviewed hash must be supplied together')
    previous = load_package(args.previous_package, args.previous_manifest_sha256) if args.previous_package else None
    destination = ROOT / '.local/dw-project-intake' / package['manifest_sha256']
    original = destination / 'original'; original.mkdir(parents=True, exist_ok=True)
    for name, content in package['raw_files'].items():
        target = original / name
        if target.exists():
            require(target.read_bytes() == content, 'Immutable original bytes changed')
        else:
            with target.open('xb') as stream:
                stream.write(content)
    result = report(package, asyncio.run(local_evidence()) if args.compare_local else None, args.discard_deleted_ungrouped_models)
    if previous:
        result['previous_package_comparison'] = compare_packages(previous, package)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output = destination / ('dry-run-' + stamp + '.json')
    with output.open('x', encoding='utf8') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2); stream.write('\n')
    summary = {key: result[key] for key in ('mode', 'manifest_sha256', 'counts_by_status', 'default_scope_count', 'apply_gate_passes', 'blockers')}
    summary.update(report=str(output), raw_without_group=len(result['reconciliation']['raw_without_group']),
                   raw_in_multiple_groups=len(result['reconciliation']['raw_in_multiple_groups']), gold_ids_without_raw=len(result['reconciliation']['gold_ids_without_raw']))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if result['apply_gate_passes'] else 2


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, TypeError, OSError):
        raise SystemExit('Project/model review stopped: invalid package, incomplete evidence or unsafe local target. No database writes occurred.') from None
