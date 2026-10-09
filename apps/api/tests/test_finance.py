"""Synthetic P2 validation, permission and local PostgreSQL workflow regressions."""
from contextlib import asynccontextmanager
import asyncio
from decimal import Decimal
import hashlib
import json
import os
from uuid import uuid4

import asyncpg
from fastapi.testclient import TestClient
import pytest

from sena_hub_api.auth import DEMO_ROLES, Settings
from sena_hub_api import main
from sena_hub_api.finance import decode_finance

PATH = "/v1/admin/ads"
ID = "90000000-0000-0000-0000-000000000001"
GROUP = "30000000-0000-0000-0000-000000000001"
CORP = "30000000-0000-0000-0000-000000000005"
TOKENS = {role: "synthetic-finance-" + role + "-" + "x" * 40 for role in DEMO_ROLES}
HEADERS = {role: {"Authorization": "Bearer " + token} for role, token in TOKENS.items()}
MEMO = {"memo_no": "MO2609001", "subject": "เอกสารสังเคราะห์สำหรับทดสอบ", "requesting_bud": "C1",
        "gross_amount": "100.00", "mirrored_status": "APPROVED", "approval_date": "2026-09-30",
        "evidence_ref": "SYNTHETIC-MEMO-ONLY"}
COMPONENT = {"component_kind": "PHASE", "rem_project_id": "00001", "formatted_mapping": "C-DEMO-TEST1",
             "bud": "C1", "gross_amount": "100.00", "memo_id": ID}
LINE = {"kind": "GROUP", "scope_id": GROUP, "month": "2026-09-01", "agency": "KIN",
        "components": [COMPONENT], "reason": "รายการสังเคราะห์"}
MAPPING = {"scope_id": GROUP, "agency": "KIN", "bud": "C1", "valid_from": "2026-01-01",
           "valid_to": "2027-01-01", "evidence_ref": "SYNTHETIC-ACCOUNT"}
ACCOUNT = {"platform": "GOOGLE", "account_id": "0000001234", "mapping": MAPPING}
COMMITMENT = {"vendor": "ผู้ให้บริการสังเคราะห์", "version": {
    "scope_id": GROUP, "bud": "C1", "vendor_account_ref": "0000001", "plan": "แผนทดสอบรายปี",
    "cost_type": "TOOL", "payment_method": "CORPORATE_CARD", "amount_per_cycle": "1199.99",
    "frequency": "ANNUAL", "start_date": "2026-01-01", "end_date": "2026-12-31", "evidence_ref": "SYNTHETIC-COVER",
    "occurrences": [{"cycle_no": 1, "charge_date": "2025-12-25", "coverage_start": "2026-01-01",
                     "coverage_end": "2026-12-01", "expected_amount": "1199.99"}],
    "covers": [{"memo_id": ID, "bud": "C1", "coverage_start": "2026-01-01", "coverage_end": "2026-12-01",
                "cap_amount": "1199.99", "evidence_ref": "SYNTHETIC-COVER"}],
}}
STATEMENT = {"operator_ref": "SYNTHETIC-STATEMENT", "issuer": "ธนาคารสังเคราะห์", "cycle_start": "2026-08-26",
             "cycle_end": "2026-09-25", "due_date": "2026-10-15", "declared_total": "1199.99",
             "total_meaning": "NET_CHARGES", "evidence_ref": "SYNTHETIC-CONTROL", "review_status": "CONFIRMED"}


def settings(**overrides):
    return Settings(**{"database_url": "postgresql://test:test@127.0.0.1:55432/test", "auth_mode": "demo",
                       "environment": "local", "demo_tokens": TOKENS, **overrides})


class RecordingDatabase:
    def __init__(self):
        self.calls = []
        self.actors = []
        self.error = None

    @asynccontextmanager
    async def connection(self, request, actor):
        self.actors.append(actor)
        yield self

    async def fetchval(self, sql, *args):
        self.calls.append((sql, args))
        if self.error:
            raise self.error
        if "finance_read" in sql:
            if args[1] is not None:
                return json.dumps({"id": args[1], "resource": args[0], "row_version": 1})
            return '{"items":[{"id":"' + ID + '","gross_amount":999999999999.99}],"total":1}'
        return json.dumps({"id": args[1].get("id", ID), "row_version": 1, "action": args[0]})


@pytest.fixture
def client(monkeypatch):
    db = RecordingDatabase()
    monkeypatch.setattr(main, "database", db.connection)
    test = TestClient(main.create_app(settings()), client=("127.0.0.1", 50000))
    test.recording_db = db
    return test


def finance_paths():
    app = main.create_app(settings())
    return [(next(iter(route.methods)), route.path.replace("{record_id}", ID).replace("{revision_id}", ID))
            for route in app.routes if route.name.startswith("finance_")]


@pytest.mark.parametrize("method,path", finance_paths())
def test_every_finance_endpoint_requires_authentication(client, method, path):
    response = client.request(method, path, headers={"X-Hub-Role": "admin"}, json={})
    assert response.status_code == 401
    assert not client.recording_db.calls


@pytest.mark.parametrize("role", ["editor", "publisher", "viewer", "service_consumer", "agency_kin", "agency_combay"])
@pytest.mark.parametrize("path", ["/memos", "/media-lines", "/corrections", "/ad-accounts", "/channel-accounts",
                                  "/commitments", "/card-statements", "/cost-records", "/card-imports", "/ledger-imports",
                                  "/document-requirements", "/memo-identifiers", "/line-assignments"])
def test_residential_and_agency_roles_cannot_read_finance_even_with_spoofed_role(client, role, path):
    response = client.get(PATH + path, headers={**HEADERS[role], "X-Hub-Role": "admin"})
    assert response.status_code == 403
    assert not client.recording_db.calls


@pytest.mark.parametrize("method,path", finance_paths())
def test_agency_cannot_read_or_mutate_guessed_financial_records(client, method, path):
    response = client.request(method, path, headers=HEADERS["agency_kin"], json={})
    assert response.status_code == 403
    assert not client.recording_db.calls


@pytest.mark.parametrize("suffix", ["monthly-lines", "line-candidates?month=2026-09-01"])
def test_registration_financial_context_is_staff_only(client, suffix):
    response = client.get(PATH + "/registrations/SN2600001M/" + suffix, headers=HEADERS["agency_kin"])
    assert response.status_code == 403
    assert not client.recording_db.calls


@pytest.mark.parametrize("path", [f"/corrections/{ID}/review", f"/corrections/{ID}/retire",
                                  f"/memo-identifiers/{ID}/review", f"/memo-identifiers/{ID}/retire"])
def test_online_staff_cannot_approve_corrections_or_aliases(client, path):
    response = client.post(PATH + path, headers=HEADERS["online_staff"], json={})
    assert response.status_code == 403
    assert not client.recording_db.calls


