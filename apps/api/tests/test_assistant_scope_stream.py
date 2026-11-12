"""Deterministic assistant delivery barriers; no server, provider or database."""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from uuid import uuid4

import asyncpg
from fastapi import FastAPI
import pytest
from starlette.requests import Request

from sena_hub_api import assistant, assistant_model
from sena_hub_api.assistant import RunInput, register_assistant_routes
from sena_hub_api.auth import Actor, ALL_DEMO_ACTORS, Settings
from test_assistant import PROJECT, STAMP, TOKENS, Store


class DeliveryStore(Store):
    def __init__(self):
        super().__init__()
        self.finished = asyncio.Event()
        self.scope_deadline = '2099-11-05T10:00:00+00:00'
        self.expired = False
        self.denied = False
        self.current_actor = Actor(ALL_DEMO_ACTORS['editor'], 'editor')
        self.after_source_read = None

    async def fetchval(self, sql, *args):
        if 'assistant_citation_read' in sql and self.denied:
            raise asyncpg.InsufficientPrivilegeError('Private denied source must not escape')
        value = await super().fetchval(sql, *args)
        if 'assistant_access' in sql:
            value = json.loads(value)
            value['fingerprint'] += ':expired' if self.expired else ':active'
            value['scope'] = {'fingerprint': value['fingerprint'],
                              'expires_at': None if self.expired else self.scope_deadline}
            return json.dumps(value)
        if 'assistant_run_finish' in sql:
            self.finished.set()
        if 'hub.project_detail' in sql and self.after_source_read:
            await self.after_source_read()
        return value


def frame(value):
    if isinstance(value, bytes):
        value = value.decode()
    lines = value.strip().splitlines()
    return lines[0][7:], json.loads(lines[1][6:])


async def prepared_stream(monkeypatch, store):
    app = FastAPI()

    async def authentication(request):
        return store.current_actor

    async def fake_model(**kwargs):
        evidence = await kwargs['invoke_tool']('get_project', {'project_id': PROJECT})
        return {'fact_ids': [item['id'] for item in evidence['facts']], 'provider': 'fake',
                'usage': {'input_tokens': 0, 'output_tokens': 0}}

    monkeypatch.setattr(assistant_model, 'run_model', fake_model)
    monkeypatch.setattr(assistant_model, 'model_configuration', lambda: {
        'config_version': 'scope-barrier-stub', 'live_available': False, 'golden_questions': []})
    settings = Settings('postgresql://test:test@127.0.0.1:55432/sena_hub_local', 'demo', 'local', TOKENS)
    register_assistant_routes(app, authentication, store.database, settings)
    request = Request({'type': 'http', 'method': 'POST', 'path': '/v1/admin/assistant/runs',
                       'query_string': b'', 'headers': [], 'app': app})
    endpoint = next(route.endpoint for route in app.routes if route.path == '/v1/admin/assistant/runs')
    response = await endpoint(RunInput(message='Synthetic queued source'), request, store.current_actor)
    stream = response.body_iterator
    first = frame(await anext(stream))
    assert first[0] == 'status'
    # Deliberately withhold the consumer while the producer finishes and queues
    # all evidence. This is the real queue boundary, not an earlier model pause.
    await asyncio.wait_for(store.finished.wait(), 2)
    return stream, app, request


async def rest(stream):
    return [frame(value) async for value in stream]


@pytest.mark.parametrize('change', ['scope', 'expiry', 'identity', 'source_denied', 'source_version'])
def test_completed_producer_does_not_release_queued_evidence_after_revocation(monkeypatch, change):
    async def run():
        store = DeliveryStore()
        stream, _, _ = await prepared_stream(monkeypatch, store)
        if change == 'scope':
            store.fingerprint = 'new-selected-project-scope'
        elif change == 'expiry':
            store.expired = True  # Canonical SQL's fake-clock deadline transition.
        elif change == 'identity':
            store.current_actor = Actor(uuid4(), 'editor')
        elif change == 'source_denied':
            store.denied = True
        else:
            store.project['updated_at'] = '2026-10-01T00:00:01+00:00'
        output = await rest(stream)
        assert not any(name in {'citation', 'answer_delta', 'done'} for name, _ in output)
        errors = [data for name, data in output if name == 'error']
        assert len(errors) == 1 and errors[0]['invalidate_access'] is True
        assert 'Private denied source' not in str(output)
        assert store.project['public_name']['th'] not in str(output)
        assert output[-1][0] == 'error'
    asyncio.run(run())


