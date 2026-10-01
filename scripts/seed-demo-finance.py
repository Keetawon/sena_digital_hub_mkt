"""One local, synthetic October finance pack; caller owns the transaction.

Existing guarded commands own all financial mutations. Scope association is an
explicit local sample, not a newly accepted DW master. No source system is read.
"""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from uuid import UUID, uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
from sena_hub_api.actuals_import import canonical, validate_package  # noqa: E402
from sena_hub_api.document_storage import statement_rows  # noqa: E402
from sena_hub_api.document_worker import local_connection  # noqa: E402

MARKER = 'SYNTHETIC-HUB-DEMO-OCT2026-V1'
ACTOR = '00000000-0000-0000-0000-000000000061'
MONTH = '2026-10-01'
SCOPES = {'group': 'C-FLEX-STCRN', 'phase': 'C-FLEX-STCRN-HYABC', 'brand': 'BRAND-FLEXI'}
NATIVE = {key: {'platform': 'GOOGLE', 'account_id': '000-DEMO-' + key.upper(),
               'campaign_id': '000-DEMO-OCT26-' + key.upper()} for key in ('group', 'brand')}


def money(value):
    return f'{Decimal(str(value)):.2f}'


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def script_sha256():
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def package_files(manifest, relations):
    """Return the exact bytes both checked by the importer and saved after commit."""
    manifest = deepcopy(manifest)
    files = {}
    for entry in manifest['relations']:
        raw = canonical(relations[entry['relation']])
        files[entry['file']] = raw
        entry.update(row_count=len(relations[entry['relation']]), file_sha256=hashlib.sha256(raw).hexdigest(),
                     snapshot_at=manifest['snapshot_at'])
    files['manifest.json'] = canonical(manifest)
    with TemporaryDirectory(prefix='hub-finance-demo-') as temporary:
        directory = Path(temporary)
        for name, raw in files.items():
            (directory / name).write_bytes(raw)
        package = validate_package(directory)
    return package, files


async def finance(db, action, payload):
    return await db.fetchval('SELECT ads.finance_command($1,$2)', action, payload)


async def _create_scope(db, key, stamp):
    kind = {'group': 'GROUP', 'phase': 'PHASE', 'brand': 'BRAND'}[key]
    member = {'member_type': kind, 'member_id': {'group': SCOPES['group'], 'phase': 'HYABC', 'brand': '25'}[key],
              'parent_group_id': SCOPES['group'] if key == 'phase' else None}
    labels = {'group': 'HYABC DEMO', 'phase': 'HYABC DEMO PHASE', 'brand': 'FLEXI DEMO'}
    scope_id = await db.fetchval("""INSERT INTO ads.scope_code(scope_code,kind,label_th,label_en,
        parent_group_id,home_bud,member_signature,status,source_snapshot,source_fingerprint,created_by)
        VALUES($1,$2,$3,$4,$5,'C1',ads.scope_signature($6),'ACTIVE',$7,$8,$9) RETURNING scope_id""",
        SCOPES[key], kind, 'ตัวอย่างสังเคราะห์ ' + labels[key], labels[key], member['parent_group_id'],
        [member], stamp, MARKER, UUID(ACTOR))
    await db.execute("""INSERT INTO ads.scope_member(scope_id,member_type,member_id,parent_group_id,source_snapshot)
        VALUES($1,$2,$3,$4,$5)""", scope_id, kind, member['member_id'], member['parent_group_id'], stamp)
    return str(scope_id)


async def _memo(db, number, subject, bud, amount):
    memo = await finance(db, 'memo_create', {'memo_no': number, 'subject': subject, 'requesting_bud': bud,
        'gross_amount': amount, 'mirrored_status': 'APPROVED', 'approval_date': MONTH, 'evidence_ref': MARKER})
    return await finance(db, 'memo_confirm', {'id': memo['id'], 'expected_version': memo['row_version']})


