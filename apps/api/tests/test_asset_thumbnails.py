import io
import hashlib
import pytest
from PIL import Image
from fastapi import HTTPException
from sena_hub_api import assets


def test_pre_generated_webp_is_bounded_and_never_reads_original_on_request(tmp_path, monkeypatch):
    monkeypatch.setattr(assets, 'STORAGE_ROOT', tmp_path)
    content = io.BytesIO(); Image.new('RGB', (1200, 800), 'green').save(content, 'PNG')
    data = content.getvalue(); metadata = assets.validate_file(data, 'image/png', 'test.png')
    assert assets.install_file(data, metadata)
    derivative = assets.readable_thumbnail(metadata)
    with Image.open(derivative) as picture:
        assert picture.format == 'WEBP' and picture.size == (96, 64)
    assert derivative.stat().st_size < len(data)
    before = derivative.stat().st_mtime_ns
    assert not assets.install_file(data, metadata)
    assert derivative.stat().st_mtime_ns == before
    assets.storage_path(metadata['storage_path']).unlink()
    assert assets.readable_thumbnail(metadata) == derivative


def test_missing_or_unsupported_derivative_never_falls_back_to_original(tmp_path, monkeypatch):
    monkeypatch.setattr(assets, 'STORAGE_ROOT', tmp_path)
    data=b'<svg/>'; metadata={'checksum':hashlib.sha256(data).hexdigest(), 'mime_type':'image/svg+xml'}
    assert not assets.install_thumbnail(data, metadata)
    with pytest.raises(HTTPException) as error: assets.readable_thumbnail(metadata)
    assert error.value.status_code == 404
    with pytest.raises(HTTPException): assets.readable_thumbnail({'checksum':'../../private'})


def test_staff_thumbnail_endpoint_checks_authorization_and_returns_webp(tmp_path, monkeypatch):
    from contextlib import asynccontextmanager
    from fastapi.testclient import TestClient
    from sena_hub_api import main
    from test_api import settings, TOKENS
    monkeypatch.setattr(assets, 'STORAGE_ROOT', tmp_path)
    image=io.BytesIO(); Image.new('RGB',(200,100),'green').save(image,'PNG')
    metadata=assets.validate_file(image.getvalue(),'image/png','synthetic.png'); assets.install_file(image.getvalue(),metadata)
    class Connection:
        async def fetchval(self, sql, asset_id):
            assert sql == 'SELECT hub.asset_file($1)'
            return metadata
    @asynccontextmanager
    async def database(request, actor):
        assert actor.role == 'viewer'
        yield Connection()
    monkeypatch.setattr(main,'database',database)
    client=TestClient(main.create_app(settings()),client=('127.0.0.1',50000))
    url='/v1/admin/assets/00000000-0000-0000-0000-000000000099/thumbnail'
    response=client.get(url,headers={'Authorization':f"Bearer {TOKENS['viewer']}"})
    assert response.status_code==200 and response.headers['content-type']=='image/webp'
    assert Image.open(io.BytesIO(response.content)).size==(96,48)
    assert client.get(url,headers={'Authorization':f"Bearer {TOKENS['service_consumer']}"}).status_code==403
