"""Opt-in real SQL evidence for all thirteen readers; one outer local rollback.

No provider calls, REM/DW writes, or live-model quality claim. Synthetic financial
and publication records exercise available branches, not only empty results.
"""
import asyncio
from content_workflow_fixture import approve_entity, publication_persona

from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID, uuid4

import pytest
from starlette.exceptions import HTTPException
from starlette.requests import Request

from sena_hub_api.auth import Actor
from sena_hub_api.assistant_tools import TOOL_INPUTS, ToolReader
from sena_hub_api.actuals_import import validate_package
from sena_hub_api.document_worker import local_connection


def values(result):
    return {fact["field"]: fact["value"] for fact in result["facts"]}


@pytest.mark.integration
@pytest.mark.skipif(os.getenv("HUB_ASSISTANT_TEST") != "1", reason="Set HUB_ASSISTANT_TEST=1 for rollback-only local TEST readers")
def test_all_thirteen_readers_real_rls_exact_evidence_and_domain_boundaries():
    async def run():
        async with local_connection() as db:
            account_ids = {role: uuid4() for role in ('admin', 'editor', 'publisher', 'viewer', 'online_staff', 'agency', 'service_consumer')}
            actor_id = account_ids['admin']
            actor = Actor(actor_id, "admin")
            marker = "SYNTHETIC-ASSISTANT-READERS-" + uuid4().hex
            request = Request({"type": "http", "method": "POST", "scheme": "http", "server": ("localhost", 8000),
                               "path": "/v1/admin/assistant/runs", "query_string": b"", "headers": []})
            tables = ("hub.projects", "hub.entity_versions", "hub.public_promotions", "hub.promotion_versions",
                      "ads.campaign_registration", "ads.memo", "ads.media_line", "ads.line_assignment",
                      "ads.archive_confirmation", "ads.archive_application", "ads.archive_memo_chunk",
                      "audit.archive_access", "staging.ads_actuals_batch", "hub.user_account")

            async def counts():
                await db.execute("RESET ROLE")
                return {table: await db.fetchval("SELECT count(*) FROM " + table) for table in tables}

            @asynccontextmanager
            async def caller_database(_request, calling_actor, *, audit_only=False):
                prior = await db.fetchval("SELECT current_setting('role')")
                try:
                    async with db.transaction():
                        assert calling_actor.role in {"admin", "online_staff", "editor", "publisher", "viewer", "agency", "service_consumer"}
                        await db.execute("SET LOCAL SESSION AUTHORIZATION hub_runtime")
                        await db.execute("SET LOCAL ROLE hub_app")
                        assert await db.fetchval('select session_user') == 'hub_runtime'
                        assert not await db.fetchval('select rolsuper or rolbypassrls from pg_roles where rolname=current_user')
                        await db.execute("SELECT set_config('app.actor_id',$1,true)", str(calling_actor.id))
                        await db.execute("SELECT set_config('app.agency_code','',true)")
                        yield db
                finally:
                    # Restore only after SAVEPOINT rollback, preserving the original SQL error.
                    if not db.is_closed():
                        await db.execute("RESET ROLE")
                        await db.execute("RESET SESSION AUTHORIZATION")
                        await db.execute("RESET ROLE" if prior == "none" else f"SET LOCAL ROLE {prior}")

            async def rpc(sql, *args, role="admin"):
                async with caller_database(request, Actor(account_ids[role], role)):
                    return await db.fetchval(sql, *args)

            async def finance(action, payload):
                return await rpc("SELECT ads.finance_command($1,$2::jsonb)", action, payload)

            before = await counts()
            current = await db.fetchrow("SELECT b.manifest,b.relations FROM staging.ads_actuals_current c JOIN staging.ads_actuals_batch b ON b.id=c.batch_id")
            assert current, "Seed the frozen P3 TEST package before this opt-in suite"
            snapshot_before = current["manifest"]["snapshot_id"]
            outer = db.transaction()
            await outer.start()
            try:
                for role, identity in account_ids.items():
                    await db.execute("""insert into hub.user_account(id,email,status,hub_role,agency_code)
                        values($1,$2,'ACTIVE',$3,$4)""", identity, f'{identity}@example.test', role, 'KIN' if role == 'agency' else None)
                await db.execute("SELECT set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", str(actor_id), marker)
                project = await db.fetchrow("SELECT * FROM hub.projects WHERE rem_project_id='DEMO-001' AND deleted_at IS NULL")
                assert project, "The synthetic local DEMO-001 seed is required"
                brand = await db.fetchrow("SELECT * FROM hub.brands WHERE id=$1", project["brand_id"])
                assert brand and brand["rem_brand_id"] == "DEMO-BRAND-01"
                project_id, brand_id = project["public_project_id"], brand["public_brand_id"]
                detail = await rpc("SELECT hub.project_detail($1)", project_id)
                assert detail["readiness"]["ready"], "Synthetic DEMO-001 must satisfy the unchanged normal publication gates"
                await publication_persona(account_ids, operator=db)
                await approve_entity(db, account_ids, 'project', project['id'])
                published_version = await rpc("SELECT hub.publish_project($1,$2)", project["id"], marker, role="viewer")
                promo = await rpc("SELECT hub.promotion_command('create',NULL,$1::jsonb)", {
                    "project_id": str(project["id"]), "code": "READERS-" + uuid4().hex.upper(),
                    **{key: {"th": text} for key, text in {
                        "title": "สิทธิประโยชน์สังเคราะห์", "summary": "ใช้ทดสอบภายในเท่านั้น",
                        "conditions_public": "ไม่มีสิทธิ์ใช้จริง", "legal_terms": "ไม่ใช่ข้อเสนอขาย",
                        "disclaimer": "ข้อมูลสังเคราะห์สำหรับทดสอบเท่านั้น"}.items()},
                    "benefit_type": "cashback", "benefit_value": "12.34", "benefit_unit": "THB",
                    "stackable": True, "priority": 0, "starts_at": "2020-01-01T00:00:00+07:00", "ends_at": "2099-01-01T00:00:00+07:00"})
                for review in ("DATA", "LEGAL"):
                    await rpc("SELECT hub.promotion_command('review',$1,$2::jsonb)", UUID(promo["id"]), {
                        "expected_revision": 1, "review_revision": 1, "review_type": review,
                        "decision": "APPROVED", "evidence": marker, "change_reason": marker}, role="publisher")
                await rpc("SELECT hub.promotion_command('publish',$1,$2::jsonb)", UUID(promo["id"]), {
                    "expected_revision": 1, "expected_published_version_id": None, "change_reason": marker}, role="viewer")

                # Guarded P1/P2 fixture: exact phase source ID, one current typed monthly line.
                scope = UUID("30000000-0000-0000-0000-000000000001")
                memo_no = await db.fetchval("SELECT 'MO9911'||n::text FROM generate_series(900,999) n WHERE NOT EXISTS(SELECT 1 FROM ads.memo_identifier WHERE identifier='MO9911'||n::text) LIMIT 1")
                memo = await finance("memo_create", {"memo_no": memo_no, "subject": marker, "requesting_bud": "C1",
                    "gross_amount": "100.00", "mirrored_status": "APPROVED", "approval_date": "2026-10-01", "evidence_ref": marker})
                memo = await finance("memo_confirm", {"id": memo["id"], "expected_version": memo["row_version"]})
                month = await db.fetchval("SELECT make_date(n,11,1)::text FROM generate_series(4000,4500) n WHERE NOT EXISTS(SELECT 1 FROM ads.media_line WHERE scope_id=$1 AND month=make_date(n,11,1) AND agency='KIN') LIMIT 1", scope)
                parts = [{"component_kind": "PHASE", "rem_project_id": "00001", "formatted_mapping": "C-DEMO-TEST1",
                    "bud": "C1", "gross_amount": "100.00", "memo_id": memo["id"], "fee_po_ref": marker,
                    "budget_items": [{"cost_type": "MEDIA", "payment_method": "AGENCY_PO_INVOICE", "amount": "100.00"}]}]
                line = await finance("line_create", {"kind": "GROUP", "scope_id": str(scope), "month": month,
                    "agency": "KIN", "reason": marker, "components": parts})
                line = await finance("revision_confirm", {"id": line["id"], "revision_id": line["revisions"][0]["id"],
                    "expected_revision_id": None, "acknowledgements": []})
                issued = await rpc("SELECT ads.issue_registration($1,'LEADS','KIN')", scope)
                code, frozen_name = issued["registration"]["code"], issued["names"][0]["frozen_name"]
                account_id, campaign_id = "000-READER-ACCOUNT-" + uuid4().hex, "000-READER-CAMPAIGN-" + uuid4().hex
                binding = await rpc("SELECT ads.bind_native($1,$2,'GOOGLE',$3,$4)", code, UUID(issued["names"][0]["name_id"]), account_id, campaign_id)
                assignment = await finance("assignment_create", {"code": code, "month": month, "line_id": line["id"],
                    "expected_revision_id": line["current_revision_id"]})

                # Full snapshot fixture: preserve every prior identity, add one coherent synthetic line.
                manifest, relations = deepcopy(current["manifest"]), deepcopy(current["relations"])
                stamp = max(datetime.now(timezone.utc), datetime.fromisoformat(manifest["snapshot_at"]) + timedelta(seconds=1)).isoformat()
                snapshot = str(uuid4())
                manifest.update(snapshot_id=snapshot, snapshot_at=stamp, exported_at=stamp)
                for rows in relations.values():
                    for row in rows: row.update(snapshot_id=snapshot, snapshot_at=stamp)
                revision = next(row for row in line["revisions"] if row["id"] == line["current_revision_id"])
                components = []
                for part in revision["components"]:
                    components.append({"component_id": part["id"], **{field: part.get(field) for field in ("component_kind", "rem_project_id", "formatted_mapping", "bud", "memo_id", "fee_po_ref")},
                        **{field: None if part.get(field) is None else f"{Decimal(str(part[field])):.2f}" for field in ("gross_amount", "media_amount", "fee_amount")},
                        "budget_items": [{"id": item["id"], "cost_type": item["cost_type"], "payment_method": item["payment_method"], "amount": f"{Decimal(str(item['amount'])):.2f}"} for item in part["budget_items"]]})
                components.sort(key=lambda item: item["component_id"])
                dim = deepcopy(next(row for row in relations["dim_media_line"] if row["kind"] == "GROUP" and row["is_applicable"]))
                dim.update(line_key=line["id"], hub_line_id=line["id"], revision_key=revision["id"], hub_revision_id=revision["id"],
                    revision_no=1, month=month, scope_id=str(scope), scope_code="C-DEMO-TEST1", agency="KIN", components=components,
                    approved_gross="100.00", approved_media="100.00", approved_fee="0.00", typed_budget_complete=True, quality_codes=[])
                relations["dim_media_line"].append(dim)
                monthly = deepcopy(relations["fact_media_line_monthly"][0])
                cash = [{"cost_type": "MEDIA", "payment_method": "CORPORATE_CARD", "amount": "15.25", "cost_count": 1},
                        {"cost_type": "CHANNEL", "payment_method": "CORPORATE_CARD", "amount": "-2.25", "cost_count": 1}]
                recognition = [{"cost_type": "TOOL", "payment_method": "CORPORATE_CARD", "amount": "1.00", "cost_count": 1}]
                monthly.update(line_key=line["id"], revision_key=revision["id"], month=month, budget_basis="MONTH",
                    approved_month_gross="100.00", approved_month_media="100.00", typed_budget_complete=True,
                    platform_media_spend="25.00", attributed_leads=2, media_cpl="12.50", media_budget_used_pct="25.00",
                    comparison_reason=None, campaign_count=1, unresolved_context_count=0, financial_components=components,
                    card_cash_by_type=cash, card_monthly_by_type=recognition, quality_codes=[])
                relations["fact_media_line_monthly"].append(monthly)
                bridge = deepcopy(next(row for row in relations["bridge_native_campaign_media_line"] if row["match_method"] != "UNRESOLVED"))
                bridge.update(platform="GOOGLE", account_id=account_id, campaign_id=campaign_id, month=month,
                    line_key=line["id"], revision_key=revision["id"], observed_code=code, observed_name=frozen_name,
                    registration_code=code, name_id=issued["names"][0]["name_id"], scope_id=str(scope), agency="KIN",
                    match_method="HUB_NATIVE_ID", candidate_method="HUB_NATIVE_ID", assignment_id=assignment["id"],
                    binding_name_id=binding["name_id"], correction_target_id=None, candidate_line_keys=[line["id"]],
                    conflict_codes=[], unresolved_reason=None)
                relations["bridge_native_campaign_media_line"].append(bridge)
                controls = manifest["control_totals"]
                controls["platform_resolved"] = f"{sum(Decimal(row['platform_media_spend']) for row in relations['fact_media_line_monthly'] if row['platform_media_spend'] is not None):.2f}"
                for key, field in (("card_cash", "card_cash_by_type"), ("card_monthly", "card_monthly_by_type")):
                    controls[key]["assigned"] = f"{sum(Decimal(item['amount']) for row in relations['fact_media_line_monthly'] for item in row[field]):.2f}"
                for basis in controls["coverage_by_basis"].values():
                    covered = sorted(set(basis["covered_months"] + [month]))
                    basis.update(covered_months=covered, covered_month_from=covered[0], covered_month_to=covered[-1])
                manifest["covered_month_to"] = max(manifest["covered_month_to"], month)
                with TemporaryDirectory(prefix="hub-assistant-readers-") as temporary:
                    directory = Path(temporary)
                    for entry in manifest["relations"]:
                        raw = json.dumps(relations[entry["relation"]], ensure_ascii=False).encode("utf-8")
                        (directory / entry["file"]).write_bytes(raw)
                        entry.update(row_count=len(relations[entry["relation"]]), file_sha256=hashlib.sha256(raw).hexdigest(), snapshot_at=stamp)
                    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
                    package = validate_package(directory)
                await db.execute("RESET ROLE")
                await db.execute("SELECT set_config('app.actor_id',$1,true)", str(actor_id))
                applied = await db.fetchval("SELECT ads.apply_ads_actuals($1,$2,$3,$4)", package.manifest, package.relations, package.fingerprint, snapshot_before)
                assert applied["status"] == "APPLIED", applied

                # Existing synthetic TEXT fixture, confirmed and linked only inside this rollback.
                document_id = await db.fetchval("SELECT d.id FROM ads.archive_document d JOIN ads.archive_version v ON v.id=d.current_version_id WHERE v.fixture_id='memo-hyabc-v1'")
                assert document_id, "Run the local synthetic document seed/worker before this opt-in suite"
                document = await rpc("SELECT ads.archive_read($1)", document_id)
                if document["job"]["status"] == "DRAFT":
                    document = await rpc("SELECT ads.archive_command('confirm',$1,$2::jsonb)", document_id, {
                        "expected_revision": document["revision"], "expected_version_id": document["current_version_id"], "expected_job_id": document["job"]["id"],
                        "corrected_result": document["extraction"]["original_result"], "evidence": marker})
                if not document.get("application"):
                    document = await rpc("SELECT ads.archive_command('apply',$1,$2::jsonb)", document_id, {
                        "expected_revision": document["revision"], "expected_version_id": document["current_version_id"], "expected_job_id": document["job"]["id"],
                        "mode": "MEMO_CREATE", "reason": marker, "request_id": str(uuid4())})
                archive_memo = document["confirmation"]["corrected_result"]["fields"]["memo_no"]
                reader = ToolReader(request, actor, caller_database)
                cases = {
                    "get_project": {"project_id": project_id}, "find_projects": {"query": project_id},
                    "get_models": {"project_id": project_id}, "get_brand": {"brand_id": brand_id},
                    "check_publish_readiness": {"entity_type": "project", "entity_id": project_id},
                    "search_content": {"project_id": project_id, "query": "ข้อมูล"},
                    "get_promotions": {"project_id": project_id}, "get_project_marketing": {"rem_project_id": "00001", "month": month},
                    "get_campaign": {"code_or_name": code}, "find_campaigns": {"query": code, "month": month, "memo_no": memo_no, "fee_po_ref": marker},
                    "get_line_actuals": {"line_id": line["id"], "month": month}, "explain_name": {"name": frozen_name},
                    "search_documents": {"query": archive_memo},
                }
                assert set(cases) == set(TOOL_INPUTS)
                results = {}
                for name, arguments in cases.items():
                    result = await reader.invoke(name, arguments)
                    assert result["status"] == "OK" and result["facts"] and result["sources"], (name, result)
                    assert {fact["source_id"] for fact in result["facts"]} <= {source["id"] for source in result["sources"]}, name
                    results[name] = result
                assert values(results["get_project"])["public_project_id"] == project_id
                assert values(results["find_projects"])["public_project_id"] == project_id
                model_values = values(results["get_models"])
                assert any(key.endswith(".bedrooms") and value is not None and Decimal(value) == 2 for key, value in model_values.items()), model_values
                assert any(key.endswith(".match_status") and value == "CONFIRMED" for key, value in model_values.items()), model_values
                assert values(results["get_brand"])["public_brand_id"] == brand_id
                assert values(results["check_publish_readiness"])["readiness.ready"] == "true"
                assert values(results["search_content"])["meta_description.th"] == detail["meta_description"]["th"]
                promo_source = next(source["id"] for source in results["get_promotions"]["sources"] if source["entity_id"] == promo["id"])
                promo_values = {fact["field"]: fact["value"] for fact in results["get_promotions"]["facts"] if fact["source_id"] == promo_source}
                assert Decimal(promo_values["benefit_value"]) == Decimal("12.34") and promo_values["legal_terms.th"] == "ไม่ใช่ข้อเสนอขาย" and promo_values["disclaimer.th"] == "ข้อมูลสังเคราะห์สำหรับทดสอบเท่านั้น"
                campaign = values(results["get_campaign"])
                assert campaign["agency"] == "KIN" and campaign["objective"] == "LEADS" and campaign["status"] == "REGISTERED"
                assert frozen_name in campaign.values() and account_id in campaign.values() and campaign_id in campaign.values()
                assert code in values(results["find_campaigns"]).values()
                actual = values(results["get_line_actuals"])
                assert {field: actual[field] for field in ("approved_month_media", "platform_media_spend", "media_cpl", "media_budget_used_pct")} == {
                    "approved_month_media": "100.00", "platform_media_spend": "25.00", "media_cpl": "12.50", "media_budget_used_pct": "25.00"}
                cash_facts = [fact for fact in results["get_line_actuals"]["facts"] if fact["field"].startswith("card_cash_by_type.")]
                monthly_facts = [fact for fact in results["get_line_actuals"]["facts"] if fact["field"].startswith("card_monthly_by_type.")]
                assert sorted(fact["value"] for fact in cash_facts) == ["-2.25", "15.25"] and [fact["value"] for fact in monthly_facts] == ["1.00"]
                assert any("CHANNEL" in fact["label_th"] for fact in cash_facts)
                assert "LINE OA (ยังไม่แยกบัญชี)" in results["get_line_actuals"]["message_th"]
                assert "25.00" in values(results["get_project_marketing"]).values()
                assert "ไม่ใช่ส่วนแบ่งค่าใช้จ่ายของเฟส" in results["get_project_marketing"]["message_th"]
                assert values(results["explain_name"])["template"] == "SENA-H" and values(results["explain_name"])["valid"] == "true"
                memo_values = values(results["search_documents"])
                assert memo_values["memo_no"] == archive_memo and memo_values["gross_amount"] == "12000.00" and memo_values["bud"] == "C1"
                assert all(source["entity_type"] == "memo" for source in results["search_documents"]["sources"])
                published = await reader.invoke("get_project", {"project_id": project_id, "visibility": "published", "version_id": str(published_version)})
                assert published["sources"][0]["version"] == str(published_version)
                assert published["sources"][0]["visibility"] == "PUBLISHED"
                # A retired assignment must not keep establishing memo/PO campaign context.
                await finance("assignment_end", {"id": assignment["id"], "expected_version": assignment["row_version"], "reason": marker})
                retired = await reader.invoke("find_campaigns", cases["find_campaigns"])
                assert retired["status"] == "UNAVAILABLE" and not retired["facts"]
                for role, tool in (("viewer", "get_line_actuals"), ("online_staff", "get_project"), ("agency", "get_campaign"), ("service_consumer", "get_project")):
                    with pytest.raises(HTTPException) as caught:
                        await ToolReader(request, Actor(account_ids[role], role), caller_database).invoke(tool, cases[tool])
                    assert caught.value.status_code == 403
                print("PASS: 13/13 real DB readers returned checked structured evidence; exact campaign/card/amount facts, source versions and domain denials verified. No model/network evaluation performed.")
            finally:
                await outer.rollback()
                assert await counts() == before
                assert await db.fetchval("SELECT b.snapshot_id FROM staging.ads_actuals_current c JOIN staging.ads_actuals_batch b ON b.id=c.batch_id") == snapshot_before
    asyncio.run(run())