async def _batch(db, suffix, rows, classifications):
    prior = suffix == 'SEPT-REFUND-ORIGIN'
    statement = await finance(db, 'statement_create', {'operator_ref': MARKER + ':' + suffix,
        'issuer': 'SYNTHETIC', 'cycle_start': '2026-09-01' if prior else MONTH,
        'cycle_end': '2026-09-30' if prior else '2026-10-31', 'due_date': '2026-10-15' if prior else '2026-11-15',
        'declared_total': money(sum(Decimal(row['amount']) for row in rows)), 'total_meaning': 'NET_CHARGES',
        'evidence_ref': MARKER + ':' + suffix, 'review_status': 'CONFIRMED'})
    raw_rows = [{'row_no': index + 1, 'row_hash': digest(row), 'raw_row': row,
                 'amount': money(abs(Decimal(row['amount']))), 'direction': 'CREDIT' if Decimal(row['amount']) < 0 else 'DEBIT',
                 'charge_date': row['charge_date'], 'cost_type': row['cost_type'], 'detail': row['descriptor'],
                 'payment_method': 'CORPORATE_CARD', 'bud': classifications[index].get('bud')}
                for index, row in enumerate(rows)]
    batch = await finance(db, 'card_import', {'source_fingerprint': digest({'marker': MARKER, 'suffix': suffix, 'rows': rows}),
        'statement_control_id': statement['id'], 'logical_source_id': MARKER + ':' + suffix,
        'source_file': 'synthetic-' + suffix.lower() + '.json', 'tab': suffix, 'profile_id': MARKER,
        'profile_version': '1', 'provenance': {'synthetic_only': True, 'source': MARKER, 'review': 'SYNTHETIC_FIXTURE_REVIEW'},
        'issues': [], 'rows': raw_rows})
    if batch['status'] != 'APPLIED_DRAFT':
        raise ValueError('Synthetic card rows were quarantined; preserve all prior data')
    for index, row in enumerate(sorted(batch['rows'], key=lambda item: item['row_no'])):
        classification = {**classifications[index], 'cost_type': rows[index]['cost_type'],
            'amount': raw_rows[index]['amount'], 'direction': raw_rows[index]['direction'],
            'vendor': rows[index]['descriptor'], 'evidence_refs': {'S': MARKER + ':' + suffix,
                'V': MARKER + ':synthetic-occurrence-' + str(index + 1)}}
        batch = await finance(db, 'cost_classify', {'source_row_id': row['id'], 'expected_version': row['row_version'],
                                                   'costs': [classification]})
    batch = await finance(db, 'card_batch_confirm', {'id': batch['id'], 'expected_version': batch['row_version'],
        'expected_previous_batch_id': None, 'reason': MARKER + ': explicit synthetic fixture review, not real approval'})
    return statement, batch


