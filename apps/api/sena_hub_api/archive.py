"""Private synthetic-document receipts, audited reads and explicit P2 application.

The worker runs separately. This API accepts registered fixture IDs only; it never
accepts uploaded bytes, source URLs, OCR engines or client-supplied object keys.
"""
from contextlib import asynccontextmanager
import json
import logging
import re
from typing import Annotated, Literal
from urllib.parse import urlparse
from uuid import UUID, uuid4

import anyio
import asyncpg
from fastapi import Depends, Query, Request
from fastapi.responses import Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator
from starlette.exceptions import HTTPException

from .auth import Actor, failure
from .content_permissions import require_content
from .finance import CostType, Day, Money, Month, Reason, Token, nonblank

Revision = Annotated[int, Field(strict=True, ge=1, le=2147483647)]
Page = Annotated[int, Field(strict=True, ge=1, le=1000)]
Confidence = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
Text = Annotated[str, StringConstraints(strict=True, max_length=50000, pattern=r"^[^\x00]*$")]
Identifier = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=200, pattern=r"^[^\x00]*$"), AfterValidator(nonblank)]
SignedMoney = Annotated[str, StringConstraints(strict=True, pattern=r"^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$")]
FieldName = Literal["memo_no", "subject", "requesting_bud", "gross_amount", "mirrored_status", "approval_date", "period_start", "period_end"]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WordBox(Input):
    text: Text
    x: Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)]
    y: Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)]
    width: Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)]
    height: Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)]


class LineBox(Input):
    text: Text
    words: list[WordBox] = Field(max_length=5000)


class SourcePage(Input):
    page: Page
    method: Literal["TEXT", "OCR"]
    text: Text
    confidence: Confidence | None
    engine_version: Identifier | None = None
    line_boxes: list[LineBox] | None = Field(default=None, max_length=5000)


class FieldSource(Input):
    page: Page
    confidence: Confidence | None
    method: Literal["TEXT", "OCR"] | None = None
    observed_text: Text | None = None


class MemoFields(Input):
    memo_no: Identifier | None = None
    subject: Reason | None = None
    requesting_bud: Token | None = None
    gross_amount: Money | None = None
    mirrored_status: Literal["UNKNOWN", "IN_REVIEW", "APPROVED", "REJECTED", "CANCELLED"] | None = None
    approval_date: Day | None = None
    period_start: Day | None = None
    period_end: Day | None = None


class Occurrence(Input):
    page: Page
    occurrence: Annotated[int, Field(strict=True, ge=1, le=5000)]
    charge_date: Day
    descriptor: Identifier
    amount: SignedMoney
    cost_type: CostType
    payment_method: Literal["CORPORATE_CARD"]


class PageCount(Input):
    page: Page
    count: Annotated[int, Field(strict=True, ge=0, le=5000)]


class Controls(Input):
    statement_total: SignedMoney | None = None
    page_counts: list[PageCount] | None = Field(default=None, max_length=1000)
    meaning: Literal["NET_CHARGES"] | None = None
    issuer: Identifier | None = None
    cycle_start: Day | None = None
    cycle_end: Day | None = None
    due_date: Day | None = None


class CorrectedResult(Input):
    pages: list[SourcePage] = Field(min_length=1, max_length=1000)
    fields: MemoFields
    field_sources: dict[FieldName, FieldSource]
    rows: list[Occurrence] = Field(max_length=5000)
    controls: Controls

    @model_validator(mode="after")
    def source_identity(self):
        pages = {page.page for page in self.pages}
        if len(pages) != len(self.pages) or pages != set(range(1, len(pages) + 1)):
            raise ValueError("หน้าหลักฐานต้องไม่ซ้ำและเรียงครบตั้งแต่หน้าแรก")
        if set(self.field_sources) != self.fields.model_fields_set:
            raise ValueError("ทุกฟิลด์ต้องมีหน้าหลักฐานตรงกัน")
        if any(source.page not in pages for source in self.field_sources.values()) or any(row.page not in pages for row in self.rows):
            raise ValueError("ไม่พบหน้าหลักฐานของรายการ")
        identities = {(row.page, row.occurrence) for row in self.rows}
        if len(identities) != len(self.rows):
            raise ValueError("ลำดับรายการบนหน้าหลักฐานต้องไม่ซ้ำ")
        if self.fields.model_fields_set and (self.rows or self.controls.model_fields_set):
            raise ValueError("บันทึกข้อความและใบแจ้งยอดต้องเป็นคนละชนิดเอกสาร")
        return self