@pytest.mark.parametrize("role", ["online_staff", "admin"])
def test_staff_list_uses_exact_decimal_strings_and_bounds(client, role):
    response = client.get(PATH + "/memos?limit=10&offset=20&month=2026-09-01&bud=C1", headers=HEADERS[role])
    assert response.status_code == 200, response.text
    assert response.json() == {"data": [{"id": ID, "gross_amount": "999999999999.99"}],
                               "meta": {"total": 1, "limit": 10, "offset": 20}}
    _, args = client.recording_db.calls[-1]
    assert args == ("memos", None, {"search": "", "month": "2026-09-01", "bud": "C1", "limit": 10, "offset": 20})
    assert client.recording_db.actors[-1].role == role


@pytest.mark.parametrize("query", ["limit=101", "offset=-1", "month=2026-09-02", "month=123", "role=admin", "bud=c1"])
def test_bad_list_filters_fail_before_database(client, query):
    assert client.get(PATH + "/memos?" + query, headers=HEADERS["online_staff"]).status_code == 422
    assert not client.recording_db.calls


@pytest.mark.parametrize("money", [12, 12.25, "-1.00", "1.234", "1e2", "1,000.00", "1000000000000.00", " 12.00", True])
def test_money_never_coerces_or_rounds_at_http_boundary(client, money):
    response = client.post(PATH + "/memos", headers=HEADERS["online_staff"], json={**MEMO, "gross_amount": money})
    assert response.status_code == 422
    assert not client.recording_db.calls


@pytest.mark.parametrize("changes", [
    {"memo_no": "MO2613001"}, {"memo_no": "M.COM037/69"}, {"memo_no": 2609001},
    {"role": "admin"}, {"created_by": ID}, {"name": "FORGED CAMPAIGN"}, {"source": "API"},
    {"subject": " "}, {"media_amount": "90.00"}, {"media_amount": "90.00", "fee_amount": "9.00"},
    {"approval_date": 123}, {"evidence_ref": "https://user:password@example.invalid/memo"},
    {"evidence_ref": "https://example.invalid/memo?token=SECRET-SYNTHETIC"},
    {"approvers": [{"name": "ทดสอบ", "role_label": "ผู้ทดสอบ", "decision": "APPROVED", "decision_at": "2026-09-30T12:00:00"}]},
    {"approvers": [{"name": "ทดสอบ", "role_label": "ผู้ทดสอบ", "decision": "APPROVED", "decision_at": 1234567890}]},
    {"cost_breakdown": [{"cost_type": "TOOL", "amount": "50.00"}, {"cost_type": "TOOL", "amount": "50.00"}]},
])
def test_invalid_memo_or_client_authority_is_rejected_without_echoing_input(client, changes):
    response = client.post(PATH + "/memos", headers=HEADERS["online_staff"], json={**MEMO, **changes})
    assert response.status_code == 422, response.text
    assert "SECRET-SYNTHETIC" not in response.text
    assert "input" not in response.text
    assert not client.recording_db.calls


@pytest.mark.parametrize("changes", [
    {"month": "2026-09-02"}, {"agency": None}, {"source_kind": "LEDGER"},
    {"components": [COMPONENT, COMPONENT]}, {"components": [{**COMPONENT, "rem_project_id": 1}]},
    {"components": [{**COMPONENT, "budget_items": [{"cost_type": "MEDIA", "payment_method": "CORPORATE_CARD", "amount": "101.00"}]}]},
    {"components": [{**COMPONENT, "component_kind": "POOL"}]}, {"program_ref": "WRONG-GRAIN"},
])
def test_line_grain_source_ids_and_typed_budget_totals_are_validated(client, changes):
    response = client.post(PATH + "/media-lines", headers=HEADERS["online_staff"], json={**LINE, **changes})
    assert response.status_code == 422, response.text
    assert not client.recording_db.calls


def test_partial_budget_itemization_keeps_truthful_known_items(client):
    body = {**LINE, "components": [{**COMPONENT, "budget_items": [
        {"cost_type": "AGENCY_FEE", "payment_method": "AGENCY_PO_INVOICE", "amount": "10.00"}]}]}
    response = client.post(PATH + "/media-lines", headers=HEADERS["online_staff"], json=body)
    assert response.status_code == 201
    assert client.recording_db.calls[-1][1][1]["components"][0]["gross_amount"] == "100.00"
    assert len(client.recording_db.calls[-1][1][1]["components"][0]["budget_items"]) == 1


@pytest.mark.parametrize("mapping", [
    {**MAPPING, "valid_to": "2026-01-01"}, {**MAPPING, "bud": None},
    {**MAPPING, "bud_splits": [{"bud": "C1", "weight_bps": 10000}]},
    {**MAPPING, "bud": None, "bud_splits": [{"bud": "C1", "weight_bps": 9999}]},
    {**MAPPING, "bud": None, "bud_splits": [{"bud": "C1", "weight_bps": 5000}, {"bud": "C1", "weight_bps": 5000}]},
])
def test_account_mapping_requires_exact_effective_interval_and_bud_split(client, mapping):
    response = client.post(PATH + "/ad-accounts", headers=HEADERS["online_staff"], json={**ACCOUNT, "mapping": mapping})
    assert response.status_code == 422
    assert not client.recording_db.calls


@pytest.mark.parametrize("path,body,action", [
    ("/memos", MEMO, "memo_create"), ("/media-lines", LINE, "line_create"),
    ("/ad-accounts", ACCOUNT, "ad_account_create"), ("/commitments", COMMITMENT, "commitment_create"),
    ("/card-statements", STATEMENT, "statement_create"),
    ("/memo-identifiers", {"memo_id": ID, "identifier": "M.COM037/69", "reason": "หลักฐานสังเคราะห์",
                           "evidence_ref": "SYNTHETIC-ALIAS"}, "memo_identifier_propose"),
])
def test_typed_create_routes_dispatch_only_server_selected_action(client, path, body, action):
    response = client.post(PATH + path, headers=HEADERS["online_staff"], json=body)
    assert response.status_code == 201, response.text
    assert response.json()["data"]["action"] == action
    sql, args = client.recording_db.calls[-1]
    assert "finance_command($1,$2::jsonb)::text" in sql
    assert args == (action, body)
    assert client.recording_db.actors[-1].role == "online_staff"


def test_patch_preserves_explicit_null_and_omits_unset_fields(client):
    response = client.patch(PATH + "/memos/" + ID, headers=HEADERS["online_staff"],
                            json={"expected_version": 2, "evidence_ref": None})
    assert response.status_code == 200
    assert client.recording_db.calls[-1][1] == ("memo_update", {"id": ID, "expected_version": 2, "evidence_ref": None})


