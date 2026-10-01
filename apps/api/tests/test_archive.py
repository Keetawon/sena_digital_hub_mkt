"""Archive HTTP boundaries; synthetic values only and no document worker execution."""
import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
import json
from uuid import UUID

import asyncpg
from fastapi.testclient import TestClient
import pytest

from sena_hub_api import main, document_storage
from sena_hub_api.archive import AuditedPDF, validation_locations
from sena_hub_api.auth import ALL_DEMO_ACTORS, DEMO_ROLES, Settings

TOKENS = {role: "synthetic-archive-" + role + "-" + "x" * 40 for role in DEMO_ROLES}
PREFIX = "/v1/admin/ads/archive"
ID = "41000000-0000-4000-8000-000000000001"
VERSION = "41000000-0000-4000-8000-000000000002"
JOB = "41000000-0000-4000-8000-000000000003"
PDF = b"%PDF-1.4\nsynthetic fixture bytes\n%%EOF"
BASE = {"expected_revision": 1, "expected_version_id": VERSION}
MEMO = {"pages": [{"page": 1, "method": "TEXT", "text": "SYNTHETIC memo", "confidence": None,
                   "engine_version": "synthetic-v1", "line_boxes": []}],
        "fields": {"memo_no": "MO2610901", "gross_amount": "12000.01"},
        "field_sources": {key: {"page": 1, "confidence": None} for key in ("memo_no", "gross_amount")},
        "rows": [], "controls": {}}
CONFIRM = {**BASE, "expected_job_id": JOB, "corrected_result": MEMO, "evidence": "ตรวจเทียบเอกสารตัวอย่างแล้ว"}
APPLY = {**BASE, "expected_job_id": JOB, "mode": "MEMO_CREATE", "reason": "สร้างร่างจากหลักฐานตัวอย่าง", "request_id": ID}
FILE = f"{PREFIX}/{ID}/file?version_id={VERSION}&page=1"
PAGE = f"{PREFIX}/{ID}/page?version_id={VERSION}&page=1"


class Store:
    def __init__(self):
        self.calls, self.audits, self.actors = [], [], []
        self.error = None
        version = {"id": VERSION, "version_no": 1, "page_count": 1, "storage_key": "private-test-key",
                   "sha256": "1" * 64, "byte_size": len(PDF)}
        self.result = {"id": ID, "revision": 1, "current_version": version, "versions": [version]}

    async def fetchval(self, statement, *args):
        if "archive_access(" in statement:
            self.audits.append(deepcopy(args[0]))
            return UUID(ID)
        self.calls.append((statement, deepcopy(args)))
        if self.error:
            raise self.error
        return json.dumps(self.result)

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


def headers(role="online_staff", **extra):
    return {"Authorization": "Bearer " + TOKENS[role], "X-Hub-Role": "admin", **extra}


@pytest.mark.parametrize("role", ["editor", "publisher", "viewer", "service_consumer", "agency_kin", "agency_combay"])
def test_private_archive_denials_are_audited_without_any_data_access(boundary, role):
    client, store = boundary
    for path in (PREFIX, PREFIX + "/fixtures", PREFIX + "/search?q=test", PREFIX + "/" + ID, FILE, PAGE):
        assert client.get(path, headers=headers(role)).status_code == 403
    assert client.post(PREFIX, headers=headers(role), json={"fixture_id": "memo-hyabc-v1"}).status_code == 403
    assert not store.calls
    assert len(store.audits) == 7
    assert all(event["outcome"] == "DENIED" and event["original_actor_id"] == str(ALL_DEMO_ACTORS[role]) for event in store.audits)
    assert all(actor.role == "admin" for actor in store.actors)  # Fixed insert-only audit RPC only.
    assert all(event["original_role"] == ("agency" if role.startswith("agency_") else role) for event in store.audits)


def test_anonymous_and_unsupported_method_are_durably_logged(boundary):
    client, store = boundary
    assert client.get(FILE).status_code == 401
    assert store.audits[-1]["original_role"] == "anonymous"
    assert store.audits[-1]["original_actor_id"] is None
    assert client.delete(PREFIX + "/" + ID, headers=headers()).status_code == 405
    assert len(store.audits) == 2 and not store.calls


