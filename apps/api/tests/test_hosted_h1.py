"""H1 boundary tests: local simulation only; no remote Supabase connection."""
import hashlib
import io
import json
import os
from pathlib import Path
import time
from contextlib import asynccontextmanager
from urllib.error import HTTPError
from urllib.parse import urlparse
from uuid import UUID, uuid4

import jwt
import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient

from sena_hub_api import assets, main
from sena_hub_api.auth import Actor, Authentication, Settings, ALL_DEMO_ACTORS
from sena_hub_api.hosted_assets import BUCKET, HostedAssets, NoRedirect
from test_assets import image_bytes


def h1_settings(**overrides):
    return Settings(**{
        "database_url": "postgresql://hub_runtime:simulation-only@127.0.0.1:55434/hub_hosted_test_simulation",
        "auth_mode": "supabase", "environment": "hosted-test", "hosted_test_simulation": True,
        "supabase_url": "http://127.0.0.1:54329", "admin_origin": "http://127.0.0.1:3001",
        "supabase_storage_key": "local-simulation-storage-key-only", **overrides,
    })


@pytest.mark.parametrize("overrides", [
    {"environment": "local"}, {"auth_mode": "demo"}, {"demo_tokens": {"editor": "x" * 32}},
    {"database_url": "postgresql://hub_runtime:test@127.0.0.1:55432/sena_hub_local"},
    {"database_url": "postgresql://hub_runtime:test@localhost:55434/hub_hosted_test_simulation"},
    {"database_url": "postgresql://postgres:test@127.0.0.1:55434/hub_hosted_test_simulation"},
    {"database_url": "postgresql://hub_runtime:test@127.0.0.1:55434/other"},
    {"database_url": "postgresql://hub_runtime:test@127.0.0.1:55434/hub_hosted_test_simulation?host=other"},
    {"database_url": "postgresql://hub_runtime:test@127.0.0.1:55434/hub_hosted_test_simulation?service=other"},
    {"supabase_url": "https://eqlrtevwpyboplljgowo.supabase.co"},
    {"supabase_url": "http://127.0.0.1:54329/path"},
    {"admin_origin": "http://127.0.0.1:3000"}, {"supabase_storage_key": ""},
])
def test_simulation_refuses_wrong_targets_and_demo_auth(overrides):
    with pytest.raises(ValueError):
        h1_settings(**overrides)


def test_simulation_accepts_runtime_loopback_ports_without_relaxing_hosted_targets():
    settings = h1_settings(
        database_url="postgresql://hub_runtime:synthetic@127.0.0.1:49151/hub_hosted_test_simulation",
        supabase_url="http://127.0.0.1:49152", admin_origin="http://127.0.0.1:49153")
    assert settings.hosted_test_simulation
    for value in ("http://localhost:49152", "http://127.0.0.1:8000", "http://127.0.0.1",
                  "http://user@127.0.0.1:49152", "http://127.0.0.1:49152?x=1"):
        with pytest.raises(ValueError):
            h1_settings(supabase_url=value)
    with pytest.raises(ValueError):
        h1_settings(database_url="postgresql://hub_runtime:synthetic@127.0.0.1:55432/hub_hosted_test_simulation")


def hosted_configuration(**overrides):
    return h1_settings(hosted_test_simulation=False, **{
        "database_url": "postgresql://hub_runtime:never-used@db.eqlrtevwpyboplljgowo.supabase.co:5432/postgres?sslmode=verify-full",
        "supabase_url": "https://eqlrtevwpyboplljgowo.supabase.co",
        "admin_origin": "https://hub-test.example.invalid",
        "supabase_storage_key": "", "r2_credentials_file": "/private/synthetic-r2.json", "r2_private_bucket_confirmed": True,
        **overrides,
    })


def test_hosted_configuration_is_validated_without_opening_connection():
    settings = hosted_configuration()
    assert settings.environment == "hosted-test"
    assert "never-used" not in repr(settings)
    assert settings.r2_credentials_file not in repr(settings)


