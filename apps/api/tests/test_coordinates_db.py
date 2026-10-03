"""Coordinate regression through HTTP and PostgreSQL; every write is rolled back."""
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
from uuid import uuid4

import asyncpg
from fastapi.testclient import TestClient
import pytest

from sena_hub_api import main
from test_api import settings, TOKENS


@pytest.mark.integration
@pytest.mark.skipif(os.getenv("HUB_COORDINATE_TEST") != "1", reason="Opt-in rollback-only local coordinate check")
def test_coordinate_readiness_and_publication_rejection(monkeypatch):
    config = json.loads((Path(__file__).resolve().parents[3] / ".local/development.json").read_text(encoding="utf-8"))
    connection = None
    public_id = None

    @asynccontextmanager
    async def database(request, actor):
        async with connection.transaction():
            await connection.execute(f"SET LOCAL ROLE {actor.role}")
            await connection.execute("SELECT set_config('app.actor_id',$1,true)", str(actor.id))
            yield connection

    @asynccontextmanager
    async def lifespan(app):
        nonlocal connection, public_id
        connection = await asyncpg.connect(host="127.0.0.1", port=55432, database="sena_hub_local", user="postgres", password=config["adminPassword"])
        try:
            await main.initialize_connection(connection)
            transaction = connection.transaction()
            await transaction.start()
            try:
                key = "COORD-API-" + uuid4().hex
                await connection.execute("INSERT INTO staging.rem_projects(rem_project_id,project_name_rem,source_fingerprint) VALUES($1,'Synthetic coordinate fixture',$1)", key)
                await connection.execute("SET LOCAL ROLE editor")
                await connection.execute("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true)")
                project_id = await connection.fetchval("SELECT hub.create_project_from_rem($1)", key)
                public_id = await connection.fetchval("SELECT public_project_id FROM hub.projects WHERE id=$1", project_id)
                await connection.execute("RESET ROLE")
                yield
            finally:
                await transaction.rollback()
        finally:
            await connection.close()

    monkeypatch.setattr(main, "database", database)
    app = main.create_app(settings())
    app.router.lifespan_context = lifespan
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        path = "/v1/admin/projects/" + public_id
        headers = {"Authorization": "Bearer " + TOKENS["editor"]}
        for latitude, longitude, missing in [(0, 0, 2), (4.9999, 100, 1), (21.0001, 100, 1),
                                             (13, 96.9999, 1), (13, 106.0001, 1), (5, 97, 0),
                                             (21, 106, 0), (13.7563, 100.5018, 0), (None, None, 2)]:
            current = client.get(path, headers=headers).json()["data"]
            response = client.patch(path, headers=headers, json={"updated_at": current["updated_at"], "latitude": latitude, "longitude": longitude})
            assert response.status_code == 200, response.text
            gaps = [gap for gap in response.json()["data"]["readiness"]["missing"] if gap["field"] in {"latitude", "longitude"}]
            assert len(gaps) == missing
            if missing and latitude is not None:
                assert all(gap["message"] == "พิกัดอยู่นอกประเทศไทย ตรวจละติจูดและลองจิจูด" for gap in gaps)
                rejected = client.post(path + "/publish", headers={"Authorization": "Bearer " + TOKENS["publisher"]}, json={"change_reason": "Synthetic coordinate rejection"})
                assert rejected.status_code == 422
        assert client.get(path + "/versions", headers=headers).json()["data"] == []
