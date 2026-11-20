"""One private publication queue retaining web-page and release histories."""
from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .auth import Actor, failure
from .content_workflow import ContentHash, DecisionReason, WorkflowRevision, publication_targets

PageKey = Annotated[str, StringConstraints(pattern=r'^(project|brand|business|programme|corporate|article|location):[A-Za-z0-9][A-Za-z0-9_-]{0,127}$')]


class WebSelection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    system: Literal['web']
    page_key: PageKey


class ReleaseSelection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    system: Literal['release']
    entity_type: Literal['project', 'brand', 'promotion']
    entity_id: UUID


class QueuePrepare(BaseModel):
    model_config = ConfigDict(extra='forbid')
    selections: list[Annotated[WebSelection | ReleaseSelection, Field(discriminator='system')]] = Field(min_length=1, max_length=100)
    reason: DecisionReason

    @model_validator(mode='after')
    def unique_targets(self):
        identities = [item.model_dump_json() for item in self.selections]
        if len(set(identities)) != len(identities):
            raise ValueError('Select unique publication targets')
        return self


class QueuePublish(BaseModel):
    model_config = ConfigDict(extra='forbid')
    publication_id: UUID
    expected_digest: ContentHash


class QueueReturn(WorkflowRevision):
    reason: DecisionReason


def register_publication_queue_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        capabilities = getattr(request.state, 'account', {}).get('capabilities', {})
        knowledge = capabilities.get('tabs', {}).get('knowledge', {})
        if knowledge.get('view') is not True:
            raise failure(403, 'content_permission', 'ไม่มีสิทธิ์ดำเนินการนี้')
        if request.method != 'GET' and capabilities.get('special_actions', {}).get('knowledge.publish_web') is not True:
            raise failure(403, 'content_permission', 'ไม่มีสิทธิ์ดำเนินการนี้')
        return actor

    async def call(request, actor, statement, *args):
        async with database(request, actor) as connection:
            return {'data': publication_targets(await connection.fetchval(statement, *args))}

    @app.get('/v1/admin/publication-queue')
    async def read(request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.publication_queue_read()')

    @app.post('/v1/admin/publication-queue/prepare')
    async def prepare(body: QueuePrepare, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.publication_queue_prepare($1,$2)',
                          [item.model_dump(mode='json') for item in body.selections], body.reason)

    @app.post('/v1/admin/publication-queue/publish')
    async def publish(body: QueuePublish, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.publication_queue_publish($1,$2)', body.publication_id, body.expected_digest)

    @app.post('/v1/admin/publication-queue/return')
    async def return_item(body: QueueReturn, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.publication_queue_return($1,$2,$3,$4)',
                          body.kind, body.identity, body.expected_hash, body.reason)
