"""Opt-in HTTP-to-PostgreSQL regression, entirely rolled back on fixed local TEST."""
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
from fastapi.testclient import TestClient
import pytest

from content_workflow_fixture import load_sql_fixture, unit_publication_persona
from sena_hub_api import main
from sena_hub_api.auth import DEMO_ROLES, Settings


@pytest.mark.integration
@pytest.mark.skipif(os.getenv("HUB_PROMOTIONS_TEST") != "1", reason="Set HUB_PROMOTIONS_TEST=1 for rollback-only local TEST")
def test_real_promotion_snapshots_approvals_atomic_release_and_stale_rollback(monkeypatch):
    root = Path(__file__).resolve().parents[3]
    config = json.loads((root / ".local/development.json").read_text(encoding="utf-8"))
    target = {"host": "127.0.0.1", "port": 55432, "database": "sena_hub_local"}
    assert all(config.get(key, value) == value for key, value in target.items())
    tokens = {role: "local-promotion-test-" + role + "x" * 40 for role in DEMO_ROLES}
    settings = Settings("postgresql://unused:unused@127.0.0.1:55432/sena_hub_local", "demo", "local", tokens)
    connection = None
    outer = None
    fixture = None
    actors = {}
    unit_publication_persona(monkeypatch, identity=lambda: actors['publisher'])

    async def seed_fixture():
        """All identities and metadata are new synthetic rows in the outer rollback."""
        actors.update(await load_sql_fixture(connection))
        key = "PROMO-API-" + uuid4().hex.upper()
        await connection.execute("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true)")
        await connection.execute("INSERT INTO staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint) VALUES($1,'Synthetic API brand',now(),$1)", key)
        await connection.execute("INSERT INTO staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint,rem_brand_id) VALUES($1,'Synthetic API project',now(),$1,$1)", key)
        await connection.execute("INSERT INTO staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint) VALUES($1,$1,'Synthetic API model',now(),$1)", key)
        await connection.execute("SET LOCAL ROLE admin")
        brand = await connection.fetchval("SELECT hub.create_brand_from_rem($1)", key)
        await connection.fetchval("SELECT hub.update_brand_draft(id,$2::jsonb,updated_at) FROM hub.brands WHERE id=$1", brand,
                                  {"public_name": {"th": "Synthetic API brand"}, "slug": key.lower(), "description": {"th": "แบรนด์สังเคราะห์สำหรับ API"}})
        assets = []
        for name in ("hero", "thumbnail"):
            checksum = uuid4().hex + uuid4().hex
            asset = await connection.fetchval("SELECT hub.register_uploaded_asset($1::jsonb)", {
                "original_filename": "synthetic-api-" + name + ".png", "mime_type": "image/png", "asset_type": "image",
                "storage_path": checksum + ".png", "checksum": checksum, "file_size": 100, "width": 10, "height": 10})
            assets.append(UUID(asset["asset"]["id"]))
        await connection.fetchval("SELECT hub.bind_brand_asset(id,$2::uuid,'logo_primary',$3::jsonb,updated_at) FROM hub.brands WHERE id=$1",
                                  brand, assets[1], {"th": "โลโก้สังเคราะห์"})
        await connection.execute("SET LOCAL ROLE publisher")
        for asset_id in assets:
            await connection.fetchval("SELECT hub.review_asset(id,updated_at,'approved','Synthetic API rights',null,null,'Synthetic API fixture') FROM hub.assets WHERE id=$1::uuid", asset_id)
        await connection.fetchval("SELECT pg_temp.w4_publish('brand',$1,'Synthetic API fixture')", brand)
        await connection.execute("SET LOCAL ROLE editor")
        project_id = await connection.fetchval("SELECT hub.create_project_from_rem($1)", key)
        await connection.fetchval("SELECT hub.assign_project_brand(id,$2,updated_at) FROM hub.projects WHERE id=$1", project_id, brand)
        await connection.fetchval("SELECT hub.patch_project(id,$2::jsonb,updated_at) FROM hub.projects WHERE id=$1", project_id,
            {"public_name": {"th": "โครงการสังเคราะห์ API"}, "slug": key.lower() + "-project", "address": {"th": "ที่อยู่สังเคราะห์"},
             "latitude": 13.7563, "longitude": 100.5018, "ad_disclaimer": {"th": "ข้อมูลสังเคราะห์สำหรับทดสอบเท่านั้น"}})
        await connection.fetchval("SELECT hub.update_model($1,public_model_id,$2::jsonb,(SELECT updated_at FROM hub.projects WHERE id=$1)) FROM hub.model_types WHERE project_id=$1",
                                  project_id, {"bedrooms": 2, "bathrooms": 1, "usable_area_sqm": 50, "parking_spaces": 1})
        await connection.fetchval("SELECT hub.review_model($1,public_model_id,(SELECT updated_at FROM hub.projects WHERE id=$1),'CONFIRMED','Synthetic API fixture') FROM hub.model_types WHERE project_id=$1", project_id)
        for name, asset_id in zip(("hero", "thumbnail"), assets):
            await connection.fetchval("SELECT hub.bind_project_asset(id,$2::uuid,$3,$4::jsonb,updated_at) FROM hub.projects WHERE id=$1",
                                      project_id, asset_id, name, {"th": "ภาพสังเคราะห์สำหรับทดสอบ"})
        await connection.execute("SET LOCAL ROLE publisher")
        await connection.fetchval("SELECT pg_temp.w4_publish('project',$1,'Synthetic API fixture')", project_id)
        project = await connection.fetchval("SELECT hub.project_detail(public_project_id) FROM hub.projects WHERE id=$1", project_id)
        await connection.execute("RESET ROLE")
        return project

    @asynccontextmanager
    async def database(request, actor):
        async with connection.transaction():
            await connection.execute(f"SET LOCAL ROLE {actor.role}")
            await connection.execute("SELECT set_config('app.actor_id',$1,true)", str(actor.id))
            yield connection

    @asynccontextmanager
    async def lifespan(app):
        nonlocal connection, outer, fixture
        connection = await asyncpg.connect(**target, user="postgres", password=config["adminPassword"], timeout=10)
        try:
            observed = await connection.fetchrow("SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port")
            assert all(observed[key] == value for key, value in target.items())
            await main.initialize_connection(connection)
            outer = connection.transaction()
            await outer.start()
            fixture = await seed_fixture()
            yield
        finally:
            if outer:
                await outer.rollback()
            await connection.close()

    monkeypatch.setattr(main, "database", database)
    app = main.create_app(settings)
    app.router.lifespan_context = lifespan
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        def request(method, path, body=None, role="publisher", status=200):
            response = client.request(method, path, headers={"Authorization": "Bearer " + tokens[role]}, json=body)
            assert response.status_code == status, response.text
            assert response.headers["cache-control"] == "no-store"
            return response.json().get("data")

        project = fixture
        assert project["publication_available"]
        public_id = project["public_project_id"]
        base = "/v1/admin/promotions"
        now = datetime.now(timezone.utc)

        def create():
            return request("POST", base, {"project_id": project["id"], "code": "API-TEST-" + uuid4().hex.upper(),
                "title": {"th": "โปรโมชั่นตัวอย่าง API"}, "summary": {"th": "ตัวอย่างสำหรับทดสอบเท่านั้น"},
                "conditions_public": {"th": "เงื่อนไขข้อมูลสังเคราะห์สำหรับทดสอบ"},
                "legal_terms": {"th": "เงื่อนไขจำลอง ไม่ใช่การอนุมัติโดยฝ่ายกฎหมาย"},
                "disclaimer": {"th": "ข้อมูลตัวอย่าง ไม่ใช่ข้อเสนอขาย"}, "benefit_type": "discount_amount",
                "benefit_value": "1199.99", "benefit_unit": "THB", "stackable": True,
                "starts_at": (now - timedelta(days=1)).isoformat(), "ends_at": (now + timedelta(days=30)).isoformat()},
                role="editor", status=201)

        def detail(promotion):
            return request("GET", base + "/" + promotion["id"], role="viewer")

        def review(promotion, review_type, **extra):
            current = detail(promotion)
            return request("POST", base + "/" + promotion["id"] + "/review", {
                "expected_scope_hash": current["scope"]["scope_hash"],
                "expected_revision": current["draft_revision"], "review_type": review_type,
                "decision": "APPROVED", "evidence": "หลักฐานตัวอย่าง API", "change_reason": "ทดสอบการตรวจสอบ", **extra})

        def publish(promotion, status=200):
            current = detail(promotion)
            return request("POST", base + "/" + promotion["id"] + "/publish", {
                "expected_revision": current["draft_revision"], "expected_published_version_id": current["published_version_id"],
                "change_reason": "เผยแพร่ตัวอย่าง API"}, role="viewer", status=status)

        def public():
            return request("GET", "/v1/promotions?project_id=" + public_id, role="service_consumer")

        def selected(*promotions):
            candidates = request("GET", "/v1/admin/releases/candidates", role="viewer")["items"]
            identifiers = {item["id"] for item in promotions}
            return [{key: row[key] for key in ("entity_type", "entity_id", "expected_updated_at", "expected_revision", "expected_published_version_id")}
                    for row in candidates if row["entity_type"] == "promotion" and row["entity_id"] in identifiers]

        def release(*promotions, status=200):
            members = selected(*promotions)
            assert len(members) == len(promotions)
            return request("POST", "/v1/admin/releases/publish", {"members": members, "change_reason": "ทดสอบชุดเผยแพร่"}, role="viewer", status=status)

        first = create()
        review(first, "DATA")
        publish(first, status=422)
        review(first, "LEGAL")
        publish(first)
        frozen = next(item for item in public() if item["code"] == first["code"])
        assert frozen["benefit_value"] == "1199.99" and frozen["legal_terms"] and frozen["disclaimer"]
        original = detail(first)
        edited = request("PATCH", base + "/" + first["id"], {"expected_revision": original["draft_revision"],
                         "title": {"th": "ชื่อฉบับร่างใหม่"}}, role="editor")
        request("PATCH", base + "/" + first["id"], {"expected_revision": original["draft_revision"],
                "title": {"th": "ฉบับที่ล้าสมัย"}}, role="editor", status=409)
        assert next(item for item in public() if item["code"] == first["code"]) == frozen
        publish(first, status=422)
        review(first, "DATA")
        review(first, "LEGAL")

        second = create()
        before = detail(first)["published_version_id"]
        partial = release(first, second)
        assert len(partial['rejected']) == 1 and partial['rejected'][0]['entity_id'] == second['id']
        assert detail(first)["published_version_id"] != before
        assert detail(second)["published_version_id"] is None
        request("POST", "/v1/admin/releases/" + partial["id"] + "/rollback", {"change_reason": "Restore approved neighbor before complete set"}, role="viewer")
        assert detail(first)["published_version_id"] == before
        review(second, "DATA")
        review(second, "LEGAL")
        published = release(first, second)
        assert detail(first)["published_version_id"] != before
        assert detail(second)["published_version_id"] is not None
        request("POST", "/v1/admin/releases/" + published["id"] + "/rollback", {"change_reason": "ย้อนชุดตัวอย่างทั้งหมด"}, role="viewer")
        assert detail(first)["published_version_id"] == before
        assert detail(second)["published_version_id"] is None

        newer = release(first, second)
        publish(first)
        latest = detail(first)["published_version_id"]
        request("POST", "/v1/admin/releases/" + newer["id"] + "/rollback", {"change_reason": "ต้องไม่เขียนทับรุ่นใหม่"}, status=409, role="viewer")
        assert detail(first)["published_version_id"] == latest
        assert detail(second)["published_version_id"] is not None

        request("PATCH", base + "/" + first["id"], {"expected_revision": edited["draft_revision"],
                "summary": {"th": "ร่างอีกรุ่นที่ยังไม่เผยแพร่"}}, role="editor")
        review(first, "LEGAL", decision="REVOKED", review_revision=edited["draft_revision"])
        assert first["code"] not in {item["code"] for item in public()}
        request("GET", base, role="online_staff", status=403)
        request("GET", "/v1/promotions?project_id=" + public_id, role="agency_kin", status=403)
