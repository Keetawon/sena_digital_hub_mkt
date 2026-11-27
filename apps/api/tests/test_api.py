import json
import logging
import time
from contextlib import asynccontextmanager

import asyncpg
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from content_workflow_fixture import unit_publication_persona
from sena_hub_api.auth import Authentication, DEMO_ACTORS, ROLES, Settings
from sena_hub_api import main
from sena_hub_api.main import AddModel, CreateProject, PatchModel, PatchProject, create_app


TOKENS = {role: f"test-only-{role}-" + "x" * 40 for role in ROLES}


def settings(**overrides):
    return Settings(**{
        "database_url": "postgresql://test:test@127.0.0.1:55432/test",
        "auth_mode": "demo", "environment": "local", "demo_tokens": TOKENS,
        **overrides,
    })


@pytest.fixture
def client():
    # No pool/lifespan needed: every request below must be rejected before SQL.
    return TestClient(create_app(settings()), client=("127.0.0.1", 50000))


@pytest.mark.parametrize("method,path", [
    ("GET", "/v1/admin/projects"), ("GET", "/v1/admin/projects/demo"),
    ("PATCH", "/v1/admin/projects/demo"), ("GET", "/v1/admin/projects/demo/versions"),
    ("POST", "/v1/admin/projects/demo/publish"), ("POST", "/v1/admin/projects/demo/withdraw"),
    ("POST", "/v1/admin/projects/demo/rollback"), ("GET", "/v1/projects"),
    ("GET", "/v1/projects/demo"),
    ("GET", "/v1/admin/sources/projects"), ("POST", "/v1/admin/projects"),
    ("GET", "/v1/admin/projects/demo/source-models"),
    ("POST", "/v1/admin/projects/demo/models"),
    ("PATCH", "/v1/admin/projects/demo/models/model"),
    ("POST", "/v1/admin/projects/demo/models/model/review"),
    ("POST", "/v1/admin/projects/demo/prefill"),
    ("GET", "/v1/admin/projects/demo/models/model"),
    ("POST", "/v1/admin/projects/demo/models/model/assets"),
    ("POST", "/v1/admin/projects/demo/models/model/assets/00000000-0000-0000-0000-000000000001/remove"),
])
def test_every_data_route_requires_auth(client, method, path):
    response = client.request(method, path, headers={"X-Hub-Role": "publisher"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"
    assert response.headers["cache-control"] == "no-store"


def test_health_only_and_no_openapi(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/openapi.json").status_code == 404


@pytest.mark.parametrize("sqlstate,status,code,message", [
    ("22P02", 422, "invalid_value", "รูปแบบข้อมูลไม่ถูกต้อง"),
    ("23503", 422, "invalid_reference", "ไม่พบรายการอ้างอิงที่ใช้งานได้ กรุณาเลือกข้อมูลใหม่"),
    ("42501", 403, "forbidden", None),
    ("23514", 422, "not_ready", None),
    ("23505", 409, "duplicate", None),
    ("40001", 409, "conflict", None),
    ("P0002", 404, "not_found", None),
    ("08006", 503, "database_unavailable", None),
    ("53300", 503, "database_unavailable", None),
    ("57P01", 503, "database_unavailable", None),
    ("57P05", 503, "database_unavailable", None),
    ("57014", 504, "query_timeout", "คำขอใช้เวลาประมวลผลนานเกินกำหนด กรุณาลองอีกครั้ง"),
    ("42601", 500, "server_error", None),
    ("XX000", 500, "server_error", None),
    (None, 500, "server_error", None),
])
def test_postgres_error_mapping_and_safe_logging(client, caplog, sqlstate, status, code, message):
    error = asyncpg.PostgresError("private database value")
    error.sqlstate = sqlstate

    @client.app.get("/test-postgres-error")
    async def fail_query():
        raise error

    with caplog.at_level(logging.ERROR, logger="sena_hub_api"):
        response = client.get("/test-postgres-error")
    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    if message:
        assert response.json()["error"]["message"] == message
    records = [record for record in caplog.records if record.name == "sena_hub_api"]
    if status >= 500:
        assert len(records) == 1
        assert records[0].levelno == logging.ERROR
        assert records[0].getMessage() == f"Database request failed: sqlstate={sqlstate} type=PostgresError"
        assert records[0].exc_info is None
    else:
        assert records == []
    assert "private database value" not in caplog.text + response.text


def test_unexpected_error_logs_traceback_without_private_input(caplog):
    app = create_app(settings())
    private_values = ("private chained value", "private exception value", "private request body", "private-token")

    @app.post("/test-unexpected-error")
    async def fail_request():
        try:
            raise ValueError(private_values[0])
        except ValueError as error:
            raise RuntimeError(private_values[1]) from error

    client = TestClient(app, raise_server_exceptions=False)
    with caplog.at_level(logging.ERROR, logger="sena_hub_api"):
        response = client.post("/test-unexpected-error", json={"name": private_values[2]},
                               headers={"Authorization": f"Bearer {private_values[3]}"})
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "server_error"
    record, = [record for record in caplog.records if record.name == "sena_hub_api"]
    assert record.levelno == logging.ERROR
    assert record.getMessage() == "Request failed: RuntimeError"
    assert record.exc_info is not None and record.exc_info[2] is not None
    assert "Traceback" in caplog.text and "in fail_request" in caplog.text
    for private_value in private_values:
        assert private_value not in caplog.text + response.text


@pytest.mark.parametrize("role,method,path", [
    ("editor", "POST", "/v1/admin/projects/demo/publish"),
    ("editor", "POST", "/v1/admin/projects/demo/withdraw"),
    ("viewer", "PATCH", "/v1/admin/projects/demo"),
    ("service_consumer", "GET", "/v1/admin/projects"),
    ("service_consumer", "GET", "/v1/admin/sources/projects"),
    ("service_consumer", "GET", "/v1/admin/projects/demo/source-models"),
    ("viewer", "POST", "/v1/admin/projects"),
    ("viewer", "POST", "/v1/admin/projects/demo/models"),
    ("viewer", "PATCH", "/v1/admin/projects/demo/models/model"),
    ("viewer", "POST", "/v1/admin/projects/demo/models/model/review"),
    ("viewer", "POST", "/v1/admin/projects/demo/prefill"),
    ("service_consumer", "GET", "/v1/admin/projects/demo/models/model"),
    ("viewer", "POST", "/v1/admin/projects/demo/models/model/assets"),
    ("viewer", "POST", "/v1/admin/projects/demo/models/model/assets/00000000-0000-0000-0000-000000000001/remove"),
])
def test_role_cannot_be_overridden_by_client_header(client, role, method, path):
    response = client.request(method, path, json={"change_reason": "ทดสอบ"}, headers={
        "Authorization": f"Bearer {TOKENS[role]}", "X-Hub-Role": "publisher",
    })
    assert response.status_code == 403


def test_published_read_keeps_internal_actor_despite_forged_role_header(client, monkeypatch):
    calls = []
    class DB:
        async def fetch(self, query, *args):
            assert 'FROM public_api.read_projects()' in query
            calls.append(query)
            return []
    @asynccontextmanager
    async def database(request, actor):
        assert actor.role == 'publisher' and actor.id == DEMO_ACTORS['publisher']
        yield DB()
    monkeypatch.setattr(main, 'database', database)
    response = client.get('/v1/projects', headers={
        'Authorization': f"Bearer {TOKENS['publisher']}", 'X-Hub-Role': 'service_consumer'})
    assert response.status_code == 200 and response.json()['data'] == [] and calls


@pytest.mark.parametrize("body", [
    {"public_name": {"th": "ใหม่"}},
    {"updated_at": "2026-09-16T10:00:00+07:00", "rem_project_id": "OTHER"},
    {"updated_at": "2026-09-16T10:00:00+07:00", "published_version_id": "override"},
    {"updated_at": "2026-09-16T10:00:00+07:00", "latitude": 91},
    {"updated_at": "2026-09-16T10:00:00+07:00", "longitude": True},
    {"updated_at": "2026-09-16T10:00:00", "slug": "valid-slug"},
    {"updated_at": "2026-09-16T10:00:00+07:00", "public_name": None},
])
def test_patch_rejects_unsafe_or_unversioned_changes(client, body):
    response = client.patch("/v1/admin/projects/demo", json=body, headers={"Authorization": f"Bearer {TOKENS['editor']}"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert "input" not in response.text


def test_publish_requires_nonblank_reason(client, monkeypatch):
    unit_publication_persona(monkeypatch)
    response = client.post("/v1/admin/projects/demo/publish", json={"change_reason": "  "}, headers={"Authorization": f"Bearer {TOKENS['viewer']}"})
    assert response.status_code == 422


def test_incomplete_draft_can_have_blank_slug():
    draft = PatchProject(updated_at="2026-09-16T10:00:00+07:00", slug="")
    assert draft.slug == ""


@pytest.mark.parametrize("body", [
    {"updated_at": "2026-09-16T10:00:00+07:00"},
    {"updated_at": "2026-09-16T10:00:00", "source_fingerprint": "a" * 64},
    {"updated_at": "2026-09-16T10:00:00+07:00", "source_fingerprint": "unreviewed"},
    {"updated_at": "2026-09-16T10:00:00+07:00", "source_fingerprint": "a" * 64, "overwrite": True},
])
def test_prefill_requires_reviewed_source_and_draft_versions(client, body):
    response = client.post("/v1/admin/projects/demo/prefill", json=body,
                           headers={"Authorization": f"Bearer {TOKENS['editor']}"})
    assert response.status_code == 422


def test_bilingual_project_fields_round_trip_without_locale_loss():
    data = {"updated_at": "2026-09-16T10:00:00+07:00",
            "public_name": {"th": "ชื่อการตลาด", "en": "Commercial name", "zh": "项目"},
            "address": {"th": "ที่อยู่", "en": "English address"}, "latitude": 0, "longitude": 100}
    assert PatchProject(**data).model_dump(mode="json", exclude_unset=True) == data


STAMP = "2026-09-16T10:00:00+07:00"


@pytest.mark.parametrize("value", ["", " \t\n", "x" * 201, 123, None, "source\x00id"])
@pytest.mark.parametrize("path,field", [
    ("/v1/admin/projects", "rem_project_id"),
    ("/v1/admin/projects/demo/models", "rem_model_id"),
])
def test_source_selection_rejects_invalid_ids_before_sql(client, path, field, value):
    body = {field: value}
    if field == "rem_model_id":
        body["updated_at"] = STAMP
    response = client.post(path, json=body, headers={"Authorization": f"Bearer {TOKENS['editor']}"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_source_ids_are_preserved_as_data_and_numeric_drafts_can_be_incomplete():
    source = " โครงการ / A's-01 # REM "
    assert CreateProject(rem_project_id=source).rem_project_id == source
    assert AddModel(rem_model_id=source, updated_at=STAMP).rem_model_id == source
    draft = PatchModel(updated_at=STAMP, public_name={"th": ""}, bedrooms=0, bathrooms=1.5,
                       usable_area_sqm=None, parking_spaces=None)
    assert draft.bedrooms == 0
    assert draft.usable_area_sqm is None


@pytest.mark.parametrize("changes", [
    {}, {"rem_model_id": "OTHER"}, {"model_name_rem": "replacement"},
    {"match_status": "CONFIRMED"}, {"verified_by": "override"},
    {"public_name": None}, {"bedrooms": -1}, {"bedrooms": True},
    {"bathrooms": "1"}, {"bathrooms": -0.5}, {"usable_area_sqm": 0},
    {"parking_spaces": 1.5}, {"parking_spaces": True}, {"parking_spaces": 2147483648},
    {"updated_at": "2026-09-16T10:00:00", "bedrooms": 2},
])
def test_model_patch_rejects_unsafe_changes_before_sql(client, changes):
    response = client.patch("/v1/admin/projects/demo/models/model", json={"updated_at": STAMP, **changes},
                            headers={"Authorization": f"Bearer {TOKENS['editor']}"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("field,value", [
    ("bedrooms", float("nan")), ("bathrooms", float("inf")),
    ("usable_area_sqm", float("-inf")),
])
def test_model_numbers_must_be_finite(client, field, value):
    # Raw JSON covers clients emitting non-standard NaN/Infinity values too.
    response = client.patch("/v1/admin/projects/demo/models/model",
                            content=json.dumps({"updated_at": STAMP, field: value}),
                            headers={"Authorization": f"Bearer {TOKENS['editor']}", "Content-Type": "application/json"})
    assert response.status_code == 422


@pytest.mark.parametrize("changes", [
    {"decision": "SUGGESTED"}, {"decision": "confirmed"}, {"change_reason": "  "},
    {"updated_at": None}, {"verified_by": "client-supplied"},
])
def test_model_review_requires_explicit_valid_decision_and_reason(client, changes):
    response = client.post("/v1/admin/projects/demo/models/model/review",
                           json={"updated_at": STAMP, "decision": "CONFIRMED", "change_reason": "ตรวจสอบต้นทางแล้ว", **changes},
                           headers={"Authorization": f"Bearer {TOKENS['editor']}"})
    assert response.status_code == 422


def test_demo_cannot_be_used_remotely():
    client = TestClient(create_app(settings()), client=("203.0.113.5", 50000))
    response = client.get("/v1/admin/projects", headers={"Authorization": f"Bearer {TOKENS['publisher']}"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "local_only"


@pytest.mark.parametrize("overrides", [
    {"environment": "production"}, {"demo_tokens": {}},
    {"database_url": "postgresql://test:test@remote.example/test"},
    {"demo_tokens": dict.fromkeys(TOKENS, "same" * 12)},
    {"auth_mode": ""}, {"database_url": ""},
])
def test_configuration_fails_closed(overrides):
    with pytest.raises(ValueError):
        settings(**overrides)


@pytest.fixture(scope="module")
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def auth_and_claims(signing_key):
    auth = Authentication(settings(auth_mode="supabase", environment="production", supabase_url="https://example.supabase.co"))
    public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(signing_key.public_key()))
    public.update(kid="local-test-key", alg="RS256", use="sig")
    # Exercise PyJWKClient parsing/signature selection without online access.
    auth.jwks.fetch_data = lambda: {"keys": [public]}
    claims = {
        "iss": "https://example.supabase.co/auth/v1", "aud": "authenticated",
        "iat": int(time.time()) - 1, "exp": int(time.time()) + 60,
        "sub": "00000000-0000-0000-0000-000000000002",
        "app_metadata": {"hub_role": "publisher"}, "email": "synthetic@example.test",
    }
    return auth, claims


@pytest.mark.parametrize("hub_role", ["publisher", "admin"])
def test_supabase_verifies_identity_and_ignores_role_metadata(signing_key, hub_role):
    auth, claims = auth_and_claims(signing_key)
    claims["app_metadata"]["hub_role"] = hub_role
    claims.update(role="service_role", user_metadata={"hub_role": "editor"})
    token = jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "local-test-key"})
    assert auth.verify_jwt(token)["sub"] == claims["sub"]


@pytest.mark.parametrize("changes", [
    {"iss": "https://attacker.example/auth/v1"}, {"aud": "other-app"},
    {"aud": ["authenticated", "other-app"]}, {"exp": 1},
    {"email": ""}, {"is_anonymous": True}, {"sub": "not-a-uuid"},
])
def test_supabase_rejects_invalid_claims(signing_key, changes):
    auth, claims = auth_and_claims(signing_key)
    claims.update(changes)
    token = jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "local-test-key"})
    with pytest.raises((jwt.PyJWTError, ValueError)):
        auth.verify_jwt(token)


def test_supabase_rejects_wrong_signature_and_hmac(signing_key):
    auth, claims = auth_and_claims(signing_key)
    wrong_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    wrong = jwt.encode(claims, wrong_key, algorithm="RS256", headers={"kid": "local-test-key"})
    with pytest.raises(jwt.InvalidSignatureError):
        auth.verify_jwt(wrong)
    hmac = jwt.encode(claims, "x" * 64, algorithm="HS256")
    with pytest.raises(jwt.InvalidAlgorithmError):
        auth.verify_jwt(hmac)
