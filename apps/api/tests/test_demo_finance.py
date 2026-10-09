"""Synthetic demo controls and an opt-in, fully rolled-back local seed/replay."""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import importlib.util
import json
import os
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from sena_hub_api.actuals_import import KEYS
from sena_hub_api.document_storage import statement_rows
from sena_hub_api.document_worker import local_connection

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('seed_demo_finance', ROOT / 'scripts/seed-demo-finance.py')
seed_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(seed_module)


def test_statement_recipe_is_exact_signed_source_evidence_not_ten_similar_costs():
    rows = statement_rows()
    assert len(rows) == 10 and sum(Decimal(row['amount']) for row in rows) == Decimal('4812.00')
    assert [row['amount'] for row in rows if row['cost_type'] == 'CHANNEL'] == ['299.00'] * 3
    assert rows[5]['descriptor'] == 'PLUGIN ANNUAL PLAN' and rows[5]['amount'] == '1200.00'
    assert rows[8]['amount'] == '-120.00'
    assert len({(row['page'], row['occurrence']) for row in rows}) == 10


def test_package_bytes_are_validated_exactly_and_do_not_mutate_frozen_input():
    folder = ROOT / 'supabase/tests/fixtures/ads_actuals'
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    relations = {entry['relation']: json.loads((folder / entry['file']).read_text(encoding='utf-8')) for entry in manifest['relations']}
    before = deepcopy(manifest)
    package, files = seed_module.package_files(manifest, relations)
    assert manifest == before
    assert json.loads(files['manifest.json']) == package.manifest
    assert len(package.relations['fact_marketing_ops_finding']) == 73
    for entry in package.manifest['relations']:
        assert hashlib.sha256(files[entry['file']]).hexdigest() == entry['file_sha256']
    relations['fact_media_line_monthly'][0]['media_cpl'] = '999999.00'
    with pytest.raises(ValueError):
        seed_module.package_files(manifest, relations)


