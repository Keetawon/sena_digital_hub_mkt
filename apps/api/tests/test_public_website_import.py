"""Synthetic evidence only; mutation tests run inside disposable DB rollbacks."""
import asyncio
import importlib.util
import json
from pathlib import Path

import asyncpg
import pytest

from test_permission_baseline import ROOT, disposable_operator
from test_permission_foundations import permission_accounts, h
from test_permission_db_baseline import runtime
from test_permission_content import call
from sena_hub_api.knowledge_progress import summarize

spec = importlib.util.spec_from_file_location('public_import', ROOT / 'scripts/import-sena-public.py')
intake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(intake)


def sample(pid='0001'):
    return {'url': 'https://www.sena.co.th/project/synthetic', 'project_ids': [pid],
            'fetched_at': '2026-10-15T00:00:00Z', 'sections': [
                {'heading': 'แนวคิด', 'text': 'เนื้อหาสังเคราะห์สำหรับทดสอบ', 'locator': '#concept'}],
            'website': {'title': 'โครงการทดสอบ', 'description': 'คำอธิบายทดสอบ',
                        'faqs': [{'question': 'เดินทางอย่างไร', 'answer': 'ข้อมูลสังเคราะห์', 'locator': 'faq1'}]}}


def mapping(pid='0001'):
    return {'Project ID': pid, 'rem': {'project_name_rem': 'โครงการทดสอบ', 'source_record': {'ProjectStatus': '2'}}}


def test_public_import_exact_ids_shared_phases_and_multiple_urls(tmp_path):
    page = sample(); page['project_ids'] += ['0002', 'MISSING']
    second = {**sample(), 'url': 'https://www.sena.co.th/project/other-synthetic'}
    rows, drafts, cards = intake.build_rows([page, second], [], [], [mapping(), mapping('0002')], tmp_path, 'a' * 64)
    assert {d['rem_project_id'] for d in drafts} == {'0001', '0002'}
    assert len(drafts[0]['sources']) == 2 and 'other-synthetic' in drafts[0]['website_content']['th']
    assert rows[0]['project_ids'] == ['0001', '0002']
    assert rows[0]['evidence']['source_project_ids'] == ['0001', '0002', 'MISSING']
    assert rows[0]['holds'] == ['needs_phase_decision']
    assert cards[0]['payload']['status']['as_of'] is None
    assert all('embedding' not in r['evidence'] and not r.get('review') for r in rows)
    replay = intake.build_rows([page, second], [], [], [mapping(), mapping('0002')], tmp_path, 'a' * 64)
    assert replay == (rows, drafts, cards)
    newer = intake.build_rows([page], [], [], [mapping()], tmp_path, 'b' * 64)
    assert newer[0][0]['id'] != rows[0]['id']


@pytest.mark.parametrize('url', ['https://sena.co.th.attacker.invalid/', 'http://sena.co.th/', 'https://user:secret@sena.co.th/', 'https://127.0.0.1/', 'https://sena.co.th:444/'])
def test_public_import_refuses_non_public_source_urls(url):
    with pytest.raises(ValueError):
        intake.source_url(url)


def test_public_website_attribution_never_counts_as_a_review():
    result = summarize('0001', [{'kind': 'section', 'project_ids': ['0001'], 'holds': [], 'source_ref': 'sena-public:test'}])
    assert result['has_public_website'] and result['reviewed'] == 0
    assert result['last_reviewed_by'] is None and result['state'] == 'not_started'


def test_unavailable_files_remain_visible_as_gaps_without_fabricated_assets(tmp_path):
    unavailable = {'status': 'fetch_failed', 'url': 'https://content.sena.co.th/storage/synthetic.webp',
                   'references': [{'page_url': sample()['url'], 'project_ids': ['0001']}], 'http_status': 403}
    rows, _, _ = intake.build_rows([sample()], [unavailable], [], [mapping()], tmp_path, 'a' * 64)
    gaps = [r for r in rows if r['kind'] == 'gap']
    assert len(gaps) == 1 and gaps[0]['evidence']['http_status'] == 403
    assert gaps[0]['source_url'] == sample()['url']
    assert not any(r['kind'] == 'asset' for r in rows)


def test_identical_trailing_slash_alias_does_not_duplicate_project_text(tmp_path):
    page = sample()
    alias = {**page, 'url': page['url'] + '/'}
    rows, drafts, _ = intake.build_rows([page, alias], [], [], [mapping()], tmp_path, 'a' * 64)
    assert len(rows) == 2 and len(drafts[0]['sources']) == 1


def test_unvalidated_brochure_is_retained_but_cannot_be_treated_as_valid_media(tmp_path):
    raw = b'%PDF-synthetic-invalid'
    digest = intake.sha(raw)
    (tmp_path / digest).write_bytes(raw)
    file = {'status': 'downloaded', 'url': 'https://www.sena.co.th/synthetic.pdf',
            'sha256': digest, 'blob': digest, 'bytes': len(raw), 'mime': 'application/pdf', 'fetched_at': sample()['fetched_at'],
            'references': [{'page_url': sample()['url'], 'project_ids': ['0001']}]}
    rows, _, _ = intake.build_rows([sample()], [file], [], [mapping()], tmp_path, 'a' * 64)
    asset = next(r for r in rows if r['kind'] == 'asset')
    assert asset['evidence']['classification']['role'] == 'brochure'
    assert asset['evidence']['validated_metadata'] is None and asset['evidence']['file_validation_error']
    assert asset['evidence']['classification']['people'] == 'unknown'