def test_annual_allocation_is_explicit_and_does_not_create_campaign_name(client):
    payload = {"expected_version": 1, "expected_allocation_set_id": None, "method": "EQUAL_MONTHS",
               "coverage_start": "2026-01-01", "coverage_end": "2026-12-01", "scope_id": GROUP,
               "bud": "C1", "reason": "เฉลี่ยค่าใช้จ่ายรายปีตามหลักฐานสังเคราะห์"}
    response = client.post(PATH + f"/cost-records/{ID}/allocations", headers=HEADERS["online_staff"], json=payload)
    assert response.status_code == 200
    assert client.recording_db.calls[-1][1] == ("cost_allocate", {**payload, "id": ID})
    assert all("issue_registration" not in sql for sql, _ in client.recording_db.calls)


@pytest.mark.parametrize("changes", [
    {"method": "EXPLICIT"}, {"coverage_end": "2025-12-01"}, {"coverage_start": "2026-01-02"},
    {"bud": None}, {"allocations": [{"month": "2026-01-01", "scope_id": GROUP, "bud": "C1", "amount": "1.00"}]},
])
def test_allocation_rejects_ambiguous_schedule(client, changes):
    body = {"expected_version": 1, "expected_allocation_set_id": None, "method": "EQUAL_MONTHS",
            "coverage_start": "2026-01-01", "coverage_end": "2026-12-01", "scope_id": GROUP,
            "bud": "C1", "reason": "สังเคราะห์", **changes}
    assert client.post(PATH + f"/cost-records/{ID}/allocations", headers=HEADERS["online_staff"], json=body).status_code == 422


def test_statement_has_no_cardholder_or_upload_fields(client):
    for prohibited in ("cardholder", "address", "last_four", "card_number", "pdf", "file_url"):
        response = client.post(PATH + "/card-statements", headers=HEADERS["online_staff"], json={**STATEMENT, prohibited: "PRIVATE-SYNTHETIC"})
        assert response.status_code == 422
        assert "PRIVATE-SYNTHETIC" not in response.text
    assert not client.recording_db.calls


def test_repeated_identical_costs_are_not_deduplicated_by_transport(client):
    costs = [{"cost_type": "CHANNEL", "direction": "DEBIT", "amount": "100.00", "bud": "C1"}] * 2
    response = client.post(PATH + f"/card-import-rows/{ID}/classify", headers=HEADERS["online_staff"],
                           json={"expected_version": 1, "costs": costs})
    assert response.status_code == 200
    assert client.recording_db.calls[-1][1][1] == {"source_row_id": ID, "expected_version": 1, "costs": costs}


@pytest.mark.parametrize("error,status", [(asyncpg.CheckViolationError, 422), (asyncpg.UniqueViolationError, 409),
                                         (asyncpg.SerializationError, 409), (asyncpg.InsufficientPrivilegeError, 403),
                                         (asyncpg.NoDataFoundError, 404), (asyncpg.InvalidParameterValueError, 422)])
def test_database_errors_are_thai_and_never_expose_private_database_detail(client, error, status):
    client.recording_db.error = error("PRIVATE-SYNTHETIC-APPROVER-AND-EVIDENCE")
    response = client.get(PATH + "/memos", headers=HEADERS["online_staff"])
    assert response.status_code == status
    assert "PRIVATE-SYNTHETIC" not in response.text
    assert any("ก" <= char <= "๙" for char in response.json()["error"]["message"])


def test_json_decoder_retains_satang_at_maximum_numeric_14_2():
    result = decode_finance('{"gross_amount":999999999999.99,"rows":[{"amount":100},{"amount":0.01}],"total":2}')
    assert result == {"gross_amount": "999999999999.99", "rows": [{"amount": "100.00"}, {"amount": "0.01"}], "total": 2}
    assert sum(Decimal(row["amount"]) for row in result["rows"]) == Decimal("100.01")


@pytest.mark.integration
@pytest.mark.skipif(not os.getenv("HUB_TEST_DATABASE_URL"), reason="Requires migrated local synthetic finance database")
def test_finance_real_memo_program_revision_and_account_workflow():
    config = settings(database_url=os.environ["HUB_TEST_DATABASE_URL"])
    with TestClient(main.create_app(config), client=("127.0.0.1", 50000)) as client:
        def call(method, path, body=None, role="online_staff", expected=200):
            response = client.request(method, PATH + path, headers=HEADERS[role], json=body)
            assert response.status_code == expected, response.text
            return response.json().get("data")

        number = uuid4().int
        memo_no = f"MO{number % 100:02d}{number // 100 % 12 + 1:02d}{number // 1200 % 1000:03d}"
        memo = call("POST", "/memos", {**MEMO, "memo_no": memo_no, "requesting_bud": "SID"}, expected=201)
        assert memo["record_status"] == "DRAFT" and memo["gross_amount"] == "100.00"
        memo = call("POST", f"/memos/{memo['id']}/confirm-record", {"expected_version": memo["row_version"]})
        assert memo["record_status"] == "CONFIRMED"
        program = {"kind": "CORP_PROGRAM", "program_ref": "SYNTHETIC-" + uuid4().hex,
                   "period_start_month": "2026-09-01", "period_end_month": "2026-10-01",
                   "components": [{"component_kind": "PROGRAM", "bud": "SID", "gross_amount": "100.00", "memo_id": memo["id"]}],
                   "permitted_scope_ids": [CORP], "permitted_agencies": ["INHOUSE"], "mapping_verified": True, "reason": "ทดสอบสังเคราะห์"}
        line = call("POST", "/media-lines", program, expected=201)
        assert line["state"] == "DRAFT"
        revision = next(item for item in line["revisions"] if item["status"] == "DRAFT")
        line = call("POST", f"/media-lines/{line['id']}/revisions/{revision['id']}/confirm",
                    {"expected_revision_id": None, "acknowledgements": []})
        assert line["state"] == "ACTIVE"
        assert len([item for item in line["revisions"] if item["status"] == "APPROVED"]) == 1
        call("POST", f"/media-lines/{line['id']}/revisions/{revision['id']}/confirm",
             {"expected_revision_id": None, "acknowledgements": []}, expected=409)
        for role in ("agency_kin", "agency_combay", "viewer"):
            call("GET", "/memos/" + memo["id"], role=role, expected=403)
            call("GET", "/media-lines/" + line["id"], role=role, expected=403)
        account = call("POST", "/ad-accounts", {**ACCOUNT, "account_id": "000" + uuid4().hex}, expected=201)
        assert account["account_id"].startswith("000")
        mapping = account["mappings"][0]
        account = call("POST", f"/ad-accounts/{account['id']}/versions/confirm",
                       {"mapping_id": mapping["id"], "expected_version": mapping["row_version"]})
        assert any(item["status"] == "CONFIRMED" for item in account["mappings"])
        account = call("POST", f"/ad-accounts/{account['id']}/versions", {"expected_version": account["row_version"],
                       "mapping": {**MAPPING, "valid_from": "2026-07-01", "valid_to": "2027-06-01"}}, expected=201)
        overlap = next(item for item in account["mappings"] if item["valid_from"] == "2026-07-01")
        call("POST", f"/ad-accounts/{account['id']}/versions/confirm",
             {"mapping_id": overlap["id"], "expected_version": overlap["row_version"]}, expected=409)
        account = call("POST", f"/ad-accounts/{account['id']}/versions", {"expected_version": account["row_version"],
                       "mapping": {**MAPPING, "valid_from": "2027-01-01", "valid_to": "2028-01-01"}}, expected=201)
        adjacent = next(item for item in account["mappings"] if item["valid_from"] == "2027-01-01")
        account = call("POST", f"/ad-accounts/{account['id']}/versions/confirm",
                       {"mapping_id": adjacent["id"], "expected_version": adjacent["row_version"]})
        assert len([item for item in account["mappings"] if item["status"] == "CONFIRMED"]) == 2
        original_mapping = next(item for item in account["mappings"] if item["id"] == mapping["id"])
        close = {"mapping_id": original_mapping["id"], "expected_version": original_mapping["row_version"],
                 "effective_to": "2026-07-01", "reason": "ปิดช่วงผังเดิมตามหลักฐานสังเคราะห์"}
        account = call("POST", f"/ad-accounts/{account['id']}/versions/close", close)
        closed = next(item for item in account["mappings"] if item["id"] == original_mapping["id"])
        assert closed["valid_to"] == "2027-01-01" and closed["closed_on"] == "2026-07-01"
        call("POST", f"/ad-accounts/{account['id']}/versions/close", close, expected=409)
        account = call("POST", f"/ad-accounts/{account['id']}/versions", {"expected_version": account["row_version"],
                       "mapping": {**MAPPING, "valid_from": "2026-07-01", "valid_to": "2027-01-01"}}, expected=201)
        replacement = next(item for item in account["mappings"] if item["valid_from"] == "2026-07-01" and item["valid_to"] == "2027-01-01")
        account = call("POST", f"/ad-accounts/{account['id']}/versions/confirm", {"mapping_id": replacement["id"], "expected_version": replacement["row_version"]})
        assert any(item["id"] == replacement["id"] and item["status"] == "CONFIRMED" for item in account["mappings"])
        memo = call("PATCH", "/memos/" + memo["id"], {"expected_version": memo["row_version"], "gross_amount": "99.00"})
        assert memo["record_status"] == "DRAFT"
        line = call("GET", "/media-lines/" + line["id"])
        assert line["state"] == "SUSPENDED"


