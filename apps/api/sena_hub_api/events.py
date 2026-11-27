"""SENA Event Hub API: 30-second post-deal events, co-join marketplace, R2 attachments, and change read-receipts."""
from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import Depends, Query, Request, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints

from .auth import Actor, failure

EventCategory = Literal["partner_booth", "project_onsite", "corporate_expo", "sub_business_event"]
ScopeType = Literal["corporate", "bud", "project_group", "project", "programme", "business"]
CostMode = Literal["free_invite", "fixed_slot", "proportional_split"]
EventState = Literal["scheduled", "postponed", "cancelled"]
DocKind = Literal["floor_plan", "venue_rules", "quotation", "artwork", "onsite_photo", "other"]
DocVisibility = Literal["operational", "finance_restricted"]

ShortText = Annotated[str, StringConstraints(max_length=300, pattern=r"^[^\x00]*$")]
NoteText = Annotated[str, StringConstraints(max_length=2000, pattern=r"^[^\x00]*$")]


class EventSaveBody(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    expected_revision: int = Field(default=0, ge=0, le=2147483647, strict=True)
    event_category: EventCategory = "partner_booth"
    title: Annotated[str, StringConstraints(min_length=1, max_length=300, pattern=r"^[^\x00]*$")]
    venue_name: Annotated[str, StringConstraints(min_length=1, max_length=300, pattern=r"^[^\x00]*$")]
    venue_zone: ShortText = ""
    province: Annotated[str, StringConstraints(max_length=120, pattern=r"^[^\x00]*$")] = "กรุงเทพมหานคร"
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    setup_notes: NoteText = ""
    host_scope_type: ScopeType = "bud"
    host_scope_id: Annotated[str, StringConstraints(min_length=1, max_length=200, pattern=r"^[^\x00]*$")]
    host_label: Annotated[str, StringConstraints(max_length=200, pattern=r"^[^\x00]*$")] = ""
    partner_org_name: ShortText = ""
    open_for_join: bool = Field(default=True, strict=True)
    join_deadline_at: AwareDatetime | None = None
    max_co_joiners: int | None = Field(default=None, ge=1, le=100, strict=True)
    cost_share_mode: CostMode = "free_invite"
    estimated_cost_thb: float | None = Field(default=None, ge=0, le=999999999999)
    memo_no: Annotated[str, StringConstraints(max_length=120, pattern=r"^[^\x00]*$")] | None = None
    campaign_code: Annotated[str, StringConstraints(max_length=120, pattern=r"^[^\x00]*$")] | None = None
    audience_visibility: Literal["internal_only", "public_web"] = "internal_only"
    contact_name: Annotated[str, StringConstraints(max_length=200, pattern=r"^[^\x00]*$")] = ""
    contact_phone: Annotated[str, StringConstraints(max_length=80, pattern=r"^[^\x00]*$")] = ""
    state: EventState = "scheduled"
    change_reason: Annotated[str, StringConstraints(max_length=1000, pattern=r"^[^\x00]*$")] = ""


class EventAttachmentBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asset_id: UUID
    doc_kind: DocKind = "floor_plan"
    visibility: DocVisibility | None = None
    title: ShortText = ""
    notify_change: bool = Field(default=False, strict=True)
    change_reason: Annotated[str, StringConstraints(max_length=1000, pattern=r"^[^\x00]*$")] = ""


class EventJoinBody(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    participant_scope_type: ScopeType
    participant_scope_id: Annotated[str, StringConstraints(min_length=1, max_length=200, pattern=r"^[^\x00]*$")]
    participant_label: Annotated[str, StringConstraints(max_length=200, pattern=r"^[^\x00]*$")] = ""
    staff_count: int = Field(default=1, ge=0, le=100, strict=True)
    booth_needs: Annotated[str, StringConstraints(max_length=500, pattern=r"^[^\x00]*$")] = ""
    shares_cost: bool = Field(default=False, strict=True)
    cost_share_thb: float | None = Field(default=None, ge=0, le=999999999999)
    memo_no: Annotated[str, StringConstraints(max_length=120, pattern=r"^[^\x00]*$")] | None = None
    contact_name: Annotated[str, StringConstraints(max_length=200, pattern=r"^[^\x00]*$")] = ""
    contact_phone: Annotated[str, StringConstraints(max_length=80, pattern=r"^[^\x00]*$")] = ""


class EventJoinDecisionBody(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    decision: Literal["approved", "declined", "withdrawn"]
    note: Annotated[str, StringConstraints(max_length=500, pattern=r"^[^\x00]*$")] | None = None
    cost_share_thb: float | None = Field(default=None, ge=0, le=999999999999)


class EventAckBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: Annotated[str, StringConstraints(max_length=500, pattern=r"^[^\x00]*$")] | None = None


def register_event_routes(app, authentication, database):
    def _require_internal_staff(request: Request, actor: Actor, *, write: bool = False) -> Actor:
        account = getattr(request.state, "account", {})
        caps = account.get("capabilities", {})
        tabs = caps.get("tabs", {})
        if (
            account.get("status") != "ACTIVE"
            or actor.agency_code
            or account.get("agency_code")
            or actor.role not in {"viewer", "editor", "publisher", "admin", "online_staff"}
            or not any(
                tabs.get(tab, {}).get("view") is True
                for tab in ("projects", "brands", "knowledge", "promotions", "releases", "registry", "finance")
            )
        ):
            raise failure(403, "forbidden", "บัญชีนี้ไม่มีสิทธิ์เข้าถึงระบบอีเวนต์เครือ")
        if write and not (
            actor.role in {"editor", "publisher", "admin", "online_staff"}
            or any(tabs.get(tab, {}).get("edit") is True for tab in ("projects", "knowledge", "promotions", "registry", "finance"))
        ):
            raise failure(403, "forbidden", "บัญชีนี้ไม่มีสิทธิ์สร้างหรือแก้ไขอีเวนต์")
        return actor

    async def staff_reader(request: Request, actor: Actor = Depends(authentication)) -> Actor:
        return _require_internal_staff(request, actor, write=False)

    async def staff_writer(request: Request, actor: Actor = Depends(authentication)) -> Actor:
        return _require_internal_staff(request, actor, write=True)

    async def run_sql(request: Request, response: Response, actor: Actor, sql: str, *args):
        response.headers["Cache-Control"] = "private, no-store"
        try:
            async with database(request, actor) as conn:
                return {"data": await conn.fetchval(sql, *args)}
        except asyncpg.PostgresError as err:
            if err.sqlstate == "P0002":
                raise failure(404, "not_found", "ไม่พบรายการอีเวนต์ที่ระบุ") from None
            if err.sqlstate == "42501":
                raise failure(403, "forbidden", "ไม่มีสิทธิ์ดำเนินการกับอีเวนต์นี้") from None
            if err.sqlstate in {"40001", "23505"}:
                raise failure(409, "conflict", "ข้อมูลอีเวนต์มีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่") from None
            if err.sqlstate in {"23514", "22023", "23503"}:
                raise failure(422, "invalid_event_data", err.message or "ข้อมูลอีเวนต์ไม่ผ่านเงื่อนไขที่กำหนด") from None
            raise

    @app.get("/v1/admin/events/references")
    async def event_references(request: Request, response: Response, actor: Actor = Depends(staff_reader)):
        return await run_sql(request, response, actor, "SELECT hub.event_references()")

    @app.get("/v1/admin/events/alerts")
    async def event_alerts(
        request: Request,
        response: Response,
        only_mine: bool = Query(True),
        actor: Actor = Depends(staff_reader),
    ):
        return await run_sql(request, response, actor, "SELECT hub.event_ack_alerts($1)", only_mine)

    @app.get("/v1/admin/events")
    async def event_list(
        request: Request,
        response: Response,
        filter: Literal["all", "open_join", "upcoming", "changed", "mine"] = "all",
        q: str = Query("", max_length=150, pattern=r"^[^\x00-\x1f]*$"),
        scope: str | None = Query(None, max_length=220, pattern=r"^[^\x00-\x1f]*$"),
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0, le=100000),
        actor: Actor = Depends(staff_reader),
    ):
        return await run_sql(
            request,
            response,
            actor,
            "SELECT hub.event_list($1, $2, $3, $4, $5)",
            filter,
            q,
            scope,
            limit,
            offset,
        )

    @app.post("/v1/admin/events", status_code=201)
    async def event_create(
        body: EventSaveBody,
        request: Request,
        response: Response,
        actor: Actor = Depends(staff_writer),
    ):
        payload = body.model_dump(mode="json", exclude={"expected_revision"})
        return await run_sql(request, response, actor, "SELECT hub.event_save(NULL, 0, $1)", payload)

    @app.get("/v1/admin/events/{event_id}")
    async def event_read(event_id: UUID, request: Request, response: Response, actor: Actor = Depends(staff_reader)):
        return await run_sql(request, response, actor, "SELECT hub.event_read($1)", event_id)

    @app.put("/v1/admin/events/{event_id}")
    async def event_update(
        event_id: UUID,
        body: EventSaveBody,
        request: Request,
        response: Response,
        actor: Actor = Depends(staff_writer),
    ):
        payload = body.model_dump(mode="json", exclude={"expected_revision"})
        return await run_sql(
            request,
            response,
            actor,
            "SELECT hub.event_save($1, $2, $3)",
            event_id,
            body.expected_revision,
            payload,
        )

    @app.post("/v1/admin/events/{event_id}/attachments")
    async def event_attachment_add(
        event_id: UUID,
        body: EventAttachmentBody,
        request: Request,
        response: Response,
        actor: Actor = Depends(staff_writer),
    ):
        return await run_sql(
            request,
            response,
            actor,
            "SELECT hub.event_attachment_add($1, $2)",
            event_id,
            body.model_dump(mode="json", exclude_none=True),
        )

    @app.post("/v1/admin/events/attachments/{attachment_id}/remove")
    async def event_attachment_remove(
        attachment_id: UUID,
        request: Request,
        response: Response,
        actor: Actor = Depends(staff_writer),
    ):
        return await run_sql(request, response, actor, "SELECT hub.event_attachment_remove($1)", attachment_id)

    @app.post("/v1/admin/events/{event_id}/join")
    async def event_join(
        event_id: UUID,
        body: EventJoinBody,
        request: Request,
        response: Response,
        actor: Actor = Depends(staff_reader),
    ):
        return await run_sql(
            request,
            response,
            actor,
            "SELECT hub.event_join_save($1, $2)",
            event_id,
            body.model_dump(mode="json"),
        )

    @app.post("/v1/admin/events/participants/{participant_id}/decision")
    async def event_join_decision(
        participant_id: UUID,
        body: EventJoinDecisionBody,
        request: Request,
        response: Response,
        actor: Actor = Depends(staff_reader),
    ):
        return await run_sql(
            request,
            response,
            actor,
            "SELECT hub.event_join_decide($1, $2, $3, $4)",
            participant_id,
            body.decision,
            body.note,
            body.cost_share_thb,
        )

    @app.post("/v1/admin/events/alerts/{ack_id}/acknowledge")
    async def event_acknowledge(
        ack_id: UUID,
        body: EventAckBody,
        request: Request,
        response: Response,
        actor: Actor = Depends(staff_reader),
    ):
        return await run_sql(
            request,
            response,
            actor,
            "SELECT hub.event_acknowledge($1, $2)",
            ack_id,
            body.note,
        )
