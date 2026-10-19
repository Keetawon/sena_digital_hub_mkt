"""Synthetic-only transfer checks; database tests use the disposable cluster."""
import asyncio
import importlib.util
import json
from pathlib import Path
import secrets
import ssl
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import asyncpg
import pytest

from test_permission_baseline import ROOT, disposable_operator
from test_public_website_import import sample, mapping, intake

spec = importlib.util.spec_from_file_location('hosted_public_transfer', ROOT / 'scripts/transfer-sena-public.py')
transfer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transfer)


def identity(pid='TRANSFER-TEST'):
    draft = {'rem_project_id': pid, 'sources': [{'url': sample()['url']}]}
    sheet = {'fetched_at': sample()['fetched_at'], 'source_sha256': 'a' * 64, 'rows': [
        {'Project ID': pid, 'Project': 'โครงการสังเคราะห์', 'Project Name EN': 'Synthetic project', 'sheet_row': 2,
         'REM Project Name': 'DO NOT COPY', 'rem': {'ProjectStatus': 2}, 'Project Group ID': 'NOT A DW GROUP'}]}
    return transfer.public_identity(draft, sheet)


def test_public_projection_excludes_rem_data_and_does_not_claim_known_status():
    result = identity()
    text = json.dumps(result)
    assert all(k not in text for k in ('DO NOT COPY', 'ProjectStatus', 'Project Group ID', 'NOT A DW GROUP'))
    assert result['source_record']['rem_status_unverified'] is True
    card = transfer.public_card(result)
    assert card['status']['raw'] is None and card['publication_version_id'] is None
    assert card['status']['source_ref'].startswith('https://www.sena.co.th/')


def test_shared_exact_project_id_preserves_both_public_names():
    draft = {'rem_project_id': 'SYNTHETIC', 'sources': [{'url': sample()['url']}]}
    sheet = {'fetched_at': sample()['fetched_at'], 'source_sha256': 'a' * 64, 'rows': [
        {'Project ID': 'SYNTHETIC', 'Project': 'โครงการ SH', 'sheet_row': 2},
        {'Project ID': 'SYNTHETIC', 'Project': 'โครงการ TH', 'sheet_row': 3}]}
    result = transfer.public_identity(draft, sheet)
    assert result['name']['th'] == 'โครงการ SH / โครงการ TH'
    assert result['source_record']['sheet_rows'] == [2, 3]


def test_candidate_sanitization_preserves_holds_and_source_but_not_paths():
    rows, _, _ = intake.build_rows([sample()], [], [], [mapping()], Path('.'), 'b' * 64)
    row = rows[0]
    row['holds'] = ['needs_phase_decision', 'review_required']
    row['evidence']['source_text'] = 'CONTACT:\nPublic website text'
    row['evidence']['locations'] = [{'package': 'C:\\private', 'blob': 'original'}]
    clean = transfer.sanitize_candidate(row)
    assert clean['holds'] == row['holds'] and clean['id'] == row['id']
    assert 'locations' not in clean['evidence'] and 'locations' in row['evidence']
    row['evidence']['source_record'] = {'ProjectStatus': 2}
    with pytest.raises(ValueError, match='non_public_evidence_field'):
        transfer.sanitize_candidate(row)


@pytest.mark.parametrize('url', ['postgresql://postgres@localhost:55432/postgres',
    'postgresql://postgres@db.other.supabase.co/postgres',
    'postgresql://postgres@db.eqlrtevwpyboplljgowo.supabase.co/postgres?sslmode=disable'])
def test_transfer_cannot_target_local_other_project_or_unverified_tls(url):
    with pytest.raises(ValueError, match='wrong_test_database'):
        transfer.checked_dsn(url)


def test_transfer_accepts_only_exact_test_operator_target():
    url = f'postgresql://postgres:{secrets.token_hex(16)}@db.{transfer.HOSTED_TEST_REF}.supabase.co:5432/postgres'
    assert transfer.checked_dsn(url) == url


@pytest.mark.parametrize('encrypted', [True, False])
def test_connection_checks_client_tls_not_the_pooler_backend(monkeypatch, encrypted):
    context = ssl.create_default_context()
    tls = SimpleNamespace(context=context, version=lambda: 'TLSv1.3', getpeercert=lambda: {'verified': True}) if encrypted else None
    db = SimpleNamespace(_transport=SimpleNamespace(get_extra_info=lambda key: tls),
                         set_type_codec=AsyncMock(), close=AsyncMock())
    monkeypatch.setenv('HUB_TRANSFER_CA_FILE', 'synthetic-ca-path')
    monkeypatch.setattr(transfer.ssl, 'create_default_context', lambda **kwargs: context)
    monkeypatch.setattr(transfer.asyncpg, 'connect', AsyncMock(return_value=db))
    if encrypted:
        assert asyncio.run(transfer.connect('synthetic-dsn')) is db
        assert db.set_type_codec.await_count == 2
    else:
        with pytest.raises(ValueError, match='database_tls_required'):
            asyncio.run(transfer.connect('synthetic-dsn'))
        db.close.assert_awaited_once()