@pytest.mark.integration
@pytest.mark.skipif(not os.getenv("HUB_TEST_DATABASE_URL"), reason="Requires migrated local synthetic finance database")
def test_scope_assignment_memberships_revisions_and_alias_authority():
    config = settings(database_url=os.environ["HUB_TEST_DATABASE_URL"])
    with TestClient(main.create_app(config), client=("127.0.0.1", 50000)) as client:
        def call(method, path, body=None, role="online_staff", expected=200):
            response = client.request(method, PATH + path, headers=HEADERS[role], json=body)
            assert response.status_code == expected, response.text
            return response.json().get("data")

        flags = call("GET", "/settings")
        assert flags["sena_h_approved"] is False and flags["test_mode"] is True
        number = uuid4().int
        month = f"{2200 + number % 200:04d}-{number // 200 % 12 + 1:02d}-01"
        # Pick an unused synthetic future month; never overwrite a prior test line.
        for attempt in range(20):
            if not call("GET", f"/media-lines?month={month}&scope_id={GROUP}&agency=KIN"):
                break
            number = uuid4().int
            month = f"{2200 + number % 200:04d}-{number // 200 % 12 + 1:02d}-01"
        else:
            pytest.fail("No unused synthetic monthly line key")

        def create_memo(bud, amount):
            value = uuid4().int
            no = f"MO{value % 100:02d}{value // 100 % 12 + 1:02d}{value // 1200 % 1000:03d}"
            result = call("POST", "/memos", {**MEMO, "memo_no": no, "requesting_bud": bud, "gross_amount": amount}, expected=201)
            return call("POST", f"/memos/{result['id']}/confirm-record", {"expected_version": result["row_version"]})

        memo = create_memo("C1", "400.00")
        corp_memo = create_memo("SID", "100.00")
        registrations = {}
        selections = {
            "A": {"scope_kind": "A", "scope_id": GROUP},
            "B": {"scope_kind": "B", "scope_id": "30000000-0000-0000-0000-000000000004"},
            "C": {"scope_kind": "C", "parent_group_id": "C-DEMO-TEST1", "member_ids": ["00001", "00002"]},
            "D": {"scope_kind": "D", "member_ids": ["C-DEMO-TEST1", "C-DEMO-TEST2"]},
            "E": {"scope_kind": "E", "scope_id": "30000000-0000-0000-0000-000000000006"},
            "F": {"scope_kind": "F", "scope_id": CORP, "content_label": "SYNTHETIC CONTENT", "content_label_approved": True},
            "BU": {"scope_kind": "F", "scope_id": "30000000-0000-0000-0000-000000000007"},
        }
        for kind, selection in selections.items():
            registrations[kind] = call("POST", "/registrations", {**selection, "objective": "LEADS", "agency": "KIN"}, expected=201)

        def confirmed_line(payload, linked_memo):
            line = call("POST", "/media-lines", payload, expected=201)
            revision = next(row for row in line["revisions"] if row["status"] == "DRAFT")
            return call("POST", f"/media-lines/{line['id']}/revisions/{revision['id']}/confirm",
                        {"expected_revision_id": None, "acknowledgements": [{"memo_id": linked_memo["id"], "reason": "ยืนยันผลต่างข้อมูลสังเคราะห์"}]})

        group = confirmed_line({**LINE, "month": month, "components": [
            {**COMPONENT, "rem_project_id": phase, "gross_amount": "50.00", "memo_id": memo["id"]}
            for phase in ("00001", "00002")]}, memo)
        lines = {"A": group, "B": group, "C": group}
        for kind, line_kind in (("D", "ZONE_POOL"), ("E", "BRAND_POOL")):
            lines[kind] = confirmed_line({"kind": line_kind, "scope_id": registrations[kind]["registration"]["scope_id"],
                "month": month, "agency": "KIN", "components": [{"component_kind": "POOL", "bud": "C1", "gross_amount": "100.00",
                "memo_id": memo["id"]}], "reason": "กองกลางสังเคราะห์"}, memo)
        for kind, line_kind, budget in (("F", "CORP_PROGRAM", corp_memo), ("BU", "BU_PROGRAM", memo)):
            scope = selections[kind]["scope_id"]
            payload = {"kind": line_kind, "program_ref": "SYNTHETIC-" + uuid4().hex,
                "period_start_month": month, "period_end_month": month, "permitted_scope_ids": [scope],
                "permitted_agencies": ["KIN"], "mapping_verified": True,
                "components": [{"component_kind": "PROGRAM", "bud": budget["requesting_bud"], "gross_amount": "100.00", "memo_id": budget["id"]}],
                "reason": "โปรแกรมสังเคราะห์"}
            if kind == "BU":
                payload["scope_id"] = scope
            lines[kind] = confirmed_line(payload, budget)

        assignments = {}
        for kind, registration in registrations.items():
            line = lines[kind]
            revision_id = line["current_revision_id"]
            code = registration["registration"]["code"]
            candidates = call("GET", f"/registrations/{code}/line-candidates?month={month}")
            assert any(row["id"] == line["id"] and row["eligible"] for row in candidates["items"])
            body = {"code": code, "month": month, "line_id": line["id"], "expected_revision_id": revision_id}
            assignments[kind] = call("POST", "/line-assignments", body, expected=201)
            call("POST", "/line-assignments", body, expected=409)
            context = call("GET", f"/registrations/{code}/monthly-lines")
            assert context["items"][0]["review_status"] == "CURRENT"

        # Removing a phase preserves old links but blocks acknowledgement for B/C.
        group = call("GET", "/media-lines/" + group["id"])
        previous = group["current_revision_id"]
        group = call("POST", f"/media-lines/{group['id']}/revisions", {"expected_version": group["row_version"],
            "components": [{**COMPONENT, "memo_id": memo["id"]}], "reason": "แก้รุ่นสังเคราะห์เหลือหนึ่งเฟส"}, expected=201)
        draft = next(row for row in group["revisions"] if row["status"] == "DRAFT")
        group = call("POST", f"/media-lines/{group['id']}/revisions/{draft['id']}/confirm",
                     {"expected_revision_id": previous, "acknowledgements": []})
        for kind in ("A", "B", "C"):
            assignment = assignments[kind]
            code = registrations[kind]["registration"]["code"]
            assert call("GET", f"/registrations/{code}/monthly-lines")["items"][0]["review_status"] == "REVIEW_REQUIRED"
            call("POST", f"/line-assignments/{assignment['id']}/acknowledge",
                 {"expected_version": assignment["row_version"], "expected_revision_id": group["current_revision_id"]},
                 expected=200 if kind == "A" else 422)

        alias_text = "SYNTHETIC-ALIAS-" + uuid4().hex
        alias = call("POST", "/memo-identifiers", {"memo_id": memo["id"], "identifier": alias_text,
                     "reason": "หลักฐานสังเคราะห์เท่านั้น", "evidence_ref": "SYNTHETIC-ALIAS"}, expected=201)
        call("POST", f"/memo-identifiers/{alias['id']}/review", {"expected_version": alias["row_version"],
             "decision": "APPROVE", "reason": "ทดสอบการปฏิเสธสิทธิ์"}, expected=403)
        alias = call("POST", f"/memo-identifiers/{alias['id']}/review", {"expected_version": alias["row_version"],
                     "decision": "APPROVE", "reason": "ตรวจหลักฐานสังเคราะห์แล้ว"}, role="admin")
        assert alias["status"] == "CONFIRMED"
        call("POST", "/memo-identifiers", {"memo_id": corp_memo["id"], "identifier": alias_text,
             "reason": "ห้ามใช้ชื่ออ้างอิงซ้ำ", "evidence_ref": "SYNTHETIC-COLLISION"}, expected=409)
        assert call("GET", "/settings")["sena_h_approved"] is False


