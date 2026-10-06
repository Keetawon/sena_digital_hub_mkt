import io
import hashlib
import json
from pathlib import Path
import pytest
from PIL import Image
from fastapi import HTTPException
from sena_hub_api import assets


def svg_upload():
    return assets.prepare_upload(b'''<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
      <script>secret()</script><image href="https://example.invalid/private.png"/>
      <rect x="100" y="50" width="200" height="100" fill="red"/></svg>''', 'image/svg+xml', 'logo.svg')


def pdf_upload():
    from pypdf import PdfWriter
    from pypdf.generic import NameObject, DecodedStreamObject
    writer = PdfWriter()
    for width, height, color in ((200, 100, '0 0 1'), (100, 200, '1 0 0')):
        page = writer.add_blank_page(width=width, height=height)
        stream = DecodedStreamObject(); stream.set_data(f'{color} rg 0 0 {width} {height} re f'.encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    output = io.BytesIO(); writer.write(output)
    return assets.prepare_upload(output.getvalue(), 'application/pdf', 'plan.pdf')


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


def test_failed_derivative_never_falls_back_to_original(tmp_path, monkeypatch):
    monkeypatch.setattr(assets, 'STORAGE_ROOT', tmp_path)
    data=b'<svg/>'; metadata={'checksum':hashlib.sha256(data).hexdigest(), 'mime_type':'image/svg+xml'}
    assert not assets.install_thumbnail(data, metadata)
    assert assets.thumbnail_failure(metadata)['reason'] == 'invalid_svg'
    with pytest.raises(HTTPException) as error: assets.readable_thumbnail(metadata)
    assert error.value.status_code == 404
    with pytest.raises(HTTPException): assets.readable_thumbnail({'checksum':'../../private'})


def test_svg_renders_only_sanitized_bytes_and_keeps_transparency(tmp_path, monkeypatch):
    import resvg_py
    monkeypatch.setattr(assets, 'STORAGE_ROOT', tmp_path)
    render = resvg_py.svg_to_bytes
    seen = []
    def checked_render(**kwargs):
        assert 'script' not in kwargs['svg_string'] and 'example.invalid' not in kwargs['svg_string']
        assert 'resources_dir' not in kwargs and 'svg_path' not in kwargs
        seen.append(kwargs)
        return render(**kwargs)
    monkeypatch.setattr(resvg_py, 'svg_to_bytes', checked_render)
    content, metadata = svg_upload()
    assert assets.install_file(content, metadata)
    with Image.open(assets.readable_thumbnail(metadata)) as picture:
        assert picture.format == 'WEBP' and picture.size == (96, 48)
        assert picture.getpixel((0, 0))[3] == 0
        red, green, blue, alpha = picture.getpixel((48, 24))
        assert red > 230 and green < 20 and blue < 20 and alpha == 255
    assert not assets.install_file(content, metadata) and len(seen) == 1
    assert assets.readable_file(metadata).read_bytes() == content


@pytest.mark.parametrize('source', [
    b'<svg width="10" height="10"><script>secret()</script></svg>',
    b'<svg width="10" height="10"><image href="file:///private"/></svg>',
    b'<!DOCTYPE svg [<!ENTITY x SYSTEM "https://example.invalid">]><svg width="10" height="10">&x;</svg>',
])
def test_unsanitized_svg_never_reaches_native_renderer(tmp_path, monkeypatch, source):
    import resvg_py
    monkeypatch.setattr(assets, 'STORAGE_ROOT', tmp_path)
    def forbidden(**kwargs): raise AssertionError('Unsafe SVG reached renderer')
    monkeypatch.setattr(resvg_py, 'svg_to_bytes', forbidden)
    metadata = {'checksum': hashlib.sha256(source).hexdigest(), 'mime_type': 'image/svg+xml'}
    assert not assets.install_thumbnail(source, metadata)
    assert assets.thumbnail_failure(metadata)['reason'] in ('invalid_svg', 'svg_not_sanitized')


def test_pdf_renders_first_page_only_with_bounded_dimensions(tmp_path, monkeypatch):
    monkeypatch.setattr(assets, 'STORAGE_ROOT', tmp_path)
    content, metadata = pdf_upload()
    assert assets.install_file(content, metadata)
    with Image.open(assets.readable_thumbnail(metadata)) as picture:
        assert picture.format == 'WEBP' and picture.size == (96, 48)
        red, green, blue = picture.convert('RGB').getpixel((48, 24))
        assert blue > 230 and red < 20 and green < 20  # Page 2 is portrait/red.


def test_pdf_validation_failure_never_reaches_native_renderer(tmp_path, monkeypatch):
    import pypdfium2 as pdfium
    monkeypatch.setattr(assets, 'STORAGE_ROOT', tmp_path)
    def forbidden(*args, **kwargs): raise AssertionError('Invalid PDF reached renderer')
    monkeypatch.setattr(pdfium, 'PdfDocument', forbidden)
    content=b'%PDF-not-valid'; metadata={'checksum':hashlib.sha256(content).hexdigest(),'mime_type':'application/pdf'}
    assert not assets.install_thumbnail(content, metadata)
    assert assets.thumbnail_failure(metadata)['reason'] == 'invalid_pdf'


def test_render_failure_preserves_original_records_safe_reason_and_retry_clears_marker(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(assets, 'STORAGE_ROOT', tmp_path)
    content, metadata = svg_upload(); render = assets.render_thumbnail
    def broken(*args): raise RuntimeError('private filename https://secret.invalid/token')
    monkeypatch.setattr(assets, 'render_thumbnail', broken)
    assert assets.install_file(content, metadata)
    report = assets.thumbnail_failure(metadata)
    assert report['reason'] == 'render_failed' and report['exception_type'] == 'RuntimeError' and report['attempted_at']
    assert 'private filename' not in caplog.text and 'secret.invalid' not in json.dumps(report)
    assert metadata['checksum'] in caplog.text and assets.readable_file(metadata).read_bytes() == content
    monkeypatch.setattr(assets, 'render_thumbnail', render)
    assert not assets.install_file(content, metadata)  # Original replay is still a no-op.
    assert assets.readable_thumbnail(metadata).is_file() and assets.thumbnail_failure(metadata) is None
    assert not assets.thumbnail_failure_path(metadata).exists()


def test_backfill_converts_svg_pdf_and_continues_after_missing_original(tmp_path, monkeypatch):
    import importlib.util
    path = Path(__file__).resolve().parents[3] / 'scripts/backfill-local-thumbnails.py'
    spec=importlib.util.spec_from_file_location('thumbnail_backfill', path)
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    monkeypatch.setattr(assets, 'STORAGE_ROOT', tmp_path)
    rows=[]
    for content, metadata in (svg_upload(), pdf_upload()):
        assets.storage_path(metadata['storage_path']).write_bytes(content)
        rows.append(metadata)
    missing={**rows[0], 'checksum':'a'*64, 'storage_path':'a'*64+'.svg'}
    result=module.backfill([missing,*rows])
    assert result == {'created':2,'existing':0,'failed':0,'missing_or_invalid_original':1,
                      'failures':[{'checksum':'a'*64,'reason':'original_unavailable'}]}
    assert module.backfill(rows)['existing'] == 2


@pytest.mark.parametrize('upload', [svg_upload, pdf_upload])
def test_staff_thumbnail_endpoint_checks_authorization_and_returns_webp(tmp_path, monkeypatch, upload):
    from contextlib import asynccontextmanager
    from fastapi.testclient import TestClient
    from sena_hub_api import main
    from test_api import settings, TOKENS
    monkeypatch.setattr(assets, 'STORAGE_ROOT', tmp_path)
    content,metadata=upload(); assets.install_file(content,metadata)
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
