"""Promotion trust boundaries; PostgreSQL integration owns temporal/publication behavior."""
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timezone
import json
from uuid import UUID

import asyncpg
from fastapi.testclient import TestClient
import pytest

from content_workflow_fixture import unit_publication_persona
from sena_hub_api import main
from sena_hub_api.auth import ALL_DEMO_ACTORS, DEMO_ROLES, Settings

TOKENS = {role: "synthetic-promotions-" + role + "-" + "x" * 40 for role in DEMO_ROLES}
ID = "30000000-0000-4000-8000-000000000030"
PROJECT = "30000000-0000-4000-8000-000000000031"
STAMP = "2026-10-01T10:00:00+07:00"
DRAFT = {"project_id": PROJECT, "code": "DEMO-OFFER", "title": {"th": "โปรโมชั่นตัวอย่าง", "en": "Demo offer"},
         "summary": {"th": "ข้อความตัวอย่าง"}, "legal_terms": {"th": "เงื่อนไขตัวอย่าง"},
         "disclaimer": {"th": "ข้อมูลตัวอย่าง ไม่ใช่ข้อเสนอขายจริง"}, "benefit_type": "discount_amount",
         "benefit_value": "100000000000.01", "benefit_unit": "THB", "starts_at": STAMP,
         "ends_at": "2026-11-01T00:00:00+07:00"}
REVIEW = {"expected_revision": 1, "review_type": "DATA", "decision": "APPROVED", "evidence": "หลักฐานตัวอย่าง",
          "change_reason": "ทดสอบขั้นตอนตรวจสอบ"}
ACTION = {"expected_revision": 1, "expected_published_version_id": None, "change_reason": "เผยแพร่ข้อมูลตัวอย่าง"}
MEMBER = {"entity_type": "promotion", "entity_id": ID, "expected_revision": 1, "expected_published_version_id": None}
RELEASE = {"members": [MEMBER], "change_reason": "ชุดเผยแพร่ตัวอย่าง"}
PREFIX = "/v1/admin"
READS = ["/promotions", "/promotions/" + ID, "/releases", "/releases/candidates", "/releases/" + ID]


class Store:
    def __init__(self):
        self.calls = []
        self.actors = []
        self.error = None
        self.result = {"id": ID, "draft_revision": 1, "benefit_value": "100000000000.01", "published": None}
        self.rows = [{"payload": {**{key: value for key, value in DRAFT.items() if key != "project_id"}, "public_project_id": "prj_000031", "rag_eligible": False},
                      "version_no": 3, "published_at": datetime(2026, 10, 1, tzinfo=timezone.utc)}]

    async def fetchval(self, statement, *args):
        self.calls.append((statement, args))
        if self.error:
            raise self.error
        return json.dumps(self.result)

    async def fetch(self, statement, *args):
        self.calls.append((statement, args))
        return deepcopy(self.rows)

    @asynccontextmanager
    async def database(self, request, actor):
        self.actors.append(actor)
        yield self


@pytest.fixture
def boundary(monkeypatch):
    store = Store()
    monkeypatch.setattr(main, "database", store.database)
    settings = Settings("postgresql://test:test@127.0.0.1:55432/sena_hub_local", "demo", "local", TOKENS)
    return TestClient(main.create_app(settings), client=("127.0.0.1", 50000)), store


def headers(role):
    return {"Authorization": "Bearer " + TOKENS[role], "X-Hub-Role": "publisher"}


@pytest.mark.parametrize("role", ["online_staff", "agency_kin", "agency_combay", "service_consumer"])
def test_non_editorial_roles_never_reach_drafts_reviews_or_release_sql(boundary, role):
    client, store = boundary
    for path in READS:
        assert client.get(PREFIX + path, headers=headers(role)).status_code == 403
    actions = [("/promotions", DRAFT), (f"/promotions/{ID}/review", REVIEW),
               (f"/promotions/{ID}/publish", ACTION), ("/releases/publish", RELEASE)]
    for path, body in actions:
        assert client.post(PREFIX + path, headers=headers(role), json=body).status_code == 403
    assert not store.calls and not store.actors


