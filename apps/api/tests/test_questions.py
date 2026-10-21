"""The policy catalog is read-only, staff-only and consistent with its source docs."""
from copy import deepcopy
from contextlib import asynccontextmanager
import importlib.util
import json
from pathlib import Path
import re

from fastapi.testclient import TestClient
import pytest

from sena_hub_api import main
from sena_hub_api.auth import DEMO_ROLES, Settings
from sena_hub_api.questions import load_catalog, OWNER_GROUPS, PRESENTATION_FIELDS, STAFF_ROLES

ROOT = Path(__file__).resolve().parents[3]
PATH = "/v1/admin/questions"
TOKENS = {role: "synthetic-questions-" + role + "-" + "x" * 40 for role in DEMO_ROLES}
HIDDEN_IDS = {"Q9", "Q10", "Q11", "Q12", "Q18", "Q20", "Q72"}
spec = importlib.util.spec_from_file_location("sync_questions", ROOT / "scripts" / "sync-questions.py")
sync_questions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync_questions)


@pytest.fixture
def client(monkeypatch):
    class GuardOnlyDB:
        async def execute(self, sql, *args):
            assert sql.strip().lower() == "select hub.require_permission('questions','view')"
            assert not args, 'Policy questions must not query domain records'

    @asynccontextmanager
    async def guard_database(*args, **kwargs):
        yield GuardOnlyDB()

    monkeypatch.setattr(main, "database", guard_database)
    settings = Settings(database_url="postgresql://test:test@127.0.0.1:55432/test", auth_mode="demo",
                        environment="local", demo_tokens=TOKENS)
    return TestClient(main.create_app(settings), client=("127.0.0.1", 50000))


def headers(role):
    return {"Authorization": "Bearer " + TOKENS[role]}


@pytest.mark.parametrize("role", sorted(STAFF_ROLES))
def test_each_staff_role_receives_only_pending_thai_policy_fields(client, role):
    response = client.get(PATH, headers=headers(role))
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert set(response.json()) == {"data"}
    assert set(response.json()["data"]) == {"questions"}
    entries = response.json()["data"]["questions"]
    assert {entry["id"] for entry in entries} == {f"Q{i}" for i in range(1, 76)} - HIDDEN_IDS
    assert {entry["owner_group"] for entry in entries} == OWNER_GROUPS
    for entry in entries:
        assert set(entry) == set(PRESENTATION_FIELDS)
        assert entry["status"] == "PENDING"
        for field in ("owner_th", "question_th", "default_th"):
            assert re.search(r"[\u0e00-\u0e7f]", entry[field])
        assert entry["links"]
        for link in entry["links"]:
            assert set(link) == {"href", "label"}
            assert link["href"].startswith("/")
            assert re.search(r"[\u0e00-\u0e7f]", link["label"])


@pytest.mark.parametrize("role", ["service_consumer", "agency_kin", "agency_combay"])
def test_external_roles_cannot_read_questions_even_with_spoofed_staff_header(client, role):
    response = client.get(PATH, headers={**headers(role), "X-Hub-Role": "admin"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "questions_forbidden"


def test_questions_require_authentication_and_reject_hidden_or_write_requests(client):
    assert client.get(PATH, headers={"X-Hub-Role": "admin"}).status_code == 401
    response = client.get(PATH + "?include_deferred=true", headers=headers("admin"))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_question_filter"
    assert client.post(PATH, headers=headers("admin"), json={"id": "Q2", "status": "RESOLVED"}).status_code == 405


def test_catalog_retains_decisions_but_defers_line_oa_attribution():
    entries = {entry["id"]: entry for entry in load_catalog()["questions"]}
    assert all(entries[key]["status"] == "RESOLVED" for key in ("Q9", "Q10", "Q11", "Q12"))
    for key in ("Q18", "Q20"):
        assert entries[key]["status"] == "DEFERRED"
        assert "LINE OA (ยังไม่แยกบัญชี)" in entries[key]["default_th"]
    assert "sena_h_approved=false" in entries["Q2"]["doc"]["default"]
    assert "การออกชื่อใช้งานจริงยังถูกปิด" in entries["Q2"]["default_th"]


@pytest.mark.parametrize("mutation", ["missing", "duplicate", "status", "external_link", "new_route"])
def test_invalid_catalog_fails_closed(tmp_path, mutation):
    catalog = deepcopy(load_catalog())
    first = catalog["questions"][0]
    if mutation == "missing":
        catalog["questions"].pop(0)  # A required ID is missing even as the catalogue grows.
    elif mutation == "duplicate":
        catalog["questions"][1] = deepcopy(first)
    elif mutation == "status":
        first["status"] = "PUBLISHED"
    elif mutation == "external_link":
        first["links"][0]["href"] = "//external.example/questions"
    else:
        first["links"][0]["href"] = "/ads/not-implemented"
    path = tmp_path / "questions.json"
    path.write_text(json.dumps(catalog, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ValueError):
        load_catalog(path)


def test_catalog_and_open_questions_rows_are_in_sync():
    source = sync_questions.DOCUMENT.read_bytes().decode("utf-8")
    assert sync_questions.render_document(source, load_catalog()) == source
    assert sync_questions.main(["--check"]) == 0


def test_sync_repairs_only_question_rows_and_preserves_prose_and_crlf():
    source = sync_questions.DOCUMENT.read_text(encoding="utf-8")
    source = "Unowned prose stays exactly here.\n" + source
    expected = source.replace("\n", "\r\n")
    row = next(line for line in expected.splitlines() if line.startswith("| Q1 |"))
    changed = expected.replace(row, "| Q1 | drift | owner | coding | default |", 1)
    assert sync_questions.render_document(changed, load_catalog()) == expected


@pytest.mark.parametrize("mutation", ["missing", "duplicate", "unknown"])
def test_sync_rejects_missing_duplicate_or_unknown_document_ids(mutation):
    source = sync_questions.DOCUMENT.read_text(encoding="utf-8")
    row = next(line for line in source.splitlines(keepends=True) if line.startswith("| Q1 |"))
    if mutation == "missing":
        changed = source.replace(row, "", 1)
    elif mutation == "duplicate":
        changed = source + row
    else:
        changed = source + row.replace("| Q1 |", "| Q99 |", 1)
    with pytest.raises(ValueError):
        sync_questions.render_document(changed, load_catalog())