class Receive(Input):
    fixture_id: Annotated[str, StringConstraints(strict=True, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$")]
    document_id: UUID | None = None
    expected_revision: Revision | None = None

    @model_validator(mode="after")
    def new_or_version(self):
        if (self.document_id is None) != (self.expected_revision is None):
            raise ValueError("เอกสารรุ่นใหม่ต้องระบุเอกสารและรุ่นปัจจุบัน")
        return self


class Versioned(Input):
    expected_revision: Revision
    expected_version_id: UUID


class Retry(Versioned):
    reason: Reason


class Confirm(Versioned):
    expected_job_id: UUID
    corrected_result: CorrectedResult
    evidence: Reason


class Apply(Versioned):
    expected_job_id: UUID
    mode: Literal["MEMO_CREATE", "MEMO_UPDATE", "LINK_MEMO", "CARD_CREATE", "LINK_CARD"]
    target_id: UUID | None = None
    expected_target_version: Revision | None = None
    reason: Reason
    request_id: UUID

    @model_validator(mode="after")
    def explicit_target(self):
        creating = self.mode in {"MEMO_CREATE", "CARD_CREATE"}
        if creating and (self.target_id is not None or self.expected_target_version is not None):
            raise ValueError("การสร้างรายการต้องไม่ระบุรายการเดิม")
        if not creating and (self.target_id is None or self.expected_target_version is None):
            raise ValueError("การเชื่อมรายการเดิมต้องระบุรหัสและรุ่นที่ตรวจสอบแล้ว")
        return self


class Hold(Input):
    expected_revision: Revision
    held: Annotated[bool, Field(strict=True)]
    reason: Reason


class Filters(Input):
    document_type: Literal["E_MEMO", "CARD_STATEMENT"] | None = None
    status: Literal["QUEUED", "RUNNING", "RETRY", "DRAFT", "CONFIRMED", "FAILED"] | None = None
    bud: Token | None = None
    month: Month | None = None
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=100000)


class SearchFilters(Input):
    q: Annotated[str, StringConstraints(min_length=1, max_length=300, pattern=r"^[^\x00]*$")]
    series: Literal["BUD", "CORPORATE"] | None = None
    bud: Token | None = None
    month: Month | None = None
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=100000)


def without_storage(value):
    if isinstance(value, dict):
        return {key: without_storage(item) for key, item in value.items() if key != "storage_key"}
    if isinstance(value, list):
        return [without_storage(item) for item in value]
    return value


def validation_locations(detail):
    """Expose only fixed validation codes and bounded locations, never SQL/source text."""
    messages = {
        "PAGE_COUNT_MISMATCH": "จำนวนหน้าหลักฐานไม่ครบ", "INVALID_PAGE": "ข้อมูลหน้าหลักฐานไม่ถูกต้อง",
        "MEMO_FIELDS_MISMATCH": "ข้อมูลบันทึกข้อความยังไม่ตรงหลักฐาน", "FIELD_SOURCE_MISSING": "ยังระบุหน้าหลักฐานไม่ครบ",
        "CONTROL_MISMATCH": "ข้อมูลควบคุมยังไม่ตรงหลักฐาน", "ROW_COUNT_MISMATCH": "จำนวนรายการไม่ครบ",
        "DUPLICATE_OCCURRENCE": "ลำดับรายการซ้ำ", "ROW_SOURCE_MISMATCH": "รายการยังไม่ตรงหลักฐาน",
        "INVALID_AMOUNT": "จำนวนเงินไม่ถูกต้อง", "PAGE_ROW_COUNT_MISMATCH": "จำนวนรายการในหน้าไม่ครบ",
        "NET_TOTAL_MISMATCH": "ยอดรวมยังไม่ตรงใบแจ้งยอด", "CONTROL_MEANING_UNCONFIRMED": "ยังไม่ยืนยันความหมายยอดรวม",
    }
    try:
        issues = json.loads(detail).get("issues", [])
    except (ValueError, TypeError, AttributeError):
        return []
    if not isinstance(issues, list):
        return []
    output = []
    for issue in issues[:100]:
        if not isinstance(issue, dict) or not isinstance(issue.get("code"), str) or issue["code"] not in messages:
            continue
        item = {"code": issue["code"], "message": messages[issue["code"]]}
        for key in ("page", "occurrence"):
            if type(issue.get(key)) is int and 1 <= issue[key] <= 5000:
                item[key] = issue[key]
        if isinstance(issue.get("field"), str) and issue["field"] in {*MemoFields.model_fields, *Controls.model_fields}:
            item["field"] = issue["field"]
        output.append(item)
    return output


