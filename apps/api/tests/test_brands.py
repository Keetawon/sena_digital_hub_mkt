from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import UUID

from fastapi.testclient import TestClient
import pytest

from sena_hub_api import main
from sena_hub_api.auth import DEMO_ACTORS
from sena_hub_api.main import PatchBrand, create_app
from test_api import settings, TOKENS


ID = "00000000-0000-0000-0000-000000000001"
STAMP = "2026-09-16T00:00:00Z"


@pytest.fixture
def client():
    return TestClient(create_app(settings()), client=("127.0.0.1", 50000))


@pytest.mark.parametrize("method,path", [
    ("GET", "/v1/admin/sources/brands"), ("GET", "/v1/admin/brands"), ("POST", "/v1/admin/brands"),
    ("GET", "/v1/admin/brands/brd_test"), ("PATCH", "/v1/admin/brands/brd_test"),
    ("GET", "/v1/admin/brands/brd_test/versions"), ("POST", "/v1/admin/brands/brd_test/publish"),
    ("POST", "/v1/admin/brands/brd_test/withdraw"), ("POST", "/v1/admin/brands/brd_test/rollback"),
    ("POST", "/v1/admin/brands/brd_test/assets"), ("POST", f"/v1/admin/brands/brd_test/assets/{ID}/remove"),
    ("POST", "/v1/admin/projects/prj_test/brand"),
    ("GET", "/v1/admin/brand-requests"), ("POST", "/v1/admin/brand-requests"),
    ("POST", f"/v1/admin/brand-requests/{ID}/resolve"), ("GET", "/v1/brands"), ("GET", "/v1/brands/brd_test"),
])
def test_brand_routes_require_authentication(client, method, path):
    assert client.request(method, path).status_code == 401


@pytest.mark.parametrize("role,method,path", [
    ("editor", "POST", "/v1/admin/brands"), ("publisher", "POST", "/v1/admin/brands"),
    ("viewer", "PATCH", "/v1/admin/brands/brd_test"), ("publisher", "PATCH", "/v1/admin/brands/brd_test"),
    ("publisher", "POST", "/v1/admin/brands/brd_test/assets"),
    ("publisher", "POST", f"/v1/admin/brands/brd_test/assets/{ID}/remove"),
    ("admin", "POST", "/v1/admin/brands/brd_test/publish"),
    ("admin", "POST", "/v1/admin/brands/brd_test/withdraw"),
    ("admin", "POST", "/v1/admin/brands/brd_test/rollback"),
    ("admin", "POST", "/v1/admin/projects/prj_test/publish"),
    ("admin", "POST", f"/v1/admin/assets/{ID}/review"),
    ("viewer", "POST", "/v1/admin/projects/prj_test/brand"),
    ("publisher", "POST", "/v1/admin/brand-requests"),
    ("editor", "POST", f"/v1/admin/brand-requests/{ID}/resolve"),
    ("service_consumer", "GET", "/v1/admin/brands"),
])
def test_brand_role_boundaries(client, role, method, path):
    response = client.request(method, path, headers={"Authorization": f"Bearer {TOKENS[role]}", "X-Hub-Role": "publisher"})
    assert response.status_code == 403


def test_internal_admin_keeps_identity_when_reading_published_brands(client, monkeypatch):
    calls = []
    class DB:
        async def fetch(self, query, *args):
            assert 'FROM public_api.read_brands()' in query
            calls.append(query)
            return []
    @asynccontextmanager
    async def database(request, actor):
        assert actor.role == 'admin' and actor.id == DEMO_ACTORS['admin']
        yield DB()
    monkeypatch.setattr(main, 'database', database)
    response = client.get('/v1/brands', headers={'Authorization': f"Bearer {TOKENS['admin']}"})
    assert response.status_code == 200 and response.json()['data'] == [] and calls


def test_admin_role_is_appended_and_missing_token_fails_closed():
    assert {role: actor.int for role, actor in DEMO_ACTORS.items()} == {
        "editor": 1, "publisher": 2, "viewer": 3, "service_consumer": 4, "admin": 5,
    }
    with pytest.raises(ValueError):
        settings(demo_tokens={role: token for role, token in TOKENS.items() if role != "admin"})


@pytest.mark.parametrize("changes", [{}, {"rem_brand_id": "000003"}, {"company_id": ID}, {"published_version_id": ID},
                                      {"public_name": None}, {"description": None}, {"status": "published"},
                                      {"status": None}, {"slug": "../escape"}, {"slug": "UPPER"},
                                      {"updated_at": "2026-09-16T00:00:00", "slug": "test"}])
def test_brand_patch_accepts_only_versioned_marketing_fields(client, changes):
    response = client.patch("/v1/admin/brands/brd_test", json={"updated_at": STAMP, **changes},
                            headers={"Authorization": f"Bearer {TOKENS['editor']}"})
    assert response.status_code == 422


def test_incomplete_brand_drafts_can_be_saved():
    body = PatchBrand(updated_at=STAMP, public_name={"th": ""}, description={}, slug="", status="inactive")
    assert body.slug == "" and body.status == "inactive"


