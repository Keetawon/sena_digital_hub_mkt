"""Verified local DW project/model intake. Dry-run by default; no Hub content writes."""
from __future__ import annotations
import argparse
import asyncio
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('project_review', ROOT / 'scripts/review-dw-projects.py')
review = importlib.util.module_from_spec(spec); spec.loader.exec_module(review)
require = review.require


def canonical(record):
    return json.dumps(record, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def fingerprint(record):
    return hashlib.sha256(canonical(record).encode()).hexdigest()


def records(package, discard_deleted, discard_keys=None):
    data = package['datasets']
    omitted = {(r['ProjectID'], r['ModelID']) for r in review.reconcile(data['models'], data['gold_models'])['raw_without_group']
               if discard_deleted and r['isDeleted'] is True and (discard_keys is None or (r['ProjectID'], r['ModelID']) in discard_keys)}
    rows = {}
    for kind in ('projects', 'models', 'gold_projects', 'gold_models'):
        for row in data[kind]:
            project = row.get('ProjectID', row.get('project_id'))
            identity = row.get('ModelID', row.get('project_model_key', ''))
            if kind == 'models' and (project, identity) in omitted:
                continue
            rows[(kind, project, identity)] = row.get('gold', row)
    return rows, omitted


PROJECT_MAP = {'project_id': 'ProjectID', 'project_name_th': 'ProjectName', 'project_name_en': 'ProjectNameEng',
               'project_type': 'ProjectType', 'brand_id': 'BrandID', 'company_id': 'CompanyID', 'project_status': 'ProjectStatus',
               'is_deleted': 'isDeleted', 'source_created_at': 'CreateDate', 'source_modified_at': 'ModifyDate'}
MODEL_MAP = {'project_id': 'ProjectID', 'model_id': 'ModelID', 'model_name_th': 'ModelName', 'model_name_en': 'ModelNameEng',
             'model_type_id': 'ModelTypeID', 'model_area': 'ModelArea', 'is_deleted': 'isDeleted',
             'source_created_at': 'CreateDate', 'source_modified_at': 'ModifyDate'}


def legacy_changes(kind, old, new):
    if kind in ('projects', 'models') and 'ProjectID' not in old:
        mapping = PROJECT_MAP if kind == 'projects' else MODEL_MAP
        return review.changes(old, new, {k: v for k, v in mapping.items() if k in old})
    return [] if old == new else [{'field': k} for k in sorted(set(old) | set(new)) if old.get(k) != new.get(k)]


async def plan(connection, package, discard_deleted):
    require(not review.identity_conflicts(package['datasets']), 'Unreviewed Gold identity/group conflict')
    require(not review.identity_conflicts(package['datasets']), 'Unreviewed Gold identity/group conflict')
    tables = {table: [dict(r) for r in await connection.fetch('SELECT * FROM ' + table)] for table in
              ('staging.rem_projects', 'staging.rem_models', 'staging.dw_projects', 'staging.intake_batches')}
    batch = next((b for b in tables['staging.intake_batches'] if b['manifest_sha256'] == package['manifest_sha256']), None)
    if batch:
        require(all(batch[k] == package[k] for k in ('manifest', 'datasets')), 'Immutable batch mismatch')
        receipt = await connection.fetchval('SELECT outcomes FROM staging.project_intake_receipts WHERE manifest_sha256=$1', package['manifest_sha256'])
        require(receipt is not None, 'Batch exists without a project intake receipt')
        return {'status': 'already_staged', 'new_evidence': 0, 'mirror_inserts': 0, 'mirror_deletes': 0, 'replayed_receipt': receipt}, None
    latest_batch = await connection.fetchval('''SELECT b.manifest FROM staging.project_intake_receipts r
        JOIN staging.intake_batches b USING(manifest_sha256) ORDER BY r.imported_at DESC LIMIT 1''')
    first_receipt = await connection.fetchval('SELECT outcomes FROM staging.project_intake_receipts ORDER BY imported_at,manifest_sha256 LIMIT 1')
    # Only identities explicitly discarded at the first intake retain that policy.
    # A later newly deleted model stays as flagged evidence, never auto-deleted.
    discard_keys = {tuple(key) for key in first_receipt['discarded_model_keys']} if first_receipt else None
    require(not review.coverage_conflicts(package, discard_deleted or bool(first_receipt)), 'Unreviewed model reconciliation conflict')
    rows, omitted = records(package, discard_deleted or bool(first_receipt), discard_keys)
    if latest_batch:
        require(review.utc(package['manifest']['extracted_at']) > review.utc(latest_batch['extracted_at']), 'Out-of-order package')
    if not package['manifest']['synthetic']:
        hyabc = review.compare_hyabc(package, tables)
        require(hyabc['identity_matches'] and hyabc['status_is_expected_2'], 'HYABC evidence conflict')
    projects = {r['rem_project_id']: r for r in tables['staging.rem_projects']}
    models = {(r['rem_project_id'], r['rem_model_id']): r for r in tables['staging.rem_models']}
    gold = {r['rem_project_id']: r for r in tables['staging.dw_projects']}
    prior = {(r['kind'], r['rem_project_id'], r['source_id']): dict(r) for r in await connection.fetch('''
        SELECT DISTINCT ON(kind,rem_project_id,source_id) * FROM staging.project_intake_evidence
        ORDER BY kind,rem_project_id,source_id,id DESC''')}
    legacy = {('projects', p, ''): r['source_record'] for p, r in projects.items()}
    legacy.update({('models', p, m): r['source_record'] for (p, m), r in models.items()})
    for p, r in gold.items():
        legacy[('gold_projects', p, '')] = r['source_record']
        legacy.update({('gold_models', p, g['project_model_key']): g for g in r['model_groups']})
    # Existing pilot mirrors must still be backed by their immutable original rows.
    batches = {b['manifest_sha256']: b for b in tables['staging.intake_batches']}
    for kind, mirrors in [('projects', projects.values()), ('models', models.values())]:
        for mirror in mirrors:
            key = (kind, mirror['rem_project_id'], mirror.get('rem_model_id', ''))
            if key not in rows or key in prior:
                continue
            old = mirror['source_record']; source_batch = batches.get(mirror['intake_manifest_sha256'])
            require(old is not None and source_batch is not None, 'Existing mirror has no reviewed immutable evidence')
            doc = source_batch['datasets'][kind]
            candidates = [r['record'] for r in doc['rows']] if isinstance(doc, dict) else doc
            require(old in candidates, 'Existing source mirror differs from immutable evidence')
    evidence = []; counts = {kind: Counter() for kind in ('projects', 'models', 'gold_projects', 'gold_models')}
    for key, incoming in rows.items():
        kind, p, identity = key
        previous = prior.get(key); old = previous['record'] if previous else legacy.get(key)
        if kind == 'projects' and old:
            for modern, historical in [('ProjectID', 'project_id'), ('BrandID', 'brand_id'), ('CompanyID', 'company_id'), ('ProjectGroupID', 'rem_project_group_id')]:
                if modern in old or historical in old:
                    require(old.get(modern, old.get(historical)) == incoming[modern], 'Unreviewed REM identity/reference conflict: ' + p)
        if previous and old == incoming and previous['outcome'] != 'missing':
            counts[kind]['identical'] += 1; continue
        if previous:
            outcome = 'changed'
        elif old is None or incoming is None:
            outcome = 'new'
        else:
            outcome = 'changed' if legacy_changes(kind, old, incoming) else 'baseline'
        if incoming is None or (kind in ('projects', 'models') and incoming['isDeleted'] is True):
            outcome = 'deleted' if incoming is not None else 'missing'
        evidence.append((key, outcome, incoming, old)); counts[kind][outcome] += 1
    for key, previous in prior.items():
        if key not in rows and previous['outcome'] != 'missing' and not (key[0] == 'models' and key[1:] in omitted):
            evidence.append((key, 'missing', None, previous['record'])); counts[key[0]]['missing'] += 1
    deletions = [key for key in omitted if key in models]
    for p, m in deletions:
        require(not await connection.fetchval('SELECT EXISTS(SELECT 1 FROM hub.model_types WHERE rem_project_id=$1 AND rem_model_id=$2)', p, m),
                'Deleted source model has a protected Hub reference')
    inserts = {kind: [key for key, row in rows.items() if key[0] == kind and row is not None and
                     (key[1] not in projects if kind == 'projects' else key[1:] not in models if kind == 'models' else key[1] not in gold)]
               for kind in ('projects', 'models', 'gold_projects')}
    result = {'status': 'validated_dry_run', 'manifest_sha256': package['manifest_sha256'], 'outcomes': counts,
              'new_evidence': len(evidence), 'mirror_inserts': {k: len(v) for k, v in inserts.items()},
              'discarded_deleted_models': len(omitted), 'mirror_deletes': len(deletions),
              'discarded_model_keys': sorted(discard_keys if discard_keys is not None else omitted),
              'hub_drafts_changed': 0, 'mappings_changed': 0, 'publications_changed': 0}
    return result, (rows, evidence, inserts, deletions)


async def stage_package(connection, package, discard_deleted=False, apply=False):
    async with connection.transaction(isolation='serializable', readonly=not apply):
        if apply:
            await connection.execute("SELECT pg_advisory_xact_lock(hashtext('sena_hub_reviewed_pilot_intake'))")
            await connection.execute('LOCK TABLE staging.rem_projects,staging.rem_models,staging.dw_projects IN SHARE ROW EXCLUSIVE MODE')
        result, actions = await plan(connection, package, discard_deleted)
        if not apply or actions is None:
            return result
        rows, evidence, inserts, deletions = actions
        digest = package['manifest_sha256']; stamp = review.utc(package['manifest']['extracted_at'])
        await connection.execute('INSERT INTO staging.intake_batches(manifest_sha256,manifest,datasets) VALUES($1,$2,$3)', digest, package['manifest'], package['datasets'])
        await connection.executemany('''INSERT INTO staging.project_intake_evidence
            (manifest_sha256,kind,rem_project_id,source_id,outcome,record,previous_record) VALUES($1,$2,$3,$4,$5,$6,$7)''',
            [(digest, *key, outcome, record, old) for key, outcome, record, old in evidence])
        for key in inserts['projects']:
            row = rows[key]
            await connection.execute('''INSERT INTO staging.rem_projects(rem_project_id,project_name_rem,rem_brand_id,rem_company_id,
                source_updated_at,source_snapshot_at,source_fingerprint,source_record,intake_manifest_sha256,first_seen_at)
                VALUES($1,$2,$3,$4,NULL,$5,$6,$7,$8,now())''', key[1], row['ProjectName'] or '', row['BrandID'], row['CompanyID'], stamp, fingerprint(row), row, digest)
        for key in inserts['models']:
            row = rows[key]
            await connection.execute('''INSERT INTO staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,
                source_snapshot_at,source_fingerprint,source_record,intake_manifest_sha256,first_seen_at)
                VALUES($1,$2,$3,NULL,$4,$5,$6,$7,now())''', key[1], key[2], row['ModelName'] or '', stamp, fingerprint(row), row, digest)
        groups = defaultdict(list)
        for g in package['datasets']['gold_models']:
            groups[g['project_id']].append(g)
        for key in inserts['gold_projects']:
            row = rows[key]; model_groups = groups[key[1]]
            await connection.execute('''INSERT INTO staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,model_groups,provenance)
                VALUES($1,$2,$3,$4,$5,$6)''', key[1], row, datetime.fromisoformat(row['source_snapshot_at']),
                fingerprint({'project': row, 'models': model_groups}), model_groups,
                {'method': 'reviewed_dw_project_package', 'manifest_sha256': digest, 'human_approved': False})
        await connection.execute('UPDATE staging.rem_projects SET first_seen_at=now() WHERE first_seen_at IS NULL AND rem_project_id=ANY($1::text[])', [k[1] for k in rows if k[0] == 'projects'])
        await connection.executemany('UPDATE staging.rem_models SET first_seen_at=now() WHERE first_seen_at IS NULL AND rem_project_id=$1 AND rem_model_id=$2', [k[1:] for k in rows if k[0] == 'models'])
        await connection.executemany('DELETE FROM staging.rem_models WHERE rem_project_id=$1 AND rem_model_id=$2', deletions)
        result['status'] = 'staged'
        await connection.execute('INSERT INTO staging.project_intake_receipts(manifest_sha256,outcomes) VALUES($1,$2)', digest, result)
        return result


async def run(package, discard_deleted, apply):
    import asyncpg
    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf8'))
    connection = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local', user='postgres', password=config['adminPassword'])
    try:
        require(Path(await connection.fetchval('SHOW data_directory')).resolve() == (ROOT / '.local/postgres').resolve(), 'Only the fixed local working cluster is supported')
        await connection.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        return await stage_package(connection, package, discard_deleted, apply)
    except asyncpg.PostgresError:
        raise RuntimeError('Local intake transaction failed; no partial intake committed. Check the private package and local migration state.') from None
    finally:
        await connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--discard-deleted-ungrouped-models', action='store_true')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    package = review.load_package(args.package, args.manifest_sha256)
    archive = ROOT / '.local/dw-project-intake' / package['manifest_sha256']; original = archive / 'original'
    original.mkdir(parents=True, exist_ok=True)
    for name, content in package['raw_files'].items():
        target = original / name
        if target.exists():
            require(target.read_bytes() == content, 'Original evidence changed')
        else:
            with target.open('xb') as stream:
                stream.write(content)
    result = asyncio.run(run(package, args.discard_deleted_ungrouped_models, args.apply))
    receipt = archive / (('apply-' if args.apply else 'intake-dry-run-') + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
    with receipt.open('x', encoding='utf8') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2); stream.write('\n')
    summary = {key: value for key, value in result.items() if key not in ('discarded_model_keys', 'replayed_receipt')}
    print(json.dumps({**summary, 'receipt': str(receipt)}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf8')
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, RuntimeError) as error:
        raise SystemExit('Project intake stopped: ' + str(error)) from None