@pytest.mark.integration
@pytest.mark.skipif(not os.getenv("HUB_TEST_DATABASE_URL"), reason="Requires migrated local synthetic finance database")
def test_annual_commitment_card_cost_caps_and_exact_monthly_allocation():
    config = settings(database_url=os.environ["HUB_TEST_DATABASE_URL"])
    with TestClient(main.create_app(config), client=("127.0.0.1", 50000)) as client:
        def call(method, path, body=None, expected=200):
            response = client.request(method, PATH + path, headers=HEADERS["online_staff"], json=body)
            assert response.status_code == expected, response.text
            return response.json().get("data")

        async def synthetic_import(payload):
            connection = await asyncpg.connect(config.database_url)
            try:
                await main.initialize_connection(connection)
                async with connection.transaction():
                    await connection.execute("SET LOCAL ROLE hub_app")
                    await connection.execute("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000006',true)")
                    return decode_finance(await connection.fetchval("SELECT ads.finance_command('card_import',$1::jsonb)::text", payload))
            finally:
                await connection.close()

        value = uuid4().int
        memo_no = f"MO{value % 100:02d}{value // 100 % 12 + 1:02d}{value // 1200 % 1000:03d}"
        memo = call("POST", "/memos", {**MEMO, "memo_no": memo_no, "gross_amount": "1199.99"}, expected=201)
        memo = call("POST", f"/memos/{memo['id']}/confirm-record", {"expected_version": memo["row_version"]})
        body = json.loads(json.dumps(COMMITMENT))
        body["vendor"] = "ผู้ให้บริการสังเคราะห์ " + uuid4().hex
        body["version"]["covers"][0]["memo_id"] = memo["id"]
        commitment = call("POST", "/commitments", body, expected=201)
        version = commitment["versions"][0]
        commitment = call("POST", f"/commitments/{commitment['id']}/activate", {"expected_version": commitment["row_version"],
            "version_id": version["id"], "expected_current_version_id": None, "acknowledgements": []})
        assert commitment["state"] == "ACTIVE"
        version = next(row for row in commitment["versions"] if row["status"] == "CONFIRMED")
        occurrence = version["occurrences"][0]
        assert occurrence["charge_date"] == "2025-12-25"
        assert occurrence["coverage_start"] == "2026-01-01"

        bad_body = json.loads(json.dumps(body))
        bad_body["version"]["covers"][0]["cap_amount"] = "1199.98"
        invalid = call("POST", "/commitments", bad_body, expected=201)
        call("POST", f"/commitments/{invalid['id']}/activate", {"expected_version": invalid["row_version"],
            "version_id": invalid["versions"][0]["id"], "expected_current_version_id": None,
            "acknowledgements": [{"memo_id": memo["id"], "reason": "ห้ามใช้เหตุผลข้ามเพดานวงเงิน"}]}, expected=422)

        statement = call("POST", "/card-statements", {**STATEMENT, "operator_ref": "SYNTHETIC-" + uuid4().hex,
                         "cycle_start": "2025-12-01", "cycle_end": "2025-12-31", "due_date": "2026-01-15"}, expected=201)
        fingerprint = hashlib.sha256(uuid4().bytes).hexdigest()
        batch = asyncio.run(synthetic_import({"source_fingerprint": fingerprint, "statement_control_id": statement["id"],
            "logical_source_id": "synthetic-" + uuid4().hex, "source_file": "synthetic.csv", "tab": "synthetic",
            "profile_id": "SYNTHETIC-CARD", "profile_version": "1", "provenance": {"synthetic": True}, "issues": [],
            "rows": [{"row_no": 2, "row_hash": hashlib.sha256(b"synthetic annual charge").hexdigest(),
                      "raw_row": {"Category": "TOOL", "BUD": "C1", "Detail": "ค่าใช้จ่ายสังเคราะห์"},
                      "cost_type": "TOOL", "payment_method": "CORPORATE_CARD", "amount": "1199.99", "direction": "DEBIT",
                      "charge_date": "2025-12-25", "bud": "C1", "memo_no": memo["memo_no"]}]}))
        assert batch["status"] == "APPLIED_DRAFT"
        row = batch["rows"][0]
        call("POST", f"/card-import-rows/{row['id']}/classify", {"expected_version": row["row_version"], "costs": [{
            "cost_type": "TOOL", "amount": "1199.99", "direction": "DEBIT", "scope_id": GROUP, "bud": "C1",
            "vendor": body["vendor"], "memo_id": memo["id"], "commitment_occurrence_id": occurrence["id"],
            "evidence_refs": {"M": "SYNTHETIC-MEMO", "S": "SYNTHETIC-CARD", "V": "SYNTHETIC-INVOICE", "C": "SYNTHETIC-COVER"}}]})
        batch = call("GET", "/card-imports/" + batch["id"])
        batch = call("POST", f"/card-imports/{batch['id']}/confirm", {"expected_version": batch["row_version"],
                     "expected_previous_batch_id": None, "reason": "ยืนยันข้อมูลสังเคราะห์"})
        assert batch["status"] == "CONFIRMED" and batch["net_total"] == "1199.99"
        costs = [cost for item in batch["rows"] for cost in item["costs"] if cost["status"] == "CONFIRMED"]
        assert len(costs) == 1
        cost = costs[0]
        cost = call("POST", f"/cost-records/{cost['id']}/allocations", {"expected_version": cost["row_version"],
                    "expected_allocation_set_id": None, "method": "EQUAL_MONTHS", "coverage_start": "2026-01-01",
                    "coverage_end": "2026-12-01", "scope_id": GROUP, "bud": "C1", "reason": "เฉลี่ยตามช่วงใช้บริการสังเคราะห์"})
        allocation = next(item for item in cost["allocations"] if item["status"] == "CONFIRMED")
        amounts = [Decimal(item["amount"]) for item in allocation["items"]]
        assert amounts == [Decimal("100.00")] * 11 + [Decimal("99.99")]
        assert sum(amounts) == Decimal(cost["amount"]) == Decimal("1199.99")
        detail = call("GET", "/commitments/" + commitment["id"])
        current = next(item for item in detail["versions"] if item["status"] == "CONFIRMED")
        assert current["covers"][0]["actual_consumption"] == "1199.99"
        # Monthly recognition does not consume the cover again or issue an SN.
        assert call("GET", "/memos/" + memo["id"])["reconciliation"]["allocated_amount"] == "1199.99"

        # A replacement is explicitly reviewed and linked again. No old amount or
        # monthly interpretation is copied by source position or counted twice.
        old_cost_id = cost["id"]
        old_batch_id = batch["id"]
        replacement = asyncio.run(synthetic_import({"source_fingerprint": hashlib.sha256(uuid4().bytes).hexdigest(),
            "statement_control_id": statement["id"], "logical_source_id": "synthetic-" + uuid4().hex,
            "source_file": "synthetic-corrected.csv", "tab": "synthetic", "profile_id": "SYNTHETIC-CARD", "profile_version": "1",
            "provenance": {"synthetic": True}, "issues": [], "rows": [{"row_no": 3,
                "row_hash": hashlib.sha256(b"synthetic corrected annual charge").hexdigest(),
                "raw_row": {"Category": "TOOL", "BUD": "C1", "Detail": "แก้ไขคำอธิบายสังเคราะห์"}, "cost_type": "TOOL",
                "amount": "1199.99", "direction": "DEBIT", "charge_date": "2025-12-25", "bud": "C1"}]}))
        assert replacement["status"] == "QUARANTINED"
        row = replacement["rows"][0]
        call("POST", f"/card-import-rows/{row['id']}/classify", {"expected_version": row["row_version"], "costs": [{
            "cost_type": "TOOL", "amount": "1199.99", "direction": "DEBIT", "scope_id": GROUP, "bud": "C1",
            "memo_id": memo["id"], "commitment_occurrence_id": occurrence["id"], "vendor": body["vendor"]}]})
        replacement = call("GET", "/card-imports/" + replacement["id"])
        replacement = call("POST", f"/card-imports/{replacement['id']}/replace", {"expected_version": replacement["row_version"],
            "expected_previous_batch_id": old_batch_id, "reason": "ทบทวนและเชื่อมรายการแก้ไขอย่างชัดเจน"})
        assert replacement["status"] == "CONFIRMED"
        assert call("GET", "/card-imports/" + old_batch_id)["status"] == "SUPERSEDED"
        old_cost = call("GET", "/cost-records/" + old_cost_id)
        assert old_cost["status"] == "SUPERSEDED"
        assert all(item["status"] == "SUPERSEDED" for item in old_cost["allocations"])
        cost = next(item for item in replacement["rows"][0]["costs"] if item["status"] == "CONFIRMED")
        assert call("GET", "/cost-records/" + cost["id"])["allocations"] == []
        cost = call("POST", f"/cost-records/{cost['id']}/allocations", {"expected_version": cost["row_version"],
            "expected_allocation_set_id": None, "method": "EQUAL_MONTHS", "coverage_start": "2026-01-01",
            "coverage_end": "2026-12-01", "scope_id": GROUP, "bud": "C1", "reason": "ยืนยันช่วงจัดสรรของรายการแก้ไขใหม่"})
        assert sum(Decimal(item["amount"]) for item in cost["allocations"][0]["items"]) == Decimal("1199.99")
        detail = call("GET", "/commitments/" + commitment["id"])
        assert next(item for item in detail["versions"] if item["status"] == "CONFIRMED")["covers"][0]["actual_consumption"] == "1199.99"

        # A later statement contains a composite purchase and an explicit refund.
        # The refund after coverage still reduces cash consumption of that cover.
        credit_control = call("POST", "/card-statements", {**STATEMENT, "operator_ref": "SYNTHETIC-" + uuid4().hex,
            "cycle_start": "2027-01-01", "cycle_end": "2027-01-31", "due_date": "2027-02-15", "declared_total": "100.00"}, expected=201)
        mixed = asyncio.run(synthetic_import({"source_fingerprint": hashlib.sha256(uuid4().bytes).hexdigest(),
            "statement_control_id": credit_control["id"], "logical_source_id": "synthetic-" + uuid4().hex,
            "source_file": "synthetic-refund.csv", "tab": "synthetic", "profile_id": "SYNTHETIC-CARD", "profile_version": "1",
            "provenance": {"synthetic": True}, "issues": [], "rows": [
                {"row_no": number, "row_hash": hashlib.sha256(f"synthetic-{number}".encode()).hexdigest(),
                 "raw_row": {"Category": category, "BUD": "C1", "Detail": "รายการสังเคราะห์"},
                 "cost_type": category, "amount": amount, "direction": direction, "charge_date": "2027-01-15", "bud": "C1"}
                for number, category, amount, direction in ((2, "TOOL", "200.00", "DEBIT"), (3, "TOOL", "100.00", "CREDIT"))]}))
        debit, credit = mixed["rows"]
        leaves = [{"cost_type": "TOOL", "amount": "150.00", "direction": "DEBIT", "scope_id": GROUP, "bud": "C1"},
                  {"cost_type": "CHANNEL", "amount": "50.00", "direction": "DEBIT", "bud": "C1"}]
        call("POST", f"/card-import-rows/{debit['id']}/classify", {"expected_version": debit["row_version"],
            "costs": [{**leaves[0], "amount": "151.00"}, leaves[1]]}, expected=422)
        call("POST", f"/card-import-rows/{debit['id']}/classify", {"expected_version": debit["row_version"], "costs": leaves})
        call("POST", f"/card-import-rows/{credit['id']}/classify", {"expected_version": credit["row_version"], "costs": [{
            "cost_type": "TOOL", "amount": "100.00", "direction": "CREDIT", "scope_id": GROUP, "bud": "C1",
            "memo_id": memo["id"], "commitment_occurrence_id": occurrence["id"], "refund_of": cost["id"]}]})
        mixed = call("GET", "/card-imports/" + mixed["id"])
        mixed = call("POST", f"/card-imports/{mixed['id']}/confirm", {"expected_version": mixed["row_version"],
            "expected_previous_batch_id": None, "reason": "ยืนยันรายการและคืนเงินสังเคราะห์"})
        assert mixed["status"] == "CONFIRMED" and mixed["net_total"] == "100.00"
        current_costs = [item for row in mixed["rows"] for item in row["costs"] if item["status"] == "CONFIRMED"]
        assert len(current_costs) == 3
        assert sum(Decimal(item["amount"]) * (1 if item["direction"] == "DEBIT" else -1) for item in current_costs) == Decimal("100.00")
        unresolved = next(item for item in current_costs if item["cost_type"] == "CHANNEL")
        assert unresolved["attribution_status"] == "UNRESOLVED"
        detail = call("GET", "/commitments/" + commitment["id"])
        current = next(item for item in detail["versions"] if item["status"] == "CONFIRMED")
        assert current["covers"][0]["actual_consumption"] == "1099.99"
        memo = call("PATCH", "/memos/" + memo["id"], {"expected_version": memo["row_version"], "mirrored_status": "CANCELLED"})
        assert call("GET", "/commitments/" + commitment["id"])["state"] == "SUSPENDED"
        assert call("GET", "/settings")["sena_h_approved"] is False