async def _new_finance(db):
    stamp = await db.fetchval('SELECT clock_timestamp()')
    scopes = {key: await _create_scope(db, key, stamp) for key in SCOPES}
    memo = await _memo(db, 'MO2610901', 'HYABC synthetic media budget', 'C1', '12000.00')
    annual = await _memo(db, 'MO2610902', 'SYNTHETIC annual plugin October 2026–September 2027', 'SID', '1200.00')
    lines, campaigns = {}, {}
    for key, gross, media, fee in (('group', '10000.00', '9500.00', '500.00'), ('brand', '2000.00', '2000.00', '0.00')):
        part = {'component_kind': 'PHASE' if key == 'group' else 'POOL', 'bud': 'C1', 'gross_amount': gross,
            'media_amount': media, 'fee_amount': fee, 'memo_id': memo['id'],
            'fee_po_ref': MARKER + ':FEE-PO' if key == 'group' else None,
            'budget_items': [{'cost_type': 'MEDIA', 'payment_method': 'PLATFORM_INVOICE', 'amount': media}]}
        if key == 'group':
            part.update(rem_project_id='HYABC', formatted_mapping=SCOPES['group'])
            part['budget_items'].append({'cost_type': 'AGENCY_FEE', 'payment_method': 'AGENCY_PO_INVOICE', 'amount': fee})
        line = await finance(db, 'line_create', {'kind': 'GROUP' if key == 'group' else 'BRAND_POOL',
            'scope_id': scopes[key], 'month': MONTH, 'agency': 'KIN', 'reason': MARKER, 'components': [part]})
        lines[key] = await finance(db, 'revision_confirm', {'id': line['id'], 'revision_id': line['revisions'][0]['id'],
            'expected_revision_id': None, 'acknowledgements': [{'memo_id': memo['id'],
                'reason': MARKER + ': first line precedes second line in the same atomic seed; final sum is 12000.00'}]})
        issued = await db.fetchval("SELECT ads.issue_registration($1,'LEADS','KIN')", UUID(scopes[key]))
        registration, name = issued['registration'], issued['names'][0]
        native = NATIVE[key]
        binding = await db.fetchval('SELECT ads.bind_native($1,$2,$3,$4,$5)', registration['code'],
            UUID(name['name_id']), native['platform'], native['account_id'], native['campaign_id'])
        assignment = await finance(db, 'assignment_create', {'code': registration['code'], 'month': MONTH,
            'line_id': line['id'], 'expected_revision_id': lines[key]['current_revision_id']})
        campaigns[key] = {'code': registration['code'], 'name': name['frozen_name'], 'name_id': name['name_id'],
                          'assignment_id': assignment['id'], **native}
        account = await finance(db, 'ad_account_create', {**{field: native[field] for field in ('platform', 'account_id')},
            'label': MARKER + ':' + key, 'mapping': {'scope_id': scopes[key], 'agency': 'KIN', 'bud': 'C1',
                'valid_from': MONTH, 'valid_to': '2026-11-01', 'evidence_ref': MARKER}})
        await finance(db, 'ad_account_version_confirm', {'id': account['id'], 'mapping_id': account['mappings'][0]['id'],
                                                       'expected_version': account['mappings'][0]['row_version']})
    commitment = await finance(db, 'commitment_create', {'vendor': MARKER + ':PLUGIN', 'version': {
        'vendor_account_ref': '000-DEMO-PLUGIN', 'scope_id': scopes['brand'], 'bud': 'SID', 'plan': 'SYNTHETIC-ANNUAL',
        'cost_type': 'TOOL', 'payment_method': 'CORPORATE_CARD', 'amount_per_cycle': '1200.00', 'frequency': 'ANNUAL',
        'start_date': MONTH, 'end_date': '2027-09-30', 'evidence_ref': MARKER,
        'occurrences': [{'cycle_no': 1, 'charge_date': '2026-10-04', 'coverage_start': MONTH,
                         'coverage_end': '2027-09-01', 'expected_amount': '1200.00'}],
        'covers': [{'memo_id': annual['id'], 'bud': 'SID', 'coverage_start': MONTH, 'coverage_end': '2027-09-01',
                    'cap_amount': '1200.00', 'evidence_ref': MARKER}]}})
    commitment = await finance(db, 'commitment_activate', {'id': commitment['id'], 'expected_version': commitment['row_version'],
        'version_id': commitment['versions'][0]['id'], 'expected_current_version_id': None, 'acknowledgements': []})
    occurrence = next(version for version in commitment['versions'] if version['status'] == 'CONFIRMED')['occurrences'][0]
    prior_rows = [{'charge_date': '2026-09-15', 'descriptor': 'SYNTHETIC GOOGLE ORIGINAL REFUNDED OCTOBER',
                   'amount': '120.00', 'cost_type': 'MEDIA', 'payment_method': 'CORPORATE_CARD'}]
    prior_statement, prior = await _batch(db, 'SEPT-REFUND-ORIGIN', prior_rows, [{}])
    origin = next(cost for cost in prior['rows'][0]['costs'] if cost['status'] == 'CONFIRMED')
    classifications = []
    for index, row in enumerate(statement_rows()):
        item = {}
        if index in (0, 1, 6):
            item = {'scope_id': scopes['group'], 'bud': 'C1', 'memo_id': memo['id'], 'line_id': lines['group']['id']}
        elif index == 5:
            item = {'scope_id': scopes['brand'], 'bud': 'SID', 'memo_id': annual['id'], 'commitment_occurrence_id': occurrence['id']}
        elif index == 8:
            item = {'refund_of': origin['id']}
        elif index == 9:
            item = {'scope_id': scopes['brand'], 'bud': 'C1', 'memo_id': memo['id'], 'line_id': lines['brand']['id']}
        # CHANNEL and BANK_FEE deliberately have no guessed scope, BUD or account.
        classifications.append(item)
    statement, batch = await _batch(db, 'OCTOBER', statement_rows(), classifications)
    for row in sorted(batch['rows'], key=lambda item: item['row_no']):
        cost = next(item for item in row['costs'] if item['status'] == 'CONFIRMED')
        if cost['line_id'] is not None or cost['commitment_occurrence_id'] is not None:
            await finance(db, 'cost_allocate', {'id': cost['id'], 'expected_version': cost['row_version'],
                'expected_allocation_set_id': None, 'method': 'EQUAL_MONTHS', 'coverage_start': MONTH,
                'coverage_end': '2027-09-01' if cost['commitment_occurrence_id'] else MONTH,
                'scope_id': cost['scope_id'], 'bud': cost['bud'], 'reason': MARKER})
    return {'scope_ids': scopes, 'line_ids': {key: line['id'] for key, line in lines.items()},
        'campaigns': campaigns, 'codes': {key: row['code'] for key, row in campaigns.items()},
        'memo_id': memo['id'], 'annual_memo_id': annual['id'], 'commitment_id': commitment['id'],
        'card_batch_id': batch['id'], 'statement_control_id': statement['id'],
        'prior_refund_batch_id': prior['id'], 'prior_refund_statement_id': prior_statement['id'],
        'refund_origin_cost_id': origin['id']}


