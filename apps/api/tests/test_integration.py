import os
import asyncio
from contextlib import nullcontext

from content_workflow_fixture import approve_fixture_entity, publication_persona, confirm_fixture_demo_media
from test_permission_foundations import permission_accounts, h

import pytest
from fastapi.testclient import TestClient

from sena_hub_api.auth import ROLES, Settings
from sena_hub_api.main import create_app


@pytest.mark.integration
@pytest.mark.skipif(not os.getenv("HUB_TEST_DATABASE_URL"), reason="Requires seeded local PostgreSQL and runtime login")
def test_real_postgres_draft_publish_conflict_withdraw_and_rollback(permission_accounts):
    client, ids = permission_accounts
    asyncio.run(publication_persona(ids))
    asyncio.run(confirm_fixture_demo_media(ids))
    headers = {role: h(role) for role in ROLES}
    with nullcontext(client):
        projects = client.get("/v1/admin/projects", headers=headers["editor"])
        assert projects.status_code == 200, projects.text
        original = next(project for project in projects.json()["data"] if project["source"]["rem_project_id"] == "DEMO-001")
        admin_path = f"/v1/admin/projects/{original['public_project_id']}"
        public_path = f"/v1/projects/{original['public_project_id']}"

        def get_draft():
            response = client.get(admin_path, headers=headers["viewer"])
            assert response.status_code == 200, response.text
            return response.json()["data"]

        def action(name, **body):
            if name == 'publish':
                asyncio.run(approve_fixture_entity(ids, 'project', original['id']))
            response = client.post(f"{admin_path}/{name}", headers=headers["viewer"], json={"change_reason": "ตรวจ API กับฐานข้อมูลจริง", **body})
            assert response.status_code == 200, response.text
            return response.json()["data"]

        def patch(changes):
            return client.patch(admin_path, headers=headers["editor"], json={"updated_at": get_draft()["updated_at"], **changes})

        try:
            assert original["readiness"]["ready"]
            action("withdraw")
            assert client.get(public_path, headers=headers["service_consumer"]).status_code == 404
            draft = get_draft()
            response = patch({"public_name": {"th": "ชื่อสำหรับทดสอบ API"}})
            assert response.status_code == 200, response.text
            conflict = client.patch(admin_path, headers=headers["editor"], json={"updated_at": draft["updated_at"], "public_name": {"th": "ทับข้อมูลเก่า"}})
            assert conflict.status_code == 409, conflict.text
            published = action("publish")
            version_id = published["published_version_id"]
            first = client.get(public_path, headers=headers["service_consumer"])
            assert first.status_code == 200, first.text
            assert first.json()["data"]["public_name"]["th"] == "ชื่อสำหรับทดสอบ API"
            assert first.json()["meta"]["data_freshness"] == "unknown"
            assert first.json()["meta"]["fallback_indicator"] == {"missing": []}
            listing = client.get("/v1/projects", headers=headers["service_consumer"])
            item = next(row for row in listing.json()["data"] if row["public_project_id"] == original["public_project_id"])
            assert item["meta"] == first.json()["meta"]
            assert patch({"public_name": {"th": "ร่างยังไม่เผยแพร่"}}).status_code == 200
            assert client.get(public_path, headers=headers["service_consumer"]).json() == first.json()
            versions = client.get(f"{admin_path}/versions", headers=headers["viewer"])
            assert any(row["version_id"] == version_id for row in versions.json()["data"])
            action("withdraw")
            assert client.get(public_path, headers=headers["service_consumer"]).status_code == 404
            action("rollback", version_id=version_id)
            restored = client.get(public_path, headers=headers["service_consumer"])
            assert restored.status_code == 200
            assert restored.json() == first.json()
            blank_slug = patch({"slug": ""})
            assert blank_slug.status_code == 200, blank_slug.text
            assert any(missing["field"] == "slug" for missing in blank_slug.json()["data"]["readiness"]["missing"])
            slug_blocked = client.post(f"{admin_path}/publish", headers=headers["viewer"], json={"change_reason": "ชื่อเส้นทางยังไม่ครบ"})
            assert slug_blocked.status_code == 422, slug_blocked.text
            assert patch({"slug": original["slug"]}).status_code == 200
            assert patch({"ad_disclaimer": {"th": ""}}).status_code == 200
            blocked = client.post(f"{admin_path}/publish", headers=headers["viewer"], json={"change_reason": "ต้องไม่ผ่าน gate"})
            assert blocked.status_code == 422, blocked.text
        finally:
            result = patch({name: original[name] for name in (
                "public_name", "slug", "address", "latitude", "longitude", "ad_disclaimer", "meta_title", "meta_description"
            )})
            assert result.status_code == 200, result.text
            if original["published_version_id"]:
                action("rollback", version_id=original["published_version_id"])
            else:
                action("withdraw")


