"""Staff-only, fact-rendered assistant streams and explicit draft proposal receipts."""
import asyncio
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
import time
from typing import Annotated, Literal
from urllib.parse import quote, urlparse
from uuid import UUID

import anyio
import asyncpg
from fastapi import Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import AwareDatetime, Field, StringConstraints, ValidationError, model_validator
from starlette.exceptions import HTTPException

from .auth import Actor, failure
from .provider_budget import spend_limit_code
from .provider_messages import MESSAGES
from .content_workflow import publication_targets
from .assistant_tools import Input, Identifier, Month, STAFF_ROLES, TOOL_SCHEMAS, TOOL_LABELS, TOOL_INPUTS, ToolReader, campaign_version, decode, finance_filters

BANGKOK = timezone(timedelta(hours=7), "Asia/Bangkok")


class Context(Input):
    project_id: Identifier | None = None
    brand_id: Identifier | None = None
    business_id: Annotated[str, StringConstraints(strict=True, pattern=r"^[a-z][a-z0-9_]{1,63}$")] | None = None
    rem_project_id: Identifier | None = None
    line_id: UUID | None = None
    month: Month | None = None
    code: Identifier | None = None
    name: Annotated[str, StringConstraints(max_length=300, pattern=r"^[^\x00]*$")] | None = None
    query: Annotated[str, StringConstraints(max_length=200, pattern=r"^[^\x00]*$")] | None = None
    visibility: Literal["draft", "published"] = "draft"

    @model_validator(mode="after")
    def one_scope(self):
        if sum(bool(getattr(self, key)) for key in ("project_id", "brand_id", "business_id", "rem_project_id", "line_id", "code", "name")) > 1:
            raise ValueError("กรุณาเลือกบริบทหลักเพียงหนึ่งรายการ")
        return self


class RunInput(Input):
    message: Annotated[str, StringConstraints(strict=True, max_length=2000, pattern=r"^[^\x00]*$")] = ""
    mode: Literal["fake", "live"] = "fake"
    golden_id: Literal["synthetic-project"] | None = None
    context: Context = Field(default_factory=Context)

    @model_validator(mode="after")
    def mode_input(self):
        if self.mode == "live" and (self.message or self.golden_id is None):
            raise ValueError("โหมดจริงใช้ได้เฉพาะคำถามข้อมูลสมมติที่กำหนด")
        if self.mode == "fake" and (not self.message.strip() or self.golden_id is not None):
            raise ValueError("กรุณาพิมพ์คำถามสำหรับโหมดสาธิต")
        return self


class Proposal(Input):
    entity_type: Literal["project", "brand"]
    entity_id: UUID
    field_path: Literal["meta_title.th", "meta_description.th", "description.th"]
    new_text: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=4000, pattern=r"^[^\x00]*$")]
    expected_updated_at: AwareDatetime
    rationale: Annotated[str, StringConstraints(strict=True, max_length=1000, pattern=r"^[^\x00]*$")] = ""
    run_id: UUID | None = None
    citations: list[UUID] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def allowed_field(self):
        if not self.new_text.strip() or (self.entity_type == "brand") != (self.field_path == "description.th"):
            raise ValueError("กรุณาระบุข้อความและฟิลด์ที่ตรงกับรายการ")
        return self


class ConfirmProposal(Input):
    digest: Annotated[str, StringConstraints(strict=True, pattern=r"^[0-9a-f]{64}$")]
    confirmed: Literal[True]

    @model_validator(mode="before")
    @classmethod
    def explicit_boolean(cls, value):
        if not isinstance(value, dict) or value.get("confirmed") is not True:
            raise ValueError("ต้องกดยืนยันบันทึกฉบับร่างอย่างชัดเจน")
        return value


class SuggestProposal(Input):
    entity_type: Literal["project", "brand"]
    entity_id: UUID
    field_path: Literal["meta_title.th", "meta_description.th", "description.th"]
    expected_updated_at: AwareDatetime

    @model_validator(mode="after")
    def allowed_field(self):
        if (self.entity_type == "brand") != (self.field_path == "description.th"):
            raise ValueError("กรุณาระบุฟิลด์ที่ตรงกับรายการ")
        return self


