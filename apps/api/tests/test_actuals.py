"""P3 boundary tests: actor ACLs, closed requests and lossless private read-back."""
from contextlib import asynccontextmanager
import json

import asyncpg
from fastapi.testclient import TestClient
import pytest

from sena_hub_api import main
from sena_hub_api.auth import ALL_DEMO_ACTORS, DEMO_ROLES, Settings

TOKENS = {role: "synthetic-p3-" + role + "-" + "x" * 40 for role in DEMO_ROLES}
PREFIX = "/v1/admin/ads"
KEY = "a" * 64
LINE = "f0185231-9383-4918-bc4f-e66349a8d18d"
SNAPSHOT = "4e7f2eaf-8807-4f39-9aa0-b4750d37211f"
GET_PATHS = ["/actuals", "/actuals/" + LINE, "/findings", "/findings/" + KEY,
             "/document-tracking", "/document-tracking/" + KEY]
WORKFLOW = {"expected_snapshot_id": SNAPSHOT, "expected_version": 0,
            "state": "ACKNOWLEDGED", "owner_action": "SELF", "note": "ตรวจสอบข้อมูลตัวอย่าง"}
FOLLOW_UP = {"expected_snapshot_id": SNAPSHOT, "expected_source_version": "b" * 64,
             "template_version": "1", "month": "2096-10-01"}


class ReadBack:
    def __init__(self):
        self.calls = []
        self.actors = []
        self.error = None
        self.result = {"items": [{"account_id": "000123", "platform_media_spend": "123.45",
                                   "attributed_leads": None, "media_cpl": None}],
                       "total": 1, "meta": {"snapshot_id": SNAPSHOT, "synthetic_only": True}}

    async def fetchval(self, query, *args):
        self.calls.append((query, args))
        if self.error:
            raise self.error
        return json.dumps(self.result)

    @asynccontextmanager
    async def database(self, request, actor):
        self.actors.append(actor)
        yield self


def make_client(monkeypatch, database_url="postgresql://test:test@127.0.0.1:55432/sena_hub_local"):
    db = ReadBack()
    monkeypatch.setattr(main, "database", db.database)
    settings = Settings(database_url=database_url, auth_mode="demo", environment="local", demo_tokens=TOKENS)
    return TestClient(main.create_app(settings), client=("127.0.0.1", 50000)), db


@pytest.fixture
def boundary(monkeypatch):
    return make_client(monkeypatch)


def headers(role):
    return {"Authorization": "Bearer " + TOKENS[role]}


@pytest.mark.parametrize("role", ["editor", "publisher", "viewer", "service_consumer", "agency_kin", "agency_combay"])
def test_other_roles_never_query_financial_records_or_workflow(boundary, role):
    client, db = boundary
    h = {**headers(role), "X-Hub-Role": "admin"}
    for path in GET_PATHS:
        response = client.get(PREFIX + path, headers=h)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "actuals_forbidden"
    for path, body in [(f"/findings/{KEY}/workflow", WORKFLOW),
                       (f"/document-tracking/{KEY}/follow-ups", FOLLOW_UP)]:
        assert client.post(PREFIX + path, headers=h, json=body).status_code == 403
    assert not db.calls and not db.actors


def test_anonymous_cannot_read_or_mutate_with_spoofed_role(boundary):
    client, db = boundary
    for path in GET_PATHS:
        assert client.get(PREFIX + path, headers={"X-Hub-Role": "admin"}).status_code == 401
    assert client.post(PREFIX + f"/findings/{KEY}/workflow", json=WORKFLOW).status_code == 401
    assert not db.calls


@pytest.mark.parametrize("role", ["online_staff", "admin"])
def test_reads_preserve_decimal_strings_nulls_and_identity_under_callers_role(boundary, role):
    client, db = boundary
    for path in GET_PATHS:
        response = client.get(PREFIX + path, headers=headers(role))
        assert response.status_code == 200
        assert response.json() == {"data": db.result}
        assert response.headers["cache-control"] == "no-store"
    assert all(actor.id == ALL_DEMO_ACTORS[role] and actor.role == role for actor in db.actors)
    assert all("ads.actuals_read($1,$2,$3::jsonb)" in query for query, _ in db.calls)


@pytest.mark.parametrize("target", ["postgresql://test:test@127.0.0.1:5432/sena_hub_local",
                                    "postgresql://test:test@127.0.0.1:55432/production",
                                    "postgresql://test:test@localhost:55432/sena_hub_local"])
def test_routes_refuse_any_other_database_target(monkeypatch, target):
    client, db = make_client(monkeypatch, target)
    assert client.get(PREFIX + "/actuals", headers=headers("admin")).status_code == 403
    assert not db.calls


@pytest.mark.parametrize("path", [
    "/actuals?month=2096-10-02", "/actuals?month=2096-10", "/actuals?limit=101",
    "/actuals?offset=-1", "/actuals?include_budget=true", "/actuals?limit=0",
    "/actuals?environment=production", "/actuals?agency=", "/actuals/not-a-uuid",
    f"/actuals/{LINE}?include_private=true", "/findings?control_code=C4",
    "/findings?condition=false", "/findings?state=SENT", "/findings?owner=unknown",
    "/findings/not-a-hash", f"/findings/{KEY}?agency=KIN",
    "/document-tracking?status=VERIFIED", "/document-tracking?status=NOT_REQUIRED",
    "/document-tracking?overdue=on", f"/document-tracking/{KEY}?month=2096-10-15",
    f"/document-tracking/{KEY}?amount=0",
])
def test_invalid_or_unauthorized_filters_fail_before_query(boundary, path):
    client, db = boundary
    assert client.get(PREFIX + path, headers=headers("admin")).status_code == 422
    assert not db.calls


