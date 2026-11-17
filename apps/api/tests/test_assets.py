import asyncio
import io
from contextlib import asynccontextmanager
from urllib.parse import quote
from uuid import UUID

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfWriter
import pytest
from starlette.requests import Request

from sena_hub_api import assets, main
from sena_hub_api.auth import Actor
from sena_hub_api.main import create_app
from test_api import settings, TOKENS
from upload_route_fixtures import upload_resolution, INTAKE_CONTEXT_HEADER


ASSET_ID = "10000000-0000-0000-0000-000000000001"


def image_bytes(format="PNG", animated=False):
    output = io.BytesIO()
    image = Image.new("RGB", (3, 2), "red")
    options = {"save_all": True, "append_images": [Image.new("RGB", (3, 2), "blue")]} if animated else {}
    image.save(output, format=format, **options)
    return output.getvalue()


def pdf_bytes(pages=1, encrypted=False, script=False, uri=False):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=100, height=100)
    if encrypted:
        writer.encrypt("test-password")
    if script:
        writer.add_js("app.alert('must be rejected')")
    if uri:
        from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, TextStringObject
        writer.pages[0][NameObject("/Annots")] = ArrayObject([DictionaryObject({
            NameObject("/Type"): NameObject("/Annot"), NameObject("/Subtype"): NameObject("/Link"),
            NameObject("/Rect"): ArrayObject([FloatObject(0)] * 4),
            NameObject("/A"): DictionaryObject({NameObject("/S"): NameObject("/URI"), NameObject("/URI"): TextStringObject("https://example.invalid")}),
        })])
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.mark.parametrize("method,path", [
    ("GET", "/v1/admin/assets"), ("POST", "/v1/admin/assets"),
    ("GET", f"/v1/admin/assets/{ASSET_ID}"), ("GET", f"/v1/admin/assets/{ASSET_ID}/file"),
    ("POST", f"/v1/admin/assets/{ASSET_ID}/review"), ("GET", f"/v1/assets/{ASSET_ID}/file"),
    ("POST", "/v1/admin/projects/demo/assets"),
    ("POST", f"/v1/admin/projects/demo/assets/{ASSET_ID}/remove"),
])
def test_asset_routes_require_auth_before_sql(method, path):
    client = TestClient(create_app(settings()), client=("127.0.0.1", 50000))
    assert client.request(method, path).status_code == 401


@pytest.mark.parametrize("role,method,path", [
    ("viewer", "POST", "/v1/admin/assets"), ("editor", "POST", f"/v1/admin/assets/{ASSET_ID}/review"),
    ("viewer", "POST", "/v1/admin/projects/demo/assets"),
    ("viewer", "POST", f"/v1/admin/projects/demo/assets/{ASSET_ID}/remove"),
    ("service_consumer", "GET", "/v1/admin/assets"),
    ("service_consumer", "GET", f"/v1/admin/assets/{ASSET_ID}/file"),
])
def test_asset_role_boundaries(role, method, path):
    client = TestClient(create_app(settings()), client=("127.0.0.1", 50000))
    assert client.request(method, path, headers={"Authorization": f"Bearer {TOKENS[role]}"}).status_code == 403


def test_internal_publisher_reads_public_asset_through_published_binding(monkeypatch, tmp_path):
    path = tmp_path / 'synthetic.png'
    content = image_bytes()
    path.write_bytes(content)
    class DB:
        async def fetchval(self, query, asset_id):
            assert query == 'SELECT hub.public_asset_file($1::text)' and asset_id == 'ast_' + 'a' * 64
            return {'mime_type': 'image/png', 'original_filename': path.name}
    @asynccontextmanager
    async def database(request, actor):
        assert actor.role == 'publisher' and actor.id == UUID(int=2)
        yield DB()
    monkeypatch.setattr(main, 'database', database)
    monkeypatch.setattr(assets, 'readable_file', lambda metadata: path)
    client = TestClient(create_app(settings()), client=('127.0.0.1', 50000))
    response = client.get(f'/v1/assets/ast_{"a" * 64}/file', headers={'Authorization': f"Bearer {TOKENS['publisher']}"})
    assert response.status_code == 200 and response.content == content
    assert response.headers['cache-control'] == 'no-store'


