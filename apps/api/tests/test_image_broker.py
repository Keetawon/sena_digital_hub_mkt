"""Synthetic Unix peer/protocol and sequential image-worker checks; providers mocked."""
import asyncio
from contextlib import asynccontextmanager
import hashlib
import io
import json
import socket
import struct
from uuid import uuid4

from PIL import Image
import pytest

from sena_hub_api import image_broker as broker
from sena_hub_api.content_translation import DEFAULT_MODEL
from sena_hub_api.hosted_media_worker import image_once
from sena_hub_api.media_worker import MediaError, bounded_image_context
from sena_hub_api.provider_budget import ProviderBudgetExceeded, SPEND_CODES
from test_media_worker import suggestion


def png():
    output = io.BytesIO(); Image.new('RGB', (12, 8), 'green').save(output, 'PNG'); return output.getvalue()


def test_provider_input_bound_precedes_any_provider_call():
    assert json.loads(bounded_image_context({'synthetic': 'context'})) == {'synthetic': 'context'}
    with pytest.raises(MediaError, match='invalid_result'):
        bounded_image_context({'oversized': 'x' * 32769})


def test_broker_reencodes_only_bounded_jpeg_and_rejects_input_and_pixel_bombs(monkeypatch):
    raw = png(); meta = {'mime_type': 'image/png', 'file_size': len(raw), 'checksum': hashlib.sha256(raw).hexdigest()}
    jpeg = broker.jpeg_for_lease(meta, lambda _: raw)
    assert jpeg != raw
    with Image.open(io.BytesIO(jpeg)) as image:
        assert image.format == 'JPEG' and max(image.size) <= 768 and not image.getexif()
    monkeypatch.setattr(broker.assets, 'MAX_PIXELS', 10)
    with pytest.raises(ValueError): broker.jpeg_for_lease(meta, lambda _: raw)
    monkeypatch.setattr(broker.assets, 'MAX_BYTES', 10)
    with pytest.raises(ValueError): broker.jpeg_for_lease(meta, lambda _: pytest.fail('Oversize originals are never read'))


@pytest.mark.parametrize('scenario', ['wrong_uid','expired_lease','foreign_lease','stale_revision','ineligible','bad_request','ok'])
def test_broker_peer_and_lease_denials_are_audited_and_return_no_original(monkeypatch, scenario):
    monkeypatch.setattr(socket, 'SO_PEERCRED', 17, raising=False)
    async def check():
        raw = png(); metadata = {'mime_type': 'image/png', 'file_size': len(raw), 'checksum': hashlib.sha256(raw).hexdigest()}
        calls = []
        class Peer:
            def getsockopt(self, *_): return struct.pack('3i', 1, 99 if scenario == 'wrong_uid' else 42, 42)
        class Writer:
            data = b''
            def get_extra_info(self, _): return Peer()
            def write(self, value): self.data += value
            async def drain(self): pass
            def close(self): pass
            async def wait_closed(self): pass
        service = broker.ImageBroker(None, lambda _: raw, 42)
        async def rpc(query, *args, **kwargs):
            calls.append((query, args))
            if 'media_image_lease' in query:
                assert kwargs['readonly'] is True
                return metadata if scenario == 'ok' else None
        service.rpc = rpc
        reader = asyncio.StreamReader(limit=257)
        request = {'job_id': str(uuid4()), 'lease': str(uuid4())}
        if scenario == 'bad_request': request['path'] = '/private-original'
        reader.feed_data(json.dumps(request).encode() + b'\n'); reader.feed_eof(); writer = Writer()
        try: await service.handle(reader, writer)
        finally: service.close()
        length = struct.unpack('!I', writer.data[:4])[0]
        assert (length > 0) == (scenario == 'ok')
        if scenario != 'ok': assert writer.data == b'\0' * 4
        audits = [c for c in calls if 'media_image_fetch_audit' in c[0]]
        assert len(audits) == 1 and audits[0][1][1] == ('ok' if scenario == 'ok' else 'denied')
        if scenario == 'wrong_uid': assert not any('media_image_lease' in c[0] for c in calls)
    asyncio.run(check())


class FakeDb:
    def __init__(self):
        self.calls = []; self.job = {'id': str(uuid4()), 'lease_token': str(uuid4()), 'kind': 'image_suggestion',
                                   'model': DEFAULT_MODEL, 'context': {'categories': ['exterior'], 'tags': [{'code': 'day', 'allowed_categories': []}]}}
    @asynccontextmanager
    async def transaction(self): yield
    async def execute(self, query): assert query == 'SET LOCAL ROLE hub_media_worker'
    async def fetchval(self, query, *args):
        self.calls.append(query)
        assert 'translation' not in query and 'schedule_checks' not in query and 'select hub.media_claim()' != query
        if 'heartbeat' in query: return True
        if 'budget_blocked' in query: return False
        if 'media_image_claim' in query: return self.job
        if 'media_image_begin' in query: return True
        if 'media_image_wait' in query: return 'queued'
        if 'media_budget_exhausted' in query: return 'budget_exhausted'
        if 'media_image_finish' in query: return 'failed' if args[4] else 'done'
        pytest.fail('Unexpected worker RPC')


def test_absent_media_key_does_not_claim_or_touch_any_other_queue(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'synthetic-other-agent-key')
    monkeypatch.delenv('HUB_MEDIA_OPENAI_API_KEY', raising=False)
    monkeypatch.setattr('sena_hub_api.hosted_media_worker.OpenAIImageSuggester', lambda: pytest.fail('No provider client'))
    db = FakeDb(); result = asyncio.run(image_once(db, configured=False))
    assert result['status'] == 'not_configured' and len(db.calls) == 1 and 'heartbeat' in db.calls[0]


@pytest.mark.parametrize('failure', ['broker','provider',*sorted(SPEND_CODES),None])
def test_fetch_precedes_provider_attempt_and_a_billed_attempt_is_not_retried(failure):
    db = FakeDb(); order = []
    class Provider:
        model = DEFAULT_MODEL
        last_usage = {'input_tokens': 100, 'output_tokens': 20, 'cached_input_tokens': 0}
        async def suggest(self, *_):
            order.append('provider')
            assert any('media_image_begin' in q for q in db.calls)
            if failure in SPEND_CODES: raise ProviderBudgetExceeded(failure)
            if failure == 'provider': raise MediaError('provider_error')
            return suggestion()
    async def fetch(*_):
        order.append('fetch')
        assert not any('media_image_begin' in q for q in db.calls)
        if failure == 'broker': raise OSError('Synthetic private error is never emitted')
        return b'synthetic-resized-jpeg'
    result = asyncio.run(image_once(db, configured=True, provider=Provider(), fetch=fetch))
    if failure == 'broker':
        assert order == ['fetch'] and result['status'] == 'queued'
        assert not any('media_image_begin' in q or 'media_image_finish' in q for q in db.calls)
    else:
        assert order == ['fetch','provider']
        assert result['status'] == ('budget_exhausted' if failure in SPEND_CODES else 'failed' if failure else 'done')
        assert sum('media_image_begin' in q for q in db.calls) == 1
