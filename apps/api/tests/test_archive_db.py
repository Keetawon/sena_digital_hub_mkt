"""Opt-in HTTP/SQL archive workflow; every database change rolls back on local TEST."""
from contextlib import asynccontextmanager
from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
from fastapi.testclient import TestClient
import pytest
from PIL import Image, ImageDraw
from pypdf import PdfReader

from sena_hub_api import main, document_storage
from sena_hub_api.auth import DEMO_ROLES, Settings
from sena_hub_api.document_worker import extract_document


@pytest.mark.integration
@pytest.mark.skipif(os.getenv("HUB_ARCHIVE_TEST") != "1", reason="Set HUB_ARCHIVE_TEST=1 for rollback-only local TEST")
def test_archive_review_application_evidence_versions_and_private_access(monkeypatch):
    root = Path(__file__).resolve().parents[3]
    config = json.loads((root / ".local/development.json").read_text(encoding="utf-8"))
    target = {"host": "127.0.0.1", "port": 55432, "database": "sena_hub_local"}
    assert all(config.get(key, value) == value for key, value in target.items())
    tokens = {role: "local-archive-test-" + role + "x" * 40 for role in DEMO_ROLES}
    settings = Settings("postgresql://unused:unused@127.0.0.1:55432/sena_hub_local", "demo", "local", tokens)
    connection = outer = None
    fixtures, before = {}, {}
    marker = "api-" + uuid4().hex
    tables = ("ads.archive_document", "ads.archive_version", "ads.archive_job", "ads.archive_application",
              "ads.archive_confirmation", "ads.archive_memo_chunk", "ads.memo", "ads.cost_record",
              "staging.ads_card_batch", "audit.archive_access")

    async def counts():
        await connection.execute("RESET ROLE")
        return {table: await connection.fetchval("SELECT count(*) FROM " + table) for table in tables}

    async def register(name, kind, fields=None, rows=None, controls=None, content=None):
        lines = ["SYNTHETIC API TEST ONLY", "UNIQUE: " + marker, "VERSION: " + name]
        if fields:
            lines.extend(f"{key.upper()}: {value}" for key, value in fields.items())
        if controls:
            lines.extend(f"{key.upper()}: {value}" for key, value in controls.items() if key != "page_counts")
        for row in rows or []:
            lines.extend([f"ROW: {row['occurrence']}", f"DATE: {row['charge_date']}",
                          f"DETAIL: {row['descriptor']}", f"AMOUNT: {row['amount']}"])
        content = content or document_storage._memo_pdf(lines)
        digest = hashlib.sha256(content).hexdigest()
        metadata = {"fixture_id": marker + "-" + name, "document_type": kind, "label_th": "เอกสารสังเคราะห์ทดสอบ API",
                    "sha256": digest, "byte_size": len(content), "mime": "application/pdf", "filename": "synthetic.pdf",
                    "page_count": 1, "storage_key": ("memo" if fields else "statement") + "/sha256/" + digest + ".pdf",
                    "pipeline_version": "hub-document-local-v1"}
        truth = {"fields": fields} if fields else {"rows": rows, "controls": controls}
        await connection.fetchval("SELECT ads.archive_register_fixture($1::jsonb,$2::jsonb)", metadata, truth)
        fixtures[name] = {"metadata": metadata, "content": content, "truth": truth}

    async def seed():
        await connection.execute("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true)")
        memo_no = await connection.fetchval("SELECT 'MO9912'||n::text FROM generate_series(900,999) n WHERE NOT EXISTS(SELECT 1 FROM ads.memo_identifier WHERE identifier='MO9912'||n::text) LIMIT 1")
        assert memo_no
        fields = {"memo_no": memo_no, "subject": "Synthetic API evidence " + marker, "requesting_bud": "C1",
                  "gross_amount": "12000.01", "mirrored_status": "APPROVED", "approval_date": "2026-10-01",
                  "period_start": "2026-10-01", "period_end": "2026-10-31"}
        await register("memo-one", "E_MEMO", fields=fields)
        await register("memo-two", "E_MEMO", fields={**fields, "subject": fields["subject"] + " revised"})
        rows = [{"page": 1, "occurrence": number, "charge_date": "2026-10-03", "descriptor": description,
                 "amount": amount, "cost_type": "MEDIA", "payment_method": "CORPORATE_CARD"}
                for number, description, amount in ((1, "GOOGLE SYNTHETIC CHARGE", "20.00"), (2, "GOOGLE SYNTHETIC REFUND", "-5.00"))]
        controls = {"issuer": "SYNTHETIC", "cycle_start": "2026-10-01", "cycle_end": "2026-10-31", "due_date": "2026-11-15",
                    "statement_total": "15.00", "meaning": "NET_CHARGES", "page_counts": [{"page": 1, "count": 2}]}
        await register("statement-one", "CARD_STATEMENT", rows=rows, controls=controls)
        await register("statement-two", "CARD_STATEMENT", rows=rows, controls=controls)
        for version in (1, 2):
            raster = Image.new("RGB", (480, 640), (230, 240, 220 + version))
            ImageDraw.Draw(raster).text((20, 40), "SYNTHETIC SOURCE " + marker + f" VERSION {version}", fill="black")
            output = io.BytesIO()
            raster.save(output, format="PDF", resolution=72)
            await register(f"raster-{version}", "CARD_STATEMENT", rows=rows, controls=controls, content=output.getvalue())
        corporate = await connection.fetchval("SELECT 'M.COM'||n::text||'_99' FROM generate_series(900,999) n WHERE NOT EXISTS(SELECT 1 FROM ads.memo_identifier WHERE identifier='M.COM'||n::text||'_99' OR identifier='M.COM'||n::text||'/99') LIMIT 1")
        assert corporate
        await register("memo-alias", "E_MEMO", fields={**fields, "memo_no": corporate.replace("_", "/"),
            "subject": "Synthetic corporate alias " + marker, "requesting_bud": "SID"})

    @asynccontextmanager
    async def database(request, actor, *, audit_only=False):
        async with connection.transaction():
            await connection.execute("SET LOCAL ROLE hub_app" if audit_only else f"SET LOCAL ROLE {actor.role}")
            await connection.execute("SELECT set_config('app.actor_id',$1,true)", str(actor.id))
            yield connection

    @asynccontextmanager
    async def lifespan(app):
        nonlocal connection, outer, before
        connection = await asyncpg.connect(**target, user="postgres", password=config["adminPassword"], timeout=10)
        try:
            observed = await connection.fetchrow("SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port")
            assert all(observed[key] == value for key, value in target.items())
            await main.initialize_connection(connection)
            before = await counts()
            outer = connection.transaction()
            await outer.start()
            await seed()
            yield
        finally:
            if outer:
                await outer.rollback()
                assert await counts() == before
            await connection.close()

    def read_document(key, digest):
        fixture = next(item for item in fixtures.values() if item["metadata"]["storage_key"] == key)
        assert hashlib.sha256(fixture["content"]).hexdigest() == digest
        return fixture["content"]

    monkeypatch.setattr(main, "database", database)
    monkeypatch.setattr(document_storage, "read_document", read_document)
    app = main.create_app(settings)
    app.router.lifespan_context = lifespan
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        base = "/v1/admin/ads/archive"

        def request(method, path, body=None, role="online_staff", status=200):
            response = client.request(method, path, headers={"Authorization": "Bearer " + tokens[role]}, json=body)
            assert response.status_code == status, response.text
            assert "storage_key" not in response.text
            return response.json().get("data")

        def get(doc): return request("GET", base + "/" + doc["id"])

        def identity(doc, with_job=True):
            result = {"expected_revision": doc["revision"], "expected_version_id": doc["current_version_id"]}
            if with_job: result["expected_job_id"] = doc["job"]["id"]
            return result

        async def worker(doc, broken=False):
            # Only this test's job is prioritized; no existing queue record is changed.
            await connection.execute("RESET ROLE")
            await connection.execute("UPDATE ads.archive_job SET created_at='1900-01-01' WHERE id=$1", UUID(doc["job"]["id"]))
            async with connection.transaction():
                await connection.execute("SET LOCAL ROLE admin")
                await connection.execute("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true)")
                claimed = await connection.fetchval("SELECT ads.archive_claim('synthetic-api-test',120)")
                assert claimed["document_id"] == doc["id"] and "truth" not in claimed
                content = read_document(claimed["storage_key"], claimed["sha256"])
                result = extract_document(content, claimed["document_type"], job_id=claimed["job_id"])
                if broken: result["rows"].pop()
                return await connection.fetchval("SELECT ads.archive_finish($1,$2,$3::jsonb)", UUID(claimed["job_id"]), UUID(claimed["lease_token"]), result)

        def finish(doc, broken=False):
            client.portal.call(worker, doc, broken)
            return get(doc)

        def confirm(doc, corrected=None, status=200):
            return request("POST", base + "/" + doc["id"] + "/confirm", {**identity(doc),
                "corrected_result": corrected or doc["extraction"]["original_result"], "evidence": "ตรวจหลักฐานสังเคราะห์ทุกหน้าแล้ว"}, status=status)

        def application(doc, mode, **extra):
            return {**identity(doc), "mode": mode, "reason": "นำหลักฐานตัวอย่างไปเชื่อมรายการ P2", "request_id": str(uuid4()), **extra}

        # HTTP denials persist in a separate audit transaction, without querying private content.
        for role in ("agency_kin", "publisher", "viewer", "editor", "service_consumer"):
            request("GET", base, role=role, status=403)
        memo = request("POST", base, {"fixture_id": fixtures["memo-one"]["metadata"]["fixture_id"]}, status=201)
        assert memo["receipt_status"] == "CREATED" and memo["job"]["status"] == "QUEUED"
        duplicate = request("POST", base, {"fixture_id": fixtures["memo-one"]["metadata"]["fixture_id"]}, status=201)
        assert duplicate["receipt_status"] == "NOOP" and duplicate["current_version_id"] == memo["current_version_id"]
        request("POST", base + "/" + memo["id"] + "/apply", application(memo, "MEMO_CREATE"), status=422)
        memo = finish(memo)
        assert memo["extraction"]["validation"]["valid"] and memo["job"]["status"] == "DRAFT"
        changed = deepcopy(memo["extraction"]["original_result"])
        changed["pages"][0]["text"] = "Forged replacement page"
        confirm(memo, changed, status=422)
        memo = confirm(memo)
        assert memo["job"]["status"] == "CONFIRMED" and memo["application"] is None
        assert request("GET", base + "/search?q=" + marker)["items"] == []  # No P2 link yet.
        payload = application(memo, "MEMO_CREATE")
        memo = request("POST", base + "/" + memo["id"] + "/apply", payload)
        target_memo = request("GET", "/v1/admin/ads/memos/" + memo["application"]["target_id"])
        assert target_memo["record_status"] == "DRAFT"  # Transcription never approves/financially confirms a memo.
        assert target_memo["gross_amount"] == "12000.01"
        replay = request("POST", base + "/" + memo["id"] + "/apply", payload)
        assert replay["operation_status"] == "NOOP" and replay["application"]["id"] == memo["application"]["id"]
        request("POST", base + "/" + memo["id"] + "/apply", {**payload, "request_id": str(uuid4())}, status=409)
        search = request("GET", base + "/search?q=" + marker)
        assert len(search["items"]) == 1 and search["items"][0]["gross_amount"] == "12000.01"
        assert search["items"][0]["version_id"] == memo["current_version_id"] and search["items"][0]["page"] == 1

        # New version immediately removes the previous confirmed version from current search.
        old = memo
        memo = request("POST", base, {"fixture_id": fixtures["memo-two"]["metadata"]["fixture_id"],
            "document_id": memo["id"], "expected_revision": memo["revision"]}, status=201)
        assert request("GET", base + "/search?q=" + marker)["items"] == []
        request("POST", base + "/" + memo["id"] + "/apply", payload, status=409)
        file = client.get(base + "/" + memo["id"] + "/file?version_id=" + old["current_version_id"],
            headers={"Authorization": "Bearer " + tokens["online_staff"], "Range": "bytes=0-7"})
        assert file.status_code == 206 and file.content == fixtures["memo-one"]["content"][:8]
        memo = finish(memo)
        memo = confirm(memo)
        memo = request("POST", base + "/" + memo["id"] + "/apply", application(memo, "MEMO_UPDATE",
            target_id=target_memo["id"], expected_target_version=target_memo["row_version"]))
        assert memo["application"]["target_id"] == target_memo["id"]

        # Missing refund fails controls and cannot create a financial record.
        statement = request("POST", base, {"fixture_id": fixtures["statement-one"]["metadata"]["fixture_id"]}, status=201)
        statement = finish(statement, broken=True)
        assert not statement["extraction"]["validation"]["valid"]
        confirm(statement, status=422)
        corrected = deepcopy(statement["extraction"]["original_result"])
        corrected["rows"] = fixtures["statement-one"]["truth"]["rows"]
        corrected["controls"] = fixtures["statement-one"]["truth"]["controls"]
        statement = confirm(statement, corrected)
        payload = application(statement, "CARD_CREATE")
        statement = request("POST", base + "/" + statement["id"] + "/apply", payload)
        batch_id = statement["application"]["target_id"]
        batch = request("GET", "/v1/admin/ads/card-imports/" + batch_id)
        assert batch["status"] == "APPLIED_DRAFT" and batch["net_total"] == "15.00"
        request("POST", base + "/" + statement["id"] + "/apply", payload)
        async def cost_count():
            await connection.execute("RESET ROLE")
            return await connection.fetchval("SELECT count(*) FROM ads.cost_record c JOIN staging.ads_card_row r ON r.id=c.source_row_id WHERE r.batch_id=$1", UUID(batch_id))
        costs = client.portal.call(cost_count)
        linked = request("POST", base, {"fixture_id": fixtures["statement-two"]["metadata"]["fixture_id"],
            "document_id": statement["id"], "expected_revision": statement["revision"]}, status=201)
        linked = confirm(finish(linked))
        request("POST", base + "/" + linked["id"] + "/apply", application(linked, "CARD_CREATE"), status=409)
        linked = request("POST", base + "/" + linked["id"] + "/apply", application(linked, "LINK_CARD",
            target_id=batch_id, expected_target_version=batch["row_version"]))
        assert linked["application"]["target_id"] == batch_id and client.portal.call(cost_count) == costs
        assert request("GET", base + "/search?q=GOOGLE")["items"] == []
        held = request("POST", base + "/" + linked["id"] + "/hold", {
            "expected_revision": linked["revision"], "held": True, "reason": "เก็บรักษาตามคำสั่งทดสอบ"}, role="admin")
        assert held["legal_hold"]
        request("POST", base, {"fixture_id": fixtures["statement-two"]["metadata"]["fixture_id"]}, status=422)

        # A slash spelling is neither automatically merged nor treated as an approved alias.
        alias_fields = fixtures["memo-alias"]["truth"]["fields"]
        canonical = request("POST", "/v1/admin/ads/memos", {
            **{key: alias_fields[key] for key in ("subject", "requesting_bud", "gross_amount", "mirrored_status", "approval_date")},
            "memo_no": alias_fields["memo_no"].replace("/", "_"), "evidence_ref": "SYNTHETIC-API-ALIAS"}, status=201)
        aliased = request("POST", base, {"fixture_id": fixtures["memo-alias"]["metadata"]["fixture_id"]}, status=201)
        aliased = confirm(finish(aliased))
        alias_payload = application(aliased, "LINK_MEMO", target_id=canonical["id"], expected_target_version=canonical["row_version"])
        request("POST", base + "/" + aliased["id"] + "/apply", alias_payload, status=422)
        proposed = request("POST", "/v1/admin/ads/memo-identifiers", {"memo_id": canonical["id"], "identifier": alias_fields["memo_no"],
            "reason": "เสนอรูปแบบเครื่องหมายจากหลักฐานสังเคราะห์", "evidence_ref": "SYNTHETIC-API-ALIAS"}, status=201)
        request("POST", base + "/" + aliased["id"] + "/apply", alias_payload, status=422)
        request("POST", "/v1/admin/ads/memo-identifiers/" + proposed["id"] + "/review", {
            "expected_version": proposed["row_version"], "decision": "APPROVE", "reason": "ตรวจว่าคือเลขรายการเดียวกันแล้ว"}, role="admin")
        aliased = request("POST", base + "/" + aliased["id"] + "/apply", alias_payload)
        assert aliased["application"]["target_id"] == canonical["id"]
        alias_search = request("GET", base + "/search?q=" + alias_fields["memo_no"])
        assert alias_search["items"][0]["memo_no"] == canonical["memo_no"]
        assert alias_search["items"][0]["matched_identifier"] == alias_fields["memo_no"]

        # PNG uses the exact decoded raster of the requested immutable PDF version.
        raster = request("POST", base, {"fixture_id": fixtures["raster-1"]["metadata"]["fixture_id"]}, status=201)
        old_raster = raster["current_version_id"]
        raster = request("POST", base, {"fixture_id": fixtures["raster-2"]["metadata"]["fixture_id"],
            "document_id": raster["id"], "expected_revision": raster["revision"]}, status=201)
        image_path = base + "/" + raster["id"] + "/page?version_id=" + old_raster + "&page=1"
        request("GET", image_path, role="agency_kin", status=403)
        request("GET", image_path.replace(old_raster, memo["current_version_id"]), status=404)
        request("GET", image_path.replace("page=1", "page=2"), status=404)
        preview = client.get(image_path, headers={"Authorization": "Bearer " + tokens["online_staff"]})
        assert preview.status_code == 200 and preview.headers["content-type"] == "image/png"
        assert preview.headers["x-frame-options"] == "DENY" and "sandbox" in preview.headers["content-security-policy"]
        source = PdfReader(io.BytesIO(fixtures["raster-1"]["content"])).pages[0].images[0].image.convert("RGB")
        with Image.open(io.BytesIO(preview.content)) as rendered:
            assert rendered.size == source.size and rendered.convert("RGB").tobytes() == source.tobytes()
        async def audit_check():
            await connection.execute("RESET ROLE")
            rows = await connection.fetch("SELECT action,outcome,original_role,bytes FROM audit.archive_access WHERE recorded_at>=transaction_timestamp()")
            assert any(row["original_role"] == "agency" and row["outcome"] == "DENIED" for row in rows)
            assert any(row["action"] == "PREVIEW" and row["outcome"] == "PARTIAL" and row["bytes"] == 8 for row in rows)
            assert any(row["action"] == "PREVIEW" and row["outcome"] == "SERVED" and row["bytes"] == len(preview.content) for row in rows)
        client.portal.call(audit_check)
