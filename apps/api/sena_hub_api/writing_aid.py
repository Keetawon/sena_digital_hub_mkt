"""Actor-bound writing proposals. The only provider is a deterministic local stub.

No source text is accepted from a client, persisted as a proposal, or logged.
Accepting a proposal uses the source editor's ordinary revision-checked save.
"""
from __future__ import annotations

import re
from time import monotonic
from typing import Literal
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .auth import Actor
from .content_translation import TranslationError, protect_text, restore_text
from .provider_budget import spend_limit_code
from .provider_messages import MESSAGES


class ContextField(BaseModel):
    model_config = ConfigDict(extra='forbid')
    translation_id: UUID
    expected_revision: int = Field(ge=1)


class WritingRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    expected_revision: int = Field(ge=1)
    language: Literal['th', 'en']
    mode: Literal['draft', 'proofread', 'shorten']
    context: list[ContextField] = Field(default_factory=list, max_length=8)


class StubWritingProvider:
    """Whitespace-only preview: no credentials, SDK, HTTP client or provider switch."""
    model = 'stub-writing-v1'

    async def generate(self, text: str, language: str, mode: str) -> str:
        # The stub deliberately invents no claims and does not translate locales.
        return re.sub(r'\s+', ' ', text).strip()


def present(data: dict) -> dict:
    if data.get('status') == 'budget_exhausted':
        data = {**data, 'message': MESSAGES['state_budget']}
    return {'data': data}


def register_writing_aid_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        account = getattr(request.state, 'account', {})
        level = 'view' if request.method == 'GET' else 'edit'
        tabs = account.get('capabilities', {}).get('tabs', {})
        if (account.get('status') == 'ACTIVE'
                and account.get('hub_role') not in ('agency', 'service_consumer', None)
                and not actor.agency_code
                and any(tabs.get(tab, {}).get(level) is True
                        for tab in ('projects', 'brands', 'knowledge'))):
            return actor
        # Reuse the application's normal error envelope; no new Thai UI copy.
        raise HTTPException(status_code=403)

    async def command(request, actor, sql, *args):
        async with database(request, actor) as db:
            return await db.fetchval(sql, *args)

    @app.get('/v1/admin/content/writing-aid/{translation_id}')
    async def state(translation_id: UUID, request: Request, actor: Actor = Depends(staff)):
        data = await command(request, actor, 'select hub.writing_aid_state($1)', translation_id)
        if data['budget'].get('status') == 'budget_exhausted':
            data['budget']['message'] = MESSAGES['state_budget']
        return present(data)

    @app.post('/v1/admin/content/writing-aid/{translation_id}/proposals')
    async def propose(translation_id: UUID, body: WritingRequest, request: Request,
                      actor: Actor = Depends(staff)):
        # Admission commits before generation. Reusing a request ID never calls
        # the provider again, including after a lost response or cancellation.
        admission = await command(
            request, actor, 'select hub.writing_aid_begin($1,$2,$3,$4,$5,$6)',
            translation_id, body.expected_revision, body.language, body.mode,
            body.request_id, [item.model_dump(mode='json') for item in body.context],
        )
        if admission['status'] != 'ready':
            return present(admission)

        started = monotonic()
        output = None
        error = None
        try:
            masked, protected = protect_text(admission['input_text'], [])
            candidate = await StubWritingProvider().generate(masked, body.language, body.mode)
            output = restore_text(admission['input_text'], candidate, protected, admission['max_length'])
        except TranslationError:
            error = 'invalid_output'
        except Exception as exc:
            # Do not expose provider bodies or retry an ambiguous attempt.
            error = 'budget_exhausted' if spend_limit_code(exc) else 'provider_error'

        result = await command(
            request, actor, 'select hub.writing_aid_finish($1,$2,$3)',
            body.request_id, error, min(round((monotonic() - started) * 1000), 600000),
        )
        if result['status'] == 'done':
            result['proposal'] = {
                'before': admission['before'], 'after': output,
                'source': admission['source'],
                'acceptance': 'ordinary_draft_save',
            }
        return present(result)