@pytest.mark.parametrize("overrides", [
    {"database_url": "postgresql://hub_runtime:x@db.other.supabase.co/postgres?sslmode=verify-full"},
    {"database_url": "postgresql://hub_runtime:x@db.eqlrtevwpyboplljgowo.supabase.co/postgres?sslmode=require"},
    {"database_url": "postgresql://hub_runtime:x@db.eqlrtevwpyboplljgowo.supabase.co:6543/postgres?sslmode=verify-full"},
    {"database_url": "postgresql://hub_runtime:x@db.eqlrtevwpyboplljgowo.supabase.co/postgres?sslmode=verify-full&sslmode=disable"},
    {"database_url": "postgresql://hub_runtime.other:x@aws-0.example.pooler.supabase.com/postgres?sslmode=verify-full"},
    {"supabase_url": "https://other.supabase.co"}, {"admin_origin": "http://example.invalid"},
    {"admin_origin": "https://user@example.invalid"},
])
def test_hosted_configuration_requires_exact_project_and_tls(overrides):
    with pytest.raises(ValueError):
        hosted_configuration(**overrides)


@pytest.fixture(scope="module")
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def signed_client(signing_key, *, role="admin", agency=None, settings=None, **changes):
    app = main.create_app(settings or h1_settings())
    public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(signing_key.public_key()))
    public.update(kid="h1-only", alg="RS256", use="sig")
    app.state.authentication.jwks.fetch_data = lambda: {"keys": [public]}
    metadata = {"hub_role": role}
    if agency:
        metadata["hub_agency"] = agency
    claims = {"iss": "http://127.0.0.1:54329/auth/v1", "aud": "authenticated",
              "iat": int(time.time()) - 1, "exp": int(time.time()) + 60,
              "sub": str(ALL_DEMO_ACTORS[f"agency_{agency.lower()}" if role == "agency" else role]), "email": "signed@example.test", "app_metadata": metadata, **changes}
    token = jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "h1-only"})
    return TestClient(app, client=("127.0.0.1", 50000)), {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("role,agency", [
    ("editor", None), ("publisher", None), ("viewer", None), ("admin", None),
    ("online_staff", None), ("agency", "KIN"), ("agency", "COMBAY"),
])
def test_seven_signed_test_identities_and_module_capabilities(signing_key, role, agency):
    client, headers = signed_client(signing_key, role=role, agency=agency)
    response = client.get("/v1/capabilities", headers=headers)
    assert response.status_code == 200
    assert response.json()["data"]["deferred"] == ["finance", "actuals", "documents", "assistant"]
    assert response.json()["data"]["milestone"] == "H1"


@pytest.mark.parametrize("changes", [
    {"exp": 1}, {"iss": "https://wrong.example/auth/v1"}, {"aud": "service_role"},
    {"email": ""}, {"is_anonymous": True},
])
def test_invalid_jwt_cannot_use_headers_or_local_cookie(signing_key, changes):
    client, headers = signed_client(signing_key, **changes)
    headers.update({"X-Hub-Role": "admin", "Cookie": "hub_demo_role=admin"})
    assert client.get("/v1/capabilities", headers=headers).status_code == 401


@pytest.mark.parametrize("method,path", [
    ("GET", "/v1/admin/ads/actuals"), ("GET", "/v1/admin/ads/memos"),
    ("GET", "/v1/admin/ads/document-tracking"), ("POST", "/v1/admin/ads/archive"),
    ("GET", "/v1/admin/ads/registrations/SN2600001M/monthly-lines"),
    ("POST", "/v1/admin/assistant/runs"), ("POST", "/v1/admin/assistant/proposals"),
])
def test_h2_modules_refuse_before_sql_or_processing(signing_key, method, path):
    client, headers = signed_client(signing_key)
    assert client.request(method, path).status_code == 401
    response = client.request(method, path, headers=headers)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "hosted_h1_unavailable"
    assert "H2" in response.json()["error"]["message"]


def test_cors_only_allows_configured_origin(signing_key):
    client, _ = signed_client(signing_key)
    headers = {"Origin": "http://127.0.0.1:3001", "Access-Control-Request-Method": "POST",
               "Access-Control-Request-Headers": "authorization,content-type,x-filename"}
    allowed = client.options("/v1/admin/assets", headers=headers)
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == headers["Origin"]
    assert "access-control-allow-credentials" not in allowed.headers
    denied = client.options("/v1/admin/assets", headers={**headers, "Origin": "https://other.invalid"})
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers


def metadata_for(content):
    _, metadata = assets.prepare_upload(content, "image/png", "sample.png")
    return {**metadata, "storage_bucket": BUCKET, "source_system": "hub-hosted-test"}


def test_private_storage_never_overwrites_and_checks_duplicate_bytes(monkeypatch):
    store = HostedAssets(h1_settings())
    content = image_bytes()
    metadata = metadata_for(content)
    calls = []
    def request(method, path, body=None, mime=None, limit=None):
        calls.append((method, path, body, mime))
        if path.startswith("bucket/"):
            return 200, json.dumps({"id": BUCKET, "public": False}).encode()
        if method == "POST":
            assert body == content and mime == "image/png"
            return 409, b""
        assert path.startswith("object/authenticated/")
        return 200, content
    monkeypatch.setattr(store, "request", request)
    assert store.install(content, metadata) is False
    assert [call[0] for call in calls] == ["GET", "POST", "GET"]


@pytest.mark.parametrize("payload", [
    {"id": BUCKET, "public": True}, {"id": "another", "public": False}, {}, None,
])
def test_public_or_wrong_bucket_is_never_used(monkeypatch, payload):
    store = HostedAssets(h1_settings())
    monkeypatch.setattr(store, "request", lambda *args, **kwargs: (200, json.dumps(payload).encode()))
    with pytest.raises(HTTPException, match="503"):
        store.install(image_bytes(), metadata_for(image_bytes()))


@pytest.mark.parametrize("change", [
    {"storage_path": "../private.txt"}, {"storage_bucket": "public"},
    {"source_system": "hub-local"}, {"checksum": "a" * 64},
])
def test_private_read_refuses_metadata_without_network(change):
    store = HostedAssets(h1_settings())
    with pytest.raises(HTTPException):
        store.read({**metadata_for(image_bytes()), **change}, check_bucket=False)


def test_private_read_validates_checksum(monkeypatch):
    store = HostedAssets(h1_settings())
    content = image_bytes()
    monkeypatch.setattr(store, "request", lambda *args, **kwargs: (200, b"x" * len(content)))
    with pytest.raises(HTTPException) as error:
        store.read(metadata_for(content), check_bucket=False)
    assert error.value.detail["code"] == "file_unavailable"


def test_storage_error_never_contains_provider_body_or_credentials(monkeypatch):
    store = HostedAssets(h1_settings())
    def denied(*args, **kwargs):
        raise HTTPError("https://sensitive.invalid", 403, store.key, {}, io.BytesIO(store.key.encode()))
    monkeypatch.setattr(store.opener, "open", denied)
    assert store.request("GET", "bucket/" + BUCKET) == (403, b"")
    with pytest.raises(HTTPException) as error:
        store.require_private_bucket()
    assert store.key not in str(error.value)


def test_storage_redirects_are_not_followed():
    assert NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.invalid") is None


def test_upload_sanitizes_svg_before_private_store_and_keeps_registry_actor(monkeypatch, signing_key):
    observed = {}
    class Connection:
        async def execute(self, *args):
            pass
        async def fetchval(self, query, metadata):
            observed["registered"] = metadata
            return {"asset": {"id": str(UUID(int=900)), **metadata}, "reused": False}
    @asynccontextmanager
    async def database(request, actor):
        observed["actor"] = actor.role
        yield Connection()
    def install(self, content, metadata):
        observed.update(content=content, metadata=metadata)
        return True
    monkeypatch.setattr(main, "database", database)
    monkeypatch.setattr(HostedAssets, "install", install)
    client, headers = signed_client(signing_key, role="editor")
    response = client.post("/v1/admin/assets", content=b'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><script>alert(1)</script><rect width="512" height="512"/></svg>',
                           headers={**headers, "Content-Type": "image/svg+xml", "X-Filename": "sample.svg"})
    assert response.status_code == 201
    assert b"script" not in observed["content"]
    assert observed["actor"] == "editor"
    assert observed["registered"]["storage_provider"] == "supabase"
    assert observed["registered"]["checksum"] == hashlib.sha256(observed["content"]).hexdigest()


def test_hosted_registry_cannot_issue_even_if_approval_changes(monkeypatch, signing_key):
    class Connection:
        async def fetchval(self, query, *args):
            assert query == "SELECT ads.registry_settings()"
            return {"sena_h_approved": True}
    @asynccontextmanager
    async def database(request, actor):
        yield Connection()
    monkeypatch.setattr(main, "database", database)
    client, headers = signed_client(signing_key)
    response = client.get("/v1/admin/ads/settings", headers=headers)
    assert response.status_code == 200
    assert response.json()["data"] == {"sena_h_approved": True, "test_mode": False, "can_issue": False}


def test_simulation_api_rejects_remote_request_even_with_valid_jwt(signing_key):
    local, headers = signed_client(signing_key)
    remote = TestClient(local.app, client=("203.0.113.5", 50000))
    assert remote.get("/v1/capabilities", headers=headers).status_code == 403


def test_private_file_delivery_keeps_rights_rpc_and_safe_headers(monkeypatch, signing_key):
    content = image_bytes()
    metadata = metadata_for(content)
    calls = []
    class Connection:
        async def fetchval(self, query, asset_id):
            calls.append((query, asset_id))
            return metadata
    @asynccontextmanager
    async def database(request, actor):
        assert actor.role == "viewer"
        yield Connection()
    monkeypatch.setattr(main, "database", database)
    monkeypatch.setattr(HostedAssets, "read", lambda self, row: content)
    client, headers = signed_client(signing_key, role="viewer")
    asset_id = UUID(int=900)
    response = client.get(f"/v1/admin/assets/{asset_id}/file", headers=headers)
    assert response.status_code == 200 and response.content == content
    assert calls == [("SELECT hub.asset_file($1)", asset_id)] * 2
    assert response.headers["content-security-policy"] == "sandbox; default-src 'none'; frame-ancestors 'none'"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-store"
    agency, headers = signed_client(signing_key, role="agency", agency="KIN")
    assert agency.get(f"/v1/admin/assets/{asset_id}/file", headers=headers).status_code == 403
    assert len(calls) == 2


@pytest.mark.parametrize("profile,approved,issuing,allowed", [
    (True, False, False, True), (False, False, False, False),
    (True, True, False, False), (True, False, True, False),
])
def test_startup_requires_profile_and_both_issuance_flags_off(monkeypatch, profile, approved, issuing, allowed):
    closed = []
    class Connection:
        @asynccontextmanager
        async def transaction(self):
            yield
        async def execute(self, query):
            assert query == "SET LOCAL ROLE hub_app"
        async def fetchval(self, query):
            return {"SELECT hub.hosted_test_profile()": profile,
                    "SELECT hub.registry_startup_ready()": profile and not approved and not issuing}[query]
    class Pool:
        @asynccontextmanager
        async def acquire(self):
            yield Connection()
        async def close(self):
            closed.append(True)
    async def pool(*args, **kwargs):
        return Pool()
    monkeypatch.setattr(main.asyncpg, "create_pool", pool)
    client = TestClient(main.create_app(h1_settings()))
    if allowed:
        with client:
            assert client.get("/health").status_code == 200
    else:
        with pytest.raises(RuntimeError):
            with client:
                pytest.fail("Unsafe H1 startup succeeded")
    assert closed == [True]


@pytest.mark.integration
def test_disposable_managed_simulation_end_to_end():
    """Opt-in only. Never reads the hosted profile or normal development database."""
    if os.getenv("HUB_RUN_HOSTED_H1") != "1":
        pytest.skip("Requires explicit H1 disposable simulation and loopback Auth/Storage mock")
    metadata_path = Path(__file__).resolve().parents[3] / ".local" / "hosted-test-simulation" / "current.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    database_url = metadata["runtimeDatabaseUrl"]
    target = urlparse(database_url)
    if (target.hostname != "127.0.0.1" or target.port != metadata['port'] or target.port == 55432
            or target.path != "/hub_hosted_test_simulation" or target.username != "hub_runtime"):
        pytest.fail("H1 simulation target is not the isolated allowlisted database")
    sessions = {}
    # These public fixture values work only on the local mock; no real identity is created.
    auth_origin = f"http://127.0.0.1:{metadata['ports']['auth']}"
    with httpx.Client(base_url=auth_origin, timeout=10, follow_redirects=False) as auth:
        for label in ("editor", "publisher", "viewer", "admin", "online", "agency-kin", "agency-combay"):
            response = auth.post("/auth/v1/token?grant_type=password", json={
                "email": f"hub-test-{label}@example.test", "password": "H1-synthetic-only!",
            }, headers={"apikey": "h1-simulation-public-key"})
            assert response.status_code == 200
            sessions[label] = {"Authorization": "Bearer " + response.json()["access_token"]}
    config = h1_settings(database_url=database_url, supabase_url=auth_origin,
                         admin_origin=f"http://127.0.0.1:{metadata['ports']['admin']}",
                         supabase_storage_key="", r2_private_bucket_confirmed=True,
                         r2_credentials_file=str(metadata_path.parent / 'r2-simulation.json'))
    with TestClient(main.create_app(config), client=("127.0.0.1", 50000)) as client:
        for label, headers in sessions.items():
            assert client.get("/v1/capabilities", headers=headers).status_code == 200
            expected = 200 if label in {"editor", "publisher", "viewer", "admin"} else 403
            assert client.get("/v1/admin/brands", headers=headers).status_code == expected
            assert client.get("/v1/admin/ads/archive", headers=headers).status_code == 503
            assert client.get("/v1/admin/assistant/config", headers=headers).status_code == 503
        registrations = {}
        for agency in ("kin", "combay"):
            headers = sessions["agency-" + agency]
            response = client.get("/v1/admin/ads/registrations", headers=headers)
            assert response.status_code == 200
            rows = response.json()["data"]
            assert rows and all(row["registration"]["agency"] == agency.upper() for row in rows)
            registrations[agency] = rows[0]["registration"]["code"]
        other = client.get("/v1/admin/ads/registrations/" + registrations["combay"], headers=sessions["agency-kin"])
        assert other.status_code in {403, 404}
        flags = client.get("/v1/admin/ads/settings", headers=sessions["online"])
        assert flags.status_code == 200
        assert flags.json()["data"] == {"sena_h_approved": False, "test_mode": False, "can_issue": False}
        issue = client.post("/v1/admin/ads/registrations/" + registrations["kin"] + "/names",
                            headers=sessions["online"], json={"variant": "KW-BRAND"})
        assert issue.status_code == 409
        for path in ("promotions", "releases", "projects"):
            assert client.get("/v1/admin/" + path, headers=sessions["viewer"]).status_code == 200
        existing = client.get("/v1/admin/assets/71000000-0000-0000-0000-000000000011/file", headers=sessions["viewer"])
        assert existing.status_code == 200 and existing.content.startswith(b"\x89PNG")
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">'
               '<script>alert(1)</script><rect width="512" height="512" id="synthetic-h1-' + uuid4().hex + '"/></svg>').encode()
        upload_headers = {**sessions["editor"], "Content-Type": "image/svg+xml", "X-Filename": "synthetic-h1-test.svg"}
        uploaded = client.post("/v1/admin/assets", headers=upload_headers, content=svg)
        assert uploaded.status_code == 201
        asset = uploaded.json()["data"]
        assert asset["source_system"] == "hub-hosted-test" and asset["rights_status"] == "pending"
        retry = client.post("/v1/admin/assets", headers=upload_headers, content=svg)
        assert retry.status_code == 200 and retry.json()["data"]["id"] == asset["id"]
        assert retry.json()["meta"]["reused"] is True
        delivered = client.get(f"/v1/admin/assets/{asset['id']}/file", headers=sessions["viewer"])
        assert delivered.status_code == 200 and b"script" not in delivered.content
        assert delivered.headers["content-type"].startswith("image/svg+xml")
        assert delivered.headers["content-security-policy"].startswith("sandbox;")
        evidence = {"updated_at": asset["updated_at"], "decision": "approved", "effective_from": None, "effective_to": None,
                    "rights_notes": "หลักฐานสิทธิ์ข้อมูลตัวอย่าง H1 เท่านั้น", "change_reason": "ทดสอบการยืนยันสิทธิ์ข้อมูลตัวอย่าง"}
        assert client.post(f"/v1/admin/assets/{asset['id']}/review", headers=sessions["editor"], json=evidence).status_code == 403
        reviewed = client.post(f"/v1/admin/assets/{asset['id']}/review", headers=sessions["publisher"], json=evidence)
        assert reviewed.status_code == 200
        assert client.get(f"/v1/admin/assets/{asset['id']}/file", headers=sessions["agency-kin"]).status_code == 403