def test_production_never_uses_local_asset_storage(monkeypatch, tmp_path):
    app = create_app(settings(auth_mode="supabase", environment="production", supabase_url="https://example.supabase.co"))
    from fastapi import Request
    async def verified_editor(request: Request):
        request.state.account = {"capabilities": {"tabs": {"projects": {"view": True, "edit": True}}}}
        return Actor(id=UUID(int=1), role="editor")
    app.dependency_overrides[app.state.authentication] = verified_editor
    monkeypatch.setattr(assets, "STORAGE_ROOT", tmp_path / "unused")
    client = TestClient(app)
    response = client.post("/v1/admin/assets", content=image_bytes(), headers={"Content-Type": "image/png", "X-Filename": "valid.png"})
    assert response.status_code == 503
    assert not assets.STORAGE_ROOT.exists()


@pytest.mark.parametrize("filename", [None, "../x.png", r"a\x.png", "C:evil.png", "%00x.png", "x%0D%0Aheader.png",
                                          "x%GG.png", "%FF.png", ".", "..", "CON.pdf", "x" * 201, "ends. "])
def test_filename_cannot_escape_or_inject_headers(filename):
    with pytest.raises(HTTPException) as error:
        assets.decode_filename(filename)
    assert error.value.status_code == 422


def test_filename_accepts_encoded_thai_basename():
    name = "ภาพโครงการ (ต้นฉบับ).png"
    assert assets.decode_filename(quote(name)) == name


