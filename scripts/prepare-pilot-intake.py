"""Read-only REM review package for the current HYABC pilot; never publishes data.

Run with the existing DW Python environment from the DW repository, where dlt
resolves its existing REM connection. No credentials are accepted or printed.
This package is independent of the DW's complete versioned relay contract.
"""
from __future__ import annotations

import ast
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

PILOT_IDS = {"HYABC"}
HISTORICAL_PILOT_IDS = {"KUBON", "B_PO"}
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".local" / "pilot-intake"
SCOPE = "('HYABC')"
SPECS = {
    "projects": ("dbo.Sys_Master_Projects", ("project_id",), f"""SELECT
ProjectID AS project_id, ProjectCode AS project_code, ProjectName AS project_name_th,
ProjectNameEng AS project_name_en, BrandID AS brand_id, CompanyID AS company_id,
ProjectType AS project_type, RealEstateType AS real_estate_type_id, ProjectStatus AS project_status,
isDelete AS is_deleted, CreateDate AS source_created_at, ModifyDate AS source_modified_at
FROM dbo.Sys_Master_Projects WHERE ProjectID IN {SCOPE} ORDER BY ProjectID"""),
    "brands": ("dbo.Sys_Master_Brands", ("brand_id",), f"""SELECT
BrandID AS brand_id, BrandCode AS brand_code, BrandName AS brand_name_th,
BrandNameEng AS brand_name_en, isDelete AS is_deleted,
CreateDate AS source_created_at, ModifyDate AS source_modified_at
FROM dbo.Sys_Master_Brands WHERE BrandID IN
(SELECT BrandID FROM dbo.Sys_Master_Projects WHERE ProjectID IN {SCOPE}) ORDER BY BrandID"""),
    "companies": ("dbo.Sys_Admin_Companies", ("company_id",), f"""SELECT
CompanyID AS company_id, CompanyNameThai AS company_name_th, CompanyNameEng AS company_name_en,
isDelete AS is_deleted, CreateDate AS source_created_at, ModifyDate AS source_modified_at
FROM dbo.Sys_Admin_Companies WHERE CompanyID IN
(SELECT CompanyID FROM dbo.Sys_Master_Projects WHERE ProjectID IN {SCOPE}) ORDER BY CompanyID"""),
    "models": ("dbo.Sys_REM_ProjectModel", ("project_id", "model_id"), f"""SELECT
ProjectID AS project_id, ModelID AS model_id, ModelTypeID AS model_type_id,
ModelName AS model_name_th, ModelNameEng AS model_name_en, ShortName AS short_name,
ModelArea AS model_area, isDelete AS is_deleted,
CreateDate AS source_created_at, ModifyDate AS source_modified_at
FROM dbo.Sys_REM_ProjectModel WHERE ProjectID IN {SCOPE} ORDER BY ProjectID,ModelID"""),
    "model_types": ("dbo.Sys_REM_Master_ModelType", ("model_type_id",), f"""SELECT
ModelTypeID AS model_type_id, ModelTypeName AS model_type_name_th,
ModelTypeNameEng AS model_type_name_en, ShortName AS short_name,
ModelArea AS model_area, ProjectType AS project_type, RealEstateID AS real_estate_id,
isDelete AS is_deleted, CreateDate AS source_created_at, ModifyDate AS source_modified_at
FROM dbo.Sys_REM_Master_ModelType WHERE ModelTypeID IN
(SELECT ModelTypeID FROM dbo.Sys_REM_ProjectModel WHERE ProjectID IN {SCOPE}) ORDER BY ModelTypeID"""),
}


