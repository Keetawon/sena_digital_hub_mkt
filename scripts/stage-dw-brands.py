"""Verify the reviewed DW brand dictionary; --apply stages only the fixed local Hub.

No DW connection, hosted target, Hub draft creation or publication is supported.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.util
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT.parent / 'sena_idea_mkt_data_warehouse/data/rem-brand-export/20261002T071912690927Z'
REVIEWED_MANIFEST_SHA256 = '1512ac0bac74f5356617458b30bf2079896cce18db54393b5244c136ae54f877'
PREDECESSORS = {
    '59391f30f3c31c4d999e11c5dbeacb875bfe2a9f4eb2e8a7e36f0b1029c78d08',
    '79188d1687c08bdc1ade916b3a3771db76858a91df62b61824bf1d0f28fa54fc',
}
spec = importlib.util.spec_from_file_location('pilot_stage', ROOT / 'scripts/stage-pilot-intake.py')
pilot_stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot_stage)
canonical = pilot_stage.pilot.canonical


def utc(value: str) -> datetime:
    stamp = datetime.fromisoformat(value)
    if stamp.tzinfo is None or stamp.utcoffset() != timezone.utc.utcoffset(stamp):
        raise ValueError('DW metadata timestamps must be explicitly UTC')
    return stamp


def load_package(folder: Path) -> dict:
    raw = {'manifest.json': (folder / 'manifest.json').read_bytes()}
    digest = hashlib.sha256(raw['manifest.json']).hexdigest()
    if digest != REVIEWED_MANIFEST_SHA256:
        raise ValueError('Only the explicitly reviewed DW brand manifest is supported')
    manifest = json.loads(raw['manifest.json'])
    if (manifest['contract_version'] != 'rem-brand-master-test-v1'
            or manifest['environment'] != 'test' or manifest['synthetic'] is not False
            or manifest['source_relation'] != 'gold_rem_brand_test.dim_brand'
            or set(manifest['files']) != {'brands.json', 'exceptions.json'}):
        raise ValueError('Unexpected DW dictionary contract')
    datasets = {}
    for file, metadata in manifest['files'].items():
        content = (folder / file).read_bytes()
        if len(content) != metadata['bytes'] or hashlib.sha256(content).hexdigest() != metadata['sha256']:
            raise ValueError('DW payload integrity mismatch')
        rows = json.loads(content)
        if not isinstance(rows, list) or len(rows) != metadata['row_count']:
            raise ValueError('DW payload count mismatch')
        if any(not isinstance(row, dict) or set(row) != set(metadata['columns']) for row in rows):
            raise ValueError('DW payload column mismatch')
        datasets[file.removesuffix('.json')] = rows
        raw[file] = content
    counts = manifest['counts']
    if (len(datasets['brands']) != counts['brands'] or len(datasets['exceptions']) != counts['exceptions']
            or dict(Counter(row['deletion_status'] for row in datasets['brands'])) != counts['brands_by_deletion_status']
            or dict(Counter(row['issue_code'] for row in datasets['exceptions'])) != counts['exceptions_by_issue']):
        raise ValueError('DW manifest counts disagree with payloads')
    if not datasets['brands']:
        raise ValueError('The reviewed dictionary cannot be empty')
    ids = [row['brand_id'] for row in datasets['brands']]
    if any(not isinstance(value, str) or not value.strip() for value in ids) or len(set(ids)) != len(ids):
        raise ValueError('Brand IDs must be distinct nonblank text')
    utc(manifest['snapshot_at'])
    for row in datasets['brands']:
        expected_status = {'0': 'active', '1': 'deleted', None: 'unknown'}.get(row['deletion_flag_raw'])
        if expected_status is None or row['deletion_status'] != expected_status:
            raise ValueError('Deletion evidence is inconsistent')
        if row['source_snapshot_id'] != manifest['source_snapshot_id']:
            raise ValueError('Mixed DW extraction lineage')
        utc(row['extracted_at'])
        for field in ('residential_project_count', 'non_deleted_residential_project_count'):
            if type(row[field]) is not int or row[field] < 0:
                raise ValueError('Residential reference counts must be nonnegative integers')
        if (row['non_deleted_residential_project_count'] > row['residential_project_count']
                or row['has_residential_projects'] is not (row['residential_project_count'] > 0)):
            raise ValueError('Residential usage evidence is inconsistent')
    keys = [row['exception_key'] for row in datasets['exceptions']]
    if len(set(keys)) != len(keys):
        raise ValueError('Duplicate exception evidence')
    for row in datasets['exceptions']:
        if (row['owner_role'] != 'REM_BRAND_STEWARD' or row['disposition'] != 'REVIEW_REQUIRED'
                or any(not isinstance(value, str) for value in row['brand_ids'] + row['project_ids'])):
            raise ValueError('Invalid exception routing or text IDs')
    return {'manifest_sha256': digest, 'manifest': manifest, 'datasets': datasets, 'raw_files': raw}


def mirror_rows(package: dict) -> list[dict]:
    return [{
        'rem_brand_id': row['brand_id'], 'brand_name_rem': row['brand_name_th'],
        'brand_name_en_rem': row['brand_name_en'],
        'is_deleted': {'active': False, 'deleted': True, 'unknown': None}[row['deletion_status']],
        'source_updated_at': None,  # REM wall-clock timezone remains unconfirmed.
        'source_snapshot_at': utc(row['extracted_at']),
        'source_fingerprint': pilot_stage.pilot.fingerprint(row),
        'source_record': row, 'intake_manifest_sha256': package['manifest_sha256'],
    } for row in package['datasets']['brands']]


async def verify_predecessor(connection, existing: dict, incoming: dict):
    """Only enrich unchanged identities from the two reviewed pilot batches."""
    digest = existing['intake_manifest_sha256']
    if digest not in PREDECESSORS:
        raise ValueError('Existing brand has unreviewed/conflicting evidence; nothing replaced')
    batch = await connection.fetchrow('SELECT manifest,datasets FROM staging.intake_batches WHERE manifest_sha256=$1', digest)
    if not batch:
        raise ValueError('Predecessor batch evidence is missing')
    old = next((row for row in pilot_stage.mirror_rows(
        {**dict(batch), 'manifest_sha256': digest}, set(batch['manifest']['requested_project_ids']),
    )['brands'] if row['rem_brand_id'] == incoming['rem_brand_id']), None)
    if old is None or pilot_stage.comparable(existing) != pilot_stage.comparable(old):
        raise ValueError('Predecessor staging changed; nothing replaced')
    if any(existing[field] != incoming[field] for field in ('rem_brand_id', 'brand_name_rem', 'brand_name_en_rem', 'is_deleted')):
        raise ValueError('Source brand identity/status changed; reconciliation is required')
    prior, current = existing['source_record'], incoming['source_record']
    if prior.get('brand_code') != current['brand_code']:
        raise ValueError('Source brand code changed; reconciliation is required')
    for old_key, new_key in (('source_created_at', 'source_created_at_raw'), ('source_modified_at', 'source_modified_at_raw')):
        left, right = prior.get(old_key), current[new_key]
        if (datetime.fromisoformat(left) if left else None) != (datetime.fromisoformat(right) if right else None):
            raise ValueError('Source raw timestamps changed; reconciliation is required')


async def stage_package(connection, package: dict) -> str:
    rows = mirror_rows(package)
    columns = list(rows[0])
    async with connection.transaction():
        # Shared with the pilot importer, so bounded enrichment cannot race it.
        await connection.execute("SELECT pg_advisory_xact_lock(hashtext('sena_hub_reviewed_pilot_intake'))")
        batch = await connection.fetchrow('SELECT manifest,datasets FROM staging.intake_batches WHERE manifest_sha256=$1', package['manifest_sha256'])
        if batch and any(canonical(batch[field]) != canonical(package[field]) for field in ('manifest', 'datasets')):
            raise ValueError('Stored immutable batch conflicts with this package')
        existing = {row['rem_brand_id']: dict(row) for row in await connection.fetch(
            f"SELECT {','.join(columns)} FROM staging.rem_brands WHERE rem_brand_id=ANY($1::text[]) FOR UPDATE",
            [row['rem_brand_id'] for row in rows],
        )}
        for row in rows:
            old = existing.get(row['rem_brand_id'])
            if batch:
                if old is None or pilot_stage.comparable(old) != pilot_stage.comparable(row):
                    raise ValueError('Staged dictionary changed; exact replay refused')
            elif old:
                await verify_predecessor(connection, old, row)
        if batch:
            return 'already_staged'
        await connection.execute('INSERT INTO staging.intake_batches(manifest_sha256,manifest,datasets) VALUES($1,$2,$3)',
                                 package['manifest_sha256'], package['manifest'], package['datasets'])
        for row in rows:
            values = [row[column] for column in columns]
            if row['rem_brand_id'] in existing:
                await connection.execute('UPDATE staging.rem_brands SET ' + ','.join(f'{column}=${i+1}' for i, column in enumerate(columns) if column != 'rem_brand_id') + ' WHERE rem_brand_id=$1', *values)
            else:
                await connection.execute(f"INSERT INTO staging.rem_brands({','.join(columns)}) VALUES({','.join(f'${i+1}' for i in range(len(columns)))})", *values)
    return 'staged'


async def apply_local(package: dict) -> dict:
    import asyncpg

    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
    connection = None
    try:
        connection = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local',
                                          user='postgres', password=config['adminPassword'], timeout=10)
        identity = await connection.fetchrow('SELECT current_database() db,host(inet_server_addr()) host,inet_server_port() port')
        if dict(identity) != {'db': 'sena_hub_local', 'host': '127.0.0.1', 'port': 55432}:
            raise ValueError('Brand intake requires the fixed local Hub')
        await pilot_stage.configure_json(connection)
        archive = ROOT / '.local/dw-brand-intake' / package['manifest_sha256']
        archive.mkdir(parents=True, exist_ok=True)
        for name, content in package['raw_files'].items():
            path = archive / name
            if path.exists():
                if path.read_bytes() != content:
                    raise ValueError('Archived immutable package conflicts')
            else:
                with path.open('xb') as file:
                    file.write(content)
        result = await stage_package(connection, package)
        imported_at = await connection.fetchval('SELECT imported_at FROM staging.intake_batches WHERE manifest_sha256=$1', package['manifest_sha256'])
        return {'status': result, 'imported_at_utc': imported_at.isoformat(), 'archive': str(archive.relative_to(ROOT))}
    except ValueError:
        raise
    except Exception:
        raise RuntimeError('Local brand intake failed; no partial database import is committed. Check local configuration and migration 0026.') from None
    finally:
        if connection is not None:
            await connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, default=PACKAGE)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        package = load_package(args.package)
        result = asyncio.run(apply_local(package)) if args.apply else {'status': 'validated_dry_run'}
        print(json.dumps({**result, 'manifest_sha256': package['manifest_sha256'],
                          'counts': package['manifest']['counts'], 'hub_drafts_created': False, 'published': False}, indent=2))
        return 0
    except (ValueError, RuntimeError) as error:
        print(f'Brand intake stopped: {error}', file=sys.stderr)
    except Exception:
        print('Brand intake stopped: package/configuration unavailable or invalid; source rows and credentials are not logged.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