@pytest.mark.parametrize("path,body,role", [
    ("/v1/admin/brands", {"rem_brand_id": " "}, "admin"),
    ("/v1/admin/brands", {"rem_brand_id": "000003", "company_id": ID}, "admin"),
    ("/v1/admin/brand-requests", {"requested_name": " ", "change_reason": "ตรวจสอบ"}, "editor"),
    ("/v1/admin/brand-requests", {"requested_name": "แบรนด์", "rem_brand_id": " ", "change_reason": "ตรวจสอบ"}, "admin"),
    (f"/v1/admin/brand-requests/{ID}/resolve", {"brand_id": None, "decision": "resolved", "change_reason": "ตรวจสอบ", "updated_at": STAMP}, "admin"),
    (f"/v1/admin/brand-requests/{ID}/resolve", {"brand_id": ID, "decision": "rejected", "change_reason": "ตรวจสอบ", "updated_at": STAMP}, "admin"),
    ("/v1/admin/brands/brd_test/assets", {"asset_id": ID, "asset_role": "hero", "alt_text": {"th": "ภาพ"}, "updated_at": STAMP}, "editor"),
    ("/v1/admin/projects/prj_test/brand", {"brand_id": "brd_public_not_uuid", "updated_at": STAMP}, "admin"),
])
def test_brand_request_binding_and_assignment_validation(client, path, body, role):
    response = client.post(path, json=body, headers={"Authorization": f"Bearer {TOKENS[role]}"})
    assert response.status_code == 422


@pytest.mark.parametrize("query", ["?brand=brd_test", "?brand_id=", "?brand_id=%20", "?brand_id=brd_a&brand_id=brd_b",
                                    "?brand_id=brd_a&company_id=BK", "?filter=all", "?brand_id=" + "x" * 201])
def test_project_filter_rejects_unknown_blank_or_repeated_parameters(client, query):
    response = client.get(f"/v1/projects{query}", headers={"Authorization": f"Bearer {TOKENS['service_consumer']}"})
    assert response.status_code == 422


@pytest.mark.parametrize("path", ["/v1/brands", "/v1/brands/brd_test", "/v1/projects/prj_test"])
def test_public_endpoints_without_filters_reject_query_parameters(client, path):
    response = client.get(path, params={"brand_id": "brd_test"}, headers={"Authorization": f"Bearer {TOKENS['service_consumer']}"})
    assert response.status_code == 422


def test_project_filter_is_exact_parameterized_snapshot_brand_id(client, monkeypatch):
    calls = []
    class Connection:
        async def fetch(self, query, *values):
            calls.append((query, values))
            return []
    @asynccontextmanager
    async def connection(request, actor):
        assert actor.role == "service_consumer"
        yield Connection()
    monkeypatch.setattr(main, "database", connection)
    value = "brd_x' OR 1=1--"
    response = client.get("/v1/projects", params={"brand_id": value}, headers={"Authorization": f"Bearer {TOKENS['service_consumer']}"})
    assert response.status_code == 200 and response.json()["data"] == []
    assert calls[0][1] == (value,)
    assert "payload#>>'{brand,public_brand_id}'=$1" in calls[0][0]
    assert value not in calls[0][0]


@pytest.mark.parametrize("role", ["editor", "publisher", "viewer", "admin"])
def test_brand_history_includes_frozen_payload_under_the_existing_caller_role(client, monkeypatch, role):
    brand_id, version_id = UUID(int=21), UUID(int=22)
    frozen = {"public_name": {"th": "ชื่อในเวอร์ชันเดิม"}, "description": {"th": "คำอธิบายเดิม"},
              "slug": "original-brand", "status": "active", "assets": []}
    metadata = {"version_id": str(version_id), "version_no": 1, "published_at": STAMP,
                "publisher": ID, "change_reason": "เหตุผลที่บันทึกเดิม"}
    calls = []

    class Connection:
        async def fetchval(self, query, *values):
            calls.append((query, values))
            if "brand_detail" in query:
                return {"id": str(brand_id), "public_name": {"th": "ฉบับร่างที่เปลี่ยนแล้ว"},
                        "published_version_id": None}
            assert "hub.brand_versions($1)" in query and values == (brand_id,)
            return [{**metadata, "payload": frozen}]

    @asynccontextmanager
    async def connection(request, actor):
        assert actor.role == role
        yield Connection()

    monkeypatch.setattr(main, "database", connection)
    response = client.get("/v1/admin/brands/brd_review/versions", headers={"Authorization": f"Bearer {TOKENS[role]}"})
    assert response.status_code == 200
    assert response.json()["data"] == [{**metadata, "payload": frozen}]
    assert calls[0][1] == ("brd_review",)
    assert len(calls) == 2 and all(query.startswith("SELECT ") for query, _ in calls)


def test_brand_history_payload_is_still_denied_to_public_consumer(client):
    response = client.get("/v1/admin/brands/brd_review/versions",
                          headers={"Authorization": f"Bearer {TOKENS['service_consumer']}"})
    assert response.status_code == 403


def test_create_project_assigns_brand_in_the_same_transaction(client, monkeypatch):
    calls = []
    transaction_count = 0
    class Connection:
        async def fetchval(self, query, *values):
            calls.append((query, values))
            if "create_project_from_rem" in query:
                return UUID(int=10)
            assert "assign_project_brand" in query
            return {"id": str(UUID(int=10)), "brand_id": ID}
        async def fetchrow(self, query, *values):
            return {"public_project_id": "prj_test", "updated_at": datetime(2026, 9, 16, tzinfo=timezone.utc)}
    @asynccontextmanager
    async def connection(request, actor):
        nonlocal transaction_count
        transaction_count += 1
        assert actor.role == "admin"
        yield Connection()
    monkeypatch.setattr(main, "database", connection)
    response = client.post("/v1/admin/projects", json={"rem_project_id": "00001", "brand_id": ID},
                           headers={"Authorization": f"Bearer {TOKENS['admin']}"})
    assert response.status_code == 201 and response.json()["data"]["brand_id"] == ID
    assert transaction_count == 1 and len(calls) == 2
    assert calls[0][1] == ("00001",)
    assert calls[1][1][:2] == (UUID(int=10), UUID(ID))