async def _collect(db):
    """Read seed-owned full rows, including children; any subsequent edit conflicts."""
    scopes = await db.fetchval("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY scope_id),'[]') FROM ads.scope_code t WHERE source_fingerprint=$1", MARKER)
    ids = [UUID(row['scope_id']) for row in scopes]
    result = {'scopes': scopes}
    queries = {
        'members': ('ads.scope_member', 'scope_id=ANY($1)', ids),
        'registrations': ('ads.campaign_registration', 'scope_id=ANY($1)', ids),
        'names': ('ads.campaign_name', 'code IN(SELECT code FROM ads.campaign_registration WHERE scope_id=ANY($1))', ids),
        'bindings': ('ads.native_binding', 'code IN(SELECT code FROM ads.campaign_registration WHERE scope_id=ANY($1))', ids),
        'memos': ('ads.memo', 'evidence_ref=$1', MARKER),
        'identifiers': ('ads.memo_identifier', 'memo_id IN(SELECT id FROM ads.memo WHERE evidence_ref=$1)', MARKER),
        'lines': ('ads.media_line', 'scope_id=ANY($1)', ids),
        'revisions': ('ads.media_line_revision', 'line_id IN(SELECT id FROM ads.media_line WHERE scope_id=ANY($1))', ids),
        'components': ('ads.media_line_component', 'revision_id IN(SELECT r.id FROM ads.media_line_revision r JOIN ads.media_line l ON l.id=r.line_id WHERE l.scope_id=ANY($1))', ids),
        'budgets': ('ads.line_budget_item', 'component_id IN(SELECT c.id FROM ads.media_line_component c JOIN ads.media_line_revision r ON r.id=c.revision_id JOIN ads.media_line l ON l.id=r.line_id WHERE l.scope_id=ANY($1))', ids),
        'assignments': ('ads.line_assignment', 'line_id IN(SELECT id FROM ads.media_line WHERE scope_id=ANY($1))', ids),
        'accounts': ('ads.ad_account', 'label LIKE $1', MARKER + ':%'),
        'mappings': ('ads.account_mapping', 'evidence_ref=$1', MARKER),
        'commitments': ('ads.recurring_commitment', 'vendor=$1', MARKER + ':PLUGIN'),
        'versions': ('ads.commitment_version', 'commitment_id IN(SELECT id FROM ads.recurring_commitment WHERE vendor=$1)', MARKER + ':PLUGIN'),
        'occurrences': ('ads.commitment_occurrence', 'commitment_version_id IN(SELECT v.id FROM ads.commitment_version v JOIN ads.recurring_commitment c ON c.id=v.commitment_id WHERE c.vendor=$1)', MARKER + ':PLUGIN'),
        'covers': ('ads.commitment_memo_cover', 'commitment_version_id IN(SELECT v.id FROM ads.commitment_version v JOIN ads.recurring_commitment c ON c.id=v.commitment_id WHERE c.vendor=$1)', MARKER + ':PLUGIN'),
        'statements': ('ads.card_statement_control', 'operator_ref LIKE $1', MARKER + ':%'),
        'batches': ('staging.ads_card_batch', 'logical_source_id LIKE $1', MARKER + ':%'),
        'rows': ('staging.ads_card_row', 'batch_id IN(SELECT id FROM staging.ads_card_batch WHERE logical_source_id LIKE $1)', MARKER + ':%'),
        'costs': ('ads.cost_record', 'source_row_id IN(SELECT r.id FROM staging.ads_card_row r JOIN staging.ads_card_batch b ON b.id=r.batch_id WHERE b.logical_source_id LIKE $1)', MARKER + ':%'),
        'allocation_sets': ('ads.cost_allocation_set', 'reason=$1', MARKER),
        'allocations': ('ads.cost_allocation', 'allocation_set_id IN(SELECT id FROM ads.cost_allocation_set WHERE reason=$1)', MARKER),
    }
    for key, (table, predicate, argument) in queries.items():
        # All identifiers/predicates are fixed code, never operator input.
        result[key] = await db.fetchval(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM {table} t WHERE {predicate}", argument)
    return result


def _receipt(state):
    scopes = {key: next(row['scope_id'] for row in state['scopes'] if row['scope_code'] == token) for key, token in SCOPES.items()}
    lines = {key: next(row['id'] for row in state['lines'] if row['scope_id'] == scopes[key]) for key in ('group', 'brand')}
    campaigns = {}
    for key in lines:
        binding = next(row for row in state['bindings'] if row['campaign_id'] == NATIVE[key]['campaign_id'])
        name = next(row for row in state['names'] if row['name_id'] == binding['name_id'])
        assignment = next(row for row in state['assignments'] if row['code'] == binding['code'])
        campaigns[key] = {**NATIVE[key], 'code': binding['code'], 'name_id': binding['name_id'],
                          'name': name['frozen_name'], 'assignment_id': assignment['id']}
    batch = next(row for row in state['batches'] if row['logical_source_id'] == MARKER + ':OCTOBER')
    prior = next(row for row in state['batches'] if row['logical_source_id'] == MARKER + ':SEPT-REFUND-ORIGIN')
    origin_row = next(row for row in state['rows'] if row['batch_id'] == prior['id'])
    return {'scope_ids': scopes, 'line_ids': lines, 'campaigns': campaigns,
        'codes': {key: row['code'] for key, row in campaigns.items()},
        'memo_id': next(row['id'] for row in state['memos'] if row['memo_no'] == 'MO2610901'),
        'annual_memo_id': next(row['id'] for row in state['memos'] if row['memo_no'] == 'MO2610902'),
        'commitment_id': state['commitments'][0]['id'], 'card_batch_id': batch['id'],
        'statement_control_id': batch['statement_control_id'], 'prior_refund_batch_id': prior['id'],
        'prior_refund_statement_id': prior['statement_control_id'],
        'refund_origin_cost_id': next(row['id'] for row in state['costs'] if row['source_row_id'] == origin_row['id'] and row['status'] == 'CONFIRMED')}


def _ref(relation, key, batch=MARKER):
    return {'source_key': 'LOCAL_SYNTHETIC_DEMO', 'relation': relation, 'record_key': key,
            'source_batch_id': batch, 'source_field': None}


def _costs_by_type(state, line_id, recognition=False):
    costs = {row['id']: row for row in state['costs'] if row['status'] == 'CONFIRMED' and row['line_id'] == line_id}
    items = [row for row in state['allocations'] if row['cost_id'] in costs and row['month'] == MONTH] if recognition else list(costs.values())
    totals = {}
    for row in items:
        key = row['cost_type'], row['payment_method']
        value = totals.setdefault(key, {'amount': Decimal(0), 'ids': set()})
        value['amount'] += Decimal(str(row['amount'])) * (-1 if row['direction'] == 'CREDIT' else 1)
        value['ids'].add(row['cost_id'] if recognition else row['id'])
    return [{'cost_type': key[0], 'payment_method': key[1], 'amount': money(value['amount']), 'cost_count': len(value['ids'])}
            for key, value in sorted(totals.items())]


def build_package(current, state, receipt, stamp, commit):
    """Append labelled demo observations; never redates frozen business evidence."""
    manifest, relations = deepcopy(current['manifest']), deepcopy(current['relations'])
    snapshot, hub_snapshot = str(uuid4()), str(uuid4())
    common = {'environment': 'test', 'contract_version': 'hub-p3-test-v1', 'snapshot_id': snapshot,
              'snapshot_at': stamp, 'hub_snapshot_id': hub_snapshot, 'hub_source_snapshot_at': stamp}
    manifest.update(common, exported_at=stamp, parser_version=MARKER, match_rule_version=MARKER,
                    hub_source_commit=commit, hub_design_commit=commit)
    for rows in relations.values():
        for row in rows:
            row.update(common)
    for row in relations['fact_marketing_ops_finding']:
        row.update(evaluation_status='UNAVAILABLE', condition_present=None)
    provenance = {'source_kind': 'LOCAL_SYNTHETIC_DEMO', 'source_record_refs': [
        _ref('synthetic_seed_state', digest(state)), _ref('seed_script_sha256', script_sha256()),
        _ref('hub_base_commit', commit), _ref('demo_seed_generation', snapshot)],
        'source_field': None, 'source_snapshot_at': stamp, 'effective_time_evidence_ref': None}
    base = {**common, 'effective_at': None, 'recorded_at': stamp, 'temporal_basis': 'SNAPSHOT_ONLY',
            'temporal_provenance': provenance}
    new_bridges = []
    for key, spend, leads in (('group', '2400.00', 12), ('brand', '600.00', 3)):
        line = next(row for row in state['lines'] if row['id'] == receipt['line_ids'][key])
        revision = next(row for row in state['revisions'] if row['line_id'] == line['id'] and row['status'] == 'APPROVED')
        parts = []
        for row in state['components']:
            if row['revision_id'] != revision['id']:
                continue
            part = {'component_id': row['id'], **{field: row[field] for field in
                ('component_kind', 'rem_project_id', 'formatted_mapping', 'bud', 'memo_id', 'fee_po_ref')},
                **{field: None if row[field] is None else money(row[field]) for field in ('gross_amount', 'media_amount', 'fee_amount')},
                'budget_items': [{**{field: item[field] for field in ('id', 'cost_type', 'payment_method')}, 'amount': money(item['amount'])}
                                 for item in state['budgets'] if item['component_id'] == row['id']]}
            parts.append(part)
        parts.sort(key=lambda item: item['component_id'])
        dim = {**base, 'line_source': 'hub', 'line_key': line['id'], 'revision_key': revision['id'],
            'hub_line_id': line['id'], 'hub_revision_id': revision['id'], 'revision_no': revision['revision_no'],
            'revision_status': 'APPROVED', 'line_state': 'ACTIVE', 'is_applicable': True, 'archived_at': None,
            'kind': line['kind'], 'scope_id': line['scope_id'], 'scope_code': SCOPES[key], 'agency': 'KIN', 'month': MONTH,
            'program_ref': None, 'period_start_month': None, 'period_end_month': None, 'permitted_scope_ids': [],
            'permitted_agencies': [], 'components': parts, 'approved_gross': money(sum(Decimal(part['gross_amount']) for part in parts)),
            'approved_media': money(sum(Decimal(part['media_amount']) for part in parts)),
            'approved_fee': money(sum(Decimal(part['fee_amount']) for part in parts)), 'budget_basis': 'MONTH',
            'typed_budget_complete': True, 'source_updated_at': line['updated_at'], 'quality_codes': ['LOCAL_SYNTHETIC_DEMO']}
        relations['dim_media_line'].append(dim)
        monthly = {**base, 'line_source': 'hub', 'line_key': line['id'], 'revision_key': revision['id'], 'month': MONTH,
            'budget_basis': 'MONTH', 'approved_month_gross': dim['approved_gross'], 'approved_month_media': dim['approved_media'],
            'typed_budget_complete': True, 'platform_media_spend': spend, 'platform_spend_basis': 'PLATFORM_MEDIA_ONLY',
            'platform_data_through': None, 'attributed_leads': leads, 'lead_definition_version': 'LOCAL_SYNTHETIC_DEMO-COUNTS-V1',
            'leads_data_through': None, 'media_budget_used_pct': money((Decimal(spend) / Decimal(dim['approved_media']) * 100).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)),
            'media_cpl': money(Decimal(spend) / leads), 'comparison_reason': None, 'campaign_count': 1,
            'unresolved_context_count': 0, 'card_cash_by_type': _costs_by_type(state, line['id']),
            'card_monthly_by_type': _costs_by_type(state, line['id'], True), 'financial_components': parts,
            'quality_codes': ['LOCAL_SYNTHETIC_DEMO', 'DATETIME_CUTOFF_UNAVAILABLE'],
            'platform_source_snapshot_at': stamp, 'rem_source_snapshot_at': stamp}
        relations['fact_media_line_monthly'].append(monthly)
        campaign = receipt['campaigns'][key]
        observed = receipt['campaigns']['group'] if key == 'brand' else campaign
        bridge = {**base, **{field: campaign[field] for field in ('platform', 'account_id', 'campaign_id')},
            'month': MONTH, 'line_source': 'hub', 'line_key': line['id'], 'revision_key': revision['id'],
            'observed_code': observed['code'], 'observed_name': observed['name'], 'registration_code': campaign['code'],
            'name_id': campaign['name_id'], 'scope_id': line['scope_id'], 'agency': 'KIN', 'match_method': 'HUB_NATIVE_ID',
            'candidate_method': 'HUB_NATIVE_ID', 'assignment_id': campaign['assignment_id'], 'binding_name_id': campaign['name_id'],
            'correction_target_id': None, 'candidate_line_keys': [line['id']],
            'conflict_codes': ['BOUND_IDENTITY_CONFLICT'] if key == 'brand' else [], 'unresolved_reason': None,
            'name_conformance': 'SENA_H_VALID', 'parser_version': MARKER, 'match_rule_version': MARKER,
            'platform_source_snapshot_at': stamp, 'observed_at': None, 'source_kind': 'LOCAL_SYNTHETIC_DEMO',
            'source_record_refs': [_ref('synthetic_campaign_observation', key)]}
        new_bridges.append(bridge)
    unresolved = {**deepcopy(new_bridges[0]), 'account_id': '000-DEMO-UNRESOLVED', 'campaign_id': '000-DEMO-OCT26-UNRESOLVED',
        **{field: None for field in ('line_source', 'line_key', 'revision_key', 'observed_code', 'registration_code', 'name_id',
                                    'scope_id', 'agency', 'candidate_method', 'assignment_id', 'binding_name_id')},
        'observed_name': 'SYNTHETIC MISSING REGISTRY NAME', 'match_method': 'UNRESOLVED', 'candidate_line_keys': [],
        'name_conformance': 'NONCONFORMING', 'unresolved_reason': 'NO_REGISTRY_MATCH',
        'source_record_refs': [_ref('synthetic_campaign_observation', 'unresolved-spend-75.00')]}
    new_bridges.append(unresolved)
    relations['bridge_native_campaign_media_line'].extend(new_bridges)
    for bridge, control, rule in ((unresolved, 'C5', 'NAME_AND_APPROVED_LINE'), (new_bridges[1], 'C6', 'BOUND_IDENTITY_CONFLICT')):
        subject = canonical([bridge['platform'], bridge['account_id'], bridge['campaign_id']]).decode('utf-8')
        identity = ['test', 'marketing_ops', control, rule, 'NATIVE_CAMPAIGN', subject, MONTH]
        relations['fact_marketing_ops_finding'].append({**base, 'finding_key': digest(identity), 'control_code': control,
            'rule_code': rule, 'rule_version': MARKER, 'subject_kind': 'NATIVE_CAMPAIGN', 'subject_key': subject, 'month': MONTH,
            **{field: bridge[field] for field in ('line_source', 'line_key', 'platform', 'account_id', 'campaign_id', 'registration_code', 'agency')},
            'condition_present': True, 'evaluation_status': 'EVALUATED', 'severity': 'WARNING',
            'first_observed_at': stamp, 'last_observed_at': stamp, 'cleared_at': None,
            'expected': {'agency': bridge['agency'], 'bound_code': bridge['registration_code'], 'line_key': bridge['line_key'],
                         'registration_code': bridge['registration_code'], 'scope_code': SCOPES['brand'] if control == 'C6' else None},
            'observed': {'evidence_status': 'AVAILABLE', 'observed_at': None, 'observed_code': bridge['observed_code'],
                'observed_name': bridge['observed_name'], 'parser_version': MARKER, 'reason_code': rule,
                'source_kind': 'LOCAL_SYNTHETIC_DEMO', 'source_record_refs': bridge['source_record_refs'], 'source_snapshot_at': stamp},
            'context_refs': {'assignment_id': bridge['assignment_id'], 'hub_batch_id': hub_snapshot, 'unresolved_reason': bridge['unresolved_reason']},
            'suggested_owner_role': 'online_staff', 'match_method': bridge['match_method'], 'source_snapshot_at': stamp})
    controls = manifest['control_totals']
    controls['platform_resolved'] = money(sum(Decimal(row['platform_media_spend']) for row in relations['fact_media_line_monthly'] if row['platform_media_spend'] is not None))
    controls['platform_unresolved'] = money(Decimal(controls['platform_unresolved']) + Decimal('75.00'))
    for basis, field in (('card_cash', 'card_cash_by_type'), ('card_monthly', 'card_monthly_by_type')):
        controls[basis]['assigned'] = money(sum(Decimal(item['amount']) for row in relations['fact_media_line_monthly'] for item in row[field]))
    # October unassigned2012 = OA897 + annual1200 + bank35 - refund120;
    # September origin120 is separate cash. Recognition is annual1200, not cash again.
    controls['card_cash']['unassigned'] = money(Decimal(controls['card_cash']['unassigned']) + Decimal('2132.00'))
    controls['card_monthly']['unassigned'] = money(Decimal(controls['card_monthly']['unassigned']) + Decimal('1200.00'))
    additions = {'platform': [MONTH], 'card_cash': ['2026-09-01', MONTH],
                 'card_monthly': ['2026-10-01', '2026-11-01', '2026-12-01'] + [f'2027-{month:02}-01' for month in range(1, 10)]}
    for basis, months in additions.items():
        coverage = controls['coverage_by_basis'][basis]
        months = sorted(set(coverage['covered_months'] + months))
        coverage.update(covered_months=months, covered_month_from=months[0], covered_month_to=months[-1])
    all_months = [month for coverage in controls['coverage_by_basis'].values() for month in coverage['covered_months']]
    manifest['covered_month_from'] = min(manifest['covered_month_from'], *all_months)
    manifest['covered_month_to'] = max(manifest['covered_month_to'], *all_months)
    return package_files(manifest, relations)