@pytest.mark.parametrize("role", ["editor", "publisher", "viewer", "admin"])
def test_editorial_readers_preserve_exact_values_and_trusted_actor(boundary, role):
    client, store = boundary
    for path in READS:
        response = client.get(PREFIX + path, headers=headers(role))
        assert response.status_code == 200
        assert response.json()["data"] == store.result
        assert response.headers["cache-control"] == "no-store"
    assert all(actor.role == role and actor.id == ALL_DEMO_ACTORS[role] for actor in store.actors)
    assert client.get("/v1/promotions", headers=headers(role)).status_code == 200
    assert 'FROM public_api.read_promotions()' in store.calls[-1][0]
    assert store.actors[-1].role == role and store.actors[-1].id == ALL_DEMO_ACTORS[role]


def test_anonymous_and_method_override_cannot_reach_data(boundary):
    client, store = boundary
    for path in READS:
        assert client.get(PREFIX + path).status_code == 401
    assert client.get("/v1/promotions").status_code == 401
    assert client.delete(PREFIX + "/promotions/" + ID, headers=headers("admin")).status_code == 405
    assert not store.calls


@pytest.mark.parametrize("role", ["publisher", "viewer"])
def test_only_editor_and_admin_write_promotion_drafts(boundary, role):
    client, store = boundary
    assert client.post(PREFIX + "/promotions", headers=headers(role), json=DRAFT).status_code == 403
    assert client.patch(PREFIX + "/promotions/" + ID, headers=headers(role), json={"expected_revision": 1, "title": {"th": "ใหม่"}}).status_code == 403
    assert not store.calls


@pytest.mark.parametrize("role", ["editor", "admin", "viewer"])
def test_only_publisher_can_review_publish_withdraw_and_release(boundary, role):
    client, store = boundary
    for path, body in [(f"/promotions/{ID}/review", REVIEW), (f"/promotions/{ID}/publish", ACTION),
                       (f"/promotions/{ID}/withdraw", ACTION), ("/releases/publish", RELEASE),
                       (f"/releases/{ID}/rollback", {"change_reason": "ทดสอบ"})]:
        assert client.post(PREFIX + path, headers=headers(role), json=body).status_code == 403
    assert not store.calls


@pytest.mark.parametrize("changes", [
    {"benefit_value": 123.45}, {"benefit_value": True}, {"benefit_value": "0.001"}, {"benefit_value": "1e2"},
    {"benefit_value": "1000000000000.00"}, {"benefit_type": "discount_pct", "benefit_value": "100.01"},
    {"starts_at": "2026-10-01T10:00:00"}, {"starts_at": 1760000000}, {"starts_at": "1760000000"},
    {"ends_at": STAMP}, {"project_id": "000031"}, {"code": "ชื่อ"}, {"stackable": "false"},
    {"priority": True}, {"title": {"th": "bad\x00text"}}, {"source_active_flag": True},
    {"legal_approved_by": ID}, {"rag_eligible": True}, {"demo_fields": ["title"]},
])
def test_create_rejects_lossy_money_unqualified_time_and_forged_control_fields(boundary, changes):
    client, store = boundary
    response = client.post(PREFIX + "/promotions", headers=headers("editor"), json={**DRAFT, **changes})
    assert response.status_code == 422
    assert not store.calls
    assert "input" not in response.json()["error"]


@pytest.mark.parametrize("changes", [{}, {"expected_revision": True}, {"title": None}, {"project_id": PROJECT},
                                     {"code": "REASSIGNED"}, {"published_version_id": ID}, {"starts_at": "2026-10-01"}])
def test_patch_requires_explicit_versioned_allowed_fields(boundary, changes):
    client, store = boundary
    response = client.patch(PREFIX + "/promotions/" + ID, headers=headers("editor"), json={"expected_revision": 1, **changes})
    assert response.status_code == 422 and not store.calls


def test_nullable_amount_and_localized_patch_are_lossless(boundary):
    client, store = boundary
    payload = {"expected_revision": 1, "title": {"th": "ใหม่", "en": "Retained translation"}, "benefit_value": None}
    assert client.patch(PREFIX + "/promotions/" + ID, headers=headers("admin"), json=payload).status_code == 200
    assert store.calls[-1][1] == ("update", UUID(ID), payload)
    created = client.post(PREFIX + "/promotions", headers=headers("editor"), json=DRAFT)
    assert created.status_code == 201
    assert store.calls[-1][1][-1]["benefit_value"] == "100000000000.01"


@pytest.mark.parametrize("changes", [{"evidence": "  "}, {"change_reason": "\x00"}, {"review_type": "MARKETING"},
                                     {"review_revision": 2}, {"reviewed_by": ID}, {"decision": "confirmed"}])
