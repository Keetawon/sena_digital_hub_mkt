"""Full synthetic intake/refresh in the disposable runner; no real package required."""
import asyncio
from copy import deepcopy
import importlib.util
import json
from pathlib import Path

import asyncpg
import pytest
from sena_hub_api.auth import DEMO_ACTORS
from sena_hub_api.project_progress import build_progress

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('stage_projects', ROOT / 'scripts/stage-dw-projects.py')
stage = importlib.util.module_from_spec(spec); spec.loader.exec_module(stage)


def package():
    folder = ROOT / 'supabase/tests/fixtures/dw_projects'
    return stage.review.load_package(folder, (folder / 'manifest.sha256').read_text().split()[0])


def test_frozen_contract_and_explicit_discard_policy_preserve_exact_spaces():
    data = package()
    assert stage.review.coverage_conflicts(data)
    assert not stage.review.coverage_conflicts(data, True)
    records, omitted = stage.records(data, True)
    assert omitted == {('SYN-DW-A', '099')}
    assert ('models', 'SYN-DW-A', '002 ') in records
    assert ('models', 'SYN-DW-A', '002') not in records
    changed = deepcopy(data); changed['datasets']['exceptions'] = []
    assert stage.review.coverage_conflicts(changed, True)


def test_transactional_intake_replay_refresh_conflict_acl_and_staff_guards():
    async def run():
        config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf8'))
        db = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local', user='postgres', password=config['adminPassword'])
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        try:
            original = package()
            original['datasets']['project_groups'] = [dict(project_group_id='SYN-G', project_name_th='กลุ่มจำลอง',
                project_name_en='Synthetic group', member_count=5, project_id_set=[r['ProjectID'] for r in original['datasets']['projects']],
                source_snapshot_at='2026-10-05T07:00:00+07:00')]
            before = await db.fetchval("SELECT count(*) FROM staging.intake_batches")
            preview = await stage.stage_package(db, original, True)
            assert preview['discarded_deleted_models'] == 1
            assert await db.fetchval("SELECT count(*) FROM staging.intake_batches") == before
            applied = await stage.stage_package(db, original, True, True)
            assert applied['status'] == 'staged' and applied['mirror_inserts'] == {'projects': 5, 'models': 3, 'gold_projects': 5}
            assert applied['project_groups'] == {'new': 1}
            grouped = await db.fetchval("SELECT summary FROM hub.project_progress_cache WHERE rem_project_id='SYN-DW-A'")
            assert grouped['marketing_group_name_th'] == 'กลุ่มจำลอง' and grouped['group_status'] == 'marketing_reference'
            assert grouped['group_provenance']['manifest_sha256'] == original['manifest_sha256'] and grouped['group_mismatch'] is False
            assert not await db.fetchval("SELECT EXISTS(SELECT 1 FROM staging.rem_models WHERE rem_project_id='SYN-DW-A' AND rem_model_id='099')")
            first_seen = await db.fetchval("SELECT first_seen_at FROM staging.rem_projects WHERE rem_project_id='SYN-DW-A'")
            assert await db.fetchval("SELECT bool_and(first_seen_at=$1) FROM staging.rem_models WHERE rem_project_id LIKE 'SYN-DW-%'", first_seen)
            # Existing content is created by a separate, explicit synthetic staff action.
            await db.execute("SELECT set_config('app.actor_id',$1,false)", str(DEMO_ACTORS['editor']))
            async with db.transaction():
                await db.execute('SET LOCAL ROLE editor')
                project_id = await db.fetchval("SELECT hub.create_project_from_rem('SYN-DW-A')")
                conflict_id = await db.fetchval("SELECT hub.create_project_from_rem('SYN-DW-CONFLICT')")
                missing_id = await db.fetchval("SELECT hub.create_project_from_rem('SYN-DW-MISSINGBRAND')")
            assert await db.fetchval('SELECT public_name FROM hub.projects WHERE id=$1', conflict_id) == {}
            brand_id = await db.fetchval("SELECT id FROM hub.brands WHERE rem_brand_id='DEMO-BRAND-01'")
            async with db.transaction():
                await db.execute('SET LOCAL ROLE editor')
                stamp = await db.fetchval('SELECT updated_at FROM hub.projects WHERE id=$1', missing_id)
                with pytest.raises(asyncpg.CheckViolationError):
                    async with db.transaction():
                        await db.fetchval('SELECT hub.assign_project_brand($1,$2,$3)', missing_id, brand_id, stamp)
            await db.execute("UPDATE hub.projects SET public_name='{" + '"th":"Human edit"' + "}'::jsonb WHERE id=$1", project_id)
            await db.execute("UPDATE hub.model_types SET match_status='CONFIRMED',verified_by=$2,verified_at=now() WHERE project_id=$1", project_id, DEMO_ACTORS['editor'])
            kept = await db.fetchval("SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM hub.projects p")
            kept_models = await db.fetchval("SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM hub.model_types p")
            evidence_before = await db.fetchval('SELECT count(*) FROM staging.project_intake_evidence')
            replay = await stage.stage_package(db, original, True, True)
            assert replay['status'] == 'already_staged'
            assert await db.fetchval('SELECT count(*) FROM staging.project_group_evidence') == 1
            assert await db.fetchval('SELECT count(*) FROM staging.project_intake_evidence') == evidence_before
            refresh = deepcopy(original)
            refresh['manifest']['extracted_at'] = '2026-10-06T00:00:00+00:00'
            refresh['manifest_sha256'] = 'd' * 64
            refresh['datasets']['gold_projects'][0]['gold']['available_unit_count'] = 8
            refresh['datasets']['gold_models'][0]['available_unit_count'] = 8
            refresh['datasets']['projects'][0]['ProjectStatus'] = '3'
            refresh['datasets']['project_groups'][0]['project_name_th'] = 'ชื่อใหม่รอตรวจ'
            result = await stage.stage_package(db, refresh, True, True)
            assert result['outcomes']['models']['identical'] == 3
            assert result['project_groups'] == {'changed': 1}
            grouped = await db.fetchval("SELECT summary FROM hub.project_progress_cache WHERE rem_project_id='SYN-DW-A'")
            assert grouped['marketing_group_name_th'] == 'กลุ่มจำลอง' and grouped['group_evidence_status'] == 'changed'
            assert result['outcomes']['projects']['changed'] == 1
            assert result['outcomes']['gold_projects']['changed'] == 1 and result['outcomes']['gold_models']['changed'] == 1
            assert await db.fetchval("SELECT source_record->>'available_unit_count' FROM staging.dw_projects WHERE rem_project_id='SYN-DW-A'") == '9'
            metadata = await db.fetchval("SELECT hub.project_source_review('SYN-DW-A')")
            assert metadata['status_raw'] == '3' and metadata['flags'] == ['changed'] and not metadata['default_scope']
            assert not metadata['first_import_only']
            assert await db.fetchval("SELECT first_seen_at FROM staging.rem_projects WHERE rem_project_id='SYN-DW-A'") == first_seen
            assert await db.fetchval("SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM hub.projects p") == kept
            assert await db.fetchval("SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM hub.model_types p") == kept_models
            bad = deepcopy(refresh); bad['manifest_sha256'] = 'e' * 64; bad['manifest']['extracted_at'] = '2026-10-07T00:00:00+00:00'
            unchanged = await stage.stage_package(db, bad, True)
            assert unchanged['project_groups'] == {'identical': 1}
            bad_group = deepcopy(bad); bad_group['datasets']['project_groups'][0]['project_id_set'] = []
            with pytest.raises(ValueError, match='dictionary membership conflict'):
                await stage.stage_package(db, bad_group, True, True)
            bad['datasets']['projects'][0]['BrandID'] = 'invented-brand'
            with pytest.raises(ValueError, match='identity.*conflict'):
                await stage.stage_package(db, bad, True, True)
            assert not await db.fetchval('SELECT EXISTS(SELECT 1 FROM staging.intake_batches WHERE manifest_sha256=$1)', bad['manifest_sha256'])
            bad['datasets']['projects'][0]['BrandID'] = original['datasets']['projects'][0]['BrandID']
            bad['datasets']['gold_projects'][0]['gold']['rem_brand_id'] = 'invented-brand'
            with pytest.raises(ValueError, match='Gold identity/group conflict'):
                await stage.stage_package(db, bad, True, True)
            assert not await db.fetchval('SELECT EXISTS(SELECT 1 FROM staging.intake_batches WHERE manifest_sha256=$1)', bad['manifest_sha256'])
            missing = deepcopy(refresh); missing['manifest_sha256'] = 'f' * 64; missing['manifest']['extracted_at'] = '2026-10-08T00:00:00+00:00'
            missing['datasets']['projects'] = [r for r in missing['datasets']['projects'] if r['ProjectID'] != 'SYN-DW-CLOSED']
            missing['datasets']['gold_projects'] = [r for r in missing['datasets']['gold_projects'] if r['project_id'] != 'SYN-DW-CLOSED']
            missing['datasets']['project_groups'] = []
            await stage.stage_package(db, missing, True, True)
            assert await db.fetchval("SELECT summary->>'group_evidence_status' FROM hub.project_progress_cache WHERE rem_project_id='SYN-DW-A'") == 'missing'
            assert 'missing' in (await db.fetchval("SELECT hub.project_source_review('SYN-DW-CLOSED')"))['flags']
            assert await db.fetchval("SELECT EXISTS(SELECT 1 FROM staging.rem_projects WHERE rem_project_id='SYN-DW-CLOSED')")
            deleted = deepcopy(missing); deleted['manifest_sha256'] = 'c' * 64; deleted['manifest']['extracted_at'] = '2026-10-09T00:00:00+00:00'
            deleted['datasets']['models'][0].update(isDeleted=True, isDeleteRaw='1')
            deleted['datasets']['gold_models'] = deleted['datasets']['gold_models'][1:]
            del deleted['datasets']['project_groups']  # Older optional-file-less packages do not touch groups.
            group_evidence_count = await db.fetchval('SELECT count(*) FROM staging.project_group_evidence')
            result = await stage.stage_package(db, deleted, True, True)
            assert result['project_groups'] == {} and await db.fetchval('SELECT count(*) FROM staging.project_group_evidence') == group_evidence_count
            assert result['discarded_deleted_models'] == 1 and result['mirror_deletes'] == 0
            assert await db.fetchval("SELECT EXISTS(SELECT 1 FROM staging.rem_models WHERE rem_project_id='SYN-DW-A' AND rem_model_id='001')")
            assert await db.fetchval("SELECT outcome FROM staging.project_intake_evidence WHERE kind='models' AND rem_project_id='SYN-DW-A' AND source_id='001' ORDER BY id DESC LIMIT 1") == 'deleted'
            for table in ('staging.project_intake_evidence', 'staging.project_intake_receipts', 'staging.dw_project_groups', 'staging.project_group_evidence'):
                with pytest.raises(asyncpg.PostgresError):
                    async with db.transaction():
                        await db.execute('DELETE FROM ' + table)
                for role in ('viewer', 'editor', 'publisher', 'admin', 'service_consumer'):
                    with pytest.raises(asyncpg.InsufficientPrivilegeError):
                        async with db.transaction():
                            await db.execute('SET LOCAL ROLE ' + role)
                            await db.fetch('SELECT * FROM ' + table)
            async with db.transaction():
                await db.execute('SET LOCAL ROLE viewer')
                sources = await db.fetchval('SELECT hub.list_rem_projects()')
                assert next(r for r in sources if r['rem_project_id'] == 'SYN-DW-CONFLICT')['source_review']['gold_prefill_allowed'] is False
            payload = await db.fetchval('SELECT hub.draft_payload($1)', project_id)
            assert 'source_review' not in payload['source'] and 'ProjectStatus' not in json.dumps(payload) and '9999.25' not in json.dumps(payload)
        finally:
            await db.close()
    asyncio.run(run())


@pytest.mark.parametrize('raw,deleted,expected', [('0', False, True), ('1', False, True), ('2', False, True), ('3', False, False), ('2', True, False), ('4', False, False), (None, False, False)])
def test_status_scope_and_closed_deleted_live_attention(raw, deleted, expected):
    from test_project_progress import fixture, NOW
    record, source = fixture()
    source['source_record'] = {'ProjectStatus': raw, 'isDeleted': deleted}
    data = build_progress([record], [source], [], NOW)
    assert bool(data['counts']['all']) is expected
    assert data['rows'][0]['needs_attention'] is (deleted or raw == '3')
    assert data['rows'][0]['source_review']['status_raw'] == raw
