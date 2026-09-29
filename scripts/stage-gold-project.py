"""Validate an operator-exported HYABC Gold snapshot; optionally stage locally.

Input: one JSON object (or one-row array) from gold.dim_project and a JSON array
from gold.dim_project_model. Preserve the export files; never manufacture Gold
from REM relay files. This command does not edit Hub drafts or approve content.
"""
import argparse
import asyncio
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT_FIELDS = ('commercial_brand', 'project_id', 'rem_project_group_id', 'project_name',
               'commercial_project_name', 'project_name_eng', 'commercial_project_name_eng',
               'soi', 'road', 'subdistrict', 'district', 'province', 'postcode',
               'soi_eng', 'road_eng', 'subdistrict_eng', 'district_eng', 'province_eng',
               'rem_brand_id', 'company_id')


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def validate(project, models):
    if isinstance(project, list) and len(project) == 1:
        project = project[0]
    if not isinstance(project, dict) or project.get('project_id') != 'HYABC':
        raise ValueError('Only the selected HYABC project is supported')
    snapshot = datetime.fromisoformat(project.get('source_snapshot_at') or '')
    if snapshot.tzinfo is None:
        raise ValueError('Gold source_snapshot_at needs a verified timezone; export time cannot substitute for it')
    for field in TEXT_FIELDS:
        if field not in project or (project[field] is not None and not isinstance(project[field], str)):
            raise ValueError(f'Missing or invalid Gold field: {field}')
    for field in ('moo', 'moo_eng'):
        if field not in project or (project[field] is not None and type(project[field]) is not int):
            raise ValueError(f'Missing or invalid Gold field: {field}')
    coordinates = [project.get(field) for field in ('latitude', 'longitude')]
    if not all(field in project for field in ('latitude', 'longitude')):
        raise ValueError('Both coordinate fields must be present, even when null')
    if any(v is not None for v in coordinates):
        for value, limit in zip(coordinates, (90, 180)):
            if type(value) not in (int, float) or not math.isfinite(value) or not -limit <= value <= limit:
                raise ValueError('Coordinates must be a valid numeric pair or both null')
        if project.get('has_valid_coordinates') is False:
            raise ValueError('Coordinate validity conflicts with the supplied pair')
    if not isinstance(models, list) or not models:
        raise ValueError('A complete, non-empty Gold model export is required for HYABC')
    keys, identities = set(), set()
    for model in models:
        if not isinstance(model, dict) or model.get('project_id') != 'HYABC':
            raise ValueError('Out-of-scope Gold model group')
        key = model.get('project_model_key')
        if not isinstance(key, str) or not key or key in keys:
            raise ValueError('Missing or duplicate Gold model group key')
        keys.add(key)
        ids = model.get('model_ids')
        if not isinstance(ids, list) or not ids or any(not isinstance(i, str) or not i.strip() for i in ids):
            raise ValueError('Model groups must retain their exact technical model_ids')
        if len(set(ids)) != len(ids) or identities.intersection(ids):
            raise ValueError('Ambiguous technical model identity across Gold groups')
        identities.update(ids)
        if not isinstance(model.get('model_name'), str) or not model['model_name'].strip():
            raise ValueError('Missing Gold model name')
        if model.get('model_name_eng') is not None and not isinstance(model['model_name_eng'], str):
            raise ValueError('Invalid Gold English model name')
        if 'model_type_ids' in model and (not isinstance(model['model_type_ids'], list)
                or any(not isinstance(i, str) for i in model['model_type_ids'])):
            raise ValueError('Model type IDs must remain a JSON string array')
        if type(model.get('technical_model_count')) is not int or model['technical_model_count'] != len(ids):
            raise ValueError('Gold technical model count disagrees with its identity array')
        for field in ('minimum_model_area', 'maximum_model_area', 'minimum_available_selling_price', 'maximum_available_selling_price'):
            if model.get(field) is not None and (type(model[field]) not in (int, float) or not math.isfinite(model[field])):
                raise ValueError(f'Invalid numeric Gold model field: {field}')
        for field in ('total_unit_count', 'available_unit_count'):
            if field in model and (type(model[field]) is not int or model[field] < 0):
                raise ValueError(f'Invalid Gold unit count: {field}')
        if type(model.get('model_attribute_variant')) is not bool:
            raise ValueError('Gold model variant flag must be explicit')
    canonical({'project': project, 'models': models})  # Reject non-finite JSON values anywhere.
    return project, models


