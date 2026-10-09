"""Rollback-only local HTTP proof: RLS citations and explicit versioned draft saves."""
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
from fastapi.testclient import TestClient
import pytest

from sena_hub_api import main
from sena_hub_api.auth import ALL_DEMO_ACTORS, DEMO_ROLES, Settings


@pytest.mark.integration
@pytest.mark.skipif(os.getenv("HUB_ASSISTANT_TEST") != "1", reason="Set HUB_ASSISTANT_TEST=1 for rollback-only local TEST")
def test_assistant_http_citations_generated_proposal_and_explicit_save(monkeypatch):
    root = Path(__file__).resolve().parents[3]
    config = json.loads((root / ".local/development.json").read_text(encoding="utf-8"))
    target = {"host": "127.0.0.1", "port": 55432, "database": "sena_hub_local"}
    assert all(config.get(key, value) == value for key, value in target.items())
    tokens = {role: "assistant-rollback-" + role + "x" * 40 for role in DEMO_ROLES}
    settings = Settings("postgresql://unused:unused@127.0.0.1:55432/sena_hub_local", "demo", "local", tokens)
    connection = outer = None
    before, project, brand = {}, {}, {}
    source = "ASSISTANT-HTTP-" + uuid4().hex[:10]
    tables = ("hub.projects", "hub.brands", "staging.rem_projects", "staging.rem_brands", "internal.assistant_run",
        "internal.assistant_tool", "internal.assistant_citation", "internal.assistant_proposal", "internal.assistant_proposal_application", "hub.user_account")

    async def counts():
        await connection.execute("RESET ROLE")
        return {table: await connection.fetchval("SELECT count(*) FROM " + table) for table in tables}

    async def seed():
        nonlocal project, brand
        assert await connection.fetchval("select count(*) from hub.user_account where id=any($1::uuid[]) and status='ACTIVE'", list(ALL_DEMO_ACTORS.values())) == len(ALL_DEMO_ACTORS)
        await connection.execute("SELECT set_config('app.actor_id',$1,true)", str(ALL_DEMO_ACTORS['admin']))
        await connection.execute("INSERT INTO staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint) VALUES($1,'SYNTHETIC ONLY',now(),'synthetic')", source)
        await connection.execute("INSERT INTO staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint,rem_brand_id) VALUES($1,'SYNTHETIC ONLY',now(),'synthetic',$1)", source)
        await connection.execute("SET LOCAL ROLE hub_app")
        brand_id = await connection.fetchval("SELECT hub.create_brand_from_rem($1)", source)
        await connection.fetchval("SELECT hub.update_brand_draft(id,$2::jsonb,updated_at) FROM hub.brands WHERE id=$1", brand_id,
            {"description": {"th": "คำอธิบายแบรนด์สมมติ", "en": "Preserve brand English"}})
        await connection.execute("SELECT set_config('app.actor_id',$1,true)", str(ALL_DEMO_ACTORS['editor']))
        project_id = await connection.fetchval("SELECT hub.create_project_from_rem($1)", source)
        await connection.fetchval("SELECT hub.patch_project(id,$2::jsonb,updated_at) FROM hub.projects WHERE id=$1", project_id,
            {"public_name": {"th": "โครงการสมมติสำหรับทดสอบ"}, "meta_title": {"th": "หัวข้อสมมติ", "en": "Preserve English"},
             "meta_description": {"th": "คำอธิบายสมมติ", "en": "Preserve description English"}})
        await connection.execute("RESET ROLE")
        await connection.execute("SELECT hub.mark_demo_fields('project',$1,array['meta_title.th','meta_description.th'])", project_id)
        await connection.execute("SELECT hub.mark_demo_fields('brand',$1,array['description.th'])", brand_id)
        project = await connection.fetchval("SELECT to_jsonb(p) FROM hub.projects p WHERE id=$1", project_id)
        brand = await connection.fetchval("SELECT to_jsonb(b) FROM hub.brands b WHERE id=$1", brand_id)

    @asynccontextmanager
    async def runtime_connection():
        try:
            async with connection.transaction():
                await connection.execute("SET LOCAL SESSION AUTHORIZATION hub_runtime")
                await connection.execute("SET LOCAL ROLE hub_app")
                assert await connection.fetchval('select session_user') == 'hub_runtime'
                assert not await connection.fetchval('select rolsuper or rolbypassrls from pg_roles where rolname=current_user')
                yield connection
        finally:
            await connection.execute("RESET ROLE")
            await connection.execute("RESET SESSION AUTHORIZATION")

    class Pool:
        def acquire(self):
            return runtime_connection()

    @asynccontextmanager
    async def database(request, actor, *, audit_only=False):
        async with runtime_connection():
            await connection.execute("SELECT set_config('app.actor_id',$1,true)", str(actor.id))
            yield connection

    @asynccontextmanager
    async def lifespan(app):
        nonlocal connection, outer, before
        connection = await asyncpg.connect(**target, user="postgres", password=config["adminPassword"], timeout=10)
        try:
            actual = await connection.fetchrow("SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port")
            assert all(actual[key] == value for key, value in target.items())
            await main.initialize_connection(connection)
            before = await counts()
            outer = connection.transaction(); await outer.start()
            await seed()
            # A real table lookup is used; the autouse route-unit double applies
            # only to apps without a pool. Every acquisition assumes hub_app.
            app.state.pool = Pool()
            yield
        finally:
            if outer: await outer.rollback()
            assert await counts() == before
            await connection.close()

    monkeypatch.setattr(main, "database", database)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    prefix = "/v1/admin/assistant"
    def headers(role="editor"): return {"Authorization": "Bearer " + tokens[role]}
    def data(response, status=200):
        assert response.status_code == status, response.text
        return response.json()["data"]

    app = main.create_app(settings)
    app.router.lifespan_context = lifespan
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        for role in ("editor", "publisher", "viewer", "admin", "online_staff"):
            assert data(client.get(prefix + "/config", headers=headers(role)))["mode"] == "fake"
        for role in ("agency_kin", "agency_combay", "service_consumer"):
            assert client.post(prefix + "/runs", headers=headers(role), json={"message": "test"}).status_code == 403
        response = client.post(prefix + "/runs", headers=headers(), json={"message": "แนะนำโครงการนี้", "context": {"project_id": project["public_project_id"]}})
        assert response.status_code == 200
        output = [(part.splitlines()[0][7:], json.loads(part.splitlines()[1][6:])) for part in response.text.strip().split("\n\n")]
        assert output[-1][0] == "done", output
        run_id = output[0][1]["run_id"]
        block = next(value for event, value in output if event == "answer_delta")
        assert block["metadata"]["visibility"] == "DRAFT" and source in block["text"]
        receipt = data(client.get(prefix + "/runs/" + run_id, headers=headers()))
        assert receipt["status"] == "DONE" and len(receipt["tools"]) == 1
        citation = next(value for event, value in output if event == "citation")
        citation_path = citation["href"].removeprefix("/api/hub")
        assert "draft_at=" in data(client.get(citation_path, headers=headers()))["source_href"]
        for role in ("viewer", "admin", "online_staff"):
            assert client.get(prefix + "/runs/" + run_id, headers=headers(role)).status_code in {403, 404}
            assert client.get(citation_path, headers=headers(role)).status_code in {403, 404}

        propose = {"entity_type": "project", "entity_id": project["id"], "field_path": "meta_title.th", "expected_updated_at": project["updated_at"]}
        suggestion = data(client.post(prefix + "/proposals/suggest", headers=headers(), json=propose), 201)
        assert suggestion["provider"] == "fake" and suggestion["status"] == "PROPOSED"
        detail = data(client.get("/v1/admin/projects/" + project["public_project_id"], headers=headers()))
        assert detail["meta_title"]["th"] == suggestion["old_text"] and detail["updated_at"] == project["updated_at"]
        route = prefix + "/proposals/" + suggestion["id"] + "/confirm"
        assert client.post(route, headers=headers(), json={"digest": suggestion["digest"]}).status_code == 422
        assert client.post(route, headers=headers(), json={"digest": "0" * 64, "confirmed": True}).status_code == 409
        result = data(client.post(route, headers=headers(), json={"digest": suggestion["digest"], "confirmed": True}))
        assert not result["replayed"]
        changed = data(client.get("/v1/admin/projects/" + project["public_project_id"], headers=headers()))
        assert changed["meta_title"] == {"th": suggestion["new_text"], "en": "Preserve English"}
        assert changed["demo_fields"] == project["demo_fields"] and changed["published_version_id"] is None
        assert data(client.post(route, headers=headers(), json={"digest": suggestion["digest"], "confirmed": True}))["replayed"]
        assert client.get(citation_path, headers=headers()).status_code == 409
        assert client.post(prefix + "/proposals/suggest", headers=headers(), json=propose).status_code == 409
        assert client.post(prefix + "/proposals/suggest", headers=headers("publisher"), json={"entity_type": "brand", "entity_id": brand["id"], "field_path": "description.th", "expected_updated_at": brand["updated_at"]}).status_code == 403
        assert client.post(prefix + "/proposals/suggest", headers=headers("viewer"), json={**propose, "expected_updated_at": changed["updated_at"]}).status_code == 403
        # Two immutable proposals share a version. Applying either cannot overwrite a later change.
        body = {**propose, "expected_updated_at": changed["updated_at"], "new_text": "ข้อความที่ผู้ใช้เลือก"}
        first = data(client.post(prefix + "/proposals", headers=headers(), json=body), 201)
        second = data(client.post(prefix + "/proposals", headers=headers(), json={**body, "new_text": "ข้อความเก่าที่ห้ามทับ"}), 201)
        assert client.post(prefix + "/proposals/" + first["id"] + "/confirm", headers=headers(), json={"digest": first["digest"], "confirmed": True}).status_code == 200
        assert client.post(prefix + "/proposals/" + second["id"] + "/confirm", headers=headers(), json={"digest": second["digest"], "confirmed": True}).status_code == 409
    print("PASS: caller-owned SSE/citations and SDK-generated draft proposal verified; explicit save, replay, stale conflict and rollback preserved data.")
