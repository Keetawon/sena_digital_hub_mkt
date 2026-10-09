from contextlib import asynccontextmanager
from datetime import datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from sena_hub_api import main
from sena_hub_api.commercial_types import BindCommercialAsset, CreateCommercialSet, PatchCommercialType
from test_api import TOKENS, settings


PREFIX = "/v1/admin/projects/prj_test/commercial-types"
STAMP = "2026-09-20T10:00:00+07:00"
MODEL = "mdl_" + "a" * 32
ROUTES = [("GET", PREFIX), ("POST", PREFIX), ("PATCH", PREFIX + "/ctyp_test"),
          ("POST", PREFIX + "/ctyp_test/assets"),
          ("POST", PREFIX + "/ctyp_test/assets/00000000-0000-0000-0000-000000000001/remove")]


@pytest.fixture
def client():
    return TestClient(main.create_app(settings()), client=("127.0.0.1", 50000))


@pytest.mark.parametrize("method,path", ROUTES)
def test_commercial_drafts_require_authentication(client, method, path):
    response = client.request(method, path)
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("method,path", ROUTES)
def test_consumer_cannot_access_commercial_drafts(client, method, path):
    response = client.request(method, path, headers={"Authorization": f"Bearer {TOKENS['service_consumer']}"})
    assert response.status_code == 403


@pytest.mark.parametrize("method,path", ROUTES[1:])
def test_viewer_cannot_write_commercial_drafts(client, method, path):
    response = client.request(method, path, headers={"Authorization": f"Bearer {TOKENS['viewer']}"})
    assert response.status_code == 403


@pytest.mark.parametrize("body", [
    {"types": [{"public_name": {"th": "แบบขาย"}}]},
    {"updated_at": STAMP, "types": []},
    {"updated_at": STAMP, "types": [{"public_name": {"th": "แบบขาย"}}] * 51},
    {"updated_at": STAMP, "types": [{"public_name": {"th": " "}}]},
    {"updated_at": STAMP, "types": [{"public_name": {"th": "แบบขาย"}, "available_unit_count": 5}]},
    {"updated_at": STAMP, "types": [{"public_name": {"th": "แบบขาย"}, "status": "approved"}]},
    {"updated_at": STAMP, "types": [{"public_name": {"th": "แบบขาย"}, "source_model_ids": [MODEL, MODEL]}]},
    {"updated_at": STAMP, "types": [{"public_name": {"th": "แบบขาย"}, "source_model_ids": ["REM-CODE"]}]},
    {"updated_at": STAMP, "types": [{"public_name": {"th": "แบบขาย"}, "bedrooms": True}]},
    {"updated_at": STAMP, "types": [{"public_name": {"th": "แบบขาย"}, "area_min_sqm": 40, "area_max_sqm": 20}]},
    {"updated_at": STAMP, "types": [{"public_name": {"th": "แบบขาย"}, "source_notes": None}]},
])
def test_invalid_bulk_is_rejected_before_sql(client, body):
    response = client.post(PREFIX, json=body, headers={"Authorization": f"Bearer {TOKENS['editor']}"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("body", [
    {"updated_at": STAMP}, {"updated_at": STAMP, "public_name": None},
    {"updated_at": STAMP, "source_model_ids": None}, {"updated_at": STAMP, "description": None},
    {"updated_at": "2026-09-20T10:00:00", "bedrooms": 1},
    {"updated_at": STAMP, "area_min_sqm": 0}, {"updated_at": STAMP, "kitchens": -1},
    {"updated_at": STAMP, "storeys": 1.5}, {"updated_at": STAMP, "project_id": str(UUID(int=2))},
])
def test_patch_rejects_identity_or_invalid_values(client, body):
    response = client.patch(PREFIX + "/ctyp_test", json=body, headers={"Authorization": f"Bearer {TOKENS['editor']}"})
    assert response.status_code == 422


@pytest.mark.parametrize("field,value", [
    ("asset_role", "hero"), ("title", " "), ("alt_text", {"en": "Only English"}),
    ("applicability_model_ids", [MODEL, MODEL]), ("floor_label", None), ("plan_revision", "x" * 101),
])
def test_plan_metadata_is_validated(client, field, value):
    body = {"updated_at": STAMP, "asset_id": str(UUID(int=1)), "asset_role": "floor_plan",
            "alt_text": {"th": "แปลนชั้นหนึ่ง"}, "title": "แปลนชั้นหนึ่ง", field: value}
    response = client.post(PREFIX + "/ctyp_test/assets", json=body,
                           headers={"Authorization": f"Bearer {TOKENS['editor']}"})
    assert response.status_code == 422


def test_acquired_type_can_save_without_inventing_source_ids_or_specs():
    body = CreateCommercialSet(updated_at=STAMP, types=[{"public_name": {"th": "แบบบ้านสวน", "en": "Garden"}}])
    assert body.types[0].model_dump(exclude_unset=True) == {"public_name": {"th": "แบบบ้านสวน", "en": "Garden"}}
    patch = PatchCommercialType(updated_at=STAMP, bedrooms=0, area_min_sqm=None, description={})
    assert patch.model_dump(exclude_unset=True)["bedrooms"] == 0
    with pytest.raises(ValidationError):
        PatchCommercialType(updated_at=STAMP, area_min_sqm=float("inf"))


@pytest.mark.parametrize("role", ["editor", "publisher", "admin"])
def test_bulk_uses_one_parameterized_transaction_and_returns_current_project(monkeypatch, role):
    calls = []
    transactions = []
    project = {"id": str(UUID(int=1)), "updated_at": STAMP, "commercial_types": []}

    class Connection:
        async def fetchval(self, query, *values):
            calls.append((query, values))
            return project

    @asynccontextmanager
    async def database(request, actor):
        transactions.append(actor.role)
        yield Connection()

    monkeypatch.setattr(main, "database", database)
    client = TestClient(main.create_app(settings()), client=("127.0.0.1", 50000))
    types = [{"public_name": {"th": "Garden ' SQL text"}, "source_model_ids": [MODEL]},
             {"public_name": {"th": "Family"}, "source_model_ids": [MODEL]}]
    response = client.post(PREFIX, json={"updated_at": STAMP, "types": types},
                           headers={"Authorization": f"Bearer {TOKENS[role]}"})
    if role == "publisher":
        assert response.status_code == 403 and not transactions and not calls
        return
    assert response.status_code == 200 and response.json()["data"] == project
    assert transactions == [role]
    assert calls[0] == ("SELECT hub.project_detail($1)", ("prj_test",))
    assert calls[1] == ("SELECT hub.create_commercial_types($1, $2, $3)",
                        (UUID(int=1), types, datetime.fromisoformat(STAMP)))


def test_plan_defaults_remain_unscoped_until_marketing_provides_references():
    plan = BindCommercialAsset(updated_at=STAMP, asset_id=UUID(int=1), asset_role="floor_plan",
                               alt_text={"th": "แปลน"}, title="แปลน")
    assert plan.applicability_model_ids == []
    assert plan.plan_revision == ""