def test_files_deduplicate_and_changed_source_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(transfer, 'ROOT', tmp_path)
    capture = tmp_path / '.local/knowledge-intake/capture'
    capture.mkdir(parents=True)
    raw = b'synthetic original'
    digest = intake.sha(raw)
    file = capture / digest
    file.write_bytes(raw)
    intake.write(tmp_path / 'local-file-locations.json', {digest: str(file)})
    evidence = {'sha256': digest, 'bytes': len(raw), 'storage_bucket': transfer.BUCKET}
    rows = [{'kind': 'asset', 'evidence': evidence}] * 2
    class Storage:
        def install_knowledge(self, content, e):
            assert content == raw and e == evidence
            return True
    assert transfer.upload_files(tmp_path, rows, Storage()) == {'verified': 1, 'created': 1, 'existing': 0}
    file.write_bytes(b'changed')
    with pytest.raises(ValueError, match='local_asset_changed'):
        transfer.upload_files(tmp_path, rows, Storage())


def test_hosted_transfer_atomic_replay_preserves_human_fields_and_denies_noneditor():
    async def check():
        db = await disposable_operator()
        for kind in ('json', 'jsonb'):
            await db.set_type_codec(kind, schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        outer = db.transaction(); await outer.start()
        try:
            pid = 'TRANSFER-TEST'
            rows, drafts, _ = intake.build_rows([sample(pid)], [], [], [mapping(pid)], Path('.'), '8' * 64)
            before = await transfer.preserved_state(db)
            result = await transfer.import_rows(db, UUID(int=1), '9' * 64, {'synthetic': True}, rows, drafts, [identity(pid)])
            assert result['created_projects'] == [pid] and result['filled_projects'] == [pid]
            assert await transfer.preserved_state(db) == before
            project = await db.fetchrow('SELECT * FROM hub.projects WHERE rem_project_id=$1', pid)
            assert project['public_name']['th'] == identity(pid)['name']['th']
            assert project['website_content'] == drafts[0]['website_content']
            raw = await db.fetchval('SELECT source_record FROM staging.rem_projects WHERE rem_project_id=$1', pid)
            assert raw['rem_status_unverified'] is True and 'ProjectStatus' not in raw
            replay = await transfer.import_rows(db, UUID(int=1), '9' * 64, {}, rows, drafts, [identity(pid)])
            assert replay['replay'] and not replay['created_projects']
            await db.execute("UPDATE hub.projects SET website_content=$1,public_name=$2 WHERE id=$3",
                             {'th': 'แก้ไขโดยเจ้าหน้าที่'}, {'th': 'ชื่อจากเจ้าหน้าที่'}, project['id'])
            rows2, drafts2, _ = intake.build_rows([sample(pid)], [], [], [mapping(pid)], Path('.'), 'a' * 64)
            later = await transfer.import_rows(db, UUID(int=1), 'b' * 64, {}, rows2, drafts2, [identity(pid)])
            assert later['preserved_projects'] == [pid]
            assert await db.fetchval('SELECT public_name FROM hub.projects WHERE id=$1', project['id']) == {'th': 'ชื่อจากเจ้าหน้าที่'}
            assert await db.fetchval('SELECT website_content FROM hub.projects WHERE id=$1', project['id']) == {'th': 'แก้ไขโดยเจ้าหน้าที่'}
            assert await transfer.preserved_state(db) == before
            denied_pid = 'TRANSFER-DENIED'
            rows3, drafts3, _ = intake.build_rows([sample(denied_pid)], [], [], [mapping(denied_pid)], Path('.'), 'c' * 64)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                async with db.transaction():
                    await transfer.import_rows(db, UUID(int=3), 'd' * 64, {}, rows3, drafts3, [identity(denied_pid)])
            assert not await db.fetchval('SELECT EXISTS(SELECT 1 FROM staging.knowledge_batches WHERE manifest_sha256=$1)', 'd' * 64)
            assert not await db.fetchval('SELECT EXISTS(SELECT 1 FROM staging.rem_projects WHERE rem_project_id=$1)', denied_pid)
            assert not await db.fetchval('SELECT EXISTS(SELECT 1 FROM hub.entity_versions WHERE project_id=$1)', project['id'])
        finally:
            await outer.rollback()
            await db.close()
    asyncio.run(check())