def byte_range(value, size):
    if value is None:
        return 0, size - 1, 200
    match = re.fullmatch(r"bytes=([0-9]*)-([0-9]*)", value)
    if not match or not any(match.groups()) or size <= 0:
        raise ValueError("Invalid byte range")
    first, last = match.groups()
    if not first:
        length = int(last)
        if length <= 0:
            raise ValueError("Invalid byte range")
        return max(0, size - length), size - 1, 206
    start, end = int(first), min(int(last), size - 1) if last else size - 1
    if start >= size or end < start:
        raise ValueError("Invalid byte range")
    return start, end, 206


class AuditedPDF(Response):
    def __init__(self, content, status_code, headers, delivered, *, media_type="application/pdf"):
        super().__init__(content, status_code=status_code, headers=headers, media_type=media_type)
        self.delivered = delivered

    async def __call__(self, scope, receive, send):
        sent, completed = 0, False

        async def counted(message):
            nonlocal sent, completed
            await send(message)
            if message["type"] == "http.response.body":
                sent += len(message.get("body", b""))
                completed = not message.get("more_body", False)

        try:
            await super().__call__(scope, receive, counted)
        finally:
            with anyio.CancelScope(shield=True):
                outcome = "PARTIAL" if sent and (self.status_code == 206 or not completed) else "SERVED" if completed else "FAILED"
                await self.delivered(outcome, sent)