def test_wrong_local_database_refuses_every_operation_without_connecting(monkeypatch):
    store = Store()
    monkeypatch.setattr(main, "database", store.database)
    settings = Settings("postgresql://test:test@127.0.0.1:55433/other", "demo", "local", TOKENS)
    client = TestClient(main.create_app(settings), client=("127.0.0.1", 50000))
    assert client.get(PREFIX, headers=headers("admin")).status_code == 403
    assert not store.calls and not store.actors


@pytest.mark.parametrize("role", ["online_staff", "admin"])
def test_private_reads_strip_storage_keys_and_use_trusted_actor(boundary, role):
    client, store = boundary
    response = client.get(PREFIX + "/" + ID, headers=headers(role))
    assert response.status_code == 200
    assert "storage_key" not in response.text and "private-test-key" not in response.text
    assert response.json()["data"]["current_version"]["id"] == VERSION
    assert store.actors[0].role == role and store.actors[0].id == ALL_DEMO_ACTORS[role]
    assert store.audits[-1]["document_id"] == ID
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("bad", [
    {"fixture_id": "memo-hyabc-v1", "storage_key": "outside"},
    {"fixture_id": "memo-hyabc-v1", "source_url": "https://example.invalid/document.pdf"},
    {"fixture_id": "memo-hyabc-v1", "truth": {}},
    {"fixture_id": "memo-hyabc-v1", "document_id": ID},
    {"fixture_id": "memo-hyabc-v1", "expected_revision": True, "document_id": ID},
    {"fixture_id": "../memo"},
])
def test_receipts_never_accept_upload_metadata_or_unguarded_versions(boundary, bad):
    client, store = boundary
    assert client.post(PREFIX, headers=headers(), json=bad).status_code == 422
    assert not store.calls and store.audits[-1]["outcome"] == "DENIED"


def test_receipt_only_enqueues_registered_id_and_keeps_worker_out_of_request(boundary, monkeypatch):
    client, store = boundary
    monkeypatch.setattr(document_storage, "read_document", lambda *args: pytest.fail("Receipt must not read/OCR PDF"))
    response = client.post(PREFIX, headers=headers(), json={"fixture_id": "memo-hyabc-v1"})
    assert response.status_code == 201
    assert store.calls == [("SELECT ads.archive_receive($1::jsonb)::text", ({"fixture_id": "memo-hyabc-v1"},))]
    assert store.audits[-1]["action"] == "RECEIVE"


@pytest.mark.parametrize("change", ["money_number", "missing_source", "missing_page", "duplicate_page", "unknown_pii", "nan_confidence"])
def test_transcription_corrections_require_exact_money_and_complete_provenance(boundary, change):
    client, store = boundary
    body = deepcopy(CONFIRM)
    result = body["corrected_result"]
    if change == "money_number": result["fields"]["gross_amount"] = 12000.01
    if change == "missing_source": del result["field_sources"]["memo_no"]
    if change == "missing_page": result["field_sources"]["memo_no"]["page"] = 2
    if change == "duplicate_page": result["pages"].append(deepcopy(result["pages"][0]))
    if change == "unknown_pii": result["fields"]["cardholder_name"] = "Synthetic forbidden extra"
    if change == "nan_confidence": result["pages"][0]["confidence"] = "NaN"
    response = client.post(f"{PREFIX}/{ID}/confirm", headers=headers(), json=body)
    assert response.status_code == 422
    assert not store.calls and store.audits[-1]["action"] == "CONFIRM"


def test_confirmation_keeps_unknown_confidence_and_explicit_apply_is_separate(boundary):
    client, store = boundary
    assert client.post(f"{PREFIX}/{ID}/confirm", headers=headers(), json=CONFIRM).status_code == 200
    action, identity, payload = store.calls[-1][1]
    assert action == "confirm" and identity == UUID(ID)
    assert payload == CONFIRM and payload["corrected_result"]["pages"][0]["confidence"] is None
    assert len(store.calls) == 1
    assert client.post(f"{PREFIX}/{ID}/apply", headers=headers(), json=APPLY).status_code == 200
    assert store.calls[-1][1] == ("apply", UUID(ID), APPLY)
    assert all("finance_command" not in statement for statement, _ in store.calls)  # Atomic SQL RPC owns application.


