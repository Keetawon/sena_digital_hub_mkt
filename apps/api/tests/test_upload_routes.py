"""HTTP boundary checks; SQL policy semantics have separate disposable cases."""
from contextlib import asynccontextmanager
from types import SimpleNamespace
import hashlib
import io
from PIL import Image
import json

import asyncpg
from fastapi.testclient import TestClient
import pytest

from sena_hub_api import assets, main
from sena_hub_api.upload_admission import upload_slot
from test_api import settings, TOKENS
from test_assets import image_bytes

CONTEXT = {'v': 1, 'kind': 'project', 'ref': 'synthetic', 'category': 'exterior', 'purpose': 'media'}
HEADERS = {'Authorization': f"Bearer {TOKENS['editor']}", 'Content-Type': 'image/png',
           'X-Filename': 'synthetic.png', 'X-Upload-Context': json.dumps(CONTEXT)}


@pytest.fixture
def upload_route(monkeypatch, tmp_path):
    monkeypatch.setattr(assets, 'STORAGE_ROOT', tmp_path)
    state = SimpleNamespace(tx=0, calls=[], existing=None, winner=None, saved=None,
                            resolve_error=None, record_error=None, committed=0, encoded=0)
    resolved = {'context': CONTEXT, 'processing_class': 'marketing_raster', 'input_limit': 30 * 1024 * 1024,
                'stored_limit': 10 * 1024 * 1024, 'pixel_limit': 100_000_000,
                'coordinates': None, 'active_tags': [], 'context_stamp': 'synthetic-stamp'}

    class Connection:
        async def execute(self, sql, *args):
            assert 'asset_registered_for_cleanup' in sql or 'pg_advisory_xact_lock' in sql

        async def fetchval(self, sql, *args):
            state.calls.append(sql)
            if 'asset_upload_context' in sql:
                if state.resolve_error:
                    raise state.resolve_error
                assert args == (CONTEXT, 'image/png')
                return resolved
            if 'find_uploaded_asset_source' in sql:
                return state.existing
            if 'record_asset_upload_source' in sql:
                if state.record_error:
                    raise state.record_error
                assert args[4:] == (CONTEXT, 'synthetic-stamp')
                assert state.tx == 1
                state.saved = args
                asset = state.winner or (state.existing or {}).get('asset') or {**args[0], 'id': '10000000-0000-0000-0000-000000000001'}
                reused = state.winner is not None or state.existing is not None
                return {'asset': asset, 'reused': reused, 'reuse_kind': 'original' if reused else 'none',
                        'upload': {'original': {key: value for key, value in args[1].items() if key != 'checksum'},
                                   'processing': args[2], 'suggestions': args[3]}}
            if 'asset_registered_for_cleanup' in sql:
                return False
            raise AssertionError(sql)

    @asynccontextmanager
    async def database(request, actor):
        state.tx += 1
        try:
            yield Connection()
            state.committed += 1
        finally:
            state.tx -= 1

    original_prepare = main.prepare_supervised_upload
    async def prepare(*args, **kwargs):
        assert state.tx == 0, 'decoding must not hold the database transaction'
        state.encoded += 1
        return await original_prepare(*args, **kwargs)

    monkeypatch.setattr(main, 'database', database)
    monkeypatch.setattr(main, 'prepare_supervised_upload', prepare)
    client = TestClient(main.create_app(settings()), client=('127.0.0.1', 50000))
    return client, state


@pytest.mark.parametrize('context', [None, '', '{}', '{"v":1,"v":1,"kind":"intake"}',
    '{"v":1,"kind":"intake","processing_class":"marketing_raster"}', 'x' * 2049])
def test_context_is_validated_before_sql_or_file_read(upload_route, monkeypatch, context):
    client, state = upload_route
    async def forbidden(*args, **kwargs):
        raise AssertionError('body must not be read')
    monkeypatch.setattr(assets, 'read_upload', forbidden)
    headers = {key: value for key, value in HEADERS.items() if key != 'X-Upload-Context'}
    if context is not None:
        headers['X-Upload-Context'] = context
    response = client.post('/v1/admin/assets', headers=headers, content=b'unread')
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'invalid_upload_context'
    assert not state.calls