@pytest.mark.integration
@pytest.mark.skipif(not os.getenv("HUB_TEST_DATABASE_URL"), reason="Requires seeded local PostgreSQL and runtime login")
def test_real_postgres_staged_sources_model_edit_and_review():
    tokens = {role: f"integration-model-{role}-" + "x" * 40 for role in ROLES}
    config = Settings(os.environ["HUB_TEST_DATABASE_URL"], "demo", "local", tokens)
    headers = {role: {"Authorization": f"Bearer {token}"} for role, token in tokens.items()}
    with TestClient(create_app(config), client=("127.0.0.1", 50000)) as client:
        sources = client.get("/v1/admin/sources/projects", headers=headers["viewer"])
        assert sources.status_code == 200, sources.text
        source = next(item for item in sources.json()["data"] if item["rem_project_id"] == "DEMO-001")
        assert {"project_name_rem", "source_updated_at", "source_snapshot_at", "source_fingerprint", "model_count"} <= source.keys()
        assert client.get("/v1/admin/sources/projects", headers=headers["service_consumer"]).status_code == 403
        path = f"/v1/admin/projects/{source['public_project_id']}"
        public_path = f"/v1/projects/{source['public_project_id']}"

        def get_draft():
            response = client.get(path, headers=headers["viewer"])
            assert response.status_code == 200, response.text
            return response.json()["data"]

        original = get_draft()
        model = next(item for item in original["models"] if item["rem_model_id"] == "DEMO-001-M1")
        assert model["match_status"] == "CONFIRMED", "Expected the confirmed synthetic demo fixture"
        model_path = f"{path}/models/{model['public_model_id']}"
        public_before = client.get(public_path, headers=headers["service_consumer"])
        staged = client.get(f"{path}/source-models", headers=headers["viewer"])
        assert staged.status_code == 200, staged.text
        staged_model = next(item for item in staged.json()["data"] if item["rem_model_id"] == model["rem_model_id"])
        assert staged_model["public_model_id"] == model["public_model_id"]
        assert staged_model["model_name_rem"] == model["model_name_rem"]
        assert client.get(f"{path}/source-models", headers=headers["service_consumer"]).status_code == 403

        def patch(changes):
            return client.patch(model_path, headers=headers["editor"],
                                json={"updated_at": get_draft()["updated_at"], **changes})

        def review(decision, role="editor"):
            return client.post(f"{model_path}/review", headers=headers[role], json={
                "updated_at": get_draft()["updated_at"], "decision": decision,
                "change_reason": "ตรวจขั้นตอนทบทวนแบบบ้านกับฐานข้อมูลทดสอบ",
            })

        try:
            blocked = client.patch(model_path, headers=headers["viewer"],
                                   json={"updated_at": original["updated_at"], "bedrooms": 3})
            assert blocked.status_code == 403
            result = patch({"public_name": {**model["public_name"], "th": "ชื่อแบบบ้านฉบับร่างทดสอบ"},
                            "bedrooms": None, "bathrooms": 1.5, "parking_spaces": None})
            assert result.status_code == 200, result.text
            draft = result.json()["data"]
            edited = next(item for item in draft["models"] if item["public_model_id"] == model["public_model_id"])
            assert draft["updated_at"] != original["updated_at"]
            assert edited["bedrooms"] is None and edited["bathrooms"] == 1.5
            for name in ("rem_model_id", "model_name_rem", "source_fingerprint"):
                assert edited[name] == model[name]
            assert draft["readiness"]["ready"] == original["readiness"]["ready"]
            assert draft["readiness"]["model_catalogue_complete"] is False
            assert any(item["field"] == f"models.{model['id']}.specifications" and not item["passed"]
                       for item in draft["readiness"]["recommended"])
            assert any(item["rem_model_id"] == model["rem_model_id"] for item in draft["readiness"]["excluded_models"])
            if public_before.status_code == 200:
                assert client.get(public_path, headers=headers["service_consumer"]).json() == public_before.json()

            for method, target, body in (
                ("PATCH", model_path, {"bedrooms": 3}),
                ("POST", f"{model_path}/review", {"decision": "REJECTED", "change_reason": "ข้อมูลเก่า"}),
                ("POST", f"{path}/models", {"rem_model_id": model["rem_model_id"]}),
            ):
                stale = client.request(method, target, headers=headers["editor"],
                                       json={"updated_at": original["updated_at"], **body})
                assert stale.status_code == 409, stale.text
                assert stale.json()["error"]["code"] == "conflict"

            duplicate = client.post(f"{path}/models", headers=headers["editor"],
                                    json={"updated_at": get_draft()["updated_at"], "rem_model_id": model["rem_model_id"]})
            assert duplicate.status_code == 409, duplicate.text
            assert duplicate.json()["error"]["code"] == "duplicate"
            missing = client.patch(f"{path}/models/mod_missing", headers=headers["editor"],
                                   json={"updated_at": get_draft()["updated_at"], "bedrooms": 1})
            assert missing.status_code == 404, missing.text

            rejected = review("REJECTED")
            assert rejected.status_code == 200, rejected.text
            rejected_model = next(item for item in rejected.json()["data"]["models"] if item["public_model_id"] == model["public_model_id"])
            assert rejected_model["match_status"] == "REJECTED"
            assert rejected_model["verified_by"] is None and rejected_model["verified_at"] is None
            assert client.get(public_path, headers=headers["service_consumer"]).status_code == 404
            confirmed = review("CONFIRMED")
            assert confirmed.status_code == 200, confirmed.text
            confirmed_model = next(item for item in confirmed.json()["data"]["models"] if item["public_model_id"] == model["public_model_id"])
            assert confirmed_model["match_status"] == "CONFIRMED"
            assert confirmed_model["verified_by"] == "00000000-0000-0000-0000-000000000001"
            assert confirmed_model["verified_at"] is not None
        finally:
            restored = patch({name: model[name] for name in (
                "public_name", "bedrooms", "bathrooms", "usable_area_sqm", "parking_spaces"
            )})
            assert restored.status_code == 200, restored.text
            assert review(model["match_status"], role="publisher").status_code == 403
            restored_review = review(model["match_status"], role="editor")
            assert restored_review.status_code == 200, restored_review.text
            assert get_draft()["published_version_id"] == original["published_version_id"]
            assert client.get(public_path, headers=headers["service_consumer"]).json() == public_before.json()