@pytest.mark.integration
@pytest.mark.skipif(os.getenv('HUB_DEMO_FINANCE_TEST') != '1', reason='Set HUB_DEMO_FINANCE_TEST=1 for a local rollback-only demo seed')
def test_finance_seed_real_controls_replay_preserved_edits_and_complete_snapshot():
    async def run():
        async with local_connection() as db:
            async def count_state():
                return {table: await db.fetchval('SELECT count(*) FROM ' + table) for table in (
                    'ads.scope_code', 'ads.scope_member', 'ads.memo', 'ads.media_line', 'ads.media_line_revision',
                    'ads.campaign_registration', 'ads.campaign_name', 'ads.native_binding', 'ads.line_assignment',
                    'ads.cost_record', 'ads.cost_allocation', 'staging.ads_card_batch', 'staging.ads_actuals_batch')}

            before = await count_state()
            initial = await db.fetchrow('SELECT b.manifest,b.relations FROM staging.ads_actuals_current c JOIN staging.ads_actuals_batch b ON b.id=c.batch_id')
            assert initial, 'The original P3 TEST package must be installed first'
            original_pointer = initial['manifest']['snapshot_id']
            outer = db.transaction()
            await outer.start()
            try:
                first = await seed_module.seed(db)
                state = await seed_module._collect(db)
                after_first = await count_state()
                replay = await seed_module.seed(db)
                assert replay['status'] == 'NOOP' and replay['actuals']['status'] == 'NOOP'
                assert replay['_package_files'] == first['_package_files']
                assert await count_state() == after_first
                assert await seed_module._collect(db) == state
                assert await db.fetchval("SELECT value FROM ads.setting WHERE key='sena_h_approved'") is False
                assert set(first['line_ids']) == {'group', 'brand'}
                memo = next(row for row in state['memos'] if row['id'] == first['memo_id'])
                assert (memo['memo_no'], memo['requesting_bud'], Decimal(str(memo['gross_amount'])), memo['record_status']) == ('MO2610901', 'C1', Decimal('12000'), 'CONFIRMED')
                assert sum(Decimal(str(row['gross_amount'])) for row in state['components']) == Decimal('12000')
                assert len(state['registrations']) == 2 and len(state['assignments']) == 2
                assert all(row['month'] == '2026-10-01' and row['status'] == 'ACTIVE' for row in state['assignments'])
                october = next(row for row in state['batches'] if row['id'] == first['card_batch_id'])
                assert october['status'] == 'CONFIRMED' and Decimal(str(october['net_total'])) == Decimal('4812')
                rows = sorted((row for row in state['rows'] if row['batch_id'] == october['id']), key=lambda row: row['row_no'])
                assert [row['raw_row'] for row in rows] == statement_rows()
                assert [row['typed_row']['detail'] for row in rows] == [row['descriptor'] for row in statement_rows()]
                costs = [row for row in state['costs'] if row['status'] == 'CONFIRMED']
                oa = [row for row in costs if row['cost_type'] == 'CHANNEL']
                assert len(oa) == 3
                assert all(row['scope_id'] is None and row['bud'] is None and row['account_mapping_id'] is None
                           and row['line_id'] is None and row['attribution_status'] == 'UNRESOLVED' for row in oa)
                refund = next(row for row in costs if row['direction'] == 'CREDIT')
                origin = next(row for row in costs if row['id'] == refund['refund_of'])
                assert origin['charge_date'] == '2026-09-15' and Decimal(str(origin['amount'])) == Decimal('120')
                assert origin['memo_id'] is None and refund['memo_id'] is None
                plugin = next(row for row in costs if row['commitment_occurrence_id'])
                allocations = [row for row in state['allocations'] if row['cost_id'] == plugin['id']]
                assert len(allocations) == 12 and all(Decimal(str(row['amount'])) == Decimal('100') for row in allocations)
                assert sorted(row['month'] for row in allocations)[::11] == ['2026-10-01', '2027-09-01']
                assert plugin['memo_id'] == first['annual_memo_id'] and plugin['line_id'] is None
                files = first['_package_files']
                manifest = json.loads(files['manifest.json'])
                relations = {entry['relation']: json.loads(files[entry['file']]) for entry in manifest['relations']}
                old_findings = {row['finding_key']: row for row in initial['relations']['fact_marketing_ops_finding']}
                findings = {row['finding_key']: row for row in relations['fact_marketing_ops_finding']}
                assert old_findings.keys() <= findings.keys()
                for key, previous in old_findings.items():
                    current = findings[key]
                    # These are carry-forwards; preserve event/source dates and do not manufacture clearance.
                    if previous['temporal_provenance']['source_kind'] != 'LOCAL_SYNTHETIC_DEMO':
                        assert current['evaluation_status'] == 'UNAVAILABLE' and current['condition_present'] is None
                    for field in ('month', 'temporal_provenance', 'first_observed_at', 'last_observed_at', 'cleared_at', 'source_snapshot_at', 'observed'):
                        assert current[field] == previous[field]
                for name in ('dim_media_line', 'bridge_native_campaign_media_line', 'fact_media_line_monthly'):
                    for old in initial['relations'][name]:
                        matches = [row for row in relations[name] if all(row[key] == old[key] for key in KEYS[name])]
                        assert len(matches) == 1
                        for field in ('month', 'recorded_at', 'temporal_provenance'):
                            assert matches[0][field] == old[field]
                for basis, original in initial['manifest']['control_totals']['coverage_by_basis'].items():
                    assert set(original['covered_months']) <= set(manifest['control_totals']['coverage_by_basis'][basis]['covered_months'])
                monthly = {row['line_key']: row for row in relations['fact_media_line_monthly'] if row['line_key'] in first['line_ids'].values()}
                assert monthly[first['line_ids']['group']]['media_budget_used_pct'] == '25.26'
                assert monthly[first['line_ids']['brand']]['media_budget_used_pct'] == '30.00'
                assert all(row['media_cpl'] == '200.00' for row in monthly.values())
                new_findings = [row for row in findings.values() if row['temporal_provenance']['source_kind'] == 'LOCAL_SYNTHETIC_DEMO']
                assert {row['control_code'] for row in new_findings} == {'C5', 'C6'}
                assert all(row['condition_present'] is True for row in new_findings)
                # The unchanged archive LINK_CARD comparison is multiplicity-sensitive.
                triples = [(row['typed_row']['charge_date'], Decimal(str(row['amount'])) * (-1 if row['direction'] == 'CREDIT' else 1), row['typed_row']['detail']) for row in rows]
                assert sorted(triples) == sorted((row['charge_date'], Decimal(row['amount']), row['descriptor']) for row in statement_rows())
                # An operator revision, even an unpublished one, is preserved and stops seed replay.
                savepoint = db.transaction()
                await savepoint.start()
                try:
                    await db.execute('SET LOCAL ROLE admin')
                    line = await db.fetchval("SELECT ads.finance_read('media-lines',$1)", first['line_ids']['group'])
                    revision = next(row for row in line['revisions'] if row['status'] == 'APPROVED')
                    await seed_module.finance(db, 'revision_create', {'id': line['id'], 'expected_version': line['row_version'],
                        'reason': 'Synthetic operator edit must survive replay', 'components': revision['components']})
                    await db.execute('RESET ROLE')
                    changed = await seed_module._collect(db)
                    with pytest.raises(ValueError, match='changed'):
                        await seed_module.seed(db)
                    assert await seed_module._collect(db) == changed
                finally:
                    await savepoint.rollback()
                # A later valid complete snapshot is not replaced by the saved presentation package.
                newer_manifest, newer_relations = deepcopy(manifest), deepcopy(relations)
                later = (datetime.fromisoformat(manifest['snapshot_at']) + timedelta(seconds=1)).isoformat()
                # A derived generation can copy the marker, but cannot become this seed.
                newer_manifest.update(snapshot_id=str(uuid4()), snapshot_at=later, exported_at=later)
                for items in newer_relations.values():
                    for row in items:
                        row.update(snapshot_id=newer_manifest['snapshot_id'], snapshot_at=later)
                package, _ = seed_module.package_files(newer_manifest, newer_relations)
                await db.execute('RESET ROLE')
                result = await db.fetchval('SELECT ads.apply_ads_actuals($1,$2,$3,$4)', package.manifest, package.relations,
                                          package.fingerprint, manifest['snapshot_id'])
                assert result['status'] == 'APPLIED'
                await db.execute('RESET ROLE')
                with pytest.raises(ValueError, match='newer'):
                    await seed_module.seed(db)
                assert await db.fetchval('SELECT b.snapshot_id FROM staging.ads_actuals_current c JOIN staging.ads_actuals_batch b ON b.id=c.batch_id') == newer_manifest['snapshot_id']
                await db.execute("UPDATE staging.ads_actuals_current SET batch_id=(SELECT id FROM staging.ads_actuals_batch WHERE snapshot_id=$1 AND status='APPLIED')", manifest['snapshot_id'])
                assert (await seed_module.seed(db))['status'] == 'NOOP'
            finally:
                await outer.rollback()
            assert await count_state() == before
            assert await db.fetchval('SELECT b.snapshot_id FROM staging.ads_actuals_current c JOIN staging.ads_actuals_batch b ON b.id=c.batch_id') == original_pointer
            print('PASS: exact October10/net4812, separate September refund120, 12x100 annual recognition, preserved OA, full snapshot, replay and edit/newer-generation conflicts; outer rollback restored counts.')
    asyncio.run(run())
