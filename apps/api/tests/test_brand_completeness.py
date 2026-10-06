import csv
import io
from contextlib import asynccontextmanager

from fastapi.testclient import TestClient
import pytest

from sena_hub_api import main
from sena_hub_api.brand_completeness import CSV_COLUMNS, MANIFEST, Filters, csv_content, filter_rows
from test_api import settings, TOKENS


def row(status="missing_data", ready=False):
    return {"name_th": "ชื่อสมมติ", "name_en": None, "rem_brand_id": "000005", "public_brand_id": "brd_synthetic",
            "residential_project_count": 2, "status": status, "checks": {"name_th_confirmed": False, "description": True, "slug": True, "primary_logo": False, "logo_rights": False},
            "optional_logos": ["favicon"], "readiness": {"ready": ready, "percent": 80 if not ready else 100, "missing": [{"field": "assets.logo_primary", "message": "เลือกโลโก้หลัก"}] if not ready else []},
            "publication_available": status.startswith("published"), "has_unpublished_changes": status == "published_changes",
            "reason_codes": [], "updated_at": "2026-10-02T00:00:00Z", "updated_by": "synthetic-editor",
            "rights_notes": "PRIVATE EVIDENCE", "storage_path": "PRIVATE FILE", "public_url": "https://private.invalid/file"}


@pytest.fixture
def fake(monkeypatch):
    calls = []
    data = {"rows": [row(), row("published_changes", True), {**row("not_created"), "public_brand_id": None, "reason_codes": ["duplicate"]}],
            "counts": {"total": 3, "missing_data": 1, "ready": 1, "published": 1, "published_changes": 1, "not_created": 1}}
    class DB:
        async def fetch(self, statement, *args):
            calls.append((statement, args))
            return []
        async def fetchval(self, statement, *args):
            calls.append((statement, args))
            return data if "brand_completeness" in statement else {"create_count": 2, "created_count": 2, "preview_sha256": "a" * 64}
    @asynccontextmanager
    async def database(request, actor):
        calls.append(("actor", actor.role))
        yield DB()
    monkeypatch.setattr(main, "database", database)
    config = settings()
    client = TestClient(main.create_app(config), client=("127.0.0.1", 50000))
    return client, calls, config


@pytest.mark.parametrize("method,path", [("GET", "/brands/completeness"), ("GET", "/brands/completeness.csv"),
                                          ("GET", "/brands/bulk-preview"), ("POST", "/brands/bulk-create"),
                                          ("POST", "/brands/brd_test/confirm-source-names")])
def test_completeness_routes_require_authentication(fake, method, path):
    assert fake[0].request(method, "/v1/admin" + path).status_code == 401


@pytest.mark.parametrize("role,path", [("editor", "/brands/bulk-preview"), ("publisher", "/brands/bulk-preview"),
                                       ("viewer", "/brands/bulk-preview"), ("service_consumer", "/brands/completeness"),
                                       ("service_consumer", "/brands/completeness.csv")])
def test_completeness_role_boundaries(fake, role, path):
    assert fake[0].get("/v1/admin" + path, headers={"Authorization": f"Bearer {TOKENS[role]}"}).status_code == 403
    assert not fake[1]


@pytest.mark.parametrize("confirmed", [False, None, 1, "true"])
def test_bulk_requires_true_boolean_confirmation(fake, confirmed):
    response = fake[0].post("/v1/admin/brands/bulk-create", headers={"Authorization": f"Bearer {TOKENS['admin']}"},
                            json={"preview_sha256": "a" * 64, "confirmed": confirmed, "change_reason": "ยืนยันพรีวิว"})
    assert response.status_code == 422 and not fake[1]


def test_bulk_uses_fixed_dictionary_and_exact_confirmed_preview(fake):
    response = fake[0].post("/v1/admin/brands/bulk-create", headers={"Authorization": f"Bearer {TOKENS['admin']}"},
                            json={"preview_sha256": "a" * 64, "confirmed": True, "change_reason": "ยืนยันพรีวิว"})
    assert response.status_code == 200
    assert fake[1][-1][1] == (MANIFEST, "a" * 64, True, "ยืนยันพรีวิว")


@pytest.mark.parametrize("environment", ["production", "hosted-test"])
def test_bulk_refuses_nonlocal_environment_before_database(fake, environment):
    # Exercise the closed environment branch with the already constructed test app.
    object.__setattr__(fake[2], "environment", environment)
    assert fake[0].get("/v1/admin/brands/bulk-preview", headers={"Authorization": f"Bearer {TOKENS['admin']}"}).status_code == 403
    assert not fake[1]


def test_counts_are_unfiltered_and_csv_uses_same_filtered_rows(fake):
    headers = {"Authorization": f"Bearer {TOKENS['viewer']}"}
    response = fake[0].get("/v1/admin/brands/completeness?status=published&missing=name_th_confirmed", headers=headers)
    assert response.status_code == 200
    assert response.json()["data"]["counts"]["total"] == 3
    assert len(response.json()["data"]["rows"]) == 1
    response = fake[0].get("/v1/admin/brands/completeness.csv?status=published&missing=name_th_confirmed", headers=headers)
    assert response.status_code == 200
    parsed = list(csv.reader(io.StringIO(response.text.lstrip("\ufeff"))))
    assert tuple(parsed[0]) == CSV_COLUMNS and len(parsed) == 2
    assert parsed[1][2] == "000005"
    assert "PRIVATE" not in response.text and "https://" not in response.text
    assert response.headers["content-disposition"].endswith('"brand-completeness.csv"')


@pytest.mark.parametrize("query", ["status=wrong", "missing=rights_notes", "unsafe=true", "status=all&status=published"])
def test_filter_validation(fake, query):
    assert fake[0].get("/v1/admin/brands/completeness?" + query, headers={"Authorization": f"Bearer {TOKENS['viewer']}"}).status_code == 422
    assert not fake[1]


def test_csv_formula_escaping_and_not_created_reasons():
    value = {**row("not_created"), "name_th": '=HYPERLINK("private")', "reason_codes": ["unknown_status", "blank_name"]}
    text = csv_content([value])
    parsed = list(csv.reader(io.StringIO(text.lstrip("\ufeff"))))
    assert parsed[1][0].startswith("'=")
    assert "ยังไม่ทราบสถานะต้นทาง" in parsed[1][14]
    assert "PRIVATE" not in text
    assert filter_rows([row(), row("published_changes", True)], Filters(status="ready"))[0]["status"] == "published_changes"