@pytest.mark.parametrize("format,mime", [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")])
def test_images_are_decoded_and_content_addressed(format, mime):
    content = image_bytes(format)
    metadata = assets.validate_file(content, mime, "ภาพ.png")
    assert metadata["width"] == 3 and metadata["height"] == 2
    assert metadata["file_size"] == len(content)
    assert metadata["storage_path"].startswith(metadata["checksum"])


@pytest.mark.parametrize("content,mime", [
    (b'<svg xmlns="http://www.w3.org/2000/svg"/>', "image/png"),
    (b"not-an-image", "image/jpeg"),
    (image_bytes("PNG"), "image/jpeg"),
    (image_bytes("PNG")[:40], "image/png"),
    (image_bytes("PNG", animated=True), "image/png"),
    (image_bytes("WEBP", animated=True), "image/webp"),
    (b"%PDF-1.7 broken", "application/pdf"),
    (pdf_bytes(encrypted=True), "application/pdf"),
    (pdf_bytes(script=True), "application/pdf"),
    (pdf_bytes(uri=True), "application/pdf"),
    (pdf_bytes(pages=201), "application/pdf"),
])
def test_invalid_disguised_animated_or_active_files_are_rejected(content, mime):
    with pytest.raises(HTTPException) as error:
        assets.validate_file(content, mime, "example")
    assert error.value.status_code == 422


def test_image_size_limit_and_plain_pdf(monkeypatch):
    monkeypatch.setattr(assets, "MAX_PIXELS", 5)
    with pytest.raises(HTTPException):
        assets.validate_file(image_bytes(), "image/png", "image.png")
    result = assets.validate_file(pdf_bytes(), "application/pdf", "brochure.pdf")
    assert result["asset_type"] == "document" and result["width"] is None


def test_stream_is_bounded_without_trusting_content_length(monkeypatch):
    monkeypatch.setattr(assets, "MAX_BYTES", 5)

    async def upload(length=None):
        chunks = iter([b"123", b"456"])
        async def receive():
            chunk = next(chunks)
            return {"type": "http.request", "body": chunk, "more_body": chunk == b"123"}
        headers = [(b"content-type", b"image/png"), (b"x-filename", b"test.png")]
        if length:
            headers.append((b"content-length", length.encode()))
        request = Request({"type": "http", "headers": headers}, receive)
        return await assets.read_upload(request, max_bytes=assets.MAX_BYTES)

    for declared in (None, "1", "6"):
        with pytest.raises(HTTPException) as error:
            asyncio.run(upload(declared))
        assert error.value.status_code == 413


def test_atomic_dedup_never_overwrites_and_detects_corruption(monkeypatch, tmp_path):
    monkeypatch.setattr(assets, "STORAGE_ROOT", tmp_path)
    content = image_bytes()
    metadata = assets.validate_file(content, "image/png", "test.png")
    assert assets.install_file(content, metadata) is True
    assert assets.install_file(content, metadata) is False
    path = assets.readable_file(metadata)
    assert path.read_bytes() == content
    assert len([item for item in tmp_path.iterdir() if item.is_file()]) == 1
    assert assets.readable_thumbnail(metadata).is_file()
    path.write_bytes(b"corrupted")
    with pytest.raises(HTTPException):
        assets.install_file(content, metadata)
    with pytest.raises(HTTPException):
        assets.readable_file(metadata)
    assert path.read_bytes() == b"corrupted"  # Never silently overwrite an existing original.


@pytest.mark.parametrize("name", ["../secret", r"..\secret", "https://example.invalid/file", "file.svg", "a" * 64 + ".html"])
def test_registry_path_never_fetches_urls_or_escapes(name):
    with pytest.raises(HTTPException):
        assets.storage_path(name)


def test_failed_atomic_install_cleans_only_its_temporary_file(monkeypatch, tmp_path):
    monkeypatch.setattr(assets, "STORAGE_ROOT", tmp_path)
    sentinel = tmp_path / "keep.txt"
    sentinel.write_text("existing")
    def fail_link(*args):
        raise OSError("simulated storage failure")
    monkeypatch.setattr(assets.os, "link", fail_link)
    content = image_bytes()
    with pytest.raises(HTTPException):
        assets.install_file(content, assets.validate_file(content, "image/png", "test.png"))
    metadata = assets.validate_file(content, "image/png", "test.png")
    assert assets.thumbnail_failure(metadata)['reason'] == 'storage_failed'
    assert set(item for item in tmp_path.rglob('*') if item.is_file()) == {sentinel, assets.thumbnail_failure_path(metadata)}


@pytest.mark.parametrize("registered", [False, True])
def test_failed_commit_rechecks_registry_before_removing_new_file(monkeypatch, tmp_path, registered):
    monkeypatch.setattr(assets, "STORAGE_ROOT", tmp_path)
    calls = 0

    class Connection:
        async def execute(self, *args):
            pass

        async def fetchval(self, sql, *args):
            if 'asset_upload_context' in sql:
                return upload_resolution(args[0], 'private_exact')
            if 'find_uploaded_asset_source' in sql:
                return None
            if 'record_asset_upload_source' in sql:
                return {'asset': {}, 'reused': False, 'reuse_kind': 'none', 'upload': {}}
            assert sql == "SELECT hub.asset_registered_for_cleanup($1)"
            return registered

    @asynccontextmanager
    async def failed_commit(request, actor):
        nonlocal calls
        calls += 1
        first = calls == 3
        yield Connection()
        if first:
            raise RuntimeError("simulate ambiguous commit")

    monkeypatch.setattr(main, "database", failed_commit)
    client = TestClient(create_app(settings()), client=("127.0.0.1", 50000), raise_server_exceptions=False)
    content = image_bytes()
    response = client.post("/v1/admin/assets", content=content, headers={
        "Authorization": f"Bearer {TOKENS['editor']}", "Content-Type": "image/png", "X-Filename": "test.png", "X-Upload-Context": INTAKE_CONTEXT_HEADER,
    })
    assert response.status_code == 500
    assert calls == 4
    metadata = assets.validate_file(content, "image/png", "test.png")
    assert (tmp_path / metadata["storage_path"]).exists() is registered


@pytest.mark.parametrize("changes", [
    {"decision": "pending"}, {"rights_notes": " "}, {"change_reason": " "},
    {"effective_from": "2026-09-16T10:00:00"},
    {"effective_from": "2027-01-02T00:00:00Z", "effective_to": "2027-01-01T00:00:00Z"},
    {"reviewed_by": ASSET_ID},
])
def test_asset_review_rejects_invalid_dates_notes_and_forged_reviewer(changes):
    client = TestClient(create_app(settings()), client=("127.0.0.1", 50000))
    body = {"updated_at": "2026-09-16T00:00:00Z", "decision": "approved", "rights_notes": "หลักฐานทดสอบ",
            "change_reason": "ตรวจสิทธิ์แล้ว", "effective_from": None, "effective_to": None, **changes}
    response = client.post(f"/v1/admin/assets/{ASSET_ID}/review", json=body,
                           headers={"Authorization": f"Bearer {TOKENS['publisher']}"})
    assert response.status_code == 422
