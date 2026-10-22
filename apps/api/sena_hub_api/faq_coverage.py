"""Private K3 coverage, applicability and live fact-slot previews."""
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from .auth import Actor
from .content_permissions import require_content

Reference = Annotated[str, StringConstraints(min_length=1, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')]


class Rule(BaseModel):
    model_config = ConfigDict(extra='forbid')
    brand_ids: list[Reference] | None = Field(default=None, min_length=1, max_length=100)
    product_forms: list[Literal['condominium', 'house', 'townhome', 'other']] | None = Field(default=None, min_length=1, max_length=4)
    group_ids: list[Reference] | None = Field(default=None, min_length=1, max_length=100)


class Applicability(BaseModel):
    model_config = ConfigDict(extra='forbid')
    rule: Rule
    scope_type: Literal['corporate', 'brand', 'project_group', 'programme']
    scope_id: Reference


class GapUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(ge=1, strict=True)
    state: Literal['open', 'in_progress', 'resolved']
    assign_self: Annotated[bool, Field(strict=True)] | None = None


def register_faq_coverage_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        require_content(request)
        return actor

    async def call(request, actor, sql, *args):
        async with database(request, actor) as connection:
            return {'data': await connection.fetchval(sql, *args)}

    @app.get('/v1/admin/faq-coverage')
    async def coverage(request: Request, project: str | None = Query(default=None, max_length=128),
                       offset: int = Query(default=0, ge=0, le=100000), limit: int = Query(default=25, ge=1, le=100),
                       actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.faq_coverage($1,$2,$3)', project, offset, limit)

    @app.get('/v1/admin/faq-composition/{public_id}')
    async def composition(public_id: str, request: Request, locale: Literal['th', 'en'] = 'th',
                          unit_type: str | None = Query(default=None, max_length=128), actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.faq_composition($1,$2,$3)', public_id, locale, unit_type)

    @app.post('/v1/admin/faq-applicability')
    async def applicability(body: Applicability, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.faq_applicability_preview($1,$2,$3)',
                          body.rule.model_dump(exclude_none=True), body.scope_type, body.scope_id)

    @app.get('/v1/admin/faq-gaps')
    async def gaps(request: Request, project: str | None = Query(default=None, max_length=128), actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.faq_gaps($1)', project)

    @app.patch('/v1/admin/faq-gaps/{gap_id}')
    async def update_gap(gap_id: UUID, body: GapUpdate, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.faq_gap_update($1,$2,$3,$4)',
                          gap_id, body.expected_revision, body.state, body.assign_self)
