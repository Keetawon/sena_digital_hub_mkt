"""Residential promotion drafts, reviewed snapshots and atomic releases.

PostgreSQL owns publication, expiry and rollback. No campaign naming or external
source edits are exposed here; request identities are supplied by authentication.
"""
from contextlib import asynccontextmanager
from decimal import Decimal
import json
import re
from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import Depends, Query, Request
from pydantic import AfterValidator, AwareDatetime, BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, model_validator

from .auth import Actor, failure
from .finance import Money, Reason, nonblank

Locale = Annotated[str, StringConstraints(pattern=r"^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$")]
Text = Annotated[str, StringConstraints(strict=True, max_length=20000, pattern=r"^[^\x00]*$")]
LocalizedText = dict[Locale, Text]
SourceId = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=200), AfterValidator(nonblank)]
Revision = Annotated[int, Field(strict=True, ge=1, le=2147483647)]
BenefitType = Literal["discount_amount", "discount_pct", "free_transfer_fee", "free_common_fee", "furniture", "cashback", "rate_subsidy", "gift", "other"]
BenefitUnit = Literal["THB", "percent", "months", "items"]


def offset_timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?(?:Z|[+-][0-9]{2}:[0-9]{2})", value):
        raise ValueError("เวลาต้องเป็นข้อความ ISO 8601 พร้อมเขตเวลา")
    return value


OffsetTimestamp = Annotated[AwareDatetime, BeforeValidator(offset_timestamp)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DraftFields(Input):
    title: LocalizedText = Field(default_factory=dict)
    summary: LocalizedText = Field(default_factory=dict)
    conditions_public: LocalizedText = Field(default_factory=dict)
    legal_terms: LocalizedText = Field(default_factory=dict)
    disclaimer: LocalizedText = Field(default_factory=dict)
    benefit_type: BenefitType = "other"
    benefit_value: Money | None = None
    benefit_unit: BenefitUnit | None = None
    stackable: Annotated[bool, Field(strict=True)] = False
    priority: Annotated[int, Field(strict=True, ge=0, le=2147483647)] = 100
    starts_at: OffsetTimestamp
    ends_at: OffsetTimestamp
    source_offer_key: SourceId | None = None

    @model_validator(mode="after")
    def coherent(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น")
        if self.benefit_type == "discount_pct" and self.benefit_value is not None and Decimal(self.benefit_value) > 100:
            raise ValueError("ส่วนลดร้อยละต้องไม่เกิน 100")
        return self


class CreatePromotion(DraftFields):
    project_id: UUID
    code: Annotated[str, StringConstraints(strict=True, pattern=r"^[A-Z0-9][A-Z0-9_-]{0,79}$")]


class PatchPromotion(Input):
    expected_revision: Revision
    title: LocalizedText | None = None
    summary: LocalizedText | None = None
    conditions_public: LocalizedText | None = None
    legal_terms: LocalizedText | None = None
    disclaimer: LocalizedText | None = None
    benefit_type: BenefitType | None = None
    benefit_value: Money | None = None
    benefit_unit: BenefitUnit | None = None
    stackable: Annotated[bool | None, Field(strict=True)] = None
    priority: Annotated[int | None, Field(strict=True, ge=0, le=2147483647)] = None
    starts_at: OffsetTimestamp | None = None
    ends_at: OffsetTimestamp | None = None
    source_offer_key: SourceId | None = None

    @model_validator(mode="after")
    def explicit_change(self):
        changed = self.model_fields_set - {"expected_revision"}
        nullable = {"benefit_value", "benefit_unit", "source_offer_key"}
        if not changed or any(getattr(self, key) is None for key in changed - nullable):
            raise ValueError("ระบุฟิลด์ที่ต้องการแก้ไข ข้อความว่างให้ใช้แผนที่ภาษาแทน null")
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น")
        if self.benefit_type == "discount_pct" and self.benefit_value is not None and Decimal(self.benefit_value) > 100:
            raise ValueError("ส่วนลดร้อยละต้องไม่เกิน 100")
        return self


class ReviewPromotion(Input):
    expected_revision: Revision
    review_revision: Revision | None = None
    review_type: Literal["DATA", "LEGAL"]
    decision: Literal["APPROVED", "REVOKED"]
    evidence: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=4000), AfterValidator(nonblank)]
    change_reason: Reason

    @model_validator(mode="after")
    def current_approval(self):
        if self.decision == "APPROVED" and self.review_revision not in (None, self.expected_revision):
            raise ValueError("อนุมัติได้เฉพาะฉบับร่างปัจจุบัน")
        return self


