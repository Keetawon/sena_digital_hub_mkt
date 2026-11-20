"""Fixed business references and existing Knowledge-owned content commands."""
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request, Response
from pydantic import StringConstraints

from .auth import Actor, failure
from .project_content import Draft

BusinessCode = Annotated[str, StringConstraints(pattern=r'^[a-z][a-z0-9_]{1,63}$')]
SectionKey = Annotated[str, StringConstraints(pattern=r'^[a-z][a-z0-9_.]{1,100}$')]


def register_business_content_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        account = getattr(request.state, 'account', {})
        tabs = account.get('capabilities', {}).get('tabs', {})
        if account.get('status') != 'ACTIVE' or actor.role not in {'viewer', 'editor', 'publisher', 'admin', 'online_staff'} or not any(
                tabs.get(tab, {}).get('view') is True for tab in ('knowledge', 'brands', 'projects')):
            raise failure(403, 'content_permission', 'ไม่มีสิทธิ์ดำเนินการนี้')
        return actor

    async def content_staff(request: Request, actor: Actor = Depends(staff)):
        knowledge = request.state.account.get('capabilities', {}).get('tabs', {}).get('knowledge', {})
        level = 'view' if request.method == 'GET' else 'edit'
        if knowledge.get('view') is not True or knowledge.get(level) is not True:
            raise failure(403, 'content_permission', 'ไม่มีสิทธิ์ดำเนินการนี้')
        return actor

    async def call(request, response, actor, query, *args):
        async with database(request, actor) as connection:
            value = await connection.fetchval(query, *args)
        response.headers['Cache-Control'] = 'private, no-store'
        return {'data': value}

    @app.get('/v1/admin/content/businesses')
    async def businesses(request: Request, response: Response, actor: Actor = Depends(staff)):
        return await call(request, response, actor, 'select hub.business_references()')

    @app.get('/v1/admin/content/businesses/{code}/content')
    async def content(code: BusinessCode, request: Request, response: Response, actor: Actor = Depends(content_staff)):
        return await call(request, response, actor, 'select hub.business_content($1)', code)

    @app.put('/v1/admin/content/businesses/{code}/sections/{section_key}')
    async def section(code: BusinessCode, section_key: SectionKey, body: Draft, request: Request,
                      response: Response, actor: Actor = Depends(content_staff)):
        return await call(request, response, actor, "select hub.save_content_section('business',$1,$2,$3,$4)",
                          code, section_key, body.expected_revision, body.changes)

    @app.post('/v1/admin/content/businesses/{code}/contacts')
    async def contact_create(code: BusinessCode, body: Draft, request: Request, response: Response,
                             actor: Actor = Depends(content_staff)):
        return await call(request, response, actor, "select hub.save_content_contact('business',$1,null,$2,$3)",
                          code, body.expected_revision, body.changes)

    @app.put('/v1/admin/content/businesses/{code}/contacts/{contact_id}')
    async def contact_save(code: BusinessCode, contact_id: UUID, body: Draft, request: Request, response: Response,
                           actor: Actor = Depends(content_staff)):
        return await call(request, response, actor, "select hub.save_content_contact('business',$1,$2,$3,$4)",
                          code, contact_id, body.expected_revision, body.changes)
