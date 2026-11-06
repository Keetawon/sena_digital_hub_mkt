"""Exact-revision content decisions; the SQL dispatcher owns source authority."""
from __future__ import annotations

import json
from typing import Annotated, Any, Literal
from urllib.parse import quote, urlencode

from fastapi import Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .auth import Actor, failure

WorkflowKind = Literal[
    'project', 'model', 'brand', 'faq', 'section', 'selling_point', 'contact',
    'fact', 'building', 'facility', 'feature', 'place', 'asset', 'project_asset',
    'brand_asset', 'type_asset', 'asset_context', 'media_link', 'media_target',
    'unit_type', 'price', 'disclosure', 'sales_term', 'programme', 'progress',
    'solar', 'article', 'question', 'glossary', 'promotion', 'page_config',
]
ContentHash = Annotated[str, StringConstraints(pattern=r'^[a-f0-9]{64}$')]
DecisionReason = Annotated[str, StringConstraints(min_length=1, max_length=2000, pattern=r'\S')]


class WorkflowTarget(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    kind: WorkflowKind
    identity: dict[str, str] = Field(min_length=1, max_length=2)

    @model_validator(mode='after')
    def exact_identity(self):
        keys = {'question': {'question_key'}, 'glossary': {'term_key'},
                'building': {'project_id', 'building_key'},
                'facility': {'project_id', 'facility_code'},
                'selling_point': {'project_id', 'point_key'}}.get(self.kind, {'id'})
        if set(self.identity) != keys or any(not value or len(value) > 200 for value in self.identity.values()):
            raise ValueError('Invalid content identity')
        return self


class WorkflowRevision(WorkflowTarget):
    expected_hash: ContentHash


class WorkflowDecision(WorkflowRevision):
    decision: Literal['approve', 'return', 'withdraw']
    reason: DecisionReason | None = None

    @model_validator(mode='after')
    def return_reason(self):
        if self.decision in {'return', 'withdraw'} and not self.reason:
            raise ValueError('A decision reason is required')
        return self


class WorkflowSaveApprove(WorkflowRevision):
    changes: dict[str, Any] = Field(max_length=60)
    reason: DecisionReason

    @model_validator(mode='after')
    def bounded_changes(self):
        if len(json.dumps(self.changes, ensure_ascii=False).encode('utf-8')) > 64000:
            raise ValueError('Content exceeds the draft limit')
        return self


def require_workflow(request: Request) -> None:
    """Coarse HTTP boundary only; SQL resolves the exact kind, scope and level."""
    capabilities = getattr(request.state, 'account', {}).get('capabilities', {})
    tabs = capabilities.get('tabs', {})
    if not any(tabs.get(tab, {}).get('view') is True for tab in ('projects', 'brands', 'knowledge', 'promotions')):
        raise failure(403, 'content_permission', 'Content permission required')


def publication_targets(value: dict) -> dict:
    """Encode only finite server-owned descriptor targets, never stored URLs."""
    target = value.get('target')
    workflow = value.get('workflow') or {}
    kind = workflow.get('kind')
    if isinstance(target, dict):
        keys = {'tab', 'phase', 'section', 'field', 'question_key', 'faq', 'cluster',
                'unit_type', 'revision', 'binding', 'scope_type', 'scope_id', 'term',
                'kind', 'floor_from', 'floor_to', 'facility', 'item', 'building',
                'grain', 'media_category', 'usage', 'target_type', 'target_key',
                'floor', 'tags', 'rule_key', 'media_role', 'version', 'asset_id',
                'web_page', 'page', 'article', 'promotion', 'question'}
        context = {key: json.dumps(item, ensure_ascii=False, separators=(',', ':'))
                   if isinstance(item, (dict, list)) else str(item)
                   for key, item in target.items() if key in keys and item is not None}
        identity = workflow.get('identity', {})
        path = None
        if kind in {'question', 'glossary'}:
            context = ({'tab': 'bank', 'question': identity.get('question_key')}
                       if kind == 'question' else {'tab': 'glossary', 'term': identity.get('term_key')})
            path = '/faq'
        elif kind == 'page_config' and isinstance(target.get('page'), str):
            path, context = '/publish', {'tab': 'configuration', 'page': target['page'],
                                         'item': identity.get('id'), 'field': target.get('field') or 'page.url'}
        elif kind == 'article':
            path, context = '/articles', {'article': identity.get('id'), 'version': target.get('version')}
        elif kind == 'promotion':
            path, context = '/promotions', {'promotion': identity.get('id')}
        elif target.get('level') in {'corporate', 'brand', 'project', 'programme', 'project_group', 'unit_type'} and isinstance(target.get('id'), str):
            path = '/website/' + quote(target['level'], safe='') + '/' + quote(target['id'], safe='')
            for source_key, query_key in {'question_key': 'question', 'media_category': 'category',
                                          'rule_key': 'rule', 'asset_id': 'asset'}.items():
                if source_key in context:
                    context.setdefault(query_key, context.pop(source_key))
            if isinstance(target.get('tags'), list):
                context['tags'] = ','.join(tag for tag in target['tags'] if isinstance(tag, str))
        value['href'] = (path + '?' + urlencode({key: item for key, item in context.items() if item is not None})) if path else None
    elif 'workflow' in value:
        value['href'] = None
    if value.get('system') == 'release' and value.get('label'):
        value['title'] = value['label']
    for key in ('pages', 'items', 'outcomes'):
        for item in value.get(key, []) or []:
            if isinstance(item, dict):
                publication_targets(item)
    return value


def register_content_workflow_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        require_workflow(request)
        return actor

    async def call(request, actor, statement, *args):
        async with database(request, actor) as connection:
            return {'data': await connection.fetchval(statement, *args)}

    @app.get('/v1/admin/content-workflow/items')
    async def items(request: Request,
                    level: Literal['corporate', 'brand', 'project', 'programme', 'project_group', 'unit_type'],
                    ref: str = Query(alias='id', min_length=1, max_length=200),
                    phase: str | None = Query(default=None, min_length=1, max_length=200),
                    after: str | None = Query(default=None, min_length=1, max_length=8192),
                    limit: int = Query(default=50, ge=1, le=100), actor: Actor = Depends(staff)):
        result = await call(request, actor, 'select hub.content_workflow_items($1,$2,$3,$4,$5)',
                            level, ref, phase, after, limit)
        result['data'] = publication_targets(result['data'])
        return result

    @app.get('/v1/admin/content-workflow')
    async def read(request: Request, kind: WorkflowKind,
                   identity: str = Query(min_length=2, max_length=1000), actor: Actor = Depends(staff)):
        try:
            target = WorkflowTarget(kind=kind, identity=json.loads(identity))
        except (ValueError, TypeError):
            raise HTTPException(422, 'Invalid content identity') from None
        return await call(request, actor, 'select hub.content_workflow_read($1,$2)', target.kind, target.identity)

    @app.post('/v1/admin/content-workflow/submit')
    async def submit(body: WorkflowRevision, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.content_workflow_submit($1,$2,$3)',
                          body.kind, body.identity, body.expected_hash)

    @app.post('/v1/admin/content-workflow/review')
    async def review(body: WorkflowDecision, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.content_workflow_review($1,$2,$3,$4,$5)',
                          body.kind, body.identity, body.expected_hash, body.decision, body.reason)

    @app.post('/v1/admin/content-workflow/save-approve')
    async def save_approve(body: WorkflowSaveApprove, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.content_workflow_save_approve($1,$2,$3,$4,$5)',
                          body.kind, body.identity, body.expected_hash, body.changes, body.reason)