def scalar(value):
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, datetime):
        return value.isoformat()  # Source datetimes retain no assumed timezone.
    if value is None or isinstance(value, (str, int, bool)):
        return value
    raise ValueError("Unexpected source scalar type")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def fingerprint(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def identity_checks(data, project_ids=None):
    project_ids = PILOT_IDS if project_ids is None else project_ids
    for name, (_, keys, _) in SPECS.items():
        identities = []
        for row in data[name]:
            key = tuple(row[k] for k in keys)
            if not all(isinstance(v, str) and v.strip() for v in key):
                raise ValueError(f"Missing or non-string identity: {name}")
            if row['is_deleted'] is not None and type(row['is_deleted']) is not bool:
                raise ValueError(f"Unexpected deletion flag: {name}")
            identities.append(key)
        if len(identities) != len(set(identities)):
            raise ValueError(f"Duplicate complete source key: {name}")
    if {row['project_id'] for row in data['projects']} != project_ids:
        raise ValueError("Exact pilot ProjectIDs were not found")
    if any(row['project_id'] not in project_ids for row in data['models']):
        raise ValueError("Out-of-scope model")


def review(data, project_ids=None):
    identity_checks(data, project_ids)
    flags = []
    def flag(code, entity, key, detail):
        flags.append({"code":code, "entity":entity, "source_key":key, "detail":detail})
    brands = {r['brand_id']:r for r in data['brands']}
    companies = {r['company_id']:r for r in data['companies']}
    types = {r['model_type_id']:r for r in data['model_types']}
    for name, (_, keys, _) in SPECS.items():
        name_field = {'projects':'project_name_th','brands':'brand_name_th','companies':'company_name_th','models':'model_name_th','model_types':'model_type_name_th'}[name]
        for row in data[name]:
            key = {k:row[k] for k in keys}
            if row['is_deleted'] is not False:
                flag('source_deleted' if row['is_deleted'] is True else 'source_status_unknown', name, key, 'Retained as evidence; not an active selection candidate.')
            if not isinstance(row[name_field], str) or not row[name_field].strip():
                flag('source_name_missing', name, key, 'Source name needs owner review; do not fabricate an imported value.')
            if row['source_modified_at'] is None:
                flag('source_modified_at_missing', name, key, 'Extraction time must not impersonate a source modification time.')
    project_summary = []
    for p in data['projects']:
        key = {'project_id':p['project_id']}
        for field, lookup in [('brand_id',brands), ('company_id',companies)]:
            if p[field] not in lookup:
                flag('source_reference_missing', 'projects', key, f'Unresolved {field}.')
        models = [r for r in data['models'] if r['project_id'] == p['project_id']]
        if not models:
            flag('models_missing', 'projects', key, 'No associated model rows returned.')
        project_summary.append({**key, 'model_count':len(models), 'not_deleted_model_count':sum(r['is_deleted'] is False for r in models), 'deleted_model_count':sum(r['is_deleted'] is True for r in models), 'unknown_status_model_count':sum(r['is_deleted'] is None for r in models), 'model_type_ids':sorted({r['model_type_id'] for r in models if r['model_type_id'] is not None}), 'raw_model_areas':sorted({r['model_area'] for r in models if r['model_area'] is not None}, key=Decimal)})
    model_reviews = []
    for m in data['models']:
        key = {'project_id':m['project_id'], 'model_id':m['model_id']}
        if m['model_type_id'] is None or not m['model_type_id'].strip():
            flag('model_type_missing', 'models', key, 'ModelTypeID is null/blank; no inferred classification.')
        elif m['model_type_id'] not in types:
            flag('model_type_unresolved', 'models', key, 'No exact matching ModelTypeID in the source dictionary.')
        elif types[m['model_type_id']]['is_deleted'] is not False:
            flag('model_type_not_active', 'models', key, 'Referenced type is deleted or its status is unknown.')
        if m['model_area'] is None or Decimal(m['model_area']) <= 0:
            flag('model_area_not_positive', 'models', key, 'Preserve raw area; do not use it as a publishable area specification.')
        model_reviews.append({**key, 'source_fingerprint':fingerprint(m), 'identity_match_method':'EXACT_SOURCE_KEY', 'match_status':'SUGGESTED', 'verified_by':None, 'verified_at':None, 'model_type_id':m['model_type_id'], 'model_area_raw':m['model_area'], 'model_area_unit':None, 'usable_area_sqm':None})
    return {
        'review_status':'automated_checks_complete_human_mapping_pending',
        'publication_authorized':False, 'hub_import_performed':False,
        'checks':{'unique_complete_keys':True, 'exact_pilot_scope':True, 'raw_nullable_deletion_flags':True, 'area_values_not_coerced_to_specifications':True},
        'project_summary':project_summary, 'flags':flags, 'model_mapping_candidates':model_reviews,
        'business_confirmations_required':['Human confirmation of every project-model mapping (REM-06).','ModelArea meaning and unit; no automatic usable_area_sqm mapping.','Source lookup labels are evidence; approved public wording and content remain separate.','Resolve source status/reference/name gaps before selection/publication; complete normal content and rights gates.'],
    }


def read_pass(conn):
    datasets = {}
    counts = {}
    timestamps = {}
    for name, (_, _, query) in SPECS.items():
        if not re.match(r'^SELECT\b', query, re.I) or re.search(r'\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|execute|exec|into)\b', query, re.I):
            raise ValueError('Only fixed SELECT queries are permitted')
        timestamps[name] = datetime.now(timezone.utc).isoformat()
        rows = conn.exec_driver_sql(query).fetchmany(10001)
        if len(rows) > 10000:
            raise ValueError('Unexpected pilot dataset size')
        datasets[name] = [{k:scalar(v) for k,v in row._mapping.items()} for row in rows]
        conn.rollback()
        count_query = 'SELECT COUNT_BIG(*) FROM (' + query.rsplit(' ORDER BY ', 1)[0] + ') AS pilot_rows'
        counts[name] = int(conn.exec_driver_sql(count_query).scalar_one())
        conn.rollback()
        if counts[name] != len(rows):
            raise ValueError(f'Source count changed during read: {name}')
    identity_checks(datasets)
    return datasets, counts, timestamps


def save_json(path, content):
    with path.open('x', encoding='utf-8', newline='\n') as handle:
        handle.write(json.dumps(content, ensure_ascii=False, indent=2, allow_nan=False) + '\n')


def verify_package(folder):
    """Offline integrity and semantic checks; no connections or approvals."""
    folder = Path(folder)
    manifest_bytes = (folder / 'manifest.json').read_bytes()
    expected_digest = (folder / 'manifest.sha256').read_text(encoding='ascii').strip()
    if expected_digest != hashlib.sha256(manifest_bytes).hexdigest() + '  manifest.json':
        raise ValueError('Manifest checksum mismatch')
    manifest = json.loads(manifest_bytes)
    if manifest.get('contract') != 'sena_hub_residential_intake_review' or manifest.get('contract_version') != 1:
        raise ValueError('Unknown review package contract')
    if manifest['source_instance'] != 'SENA_PRD' or manifest['verified_source_context']['database_name'] != 'SENA_PRD':
        raise ValueError('Unexpected source database')
    project_ids = set(manifest['requested_project_ids'])
    if project_ids not in (PILOT_IDS, HISTORICAL_PILOT_IDS) or manifest['hub_import_performed'] is not False or manifest['human_mappings_confirmed'] is not False:
        raise ValueError('Unexpected scope or approval state')
    expected_files = {f'{name}.json' for name in SPECS} | {'review.json', 'queries.sql'}
    if set(manifest['files']) != expected_files or set(manifest['datasets']) != set(SPECS):
        raise ValueError('Unexpected package file/dataset set')
    for filename, info in manifest['files'].items():
        content = (folder / filename).read_bytes()
        if hashlib.sha256(content).hexdigest() != info['sha256'] or len(content) != info['bytes']:
            raise ValueError(f'File integrity mismatch: {filename}')
    data = {}
    for name, (relation, keys, _) in SPECS.items():
        dataset = json.loads((folder / f'{name}.json').read_text(encoding='utf-8'))
        info = manifest['datasets'][name]
        if dataset['source_relation'] != relation or dataset['primary_key'] != list(keys):
            raise ValueError(f'Source contract mismatch: {name}')
        if info['file'] != f'{name}.json' or info['source_relation'] != relation or info['primary_key'] != list(keys):
            raise ValueError(f'Manifest source contract mismatch: {name}')
        rows = dataset['rows']
        if any(info[k] != len(rows) for k in ('row_count','source_count_first_pass','source_count_second_pass')):
            raise ValueError(f'Source row count mismatch: {name}')
        if dataset['source_snapshot_at'] != manifest['second_pass_read_times_utc'][name]:
            raise ValueError(f'Extraction timestamp mismatch: {name}')
        if any(row['source_fingerprint'] != fingerprint(row['record']) for row in rows):
            raise ValueError(f'Row fingerprint mismatch: {name}')
        data[name] = [row['record'] for row in rows]
    if manifest['complete_read_fingerprints'] != [fingerprint(data), fingerprint(data)]:
        raise ValueError('Complete-read fingerprint mismatch')
    if json.loads((folder / 'review.json').read_text(encoding='utf-8')) != review(data, project_ids):
        raise ValueError('Review flags or human mapping state mismatch')
    return {name:len(rows) for name, rows in data.items()}


def main():
    import dlt
    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url
    started = datetime.now(timezone.utc)
    engine = None
    try:
        dw_root = ROOT.parent / 'sena_idea_mkt_data_warehouse'
        if Path.cwd().resolve() != dw_root.resolve():
            raise ValueError('Run from the existing sibling DW repository')
        revision = subprocess.run(['git','-c',f'safe.directory={dw_root.as_posix()}','-C',str(dw_root),'rev-parse','HEAD'], capture_output=True, text=True, check=True).stdout.strip()
        if not re.fullmatch(r'[0-9a-f]{40}', revision):
            raise ValueError('Unverified DW checkout revision')
        reference_files = ['ingestion/project_dimension_contract.py', 'ingestion/unit_dimension_contract.py', 'transformation/models/marts/rem/dim_unit.sql', 'transformation/models/staging/rem/stg_rem__project_models.sql']
        reference_hashes = {name:hashlib.sha256((dw_root / name).read_bytes()).hexdigest() for name in reference_files}
        tree = ast.parse((dw_root / reference_files[0]).read_text(encoding='utf-8'))
        versions = [ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'CONTRACT_VERSION' for t in node.targets)]
        if len(versions) != 1 or type(versions[0]) is not int:
            raise ValueError('Unverified DW contract version')
        url = make_url(dlt.secrets['sources.rem.url']).update_query_dict({'ApplicationIntent':'ReadOnly'})
        engine = create_engine(url, connect_args={'timeout':8}, echo=False)
        with engine.connect() as conn:
            conn.connection.driver_connection.timeout = 20
            context_query = 'SELECT DB_NAME() AS database_name, snapshot_isolation_state_desc, is_read_committed_snapshot_on FROM sys.databases WHERE database_id=DB_ID()'
            source_context = dict(conn.exec_driver_sql(context_query).mappings().one())
            conn.rollback()
            if source_context['database_name'] != 'SENA_PRD' or url.database != source_context['database_name']:
                raise ValueError('Connected REM database does not match the expected source')
            first, first_counts, first_times = read_pass(conn)
            second, second_counts, second_times = read_pass(conn)
        if fingerprint(first) != fingerprint(second) or first_counts != second_counts:
            raise ValueError('Source changed between complete reads; retry a new extraction')
        analysis = review(second)
        completed = datetime.now(timezone.utc)
        batch = completed.strftime('%Y%m%dT%H%M%S%fZ') + '_' + '_'.join(sorted(PILOT_IDS))
        output = OUTPUT / batch
        output.mkdir(parents=True, exist_ok=False)
        manifest = {
            'contract':'sena_hub_residential_intake_review', 'contract_version':1,
            'package_status':'prepared_for_review', 'source_system':'REM', 'source_instance':source_context['database_name'],
            'verified_source_context':source_context,
            'source_connection_identity_sha256':fingerprint({'driver':url.drivername,'host':url.host,'port':url.port,'database':url.database}),
            'access_path':'direct_read_only_REM_using_existing_DW_connection',
            'dw_connection_status':'desktop_read_only_credential_unavailable; existing_tunnel_reachable',
            'dw_relay_contract_compatible':False, 'dw_repository_commit':revision, 'dw_project_contract_version':versions[0],
            'dw_reference_file_sha256':reference_hashes,
            'requested_project_ids':sorted(PILOT_IDS), 'project_scope_authority':'User selected HYABC only, replacing KUBON and B_PO, 2026-09-18',
            'extraction_started_at_utc':started.isoformat(), 'extraction_completed_at_utc':completed.isoformat(),
            'source_datetime_timezone':'unverified; raw source values are not converted',
            'consistency':'Two identical complete SELECT passes with independent row-count checks; not a transactionally atomic point-in-time snapshot.',
            'complete_read_fingerprints':[fingerprint(first),fingerprint(second)],
            'first_pass_read_times_utc':first_times, 'second_pass_read_times_utc':second_times,
            'source_writes_performed':False, 'hub_import_performed':False, 'human_mappings_confirmed':False,
            'fingerprint_encoding':'SHA-256 of UTF-8 JSON; sorted keys; compact separators; decimal values encoded as exact strings; source datetimes ISO8601 without invented timezone.',
            'datasets':{}, 'files':{},
        }
        for name, (relation, keys, query) in SPECS.items():
            filename = f'{name}.json'
            save_json(output / filename, {'source_relation':relation, 'source_snapshot_at':second_times[name], 'primary_key':keys, 'rows':[{'record':row, 'source_fingerprint':fingerprint(row)} for row in second[name]]})
            manifest['datasets'][name] = {'file':filename, 'source_relation':relation, 'primary_key':keys, 'row_count':len(second[name]), 'source_count_first_pass':first_counts[name], 'source_count_second_pass':second_counts[name]}
        save_json(output / 'review.json', analysis)
        with (output / 'queries.sql').open('x', encoding='utf-8', newline='\n') as handle:
            handle.write('-- source_context\n' + context_query + ';\n\n' + '\n\n'.join(f'-- {name}\n{query};' for name,(_,_,query) in SPECS.items()) + '\n')
        for path in sorted(output.iterdir()):
            manifest['files'][path.name] = {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes':path.stat().st_size}
        save_json(output / 'manifest.json', manifest)  # Last file: incomplete extractions have no manifest.
        digest = hashlib.sha256((output / 'manifest.json').read_bytes()).hexdigest()
        with (output / 'manifest.sha256').open('x', encoding='ascii', newline='\n') as handle:
            handle.write(digest + '  manifest.json\n')
        print(json.dumps({'status':'prepared_for_review', 'output':str(output), 'counts':second_counts, 'project_summary':analysis['project_summary'], 'review_flag_count':len(analysis['flags'])}))
    except Exception as exc:
        original = getattr(exc,'orig',None)
        args = getattr(original,'args',())
        state = args[0] if args and re.fullmatch(r'[A-Z0-9]{5}',str(args[0])) else None
        # Never print raw driver errors, SQL connection URLs or credential values.
        print(json.dumps({'status':'not_prepared', 'error_type':type(exc).__name__, 'sqlstate':state, 'validation_error':str(exc) if type(exc) is ValueError else None}))
        return 1
    finally:
        if engine is not None:
            engine.dispose()
    return 0


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--verify':
        print(json.dumps({'status':'verified_offline', 'counts':verify_package(sys.argv[2])}))
    elif len(sys.argv) == 1:
        sys.exit(main())
    else:
        sys.exit('Usage: prepare-pilot-intake.py [--verify PACKAGE_DIRECTORY]')
