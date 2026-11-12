"""Bounded account-only scope references and explicit grace confirmation."""
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .auth import Actor, failure

ScopeTab = Literal['projects', 'brands', 'knowledge', 'promotions', 'releases']
ScopeLevel = Literal['view', 'edit', 'approve']
ScopeRef = Annotated[str, StringConstraints(min_length=1, max_length=200, pattern=r'^[^\x00-\x1f]+$')]


class ContentScopeSelection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['all', 'selected']
    bu_ids: list[ScopeRef] = Field(default_factory=list, max_length=1000)
    project_ids: list[ScopeRef] = Field(default_factory=list, max_length=10000)

    @model_validator(mode='after')
    def exact_selection(self):
        if self.mode == 'all' and (self.bu_ids or self.project_ids):
            raise ValueError('All scope cannot contain selections')
        if any(not value.strip() for value in self.bu_ids + self.project_ids):
            raise ValueError('Blank scope reference')
        if len(set(self.bu_ids)) != len(self.bu_ids) or len(set(self.project_ids)) != len(self.project_ids):
            raise ValueError('Scope references must be distinct')
        return self


class ContentScopeAssignment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['content_scope']
    tab: ScopeTab
    level: ScopeLevel
    scope: ContentScopeSelection


class ContentScopeSettingsPreview(BaseModel):
    model_config = ConfigDict(extra='forbid')
    grace_days: int = Field(ge=1, le=7, strict=True)
    expected_revision: int = Field(gt=0, strict=True)


class ContentScopeSettingsApply(ContentScopeSettingsPreview):
    digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    confirmed: Literal[True]


def register_content_scope_routes(app, authentication, database):
    async def manager(request: Request, actor: Actor = Depends(authentication)):
        account = getattr(request.state, 'account', {})
        if not actor.can_manage_users or account.get('status') != 'ACTIVE' or actor.role not in {'viewer', 'editor', 'publisher', 'admin', 'online_staff'}:
            raise failure(403, 'content_scope_permission', 'Account administration required')
        return actor

    async def settings_admin(request: Request, actor: Actor = Depends(manager)):
        if actor.role != 'admin' or request.state.account.get('hub_role') != 'admin':
            raise failure(403, 'content_scope_permission', 'Actual account administrator required')
        return actor

    async def call(request, response, actor, sql, *args):
        async with database(request, actor) as db:
            value = await db.fetchval(sql, *args)
        response.headers['Cache-Control'] = 'private, no-store'
        return {'data': value}

    @app.get('/v1/admin/accounts/content-scopes')
    async def scopes(request: Request, response: Response, account_id: UUID | None = None,
                     reference_kind: Literal['projects', 'bus'] = 'projects',
                     bu_id: ScopeRef | None = None, q: str = Query(default='', max_length=120),
                     after: str | None = Query(default=None, max_length=200),
                     limit: int = Query(default=100, ge=1, le=100),
                     history_after: str | None = Query(default=None, max_length=1024),
                     history_limit: int = Query(default=50, ge=1, le=100), actor: Actor = Depends(manager)):
        if account_id is None and (history_after is not None or 'history_limit' in request.query_params):
            raise failure(422, 'content_scope_query', 'Exact account required for effective history')
        return await call(request, response, actor, 'select hub.content_scopes_read($1,$2,$3,$4,$5,$6,$7,$8)',
                          account_id, reference_kind, bu_id, q, after, limit, history_after, history_limit)

    @app.get('/v1/admin/accounts/bu-sync-runs')
    async def runs(request: Request, response: Response,
                   after: str | None = Query(default=None, max_length=500),
                   limit: int = Query(default=50, ge=1, le=100), actor: Actor = Depends(manager)):
        return await call(request, response, actor, 'select hub.content_bu_runs_read($1,$2)', after, limit)

    @app.get('/v1/admin/accounts/content-scope-settings')
    async def settings(request: Request, response: Response, actor: Actor = Depends(settings_admin)):
        return await call(request, response, actor, 'select hub.content_scope_settings_read()')

    @app.post('/v1/admin/accounts/content-scope-settings/preview')
    async def preview(body: ContentScopeSettingsPreview, request: Request, response: Response,
                      actor: Actor = Depends(settings_admin)):
        return await call(request, response, actor, 'select hub.content_scope_settings_preview($1,$2)', body.grace_days, body.expected_revision)

    @app.post('/v1/admin/accounts/content-scope-settings/apply')
    async def apply(body: ContentScopeSettingsApply, request: Request, response: Response,
                    actor: Actor = Depends(settings_admin)):
        return await call(request, response, actor, 'select hub.content_scope_settings_apply($1,$2,$3)', body.grace_days, body.expected_revision, body.digest)