def test_owning_authority_is_checked_before_body_and_decoder(upload_route, monkeypatch):
    client, state = upload_route
    state.resolve_error = asyncpg.InsufficientPrivilegeError('private scope detail')
    async def forbidden(*args, **kwargs):
        raise AssertionError('body must not be read')
    monkeypatch.setattr(assets, 'read_upload', forbidden)
    response = client.post('/v1/admin/assets', headers=HEADERS, content=b'unread')
    assert response.status_code == 403
    assert 'private scope detail' not in response.text
    assert state.encoded == 0 and len(state.calls) == 1


def test_busy_upload_does_not_queue_or_read_a_body(upload_route, monkeypatch):
    client, state = upload_route
    async def forbidden(*args, **kwargs):
        raise AssertionError('busy body must not be read')
    monkeypatch.setattr(assets, 'read_upload', forbidden)
    with upload_slot():
        response = client.post('/v1/admin/assets', headers=HEADERS, content=b'unread')
    assert response.status_code == 429
    assert response.headers['retry-after'] == '1'
    assert response.headers['cache-control'] == 'no-store'
    assert state.encoded == 0


def test_new_upload_decodes_outside_transaction_and_stores_only_result(upload_route):
    client, state = upload_route
    raw = image_bytes()
    response = client.post('/v1/admin/assets', headers=HEADERS, content=raw)
    assert response.status_code == 201, response.text
    value = response.json()
    assert value['meta']['upload']['original']['size'] == len(raw)
    assert 'checksum' not in value['meta']['upload']['original']
    stored = assets.readable_file(value['data']).read_bytes()
    assert hashlib.sha256(stored).hexdigest() == value['data']['checksum']
    assert state.encoded == 1 and state.tx == 0
    assert len(state.calls) == 3
    assert response.headers['cache-control'] == 'no-store'


def install_existing(state, raw):
    content, metadata = assets.prepare_upload(raw, 'image/png', 'existing.png')
    assets.install_file(content, metadata)
    asset = {**metadata, 'id': '10000000-0000-0000-0000-000000000002'}
    state.existing = {'asset': asset, 'original': {'checksum': hashlib.sha256(raw).hexdigest(), 'size': len(raw),
                      'mime_type': 'image/png', 'width': 3, 'height': 2}, 'pipeline_version': 'prior-version',
                      'processing': {'pipeline_version': 'prior-version', 'output_format': 'png', 'metadata_stripped': True}}
    return asset


def test_original_reuse_verifies_existing_bytes_without_installing(upload_route, monkeypatch):
    client, state = upload_route
    raw = image_bytes()
    asset = install_existing(state, raw)
    monkeypatch.setattr(assets, 'install_file', lambda *args: pytest.fail('original reuse must not install'))
    response = client.post('/v1/admin/assets', headers=HEADERS, content=raw)
    assert response.status_code == 200, response.text
    assert response.json()['data']['id'] == asset['id']
    assert response.json()['meta']['upload']['processing']['pipeline_version'] == 'prior-version'


def test_missing_original_reuse_fails_before_evidence_commit(upload_route):
    client, state = upload_route
    raw = image_bytes()
    asset = install_existing(state, raw)
    assets.storage_path(asset['storage_path']).unlink()
    response = client.post('/v1/admin/assets', headers=HEADERS, content=raw)
    assert response.status_code == 404
    assert state.committed == 2, 'the recorder transaction must roll back'


def test_original_race_discards_candidate_and_verifies_winner(upload_route, monkeypatch):
    client, state = upload_route
    stream = io.BytesIO()
    Image.new('RGB', (3, 2), 'blue').save(stream, 'PNG')
    winner = install_existing(state, stream.getvalue())
    state.existing = None
    state.winner = winner
    monkeypatch.setattr(assets, 'install_file', lambda *args: pytest.fail('race candidate must not install'))
    response = client.post('/v1/admin/assets', headers=HEADERS, content=image_bytes())
    assert response.status_code == 200, response.text
    assert response.json()['data']['id'] == winner['id']
    assert response.json()['data']['checksum'] == winner['checksum']


def test_changed_context_conflicts_without_installing(upload_route, monkeypatch):
    client, state = upload_route
    state.record_error = asyncpg.PostgresError.new({'C': '40001', 'M': 'upload_context_changed'})
    monkeypatch.setattr(assets, 'install_file', lambda *args: pytest.fail('stale context must not install'))
    response = client.post('/v1/admin/assets', headers=HEADERS, content=image_bytes())
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'upload_context_changed'
    assert state.committed == 2