class PublishPromotion(Input):
    expected_revision: Revision
    expected_published_version_id: UUID | None
    change_reason: Reason


class ReleaseMember(Input):
    entity_type: Literal["brand", "project", "promotion"]
    entity_id: UUID
    expected_updated_at: OffsetTimestamp | None = None
    expected_revision: Revision | None = None
    expected_published_version_id: UUID | None

    @model_validator(mode="after")
    def version_for_entity(self):
        if self.entity_type == "promotion":
            valid = self.expected_revision is not None and self.expected_updated_at is None
        else:
            valid = self.expected_updated_at is not None and self.expected_revision is None
        if not valid:
            raise ValueError("กรุณาระบุรุ่นฉบับร่างตามประเภทข้อมูล")
        return self


class PublishRelease(Input):
    demo_mode: Annotated[bool, Field(strict=True)] = False
    members: list[ReleaseMember] = Field(min_length=1, max_length=100)
    change_reason: Reason

    @model_validator(mode="after")
    def distinct_members(self):
        identities = {(member.entity_type, member.entity_id) for member in self.members}
        if len(identities) != len(self.members):
            raise ValueError("ชุดเผยแพร่ต้องไม่ระบุรายการซ้ำ")
        return self


class RollbackRelease(Input):
    change_reason: Reason


class PromotionFilters(Input):
    project_id: UUID | None = None
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=100000)


