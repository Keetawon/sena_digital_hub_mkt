"""Thirteen bounded, caller-authorized readers and typed evidence projections."""
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import re
from typing import Annotated, Literal
from uuid import UUID, uuid4

import asyncpg
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from . import naming
from .auth import failure
from .finance import Month

CONTENT_ROLES = frozenset({"editor", "publisher", "viewer", "admin"})
ADS_ROLES = frozenset({"online_staff", "admin"})
STAFF_ROLES = CONTENT_ROLES | ADS_ROLES
Text = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=300, pattern=r"^[^\x00]*$")]
Identifier = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=100, pattern=r"^[^\x00]*$")]
Limit = Annotated[int, Field(strict=True, ge=1, le=10)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProjectInput(Input):
    project_id: Identifier
    visibility: Literal["draft", "published"] = "draft"
    version_id: UUID | None = None


class FindProjects(Input):
    query: Text
    limit: Limit = 5


class BrandInput(Input):
    brand_id: Identifier
    visibility: Literal["draft", "published"] = "draft"
    version_id: UUID | None = None


class ReadinessInput(Input):
    entity_type: Literal["project", "brand", "promotion"]
    entity_id: Identifier
    visibility: Literal["draft", "published"] = "draft"
    version_id: UUID | None = None


class SearchContent(Input):
    query: Text
    project_id: Identifier | None = None
    brand_id: Identifier | None = None
    business_id: Annotated[str, StringConstraints(strict=True, pattern=r"^[a-z][a-z0-9_]{1,63}$")] | None = None
    visibility: Literal["draft", "published"] = "draft"
    limit: Limit = 5

    @model_validator(mode="after")
    def one_scope(self):
        if sum(bool(getattr(self, key)) for key in ("project_id", "brand_id", "business_id")) > 1:
            raise ValueError("Choose one content scope")
        return self


class PromotionsInput(Input):
    project_id: Identifier
    as_of: AwareDatetime | None = None


class MarketingInput(Input):
    rem_project_id: Identifier
    month: Month


class CampaignInput(Input):
    code_or_name: Text


class FindCampaigns(Input):
    query: Annotated[str, StringConstraints(strict=True, max_length=200, pattern=r"^[^\x00]*$")] = ""
    agency: Identifier | None = None
    month: Month | None = None
    memo_no: Identifier | None = None
    fee_po_ref: Identifier | None = None
    limit: Limit = 5


class ActualsInput(Input):
    line_id: UUID
    month: Month


class NameInput(Input):
    name: Text


class SearchDocuments(Input):
    query: Text
    bud: Identifier | None = None
    month: Month | None = None
    series: Literal["BUD", "CORPORATE"] | None = None
    limit: Limit = 5


TOOL_INPUTS = {
    "get_project": ProjectInput, "find_projects": FindProjects, "get_models": ProjectInput,
    "get_brand": BrandInput, "check_publish_readiness": ReadinessInput, "search_content": SearchContent,
    "get_promotions": PromotionsInput, "get_project_marketing": MarketingInput, "get_campaign": CampaignInput,
    "find_campaigns": FindCampaigns, "get_line_actuals": ActualsInput, "explain_name": NameInput,
    "search_documents": SearchDocuments,
}
TOOL_SCHEMAS = {name: model.model_json_schema() for name, model in TOOL_INPUTS.items()}
CONTENT_TOOLS = frozenset(list(TOOL_INPUTS)[:7])
TOOL_LABELS = dict(zip(TOOL_INPUTS, (
    "อ่านข้อมูลโครงการ", "ค้นหาโครงการ", "อ่านแบบบ้าน", "อ่านข้อมูลแบรนด์", "ตรวจความพร้อมเผยแพร่",
    "ค้นหาเนื้อหา", "ตรวจโปรโมชั่นปัจจุบัน", "อ่านผลการตลาดโครงการ", "อ่านทะเบียนแคมเปญ",
    "ค้นหาแคมเปญ", "อ่านผลรายเดือน", "อธิบายรูปแบบชื่อ", "ค้นหาบันทึกข้อความ")))
DEMO_FIELDS = frozenset({"public_name.th", "meta_title.th", "meta_description.th", "description.th",
    "title.th", "legal_terms.th", "disclaimer.th", "benefit_type", "benefit_value", "starts_at", "ends_at",
    "bedrooms", "bathrooms", "usable_area_sqm", "parking_spaces", "match_status"})


def demo_fields(value):
    markers = value.get("demo_fields", [])
    return sorted(field for field in markers if isinstance(field, str) and field in DEMO_FIELDS) if isinstance(markers, list) else []


def tool_source_kind(name, inputs=None, context=None):
    if name == "check_publish_readiness": return inputs.entity_type
    if name == "search_content":
        if inputs.business_id or (context or {}).get("business_id"):
            return "business"
        return "project" if inputs.project_id or (context or {}).get("project_id") else "brand"
    return {"get_project": "project", "find_projects": "project", "get_models": "project", "get_brand": "brand",
            "get_promotions": "promotion", "get_project_marketing": "media_line", "get_campaign": "campaign",
            "find_campaigns": "campaign", "get_line_actuals": "media_line", "explain_name": "naming_rule",
            "search_documents": "memo"}[name]


def finance_filters(name, inputs):
    return name == "find_campaigns" and any(getattr(inputs, key, None) is not None for key in ("month", "memo_no", "fee_po_ref"))


def decode(value):
    return json.loads(value, parse_float=Decimal) if isinstance(value, str) else value


def scalar(value):
    if value is None:
        return None
    if isinstance(value, (datetime,)):
        return value.isoformat()
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def narrative(value):
    """Narrative is never a source of volatile numbers or instructions."""
    if not isinstance(value, str) or not value.strip():
        return None
    if re.search(r"[0-9๐-๙]|ราคา|ส่วนลด|ผ่อน|ดอกเบี้ย|ห้องว่าง|บาท|%|ignore|system\s*prompt|instruction|เผยแพร่เลย|อนุมัติ", value, re.I):
        return None
    return value[:800]


def campaign_version(row):
    """Digest the mutable safe facts, never an immutable creation timestamp."""
    registration = row.get("registration", {})
    projection = {key: registration.get(key) for key in ("code", "agency", "objective", "status")}
    projection["names"] = [item.get("frozen_name") for item in row.get("names", [])[:10]]
    projection["bindings"] = [{key: item.get(key) for key in ("platform", "account_id", "campaign_id")} for item in row.get("bindings", [])[:10]]
    return "sha256:" + hashlib.sha256(json.dumps(projection, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


class Evidence:
    def __init__(self, tool):
        self.result = {"tool": tool, "status": "OK", "sources": [], "facts": [], "pending_question_ids": []}

    def source(self, namespace, kind, entity_id, version, visibility, *, as_of=None, page=None, scope=None, freshness=None, synthetic=False, valid_until=None):
        source = {"id": str(uuid4()), "namespace": namespace, "entity_type": kind, "entity_id": str(entity_id),
                  "version": str(version), "visibility": visibility, "environment": "local-test",
                  "as_of": scalar(as_of), "synthetic": synthetic, "scope": scope or {}}
        if page is not None: source["page"] = page
        if freshness is not None: source["freshness"] = freshness
        if valid_until is not None: source["valid_until"] = scalar(valid_until)
        self.result["sources"].append(source)
        return source

    def fact(self, source, field, label, value, kind="text", unit=None):
        if isinstance(value, (dict, list, float)):
            raise ValueError("Only exact scalar facts are allowed")
        fact = {"id": str(uuid4()), "source_id": source["id"], "field": field, "label_th": label,
                "type": kind, "value": scalar(value), "availability": "UNAVAILABLE" if value is None else "AVAILABLE",
                "synthetic": source["synthetic"] or field in source.get("demo_fields", [])}
        if unit: fact["unit"] = unit
        self.result["facts"].append(fact)

    def unavailable(self, message="ยังไม่มีข้อมูลที่ยืนยันได้สำหรับคำถามนี้"):
        self.result["status"] = "UNAVAILABLE"
        self.result["message_th"] = message
        return self.result


class ToolReader:
    def __init__(self, request, actor, database, context=None):
        self.request, self.actor, self.database = request, actor, database
        self.context = context or {}

    async def query(self, statement, *args, many=False):
        async with self.database(self.request, self.actor) as db:
            if many:
                return await db.fetch(statement, *args)
            return decode(await db.fetchval(statement, *args))

    async def archive_audit(self, action, outcome, *, document_id=None, version_id=None, page=None):
        # This fixed insert-only audit RPC does not grant any archive retrieval rights.
        payload = {"action": action, "outcome": outcome, "original_role": self.actor.role,
                   "original_actor_id": str(self.actor.id), "document_id": document_id,
                   "version_id": version_id, "page": page, "request_id": str(uuid4()), "bytes": None}
        async with self.database(self.request, self.actor, audit_only=True) as db:
            await db.fetchval("SELECT ads.archive_access($1::jsonb)", payload)

    async def access(self, name=None, kind=None, financial=False):
        try:
            return await self.query("SELECT internal.assistant_access($1,$2,$3)::text", name, kind, financial)
        except asyncpg.InsufficientPrivilegeError:
            raise failure(403, "assistant_tool_forbidden", "บัญชีนี้ไม่มีสิทธิ์อ่านข้อมูลส่วนนี้") from None

    async def invoke(self, name, arguments):
        if name not in TOOL_INPUTS:
            raise failure(403, "assistant_tool_forbidden", "บัญชีนี้ไม่มีสิทธิ์อ่านข้อมูลส่วนนี้")
        inputs = TOOL_INPUTS[name].model_validate(arguments)
        business = self.context.get("business_id")
        requested_business = getattr(inputs, "business_id", None)
        other_context = any(self.context.get(key) for key in ("project_id", "brand_id", "rem_project_id", "line_id", "code", "name"))
        if (business and (other_context or name != "search_content" or inputs.project_id or inputs.brand_id
                          or requested_business and requested_business != business)
                or requested_business and other_context):
            raise failure(403, "assistant_scope_conflict", "กรุณาเปลี่ยนบริบทก่อนอ่านข้อมูลอีกส่วน")
        try:
            await self.access(name, tool_source_kind(name, inputs, self.context), finance_filters(name, inputs))
        except Exception:
            if name == "search_documents": await self.archive_audit("SEARCH", "DENIED")
            raise
        project = getattr(inputs, "project_id", None)
        locked = self.context.get("project_id")
        brand = self.context.get("brand_id")
        domain = next((key for key in ("rem_project_id", "line_id", "code", "name") if self.context.get(key)), None)
        if locked and name not in {"get_project", "find_projects", "get_models", "get_promotions", "check_publish_readiness", "search_content"}:
            raise failure(403, "assistant_scope_conflict", "กรุณาเปลี่ยนบริบทก่อนอ่านข้อมูลอีกส่วน")
        if brand and (name not in {"get_brand", "search_content", "check_publish_readiness"} or
                      name == "search_content" and inputs.project_id or
                      name == "check_publish_readiness" and (inputs.entity_type != "brand" or inputs.entity_id != brand)):
            raise failure(403, "assistant_scope_conflict", "รายการที่ร้องขอไม่ตรงกับแบรนด์ที่เลือก")
        allowed = {"rem_project_id": {"get_project_marketing"}, "line_id": {"get_line_actuals"},
                   "code": {"get_campaign", "explain_name"}, "name": {"get_campaign", "explain_name"}}
        if domain and name not in allowed[domain]:
            raise failure(403, "assistant_scope_conflict", "กรุณาเปลี่ยนบริบทก่อนอ่านข้อมูลอีกส่วน")
        if domain in {"code", "name"} and getattr(inputs, "code_or_name", getattr(inputs, "name", None)) != self.context[domain]:
            raise failure(403, "assistant_scope_conflict", "รายการที่ร้องขอไม่ตรงกับบริบทที่เลือก")
        if locked and project and locked != project:
            raise failure(403, "assistant_scope_conflict", "กรุณาเปลี่ยนบริบทโครงการอย่างชัดเจนก่อนค้นหาข้ามโครงการ")
        if locked and (name == "get_brand" or name == "search_content" and inputs.brand_id or
                       name == "check_publish_readiness" and (inputs.entity_type != "project" or inputs.entity_id != locked)):
            raise failure(403, "assistant_scope_conflict", "กรุณาเปลี่ยนบริบทก่อนอ่านแบรนด์หรือรายการอื่น")
        for field in ("rem_project_id", "line_id", "brand_id", "month", "visibility"):
            selected, requested = self.context.get(field), getattr(inputs, field, None)
            if selected and requested and str(selected) != str(requested):
                raise failure(403, "assistant_scope_conflict", "รายการที่ร้องขอไม่ตรงกับบริบทที่เลือก")
        if self.context.get("visibility") == "draft" and getattr(inputs, "version_id", None):
            raise failure(403, "assistant_scope_conflict", "กรุณาเลือกบริบทรุ่นเผยแพร่ก่อนอ่านรุ่นข้อมูลเดิม")
        if locked and name == "find_projects":
            # A locked conversation does not silently switch to a similarly named project.
            return await self.get_project(ProjectInput(project_id=locked), Evidence(name))
        evidence = Evidence(name)
        try:
            result = await getattr(self, name)(inputs, evidence)
        except asyncpg.PostgresError as error:
            if error.sqlstate == "42501":
                raise failure(403, "assistant_tool_forbidden", "บัญชีนี้ไม่มีสิทธิ์อ่านข้อมูลส่วนนี้") from None
            if error.sqlstate == "P0002":
                return evidence.unavailable()
            raise
        if len(json.dumps(result, ensure_ascii=False)) > 40000 or len(result["facts"]) > 80:
            return Evidence(name).unavailable("ผลลัพธ์มีจำนวนมาก กรุณาระบุคำถามให้แคบลง")
        if name in {"find_projects", "get_models", "get_brand", "search_content", "get_promotions", "find_campaigns", "get_project_marketing", "search_documents"} and result["facts"]:
            result["message_th"] = (result.get("message_th", "") + " · แสดงรายการภายในขีดจำกัดของคำถามนี้ ไม่ใช่จำนวนรายการทั้งหมด").strip(" ·")
        return result

    async def content(self, kind, identity, visibility, version_id=None):
        value = await self.query(f"SELECT hub.{kind}_detail($1)::text", identity)
        if not value:
            return None
        if visibility == "draft" and version_id is None:
            return value, "draft:" + value["updated_at"], "DRAFT", value["updated_at"]
        pointer = str(version_id) if version_id else value.get("published_version_id")
        if not pointer or (version_id is None and not value.get("publication_available")):
            return None
        row = await self.query("SELECT internal.assistant_content_version($1,$2,$3)::text", kind, identity, UUID(pointer))
        if not row:
            return None
        return row["payload"], pointer, "PUBLISHED" if pointer == value.get("published_version_id") and value.get("publication_available") else "HISTORICAL", row["published_at"]

    @staticmethod
    def content_source(e, kind, identity, selected):
        value, version, visibility, stamp = selected
        source = e.source("internal_content", kind, identity, version, visibility, as_of=stamp,
                          scope={kind + "_id": identity}, synthetic=False)
        source["demo_fields"] = demo_fields(value)
        if kind == "project":
            for model in value.get("models", [])[:10]:
                prefix = "models." + str(model.get("public_model_id", model.get("id", "unknown"))) + "."
                source["demo_fields"].extend(prefix + field for field in demo_fields(model))
        return source

    async def get_project(self, p, e):
        selected = await self.content("project", p.project_id, p.visibility, p.version_id)
        if not selected: return e.unavailable()
        value = selected[0]; source = self.content_source(e, "project", p.project_id, selected)
        e.fact(source, "public_project_id", "รหัสโครงการ Hub", value.get("public_project_id", p.project_id), "identifier")
        e.fact(source, "rem_project_id", "รหัสโครงการ REM", value.get("rem_project_id") or value.get("source", {}).get("rem_project_id"), "identifier")
        e.fact(source, "public_name.th", "ชื่อโครงการ", value.get("public_name", {}).get("th"))
        for field, label in (("meta_title", "หัวข้อการตลาด"), ("meta_description", "คำอธิบายการตลาด")):
            e.fact(source, field + ".th", label, narrative(value.get(field, {}).get("th")))
        return e.result

    async def find_projects(self, p, e):
        rows = await self.query("SELECT public_project_id FROM hub.projects WHERE deleted_at IS NULL AND strpos(lower(public_project_id||' '||public_name::text),lower($1))>0 ORDER BY public_project_id LIMIT $2", p.query, p.limit, many=True)
        for row in rows:
            selected = await self.content("project", row["public_project_id"], "draft")
            if selected:
                source = self.content_source(e, "project", row["public_project_id"], selected)
                e.fact(source, "public_project_id", "โครงการที่พบ", row["public_project_id"], "identifier")
                e.fact(source, "public_name.th", "ชื่อโครงการ", selected[0].get("public_name", {}).get("th"))
        return e.result if e.result["facts"] else e.unavailable()

    async def get_models(self, p, e):
        selected = await self.content("project", p.project_id, p.visibility, p.version_id)
        if not selected: return e.unavailable()
        source = self.content_source(e, "project", p.project_id, selected)
        for model in selected[0].get("models", [])[:10]:
            prefix = "models." + str(model.get("public_model_id", model.get("id", "unknown"))) + "."
            e.fact(source, prefix + "match_status", "สถานะการยืนยันแบบบ้าน", model.get("match_status"), "status")
            if model.get("match_status") != "CONFIRMED":
                e.fact(source, prefix + "public_model_id", "แบบบ้านที่ยังรอยืนยัน", model.get("public_model_id"), "identifier")
                continue
            for field, label, kind, unit in (("public_model_id", "รหัสแบบบ้าน", "identifier", None), ("rem_model_id", "รหัสแบบต้นทาง", "identifier", None),
                ("bedrooms", "ห้องนอน", "number", "ห้อง"), ("bathrooms", "ห้องน้ำ", "number", "ห้อง"),
                ("usable_area_sqm", "พื้นที่ใช้สอย", "number", "ตารางเมตร"), ("parking_spaces", "ที่จอดรถ", "number", "คัน")):
                e.fact(source, prefix + field, label, model.get(field), kind, unit)
            e.fact(source, prefix + "public_name.th", "ชื่อแบบบ้าน", model.get("public_name", {}).get("th"))
        return e.result if e.result["facts"] else e.unavailable("ยังไม่มีแบบบ้านที่ยืนยันในรุ่นข้อมูลนี้")

    async def get_brand(self, p, e):
        selected = await self.content("brand", p.brand_id, p.visibility, p.version_id)
        if not selected: return e.unavailable()
        source = self.content_source(e, "brand", p.brand_id, selected); value = selected[0]
        e.fact(source, "public_brand_id", "รหัสแบรนด์", p.brand_id, "identifier")
        e.fact(source, "public_name.th", "ชื่อแบรนด์", value.get("public_name", {}).get("th"))
        e.fact(source, "description.th", "คำอธิบายแบรนด์", narrative(value.get("description", {}).get("th")))
        for project in value.get("projects", [])[:10]:
            e.fact(source, "projects." + project["public_project_id"], "โครงการที่เชื่อมอย่างชัดเจน", project["public_project_id"], "identifier")
        return e.result

    async def check_publish_readiness(self, p, e):
        if p.entity_type == "promotion":
            value = await self.query("SELECT hub.promotion_read($1)::text", UUID(p.entity_id))
            source = e.source("internal_content", "promotion", p.entity_id, "draft:" + str(value["draft_revision"]), "DRAFT")
            readiness = value.get("readiness")
        else:
            selected = await self.content(p.entity_type, p.entity_id, p.visibility, p.version_id)
            if not selected: return e.unavailable()
            source = self.content_source(e, p.entity_type, p.entity_id, selected)
            readiness = selected[0].get("readiness")
            if readiness is None:
                return e.unavailable("ความพร้อมเผยแพร่ตรวจจากฉบับร่างปัจจุบันเท่านั้น")
        if isinstance(readiness, dict):
            for key, value in readiness.items():
                if isinstance(value, bool): e.fact(source, "readiness." + key, "ผลตรวจความพร้อม " + key, value, "status")
                elif isinstance(value, list):
                    for index, issue in enumerate(value[:15]):
                        code = issue.get("code", issue.get("message")) if isinstance(issue, dict) else issue
                        if isinstance(code, str): e.fact(source, f"readiness.{key}.{index}", "รายการที่ต้องตรวจ", code, "status")
        elif isinstance(readiness, list):
            for index, issue in enumerate(readiness[:15]):
                if isinstance(issue, str): e.fact(source, f"readiness.{index}", "รายการที่ต้องตรวจ", issue, "status")
        return e.result if e.result["facts"] else e.unavailable()

    async def search_content(self, p, e):
        business_id = p.business_id or self.context.get("business_id")
        if business_id:
            rows = await self.query("SELECT internal.assistant_business_search($1,$2)::text", business_id, p.visibility)
            for row in rows:
                matches = []
                for field in ("question", "short_answer", "detail") if row["entity_type"] == "faq" else ("title", "body", "summary"):
                    value = row["fields"].get(field)
                    text = narrative(value.get("th") if isinstance(value, dict) else value)
                    if text and p.query.casefold() in text.casefold():
                        matches.append((field, text))
                if not matches:
                    continue
                source = e.source("internal_content", row["entity_type"], row["entity_id"], row["version"],
                                  row["visibility"], as_of=row.get("as_of"), scope={"business_id": business_id})
                for field, text in matches:
                    e.fact(source, field + ".th", TOOL_LABELS["search_content"], text)
                if len(e.result["sources"]) >= p.limit:
                    break
            e.result["pending_question_ids"] = ["Q42"]
            return e.result if e.result["facts"] else e.unavailable()
        project_id = p.project_id or self.context.get("project_id")
        brand_id = p.brand_id or self.context.get("brand_id")
        if bool(project_id) == bool(brand_id): return e.unavailable("กรุณาระบุโครงการหรือแบรนด์หนึ่งรายการก่อนค้นหา")
        kind, identity = ("project", project_id) if project_id else ("brand", brand_id)
        selected = await self.content(kind, identity, p.visibility)
        if not selected: return e.unavailable()
        source = self.content_source(e, kind, identity, selected)
        for field in ("meta_title", "meta_description") if kind == "project" else ("description",):
            text = narrative(selected[0].get(field, {}).get("th"))
            if text and p.query.casefold() in text.casefold():
                e.fact(source, field + ".th", "เนื้อหาที่พบ", text)
        e.result["pending_question_ids"] = ["Q42"]
        return e.result if e.result["facts"] else e.unavailable()

    async def get_promotions(self, p, e):
        now = datetime.now(timezone.utc)
        if p.as_of and abs((now - p.as_of).total_seconds()) > 60:
            e.result["pending_question_ids"] = ["Q44"]
            return e.unavailable("ยังไม่รองรับการยืนยันสถานะโปรโมชั่นย้อนหลัง")
        project = await self.query("SELECT internal.assistant_project_reference($1)", p.project_id)
        if not project: return e.unavailable()
        rows = await self.query("SELECT hub.promotion_read(null,$1::jsonb)::text", {"published_project_id": str(project), "limit": 10})
        for row in rows.get("items", []):
            published = row.get("published")
            if not row.get("publication_available") or not published: continue
            data = published["payload"]
            source = e.source("internal_content", "promotion", row["id"], published["id"], "PUBLISHED",
                as_of=now, scope={"project_id": p.project_id}, valid_until=data["ends_at"], synthetic=bool(data.get("synthetic")))
            source["demo_fields"] = demo_fields(data)
            for field, label, kind in (("code", "รหัสโปรโมชั่น", "identifier"), ("benefit_type", "ประเภทสิทธิประโยชน์", "status"),
                ("benefit_value", "มูลค่าสิทธิประโยชน์", "number"), ("starts_at", "เริ่มใช้", "date"), ("ends_at", "สิ้นสุด", "date")):
                e.fact(source, field, label, data.get(field), kind, data.get("benefit_unit") if field == "benefit_value" else None)
            for field, label in (("title", "ชื่อโปรโมชั่น"), ("legal_terms", "เงื่อนไข"), ("disclaimer", "ข้อความกำกับ")):
                e.fact(source, field + ".th", label, data.get(field, {}).get("th"))
        return e.result if e.result["facts"] else e.unavailable("ยังไม่มีโปรโมชั่นที่เผยแพร่และใช้ได้ในเวลาปัจจุบัน")

    async def get_campaign(self, p, e):
        observed = p.code_or_name
        code = observed if naming.check(observed) else naming.parse(observed)["code"]
        row = await self.query("SELECT ads.registration_detail($1)::text", code)
        if not row: return e.unavailable()
        names = row.get("names", [])
        if observed != code and not any(item.get("frozen_name") == observed for item in names): return e.unavailable("ชื่อที่สังเกตยังไม่ตรงกับชื่อที่ออกโดยทะเบียน")
        registration = row.get("registration", {})
        source = e.source("internal_ads", "campaign", code, campaign_version(row), "ISSUED", as_of=registration.get("created_at"))
        e.fact(source, "code", "รหัสทะเบียน", code, "identifier")
        for field, label in (("agency", "เอเจนซี"), ("objective", "วัตถุประสงค์"), ("status", "สถานะทะเบียน")):
            e.fact(source, field, label, registration.get(field), "status")
        for index, item in enumerate(names[:10]): e.fact(source, f"names.{index}.frozen_name", "ชื่อที่ออกแล้ว", item.get("frozen_name"), "identifier")
        for index, item in enumerate(row.get("bindings", [])[:10]):
            for field in ("platform", "account_id", "campaign_id"):
                e.fact(source, f"bindings.{index}.{field}", "รหัสแพลตฟอร์ม " + field, item.get(field), "identifier")
        e.result["pending_question_ids"] = ["Q2"]
        return e.result

    async def find_campaigns(self, p, e):
        rows = await self.query("SELECT internal.assistant_campaign_codes($1,$2,$3,$4,$5,$6) AS code",
            p.query, p.agency, p.month, p.memo_no, p.fee_po_ref, p.limit, many=True)
        for row in rows:
            item = await self.get_campaign(CampaignInput(code_or_name=row["code"]), Evidence(e.result["tool"]))
            e.result["sources"].extend(item["sources"]); e.result["facts"].extend(item["facts"])
        if rows: e.result["pending_question_ids"] = ["Q2"]
        return e.result if rows else e.unavailable()

    async def get_project_marketing(self, p, e):
        # The financial role reads exact P2 phase component IDs, never residential drafts or labels.
        lines = await self.query("SELECT internal.assistant_marketing_lines($1,$2) AS id", p.rem_project_id, p.month, many=True)
        if not lines: return e.unavailable("ยังไม่มีข้อมูลการเชื่อมที่ยืนยันแล้ว")
        for line in lines:
            item = await self.get_line_actuals(ActualsInput(line_id=line["id"], month=p.month.isoformat()), Evidence(e.result["tool"]))
            e.result["sources"].extend(item["sources"]); e.result["facts"].extend(item["facts"])
        e.result["message_th"] = "แสดงรายการงบที่เกี่ยวข้องทั้งรายการ ไม่ใช่ส่วนแบ่งค่าใช้จ่ายของเฟส ห้ามรวมยอดกลุ่มกับยอดสมาชิก · ยอดสื่อจากแพลตฟอร์ม ยอดชำระบัตร และต้นทุนรายเดือนเป็นคนละมาตรวัด ห้ามบวกเข้าด้วยกัน · LINE OA (ยังไม่แยกบัญชี) ไม่อนุมานบัญชี"
        return e.result if e.result["facts"] else e.unavailable("ยังไม่มีข้อมูลการเชื่อมที่ยืนยันแล้ว")

    async def get_line_actuals(self, p, e):
        value = await self.query("SELECT ads.actuals_read('actuals',$1,$2::jsonb)::text", str(p.line_id), {"month": p.month.isoformat()})
        if not value or not value.get("months"): return e.unavailable()
        meta = value["meta"]
        for row in value["months"]:
            source = e.source("internal_ads", "media_line", str(p.line_id), meta["snapshot_id"], "TEST", as_of=meta.get("snapshot_at"),
                scope={"line_id": str(p.line_id), "month": p.month.isoformat()}, synthetic=True,
                freshness={key: meta.get(key) for key in ("snapshot_at", "source_watermarks", "context_changed", "quality_codes")})
            for field, label, kind in (("approved_month_gross", "งบรวมที่อนุมัติของรายการ", "money"), ("approved_month_media", "งบสื่อที่เปรียบเทียบได้", "money"),
                ("platform_media_spend", "สื่อจากแพลตฟอร์ม", "money"), ("attributed_leads", "ผู้สนใจตามนิยามข้อมูล", "number"),
                ("media_cpl", "ต้นทุนต่อผู้สนใจ", "money"), ("media_budget_used_pct", "สัดส่วนใช้งบสื่อ", "percent")):
                e.fact(source, field, label, row.get(field), kind, "THB" if kind == "money" else "%" if kind == "percent" else None)
            e.fact(source, "comparison_reason", "ข้อจำกัดการเปรียบเทียบ", row.get("comparison_reason"), "status")
            for measure, label in (("card_cash_by_type", "ยอดชำระบัตร"), ("card_monthly_by_type", "ต้นทุนรับรู้รายเดือน")):
                data = row.get(measure) or {}
                if isinstance(data, dict):
                    for cost_type, amount in data.items():
                        if isinstance(amount, (str, int, Decimal)):
                            e.fact(source, measure + "." + cost_type, label + " · " + ("ช่องทาง (CHANNEL)" if cost_type == "CHANNEL" else cost_type), amount, "money", "THB")
                elif isinstance(data, list):
                    for index, item in enumerate(data[:10]):
                        cost_type = item.get("cost_type")
                        for key in ("amount", "debit_amount", "credit_amount", "net_amount"):
                            if key in item:
                                e.fact(source, f"{measure}.{index}.{key}", label + " · " + ("ช่องทาง (CHANNEL)" if cost_type == "CHANNEL" else str(cost_type)) + " · " + key, item[key], "money", "THB")
            for index, campaign in enumerate(value.get("campaigns", [])[:5]):
                e.fact(source, f"campaigns.{index}.match_method", "วิธีจับคู่แคมเปญ", campaign.get("match_method"), "status")
        e.result["message_th"] = "ยอดสื่อจากแพลตฟอร์ม ยอดชำระบัตร และต้นทุนรายเดือนเป็นคนละมาตรวัด ห้ามบวกเข้าด้วยกัน · LINE OA (ยังไม่แยกบัญชี) คงอยู่ในกลุ่มช่องทางโดยไม่อนุมานบัญชี"
        return e.result

    async def explain_name(self, p, e):
        result = naming.explain(p.name)
        source = e.source("internal_ads", "naming_rule", "SENA-H", "1", "REFERENCE")
        e.fact(source, "template", "รูปแบบชื่อ", result["template"], "identifier")
        e.fact(source, "valid", "ผ่านการตรวจรูปแบบ", result["valid"], "status")
        e.fact(source, "message", "คำอธิบาย", result["message"])
        for key, value in (result.get("fields") or {}).items(): e.fact(source, "fields." + key, "ส่วนประกอบ " + key, value, "identifier")
        return e.result

    async def search_documents(self, p, e):
        filters = p.model_dump(mode="json", exclude_none=True); filters.pop("query")
        try:
            rows = await self.query("SELECT ads.archive_search($1,$2::jsonb)::text", p.query, filters)
        except Exception:
            await self.archive_audit("SEARCH", "FAILED")
            raise
        await self.archive_audit("SEARCH", "ALLOWED")
        for row in rows.get("items", []):
            source = e.source("internal_memo", "memo", row["document_id"], row["version_id"], "CONFIRMED", as_of=row.get("confirmed_at"), page=row["page"])
            e.fact(source, "memo_no", "เลข Memo หลัก", row["memo_no"], "identifier")
            e.fact(source, "subject", "เรื่อง", narrative(row["subject"]))
            e.fact(source, "gross_amount", "ยอดรวมจากทะเบียน P2", row.get("gross_amount"), "money", "THB")
            e.fact(source, "bud", "BUD", row["bud"], "identifier")
        return e.result if e.result["facts"] else e.unavailable("ยังไม่พบบันทึกข้อความที่ยืนยันและเชื่อมทะเบียนตามสิทธิ์ คลังนี้ไม่ค้นใบแจ้งยอดบัตร")
