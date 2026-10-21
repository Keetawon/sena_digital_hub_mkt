import os
import re

from fastapi.testclient import TestClient
import pytest

from sena_hub_api.auth import ROLES, Settings
from sena_hub_api.main import create_app


@pytest.mark.integration
@pytest.mark.skipif(not os.getenv("HUB_TEST_DATABASE_URL"), reason="Requires seeded local PostgreSQL with a published demo brand")
def test_brand_draft_snapshot_project_filter_withdrawal_and_logo_rights():
    tokens = {role: f"brand-integration-{role}-" + "x" * 40 for role in ROLES}
    config = Settings(os.environ["HUB_TEST_DATABASE_URL"], "demo", "local", tokens)
    headers = {role: {"Authorization": f"Bearer {token}"} for role, token in tokens.items()}
    with TestClient(create_app(config), client=("127.0.0.1", 50000)) as client:
        def get(path, role="admin"):
            response = client.get(path, headers=headers[role])
            assert response.status_code == 200, response.text
            return response.json()["data"]

        projects = get("/v1/admin/projects")
        project = next(item for item in projects if item["source"]["rem_project_id"] == "DEMO-001")
        brands = get("/v1/admin/brands")
        original = next(item for item in brands if item["id"] == project["brand_id"])
        assert original["publication_available"] and original["readiness"]["ready"]
        assert original["published_version_id"], "Seed an eligible synthetic brand before running integration tests"
        brand_path = f"/v1/admin/brands/{original['public_brand_id']}"
        public_brand_path = f"/v1/brands/{original['public_brand_id']}"
        project_path = f"/v1/admin/projects/{project['public_project_id']}"
        public_project_path = f"/v1/projects/{project['public_project_id']}"
        original_public = client.get(public_brand_path, headers=headers["service_consumer"])
        assert original_public.status_code == 200, original_public.text
        logo = next(item for item in original["assets"] if item["asset_role"] == "logo_primary")
        logo_path = f"/v1/admin/assets/{logo['id']}"
        logo_original = get(logo_path)
        public_logo = next(item for item in original_public.json()["data"]["assets"] if item["asset_role"] == "logo_primary")

        def action(path, name, **body):
            response = client.post(f"{path}/{name}", headers=headers["publisher"],
                                   json={"change_reason": "ทดสอบแบรนด์กับฐานข้อมูลภายในเครื่อง", **body})
            assert response.status_code == 200, response.text
            return response.json()["data"]

        def patch(changes):
            return client.patch(brand_path, headers=headers["editor"],
                                json={"updated_at": get(brand_path)["updated_at"], **changes})

        def review_logo(decision):
            response = client.post(f"{logo_path}/review", headers=headers["publisher"], json={
                "updated_at": get(logo_path)["updated_at"], "decision": decision,
                "rights_notes": logo_original["rights_notes"] or "สิทธิ์โลโก้จำลองสำหรับทดสอบ",
                "effective_from": logo_original["effective_from"], "effective_to": logo_original["effective_to"],
                "change_reason": "ทดสอบการควบคุมสิทธิ์โลโก้",
            })
            assert response.status_code == 200, response.text

        try:
            sources = get("/v1/admin/sources/brands", role="viewer")
            assert any(item["rem_brand_id"] == original["rem_brand_id"] and item["public_brand_id"] == original["public_brand_id"] for item in sources)
            assert "rem_company_id" in get(project_path)["source"]
            action(project_path, "publish")
            frozen_project = client.get(public_project_path, headers=headers["service_consumer"])
            assert frozen_project.status_code == 200, frozen_project.text
            assert frozen_project.json()["data"]["brand"]["public_brand_id"] == original["public_brand_id"]
            assert frozen_project.json()["data"]["brand"]["version_no"] == original_public.json()["meta"]["entity_version"]
            assert get(project_path)["publication_preview"] == frozen_project.json()["data"]
            assert get(brand_path)["publication_preview"] == original_public.json()["data"]
            assert get(project_path)["id"] and get(project_path)["source"]["rem_project_id"]

            def check_public(value):
                if isinstance(value, dict):
                    assert not (set(value) & {"id", "binding_id", "version_id", "brand_id", "brand_version_id", "publisher",
                        "website_content", "website_sources", "source", "source_record", "rem_project_id", "rem_brand_id", "rem_model_id",
                        "original_filename", "rights_status", "verified_by", "source_updated_at"})
                    for item in value.values():
                        check_public(item)
                elif isinstance(value, list):
                    for item in value:
                        check_public(item)
                elif isinstance(value, str):
                    assert not re.search(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", value, re.I)

            for path in ("/v1/projects", "/v1/brands", public_project_path, public_brand_path,
                         f"{public_project_path}/models", f"{public_project_path}/assets"):
                check_public(get(path, role="service_consumer"))
            for model in frozen_project.json()["data"]["models"]:
                check_public(get(f"/v1/models/{model['public_model_id']}", role="service_consumer"))
                check_public(get(f"/v1/models/{model['public_model_id']}/assets", role="service_consumer"))

            edited = patch({"public_name": {**original["public_name"], "th": "ชื่อแบรนด์ฉบับร่างทดสอบ"}})
            assert edited.status_code == 200, edited.text
            stale = client.patch(brand_path, headers=headers["editor"], json={"updated_at": original["updated_at"], "slug": original["slug"]})
            assert stale.status_code == 409, stale.text
            assert client.get(public_brand_path, headers=headers["service_consumer"]).json() == original_public.json()
            new_brand = action(brand_path, "publish")
            assert new_brand["published_version_id"] != original["published_version_id"]
            assert get(public_brand_path, role="service_consumer")["public_name"]["th"] == "ชื่อแบรนด์ฉบับร่างทดสอบ"
            assert client.get(public_project_path, headers=headers["service_consumer"]).json() == frozen_project.json()

            filtered = client.get("/v1/projects", params={"brand_id": original["public_brand_id"]}, headers=headers["service_consumer"])
            assert filtered.status_code == 200, filtered.text
            assert project["public_project_id"] in {item["public_project_id"] for item in filtered.json()["data"]}
            assert all(item["brand"]["public_brand_id"] == original["public_brand_id"] for item in filtered.json()["data"])
            for unmatched in (original["id"], original["rem_brand_id"], "brd_not_found"):
                response = client.get("/v1/projects", params={"brand_id": unmatched}, headers=headers["service_consumer"])
                assert response.status_code == 200 and response.json()["data"] == []
            public_brands = get("/v1/brands", role="service_consumer")
            assert any(item["public_brand_id"] == original["public_brand_id"] and "meta" in item for item in public_brands)
            versions = get(f"{brand_path}/versions", role="viewer")
            assert {original["published_version_id"], new_brand["published_version_id"]} <= {item["version_id"] for item in versions}

            action(brand_path, "withdraw")
            assert client.get(public_brand_path, headers=headers["service_consumer"]).status_code == 404
            assert client.get(public_project_path, headers=headers["service_consumer"]).status_code == 404
            action(brand_path, "rollback", version_id=original["published_version_id"])
            assert client.get(public_project_path, headers=headers["service_consumer"]).json() == frozen_project.json()

            review_logo("revoked")
            assert client.get(public_brand_path, headers=headers["service_consumer"]).status_code == 404
            assert client.get(public_project_path, headers=headers["service_consumer"]).status_code == 404
            assert client.get(f"/v1/assets/{public_logo['public_asset_id']}/file", headers=headers["service_consumer"]).status_code == 404
            review_logo("approved")
            assert client.get(public_project_path, headers=headers["service_consumer"]).json() == frozen_project.json()

            blank = patch({"description": {"th": ""}, "slug": ""})
            assert blank.status_code == 200 and not blank.json()["data"]["readiness"]["ready"]
            blocked = client.post(f"{brand_path}/publish", headers=headers["publisher"], json={"change_reason": "ข้อมูลแบรนด์ยังไม่ครบ"})
            assert blocked.status_code == 422, blocked.text
        finally:
            review_logo(logo_original["rights_status"])
            restored = patch({name: original[name] for name in ("public_name", "description", "slug", "status")})
            assert restored.status_code == 200, restored.text
            action(brand_path, "rollback", version_id=original["published_version_id"])
            if project["published_version_id"]:
                action(project_path, "rollback", version_id=project["published_version_id"])
            else:
                action(project_path, "withdraw")
