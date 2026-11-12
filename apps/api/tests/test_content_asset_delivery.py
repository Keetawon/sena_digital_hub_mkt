"""Private delivery boundaries; storage is local/synthetic, SQL uses the disposable fixture."""
import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import timedelta
import hashlib
import io
from types import SimpleNamespace
from uuid import UUID, uuid4

import asyncpg
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin
import pytest

from sena_hub_api import assets, content_asset_delivery as delivery
from sena_hub_api.auth import Actor, Authentication
from sena_hub_api.content_permissions import require_content
from test_api import settings, TOKENS
from test_permission_foundations import permission_accounts


ASSET = UUID(int=88011)
NEIGHBOUR = UUID(int=88012)
HEADERS = {"Authorization": "Bearer " + TOKENS["viewer"]}


def image_upload():
    stream = io.BytesIO()
    info = PngImagePlugin.PngInfo()
    info.add_text("synthetic", uuid4().hex)
    Image.new("RGB", (16, 8), (40, 80, 120)).save(stream, "PNG", pnginfo=info)
    return assets.prepare_upload(stream.getvalue(), "image/png", "synthetic delivery.png")


@pytest.fixture
def boundary(monkeypatch, tmp_path):
    content, metadata = image_upload()
    metadata["id"] = str(ASSET)
    state = SimpleNamespace(content=content, metadata={ASSET: metadata, NEIGHBOUR: {**metadata, "id": str(NEIGHBOUR)}},
        hidden=set(), status="ACTIVE", view=True, changed_actor=False, account_reads=0, calls=[],
        stage=None, change=None, hosted=False, storage_reads=0)
    monkeypatch.setattr(assets, "STORAGE_ROOT", tmp_path)
    assets.install_file(content, metadata)
    original_account = Authentication.load_account

    async def account(self, request, claims):
        current = await original_account(self, request, claims)
        state.account_reads += 1
        current["status"] = state.status
        for tab in ("projects", "brands", "knowledge"):
            current["capabilities"]["tabs"][tab]["view"] = state.view
        return current

    monkeypatch.setattr(Authentication, "load_account", account)
    authenticate = Authentication(settings())

    async def authentication(request: Request):
        actor = await authenticate(request)
        return Actor(NEIGHBOUR, actor.role) if state.changed_actor else actor

    async def staff(request: Request, actor: Actor = Depends(authentication)):
        assert require_content(request)
        return actor

    class DB:
        async def fetchval(self, sql, identity):
            assert sql == delivery.ASSET_FILE_SQL
            state.calls.append((sql, identity))
            return None if identity in state.hidden else deepcopy(state.metadata[identity])

    @asynccontextmanager
    async def database(request, actor):
        yield DB()

    def change(stage):
        if state.stage == stage and state.change:
            state.change()

    def stored(metadata):
        state.storage_reads += 1
        change("storage")
        return state.content

    bounded = delivery._bounded_bytes
    install = assets.install_thumbnail

    def read(path):
        value = bounded(path)
        change("thumbnail" if path.parent.name == "thumbnails-v1" else "local")
        return value

    def render(content, metadata):
        value = install(content, metadata)
        change("render")
        return value

    monkeypatch.setattr(delivery, "_bounded_bytes", read)
    monkeypatch.setattr(assets, "install_thumbnail", render)
    app = FastAPI()

    @app.middleware("http")
    async def no_cache(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    async def respond(asset_id, request, actor, thumbnail=False):
        return await delivery.staff_asset_response(asset_id, request, actor, authentication=authentication,
            database=database, authorize=staff,
            hosted_assets=SimpleNamespace(read=stored) if state.hosted else None, thumbnail=thumbnail)

    @app.get("/v1/admin/assets/{asset_id}/file")
    async def original(asset_id: UUID, request: Request, actor: Actor = Depends(staff)):
        return await respond(asset_id, request, actor)

    @app.get("/v1/admin/assets/{asset_id}/thumbnail")
    async def thumbnail(asset_id: UUID, request: Request, actor: Actor = Depends(staff)):
        return await respond(asset_id, request, actor, True)

    state.client = TestClient(app, client=("127.0.0.1", 50000))
    return state


def alter(state, change):
    if change == "suspend": state.status = "SUSPENDED"
    elif change == "permission": state.view = False
    elif change == "scope": state.hidden.add(ASSET)
    elif change == "withdraw": state.hidden.add(ASSET)
    elif change == "identity": state.changed_actor = True
    elif change == "metadata": state.metadata[ASSET]["original_filename"] = "changed.png"
    elif change == "storage": state.metadata[ASSET]["storage_path"] = "0" * 64 + ".png"
    else: raise AssertionError(change)


def request_file(state, stage, asset=ASSET):
    state.hosted = stage in ("storage", "render")
    if stage == "render":
        assets.thumbnail_path(state.metadata[asset]).unlink(missing_ok=True)
    return state.client.get(f"/v1/admin/assets/{asset}/" + ("thumbnail" if stage in ("thumbnail", "render") else "file"), headers=HEADERS)


@pytest.mark.parametrize("stage", ["local", "storage", "thumbnail", "render"])
@pytest.mark.parametrize("change,status", [("suspend", 403), ("permission", 403), ("scope", 404),
    ("withdraw", 404), ("identity", 403), ("metadata", 409), ("storage", 409)])
def test_private_bytes_are_discarded_after_storage_or_thumbnail_authority_changes(boundary, stage, change, status):
    boundary.stage = stage
    boundary.change = lambda: alter(boundary, change)
    response = request_file(boundary, stage)
    assert response.status_code == status
    assert boundary.content not in response.content and not response.content.startswith(b"RIFF")
    assert response.headers["cache-control"] == "no-store"
    assert boundary.account_reads == 2
    if change in ("scope", "withdraw", "metadata", "storage"):
        assert boundary.calls == [(delivery.ASSET_FILE_SQL, ASSET)] * 2


@pytest.mark.parametrize("stage", ["local", "storage", "thumbnail", "render"])
def test_unchanged_source_keeps_bytes_headers_and_does_not_defer_private_file_reads(boundary, stage):
    response = request_file(boundary, stage)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert boundary.calls == [(delivery.ASSET_FILE_SQL, ASSET)] * 2
    assert boundary.account_reads == 2
    if stage in ("thumbnail", "render"):
        assert response.headers["content-type"] == "image/webp"
        assert response.headers["content-security-policy"] == "default-src 'none'"
        assert Image.open(io.BytesIO(response.content)).size == (16, 8)
        assert "content-disposition" not in response.headers
    else:
        assert response.content == boundary.content
        assert response.headers["content-type"] == "image/png"
        assert response.headers["content-disposition"] == "inline; filename*=utf-8''synthetic%20delivery.png"
        assert response.headers["content-security-policy"] == "sandbox; default-src 'none'; frame-ancestors 'none'"
        assert response.headers["x-frame-options"] == "DENY"
    assert "accept-ranges" not in response.headers  # Buffered Response, not a deferred FileResponse.


def test_scope_change_does_not_hide_an_independently_permitted_neighbour(boundary):
    boundary.stage = "storage"
    boundary.change = lambda: boundary.hidden.add(ASSET)
    assert request_file(boundary, "storage").status_code == 404
    response = request_file(boundary, "storage", NEIGHBOUR)
    assert response.status_code == 200 and response.content == boundary.content
    assert boundary.calls[-2:] == [(delivery.ASSET_FILE_SQL, NEIGHBOUR)] * 2


@pytest.mark.parametrize("stage", ["local", "storage"])
def test_pdf_attachment_and_ascii_local_filename_contract(boundary, stage):
    content = b"%PDF-synthetic-private-fixture"
    metadata = {**boundary.metadata[ASSET], "mime_type": "application/pdf", "original_filename": "document.pdf",
        "checksum": hashlib.sha256(content).hexdigest(), "file_size": len(content)}
    metadata["storage_path"] = metadata["checksum"] + ".pdf"
    boundary.metadata[ASSET] = metadata
    boundary.content = content
    assets.storage_path(metadata["storage_path"]).write_bytes(content)
    response = request_file(boundary, stage)
    assert response.status_code == 200 and response.content == content
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == (
        'attachment; filename="document.pdf"' if stage == "local" else "attachment; filename*=utf-8''document.pdf")


def test_hidden_initial_source_never_reads_storage(boundary):
    boundary.hidden.add(ASSET)
    response = request_file(boundary, "storage")
    assert response.status_code == 404 and boundary.storage_reads == 0
    assert boundary.account_reads == 1 and len(boundary.calls) == 1


@pytest.mark.parametrize("invalid", ["checksum", "size", "boolean_size", "oversize", "mime", "extension", "path"])
def test_local_original_retains_size_checksum_mime_and_exact_path_guards(boundary, invalid, monkeypatch):
    metadata = boundary.metadata[ASSET]
    if invalid == "checksum": assets.storage_path(metadata["storage_path"]).write_bytes(b"x" * len(boundary.content))
    elif invalid == "size": metadata["file_size"] += 1
    elif invalid == "boolean_size": metadata["file_size"] = True
    elif invalid == "oversize": monkeypatch.setattr(assets, "MAX_BYTES", len(boundary.content) - 1)
    elif invalid == "mime": metadata["mime_type"] = "text/html"
    elif invalid == "extension": metadata["mime_type"] = "image/jpeg"
    elif invalid == "path": metadata["storage_path"] = "../outside.png"
    response = request_file(boundary, "local")
    assert response.status_code in (404, 503) and boundary.content not in response.content
    assert boundary.account_reads == 1


def test_local_and_thumbnail_read_buffers_are_bounded(monkeypatch):
    reads = []
    class Stream(io.BytesIO):
        def read(self, size=-1): reads.append(size); return super().read(size)
    class File:
        def is_file(self): return True
        def open(self, mode): assert mode == "rb"; return Stream(b"1234567890")
    monkeypatch.setattr(assets, "MAX_BYTES", 8)
    with pytest.raises(HTTPException) as error:
        delivery._bounded_bytes(File())
    assert error.value.status_code == 503 and reads == [9]
    for data, metadata in [(b"12345678", {"checksum": "0" * 64, "file_size": 8}),
            (b"12345678", {"checksum": hashlib.sha256(b"12345678").hexdigest(), "file_size": True}),
            (b"123456789", {"checksum": hashlib.sha256(b"123456789").hexdigest(), "file_size": 9})]:
        with pytest.raises(HTTPException): delivery._checked_original(data, metadata)
    assert delivery._checked_original(b"12345678", {
        "checksum": hashlib.sha256(b"12345678").hexdigest(), "file_size": 8}) == b"12345678"


@pytest.mark.parametrize("invalid", ["checksum", "oversize"])
def test_hosted_storage_integrity_is_checked_before_delivery(boundary, invalid, monkeypatch):
    if invalid == "checksum": boundary.content = b"x" * len(boundary.content)
    else: monkeypatch.setattr(assets, "MAX_BYTES", len(boundary.content) - 1)
    response = request_file(boundary, "storage")
    assert response.status_code == 503 and boundary.content not in response.content
    assert len(boundary.calls) == 1 and boundary.account_reads == 1


@pytest.mark.parametrize("change", ["expiry", "withdraw", "permission", "suspend"])
@pytest.mark.integration
def test_final_exact_asset_sql_rechecks_after_await_and_keeps_positive_scope_neighbours(permission_accounts, monkeypatch, change):
    from test_content_scopes import NOW, clock, membership, scope_database, selected
    from test_permission_content import call
    from test_website_content import project_fixture
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            await clock(db)
            projects = [await project_fixture(db, ids["editor"]) for _ in range(2)]

            async def invoke(actor, sql, *args):
                try:
                    return await call(db, actor, sql, *args)
                finally:
                    await db.execute("RESET ROLE")

            originals = {}
            identities = []
            for project in projects:
                content, metadata = image_upload()
                asset = (await invoke(ids["editor"], "select hub.register_uploaded_asset($1)", metadata))["asset"]
                identity = UUID(asset["id"])
                await invoke(ids["editor"], "select hub.bind_project_asset($1,$2,'floor_plan',$3,$4)",
                    project["id"], identity, {"th": "Synthetic exact asset"}, project["updated_at"])
                originals[identity] = content
                identities.append(identity)
            await membership(db, [(projects[0]["rem_project_id"], " BU A "), (projects[1]["rem_project_id"], "BU-B")],
                watermark=NOW - timedelta(days=6, hours=23))
            await selected(db, ids["viewer"], "projects", "view", projects=[projects[1]["rem_project_id"]], bus=[" BU A "])
            epoch = await db.fetchval("select authorization_epoch from hub.content_scope_state")
            calls = []

            @asynccontextmanager
            async def database(request, actor):
                class Reader:
                    async def fetchval(self, sql, identity):
                        assert sql == delivery.ASSET_FILE_SQL
                        calls.append((actor.id, identity))
                        return await invoke(actor.id, sql, identity)
                yield Reader()

            async def authentication(request): return request.actor
            async def authorize(request, actor): return actor
            changed = False

            async def delayed_read(fn, metadata, store, thumbnail):
                nonlocal changed
                content = originals[UUID(metadata["id"])]
                await asyncio.sleep(0)
                if not changed:
                    changed = True
                    if change == "expiry": await clock(db, NOW + timedelta(hours=1))
                    elif change == "withdraw": await db.execute("update hub.assets set deleted_at=now() where id=$1", identities[0])
                    elif change == "permission": await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false where account_id=$1 and tab='projects'", ids["viewer"])
                    elif change == "suspend": await db.execute("update hub.user_account set status='SUSPENDED' where id=$1", ids["viewer"])
                return content

            monkeypatch.setattr(delivery, "to_thread", delayed_read)

            async def response(actor, identity):
                request = SimpleNamespace(actor=Actor(actor, "viewer"))
                return await delivery.staff_asset_response(identity, request, request.actor,
                    authentication=authentication, database=database, authorize=authorize)

            with pytest.raises((asyncpg.NoDataFoundError, asyncpg.InsufficientPrivilegeError)):
                await response(ids["viewer"], identities[0])
            assert calls[:2] == [(ids["viewer"], identities[0])] * 2
            # A separate unrestricted caller remains valid even if this caller lost V/status.
            other = await response(ids["second"], identities[1])
            assert other.body == originals[identities[1]] and other.headers["cache-control"] == "no-store"
            if change in ("expiry", "withdraw"):
                explicit = await response(ids["viewer"], identities[1])
                assert explicit.body == originals[identities[1]]
            if change == "expiry":
                assert await db.fetchval("select authorization_epoch from hub.content_scope_state") == epoch
                unchanged = await response(ids["second"], identities[0])
                assert unchanged.body == originals[identities[0]]
    asyncio.run(check())