async def seed(db):
    """No commit, file install, source sync, OCR or network call inside this helper."""
    await db.execute('SELECT hub.require_demo_seeder()')
    await db.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", MARKER)
    await db.execute("SELECT set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", ACTOR, MARKER)
    if await db.fetchval("SELECT value FROM ads.setting WHERE key='sena_h_approved'") is not False:
        raise ValueError('Demo requires unchanged pending SENA-H approval')
    current = await db.fetchrow('SELECT b.manifest,b.relations FROM staging.ads_actuals_current c JOIN staging.ads_actuals_batch b ON b.id=c.batch_id')
    if current is None:
        raise ValueError('Install the frozen P3 TEST snapshot before the demo')
    previous = await db.fetchrow("""SELECT manifest,relations FROM staging.ads_actuals_batch b
        WHERE status='APPLIED' AND manifest->>'match_rule_version'=$1 AND EXISTS(
          SELECT 1 FROM jsonb_array_elements(b.relations->'dim_media_line') d
          CROSS JOIN LATERAL jsonb_array_elements(d#>'{temporal_provenance,source_record_refs}') ref
          WHERE ref->>'relation'='demo_seed_generation' AND ref->>'record_key'=b.snapshot_id)
        ORDER BY received_at DESC LIMIT 1""", MARKER)
    if previous:
        if previous['manifest']['snapshot_id'] != current['manifest']['snapshot_id']:
            raise ValueError('A newer actuals generation exists; preserve it')
        state = await _collect(db)
        refs = [ref for row in previous['relations']['dim_media_line'] for ref in row['temporal_provenance']['source_record_refs']
                if ref['relation'] == 'synthetic_seed_state']
        if not refs or any(ref['record_key'] != digest(state) for ref in refs):
            raise ValueError('Seed-owned financial content changed; existing edits preserved')
        receipt = _receipt(state)
        package, files = package_files(previous['manifest'], previous['relations'])
    else:
        collision = await db.fetchval("""SELECT EXISTS(SELECT 1 FROM ads.scope_code WHERE scope_code=ANY($1))
            OR EXISTS(SELECT 1 FROM ads.memo_identifier WHERE identifier IN('MO2610901','MO2610902'))
            OR EXISTS(SELECT 1 FROM staging.ads_card_batch WHERE logical_source_id LIKE $2)
            OR EXISTS(SELECT 1 FROM ads.recurring_commitment WHERE vendor=$3)
            OR EXISTS(SELECT 1 FROM ads.ad_account WHERE account_id=ANY($4))
            OR EXISTS(SELECT 1 FROM ads.native_binding WHERE campaign_id=ANY($5))""",
            list(SCOPES.values()), MARKER + ':%', MARKER + ':PLUGIN',
            [row['account_id'] for row in NATIVE.values()], [row['campaign_id'] for row in NATIVE.values()])
        if collision:
            raise ValueError('A demo identifier is occupied; existing records preserved')
        if not await db.fetchval("SELECT EXISTS(SELECT 1 FROM hub.projects WHERE rem_project_id='HYABC' AND deleted_at IS NULL) AND EXISTS(SELECT 1 FROM hub.brands WHERE rem_brand_id='25')"):
            raise ValueError('Existing HYABC/FLEXI identities are required; no source rows will be invented')
        await db.execute('SET LOCAL ROLE admin')
        receipt = await _new_finance(db)
        await db.execute('RESET ROLE')
        state = await _collect(db)
        stamp = max(await db.fetchval('SELECT clock_timestamp()'), datetime.fromisoformat(current['manifest']['snapshot_at']) + timedelta(microseconds=1)).isoformat()
        commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
        package, files = build_package(current, state, receipt, stamp, commit)
    await db.execute('SET LOCAL ROLE admin')
    applied = await db.fetchval('SELECT ads.apply_ads_actuals($1,$2,$3,$4)', package.manifest, package.relations,
                                package.fingerprint, current['manifest']['snapshot_id'])
    await db.execute('RESET ROLE')
    if applied['status'] not in ('APPLIED', 'NOOP'):
        raise ValueError('Demo actuals quarantined; roll back the entire seed')
    return {'environment': 'local-test', 'synthetic_only': True, 'marker': MARKER, 'month': MONTH,
        'status': 'NOOP' if previous else 'SEEDED', 'seed_script_sha256': script_sha256(), **receipt, 'actuals': {**applied,
            'snapshot_id': package.manifest['snapshot_id'], 'row_counts': {name: len(rows) for name, rows in package.relations.items()},
            'fingerprint': package.fingerprint}, 'controls': {'october_statement_net': '4812.00',
            'october_occurrences': 10, 'unattributed_channel_occurrences': 3, 'september_refund_origin': '120.00',
            'annual_plugin_cash': '1200.00', 'annual_plugin_monthly': '100.00'}, '_package_files': files}


async def run():
    async with local_connection() as db:
        async with db.transaction():
            result = await seed(db)
    directory = ROOT / '.local/hub-demo/ads_actuals'
    directory.mkdir(parents=True, exist_ok=True)
    for name, raw in result.pop('_package_files').items():
        (directory / name).write_bytes(raw)
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(asyncio.run(run()), ensure_ascii=True, indent=2))
    except Exception as error:
        print(f'Synthetic finance seed stopped ({type(error).__name__}); no conflicting business data overwritten.', file=sys.stderr)
        raise SystemExit(1) from None