def test_reviews_cannot_approve_other_revisions_or_spoof_evidence(boundary, changes):
    client, store = boundary
    response = client.post(PREFIX + f"/promotions/{ID}/review", headers=headers("publisher"), json={**REVIEW, **changes})
    assert response.status_code == 422 and not store.calls


def test_revoking_published_revision_does_not_require_reverting_draft(boundary):
    client, store = boundary
    body = {**REVIEW, "decision": "REVOKED", "expected_revision": 2, "review_revision": 1}
    assert client.post(PREFIX + f"/promotions/{ID}/review", headers=headers("publisher"), json=body).status_code == 200
    assert store.calls[-1][1][-1] == body


@pytest.mark.parametrize("path", ["/promotions?project_id=000031", "/promotions?limit=101", "/promotions?limit=10&limit=20",
                                  "/promotions?as_of=2026-10-01", f"/promotions/{ID}?include_internal=true",
                                  "/releases?include_drafts=true", "/releases/candidates?demo_mode=1"])
def test_unknown_or_ambiguous_staff_filters_never_query_sql(boundary, path):
    client, store = boundary
    assert client.get(PREFIX + path, headers=headers("viewer")).status_code == 422
    assert not store.calls


@pytest.mark.parametrize("body", [{"members": [], "change_reason": "ทดสอบ"}, {**RELEASE, "members": [MEMBER, MEMBER]},
                                  {**RELEASE, "demo_mode": "true"}, {**RELEASE, "members": [{**MEMBER, "entity_type": "model"}]},
                                  {**RELEASE, "members": [{**MEMBER, "entity_type": "project"}]},
                                  {**RELEASE, "members": [{key: value for key, value in MEMBER.items() if key != "expected_published_version_id"}]}])
def test_release_requires_explicit_complete_unique_entity_set(boundary, body, monkeypatch):
    unit_publication_persona(monkeypatch)
    client, store = boundary
    assert client.post(PREFIX + "/releases/publish", headers=headers("viewer"), json=body).status_code == 422
    assert not store.calls


def test_atomic_release_is_one_guarded_call_and_stale_errors_do_not_leak_data(boundary, monkeypatch):
    unit_publication_persona(monkeypatch)
    client, store = boundary
    store.error = asyncpg.SerializationError("private-version-detail")
    response = client.post(PREFIX + "/releases/publish", headers=headers("viewer"), json={**RELEASE, "demo_mode": True})
    assert response.status_code == 409
    assert "private-version-detail" not in response.text
    assert len(store.calls) == 1 and "hub.release_publish(" in store.calls[0][0]
    assert store.calls[0][1][-1] is True


@pytest.mark.parametrize('role', ['service_consumer', 'viewer', 'editor', 'publisher', 'admin', 'online_staff'])
def test_active_reader_reads_only_snapshot_projection_with_exact_id_and_legal_fallback(boundary, role):
    client, store = boundary
    response = client.get("/v1/promotions", headers=headers(role), params={"project_id": "prj_000031", "locale": "en"})
    assert response.status_code == 200
    item = response.json()["data"][0]
    assert item["benefit_value"] == "100000000000.01" and item["title"] == "Demo offer"
    assert item["legal_terms"] == DRAFT["legal_terms"]["th"] and item["disclaimer"] == DRAFT["disclaimer"]["th"]
    assert item["meta"]["is_fallback_locale"] and item["meta"]["entity_version"] == 3 and "version_id" not in item["meta"]
    assert response.headers["cache-control"] == "no-store"
    assert "FROM public_api.read_promotions()" in store.calls[-1][0]
    assert store.calls[-1][1] == ("prj_000031",)
    assert store.actors[-1].role == role and store.actors[-1].id == ALL_DEMO_ACTORS[role]


@pytest.mark.parametrize("query", ["as_of=2000-01-01", "project_id=x&project_id=y", "include_expired=true", "source_active_flag=true", "locale=../private"])
def test_consumer_cannot_time_travel_or_expand_snapshot_projection(boundary, query):
    client, store = boundary
    assert client.get("/v1/promotions?" + query, headers=headers("service_consumer")).status_code == 422
    assert not store.calls


def test_missing_legal_context_fails_closed_instead_of_emitting_offer(boundary):
    client, store = boundary
    store.rows[0]["payload"]["legal_terms"] = {}
    response = client.get("/v1/promotions", headers=headers("service_consumer"))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "promotion_contract_invalid"
    assert response.json()["error"]["message"] == "ข้อมูลเงื่อนไขโปรโมชั่นยังไม่ครบถ้วน"