async def apply_local(project, models, fingerprint, provenance):
    import asyncpg

    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
    connection = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local',
                                      user='postgres', password=config['adminPassword'], timeout=10)
    try:
        await connection.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        async with connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock(hashtext('sena_hub_gold_hyabc'))")
            source = await connection.fetchrow("SELECT rem_brand_id,rem_company_id FROM staging.rem_projects WHERE rem_project_id='HYABC'")
            if not source or project['rem_brand_id'] != source['rem_brand_id'] or project['company_id'] != source['rem_company_id']:
                raise ValueError('Gold identity disagrees with the reviewed REM project mapping')
            known = {r['rem_model_id'] for r in await connection.fetch("SELECT rem_model_id FROM staging.rem_models WHERE rem_project_id='HYABC'")}
            if {i for model in models for i in model['model_ids']} != known:
                raise ValueError('Gold and reviewed REM model identity sets differ; reconcile before staging')
            old = await connection.fetchrow("SELECT * FROM staging.dw_projects WHERE rem_project_id='HYABC'")
            if old:
                if (old['source_fingerprint'] != fingerprint or canonical(old['source_record']) != canonical(project)
                        or canonical(old['model_groups']) != canonical(models)):
                    raise ValueError('An existing Gold snapshot differs; source refresh requires separate review')
                return 'already_staged'
            await connection.execute("SELECT set_config('app.change_reason','Stage operator-exported HYABC Gold snapshot',true)")
            await connection.execute('''INSERT INTO staging.dw_projects
                (rem_project_id,source_record,model_groups,source_snapshot_at,source_fingerprint,provenance)
                VALUES('HYABC',$1,$2,$3,$4,$5)''', project, models,
                datetime.fromisoformat(project['source_snapshot_at']), fingerprint, provenance)
        return 'staged'
    finally:
        await connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    handoff = parser.add_mutually_exclusive_group(required=True)
    handoff.add_argument('--captured-at', help='Known operator export timestamp with explicit UTC offset')
    handoff.add_argument('--received-at', help='Chat receipt timestamp with explicit UTC offset; export time remains unknown')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        handoff_at = datetime.fromisoformat(args.captured_at or args.received_at)
        if handoff_at.tzinfo is None:
            raise ValueError('Export or receipt timestamp must include its timezone offset')
        files = {name: path.read_bytes() for name, path in (('project', args.project), ('models', args.models))}
        project, models = validate(json.loads(files['project']), json.loads(files['models']))
        digest = hashlib.sha256(canonical({'project': project, 'models': models})).hexdigest()
        provenance = {'method': 'operator_provided_gold_export', 'relations': ['gold.dim_project', 'gold.dim_project_model'],
                      'captured_at': handoff_at.isoformat() if args.captured_at else None, 'human_approved': False,
                      'files': {name: hashlib.sha256(raw).hexdigest() for name, raw in files.items()}}
        if args.received_at:
            provenance.update(received_at=handoff_at.isoformat(), transfer_method='user_pasted_query_results')
        if args.apply:
            # Keep original bytes and their operator-supplied context even if DB validation fails.
            folder = ROOT / '.local/pilot-intake' / ('gold_HYABC_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
            folder.mkdir(parents=True, exist_ok=False)
            for name, raw in files.items():
                (folder / f'{name}.json').write_bytes(raw)
            (folder / 'provenance.json').write_text(json.dumps(provenance, indent=2)+'\n', encoding='utf-8')
            provenance['local_evidence_folder'] = str(folder.relative_to(ROOT))
            status = asyncio.run(apply_local(project, models, digest, provenance))
        else:
            status = 'validated_dry_run'
        print(json.dumps({'status': status, 'project_id': 'HYABC', 'gold_model_groups': len(models),
                          'source_fingerprint': digest, 'hub_drafts_changed': False, 'published': False}, indent=2))
    except ValueError as error:
        print(f'Gold intake stopped: {error}')
        return 1
    except Exception:
        print('Gold intake stopped: check the supplied JSON and local database; no partial database import committed.')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
