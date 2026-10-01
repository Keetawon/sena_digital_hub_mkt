"""Closed synthetic DW P3 read-back contract; pure validation, no DB or network."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import re
from uuid import UUID

CONTRACT = "hub-p3-test-v1"
SCHEMA = {'dim_media_line': (('environment', 'text'),
                    ('contract_version', 'text'),
                    ('snapshot_id', 'text'),
                    ('snapshot_at', 'timestamp with time zone'),
                    ('hub_snapshot_id', 'text'),
                    ('hub_source_snapshot_at', 'timestamp(6) with time zone'),
                    ('effective_at', 'timestamp with time zone'),
                    ('recorded_at', 'timestamp with time zone'),
                    ('temporal_basis', 'text'),
                    ('temporal_provenance', 'jsonb'),
                    ('line_source', 'text'),
                    ('line_key', 'text'),
                    ('revision_key', 'text'),
                    ('hub_line_id', 'character varying'),
                    ('hub_revision_id', 'character varying'),
                    ('revision_no', 'bigint'),
                    ('revision_status', 'character varying'),
                    ('line_state', 'character varying'),
                    ('is_applicable', 'boolean'),
                    ('archived_at', 'timestamp(6) with time zone'),
                    ('kind', 'character varying'),
                    ('scope_id', 'character varying'),
                    ('scope_code', 'character varying'),
                    ('agency', 'character varying'),
                    ('month', 'date'),
                    ('program_ref', 'character varying'),
                    ('period_start_month', 'date'),
                    ('period_end_month', 'date'),
                    ('permitted_scope_ids', 'jsonb'),
                    ('permitted_agencies', 'jsonb'),
                    ('components', 'jsonb'),
                    ('approved_gross', 'numeric'),
                    ('approved_media', 'numeric'),
                    ('approved_fee', 'numeric'),
                    ('budget_basis', 'text'),
                    ('typed_budget_complete', 'boolean'),
                    ('source_updated_at', 'timestamp with time zone'),
                    ('quality_codes', 'text[]')),
 'bridge_native_campaign_media_line': (('environment', 'text'),
                                       ('contract_version', 'text'),
                                       ('snapshot_id', 'text'),
                                       ('snapshot_at', 'timestamp with time zone'),
                                       ('hub_snapshot_id', 'text'),
                                       ('hub_source_snapshot_at', 'timestamp(6) with time zone'),
                                       ('effective_at', 'timestamp with time zone'),
                                       ('recorded_at', 'timestamp with time zone'),
                                       ('temporal_basis', 'text'),
                                       ('temporal_provenance', 'jsonb'),
                                       ('platform', 'character varying'),
                                       ('account_id', 'character varying'),
                                       ('campaign_id', 'character varying'),
                                       ('month', 'date'),
                                       ('line_source', 'text'),
                                       ('line_key', 'text'),
                                       ('revision_key', 'text'),
                                       ('observed_code', 'text'),
                                       ('observed_name', 'text'),
                                       ('registration_code', 'character varying'),
                                       ('name_id', 'character varying'),
                                       ('scope_id', 'character varying'),
                                       ('agency', 'character varying'),
                                       ('match_method', 'text'),
                                       ('candidate_method', 'text'),
                                       ('assignment_id', 'character varying'),
                                       ('binding_name_id', 'character varying'),
                                       ('correction_target_id', 'character varying'),
                                       ('candidate_line_keys', 'text[]'),
                                       ('conflict_codes', 'text[]'),
                                       ('unresolved_reason', 'text'),
                                       ('name_conformance', 'text'),
                                       ('parser_version', 'text'),
                                       ('match_rule_version', 'text'),
                                       ('platform_source_snapshot_at', 'timestamp with time zone'),
                                       ('observed_at', 'timestamp with time zone'),
                                       ('source_kind', 'text'),
                                       ('source_record_refs', 'jsonb')),
 'fact_media_line_monthly': (('environment', 'text'),
                             ('contract_version', 'text'),
                             ('snapshot_id', 'text'),
                             ('snapshot_at', 'timestamp with time zone'),
                             ('hub_snapshot_id', 'text'),
                             ('hub_source_snapshot_at', 'timestamp(6) with time zone'),
                             ('effective_at', 'timestamp with time zone'),
                             ('recorded_at', 'timestamp with time zone'),
                             ('temporal_basis', 'text'),
                             ('temporal_provenance', 'jsonb'),
                             ('line_source', 'text'),
                             ('line_key', 'text'),
                             ('revision_key', 'text'),
                             ('month', 'date'),
                             ('budget_basis', 'text'),
                             ('approved_month_gross', 'numeric'),
                             ('approved_month_media', 'numeric'),
                             ('typed_budget_complete', 'boolean'),
                             ('platform_media_spend', 'numeric'),
                             ('platform_spend_basis', 'text'),
                             ('platform_data_through', 'timestamp with time zone'),
                             ('attributed_leads', 'bigint'),
                             ('lead_definition_version', 'text'),
                             ('leads_data_through', 'timestamp with time zone'),
                             ('media_budget_used_pct', 'numeric'),
                             ('media_cpl', 'numeric'),
                             ('comparison_reason', 'text'),
                             ('campaign_count', 'bigint'),
                             ('unresolved_context_count', 'bigint'),
                             ('card_cash_by_type', 'jsonb'),
                             ('card_monthly_by_type', 'jsonb'),
                             ('financial_components', 'jsonb'),
                             ('quality_codes', 'text[]'),
                             ('platform_source_snapshot_at', 'timestamp with time zone'),
                             ('rem_source_snapshot_at', 'timestamp with time zone')),
 'fact_marketing_ops_finding': (('environment', 'text'),
                                ('contract_version', 'text'),
                                ('snapshot_id', 'text'),
                                ('snapshot_at', 'timestamp with time zone'),
                                ('hub_snapshot_id', 'text'),
                                ('hub_source_snapshot_at', 'timestamp(6) with time zone'),
                                ('effective_at', 'timestamp with time zone'),
                                ('recorded_at', 'timestamp with time zone'),
                                ('temporal_basis', 'text'),
                                ('temporal_provenance', 'jsonb'),
                                ('finding_key', 'text'),
                                ('control_code', 'text'),
                                ('rule_code', 'text'),
                                ('rule_version', 'text'),
                                ('subject_kind', 'text'),
                                ('subject_key', 'text'),
                                ('month', 'date'),
                                ('line_source', 'text'),
                                ('line_key', 'text'),
                                ('platform', 'character varying'),
                                ('account_id', 'character varying'),
                                ('campaign_id', 'character varying'),
                                ('registration_code', 'character varying'),
                                ('agency', 'character varying'),
                                ('condition_present', 'boolean'),
                                ('evaluation_status', 'text'),
                                ('severity', 'text'),
                                ('first_observed_at', 'timestamp with time zone'),
                                ('last_observed_at', 'timestamp with time zone'),
                                ('cleared_at', 'timestamp with time zone'),
                                ('expected', 'jsonb'),
                                ('observed', 'jsonb'),
                                ('context_refs', 'jsonb'),
                                ('suggested_owner_role', 'text'),
                                ('match_method', 'text'),
                                ('source_snapshot_at', 'timestamp with time zone'))}
KEYS = {'dim_media_line': ('line_source', 'line_key', 'revision_key'),
 'bridge_native_campaign_media_line': ('platform', 'account_id', 'campaign_id', 'month'),
 'fact_media_line_monthly': ('line_source', 'line_key', 'month'),
        'fact_marketing_ops_finding': ('finding_key',)}

MANIFEST_FIELDS = set('environment contract_version snapshot_id snapshot_at hub_snapshot_id hub_source_snapshot_at synthetic_only exported_at hub_source_commit hub_fixture_commit hub_design_commit hub_migration_checksums covered_month_from covered_month_to hub_operating_from_month operating_boundary_status cadence proposal_status parser_version match_rule_version lead_definition_version platform_source_snapshot_at rem_source_snapshot_at relations control_totals'.split())
NULLABLE = {
    'dim_media_line': set('effective_at archived_at scope_id scope_code agency month program_ref period_start_month period_end_month approved_gross approved_media approved_fee'.split()),
    'bridge_native_campaign_media_line': set('effective_at line_source line_key revision_key observed_code observed_name observed_at registration_code name_id scope_id agency candidate_method assignment_id binding_name_id correction_target_id unresolved_reason'.split()),
    'fact_media_line_monthly': set('effective_at approved_month_gross approved_month_media platform_media_spend platform_data_through attributed_leads lead_definition_version leads_data_through media_budget_used_pct media_cpl comparison_reason platform_source_snapshot_at rem_source_snapshot_at'.split()),
    'fact_marketing_ops_finding': set('effective_at line_source line_key platform account_id campaign_id registration_code agency condition_present first_observed_at last_observed_at cleared_at'.split()),
}
METHODS = {'CODE', 'HUB_NATIVE_ID', 'SCOPE_MONTH_AGENCY', 'APPLIED_CORRECTION', 'UNRESOLVED'}
COST_TYPES = {'MEDIA', 'AGENCY_FEE', 'CHANNEL', 'TOOL', 'BANK_FEE'}
PAYMENT_METHODS = {'CORPORATE_CARD', 'AGENCY_PO_INVOICE', 'PLATFORM_INVOICE', 'BANK_TRANSFER'}
UUID_FIELDS = set('snapshot_id hub_snapshot_id hub_line_id hub_revision_id line_key revision_key scope_id name_id assignment_id binding_name_id correction_target_id'.split())


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _object(value, keys, label):
    _require(isinstance(value, dict) and set(value) == set(keys), label + ': unexpected fields')


def _text(value, label, *, nullable=False):
    if value is None and nullable:
        return
    _require(isinstance(value, str) and bool(value.strip()) and len(value) <= 4096
             and not any(ord(c) < 32 for c in value), label + ': lossless nonempty text required')


def _uuid(value, label):
    _text(value, label)
    try:
        _require(str(UUID(value)) == value, label + ': canonical UUID text required')
    except (ValueError, AttributeError):
        raise ValueError(label + ': canonical UUID text required') from None


def _timestamp(value, label):
    _text(value, label)
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        _require('T' in value and result.tzinfo is not None and result.utcoffset() is not None,
                 label + ': explicit timestamp offset required')
        return result
    except ValueError:
        raise ValueError(label + ': explicit timestamp offset required') from None


def _month(value, label):
    _text(value, label)
    try:
        parsed = date.fromisoformat(value)
        _require(parsed.isoformat() == value and parsed.day == 1, label + ': first-day month required')
        return parsed
    except ValueError:
        raise ValueError(label + ': first-day month required') from None


def _money(value, label, *, signed=False, percentage=False):
    _require(isinstance(value, str) and re.fullmatch(r'-?(?:0|[1-9][0-9]*)\.[0-9]{2}', value) is not None,
             label + ': exact two-place decimal string required')
    number = Decimal(value)
    limit = Decimal('10000000') if percentage else Decimal('1000000000000')
    _require(abs(number) < limit and (signed or number >= 0), label + ': amount outside numeric precision')
    return number


def _strings(value, label, *, uuids=False):
    _require(isinstance(value, list), label + ': array required')
    for item in value:
        (_uuid if uuids else _text)(item, label)
    _require(len(set(value)) == len(value), label + ': duplicate array members')


def _refs(value):
    _require(isinstance(value, list), 'source_record_refs: array required')
    for item in value:
        _object(item, 'source_key relation record_key source_batch_id source_field'.split(), 'source reference')
        for field, entry in item.items():
            _text(entry, 'source reference.' + field, nullable=field == 'source_field')


def _components(value):
    _require(isinstance(value, list) and bool(value), 'financial components: nonempty array required')
    ids = []
    for item in value:
        _object(item, 'component_id component_kind rem_project_id formatted_mapping bud gross_amount media_amount fee_amount memo_id fee_po_ref budget_items'.split(), 'financial component')
        _uuid(item['component_id'], 'component_id')
        ids.append(item['component_id'])
        for field in ('component_kind', 'bud'):
            _text(item[field], field)
        for field in ('rem_project_id', 'formatted_mapping', 'memo_id', 'fee_po_ref'):
            _text(item[field], field, nullable=True)
        for field in ('gross_amount', 'media_amount', 'fee_amount'):
            if item[field] is not None:
                _money(item[field], field)
            else:
                _require(field != 'gross_amount', 'gross_amount cannot be null')
        budgets = item['budget_items']
        _require(isinstance(budgets, list), 'budget_items: array required')
        budget_ids = []
        for budget in budgets:
            _object(budget, ('id', 'cost_type', 'payment_method', 'amount'), 'budget item')
            _uuid(budget['id'], 'budget item ID')
            budget_ids.append(budget['id'])
            _require(budget['cost_type'] in COST_TYPES and budget['payment_method'] in PAYMENT_METHODS,
                     'Invalid typed budget item')
            _money(budget['amount'], 'budget item.amount')
        _require(len(set(budget_ids)) == len(budget_ids), 'Duplicate budget item')
    _require(ids == sorted(set(ids)), 'Financial components must have unique sorted IDs')


def _json_field(field, value):
    if field in {'permitted_scope_ids', 'permitted_agencies', 'quality_codes', 'candidate_line_keys', 'conflict_codes'}:
        _strings(value, field, uuids=field in {'permitted_scope_ids', 'candidate_line_keys'})
    elif field in {'components', 'financial_components'}:
        _components(value)
    elif field in {'card_cash_by_type', 'card_monthly_by_type'}:
        _require(isinstance(value, list), field + ': array required')
        keys = []
        for item in value:
            _object(item, ('cost_type', 'payment_method', 'amount', 'cost_count'), field)
            _require(item['cost_type'] in COST_TYPES and item['payment_method'] in PAYMENT_METHODS, 'Invalid cost basis')
            _money(item['amount'], field + '.amount', signed=True)
            _require(type(item['cost_count']) is int and item['cost_count'] >= 0, 'Invalid cost count')
            keys.append((item['cost_type'], item['payment_method']))
        _require(len(set(keys)) == len(keys), 'Duplicate cost type/payment pair')
    elif field == 'source_record_refs':
        _refs(value)
    elif field == 'temporal_provenance':
        _object(value, 'source_kind source_record_refs source_field source_snapshot_at effective_time_evidence_ref'.split(), field)
        _refs(value['source_record_refs'])
        _timestamp(value['source_snapshot_at'], field + '.source_snapshot_at')
        _text(value['source_kind'], field + '.source_kind')
        for name in ('source_field', 'effective_time_evidence_ref'):
            _text(value[name], field + '.' + name, nullable=True)
    elif field == 'expected':
        _object(value, ('agency', 'bound_code', 'line_key', 'registration_code', 'scope_code'), field)
        for name, entry in value.items():
            _text(entry, field + '.' + name, nullable=True)
    elif field == 'observed':
        _object(value, 'evidence_status observed_at observed_code observed_name parser_version reason_code source_kind source_record_refs source_snapshot_at'.split(), field)
        _require(value['evidence_status'] in {'AVAILABLE', 'MISSING', 'STALE'}, 'Invalid evidence status')
        _refs(value['source_record_refs'])
        _timestamp(value['source_snapshot_at'], field + '.source_snapshot_at')
        if value['observed_at'] is not None:
            _timestamp(value['observed_at'], field + '.observed_at')
        for name in ('observed_code', 'observed_name', 'reason_code'):
            if value[name] != '':
                _text(value[name], field + '.' + name, nullable=True)
        for name in ('parser_version', 'source_kind'):
            _text(value[name], field + '.' + name)
    elif field == 'context_refs':
        _object(value, ('assignment_id', 'hub_batch_id', 'unresolved_reason'), field)
        for name, entry in value.items():
            _text(entry, field + '.' + name, nullable=name != 'hub_batch_id')
    else:
        raise ValueError('Unknown JSON field')


def _controls(value):
    _object(value, 'platform_resolved platform_unresolved card_cash card_monthly currency additive_across_bases platform_coverage_complete coverage_by_basis'.split(), 'control_totals')
    _require(value['currency'] == 'THB' and value['additive_across_bases'] is False
             and type(value['platform_coverage_complete']) is bool, 'Invalid accounting controls')
    for name in ('platform_resolved', 'platform_unresolved'):
        _money(value[name], name)
    for name in ('card_cash', 'card_monthly'):
        _object(value[name], ('assigned', 'unassigned'), name)
        for amount in value[name].values():
            _money(amount, name, signed=True)
    _object(value['coverage_by_basis'], ('platform', 'card_cash', 'card_monthly'), 'coverage_by_basis')
    for coverage in value['coverage_by_basis'].values():
        _object(coverage, ('covered_months', 'covered_month_from', 'covered_month_to'), 'basis coverage')
        months = coverage['covered_months']
        _strings(months, 'covered_months')
        for month in months:
            _month(month, 'covered_months')
        _require(bool(months) and months == sorted(months)
                 and coverage['covered_month_from'] == months[0] and coverage['covered_month_to'] == months[-1],
                 'Basis coverage boundaries differ from exact months')


@dataclass(frozen=True)
class ActualsPackage:
    manifest: dict
    relations: dict[str, list[dict]]
    fingerprint: str
    manifest_sha256: str

    def summary(self):
        return {'environment': 'test', 'demo': True, 'snapshot_id': self.manifest['snapshot_id'],
                'snapshot_at': self.manifest['snapshot_at'], 'fingerprint': self.fingerprint,
                'row_counts': {name: len(rows) for name, rows in self.relations.items()},
                'source_watermarks_are_synthetic': True}


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def _load_json(raw):
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON number')))
    except (UnicodeError, json.JSONDecodeError):
        raise ValueError('Invalid UTF-8 JSON package') from None


def validate_package(directory: Path) -> ActualsPackage:
    try:
        return _validate_package(directory)
    except (TypeError, KeyError, AttributeError, IndexError) as error:
        raise ValueError('Malformed TEST-v1 package shape') from None


def _validate_package(directory: Path) -> ActualsPackage:
    """Validate exact bytes and the closed TEST-v1 business contract, without writes."""
    directory = Path(directory)
    expected_files = {'manifest.json', *(name + '.json' for name in SCHEMA)}
    _require({path.name for path in directory.glob('*.json')} == expected_files, 'Complete manifest and four JSON arrays required')
    _require(not any((directory / name).is_symlink() for name in expected_files), 'Package symlinks are not permitted')
    manifest_raw = (directory / 'manifest.json').read_bytes()
    manifest = _load_json(manifest_raw)
    _object(manifest, MANIFEST_FIELDS, 'manifest')
    _require(manifest['environment'] == 'test' and manifest['contract_version'] == CONTRACT
             and manifest['synthetic_only'] is True, 'Only synthetic TEST-v1 packages are accepted')
    _require(manifest['hub_operating_from_month'] is None and manifest['cadence'] is None
             and manifest['operating_boundary_status'] == 'PROPOSED_NOT_ACTIVATED'
             and manifest['proposal_status'] == 'TEST_IMPLEMENTED_PRODUCTION_UNAPPROVED', 'Production defaults cannot be activated by import')
    for field in ('snapshot_id', 'hub_snapshot_id'):
        _uuid(manifest[field], field)
    for field in ('snapshot_at', 'exported_at', 'hub_source_snapshot_at', 'platform_source_snapshot_at', 'rem_source_snapshot_at'):
        _timestamp(manifest[field], field)
    _require(_timestamp(manifest['exported_at'], 'exported_at') >= _timestamp(manifest['snapshot_at'], 'snapshot_at'), 'Export precedes completed computation')
    for field in ('covered_month_from', 'covered_month_to'):
        _month(manifest[field], field)
    _require(manifest['covered_month_from'] <= manifest['covered_month_to'], 'Invalid covered period')
    for field in ('hub_source_commit', 'hub_fixture_commit', 'hub_design_commit'):
        _require(isinstance(manifest[field], str) and re.fullmatch('[0-9a-f]{40}', manifest[field]) is not None, 'Invalid source commit')
    for field in ('parser_version', 'match_rule_version', 'lead_definition_version'):
        _text(manifest[field], field)
    migrations = manifest['hub_migration_checksums']
    _require(isinstance(migrations, list) and bool(migrations), 'Migration provenance is required')
    for item in migrations:
        _object(item, ('file', 'sha256', 'normalized_lf_sha256'), 'migration provenance')
        _require(re.fullmatch(r'[0-9]{12}_[a-z0-9_]+\.sql', item['file']) is not None, 'Invalid migration filename')
        for field in ('sha256', 'normalized_lf_sha256'):
            _require(isinstance(item[field], str) and re.fullmatch('[0-9a-f]{64}', item[field]) is not None, 'Invalid migration checksum')
    _require(len({item['file'] for item in migrations}) == len(migrations), 'Duplicate migration provenance')
    _controls(manifest['control_totals'])
    entries = manifest['relations']
    _require(isinstance(entries, list) and len(entries) == 4, 'Four relation entries required')
    relations = {}
    for entry in entries:
        _object(entry, ('relation', 'file', 'columns', 'primary_key', 'row_count', 'file_sha256', 'snapshot_at'), 'relation manifest')
        name = entry['relation']
        _require(isinstance(name, str) and name in SCHEMA and name not in relations, 'Unknown or duplicate relation')
        _require(entry['file'] == name + '.json' and entry['primary_key'] == list(KEYS[name]), 'Invalid relation file or key')
        _require(entry['snapshot_at'] == manifest['snapshot_at'], 'Mixed relation snapshot')
        expected_columns = [{'name': column, 'type': dtype, 'nullable': True} for column, dtype in SCHEMA[name]]
        _require(entry['columns'] == expected_columns and all(type(column['nullable']) is bool for column in entry['columns']), 'Changed ordered relation schema')
        raw = (directory / entry['file']).read_bytes()
        _require(hashlib.sha256(raw).hexdigest() == entry['file_sha256'], 'Relation checksum mismatch')
        rows = _load_json(raw)
        _require(type(entry['row_count']) is int and isinstance(rows, list) and len(rows) == entry['row_count'], 'Relation row count mismatch')
        keys = set()
        for row in rows:
            _object(row, [column for column, _ in SCHEMA[name]], name)
            for field, dtype in SCHEMA[name]:
                value = row[field]
                if value is None:
                    _require(field in NULLABLE[name], name + '.' + field + ': null is not permitted')
                    continue
                if dtype.startswith('timestamp'):
                    _timestamp(value, field)
                elif dtype == 'date':
                    _month(value, field)
                elif dtype == 'numeric':
                    _money(value, field, percentage=field == 'media_budget_used_pct')
                elif dtype == 'bigint':
                    _require(type(value) is int and 0 <= value < 2**63, field + ': nonnegative integer required')
                elif dtype == 'boolean':
                    _require(type(value) is bool, field + ': boolean required')
                elif dtype in {'jsonb', 'text[]'}:
                    _json_field(field, value)
                else:
                    if field == 'observed_name' and value == '':
                        continue  # Empty literal source name is evidence, not a replacement name.
                    (_uuid if field in UUID_FIELDS else _text)(value, field)
            for field in ('environment', 'contract_version', 'snapshot_id', 'snapshot_at', 'hub_snapshot_id', 'hub_source_snapshot_at'):
                _require(row[field] == manifest[field], 'Mixed row generation or environment')
            _require(_timestamp(row['recorded_at'], 'recorded_at') <= _timestamp(manifest['snapshot_at'], 'snapshot_at')
                     and row['temporal_basis'] == 'SNAPSHOT_ONLY'
                     and row['effective_at'] is None, 'TEST-v1 must preserve unavailable effective time')
            if 'match_method' in row:
                _require(row['match_method'] in METHODS, 'Invalid match method')
            if 'candidate_method' in row:
                _require(row['candidate_method'] is None or row['candidate_method'] in METHODS, 'Invalid candidate method')
            key = tuple(row[field] for field in KEYS[name])
            _require(all(value is not None for value in key) and key not in keys, 'Null or duplicate relation key')
            keys.add(key)
        relations[name] = rows
    _validate_relationships(manifest, relations)
    digest = hashlib.sha256(canonical({'manifest': manifest, 'relations': relations})).hexdigest()
    return ActualsPackage(manifest, relations, digest, hashlib.sha256(manifest_raw).hexdigest())


def _validate_relationships(manifest, relations):
    dimensions = relations['dim_media_line']
    _require(bool(dimensions), 'Empty dimension cannot replace the last good TEST snapshot')
    index = {(row['line_source'], row['line_key'], row['revision_key']): row for row in dimensions}
    applicable = set()
    for row in dimensions:
        _require(row['line_source'] == 'hub' and row['hub_line_id'] == row['line_key']
                 and row['hub_revision_id'] == row['revision_key'], 'Dimension identity differs from Hub source')
        _require(row['budget_basis'] in {'MONTH', 'PERIOD'}, 'Invalid budget basis')
        if row['budget_basis'] == 'MONTH':
            _require(row['month'] is not None and row['period_start_month'] is None and row['period_end_month'] is None, 'Monthly line has period fields')
        else:
            _require(row['month'] is None and row['period_start_month'] is not None and row['period_end_month'] is not None
                     and row['period_start_month'] <= row['period_end_month'], 'Invalid corporate/BU period')
        if row['is_applicable']:
            _require(row['line_key'] not in applicable and row['revision_status'] == 'APPROVED'
                     and row['line_state'] == 'ACTIVE', 'Multiple or ineligible applicable revisions')
            applicable.add(row['line_key'])
            _require(row['approved_gross'] is not None and Decimal(row['approved_gross']) == sum(Decimal(c['gross_amount']) for c in row['components']), 'Applicable component budget mismatch')
        else:
            _require(all(row[field] is None for field in ('approved_gross', 'approved_media', 'approved_fee')), 'Inapplicable revision contributes budget')
        complete = all(component['budget_items'] and sum(Decimal(item['amount']) for item in component['budget_items'])
                       == Decimal(component['gross_amount']) for component in row['components'])
        _require(row['typed_budget_complete'] == complete, 'Typed budget completeness mismatch')
        if row['is_applicable']:
            media = sum(Decimal(item['amount']) for component in row['components'] for item in component['budget_items'] if item['cost_type'] == 'MEDIA') if complete else None
            fee = sum(Decimal(item['amount']) for component in row['components'] for item in component['budget_items'] if item['cost_type'] == 'AGENCY_FEE') if complete else None
            if not complete and all(component['media_amount'] is not None and component['fee_amount'] is not None
                                    and Decimal(component['media_amount']) + Decimal(component['fee_amount']) == Decimal(component['gross_amount']) for component in row['components']):
                fee = sum(Decimal(component['fee_amount']) for component in row['components'])
            _require((Decimal(row['approved_media']) if row['approved_media'] is not None else None) == media
                     and (Decimal(row['approved_fee']) if row['approved_fee'] is not None else None) == fee,
                     'Typed media/fee budget mismatch')
    for name in ('bridge_native_campaign_media_line', 'fact_media_line_monthly'):
        for row in relations[name]:
            key = tuple(row[field] for field in ('line_source', 'line_key', 'revision_key'))
            if row['line_key'] is None:
                _require(name == 'bridge_native_campaign_media_line' and all(value is None for value in key)
                         and row['match_method'] == 'UNRESOLVED', 'Unresolved target must remain null')
                continue
            _require(key in index and index[key]['is_applicable'], 'Unknown or inapplicable dimension reference')
            if name == 'bridge_native_campaign_media_line':
                _require(row['match_method'] != 'UNRESOLVED' and row['assignment_id'] is not None, 'Resolved target requires explicit assignment')
                continue
            dimension = index[key]
            _require(row['budget_basis'] == dimension['budget_basis'] and row['financial_components'] == dimension['components']
                     and row['typed_budget_complete'] == dimension['typed_budget_complete'], 'Monthly dimension context mismatch')
            if row['budget_basis'] == 'PERIOD':
                _require(all(row[field] is None for field in ('approved_month_gross', 'approved_month_media', 'media_budget_used_pct')), 'Period budget must not repeat monthly')
            else:
                _require(row['month'] == dimension['month'] and row['approved_month_gross'] == dimension['approved_gross']
                         and row['approved_month_media'] == dimension['approved_media'], 'Monthly budget mismatch')
            comparable = (row['budget_basis'] == 'MONTH' and row['typed_budget_complete']
                          and row['approved_month_media'] is not None and Decimal(row['approved_month_media']) > 0
                          and row['platform_media_spend'] is not None)
            if comparable:
                expected_pct = (Decimal(row['platform_media_spend']) / Decimal(row['approved_month_media']) * 100).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
                _require(row['media_budget_used_pct'] is not None and Decimal(row['media_budget_used_pct']) == expected_pct, 'Budget-used percentage mismatch')
            else:
                _require(row['media_budget_used_pct'] is None, 'Unavailable comparison must remain null')
            if row['media_cpl'] is not None:
                _require(row['platform_media_spend'] is not None and row['attributed_leads'] is not None and row['attributed_leads'] > 0, 'CPL has incomplete evidence')
                expected = (Decimal(row['platform_media_spend']) / row['attributed_leads']).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
                _require(Decimal(row['media_cpl']) == expected, 'CPL arithmetic mismatch')
    for row in relations['fact_marketing_ops_finding']:
        _require(row['control_code'] in {'C5', 'C6'} and row['evaluation_status'] in {'EVALUATED', 'UNAVAILABLE'}, 'Unknown control/evaluation status')
        _require((row['evaluation_status'] == 'UNAVAILABLE') == (row['condition_present'] is None), 'Unavailable finding cannot become true or false')
        identity = ['test', 'marketing_ops', row['control_code'], row['rule_code'], row['subject_kind'], row['subject_key'], row['month']]
        _require(row['finding_key'] == hashlib.sha256(canonical(identity)).hexdigest(), 'Finding key differs from stable canonical identity')
    controls = manifest['control_totals']
    monthly = relations['fact_media_line_monthly']
    actual = sum(Decimal(row['platform_media_spend']) for row in monthly if row['platform_media_spend'] is not None)
    _require(actual == Decimal(controls['platform_resolved']), 'Resolved platform control mismatch')
    for source, field in (('card_cash', 'card_cash_by_type'), ('card_monthly', 'card_monthly_by_type')):
        total = sum(Decimal(item['amount']) for row in monthly for item in row[field])
        _require(total == Decimal(controls[source]['assigned']), 'Assigned card control mismatch')
