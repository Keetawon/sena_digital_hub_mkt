"""Bounded content workspace projections; SQL owns source and object authority."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .auth import Actor
from .content_permissions import require_content
from .web_publication import preview_html

Kind = Literal['project', 'brand', 'business', 'corporate', 'programme', 'project_group', 'unit_type']
Reference = Annotated[str, StringConstraints(min_length=1, max_length=200, pattern=r'^[^\x00-\x1f/\\]+$')]
Cursor = Annotated[str, StringConstraints(pattern=r'^[1-9][0-9]{0,18}$')]
QuestionKey = Annotated[str, StringConstraints(pattern=r'^[a-z][a-z0-9_]{1,100}$')]


class WebsiteDecision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_decision_id: Cursor | None
    decision: Literal['use', 'edit_use', 'reject']
    expected_revision: int | None = Field(default=None, ge=0, strict=True)
    changes: dict[str, Any] = Field(default_factory=dict, max_length=2)
    reason: str | None = Field(default=None, max_length=2000)

    @model_validator(mode='after')
    def bounded(self):
        if self.expected_decision_id and int(self.expected_decision_id) > 9223372036854775807:
            raise ValueError('Invalid decision cursor')
        if len(json.dumps(self.changes, ensure_ascii=False)) > 64000:
            raise ValueError('Section exceeds the draft limit')
        if self.decision == 'reject':
            if self.changes or self.expected_revision is not None or not (self.reason or '').strip():
                raise ValueError('Rejection requires a reason and no draft changes')
        elif self.expected_revision is None:
            raise ValueError('Current section revision is required')
        elif self.decision == 'use' and self.changes:
            raise ValueError('Use derives the source text on the server')
        elif self.decision == 'edit_use' and (set(self.changes) - {'body', 'ai_exposure'} or 'body' not in self.changes):
            raise ValueError('Only normal section draft fields are accepted')
        return self


def register_content_workspace_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        if require_content(request):
            return actor
        account = getattr(request.state, 'account', {})
        tabs = account.get('capabilities', {}).get('tabs', {})
        if account.get('status') == 'ACTIVE' and actor.role in {'viewer', 'editor', 'publisher', 'admin', 'online_staff'} and any(
                tabs.get(tab, {}).get('view') is True for tab in ('projects', 'brands', 'knowledge', 'promotions')):
            return actor
        raise HTTPException(403)

    async def call(request, response, actor, sql, *args):
        response.headers['Cache-Control'] = 'no-store'
        async with database(request, actor) as db:
            return {'data': await db.fetchval(sql, *args)}

    @app.get('/v1/admin/content/workspace/tree')
    async def tree(request: Request, response: Response, parent_kind: Kind | None = None,
                   parent_ref: Reference | None = None, query: str = Query('', alias='q', max_length=200),
                   after: str | None = Query(None, max_length=220), limit: int = Query(50, ge=1, le=100),
                   actor: Actor = Depends(staff)):
        if (parent_kind is None) != (parent_ref is None):
            raise HTTPException(422)
        return await call(request, response, actor, 'select hub.workspace_tree($1,$2,$3,$4,$5)', parent_kind, parent_ref, query, after, limit)

    @app.get('/v1/admin/content/workspace/resolve')
    async def resolve(request: Request, response: Response, faq: UUID | None = None,
                      cluster: UUID | None = None, phase: Reference | None = None,
                      actor: Actor = Depends(staff)):
        if (faq is None) == (cluster is None):
            raise HTTPException(422)
        return await call(request, response, actor, 'select hub.workspace_resolve($1,$2,$3)', faq, cluster, phase)

    @app.get('/v1/admin/content/workspace/{kind}/{ref}')
    async def page(kind: Kind, ref: Reference, request: Request, response: Response,
                   phase: Reference | None = None, actor: Actor = Depends(staff)):
        return await call(request, response, actor, 'select hub.workspace_page($1,$2,$3)', kind, ref, phase)

    @app.get('/v1/admin/content/workspace/{kind}/{ref}/faq')
    async def faq(kind: Kind, ref: Reference, request: Request, response: Response,
                  phase: Reference | None = None, query: str = Query('', alias='q', max_length=200),
                  after: str | None = Query(None, max_length=120), limit: int = Query(50, ge=1, le=100),
                  locale: Literal['th', 'en'] = 'th', question_key: QuestionKey | None = None,
                  actor: Actor = Depends(staff)):
        if question_key is not None and ('q' in request.query_params or after is not None):
            raise HTTPException(422)
        # Exact selection stays inside the same guarded projection and SQL ACL.
        cursor = f'q:{question_key}' if question_key is not None else after
        return await call(request, response, actor, 'select hub.workspace_faq($1,$2,$3,$4,$5,$6,$7)',
                          kind, ref, phase, query, cursor, 1 if question_key is not None else limit, locale)

    def promotion_query(request, allowed):
        if set(request.query_params) - set(allowed) or any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise HTTPException(422)

    @app.get('/v1/admin/content/workspace/{kind}/{ref}/promotions')
    async def promotions(kind: Literal['project', 'brand', 'project_group', 'corporate'], ref: Reference, request: Request, response: Response,
                         phase: Reference | None = None,
                         filter: Literal['all', 'active', 'in_review', 'draft', 'expired', 'ending_soon', 'banner_missing'] = 'all',
                         limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=100000),
                         item: UUID | None = None, actor: Actor = Depends(staff)):
        promotion_query(request, ('phase', 'filter', 'limit', 'offset', 'item'))
        if kind != 'project' and phase is not None:
            raise HTTPException(422)
        return await call(request, response, actor, 'select hub.workspace_promotions($1,$2,$3,$4,$5,$6,$7)',
                          kind, ref, phase, filter, limit, offset, item)

    @app.get('/v1/admin/content/workspace/{kind}/{ref}/promotions/suggestions')
    async def promotion_suggestions(kind: Literal['project', 'brand'], ref: Reference, request: Request, response: Response,
                                    phase: Reference | None = None, limit: int = Query(50, ge=1, le=100),
                                    offset: int = Query(0, ge=0, le=100000), item: UUID | None = None,
                                    source: Literal['website', 'km'] | None = None, actor: Actor = Depends(staff)):
        promotion_query(request, ('phase', 'limit', 'offset', 'item', 'source'))
        if kind == 'brand' and phase is not None:
            raise HTTPException(422)
        return await call(request, response, actor, 'select hub.workspace_promotion_suggestions($1,$2,$3,$4,$5,$6,$7)',
                          kind, ref, phase, limit, offset, item, source)

    @app.get('/v1/admin/content/workspace/{kind}/{ref}/preview')
    async def preview(kind: Kind, ref: Reference, request: Request, response: Response,
                      phase: Reference | None = None, locale: Literal['th', 'en'] = 'th',
                      actor: Actor = Depends(staff)):
        result = await call(request, response, actor, 'select hub.workspace_preview($1,$2,$3,$4)', kind, ref, phase, locale)
        result['data']['html'] = preview_html(result['data']['preview'], result['data'].pop('preview_assets', {}))
        return result

    @app.get('/v1/admin/content/workspace/{kind}/{ref}/history')
    async def history(kind: Kind, ref: Reference, request: Request, response: Response,
                      before: Cursor | None = None, limit: int = Query(50, ge=1, le=100),
                      actor: Actor = Depends(staff)):
        if before and int(before) > 9223372036854775807:
            raise HTTPException(422)
        return await call(request, response, actor, 'select hub.content_history($1,$2,$3,$4)', kind, ref, int(before) if before else None, limit)

    @app.get('/v1/admin/content/workspace/{kind}/{ref}/history/{event_id}')
    async def event(kind: Kind, ref: Reference, event_id: Cursor, request: Request, response: Response,
                    actor: Actor = Depends(staff)):
        if int(event_id) > 9223372036854775807:
            raise HTTPException(422)
        return await call(request, response, actor, 'select hub.content_history_event($1,$2,$3)', kind, ref, int(event_id))

    @app.get('/v1/admin/content/activity')
    async def activity(request: Request, response: Response, actor_id: UUID | None = None,
                       project: Reference | None = None, rem_bu_id: Reference | None = None,
                       date_from: datetime | None = None, date_to: datetime | None = None,
                       before: Cursor | None = None, limit: int = Query(50, ge=1, le=100),
                       actor: Actor = Depends(staff)):
        account = getattr(request.state, 'account', {})
        if account.get('status') != 'ACTIVE' or account.get('hub_role') != 'admin':
            raise HTTPException(403)
        if (before and int(before) > 9223372036854775807
                or date_from and date_from.tzinfo is None or date_to and date_to.tzinfo is None
                or date_from and date_to and date_from > date_to):
            raise HTTPException(422)
        filters = {key: value for key, value in {
            'actor_id': str(actor_id) if actor_id else None, 'project': project, 'rem_bu_id': rem_bu_id,
            'date_from': date_from.isoformat() if date_from else None,
            'date_to': date_to.isoformat() if date_to else None}.items() if value is not None}
        return await call(request, response, actor, 'select hub.content_activity($1,$2,$3)', filters, int(before) if before else None, limit)

    @app.post('/v1/admin/projects/{public_id}/content/website/{candidate_id}/decision')
    async def website_decision(public_id: Reference, candidate_id: UUID, body: WebsiteDecision,
                               request: Request, response: Response, actor: Actor = Depends(staff)):
        return await call(request, response, actor, 'select hub.website_text_decide($1,$2,$3,$4,$5,$6,$7)',
                          public_id, candidate_id, int(body.expected_decision_id) if body.expected_decision_id else None,
                          body.decision, body.expected_revision, body.changes, body.reason)