def register_archive_routes(app, authentication, database, settings):
    prefix = "/v1/admin/ads/archive"

    def fixed_local():
        target = urlparse(settings.database_url)
        return settings.environment == "local" and target.hostname == "127.0.0.1" and target.port == 55432 and target.path == "/sena_hub_local"

    def action_for(request):
        tail = request.url.path.rsplit("/", 1)[-1]
        if tail == "file":
            return "DOWNLOAD" if request.query_params.get("download") == "true" else "PREVIEW"
        if tail == "page":
            return "PREVIEW"
        if request.method == "POST":
            return {"archive": "RECEIVE", "retry": "RETRY", "confirm": "CONFIRM", "apply": "APPLY", "hold": "HOLD"}.get(tail, "RECEIVE")
        return "SEARCH" if tail == "search" else "LIST" if tail in {"archive", "fixtures"} else "DETAIL"

    async def audit(request, actor, outcome, *, document_id=None, version_id=None, page=None, count=None):
        request.state.archive_audited = True
        if not fixed_local():
            logging.getLogger("sena_hub_api").warning("Archive audit refused outside fixed local TEST")
            return
        request_id = getattr(request.state, "archive_request_id", None) or uuid4()
        request.state.archive_request_id = request_id
        payload = {"action": action_for(request), "outcome": outcome, "original_role": actor.role if actor else "anonymous",
                   "original_actor_id": str(actor.id) if actor else None, "document_id": str(document_id) if document_id else None,
                   "version_id": str(version_id) if version_id else None, "page": page, "request_id": str(request_id), "bytes": count}
        # The base role may call this insert-only audit RPC, even after a denial.
        audit_actor = actor or Actor(UUID(int=0), "viewer")
        async with database(request, audit_actor, audit_only=True) as db:
            await db.fetchval("SELECT ads.archive_access($1::jsonb)", payload)

    @app.middleware("http")
    async def archive_denials(request, call_next):
        response = await call_next(request)
        if (request.url.path == prefix or request.url.path.startswith(prefix + "/")) and response.status_code >= 400 and not getattr(request.state, "archive_audited", False):
            actor = getattr(request.state, "archive_actor", None)
            if actor is None and fixed_local():
                try:
                    actor = await authentication(request)
                except HTTPException:
                    pass
            await audit(request, actor, "DENIED")
        return response

    async def staff(request: Request):
        if not fixed_local():
            await audit(request, None, "DENIED")
            raise failure(403, "archive_forbidden", "คลังเอกสารเปิดเฉพาะระบบทดสอบภายในเครื่อง")
        try:
            actor = await authentication(request)
        except HTTPException:
            await audit(request, None, "DENIED")
            raise
        request.state.archive_actor = actor
        try:
            require_content(request, error_code="archive_forbidden")
        except HTTPException:
            await audit(request, actor, "DENIED")
            raise
        return actor

    @asynccontextmanager
    async def connection(request, actor):
        try:
            async with database(request, actor) as db:
                yield db
        except asyncpg.PostgresError as error:
            await audit(request, actor, "DENIED" if error.sqlstate in {"42501", "P0002"} else "FAILED")
            errors = {
                "40001": (409, "archive_stale", "ข้อมูลเปลี่ยนแล้ว กรุณาโหลดรุ่นล่าสุดก่อนดำเนินการ"),
                "23505": (409, "archive_conflict", "มีรายการนี้แล้ว กรุณาตรวจประวัติการนำไปใช้"),
                "42501": (403, "archive_forbidden", "สิทธิ์หรือสถานะเอกสารไม่อนุญาตให้ดำเนินการนี้"),
                "P0002": (404, "archive_not_found", "ไม่พบเอกสารที่มีสิทธิ์เข้าถึง"),
            }
            if error.sqlstate in errors:
                raise failure(*errors[error.sqlstate]) from None
            if error.sqlstate in {"22023", "22P02", "23514", "23503", "22003", "22007"}:
                response = failure(422, "invalid_archive_data", "ข้อมูลยังไม่ผ่านการตรวจสอบ กรุณาตรวจหน้า หลักฐาน ยอดรวม และรายการอ้างอิง")
                locations = validation_locations(error.detail)
                if locations:
                    response.detail["details"] = locations
                raise response from None
            raise

    def check_query(request, allowed=()):
        if set(request.query_params) - set(allowed) or any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise failure(422, "invalid_archive_filter", "ตัวกรองไม่รองรับหรือระบุชื่อซ้ำ")

    async def rpc(request, actor, statement, *args, document_id=None):
        async with connection(request, actor) as db:
            value = await db.fetchval(statement, *args)
        result = json.loads(value) if isinstance(value, str) else value
        if result is None:
            await audit(request, actor, "DENIED", document_id=document_id)
            raise failure(404, "archive_not_found", "ไม่พบเอกสารที่มีสิทธิ์เข้าถึง")
        await audit(request, actor, "ALLOWED", document_id=document_id)
        return {"data": without_storage(result)}

    @app.get(prefix + "/fixtures")
    async def fixtures(request: Request, actor: Actor = Depends(staff)):
        check_query(request)
        return await rpc(request, actor, "SELECT ads.archive_fixtures()::text")

    @app.get(prefix + "/search")
    async def search(request: Request, filters: Annotated[SearchFilters, Query()], actor: Actor = Depends(staff)):
        check_query(request, SearchFilters.model_fields)
        criteria = filters.model_dump(mode="json", exclude_none=True)
        return await rpc(request, actor, "SELECT ads.archive_search($1,$2::jsonb)::text", criteria.pop("q"), criteria)

    @app.get(prefix)
    async def listing(request: Request, filters: Annotated[Filters, Query()], actor: Actor = Depends(staff)):
        check_query(request, Filters.model_fields)
        return await rpc(request, actor, "SELECT ads.archive_read($1,$2::jsonb)::text", None, filters.model_dump(mode="json", exclude_none=True))

    @app.get(prefix + "/{document_id}")
    async def detail(document_id: UUID, request: Request, actor: Actor = Depends(staff)):
        check_query(request)
        return await rpc(request, actor, "SELECT ads.archive_read($1,$2::jsonb)::text", document_id, {}, document_id=document_id)

    @app.post(prefix, status_code=201)
    async def receive(body: Receive, request: Request, actor: Actor = Depends(staff)):
        check_query(request)
        return await rpc(request, actor, "SELECT ads.archive_receive($1::jsonb)::text", body.model_dump(mode="json", exclude_none=True), document_id=body.document_id)

    def command_route(action, model):
        async def command(document_id: UUID, body, request: Request, actor: Actor = Depends(staff)):
            check_query(request)
            return await rpc(request, actor, "SELECT ads.archive_command($1,$2,$3::jsonb)::text", action, document_id,
                             body.model_dump(mode="json", exclude_unset=True), document_id=document_id)
        command.__annotations__["body"] = model
        app.add_api_route(prefix + "/{document_id}/" + action, command, methods=["POST"], name="archive_" + action)

    command_route("retry", Retry)
    command_route("confirm", Confirm)
    command_route("apply", Apply)
    command_route("hold", Hold)

    async def version_bytes(request, actor, document_id, version_id, page, *, statement_only=False):
        async with connection(request, actor) as db:
            raw = await db.fetchval("SELECT ads.archive_read($1,$2::jsonb)::text", document_id, {})
        context = json.loads(raw) if isinstance(raw, str) else raw
        version = next((item for item in (context or {}).get("versions", []) if str(item["id"]) == str(version_id)), None)
        if version is None or page > version["page_count"] or statement_only and context.get("document_type") != "CARD_STATEMENT":
            await audit(request, actor, "DENIED", document_id=document_id, version_id=version_id, page=page)
            raise failure(404, "archive_not_found", "ไม่พบหน้าหรือรุ่นเอกสารที่มีสิทธิ์เข้าถึง")
        await audit(request, actor, "ALLOWED", document_id=document_id, version_id=version_id, page=page)
        from .document_storage import read_document
        try:
            content = await anyio.to_thread.run_sync(read_document, version["storage_key"], version["sha256"])
            if len(content) != version["byte_size"]:
                raise ValueError("Document size changed")
        except Exception:
            await audit(request, actor, "FAILED", document_id=document_id, version_id=version_id, page=page, count=0)
            raise failure(503, "archive_file_unavailable", "เอกสารยังไม่พร้อมเปิด กรุณาตรวจการจัดเก็บภายในเครื่อง") from None
        return content

    @app.get(prefix + "/{document_id}/file")
    async def file(document_id: UUID, version_id: UUID, request: Request, page: Annotated[int, Query(ge=1, le=1000)] = 1,
                   download: Literal["true", "false"] = "false", actor: Actor = Depends(staff)):
        check_query(request, ("version_id", "page", "download"))
        content = await version_bytes(request, actor, document_id, version_id, page)
        try:
            first, last, status = byte_range(request.headers.get("range"), len(content))
        except ValueError:
            await audit(request, actor, "DENIED", document_id=document_id, version_id=version_id, page=page, count=0)
            return Response(status_code=416, headers={"Content-Range": f"bytes */{len(content)}", "Cache-Control": "no-store"})
        headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN",
                   "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'self'", "Accept-Ranges": "bytes",
                   "Content-Disposition": f"{'attachment' if download == 'true' else 'inline'}; filename=\"document-{version_id}.pdf\""}
        if status == 206:
            headers["Content-Range"] = f"bytes {first}-{last}/{len(content)}"

        async def delivered(outcome, count):
            await audit(request, actor, outcome, document_id=document_id, version_id=version_id, page=page, count=count)

        return AuditedPDF(content[first:last + 1], status, headers, delivered)

    @app.get(prefix + "/{document_id}/page")
    async def page_image(document_id: UUID, version_id: UUID, request: Request,
                         page: Annotated[int, Query(ge=1, le=1000)] = 1, actor: Actor = Depends(staff)):
        check_query(request, ("version_id", "page"))
        content = await version_bytes(request, actor, document_id, version_id, page, statement_only=True)
        from .document_storage import render_statement_page
        try:
            image = await anyio.to_thread.run_sync(render_statement_page, content, page)
        except Exception:
            await audit(request, actor, "FAILED", document_id=document_id, version_id=version_id, page=page, count=0)
            raise failure(503, "archive_page_unavailable", "ภาพหน้าหลักฐานยังไม่พร้อม กรุณาเปิดไฟล์ต้นฉบับเพื่อตรวจสอบ") from None
        headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
                   "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'none'",
                   "Cross-Origin-Resource-Policy": "same-origin",
                   "Content-Disposition": f'inline; filename="document-{version_id}-page-{page}.png"'}

        async def delivered(outcome, count):
            await audit(request, actor, outcome, document_id=document_id, version_id=version_id, page=page, count=count)

        return AuditedPDF(image, 200, headers, delivered, media_type="image/png")
