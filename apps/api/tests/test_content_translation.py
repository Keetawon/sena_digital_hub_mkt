"""No live provider: validate the exact marketing-text boundary and failure path."""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest

from sena_hub_api import content_translation as translation


def test_glossary_numbers_and_fact_slots_survive_in_exact_counts():
    source = 'นอนดี พื้นที่ 20.5 ตารางเมตร {common_fee} 20.5'
    masked, values = translation.protect_text(source, [{'th': 'นอนดี', 'en': 'Approved brand'}, {'th': 'ตารางเมตร', 'en': 'square metres'}])
    assert 'นอนดี' not in masked and '{common_fee}' not in masked and '20.5' not in masked
    english = translation.restore_text(source, masked.replace('พื้นที่', 'area'), values, 300)
    assert english == 'Approved brand area 20.5 square metres {common_fee} 20.5'
    for invalid in (masked + ' 99', masked.replace(next(iter(values)), ''), masked + next(iter(values)), '<script>' + masked):
        with pytest.raises(translation.TranslationError, match='invalid_translation'):
            translation.restore_text(source, invalid, values, 300)
    with pytest.raises(translation.TranslationError):
        translation.restore_text(source, masked, values, 10)
    with pytest.raises(translation.TranslationError):
        translation.protect_text(source, [{'th': 'ชื่อ', 'en': 'One'}, {'th': 'ชื่อ', 'en': 'Two'}])


class FakeDatabase:
    def __init__(self, job):
        self.job = job
        self.calls = []

    @asynccontextmanager
    async def transaction(self):
        yield

    async def execute(self, sql):
        assert sql == 'SET LOCAL ROLE hub_translation_worker'

    async def fetchval(self, sql, *args):
        self.calls.append((sql, args))
        if 'claim_translation' in sql:
            return self.job
        assert 'finish_translation' in sql
        return 'failed' if args[-1] else 'done'


@pytest.mark.parametrize('failure', [None, 'corrupt_number', 'provider_error', 'no_provider'])
def test_worker_only_sends_masked_text_and_returns_bounded_status(monkeypatch, failure):
    job = {'id': str(uuid4()), 'lease_token': str(uuid4()), 'text': 'พื้นที่ 20 ไร่ {project}', 'glossary': [], 'max_length': 300}
    db = FakeDatabase(job)

    class Provider:
        model = 'stub-provider'

        async def translate(self, text, maximum):
            assert ' 20 ' not in text and '{project}' not in text and maximum == 300
            if failure == 'provider_error':
                raise RuntimeError('Private provider response must not escape')
            return text.replace('พื้นที่', 'Area').replace('ไร่', 'rai') + (' 99' if failure == 'corrupt_number' else '')

    if failure == 'no_provider':
        monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    result = asyncio.run(translation.work_once(db, None if failure == 'no_provider' else Provider()))
    assert result['status'] == ('failed' if failure else 'done')
    assert set(result) == {'status', 'error_code'}
    assert 'Private provider' not in str(result)
    args = db.calls[-1][1]
    if not failure:
        assert args[2] == 'Area 20 rai {project}'
    else:
        assert args[-1] == {'corrupt_number': 'invalid_translation', 'provider_error': 'provider_error', 'no_provider': 'provider_unavailable'}[failure]
    idle = FakeDatabase(None)
    assert asyncio.run(translation.work_once(idle, Provider())) == {'status': 'idle'}
    assert len(idle.calls) == 1


def test_provider_request_uses_structured_output_and_never_logs_error(monkeypatch, caplog):
    requests = []

    class FakeClient:
        def __init__(self, **options):
            assert options['base_url'] == 'https://api.openai.com/v1'
            assert options['max_retries'] == 0 and options['timeout'] == 45
            self.responses = self

        async def parse(self, **args):
            requests.append(args)
            return SimpleNamespace(status='completed', output_parsed=translation.EnglishDraft(english='English draft'))

        async def close(self):
            pass

    monkeypatch.setenv('OPENAI_API_KEY', 'synthetic-unit-test-placeholder')
    monkeypatch.setattr('openai.AsyncOpenAI', FakeClient)
    provider = translation.OpenAITranslator()
    assert asyncio.run(provider.translate('Marketing text only', 100)) == 'English draft'
    request = requests[0]
    assert request['store'] is False and request['text_format'] is translation.EnglishDraft
    assert 'tools' not in request and 'file' not in str(request)
    assert request['input'][1] == {'role': 'user', 'content': 'Marketing text only'}
    assert not caplog.records