@pytest.mark.integration
@pytest.mark.skipif(not os.getenv("HUB_TEST_DATABASE_URL"), reason="Requires migrated local synthetic finance database")
def test_component_and_typed_item_covers_share_one_reservation_ceiling():
    config = settings(database_url=os.environ["HUB_TEST_DATABASE_URL"])
    with TestClient(main.create_app(config), client=("127.0.0.1", 50000)) as client:
        def call(method, path, body=None, expected=200):
            response = client.request(method, PATH + path, headers=HEADERS["online_staff"], json=body)
            assert response.status_code == expected, response.text
            return response.json().get("data")

        value = uuid4().int
        memo = call("POST", "/memos", {**MEMO, "memo_no": f"MO{value % 100:02d}{value // 100 % 12 + 1:02d}{value // 1200 % 1000:03d}",
                    "requesting_bud": "SID"}, expected=201)
        memo = call("POST", f"/memos/{memo['id']}/confirm-record", {"expected_version": memo["row_version"]})
        line = call("POST", "/media-lines", {"kind": "CORP_PROGRAM", "program_ref": "SYNTHETIC-CAP-" + uuid4().hex,
            "period_start_month": "2026-01-01", "period_end_month": "2026-12-01", "mapping_verified": True,
            "permitted_scope_ids": [CORP], "permitted_agencies": ["INHOUSE"], "reason": "ทดสอบวงเงินร่วม",
            "components": [{"component_kind": "PROGRAM", "bud": "SID", "gross_amount": "100.00", "memo_id": memo["id"],
                            "budget_items": [{"cost_type": "TOOL", "payment_method": "CORPORATE_CARD", "amount": "100.00"}]}]}, expected=201)
        line = call("POST", f"/media-lines/{line['id']}/revisions/{line['revisions'][0]['id']}/confirm",
                    {"expected_revision_id": None, "acknowledgements": []})
        component = line["revisions"][0]["components"][0]
        body = json.loads(json.dumps(COMMITMENT))
        body["version"].update(scope_id=CORP, bud="SID", amount_per_cycle="100.00")
        body["version"]["occurrences"][0]["expected_amount"] = "100.00"
        body["version"]["covers"][0].update(memo_id=memo["id"], bud="SID", cap_amount="100.00", component_id=component["id"])
        first = call("POST", "/commitments", body, expected=201)
        first = call("POST", f"/commitments/{first['id']}/activate", {"expected_version": first["row_version"],
                     "version_id": first["versions"][0]["id"], "expected_current_version_id": None, "acknowledgements": []})
        assert first["state"] == "ACTIVE"
        assert call("GET", f"/memos/{memo['id']}")["reconciliation"]["allocated_amount"] == "100.00"
        body["version"]["covers"][0]["budget_item_id"] = component["budget_items"][0]["id"]
        second = call("POST", "/commitments", body, expected=201)
        call("POST", f"/commitments/{second['id']}/activate", {"expected_version": second["row_version"],
             "version_id": second["versions"][0]["id"], "expected_current_version_id": None,
             "acknowledgements": [{"memo_id": memo["id"], "reason": "เหตุผลไม่สามารถข้ามเพดานร่วม"}]}, expected=422)