def selected_facts(selection, facts):
    ids = selection.get("fact_ids")
    if not isinstance(ids, list) or len(ids) > 40 or any(not isinstance(key, str) for key in ids) or len(set(ids)) != len(ids) or any(key not in facts for key in ids):
        raise ValueError("Unverified fact selection")
    return [facts[key] for key in ids]


def fact_text(fact):
    value = fact["value"]
    if fact["availability"] != "AVAILABLE" or value is None:
        shown = "ยังไม่มีข้อมูลที่ยืนยันได้"
    elif fact["type"] in {"money", "number", "percent"}:
        number = Decimal(value)
        if not number.is_finite(): raise ValueError("Invalid numeric fact")
        shown = format(number, ",.2f") if fact["type"] == "money" else format(number, ",f")
    elif fact["type"] == "status" and value in {"true", "false"}:
        shown = "ใช่" if value == "true" else "ไม่ใช่"
    elif fact["type"] == "date" and "T" in value:
        shown = datetime.fromisoformat(value).astimezone(BANGKOK).strftime("%d/%m/%Y %H:%M") + " น. (กรุงเทพฯ)"
    else:
        shown = value
    marker = " (ข้อมูลตัวอย่าง)" if fact.get("synthetic") else ""
    return f"{fact['label_th']}{marker}: {shown}" + (f" {fact['unit']}" if value is not None and fact.get("unit") else "")