@pytest.mark.parametrize("changes", [
    {"mode": "LINK_CARD"}, {"mode": "MEMO_UPDATE", "target_id": ID},
    {"target_id": ID}, {"expected_target_version": 1}, {"request_id": None}, {"mode": "batch_confirm"},
])
def test_apply_requires_closed_mode_idempotency_and_explicit_target_version(boundary, changes):
    client, store = boundary
    assert client.post(f"{PREFIX}/{ID}/apply", headers=headers(), json={**APPLY, **changes}).status_code == 422
    assert not store.calls


def test_legal_hold_is_admin_only_even_with_forged_role_header(boundary):
    client, store = boundary
    body = {"expected_revision": 1, "held": True, "reason": "ระงับการประมวลผลตามคำสั่งตัวอย่าง"}
    assert client.post(f"{PREFIX}/{ID}/hold", headers=headers(), json=body).status_code == 403
    assert not store.calls
    assert client.post(f"{PREFIX}/{ID}/hold", headers=headers("admin"), json=body).status_code == 200


@pytest.mark.parametrize("path", ["?document_type=CARD_STATEMENT&document_type=E_MEMO", "?month=2026-10-02", "/search?q=test&document_type=CARD_STATEMENT", "/search?q=test&namespace=public", "/fixtures?truth=true"])
def test_filters_are_closed_and_search_cannot_select_statements_or_other_namespaces(boundary, path):
    client, store = boundary
    assert client.get(PREFIX + path, headers=headers()).status_code == 422
    assert not store.calls and store.audits[-1]["outcome"] == "DENIED"


@pytest.mark.parametrize("error,status", [(asyncpg.SerializationError("private source text"), 409),
    (asyncpg.CheckViolationError("private source text"), 422), (asyncpg.InsufficientPrivilegeError("private source text"), 403)])
def test_database_errors_are_safe_and_logged_after_domain_transaction(boundary, error, status):
    client, store = boundary
    store.error = error
    response = client.post(f"{PREFIX}/{ID}/retry", headers=headers(), json={**BASE, "reason": "ลองใหม่หลังตรวจข้อมูล"})
    assert response.status_code == status and "private source text" not in response.text
    assert store.audits[-1]["action"] == "RETRY"
    assert store.audits[-1]["outcome"] in {"FAILED", "DENIED"}


@pytest.mark.parametrize("range_header,status,expected", [(None, 200, PDF), ("bytes=0-7", 206, PDF[:8]), ("bytes=-5", 206, PDF[-5:])])
def test_exact_version_file_is_private_and_audits_delivered_bytes(boundary, monkeypatch, range_header, status, expected):
    client, store = boundary
    accesses = []
    def read(key, sha):
        accesses.append((key, sha))
        return PDF
    monkeypatch.setattr(document_storage, "read_document", read)
    response = client.get(FILE + "&download=true", headers=headers(**({"Range": range_header} if range_header else {})))
    assert response.status_code == status and response.content == expected
    assert accesses == [("private-test-key", "1" * 64)]
    assert response.headers["x-frame-options"] == "SAMEORIGIN"
    assert response.headers["accept-ranges"] == "bytes"
    assert "no-store" in response.headers["cache-control"]
    assert "attachment" in response.headers["content-disposition"]
    assert [event["outcome"] for event in store.audits] == ["ALLOWED", "PARTIAL" if status == 206 else "SERVED"]
    assert store.audits[-1]["bytes"] == len(expected)
    assert store.audits[-1]["page"] == 1 and store.audits[-1]["version_id"] == VERSION
    assert store.audits[-1]["action"] == "DOWNLOAD"


def test_file_failures_never_serve_corrupt_or_wrong_version_bytes(boundary, monkeypatch):
    client, store = boundary
    reads = []
    def unavailable(*args):
        reads.append(args)
        raise ValueError("sensitive local path")
    monkeypatch.setattr(document_storage, "read_document", unavailable)
    assert client.get(FILE.replace(VERSION, JOB), headers=headers()).status_code == 404
    assert not reads
    response = client.get(FILE, headers=headers())
    assert response.status_code == 503 and "sensitive local path" not in response.text
    assert store.audits[-1]["outcome"] == "FAILED" and store.audits[-1]["bytes"] == 0
    monkeypatch.setattr(document_storage, "read_document", lambda *args: PDF)
    response = client.get(FILE, headers=headers(Range="bytes=0-1,4-5"))
    assert response.status_code == 416 and not response.content
    assert response.headers["content-range"] == f"bytes */{len(PDF)}"


