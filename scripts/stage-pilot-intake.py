"""Validate the reviewed HYABC package, then optionally stage it locally.

Dry-run by default. This one-off adapter cannot connect to REM/DW or a remote Hub,
refresh source records, create Hub drafts, approve mappings, or publish.
The superseded pilot's unused mirrors are retired atomically; referenced drafts
and their source evidence stay intact.
Run with the existing apps/api Python environment (asyncpg is already installed).
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / '.local/pilot-intake/20260918T080012467449Z_HYABC'
REVIEWED_MANIFEST_SHA256 = '79188d1687c08bdc1ade916b3a3771db76858a91df62b61824bf1d0f28fa54fc'
SUPERSEDED_MANIFEST_SHA256 = '59391f30f3c31c4d999e11c5dbeacb875bfe2a9f4eb2e8a7e36f0b1029c78d08'
spec = importlib.util.spec_from_file_location('pilot_review', ROOT / 'scripts/prepare-pilot-intake.py')
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


def load_package(folder: Path) -> dict:
    """Reuse the review verifier, then verify the exact bytes held for import."""
    pilot.verify_package(folder)
    raw_manifest = (folder / 'manifest.json').read_bytes()
    digest = hashlib.sha256(raw_manifest).hexdigest()
    if digest != REVIEWED_MANIFEST_SHA256:
        raise ValueError('Only the explicitly reviewed pilot manifest is supported')
    manifest = json.loads(raw_manifest)
    datasets = {}
    for name in pilot.SPECS:
        content = (folder / f'{name}.json').read_bytes()
        if hashlib.sha256(content).hexdigest() != manifest['files'][f'{name}.json']['sha256']:
            raise ValueError('Source file changed after verification')
        datasets[name] = json.loads(content)
    package = {'manifest_sha256': digest, 'manifest': manifest, 'datasets': datasets}
    mirror_rows(package)  # Reject invalid selection candidates before any connection.
    return package


def mirror_rows(package: dict, project_ids: set[str] | None = None) -> dict:
    datasets = package['datasets']
    data = {name: [row['record'] for row in dataset['rows']] for name, dataset in datasets.items()}
    review = pilot.review(data, project_ids)
    # ponytail: first reviewed intake only. Changed/ineligible source records need
    # the future DW reconciliation workflow, never an implicit upsert or delete.
    if any(flag['code'] != 'source_modified_at_missing' for flag in review['flags']):
        raise ValueError('Source status, name, reference or area requires review before staging')
    if any(row['is_deleted'] is not False for rows in data.values() for row in rows):
        raise ValueError('Unknown/deleted source records cannot become selectable')
    brand_ids = {row['brand_id'] for row in data['projects']}
    company_ids = {row['company_id'] for row in data['projects']}
    type_ids = {row['model_type_id'] for row in data['models']}
    if ({row['brand_id'] for row in data['brands']} != brand_ids
            or {row['company_id'] for row in data['companies']} != company_ids
            or {row['model_type_id'] for row in data['model_types']} != type_ids):
        raise ValueError('Dictionary scope must match the selected projects/models exactly')
    mirrors = {}
    for name in ('brands', 'companies', 'projects', 'models'):
        snapshot = datetime.fromisoformat(datasets[name]['source_snapshot_at'])
        if snapshot.tzinfo is None or snapshot.utcoffset() != timezone.utc.utcoffset(snapshot):
            raise ValueError('Extraction timestamp must be explicitly UTC')
        rows = []
        for item in datasets[name]['rows']:
            record = item['record']
            row = {
                'source_updated_at': None,  # Source timezone is unverified, even when ModifyDate exists.
                'source_snapshot_at': snapshot,
                'source_fingerprint': item['source_fingerprint'],
                'source_record': record,
                'intake_manifest_sha256': package['manifest_sha256'],
            }
            if name == 'brands':
                row.update(rem_brand_id=record['brand_id'], brand_name_rem=record['brand_name_th'],
                           brand_name_en_rem=record.get('brand_name_en'), is_deleted=False)
            elif name == 'companies':
                row.update(rem_company_id=record['company_id'], company_name_rem=record['company_name_th'],
                           company_name_en_rem=record.get('company_name_en'), is_deleted=False)
            elif name == 'projects':
                row.update(rem_project_id=record['project_id'], project_name_rem=record['project_name_th'],
                           rem_brand_id=record['brand_id'], rem_company_id=record['company_id'])
            else:
                row.update(rem_project_id=record['project_id'], rem_model_id=record['model_id'],
                           model_name_rem=record['model_name_th'])
            rows.append(row)
        mirrors[name] = rows
    return mirrors


async def configure_json(connection):
    await connection.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)


def comparable(row):
    # JSON booleans and numbers are distinct even though False == 0 in Python.
    return {**dict(row), 'source_record': pilot.canonical(row['source_record'])}


async def retire_superseded_snapshot(connection):
    """Retire only unused mirrors from the explicitly superseded reviewed batch."""
    old = await connection.fetchrow(
        'SELECT manifest,datasets FROM staging.intake_batches WHERE manifest_sha256=$1',
        SUPERSEDED_MANIFEST_SHA256,
    )
    if not old:
        return
    project_ids = old['manifest']['requested_project_ids']
    if set(project_ids) != pilot.HISTORICAL_PILOT_IDS:
        raise ValueError('Unexpected superseded pilot scope')
    if await connection.fetchval('SELECT EXISTS(SELECT 1 FROM hub.projects WHERE rem_project_id=ANY($1::text[]))', project_ids):
        return  # Selection changes never erase existing drafts or their source evidence.
    for name in ('projects', 'models'):
        if await connection.fetchval(
            f'SELECT EXISTS(SELECT 1 FROM staging.rem_{name} WHERE rem_project_id=ANY($1::text[]) AND intake_manifest_sha256 IS DISTINCT FROM $2)',
            project_ids, SUPERSEDED_MANIFEST_SHA256,
        ):
            raise ValueError('Superseded pilot contains unrelated source evidence; nothing retired')
    old_mirrors = mirror_rows({**dict(old), 'manifest_sha256': SUPERSEDED_MANIFEST_SHA256}, set(project_ids))
    for name in ('brands', 'companies', 'projects', 'models'):
        keys = pilot.SPECS[name][1]
        expected = {tuple(row['rem_' + key] for key in keys): row for row in old_mirrors[name]}
        fields = ','.join(old_mirrors[name][0])
        rows = await connection.fetch(
            f'SELECT {fields} FROM staging.rem_{name} WHERE intake_manifest_sha256=$1',
            SUPERSEDED_MANIFEST_SHA256,
        )
        for row in rows:
            original = expected.get(tuple(row['rem_' + key] for key in keys))
            if not original or comparable(row) != comparable(original):
                raise ValueError('Superseded mirror changed; nothing retired')
    for name in ('models', 'projects'):
        await connection.execute(
            f'DELETE FROM staging.rem_{name} WHERE rem_project_id=ANY($1::text[]) AND intake_manifest_sha256=$2',
            project_ids, SUPERSEDED_MANIFEST_SHA256,
        )
    await connection.execute('''DELETE FROM staging.rem_brands b WHERE intake_manifest_sha256=$1
        AND NOT EXISTS(SELECT 1 FROM hub.brands h WHERE h.rem_brand_id=b.rem_brand_id)
        AND NOT EXISTS(SELECT 1 FROM staging.rem_projects p WHERE p.rem_brand_id=b.rem_brand_id)''', SUPERSEDED_MANIFEST_SHA256)
    await connection.execute('''DELETE FROM staging.rem_companies c WHERE intake_manifest_sha256=$1
        AND NOT EXISTS(SELECT 1 FROM staging.rem_projects p WHERE p.rem_company_id=c.rem_company_id)''', SUPERSEDED_MANIFEST_SHA256)


async def stage_package(connection, package: dict) -> str:
    """One transaction, exact replay or fail; caller supplies the fixed local connection."""
    mirrors = mirror_rows(package)
    async with connection.transaction():
        await connection.execute("SELECT pg_advisory_xact_lock(hashtext('sena_hub_reviewed_pilot_intake'))")
        batch = await connection.fetchrow(
            'SELECT manifest,datasets FROM staging.intake_batches WHERE manifest_sha256=$1',
            package['manifest_sha256'],
        )
        if batch and any(pilot.canonical(batch[field]) != pilot.canonical(package[field])
                         for field in ('manifest', 'datasets')):
            raise ValueError('Stored intake evidence conflicts with this package')
        if not batch:
            await retire_superseded_snapshot(connection)
        for name, rows in mirrors.items():
            columns = list(rows[0])
            key = {'brands': 'rem_brand_id', 'companies': 'rem_company_id'}.get(name, 'rem_project_id')
            # SQL identifiers below are fixed in this module, never taken from a source record.
            existing = await connection.fetch(
                f"SELECT {','.join(columns)} FROM staging.rem_{name} WHERE {key}=ANY($1::text[])",
                list({row[key] for row in rows}),
            )
            if batch:
                identity = lambda row: (row[key], row.get('rem_model_id', ''))
                if sorted(map(comparable, existing), key=identity) != sorted(map(comparable, rows), key=identity):
                    raise ValueError(f'Staged {name} changed; recurring reconciliation is required')
            elif existing:
                raise ValueError(f'Existing {name} conflict with first intake; no records were replaced')
        if batch:
            return 'already_staged'
        await connection.execute(
            'INSERT INTO staging.intake_batches(manifest_sha256,manifest,datasets) VALUES($1,$2,$3)',
            package['manifest_sha256'], package['manifest'], package['datasets'],
        )
        for name, rows in mirrors.items():
            columns = list(rows[0])
            placeholders = ','.join(f'${index}' for index in range(1, len(columns) + 1))
            await connection.executemany(
                f"INSERT INTO staging.rem_{name}({','.join(columns)}) VALUES({placeholders})",
                [[row[column] for column in columns] for row in rows],
            )
    return 'staged'


async def apply_local(package: dict) -> dict:
    import asyncpg

    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
    connection = None
    try:
        # Deliberately no URL/env/host override: this command only writes the local sandbox.
        connection = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local',
                                          user='postgres', password=config['adminPassword'], timeout=10)
        await configure_json(connection)
        result = await stage_package(connection, package)
        imported_at = await connection.fetchval(
            'SELECT imported_at FROM staging.intake_batches WHERE manifest_sha256=$1',
            package['manifest_sha256'],
        )
        retained = await connection.fetch(
            'SELECT rem_project_id FROM staging.rem_projects WHERE intake_manifest_sha256=$1 ORDER BY rem_project_id',
            SUPERSEDED_MANIFEST_SHA256,
        )
        return {'status': result, 'imported_at_utc': imported_at.isoformat(),
                'superseded_projects_retained': [row['rem_project_id'] for row in retained]}
    except ValueError:
        raise
    except Exception:
        # Database/connection exceptions can contain credentials or source data.
        raise RuntimeError('Local staging failed; verify the local database and migration 007. No partial import is committed.') from None
    finally:
        if connection is not None:
            await connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, default=PACKAGE)
    parser.add_argument('--apply', action='store_true', help='Write staging only in the fixed local development database')
    args = parser.parse_args()
    try:
        package = load_package(args.package)
        result = asyncio.run(apply_local(package)) if args.apply else {'status': 'validated_dry_run'}
        print(json.dumps({
            **result, 'manifest_sha256': package['manifest_sha256'],
            'source_counts': {name: len(data['rows']) for name, data in package['datasets'].items()},
            'hub_drafts_created': False, 'mappings_confirmed': False, 'published': False,
            'source_timezone': 'unverified', 'area_semantics': 'unverified',
        }, indent=2))
    except (ValueError, RuntimeError) as error:
        print(f'Intake stopped: {error}', file=sys.stderr)
        return 1
    except Exception:
        print('Intake stopped: package or local configuration is unavailable/invalid; no source data was changed.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