@pytest.mark.integration
@pytest.mark.skipif(not os.getenv("HUB_TEST_DATABASE_URL"), reason="Requires migrated local synthetic finance database")
def test_confirmed_brand_split_controls_satang_and_cannot_be_overridden():
    config = settings(database_url=os.environ["HUB_TEST_DATABASE_URL"])
    with TestClient(main.create_app(config), client=("127.0.0.1", 50000)) as client:
        def call(method, path, body=None, expected=200):
            response = client.request(method, PATH + path, headers=HEADERS["online_staff"], json=body)
            assert response.status_code == expected, response.text
            return response.json().get("data")

        brand = "30000000-0000-0000-0000-000000000006"
        splits = [{"bud": "C1", "weight_bps": 5000}, {"bud": "C2", "weight_bps": 5000}]
        account = call("POST", "/ad-accounts", {**ACCOUNT, "account_id": "000" + uuid4().hex,
            "mapping": {**MAPPING, "scope_id": brand, "bud": None, "bud_splits": splits}}, expected=201)
        mapping = account["mappings"][0]
        call("POST", f"/ad-accounts/{account['id']}/versions/confirm", {"mapping_id": mapping["id"], "expected_version": mapping["row_version"]})
        statement = call("POST", "/card-statements", {**STATEMENT, "operator_ref": "SYNTHETIC-SPLIT-" + uuid4().hex,
                         "declared_total": "0.01"}, expected=201)

        async def import_charge():
            connection = await asyncpg.connect(config.database_url)
            try:
                await main.initialize_connection(connection)
                async with connection.transaction():
                    await connection.execute("SET LOCAL ROLE hub_app")
                    await connection.execute("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000006',true)")
                    return decode_finance(await connection.fetchval("SELECT ads.finance_command('card_import',$1::jsonb)::text", {
                        "source_fingerprint": hashlib.sha256(uuid4().bytes).hexdigest(), "statement_control_id": statement["id"],
                        "logical_source_id": "synthetic-" + uuid4().hex, "source_file": "synthetic.csv", "tab": "synthetic",
                        "profile_id": "SYNTHETIC-CARD", "profile_version": "1", "provenance": {"synthetic": True}, "issues": [],
                        "rows": [{"row_no": 2, "row_hash": hashlib.sha256(b"synthetic brand charge").hexdigest(),
                                  "raw_row": {"Category": "MEDIA", "Detail": "รายการสังเคราะห์"}, "cost_type": "MEDIA",
                                  "amount": "0.01", "direction": "DEBIT", "charge_date": "2026-09-15"}]}))
            finally:
                await connection.close()

        batch = asyncio.run(import_charge())
        row = batch["rows"][0]
        call("POST", f"/card-import-rows/{row['id']}/classify", {"expected_version": row["row_version"], "costs": [{
            "cost_type": "MEDIA", "amount": "0.01", "direction": "DEBIT", "scope_id": brand, "account_mapping_id": mapping["id"]}]})
        batch = call("GET", "/card-imports/" + batch["id"])
        batch = call("POST", f"/card-imports/{batch['id']}/confirm", {"expected_version": batch["row_version"],
                    "expected_previous_batch_id": None, "reason": "ยืนยันยอดสังเคราะห์"})
        cost = next(item for item in batch["rows"][0]["costs"] if item["status"] == "CONFIRMED")
        account = call("GET", "/ad-accounts/" + account["id"])
        confirmed_mapping = next(item for item in account["mappings"] if item["id"] == mapping["id"])
        call("POST", f"/ad-accounts/{account['id']}/versions/close", {"mapping_id": mapping["id"],
             "expected_version": confirmed_mapping["row_version"], "effective_to": "2026-09-15",
             "reason": "ห้ามปิดทับรายการที่ยืนยันแล้ว"}, expected=422)
        allocation = {"expected_version": cost["row_version"], "expected_allocation_set_id": None, "method": "EQUAL_MONTHS",
                      "coverage_start": "2026-09-01", "coverage_end": "2026-09-01", "scope_id": brand,
                      "bud_splits": splits, "reason": "ทดสอบสัดส่วนที่ยืนยันแล้ว"}
        call("POST", f"/cost-records/{cost['id']}/allocations", {**allocation,
             "bud_splits": [{"bud": "C1", "weight_bps": 1000}, {"bud": "C2", "weight_bps": 9000}]}, expected=422)
        call("POST", f"/cost-records/{cost['id']}/allocations", {"expected_version": cost["row_version"],
            "expected_allocation_set_id": None, "method": "EXPLICIT", "reason": "ห้ามข้ามสัดส่วนด้วยการระบุเอง",
            "allocations": [{"month": "2026-09-01", "scope_id": brand, "bud": "C1", "amount": "0.00"},
                            {"month": "2026-09-01", "scope_id": brand, "bud": "C2", "amount": "0.01"}]}, expected=422)
        cost = call("POST", f"/cost-records/{cost['id']}/allocations", allocation)
        items = next(item for item in cost["allocations"] if item["status"] == "CONFIRMED")["items"]
        assert [(item["bud"], item["amount"]) for item in items] == [("C1", "0.01"), ("C2", "0.00")]
        assert sum(Decimal(item["amount"]) for item in items) == Decimal("0.01")


