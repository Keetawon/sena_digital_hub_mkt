"""Synthetic read-back transport and local publication boundary regressions."""
import asyncio
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from sena_hub_api.actuals_import import SCHEMA, canonical, validate_package

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / 'supabase/tests/fixtures/ads_actuals'
spec = importlib.util.spec_from_file_location('stage_ads_actuals', ROOT / 'scripts/stage-ads-actuals.py')
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


@pytest.fixture
def package_dir(tmp_path):
    target = tmp_path / 'package'
    shutil.copytree(FIXTURE, target)
    return target


def update_manifest(path, change):
    manifest = json.loads((path / 'manifest.json').read_text(encoding='utf-8'))
    change(manifest)
    (path / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')


def update_rows(path, name, change):
    file = path / (name + '.json')
    rows = json.loads(file.read_text(encoding='utf-8'))
    change(rows)
    raw = json.dumps(rows, ensure_ascii=False).encode('utf-8')
    file.write_bytes(raw)
    def hashes(manifest):
        entry = next(item for item in manifest['relations'] if item['relation'] == name)
        entry.update(file_sha256=hashlib.sha256(raw).hexdigest(), row_count=len(rows))
    update_manifest(path, hashes)


def test_frozen_package_schema_grains_provenance_and_nullable_findings():
    package = validate_package(FIXTURE)
    assert package.manifest_sha256 == 'a72f9aaa407128780a71b93bd7b0f50ed60a05dac7ba6af7a95a5f68dc6197ae'
    assert package.fingerprint == '690bc3b2a1135eba88a15c66d1eb98784bf1019c24cb4647f5ca544b35108e77'
    assert sum(map(len, SCHEMA.values())) == 147
    assert sum(map(len, package.relations.values())) == 111
    assert package.manifest['platform_source_snapshot_at'].startswith('2356-')
    assert package.summary()['source_watermarks_are_synthetic'] is True
    findings = package.relations['fact_marketing_ops_finding']
    assert sum(row['condition_present'] is True for row in findings) == 11
    assert sum(row['condition_present'] is False for row in findings) == 44
    assert sum(row['condition_present'] is None for row in findings) == 18
    assert all(row['condition_present'] is None for row in findings if row['evaluation_status'] == 'UNAVAILABLE')
    assert any(row['account_id'].startswith('000') for row in package.relations['bridge_native_campaign_media_line'])


@pytest.mark.parametrize('change', [
    lambda m: m.update(environment='production'),
    lambda m: m.update(synthetic_only=False),
    lambda m: m.update(contract_version='unreviewed-v2'),
    lambda m: m.update(snapshot_at='2026-10-01T04:05:27'),
    lambda m: m.update(covered_month_from='2026-10-02'),
    lambda m: m.update(hub_operating_from_month='2026-10-01'),
    lambda m: m.update(private_approver='forbidden'),
    lambda m: m['relations'].pop(),
    lambda m: m['relations'][0].update(row_count=1000),
    lambda m: m['relations'][0].update(file='../private.json'),
    lambda m: m['relations'][0]['columns'].reverse(),
    lambda m: m['relations'][0]['columns'][0].update(nullable=1),
    lambda m: m['control_totals'].update(platform_resolved='9999.00'),
    lambda m: m['control_totals']['card_cash'].update(assigned='1.00'),
])
def test_bad_manifest_is_rejected_before_use(package_dir, change):
    update_manifest(package_dir, change)
    with pytest.raises(ValueError):
        validate_package(package_dir)


@pytest.mark.parametrize(('name', 'change'), [
    ('dim_media_line', lambda rows: rows.append(copy.deepcopy(rows[0]))),
    ('dim_media_line', lambda rows: rows[0].update(line_key=None)),
    ('dim_media_line', lambda rows: rows[0].update(snapshot_id=str(uuid4()))),
    ('dim_media_line', lambda rows: rows[0].update(scope_id=123)),
    ('dim_media_line', lambda rows: rows[0].update(private_note='forbidden')),
    ('dim_media_line', lambda rows: rows[0]['components'][0].update(gross_amount=100.00)),
    ('dim_media_line', lambda rows: rows[0]['components'][0].update(cardholder_name='forbidden')),
    ('dim_media_line', lambda rows: next(item for row in rows for component in row['components'] for item in component['budget_items']).update(amount='0.001')),
    ('dim_media_line', lambda rows: next(row for row in rows if row['is_applicable']).update(approved_gross='1.00')),
    ('dim_media_line', lambda rows: next(row for row in rows if row['is_applicable']).update(approved_media='0.01')),
    ('dim_media_line', lambda rows: next(row for row in rows if row['is_applicable']).update(revision_status='SUPERSEDED')),
    ('bridge_native_campaign_media_line', lambda rows: rows[0].update(account_id=1234567890)),
    ('bridge_native_campaign_media_line', lambda rows: next(row for row in rows if row['line_key']).update(revision_key=str(uuid4()))),
    ('bridge_native_campaign_media_line', lambda rows: rows[0].update(month='2096-10-02')),
    ('fact_media_line_monthly', lambda rows: rows[0].update(platform_media_spend=100.00)),
    ('fact_media_line_monthly', lambda rows: next(row for row in rows if row['media_cpl']).update(media_cpl='0.01')),
    ('fact_media_line_monthly', lambda rows: next(row for row in rows if row['media_budget_used_pct']).update(media_budget_used_pct='0.01')),
    ('fact_media_line_monthly', lambda rows: next(row for row in rows if row['budget_basis']=='PERIOD').update(approved_month_gross='100.00')),
    ('fact_marketing_ops_finding', lambda rows: rows[0].update(finding_key='0'*64)),
    ('fact_marketing_ops_finding', lambda rows: next(row for row in rows if row['evaluation_status']=='UNAVAILABLE').update(condition_present=False)),
    ('fact_marketing_ops_finding', lambda rows: rows[0]['observed'].update(card_number='forbidden')),
    ('fact_marketing_ops_finding', lambda rows: rows[0].update(control_code='C9')),
])
def test_deep_contract_failures_survive_recomputed_file_hash(package_dir, name, change):
    update_rows(package_dir, name, change)
    with pytest.raises(ValueError):
        validate_package(package_dir)


@pytest.mark.parametrize('kind', ['missing', 'extra', 'hash', 'duplicate_json', 'nonfinite', 'utf16'])
def test_missing_extra_corrupt_or_ambiguous_files_are_rejected(package_dir, kind):
    path = package_dir / 'manifest.json'
    if kind == 'missing':
        (package_dir / 'dim_media_line.json').unlink()
    elif kind == 'extra':
        (package_dir / 'private.json').write_text('[]', encoding='utf-8')
    elif kind == 'hash':
        table = package_dir / 'dim_media_line.json'
        table.write_bytes(table.read_bytes() + b' ')
    elif kind == 'duplicate_json':
        path.write_text(path.read_text().replace('"environment": "test"', '"environment": "test", "environment": "test"'), encoding='utf-8')
    elif kind == 'nonfinite':
        path.write_text(path.read_text().replace('"synthetic_only": true', '"synthetic_only": NaN'), encoding='utf-8')
    else:
        path.write_bytes(path.read_text(encoding='utf-8').encode('utf-16'))
    with pytest.raises(ValueError):
        validate_package(package_dir)


def test_dry_run_does_not_read_credentials_connect_or_write(package_dir, monkeypatch, capsys):
    before = {path.name: path.read_bytes() for path in package_dir.iterdir() if path.is_file()}
    apply = AsyncMock(side_effect=AssertionError('Dry run must not apply'))
    monkeypatch.setattr(stage, 'apply_local', apply)
    monkeypatch.setattr(stage, 'ROOT', package_dir / 'missing-local-config')
    assert stage.main(['--package', str(package_dir)]) == 0
    assert 'VALIDATED_DRY_RUN' in capsys.readouterr().out
    apply.assert_not_called()
    assert before == {path.name: path.read_bytes() for path in package_dir.iterdir() if path.is_file()}


def test_malformed_package_never_reaches_database(package_dir, monkeypatch, capsys):
    update_manifest(package_dir, lambda manifest: manifest.update(environment='production'))
    apply = AsyncMock(side_effect=AssertionError('Invalid package must not apply'))
    monkeypatch.setattr(stage, 'apply_local', apply)
    assert stage.main(['--package', str(package_dir), '--apply']) == 1
    apply.assert_not_called()
    assert 'no partial snapshot' in capsys.readouterr().err


def test_cli_reports_quarantine_and_never_prints_private_errors(monkeypatch, capsys):
    apply = AsyncMock(return_value={'status': 'QUARANTINED', 'issues': ['SNAPSHOT_CONTENT_CONFLICT']})
    monkeypatch.setattr(stage, 'apply_local', apply)
    assert stage.main(['--package', str(FIXTURE), '--apply', '--expected-current', 'none']) == 1
    assert apply.call_args.kwargs['expected_snapshot_id'] is None
    assert 'QUARANTINED' in capsys.readouterr().out
    apply.side_effect = RuntimeError('secret-password-must-not-print')
    assert stage.main(['--package', str(FIXTURE), '--apply']) == 1
    assert 'secret-password' not in capsys.readouterr().err


@pytest.mark.parametrize('change', [{'host': 'remote.example'}, {'port': 5432}, {'database': 'production'}])
def test_apply_refuses_nonlocal_config_before_connect(tmp_path, monkeypatch, change):
    config = {'adminPassword': 'synthetic-private-only', **stage.LOCAL_TARGET, **change}
    directory = tmp_path / '.local'
    directory.mkdir()
    (directory / 'development.json').write_text(json.dumps(config), encoding='utf-8')
    monkeypatch.setattr(stage, 'ROOT', tmp_path)
    import asyncpg
    connect = AsyncMock(side_effect=AssertionError('Nonlocal target must not connect'))
    monkeypatch.setattr(asyncpg, 'connect', connect)
    with pytest.raises(ValueError, match='fixed local'):
        asyncio.run(stage.apply_local(validate_package(FIXTURE)))
    connect.assert_not_called()


@pytest.mark.parametrize('fails', [False, True])
def test_apply_uses_one_guarded_transaction_and_closes_on_failure(tmp_path, monkeypatch, fails):
    local = tmp_path / '.local'
    local.mkdir()
    (local / 'development.json').write_text(json.dumps({'adminPassword': 'private-synthetic-value'}), encoding='utf-8')
    monkeypatch.setattr(stage, 'ROOT', tmp_path)
    connection = MagicMock()
    connection.fetchrow = AsyncMock(return_value=stage.LOCAL_TARGET)
    connection.execute = AsyncMock()
    connection.set_type_codec = AsyncMock()
    connection.close = AsyncMock()
    result = {'status': 'APPLIED', 'snapshot_id': 'synthetic'}
    connection.fetchval = AsyncMock(side_effect=['prior-snapshot', RuntimeError('failure') if fails else result])
    transaction = connection.transaction.return_value
    import asyncpg
    connect = AsyncMock(return_value=connection)
    monkeypatch.setattr(asyncpg, 'connect', connect)
    package = validate_package(FIXTURE)
    if fails:
        with pytest.raises(RuntimeError):
            asyncio.run(stage.apply_local(package))
        assert transaction.__aexit__.call_args.args[0] is RuntimeError
    else:
        assert asyncio.run(stage.apply_local(package)) == result
        assert transaction.__aexit__.call_args.args[0] is None
    transaction.__aenter__.assert_awaited_once()
    connection.close.assert_awaited_once()
    assert connection.fetchval.call_args.args == (
        'SELECT ads.apply_ads_actuals($1,$2,$3,$4)', package.manifest, package.relations,
        package.fingerprint, 'prior-snapshot')
    assert connect.call_args.kwargs['host'] == '127.0.0.1'
    assert connect.call_args.kwargs['port'] == 55432
    assert any('SET LOCAL ROLE admin' in call.args[0] for call in connection.execute.call_args_list)


@pytest.mark.integration
@pytest.mark.skipif(os.getenv('HUB_ACTUALS_IMPORT_TEST') != '1', reason='Explicit local migrated read-back acceptance only')
def test_real_import_replay_conflict_and_failed_rows_preserve_last_good():
    """Exercise the real guard/function inside an outer rollback, retaining demo state."""
    import asyncpg

    async def run():
        package = validate_package(FIXTURE)
        config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
        connection = await asyncpg.connect(**stage.LOCAL_TARGET, user='postgres', password=config['adminPassword'])
        outer = connection.transaction()
        await outer.start()
        try:
            await connection.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
            # Read the current TEST generation as local administrator before dropping privilege.
            current_at = await connection.fetchval('SELECT max(snapshot_at) FROM staging.ads_actuals_batch WHERE status=$1', 'APPLIED')
            # A complete replacement must retain every current finding identity,
            # including the coherent demo's additions beyond the frozen package.
            baseline = await connection.fetchrow('SELECT b.manifest,b.relations FROM staging.ads_actuals_current c JOIN staging.ads_actuals_batch b ON b.id=c.batch_id')
            base_manifest = baseline['manifest'] if baseline else package.manifest
            base_relations = baseline['relations'] if baseline else package.relations
            stamp = max(current_at or datetime.now(timezone.utc), datetime.now(timezone.utc)) + timedelta(seconds=1)
            await connection.execute('SET LOCAL ROLE admin')
            await connection.execute("SELECT set_config('app.actor_id',$1,true)", stage.ADMIN_ACTOR)
            current = await connection.fetchval('SELECT ads.actuals_current_snapshot()')

            def generation(when):
                manifest, relations = copy.deepcopy(base_manifest), copy.deepcopy(base_relations)
                identifier, timestamp = str(uuid4()), when.isoformat()
                manifest.update(snapshot_id=identifier, snapshot_at=timestamp, exported_at=timestamp)
                for entry in manifest['relations']:
                    entry['snapshot_at'] = timestamp
                for rows in relations.values():
                    for row in rows:
                        row.update(snapshot_id=identifier, snapshot_at=timestamp)
                return manifest, relations

            async def apply(manifest, relations, expected):
                fingerprint = hashlib.sha256(canonical({'manifest': manifest, 'relations': relations})).hexdigest()
                return await connection.fetchval('SELECT ads.apply_ads_actuals($1,$2,$3,$4)', manifest, relations, fingerprint, expected)

            manifest, relations = generation(stamp)
            accepted = await apply(manifest, relations, current)
            assert accepted['status'] == 'APPLIED'
            replay = await apply(manifest, relations, current)  # An exact replay ignores a stale optimistic pointer.
            assert replay['status'] == 'NOOP' and replay['batch_id'] == accepted['batch_id']
            conflict = copy.deepcopy(manifest)
            conflict['exported_at'] = (stamp + timedelta(microseconds=1)).isoformat()
            result = await apply(conflict, relations, manifest['snapshot_id'])
            assert result['status'] == 'QUARANTINED' and 'SNAPSHOT_CONTENT_CONFLICT' in result['issues']
            newer, malformed = generation(stamp + timedelta(seconds=1))
            malformed['fact_media_line_monthly'][0]['revision_key'] = str(uuid4())
            failed = await apply(newer, malformed, manifest['snapshot_id'])
            assert failed['status'] == 'QUARANTINED' and 'INVALID_SOURCE_ROWS' in failed['issues']
            assert await connection.fetchval('SELECT ads.actuals_current_snapshot()') == manifest['snapshot_id']
            # Inspect counts as the connection owner, then rollback all test batches/history.
            await connection.execute('RESET ROLE')
            assert await connection.fetchval('SELECT count(*) FROM staging.ads_actuals_dim WHERE batch_id=$1', accepted['batch_id']) == len(base_relations['dim_media_line'])
            assert await connection.fetchval('SELECT count(*) FROM staging.ads_actuals_finding WHERE batch_id=$1', accepted['batch_id']) == len(base_relations['fact_marketing_ops_finding'])
            assert await connection.fetchval('SELECT count(*) FROM staging.ads_actuals_dim WHERE batch_id=$1', failed['batch_id']) == 0
        finally:
            await outer.rollback()
            await connection.close()

    asyncio.run(run())