def test_disconnect_never_records_complete_delivery():
    events = []
    async def delivered(outcome, count): events.append((outcome, count))
    async def send(message):
        if message["type"] == "http.response.body": raise OSError("client disconnected")
    async def run():
        response = AuditedPDF(PDF, 200, {}, delivered)
        with pytest.raises(OSError): await response({"type": "http"}, None, send)
    asyncio.run(run())
    assert events == [("FAILED", 0)]


def test_validation_locations_never_leak_raw_evidence_or_untrusted_fields():
    details = validation_locations(json.dumps({"issues": [
        {"code": "ROW_SOURCE_MISMATCH", "page": 2, "occurrence": 3, "descriptor": "private text"},
        {"code": "FIELD_SOURCE_MISSING", "field": "private value", "page": "sensitive source"},
        {"code": "private SQL error", "page": 1}]}))
    assert details[0] == {"code": "ROW_SOURCE_MISMATCH", "page": 2, "occurrence": 3, "message": "รายการยังไม่ตรงหลักฐาน"}
    assert details[1] == {"code": "FIELD_SOURCE_MISSING", "message": "ยังระบุหน้าหลักฐานไม่ครบ"}
    assert "private" not in json.dumps(details) and "sensitive" not in json.dumps(details)
    assert validation_locations("raw private SQL") == []


def test_statement_page_uses_only_verified_source_bytes_and_audits_image_delivery(boundary, monkeypatch):
    client, store = boundary
    store.result["document_type"] = "CARD_STATEMENT"
    png = b"\x89PNG\r\n\x1a\nsynthetic unit image"
    reads, renders = [], []
    def read(key, digest):
        reads.append((key, digest))
        return PDF
    def render(content, page):
        renders.append((content, page))
        return png
    monkeypatch.setattr(document_storage, "read_document", read)
    monkeypatch.setattr(document_storage, "render_statement_page", render)
    response = client.get(PAGE, headers=headers())
    assert response.status_code == 200 and response.content == png
    assert reads == [("private-test-key", "1" * 64)] and renders == [(PDF, 1)]
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-frame-options"] == "DENY"
    assert "sandbox" in response.headers["content-security-policy"]
    assert "no-store" in response.headers["cache-control"]
    assert [event["outcome"] for event in store.audits] == ["ALLOWED", "SERVED"]
    assert store.audits[-1]["action"] == "PREVIEW" and store.audits[-1]["bytes"] == len(png)
    assert store.audits[-1]["version_id"] == VERSION and store.audits[-1]["page"] == 1


def test_statement_page_denies_other_types_versions_pages_and_arbitrary_paths(boundary, monkeypatch):
    client, store = boundary
    reads = []
    monkeypatch.setattr(document_storage, "read_document", lambda *args: reads.append(args))
    store.result["document_type"] = "E_MEMO"
    assert client.get(PAGE, headers=headers()).status_code == 404
    store.result["document_type"] = "CARD_STATEMENT"
    for path, status in ((PAGE.replace(VERSION, JOB), 404), (PAGE.replace("page=1", "page=2"), 404),
                         (PAGE + "&storage_key=private", 422), (PAGE + "&download=true", 422)):
        assert client.get(path, headers=headers()).status_code == status
    assert not reads and all(event["outcome"] == "DENIED" for event in store.audits)


def test_statement_page_render_failure_is_safe_and_audited(boundary, monkeypatch):
    client, store = boundary
    store.result["document_type"] = "CARD_STATEMENT"
    monkeypatch.setattr(document_storage, "read_document", lambda *args: PDF)
    def failed(*args): raise ValueError("private engine path")
    monkeypatch.setattr(document_storage, "render_statement_page", failed)
    response = client.get(PAGE, headers=headers())
    assert response.status_code == 503 and "private engine path" not in response.text
    assert store.audits[-1]["outcome"] == "FAILED" and store.audits[-1]["bytes"] == 0