def register_promotion_routes(app, admin, writer, publisher, consumer, database, settings):
    @asynccontextmanager
    async def connection(request, actor):
        try:
            async with database(request, actor) as db:
                yield db
        except asyncpg.PostgresError as error:
            if error.sqlstate in {"22023", "22P02", "23503"}:
                raise failure(422, "invalid_promotion_data", "กรุณาตรวจข้อมูลโปรโมชั่น โครงการ และช่วงเวลา") from None
            raise

    def query(request, allowed=()):
        if set(request.query_params) - set(allowed) or any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise failure(422, "invalid_promotion_filter", "ตัวกรองไม่รองรับหรือระบุชื่อซ้ำ")

    async def rpc(request, actor, statement, *args, mutation=False):
        if mutation and settings.environment != "local":
            raise failure(403, "promotion_demo_only", "ขั้นตอนตรวจสอบตัวอย่างเปิดใช้เฉพาะระบบภายในเครื่อง")
        async with connection(request, actor) as db:
            value = await db.fetchval(statement, *args)
        result = json.loads(value) if isinstance(value, str) else value
        if result is None:
            raise failure(404, "promotion_not_found", "ไม่พบรายการที่มีสิทธิ์เข้าถึง")
        return {"data": result}

    prefix = "/v1/admin"

    @app.get(prefix + "/promotions")
    async def promotion_list(request: Request, filters: Annotated[PromotionFilters, Query()], actor: Actor = Depends(admin)):
        query(request, ("project_id", "limit", "offset"))
        return await rpc(request, actor, "SELECT hub.promotion_read($1,$2::jsonb)::text", None, filters.model_dump(mode="json", exclude_none=True))

    @app.get(prefix + "/promotions/{promotion_id}")
    async def promotion_detail(promotion_id: UUID, request: Request, actor: Actor = Depends(admin)):
        query(request)
        return await rpc(request, actor, "SELECT hub.promotion_read($1,$2::jsonb)::text", promotion_id, {})

    async def command(request, actor, action, promotion_id, body):
        query(request)
        return await rpc(request, actor, "SELECT hub.promotion_command($1,$2,$3::jsonb)::text", action, promotion_id,
                         body.model_dump(mode="json", exclude_unset=isinstance(body, PatchPromotion)), mutation=True)

    @app.post(prefix + "/promotions", status_code=201)
    async def promotion_create(body: CreatePromotion, request: Request, actor: Actor = Depends(writer)):
        return await command(request, actor, "create", None, body)

    @app.patch(prefix + "/promotions/{promotion_id}")
    async def promotion_update(promotion_id: UUID, body: PatchPromotion, request: Request, actor: Actor = Depends(writer)):
        return await command(request, actor, "update", promotion_id, body)

    @app.post(prefix + "/promotions/{promotion_id}/review")
    async def promotion_review(promotion_id: UUID, body: ReviewPromotion, request: Request, actor: Actor = Depends(publisher)):
        return await command(request, actor, "review", promotion_id, body)

    @app.post(prefix + "/promotions/{promotion_id}/publish")
    async def promotion_publish(promotion_id: UUID, body: PublishPromotion, request: Request, actor: Actor = Depends(publisher)):
        return await command(request, actor, "publish", promotion_id, body)

    @app.post(prefix + "/promotions/{promotion_id}/withdraw")
    async def promotion_withdraw(promotion_id: UUID, body: PublishPromotion, request: Request, actor: Actor = Depends(publisher)):
        return await command(request, actor, "withdraw", promotion_id, body)

    @app.get(prefix + "/releases/candidates")
    async def release_candidates(request: Request, demo_mode: Literal["true", "false"] = "false", actor: Actor = Depends(admin)):
        query(request, ("demo_mode",))
        return await rpc(request, actor, "SELECT hub.release_candidates($1)::text", demo_mode == "true")

    @app.get(prefix + "/releases")
    async def release_list(request: Request, actor: Actor = Depends(admin)):
        query(request)
        return await rpc(request, actor, "SELECT hub.release_read($1)::text", None)

    @app.get(prefix + "/releases/{release_id}")
    async def release_detail(release_id: UUID, request: Request, actor: Actor = Depends(admin)):
        query(request)
        return await rpc(request, actor, "SELECT hub.release_read($1)::text", release_id)

    @app.post(prefix + "/releases/publish")
    async def release_publish(body: PublishRelease, request: Request, actor: Actor = Depends(publisher)):
        query(request)
        return await rpc(request, actor, "SELECT hub.release_publish($1::jsonb,$2,$3)::text",
                         [member.model_dump(mode="json") for member in body.members], body.change_reason, body.demo_mode, mutation=True)

    @app.post(prefix + "/releases/{release_id}/rollback")
    async def release_rollback(release_id: UUID, body: RollbackRelease, request: Request, actor: Actor = Depends(publisher)):
        query(request)
        return await rpc(request, actor, "SELECT hub.release_rollback($1,$2)::text", release_id, body.change_reason, mutation=True)


    @app.get("/v1/promotions")
    async def published_promotions(request: Request, project_id: Annotated[SourceId | None, Query()] = None,
                                   locale: Annotated[Locale, Query()] = "th", actor: Actor = Depends(consumer)):
        query(request, ("project_id", "locale"))
        async with connection(request, actor) as db:
            # Eligibility and stacking are resolved by the view before filtering.
            rows = await db.fetch("SELECT payload,version_id,published_at FROM public_api.promotions "
                                  "WHERE ($1::text IS NULL OR public_project_id=$1) "
                                  "ORDER BY public_project_id,priority,promotion_id", project_id)
        items = []
        for row in rows:
            payload = row["payload"]
            if isinstance(payload, str):
                payload = json.loads(payload)
            payload = dict(payload)
            fallback = []
            for field in ("title", "summary", "conditions_public", "legal_terms", "disclaimer"):
                values = payload.get(field, {})
                if locale != "th" and not values.get(locale):
                    fallback.append(field)
                payload[field] = values.get(locale) or values.get("th", "")
            # Contract failures must not emit a promotion without its legal context.
            if not payload["legal_terms"].strip() or not payload["disclaimer"].strip():
                raise failure(503, "promotion_contract_invalid", "ข้อมูลเงื่อนไขโปรโมชั่นยังไม่ครบถ้วน")
            items.append({**payload, "meta": {"version_id": row["version_id"], "published_at": row["published_at"],
                                              "locale": locale, "is_fallback_locale": bool(fallback),
                                              "fallback_indicator": {"missing": fallback}, "cache_ttl": 0}})
        return {"data": items, "meta": {"timezone": "Asia/Bangkok", "locale": locale, "cache_ttl": 0}}