def test_valid_filters_are_parameters_not_sql_and_month_stays_first_day(boundary):
    client, db = boundary
    response = client.get(PREFIX + "/actuals", headers=headers("online_staff"),
                          params={"month": "2096-10-01", "agency": "KIN", "scope": "C-DEMO-00001",
                                  "bud": "001", "limit": "10", "offset": "20"})
    assert response.status_code == 200
    query, args = db.calls[-1]
    assert args == ("actuals", None, {"month": "2096-10-01", "agency": "KIN", "scope": "C-DEMO-00001",
                                    "bud": "001", "limit": 10, "offset": 20})
    assert "C-DEMO" not in query


@pytest.mark.parametrize("path", [f"/actuals/{LINE}", f"/document-tracking/{KEY}"])
def test_detail_month_is_forwarded_without_making_a_timestamp(boundary, path):
    client, db = boundary
    assert client.get(PREFIX + path, params={"month": "2096-10-01"}, headers=headers("admin")).status_code == 200
    assert db.calls[-1][1][-1] == {"month": "2096-10-01"}


def test_unavailable_detail_is_404_not_empty_financial_data(boundary):
    client, db = boundary
    db.result = None
    response = client.get(PREFIX + f"/actuals/{LINE}", headers=headers("admin"))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "actuals_not_found"


@pytest.mark.parametrize("error,status,code", [
    (asyncpg.SerializationError, 409, "actuals_stale"),
    (asyncpg.InsufficientPrivilegeError, 403, "actuals_forbidden"),
    (asyncpg.NoDataFoundError, 404, "actuals_not_found"),
    (asyncpg.InvalidParameterValueError, 422, "invalid_actuals_data"),
    (asyncpg.CheckViolationError, 422, "invalid_actuals_data"),
])
def test_database_errors_are_safe_thai_responses_without_source_details(boundary, error, status, code):
    client, db = boundary
    db.error = error("restricted-evidence-should-not-be-visible")
    response = client.post(PREFIX + f"/findings/{KEY}/workflow", headers=headers("admin"), json=WORKFLOW)
    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    assert "restricted-evidence" not in response.text


@pytest.mark.parametrize("patch", [{"expected_version": True}, {"expected_version": -1},
    {"expected_snapshot_id": "not-uuid"}, {"state": "VERIFIED"}, {"owner_action": "OTHER"},
    {"owner_role": "admin", "owner_id": LINE}, {"created_by": LINE}, {"condition_present": False},
    {"note": "\x00"}, {"note": "x" * 2001}, {"state": "RESOLVED", "note": " "}])
def test_workflow_rejects_spoofed_actors_source_edits_and_invalid_transitions(boundary, patch):
    client, db = boundary
    response = client.post(PREFIX + f"/findings/{KEY}/workflow", headers=headers("online_staff"), json=WORKFLOW | patch)
    assert response.status_code == 422
    assert not db.calls


@pytest.mark.parametrize("role", ["online_staff", "admin"])
def test_mutations_use_guarded_rpc_and_authenticated_actor(boundary, role):
    client, db = boundary
    response = client.post(PREFIX + f"/findings/{KEY}/workflow", headers=headers(role), json=WORKFLOW)
    assert response.status_code == 200
    assert db.actors[-1].id == ALL_DEMO_ACTORS[role]
    query, args = db.calls[-1]
    assert "ads.actuals_command($1,$2,$3::jsonb)" in query
    assert args[:2] == ("workflow", KEY)
    assert args[2]["expected_snapshot_id"] == SNAPSHOT
    assert args[2]["expected_version"] == 0
    assert args[2]["owner_action"] == "SELF"
    assert "owner_id" not in args[2] and "owner_role" not in args[2]
    response = client.post(PREFIX + f"/document-tracking/{KEY}/follow-ups", headers=headers(role), json=FOLLOW_UP)
    assert response.status_code == 200
    assert db.calls[-1][1] == ("follow-up", KEY, FOLLOW_UP)


@pytest.mark.parametrize("patch", [{"expected_source_version": "changed"}, {"template_version": "2"},
    {"action": "SENT"}, {"message_th": "Client-supplied private message"}, {"actor_id": LINE},
    {"month": "2096-10-02"}, {"evidence_url": "https://private.invalid"}])
def test_copy_log_cannot_become_a_send_or_rekey_endpoint(boundary, patch):
    client, db = boundary
    assert client.post(PREFIX + f"/document-tracking/{KEY}/follow-ups", headers=headers("admin"),
                       json=FOLLOW_UP | patch).status_code == 422
    assert not db.calls


def test_no_import_verification_delete_or_send_http_route(boundary):
    client, db = boundary
    h = headers("admin")
    for path in ("/actuals/import", f"/document-tracking/{KEY}/review", f"/document-tracking/{KEY}/send"):
        assert client.post(PREFIX + path, headers=h, json={}).status_code in {404, 405}
    assert client.delete(PREFIX + f"/findings/{KEY}", headers=h).status_code == 405
    assert client.post(PREFIX + f"/findings/{KEY}/workflow?role=admin", headers=h, json=WORKFLOW).status_code == 422
    assert not db.calls