@pytest.mark.integration
@pytest.mark.skipif(not os.getenv("HUB_TEST_DATABASE_URL"), reason="Requires migrated local synthetic finance database")
def test_memo_invalidation_suspends_commitment_funded_by_another_component_of_same_line():
    config = settings(database_url=os.environ["HUB_TEST_DATABASE_URL"])
    with TestClient(main.create_app(config), client=("127.0.0.1", 50000)) as client:
        def call(method, path, body=None, expected=200):
            response = client.request(method, PATH + path, headers=HEADERS["online_staff"], json=body)
            assert response.status_code == expected, response.text
            return response.json().get("data")

        value = uuid4().int
        month = f"{2500 + value % 200:04d}-{value // 200 % 12 + 1:02d}-01"
        memos = []
        for gross in ("50.00", "100.00"):
            value = uuid4().int
            memo = call("POST", "/memos", {**MEMO, "memo_no": f"MO{value % 100:02d}{value // 100 % 12 + 1:02d}{value // 1200 % 1000:03d}",
                        "gross_amount": gross}, expected=201)
            memos.append(call("POST", f"/memos/{memo['id']}/confirm-record", {"expected_version": memo["row_version"]}))
        line = call("POST", "/media-lines", {**LINE, "month": month, "components": [
            {**COMPONENT, "rem_project_id": phase, "memo_id": memo["id"], "gross_amount": memo["gross_amount"]}
            for phase, memo in zip(("00001", "00002"), memos)]}, expected=201)
        line = call("POST", f"/media-lines/{line['id']}/revisions/{line['revisions'][0]['id']}/confirm",
                    {"expected_revision_id": None, "acknowledgements": []})
        component = next(item for item in line["revisions"][0]["components"] if item["rem_project_id"] == "00002")
        body = json.loads(json.dumps(COMMITMENT))
        body["version"].update(frequency="MONTHLY", amount_per_cycle="100.00", start_date=month, end_date=month[:7] + "-28")
        body["version"]["occurrences"][0].update(charge_date=month[:7] + "-15", coverage_start=month, coverage_end=month, expected_amount="100.00")
        body["version"]["covers"][0].update(memo_id=memos[1]["id"], coverage_start=month, coverage_end=month, cap_amount="100.00", component_id=component["id"])
        commitment = call("POST", "/commitments", body, expected=201)
        commitment = call("POST", f"/commitments/{commitment['id']}/activate", {"expected_version": commitment["row_version"],
                          "version_id": commitment["versions"][0]["id"], "expected_current_version_id": None, "acknowledgements": []})
        assert commitment["state"] == "ACTIVE"
        call("PATCH", "/memos/" + memos[0]["id"], {"expected_version": memos[0]["row_version"], "mirrored_status": "CANCELLED"})
        assert call("GET", "/media-lines/" + line["id"])["state"] == "SUSPENDED"
        commitment = call("GET", "/commitments/" + commitment["id"])
        assert commitment["state"] == "SUSPENDED"
        assert commitment["versions"][0]["covers"][0]["status"] == "SUSPENDED"
