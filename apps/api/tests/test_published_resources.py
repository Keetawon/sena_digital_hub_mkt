from contextlib import asynccontextmanager
from copy import deepcopy

from fastapi.testclient import TestClient
import pytest

from sena_hub_api import main
from sena_hub_api.auth import DEMO_ROLES
from test_api import settings


PATHS = ("/v1/projects/prj_synthetic/models", "/v1/projects/prj_synthetic/assets",
         "/v1/models/mdl_synthetic", "/v1/models/mdl_synthetic/assets")
TOKENS = {role: f"test-only-{role}-" + "x" * 40 for role in DEMO_ROLES}
HEADERS = {"Authorization": f"Bearer {TOKENS['service_consumer']}"}


@pytest.fixture
def fixture(monkeypatch):
    model = {"public_model_id": "mdl_synthetic", "rem_model_id": "00001-A-L",
             "public_name": {"th": "แบบในรุ่นเผยแพร่", "en": "Frozen model"}, "bedrooms": 2.5}
    assets = [{"id": "project-hero", "asset_role": "hero", "public_model_id": None},
              {"id": "project-plan", "asset_role": "floor_plan", "public_model_id": None},
              {"id": "model-plan", "asset_role": "floor_plan", "public_model_id": "mdl_synthetic"},
              {"id": "other-model-plan", "asset_role": "floor_plan", "public_model_id": "mdl_other"},
              {"id": "model-image", "asset_role": "model_image", "public_model_id": "mdl_synthetic"}]
    state = {"available": True, "calls": [], "row": {"public_project_id": "prj_synthetic", "version_no": 7,
             "published_at": "2026-10-02T01:00:00Z", "publisher": "synthetic-publisher", "source_updated_at": None,
             "payload": {"models": [model], "assets": assets}, "published_model": model}}

    class DB:
        async def fetchrow(self, sql, *args):
            state["calls"].append((sql, args))
            assert "FROM public_api.projects" in sql and "hub." not in sql and "staging." not in sql
            expected = "mdl_synthetic" if "published_model" in sql else "prj_synthetic"
            return deepcopy(state["row"]) if state["available"] and args == (expected,) else None

    @asynccontextmanager
    async def database(request, actor):
        assert actor.role == "service_consumer"
        yield DB()

    monkeypatch.setattr(main, "database", database)
    return TestClient(main.create_app(settings(demo_tokens=TOKENS)), client=("127.0.0.1", 50000)), state


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize("role,status", [(None, 401), *[(role, 403) for role in DEMO_ROLES if role != "service_consumer"]])
def test_child_reads_retain_consumer_boundary(fixture, path, role, status):
    client, state = fixture
    headers = {"Authorization": f"Bearer {TOKENS[role]}"} if role else {}
    assert client.get(path, headers=headers).status_code == status
    assert not state["calls"]


def test_scope_exact_ids_order_and_containing_project_metadata(fixture):
    client, state = fixture
    def read(path):
        response = client.get(path, headers=HEADERS)
        assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
        result = response.json()
        assert result["meta"]["entity_version"] == 7 and result["meta"]["published_at"] == "2026-10-02T01:00:00Z"
        return result["data"]
    assert read(PATHS[0]) == state["row"]["payload"]["models"]
    model = read(PATHS[2])
    assert model["rem_model_id"] == "00001-A-L" and model["bedrooms"] == 2.5
    assert model["public_project_id"] == "prj_synthetic"
    assert [a["id"] for a in read(PATHS[1])] == ["project-hero", "project-plan"]
    assert [a["id"] for a in read(PATHS[3])] == ["model-plan", "model-image"]
    assert [a["id"] for a in read(PATHS[1] + "?role=floor_plan")] == ["project-plan"]
    assert [a["id"] for a in read(PATHS[3] + "?role=floor_plan")] == ["model-plan"]
    assert read(PATHS[3] + "?role=structural_plan") == []


@pytest.mark.parametrize("path", PATHS)
def test_parent_ineligibility_and_unknown_ids_never_fall_back_to_drafts(fixture, path):
    client, state = fixture
    assert client.get(path.replace("_synthetic", "_unknown"), headers=HEADERS).status_code == 404
    state["available"] = False
    assert client.get(path, headers=HEADERS).status_code == 404
    assert all("public_api.projects" in sql for sql, _ in state["calls"])


@pytest.mark.parametrize("path,query", [(PATHS[0], "?draft=true"), (PATHS[2], "?version_id=other"),
    (PATHS[1], "?role=hero&role=thumbnail"), (PATHS[3], "?role=floor_plan&role=floor_plan"),
    (PATHS[1], "?role=model_image"), (PATHS[3], "?role=hero"), (PATHS[1], "?role=other"),
    (PATHS[3], "?role=floor_plan&private=true")])
def test_closed_role_and_query_contract(fixture, path, query):
    client, state = fixture
    assert client.get(path + query, headers=HEADERS).status_code == 422
    assert not state["calls"]