def test_import_cli_refuses_even_loopback_when_the_data_directory_is_not_working():
    with pytest.raises(ValueError, match='working_local_only_guard'):
        asyncio.run(intake.connect_working())


def test_website_draft_real_sql_edit_check_stale_guard_and_immutable_source(permission_accounts):
    _, ids = permission_accounts
    async def check():
        operator = await disposable_operator()
        row = await operator.fetchrow('SELECT id,updated_at,public_project_id FROM hub.projects WHERE deleted_at IS NULL LIMIT 1')
        await operator.close()
        db = await runtime()
        for typename in ('json', 'jsonb'):
            await db.set_type_codec(typename, schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction = db.transaction(); await transaction.start()
        try:
            for role in ('viewer', 'publisher'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids[role], 'SELECT hub.patch_project($1,$2,$3)', row['id'], {'website_content': {'th': 'ทดสอบ'}}, row['updated_at'])
            result = await call(db, ids['editor'], 'SELECT hub.patch_project($1,$2,$3)', row['id'], {'website_content': {'th': 'ทดสอบ'}}, row['updated_at'])
            assert result['website_content']['th'] == 'ทดสอบ'
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], 'SELECT hub.patch_project($1,$2,$3)', row['id'], {'website_content': {'th': 'stale'}}, row['updated_at'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], 'SELECT hub.patch_project($1,$2,$3)', row['id'], {'website_sources': [{'url': 'https://www.sena.co.th/fake'}]}, row['updated_at'])
            # Table policy must also deny direct writes, not merely the RPC.
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], "UPDATE hub.projects SET website_content='{}' WHERE id=$1 RETURNING id", row['id'])
            assert not await call(db, ids['viewer'], "SELECT has_function_privilege('hub_app','hub.draft_payload(uuid)','execute')")
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'SELECT hub.patch_project($1,$2,$3)', row['id'],
                           {'website_content': {'th': {'nested': 'invalid'}}},
                           await call(db, ids['editor'], 'SELECT updated_at FROM hub.projects WHERE id=$1', row['id']))
        finally:
            await transaction.rollback(); await db.close()
    asyncio.run(check())


def test_public_import_atomic_replay_preserves_edits_reviews_and_accounts():
    async def check():
        db = await disposable_operator()
        for typename in ('json', 'jsonb'):
            await db.set_type_codec(typename, schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction = db.transaction(); await transaction.start()
        try:
            p = await db.fetchrow('SELECT * FROM hub.projects WHERE deleted_at IS NULL ORDER BY id LIMIT 1')
            pid = p['rem_project_id']
            rows, drafts, cards = intake.build_rows([sample(pid)], [], [], [mapping(pid)], Path('.'), 'c' * 64)
            before = await intake.preserved_state(db)
            result = await intake.import_rows(db, 'd' * 64, {'synthetic': True}, rows, drafts, cards)
            assert not result['replay'] and pid in result['filled_projects']
            after = await db.fetchrow('SELECT * FROM hub.projects WHERE id=$1', p['id'])
            for key in set(p.keys()) - {'website_content', 'updated_at', 'updated_by'}:
                assert after[key] == p[key], key
            assert await intake.preserved_state(db) == before
            replay = await intake.import_rows(db, 'd' * 64, {'synthetic': True}, rows, drafts, cards)
            assert replay['replay'] and not replay['filled_projects']
            # A later package retains evidence, but does not replace the edited draft.
            await db.execute("SELECT set_config('app.actor_id',$1,true)", str(intake.ACTOR))
            await db.execute("UPDATE hub.projects SET website_content='{" + '"th":"human edit"' + "}'::jsonb WHERE id=$1", p['id'])
            rows2, drafts2, cards2 = intake.build_rows([sample(pid)], [], [], [mapping(pid)], Path('.'), 'e' * 64)
            result = await intake.import_rows(db, 'f' * 64, {'synthetic': True}, rows2, drafts2, cards2)
            assert result['preserved_projects'] == [pid]
            assert await db.fetchval("SELECT website_content->>'th' FROM hub.projects WHERE id=$1", p['id']) == 'human edit'
            assert await intake.preserved_state(db) == before
        finally:
            await transaction.rollback(); await db.close()
    asyncio.run(check())


def test_website_api_validation_and_permission(permission_accounts):
    client, _ = permission_accounts
    async def get_project():
        db = await disposable_operator()
        try:
            return dict(await db.fetchrow('SELECT public_project_id,updated_at FROM hub.projects WHERE deleted_at IS NULL LIMIT 1'))
        finally:
            await db.close()
    project = asyncio.run(get_project())
    path = '/v1/admin/projects/' + project['public_project_id']
    body = {'updated_at': project['updated_at'].isoformat(), 'website_content': {'th': 'ทดสอบ'}}
    assert client.patch(path, headers=h('viewer'), json=body).status_code == 403
    assert client.patch(path, headers=h('editor'), json={**body, 'website_content': {'th': 'x' * 200001}}).status_code == 422
    assert client.patch(path, headers=h('editor'), json={**body, 'website_sources': []}).status_code == 422
    assert client.get(path, headers=h('editor')).json()['data']['website_content'] == {}