def test_unchanged_allowed_neighbour_delivers_exact_saved_source_and_done(monkeypatch):
    async def run():
        store = DeliveryStore()
        stream, _, _ = await prepared_stream(monkeypatch, store)
        output = await rest(stream)
        assert [name for name, _ in output].count('citation') == 1
        answer = next(data for name, data in output if name == 'answer_delta')
        citation = next(data for name, data in output if name == 'citation')
        assert answer['citation_ids'] == [citation['id']]
        assert answer['metadata']['version'] == 'draft:' + STAMP
        assert output[-1][0] == 'done' and not any(name == 'error' for name, _ in output)
        # Initial preparation, citation delivery, answer delivery and completion
        # each reopen the saved source instead of trusting queued metadata.
        reads = [sql for sql, _, _ in store.calls if 'assistant_citation_read' in sql]
        assert len(reads) >= 4
    asyncio.run(run())


def test_source_revoked_after_citation_discards_waiting_answer_and_completion(monkeypatch):
    async def run():
        store = DeliveryStore()
        stream, _, _ = await prepared_stream(monkeypatch, store)
        while True:
            name, _ = frame(await anext(stream))
            if name == 'citation':
                break
        store.denied = True
        output = await rest(stream)
        assert not any(name in {'answer_delta', 'done'} for name, _ in output)
        assert output[-1][1]['invalidate_access'] is True
    asyncio.run(run())


def test_scope_change_during_final_source_read_is_checked_after_the_await(monkeypatch):
    async def run():
        store = DeliveryStore()
        stream, _, _ = await prepared_stream(monkeypatch, store)
        entered, release = asyncio.Event(), asyncio.Event()

        async def blocked_source():
            entered.set()
            await release.wait()

        store.after_source_read = blocked_source
        pending = asyncio.create_task(rest(stream))
        await asyncio.wait_for(entered.wait(), 2)
        store.fingerprint = 'revoked-during-source-read'
        release.set()
        output = await asyncio.wait_for(pending, 2)
        assert not any(name in {'citation', 'answer_delta', 'done'} for name, _ in output)
        assert output[-1][1]['invalidate_access'] is True
    asyncio.run(run())


@pytest.mark.parametrize('during_read', [False, True])
def test_expired_source_validity_in_queue_is_rejected_even_with_same_scope(monkeypatch, during_read):
    async def run():
        store = DeliveryStore()
        original = assistant.ToolReader.invoke
        deadline = datetime.now(timezone.utc) + timedelta(minutes=10)

        async def bounded_source(reader, *args, **kwargs):
            result = deepcopy(await original(reader, *args, **kwargs))
            result['sources'][0]['valid_until'] = deadline.isoformat()
            return result

        monkeypatch.setattr(assistant.ToolReader, 'invoke', bounded_source)
        stream, _, _ = await prepared_stream(monkeypatch, store)

        class AfterDeadline(datetime):
            @classmethod
            def now(cls, tz=None):
                return (deadline + timedelta(seconds=1)).astimezone(tz)

        if during_read:
            async def expire_during_read():
                monkeypatch.setattr(assistant, 'datetime', AfterDeadline)
            store.after_source_read = expire_during_read
        else:
            monkeypatch.setattr(assistant, 'datetime', AfterDeadline)
        output = await rest(stream)
        assert not any(name in {'citation', 'answer_delta', 'done'} for name, _ in output)
        assert output[-1][1]['invalidate_access'] is True
    asyncio.run(run())


def test_config_exposes_only_current_callers_opaque_session_and_scope_deadline(monkeypatch):
    async def run():
        store = DeliveryStore()
        stream, app, request = await prepared_stream(monkeypatch, store)
        await rest(stream)
        endpoint = next(route.endpoint for route in app.routes if route.path == '/v1/admin/assistant/config')
        before = (await endpoint(request, store.current_actor))['data']
        assert before['scope_expires_at'] == store.scope_deadline
        assert 'scope' not in before and 'fingerprint' not in before
        assert not any(key in before for key in ('account_id', 'project_ids', 'bu_ids', 'history'))
        store.expired = True
        after = (await endpoint(request, store.current_actor))['data']
        assert after['scope_expires_at'] is None and before['session_key'] != after['session_key']
    asyncio.run(run())
