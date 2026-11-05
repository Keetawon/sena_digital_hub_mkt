"""Private read-only cross-content search and personal work projections."""
import json
from typing import Literal
from urllib.parse import urlencode
from uuid import UUID

from fastapi import Depends, Query, Request, Response

from .auth import Actor, failure


def workspace_href(kind: str, context: dict) -> str:
    """Only server-owned local destinations; never accept a URL from a record."""
    query = {key: json.dumps(value, separators=(',', ':'), ensure_ascii=False) if isinstance(value, (list, dict)) else str(value) for key, value in context.items()
             if value is not None and key in {
                 'project', 'brand', 'bud', 'tab', 'field', 'item', 'question',
                 'faq', 'unit_type', 'article', 'gap', 'version', 'phase',
                 'building', 'grain', 'facility', 'media_category', 'usage',
                 'target_type', 'target_key', 'floor', 'floor_from', 'floor_to',
                 'tags', 'rule_key', 'media_role', 'scope_type', 'scope_id',
                 'promotion', 'page', 'term', 'section', 'kind', 'revision', 'binding'}}
    if 'gap' in query:
        path = '/home'
    elif kind in ('faq', 'question', 'glossary') or query.get('tab') in ('bank', 'glossary'):
        path = '/faq'
    elif kind == 'article':
        path = '/articles'
    elif (kind in ('asset', 'media', 'media_link') or 'media_category' in query) and 'project' in query:
        path = '/media'
    elif kind == 'promotion':
        path = '/promotions'
    elif kind in ('unit_type', 'price', 'project', 'brand') or query.get('field', '').startswith('project.'):
        path = '/'
    elif kind == 'bud':
        path = '/home'
    else:
        path = '/content'
    return path + ('?' + urlencode(query) if query else '')


def register_workspace_home_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        account = getattr(request.state, 'account', {})
        caps = account.get('capabilities', {})
        if account.get('status') != 'ACTIVE' or not caps.get('published_consumer') or not any(
                caps.get('tabs', {}).get(tab, {}).get('view') is True
                for tab in ('projects', 'brands', 'knowledge', 'promotions', 'releases')):
            raise failure(403, 'forbidden', 'Workspace permission required')
        return actor

    @app.get('/v1/admin/content/search')
    async def search(request: Request, response: Response,
                     q: str = Query(default='', max_length=120, pattern=r'^[^\x00-\x1f]*$'),
                     limit: int = Query(default=20, ge=1, le=30), actor: Actor = Depends(staff)):
        async with database(request, actor) as connection:
            value = await connection.fetchval('select hub.workspace_search($1,$2)', q, limit)
        for item in value['items']:
            item['href'] = workspace_href(item['kind'], item['context'])
        response.headers['Cache-Control'] = 'private, no-store'
        return {'data': value}

    @app.get('/v1/admin/content/home')
    async def home(request: Request, response: Response,
                   bud: str | None = Query(default=None, min_length=1, max_length=200, pattern=r'^[^\x00-\x1f]+$'),
                   brand: str | None = Query(default=None, min_length=1, max_length=128, pattern=r'^[A-Za-z0-9_-]+$'),
                   offset: int = Query(default=0, ge=0, le=100000),
                   limit: int = Query(default=25, ge=1, le=100),
                   task: Literal['returned', 'approval', 'publish', 'expiring', 'fact_missing', 'review_due', 'unanswered'] | None = None,
                   gap: UUID | None = None,
                   actor: Actor = Depends(staff)):
        async with database(request, actor) as connection:
            value = await connection.fetchval('select hub.workspace_home($1,$2,$3,$4,$5,$6)', bud, brand, offset, limit, task, gap)
        for item in value['tasks']:
            item['href'] = workspace_href(item.get('kind', ''), item['context'])
        if value.get('selected_gap'):
            item = value['selected_gap']
            item['href'] = workspace_href(item.get('kind', ''), item['context'])
        for project in value['projects']:
            project['href'] = workspace_href('project', {'project': project['ref']})
            for field in project['readiness'].get('items', []):
                context = field['context']
                field['href'] = workspace_href('', context)
        for brand_item in value['brands']:
            for field in brand_item['readiness']['items']:
                field['href'] = workspace_href('brand', field['context'])
        response.headers['Cache-Control'] = 'private, no-store'
        return {'data': value}
