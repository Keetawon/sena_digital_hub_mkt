"""Private type review and Marketing prices; SQL owns source/approval checks."""
from __future__ import annotations

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, Request
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from .auth import Actor
from .commercial_types import LocalizedText
from .content_permissions import require_content


class UnitRevision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    updated_at: AwareDatetime


class UnitDecision(UnitRevision):
    decision: Literal["approve", "return", "withdraw"]


class MarketingPrice(UnitRevision):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    kind: Literal["starting", "unit_type"]
    commercial_type_id: UUID
    amount: Annotated[float, Field(gt=0, le=999999999999.99, strict=True)]
    basis_size_sqm: Annotated[float, Field(gt=0, lt=100000, strict=True)]
    display_text: LocalizedText
    basis: LocalizedText
    condition_text: LocalizedText
    promotion_id: UUID | None = None
    valid_from: date
    valid_to: date
    ai_exposure: Literal["open", "web_only", "internal"] = "web_only"

    @model_validator(mode="after")
    def bounded_price(self):
        if not 0 <= (self.valid_to - self.valid_from).days <= 60:
            raise ValueError("Price validity must be between zero and sixty days")
        for key, limit in (("display_text", 1000), ("basis", 2000), ("condition_text", 4000)):
            value = getattr(self, key)
            if not value.get("th", "").strip() or any(len(text) > limit for text in value.values()):
                raise ValueError("Price text needs bounded Thai content")
        return self


def register_unit_type_routes(app, authentication, database):
    prefix = "/v1/admin/projects/{public_id}"

    async def staff(request: Request, actor: Actor = Depends(authentication)):
        require_content(request)
        return actor

    async def call(request, actor, sql, *args):
        async with database(request, actor) as connection:
            return {"data": await connection.fetchval(sql, *args)}

    @app.get(prefix + "/unit-types")
    async def workspace(public_id: str, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, "select hub.unit_type_workspace($1)", public_id)

    @app.post(prefix + "/commercial-types/{commercial_id}/submit")
    async def type_submit(public_id: str, commercial_id: str, body: UnitRevision, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, "select hub.unit_type_review($1,$2,$3,'submit')", public_id, commercial_id, body.updated_at)

    @app.post(prefix + "/commercial-types/{commercial_id}/review")
    async def type_review(public_id: str, commercial_id: str, body: UnitDecision, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, "select hub.unit_type_review($1,$2,$3,$4)", public_id, commercial_id, body.updated_at, body.decision)

    @app.post(prefix + "/prices")
    async def price_create(public_id: str, body: MarketingPrice, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, "select hub.save_project_price($1,null,$2,$3)", public_id, body.updated_at,
                          body.model_dump(mode="json", exclude={"updated_at"}))

    @app.put(prefix + "/prices/{price_id}")
    async def price_save(public_id: str, price_id: UUID, body: MarketingPrice, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, "select hub.save_project_price($1,$2,$3,$4)", public_id, price_id, body.updated_at,
                          body.model_dump(mode="json", exclude={"updated_at"}))

    @app.post(prefix + "/prices/{price_id}/submit")
    async def price_submit(public_id: str, price_id: UUID, body: UnitRevision, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, "select hub.project_price_review($1,$2,$3,'submit')", public_id, price_id, body.updated_at)

    @app.post(prefix + "/prices/{price_id}/review")
    async def price_review(public_id: str, price_id: UUID, body: UnitDecision, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, "select hub.project_price_review($1,$2,$3,$4)", public_id, price_id, body.updated_at, body.decision)