def register_assistant_routes(app, authentication, database, settings):
    prefix = "/v1/admin/assistant"
    active = {}

    async def staff(request: Request):
        target = urlparse(settings.database_url)
        if settings.environment != "local" or target.hostname != "127.0.0.1" or target.port != 55432 or target.path != "/sena_hub_local":
            raise failure(403, "assistant_local_only", "ผู้ช่วยชุดสาธิตเปิดเฉพาะระบบทดสอบภายในเครื่อง")
        actor = await authentication(request)
        if actor.role not in STAFF_ROLES:
            raise failure(403, "assistant_forbidden", "ผู้ช่วยเปิดเฉพาะบัญชีทีมงานภายใน")
        if request.query_params:
            raise failure(422, "assistant_invalid_query", "เส้นทางนี้ไม่รองรับตัวกรองเพิ่มเติม")
        return actor

    @asynccontextmanager
    async def connection(request, actor):
        try:
            async with database(request, actor) as db:
                yield db
        except asyncpg.PostgresError as error:
            cases = {"42501": (403, "assistant_forbidden", "ไม่มีสิทธิ์ดำเนินการนี้"),
                     "P0002": (404, "assistant_not_found", "ไม่พบรายการที่คุณเข้าถึงได้"),
                     "40001": (409, "assistant_stale", "ข้อมูลเปลี่ยนแล้ว กรุณาตรวจข้อเสนอใหม่"),
                     "22023": (422, "assistant_invalid", "ข้อมูลไม่ตรงกับเงื่อนไขที่กำหนด"),
                     "23514": (422, "assistant_invalid", "ข้อมูลไม่ตรงกับเงื่อนไขที่กำหนด"),
                     "22P02": (422, "assistant_invalid", "รูปแบบรหัสไม่ถูกต้อง")}
            if error.sqlstate in cases: raise failure(*cases[error.sqlstate]) from None
            raise

    async def rpc(request, actor, sql, *args):
        async with connection(request, actor) as db:
            return decode(await db.fetchval(sql, *args))

    @app.get(prefix + "/config")
    async def config(request: Request, actor: Actor = Depends(staff)):
        from .assistant_model import model_configuration
        provider = model_configuration()
        access = await ToolReader(request, actor, database).access()
        fields = access["proposal_fields"]
        return {"data": {"session_key": hashlib.sha256(f"{access['fingerprint']}:{provider['config_version']}".encode()).hexdigest(),
            "mode": "fake", "live_available": provider["live_available"] and "get_project" in access["allowed_tools"],
            "allowed_tools": access["allowed_tools"], "proposal_fields": fields,
            "message_th": "ยังไม่ได้ตั้งค่าโมเดลจริง ใช้ข้อมูลสาธิต" if not provider["live_available"] else "โหมดจริงใช้ได้เฉพาะคำถามข้อมูลสมมติที่กำหนด",
            "live_questions": [{"id": item["id"], "label_th": item["label_th"]} for item in provider["golden_questions"]],
            "pending_question_ids": ["Q36", "Q38", "Q42", "Q43", "Q44"]}}

    @app.get(prefix + "/runs/{run_id}")
    async def get_run(run_id: UUID, request: Request, actor: Actor = Depends(staff)):
        return {"data": await rpc(request, actor, "SELECT internal.assistant_run_read($1)::text", run_id)}

    @app.post(prefix + "/runs/{run_id}/cancel")
    async def cancel(run_id: UUID, request: Request, actor: Actor = Depends(staff)):
        row = await rpc(request, actor, "SELECT internal.assistant_run_read($1)::text", run_id)
        task = active.get(str(run_id))
        if task and row["status"] == "RUNNING":
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        return {"data": await rpc(request, actor, "SELECT internal.assistant_run_read($1)::text", run_id)}

    async def citation_source(request, actor, source, run_id):
        reader = ToolReader(request, actor, database)
        kind, identity, version = source["entity_type"], source["entity_id"], source["version"]
        if kind in {"business", "faq", "section"}:
            # Reopen only this saved source through its current canonical guard.
            # A business reference never authorizes descendant content.
            current = await rpc(request, actor, "SELECT internal.assistant_citation_read($1,$2)::text", run_id, UUID(source["id"]))
            evidence = current.get("evidence")
            if not isinstance(evidence, dict) or any(evidence.get(key) != source.get(key)
                    for key in ("entity_type", "entity_id", "version")):
                raise HTTPException(409, detail={"code": "assistant_source_changed"})
            target = publication_targets({"target": evidence["target"]})
            if target.get("href"):
                return {"source_href": target["href"], "metadata": {
                    "visibility": evidence["visibility"], "version": evidence["version"],
                    "as_of": evidence.get("as_of"), "environment": "local-test", "synthetic": False}}
        if kind in {"project", "brand"}:
            current = await reader.content(kind, identity, "draft" if version.startswith("draft:") else "published", None if version.startswith("draft:") else UUID(version))
            if not current or current[1] != version: raise failure(409, "assistant_source_changed", "ฉบับร่างเปลี่ยนแล้ว กรุณาถามใหม่จากข้อมูลล่าสุด")
            reference = "draft_at=" + quote(version[6:], safe="") if version.startswith("draft:") else "version=" + quote(version, safe="")
            return {"source_href": f"/?{kind}={quote(identity, safe='')}&{reference}",
                    "metadata": {"visibility": current[2], "version": version, "environment": "local-test", "synthetic": False, "as_of": current[3]}}
        if kind == "promotion":
            row = await reader.query("SELECT hub.promotion_read($1)::text", UUID(identity))
            if version.startswith("draft:"):
                valid = version == "draft:" + str(row["draft_revision"])
            else:
                valid = row.get("publication_available") and str(row.get("published_version_id")) == version
            if not valid: raise failure(409, "assistant_source_changed", "โปรโมชั่นหรือรุ่นข้อมูลเปลี่ยนแล้ว")
            return {"source_href": "/promotions?promotion=" + quote(identity, safe=""), "metadata": {"version": version, "environment": "local-test"}}
        if kind == "campaign":
            row = await reader.query("SELECT ads.registration_detail($1)::text", identity)
            if not row: raise failure(404, "assistant_not_found", "ไม่พบรายการที่คุณเข้าถึงได้")
            if campaign_version(row) != version: raise failure(409, "assistant_source_changed", "ทะเบียนหรือรหัสแพลตฟอร์มเปลี่ยนแล้ว กรุณาถามใหม่")
            return {"source_href": "/ads/registry?registration=" + quote(identity, safe=""), "metadata": {"version": version, "environment": "local-test"}}
        if kind == "media_line":
            row = await reader.query("SELECT ads.actuals_read('actuals',$1,'{}'::jsonb)::text", identity)
            if not row or row["meta"].get("snapshot_id") != version: raise failure(409, "assistant_source_changed", "ชุดผลการตลาดเปลี่ยนแล้ว กรุณาถามใหม่")
            return {"source_href": "/ads/actuals?line=" + quote(identity, safe=""), "metadata": {"version": version, "environment": "local-test", "freshness": row["meta"], "months": [item["month"] for item in row.get("months", [])]}}
        if kind == "memo":
            try:
                row = await reader.query("SELECT ads.archive_read($1)::text", UUID(identity))
                if row["document_type"] != "E_MEMO" or row.get("legal_hold") or row["current_version_id"] != version or not row.get("confirmation") or not row.get("application"):
                    raise failure(409, "assistant_source_changed", "หลักฐานรุ่นนี้ไม่พร้อมใช้อ้างอิงแล้ว")
                memo = row["confirmation"]["corrected_result"]["fields"]["memo_no"]
                current = await reader.query("SELECT ads.archive_search($1,'{}'::jsonb)::text", memo)
                if not any(item["document_id"] == identity and item["version_id"] == version and item["page"] == source.get("page") for item in current["items"]):
                    raise failure(409, "assistant_source_changed", "หลักฐานไม่ตรงทะเบียนหรือสิทธิ์ปัจจุบัน")
            except Exception:
                await reader.archive_audit("DETAIL", "FAILED", document_id=identity, version_id=version, page=source.get("page"))
                raise
            await reader.archive_audit("DETAIL", "ALLOWED", document_id=identity, version_id=version, page=source.get("page"))
            return {"source_href": "/ads/archive?document=" + quote(identity, safe=""), "metadata": {"version": version, "page": source["page"], "environment": "local-test"}}
        if kind == "naming_rule" and identity == "SENA-H" and version == "1":
            await reader.access("explain_name", "naming_rule")
            return {"source_href": "/ads/registry", "metadata": {"version": version, "environment": "local-test"}}
        raise failure(404, "assistant_not_found", "ไม่พบแหล่งอ้างอิงที่รองรับ")

    @app.get(prefix + "/runs/{run_id}/citations/{citation_id}")
    async def citation(run_id: UUID, citation_id: UUID, request: Request, actor: Actor = Depends(staff)):
        source = await rpc(request, actor, "SELECT internal.assistant_citation_read($1,$2)::text", run_id, citation_id)
        return {"data": {"id": str(citation_id), "source": source, **await citation_source(request, actor, source, run_id)}}

    @app.post(prefix + "/runs")
    async def runs(body: RunInput, request: Request, actor: Actor = Depends(staff)):
        from .assistant_model import run_model, model_configuration, LIVE_PROJECT_ID, verify_live_projection
        provider = model_configuration()
        scope = body.context.model_dump(mode="json", exclude_none=True)
        access = await ToolReader(request, actor, database).access()
        if body.mode == "live":
            if not provider["live_available"] or "get_project" not in access["allowed_tools"]:
                raise failure(503, "assistant_live_unavailable", "ยังไม่ได้ตั้งค่าโมเดลจริง ใช้ข้อมูลสาธิต")
            scope = {"project_id": LIVE_PROJECT_ID, "visibility": "draft"}
            candidate = await ToolReader(request, actor, database, scope).invoke("get_project", scope)
            try: verify_live_projection(candidate)
            except ValueError: raise failure(409, "assistant_fixture_changed", "ข้อมูลสมมติเปลี่ยนแล้ว จึงระงับการส่งไปยังโมเดลจริง") from None
        row = await rpc(request, actor, "SELECT internal.assistant_run_create($1::jsonb)::text", {
            "mode": "LIVE_SYNTHETIC" if body.mode == "live" else "SYNTHETIC", "config_version": provider["config_version"],
            **({"scope_project_id": scope["project_id"]} if scope.get("project_id") else {})})
        run_id = UUID(row["id"]); queue = asyncio.Queue(maxsize=128)
        facts, sources, citations, notices = {}, {}, {}, []
        started = time.monotonic()
        reader = ToolReader(request, actor, database, scope)

        async def emit(event, data):
            await queue.put((event, {"run_id": str(run_id), **data}))

        async def unchanged_access():
            current = await reader.access()
            if current["fingerprint"] != access["fingerprint"]:
                raise failure(403, "assistant_permissions_changed", "สิทธิ์เปลี่ยนแล้ว กรุณาเริ่มคำถามใหม่ ข้อความที่ยังไม่ส่งยังอยู่")

        async def invoke(name, arguments):
            if name not in access["allowed_tools"]: raise failure(403, "assistant_tool_forbidden", "ไม่มีสิทธิ์ใช้เครื่องมือนี้")
            tick = time.monotonic()
            await emit("tool_start", {"tool_name": name, "label_th": TOOL_LABELS[name]})
            outcome = "ERROR"; result = None
            try:
                # Recheck bearer identity before each domain transaction; RLS remains authoritative.
                if await authentication(request) != actor: raise failure(403, "assistant_actor_changed", "บัญชีเปลี่ยนแล้ว กรุณาเริ่มใหม่")
                await unchanged_access()
                result = await reader.invoke(name, arguments)
                await unchanged_access()
                outcome = "SUCCESS" if result["status"] == "OK" else "NO_ANSWER"
                return result
            except HTTPException:
                outcome = "DENIED"
                return {"tool": name, "status": "FORBIDDEN", "sources": [], "facts": [], "pending_question_ids": []}
            except (ValidationError, ValueError):
                outcome = "NO_ANSWER"
                return {"tool": name, "status": "UNAVAILABLE", "sources": [], "facts": [], "pending_question_ids": []}
            finally:
                projection = [{key: source[key] for key in ("namespace", "entity_type", "entity_id", "version", "page") if key in source} for source in (result or {}).get("sources", [])] if outcome == "SUCCESS" else []
                receipt = await rpc(request, actor, "SELECT internal.assistant_tool_record($1,$2::jsonb)::text", run_id,
                    {"tool_name": name, "outcome": outcome, "duration_ms": int((time.monotonic() - tick) * 1000), "sources": projection,
                     "requires_finance": finance_filters(name, TOOL_INPUTS[name].model_validate(arguments)) if outcome == "SUCCESS" else False})
                if result and outcome == "SUCCESS":
                    for source, citation in zip(result["sources"], receipt["citations"], strict=True):
                        sources[source["id"]] = source; citations[source["id"]] = citation
                    for fact in result["facts"]: facts[fact["id"]] = fact
                    if result.get("message_th"): notices.append(result["message_th"])
                    for question in result.get("pending_question_ids", []): notices.append("รอคำตอบ " + question)
                await emit("tool_end", {"tool_name": name, "label_th": TOOL_LABELS[name], "status": outcome})

        async def execute():
            status, error_code, usage = "ERROR", None, {"input_tokens": 0, "output_tokens": 0}
            try:
                async with asyncio.timeout(60):
                    result = await run_model(message=body.message, context={"allowed_tools": access["allowed_tools"], "tool_schemas": TOOL_SCHEMAS, "scope": scope},
                        invoke_tool=invoke, emit=emit, mode=body.mode, golden_id=body.golden_id)
                chosen = selected_facts(result, facts)
                await unchanged_access()
                if await authentication(request) != actor: raise failure(403, "assistant_actor_changed", "บัญชีเปลี่ยนแล้ว")
                usage = result["usage"]
                used_sources = list(dict.fromkeys(fact["source_id"] for fact in chosen))
                # Legal qualifications are server-owned and cannot be dropped by model selection.
                selected_ids = {fact["id"] for fact in chosen}
                for fact in facts.values():
                    qualifier = fact["availability"] == "UNAVAILABLE" or fact["field"] == "comparison_reason" or fact["field"].endswith("match_status") or fact["field"].endswith("match_method")
                    promotion_qualification = sources[fact["source_id"]]["entity_type"] == "promotion" and fact["field"] in {"legal_terms.th", "disclaimer.th", "starts_at", "ends_at"}
                    if fact["source_id"] in used_sources and (qualifier or promotion_qualification) and fact["id"] not in selected_ids:
                        chosen.append(fact)
                if len(chosen) < len(facts): notices.append("แสดงข้อมูลบางส่วน กรุณาเปิดแหล่งข้อมูลเพื่อตรวจรายละเอียดทั้งหมด")
                for source_id in used_sources:
                    source = sources[source_id]
                    if source.get("valid_until") and datetime.fromisoformat(source["valid_until"]) <= datetime.now(timezone.utc):
                        raise ValueError("Expired evidence")
                    # No unsupported block is released before source/version checks complete.
                    await rpc(request, actor, "SELECT internal.assistant_citation_read($1,$2)::text", run_id, UUID(citations[source_id]["id"]))
                    checked = await citation_source(request, actor, citations[source_id], run_id)
                    if checked["metadata"].get("visibility", source["visibility"]) != source["visibility"]:
                        raise ValueError("Publication state changed")
                if not chosen:
                    await emit("answer_delta", {"block_id": "no-answer", "text": "ยังไม่มีข้อมูลที่ยืนยันได้สำหรับคำถามนี้", "citation_ids": [], "metadata": {"environment": "local-test", "synthetic": body.mode == "live"}})
                for source_id in used_sources:
                    await unchanged_access()
                    source, citation = sources[source_id], citations[source_id]
                    if source.get("valid_until") and datetime.fromisoformat(source["valid_until"]) <= datetime.now(timezone.utc):
                        raise ValueError("Expired evidence")
                    source_facts = [fact for fact in facts.values() if fact["source_id"] == source_id]
                    if body.mode == "live":
                        # Whole-source demo provenance is justified only by the closed approved projection.
                        verify_live_projection({"tool": "get_project", "status": "OK", "sources": [source], "facts": source_facts})
                        source["synthetic"] = True
                        for fact in source_facts: fact["synthetic"] = True
                    metadata = {key: source.get(key) for key in ("visibility", "version", "environment", "synthetic", "as_of", "freshness", "scope")}
                    metadata["contains_synthetic"] = any(fact.get("synthetic") for fact in chosen if fact["source_id"] == source_id)
                    label = {"DRAFT": "ฉบับร่าง", "PUBLISHED": "เผยแพร่แล้ว", "HISTORICAL": "รุ่นก่อนหน้า", "TEST": "ข้อมูลทดสอบ", "CONFIRMED": "ยืนยันข้อมูลแล้ว", "ISSUED": "ชื่อที่ออกแล้ว", "REFERENCE": "กติกาอ้างอิง"}.get(source["visibility"], "ข้อมูลอ้างอิง")
                    text = label + " · " + source["entity_id"] + "\n" + "\n".join(fact_text(fact) for fact in chosen if fact["source_id"] == source_id)
                    if source.get("as_of"): text += "\nข้อมูล ณ " + datetime.fromisoformat(source["as_of"]).astimezone(BANGKOK).strftime("%d/%m/%Y %H:%M") + " น. (กรุงเทพฯ)"
                    if source["namespace"] == "internal_content": text += "\nข้อความบรรยายเป็นข้อความอ้างอิง ไม่ใช้คำนวณราคา งบประมาณ หรือสถานะคงเหลือ"
                    if source.get("freshness"): text += "\nข้อมูล DW ชุดทดสอบ ต้องตรวจเวลาต้นทางและข้อจำกัดก่อนใช้"
                    if notices: text += "\n" + "\n".join(dict.fromkeys(notices))
                    href = f"/api/hub{prefix}/runs/{run_id}/citations/{citation['id']}"
                    await emit("citation", {"id": citation["id"], "label_th": "เปิดแหล่งข้อมูล · " + source["entity_id"], "href": href})
                    await emit("answer_delta", {"block_id": source_id, "text": text, "metadata": metadata, "citation_ids": [citation["id"]]})
                status = "DONE"
            except asyncio.CancelledError:
                status, error_code = "CANCELLED", "CANCELLED"
                raise
            except Exception as error:
                budget = spend_limit_code(error)
                error_code = "ASSISTANT_BUDGET" if budget else "UNVERIFIED_ANSWER"
                await emit("error", {"code": "assistant_budget" if budget else error_code,
                    "message_th": MESSAGES['assistant_budget'] if budget else "ยังยืนยันคำตอบไม่ได้ กรุณาตรวจบริบทและลองใหม่"})
            finally:
                try:
                    with anyio.CancelScope(shield=True):
                        await rpc(request, actor, "SELECT internal.assistant_run_finish($1,$2::jsonb)::text", run_id,
                            {"status": status, "duration_ms": int((time.monotonic() - started) * 1000), "usage": usage, **({"error_code": error_code} if error_code else {})})
                        if status == "DONE": await emit("done", {"status": status, "provider": result["provider"], "usage": usage})
                except Exception:
                    await emit("error", {"code": "AUDIT_UNAVAILABLE", "message_th": "ยังบันทึกผลการทำงานไม่สำเร็จ กรุณาลองใหม่"})
                finally:
                    active.pop(str(run_id), None)
                    with suppress(asyncio.QueueFull): queue.put_nowait(None)

        async def stream():
            task = asyncio.create_task(execute()); active[str(run_id)] = task
            try:
                yield "event: status\ndata: " + json.dumps({"run_id": str(run_id), "state": "running", "message_th": "กำลังตรวจข้อมูลตามสิทธิ์ของคุณ", "mode": body.mode}, ensure_ascii=False) + "\n\n"
                while True:
                    item = await queue.get()
                    if item is None: break
                    event, data = item
                    yield "event: " + event + "\ndata: " + json.dumps(data, ensure_ascii=False) + "\n\n"
            finally:
                if not task.done(): task.cancel()
                with anyio.CancelScope(shield=True):
                    await asyncio.gather(task, return_exceptions=True)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    async def proposal_permission(request, actor, entity_type=None):
        access = await ToolReader(request, actor, database).access()
        fields = access["proposal_fields"]
        if not fields or entity_type is not None and entity_type not in fields:
            raise failure(403, "assistant_proposal_forbidden", "ไม่มีสิทธิ์แก้ข้อความฉบับร่างของรายการนี้")

    @app.post(prefix + "/proposals", status_code=201)
    async def propose(body: Proposal, request: Request, actor: Actor = Depends(staff)):
        await proposal_permission(request, actor, body.entity_type)
        return {"data": await rpc(request, actor, "SELECT internal.assistant_proposal_create($1::jsonb)::text", body.model_dump(mode="json", exclude_none=True))}

    @app.post(prefix + "/proposals/suggest", status_code=201)
    async def suggest(body: SuggestProposal, request: Request, actor: Actor = Depends(staff)):
        from .assistant_model import suggest_draft_text
        await proposal_permission(request, actor, body.entity_type)
        queries = {
            ("project", "meta_title.th"): "SELECT jsonb_build_object('text',meta_title->>$2,'updated_at',updated_at,'demo_fields',demo_fields)::text FROM hub.projects WHERE id=$1 AND deleted_at IS NULL",
            ("project", "meta_description.th"): "SELECT jsonb_build_object('text',meta_description->>$2,'updated_at',updated_at,'demo_fields',demo_fields)::text FROM hub.projects WHERE id=$1 AND deleted_at IS NULL",
            ("brand", "description.th"): "SELECT jsonb_build_object('text',description->>$2,'updated_at',updated_at,'demo_fields',demo_fields)::text FROM hub.brands WHERE id=$1 AND deleted_at IS NULL",
        }
        value = await rpc(request, actor, queries[(body.entity_type, body.field_path)], body.entity_id, "th")
        if not value: raise failure(404, "assistant_not_found", "ไม่พบรายการที่คุณเข้าถึงได้")
        if body.field_path not in value.get("demo_fields", []): raise failure(403, "assistant_proposal_forbidden", "ชุดสาธิตแก้ได้เฉพาะข้อความสมมติที่กำหนดไว้")
        if datetime.fromisoformat(value["updated_at"]) != body.expected_updated_at: raise failure(409, "assistant_stale", "ข้อมูลเปลี่ยนแล้ว กรุณาตรวจข้อเสนอใหม่")
        generated = await suggest_draft_text(value.get("text") or "", body.field_path)
        proposed = Proposal(**body.model_dump(), new_text=generated["new_text"], rationale=generated["rationale"])
        saved = await rpc(request, actor, "SELECT internal.assistant_proposal_create($1::jsonb)::text", proposed.model_dump(mode="json", exclude_none=True))
        return {"data": {**saved, "provider": "fake"}}

    @app.get(prefix + "/proposals/{proposal_id}")
    async def proposal(proposal_id: UUID, request: Request, actor: Actor = Depends(staff)):
        await proposal_permission(request, actor)
        return {"data": await rpc(request, actor, "SELECT internal.assistant_proposal_read($1)::text", proposal_id)}

    @app.post(prefix + "/proposals/{proposal_id}/confirm")
    async def confirm(proposal_id: UUID, body: ConfirmProposal, request: Request, actor: Actor = Depends(staff)):
        await proposal_permission(request, actor)
        return {"data": await rpc(request, actor, "SELECT internal.assistant_proposal_apply($1,$2)::text", proposal_id, body.digest)}
