"""Local synthetic DW read-back and private, separate Hub workflow."""
from contextlib import asynccontextmanager
import json
from typing import Annotated, Literal
from urllib.parse import urlparse
from uuid import UUID

import asyncpg
from fastapi import Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .auth import Actor, failure
from .content_permissions import require_content
from .finance import Month

Key = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
TextFilter = Annotated[str, StringConstraints(min_length=1, max_length=200)]
Owner = Literal["online_staff", "admin", "unassigned"] | UUID


class Filters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    month: Month | None = None
    agency: TextFilter | None = None
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=100000)


class ActualFilters(Filters):
    scope: TextFilter | None = None
    bud: TextFilter | None = None


class DocumentFilters(Filters):
    owner: Owner | None = None
    status: Literal["MISSING", "REFERENCE_RECORDED"] | None = None
    overdue: Literal["unknown", "true", "false"] | None = None


class FindingFilters(Filters):
    owner: Owner | None = None
    control_code: Literal["C5", "C6"] | None = None
    state: Literal["OPEN", "ACKNOWLEDGED", "RESOLVED"] | None = None
    condition: Literal["PRESENT", "CLEARED", "UNAVAILABLE"] | None = None


class SnapshotInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_snapshot_id: UUID


class WorkflowInput(SnapshotInput):
    expected_version: Annotated[int, Field(strict=True, ge=0, le=2147483646)]
    state: Literal["OPEN", "ACKNOWLEDGED", "RESOLVED"]
    owner_action: Literal["KEEP", "SELF", "CLEAR"] = "KEEP"
    note: Annotated[str, StringConstraints(strict=True, max_length=2000)] = ""

    @model_validator(mode="after")
    def valid_workflow(self):
        if "\x00" in self.note or (self.state == "RESOLVED" and not self.note.strip()):
            raise ValueError("กรุณาระบุเหตุผลที่ไม่ว่างเมื่อบันทึกว่าดำเนินการแล้ว")
        return self


class FollowUpInput(SnapshotInput):
    expected_source_version: Key
    template_version: Literal["1"]
    month: Month | None = None


def register_actuals_routes(app, authentication, database, settings):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        require_content(request, error_code="actuals_forbidden")
        target = urlparse(settings.database_url)
        if settings.environment != "local" or target.hostname != "127.0.0.1" or target.port != 55432 or target.path != "/sena_hub_local":
            raise failure(403, "actuals_test_only", "ข้อมูลตัวอย่างนี้เปิดเฉพาะระบบทดสอบภายในเครื่อง")
        return actor

    @asynccontextmanager
    async def connection(request, actor):
        try:
            async with database(request, actor) as db:
                yield db
        except asyncpg.PostgresError as error:
            messages = {
                "40001": (409, "actuals_stale", "ข้อมูลเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก"),
                "42501": (403, "actuals_forbidden", "สิทธิ์ของคุณไม่อนุญาตให้ดำเนินการนี้"),
                "P0002": (404, "actuals_not_found", "ไม่พบรายการที่มีสิทธิ์เข้าถึง"),
                "22023": (422, "invalid_actuals_data", "กรุณาตรวจรูปแบบข้อมูลและเหตุผล"),
                "22P02": (422, "invalid_actuals_data", "รูปแบบรหัสรายการไม่ถูกต้อง"),
                "23514": (422, "invalid_actuals_data", "ข้อมูลยังไม่ผ่านเงื่อนไขที่กำหนด"),
            }
            if error.sqlstate in messages:
                raise failure(*messages[error.sqlstate]) from None
            raise

    async def read(request, actor, resource, key=None, filters=None):
        async with connection(request, actor) as db:
            value = await db.fetchval("SELECT ads.actuals_read($1,$2,$3::jsonb)::text", resource, key, filters or {})
        result = json.loads(value) if isinstance(value, str) else value
        if result is None:
            raise failure(404, "actuals_not_found", "ไม่พบรายการที่มีสิทธิ์เข้าถึง")
        return {"data": result}

    prefix = "/v1/admin/ads"

    @app.get(prefix + "/actuals", name="actuals_list")
    async def actuals(request: Request, filters: Annotated[ActualFilters, Query()], actor: Actor = Depends(staff)):
        return await read(request, actor, "actuals", filters=filters.model_dump(mode="json", exclude_none=True))

    @app.get(prefix + "/actuals/{line_id}", name="actuals_detail")
    async def actuals_detail(line_id: UUID, request: Request, month: Month | None = None, actor: Actor = Depends(staff)):
        if set(request.query_params) - {"month"}:
            raise failure(422, "invalid_actuals_filter", "ไม่รองรับตัวกรองนี้")
        return await read(request, actor, "actuals", str(line_id), {"month": month.isoformat()} if month else {})

    @app.get(prefix + "/document-tracking", name="actuals_documents")
    async def documents(request: Request, filters: Annotated[DocumentFilters, Query()], actor: Actor = Depends(staff)):
        return await read(request, actor, "document-tracking", filters=filters.model_dump(mode="json", exclude_none=True))

    @app.get(prefix + "/document-tracking/{key}", name="actuals_document_detail")
    async def document_detail(key: Key, request: Request, month: Month | None = None, actor: Actor = Depends(staff)):
        if set(request.query_params) - {"month"}:
            raise failure(422, "invalid_actuals_filter", "ไม่รองรับตัวกรองนี้")
        return await read(request, actor, "document-tracking", key, {"month": month.isoformat()} if month else {})

    @app.get(prefix + "/findings", name="actuals_findings")
    async def findings(request: Request, filters: Annotated[FindingFilters, Query()], actor: Actor = Depends(staff)):
        return await read(request, actor, "findings", filters=filters.model_dump(mode="json", exclude_none=True))

    @app.get(prefix + "/findings/{key}", name="actuals_finding_detail")
    async def finding_detail(key: Key, request: Request, actor: Actor = Depends(staff)):
        if request.query_params:
            raise failure(422, "invalid_actuals_filter", "ไม่รองรับตัวกรองนี้")
        return await read(request, actor, "findings", key)

    async def command(request, actor, action, key, body):
        if request.query_params:
            raise failure(422, "invalid_actuals_filter", "ไม่รองรับตัวกรองนี้")
        async with connection(request, actor) as db:
            value = await db.fetchval("SELECT ads.actuals_command($1,$2,$3::jsonb)::text", action, key, body.model_dump(mode="json"))
        return {"data": json.loads(value) if isinstance(value, str) else value}

    @app.post(prefix + "/findings/{key}/workflow", name="actuals_workflow")
    async def workflow(key: Key, body: WorkflowInput, request: Request, actor: Actor = Depends(staff)):
        return await command(request, actor, "workflow", key, body)

    @app.post(prefix + "/document-tracking/{key}/follow-ups", name="actuals_follow_up")
    async def follow_up(key: Key, body: FollowUpInput, request: Request, actor: Actor = Depends(staff)):
        return await command(request, actor, "follow-up", key, body)
