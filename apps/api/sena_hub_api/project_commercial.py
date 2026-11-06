"""Versioned project disclosures, sales terms, programmes and construction.

The database owns review, source comparisons and private document access.
"""
from __future__ import annotations

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .auth import Actor, failure
from .commercial_types import LocalizedText
from .content_permissions import require_content
from .unit_types import UnitDecision, UnitRevision

Amount = Annotated[float, Field(strict=True, ge=0, le=999999999999.99)]
Percent = Annotated[float, Field(strict=True, ge=0, le=100)]
Text = Annotated[str, StringConstraints(strict=True, max_length=4000)]
Kind = Literal["disclosures", "sales-terms", "programmes", "construction"]


class CommercialRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    ai_exposure: Literal["open", "web_only", "internal"] = "web_only"


class Disclosure(CommercialRecord):
    kind: Literal["disclosures"]
    owner_company: LocalizedText = Field(default_factory=dict)
    owner_address: LocalizedText = Field(default_factory=dict)
    registered_capital: Amount | None = None
    paid_capital: Amount | None = None
    managing_director: LocalizedText = Field(default_factory=dict)
    legal_project_name: LocalizedText = Field(default_factory=dict)
    location_text: LocalizedText = Field(default_factory=dict)
    land_area_sqwah: Amount | None = None
    title_deeds: list[Annotated[str, StringConstraints(min_length=1, max_length=200)]] = Field(default_factory=list, max_length=100)
    land_numbers: list[Annotated[str, StringConstraints(min_length=1, max_length=200)]] = Field(default_factory=list, max_length=100)
    encumbrance: Literal["none", "mortgage"] | None = None
    bank: LocalizedText = Field(default_factory=dict)
    building_description: LocalizedText = Field(default_factory=dict)
    building_count: Annotated[int, Field(strict=True, ge=0, le=10000)] | None = None
    unit_total: Annotated[int, Field(strict=True, ge=0, le=1000000)] | None = None
    eia_status: Literal["not_required", "pending", "approved"] | None = None
    eia_approval_date: date | None = None
    construction_start_year: Annotated[int, Field(strict=True, ge=1900, le=2200)] | None = None
    construction_completion_year: Annotated[int, Field(strict=True, ge=1900, le=2200)] | None = None
    notes: LocalizedText = Field(default_factory=dict)
    basis: Literal["mkt_entered", "legal_document", "legal_approved", "website_import"] = "mkt_entered"
    legal_document_asset_id: UUID | None = None
    legal_doc_ref: Text | None = None
    legal_doc_date: date | None = None
    legal_reviewed_by: Text | None = None
    legal_reviewed_at: date | None = None
    override_reason: Text | None = None


class SalesTerms(CommercialRecord):
    kind: Literal["sales-terms"]
    booking_fee: Amount | None = None
    contract_fee: Amount | None = None
    down_payment: Amount | None = None
    installment_from: Amount | None = None
    installment_basis: LocalizedText = Field(default_factory=dict)
    interest_rate: Percent | None = None
    rate_period: LocalizedText = Field(default_factory=dict)
    lender: LocalizedText = Field(default_factory=dict)
    conditions: LocalizedText = Field(default_factory=dict)
    valid_from: date
    valid_to: date


class Programme(CommercialRecord):
    kind: Literal["programmes"]
    programme_key: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{0,79}$")]
    participating: Annotated[bool, Field(strict=True)] | None = None
    monthly_from: Amount | None = None
    basis: LocalizedText = Field(default_factory=dict)
    units_offered: None = None  # REM contract pending IT; never invent a value.
    as_of: date


class Construction(CommercialRecord):
    kind: Literal["construction"]
    component: Literal["overall", "structure", "architecture", "systems", "landscape", "other"]
    percent: Percent
    as_of: date | None = None
    source: Literal["construction", "mkt", "website_import"]

    @model_validator(mode="after")
    def require_effective_date(self):
        if self.as_of is None and (self.source != "website_import" or self.ai_exposure != "internal"):
            raise ValueError("ระบุวันที่ของความคืบหน้า หรือเก็บข้อมูลเว็บไซต์ที่ยังไม่ทราบวันที่ไว้ภายใน")
        return self


class SaveCommercial(UnitRevision):
    record: Annotated[Disclosure | SalesTerms | Programme | Construction, Field(discriminator="kind")]


def register_project_commercial_routes(app, authentication, database):
    prefix = "/v1/admin/projects/{public_id}/commercial"

    async def staff(request: Request, actor: Actor = Depends(authentication)):
        require_content(request)
        return actor

    async def call(request, actor, sql, *args, reason=None):
        async with database(request, actor) as connection:
            await connection.execute("select set_config('app.content_review_reason',$1,true)", reason or '')
            return {"data": await connection.fetchval(sql, *args)}

    async def save(public_id, kind, record_id, body, request, actor):
        if kind != body.record.kind:
            raise failure(422, "commercial_kind", "ประเภทข้อมูลไม่ตรงกับรายการ")
        imported = (isinstance(body.record, Disclosure) and body.record.basis == "website_import"
                    or isinstance(body.record, Construction) and body.record.source == "website_import")
        async with database(request, actor) as connection:
            if imported:
                await connection.fetchval("select hub.require_permission('projects','edit')")
                table = "project_disclosures" if kind == "disclosures" else "project_progress"
                exists = await connection.fetchval(
                    f"select exists(select 1 from hub.{table} r join hub.projects p on p.id=r.project_id "
                    "where r.id=$1 and p.public_project_id=$2 and r.website_source is not null)", record_id, public_id)
                if not exists:
                    raise failure(422, "website_source", "แหล่งข้อมูลเว็บไซต์ใช้ได้เฉพาะรายการที่นำเข้าพร้อมหลักฐานแล้ว")
            return {"data": await connection.fetchval("select hub.save_project_commercial($1,$2,$3,$4,$5)",
                public_id, kind, record_id, body.updated_at, body.record.model_dump(mode="json", exclude={"kind"}))}

    @app.get(prefix)
    async def workspace(public_id: str, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, "select hub.project_commercial_workspace($1)", public_id)

    @app.post(prefix + "/{kind}")
    async def create(public_id: str, kind: Kind, body: SaveCommercial, request: Request, actor: Actor = Depends(staff)):
        return await save(public_id, kind, None, body, request, actor)

    @app.put(prefix + "/{kind}/{record_id}")
    async def update(public_id: str, kind: Kind, record_id: UUID, body: SaveCommercial, request: Request, actor: Actor = Depends(staff)):
        return await save(public_id, kind, record_id, body, request, actor)

    @app.post(prefix + "/{kind}/{record_id}/submit")
    async def submit(public_id: str, kind: Kind, record_id: UUID, body: UnitRevision, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, "select hub.review_project_commercial($1,$2,$3,$4,'submit')", public_id, kind, record_id, body.updated_at)

    @app.post(prefix + "/{kind}/{record_id}/review")
    async def review(public_id: str, kind: Kind, record_id: UUID, body: UnitDecision, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, "select hub.review_project_commercial($1,$2,$3,$4,$5)", public_id, kind, record_id, body.updated_at, body.decision, reason=body.reason)
