"""Private media drafts. SQL owns object authority, revisions and worker leases."""
from typing import Literal
from uuid import UUID

from fastapi import Depends, Query, Request
from pydantic import Field

from .auth import Actor
from .content_permissions import require_content
from .project_content import Draft, Input, Revision


class MediaDecision(Revision):
    decision: Literal['active', 'retired']


class LinkCheck(Revision):
    decision: Literal['ok', 'broken', 'private', 'removed']


class MediaJob(Input):
    kind: Literal['image_suggestion', 'clip_metadata', 'clip_check']
    subject_id: UUID
    expected_revision: int = Field(ge=0)


class WebsiteConfirmation(Input):
    items: list[dict] = Field(min_length=1, max_length=40)


def register_project_media_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        require_content(request)
        return actor

    async def read(request, actor, sql, *args):
        async with database(request, actor) as db:
            return {'data': await db.fetchval(sql, *args)}

    @app.get('/v1/admin/media/website')
    async def website_projects(request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.website_media_projects()')

    @app.get('/v1/admin/projects/{public_id}/media/website')
    async def website_queue(public_id: str, request: Request, offset: int = Query(0, ge=0, le=100000), actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.website_media_queue($1,$2)', public_id, offset)

    @app.post('/v1/admin/projects/{public_id}/media/website/confirm')
    async def website_confirm(public_id: str, body: WebsiteConfirmation, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.website_media_confirm($1,$2)', public_id, body.items)

    @app.get('/v1/admin/projects/{public_id}/content/website')
    async def website_sources(public_id: str, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.website_content_sources($1)', public_id)

    @app.get('/v1/admin/media/tags')
    async def tags(request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.media_tags_read()')

    @app.put('/v1/admin/media/tags/{tag_code}')
    async def tag_save(tag_code: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.media_tag_save($1,$2,$3)', tag_code, body.expected_revision, body.changes)

    @app.post('/v1/admin/media/tags/{tag_code}/approve')
    async def tag_approve(tag_code: str, body: MediaDecision, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.media_tag_approve($1,$2,$3)', tag_code, body.expected_revision, body.decision)

    @app.get('/v1/admin/media/requirements')
    async def requirements(request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.media_requirements_read()')

    @app.put('/v1/admin/media/requirements/{rule_key}')
    async def requirement_save(rule_key: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.media_requirement_save($1,$2,$3)', rule_key, body.expected_revision, body.changes)

    @app.get('/v1/admin/projects/{public_id}/media')
    async def project_media(public_id: str, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.project_media($1)', public_id)

    @app.put('/v1/admin/projects/{public_id}/media/assets/{asset_id}')
    async def asset_metadata(public_id: str, asset_id: UUID, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.media_save_asset($1,$2,$3,$4)', public_id, asset_id, body.expected_revision, body.changes)

    @app.put('/v1/admin/projects/{public_id}/media/links/{link_id}')
    async def asset_link(public_id: str, link_id: UUID, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.media_link_save($1,$2,$3,$4)', public_id, link_id, body.expected_revision, body.changes)

    @app.post('/v1/admin/projects/{public_id}/media/links/{link_id}/remove')
    async def link_remove(public_id: str, link_id: UUID, body: Revision, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.media_link_remove($1,$2,$3)', public_id, link_id, body.expected_revision)

    @app.put('/v1/admin/projects/{public_id}/media/clips/{clip_id}')
    async def clip_save(public_id: str, clip_id: UUID, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.media_clip_save($1,$2,$3,$4)', public_id, clip_id, body.expected_revision, body.changes)

    @app.post('/v1/admin/projects/{public_id}/media/clips/{clip_id}/check')
    async def clip_check(public_id: str, clip_id: UUID, body: LinkCheck, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.media_clip_check($1,$2,$3,$4)', public_id, clip_id, body.expected_revision, body.decision)

    @app.get('/v1/admin/projects/{public_id}/media/jobs')
    async def jobs(public_id: str, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.media_jobs_read($1)', public_id)

    @app.get('/v1/admin/projects/{public_id}/media/ai-state')
    async def ai_state(public_id: str, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.media_ai_state($1)', public_id)

    @app.post('/v1/admin/projects/{public_id}/media/jobs')
    async def job_request(public_id: str, body: MediaJob, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.media_job_request($1,$2,$3,$4)', public_id, body.kind, body.subject_id, body.expected_revision)
