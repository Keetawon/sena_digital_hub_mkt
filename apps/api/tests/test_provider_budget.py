"""Isolated provider keys and quota errors; no provider or hosted connection."""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4, UUID

import httpx
import pytest
from openai import RateLimitError

from sena_hub_api import content_translation, media_worker, knowledge_retrieval
from sena_hub_api.provider_budget import SPEND_CODES, ProviderBudgetExceeded, spend_limit_code


def quota(code):
    return RateLimitError('synthetic-private-content-must-not-escape', response=httpx.Response(429,
        request=httpx.Request('POST','https://api.openai.com/v1/responses')), body={'error':{'code':code}})


def test_media_and_translation_never_fall_back_to_api_key(monkeypatch, caplog):
    monkeypatch.setenv('OPENAI_API_KEY','synthetic-api-only-value')
    monkeypatch.delenv('HUB_MEDIA_OPENAI_API_KEY',raising=False)
    monkeypatch.delenv('HUB_TRANSLATION_OPENAI_API_KEY',raising=False)
    monkeypatch.setattr('openai.AsyncOpenAI',lambda **kwargs:pytest.fail('No provider client with another caller key'))
    with pytest.raises(content_translation.TranslationError,match='provider_unavailable'):
        media_worker.OpenAIImageSuggester()
    with pytest.raises(content_translation.TranslationError,match='provider_unavailable'):
        content_translation.OpenAITranslator(key_variable='HUB_TRANSLATION_OPENAI_API_KEY')
    assert not caplog.records


@pytest.mark.parametrize('code',sorted(SPEND_CODES))
def test_each_spend_code_is_bounded_and_has_no_retry(monkeypatch,caplog,code):
    seen=[]
    class Client:
        def __init__(self,**kwargs):
            assert kwargs['max_retries']==0
            assert kwargs.get('api_key') in ('synthetic-media-only-value',None)
            self.responses=self;self.embeddings=self
        async def parse(self,**kwargs):
            seen.append('media');raise quota(code)
        async def create(self,**kwargs):
            seen.append('embedding');raise quota(code)
        async def close(self):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
    monkeypatch.setattr('openai.AsyncOpenAI',Client)
    monkeypatch.setenv('HUB_MEDIA_OPENAI_API_KEY','synthetic-media-only-value')
    monkeypatch.setenv('OPENAI_API_KEY','synthetic-api-only-value')
    provider=media_worker.OpenAIImageSuggester()
    with pytest.raises(ProviderBudgetExceeded) as error:
        asyncio.run(provider.suggest('data:image/jpeg;base64,c3ludGhldGlj',{}))
    assert error.value.code==code and str(error.value)=='budget_exhausted'
    with pytest.raises(ProviderBudgetExceeded):asyncio.run(knowledge_retrieval.embed(['synthetic query']))
    assert seen==['media','embedding'] and not caplog.records
    assert spend_limit_code(quota('rate_limit_exceeded')) is None


@pytest.mark.parametrize('code',sorted(SPEND_CODES))
def test_worker_stops_claiming_without_finishing_failed_or_draining_another_queue(monkeypatch,code):
    monkeypatch.setattr(media_worker,'resized_image',lambda _: 'data:image/jpeg;base64,c3ludGhldGlj')
    job={'id':str(uuid4()),'lease_token':str(uuid4()),'kind':'image_suggestion','file':{},'context':{},'model':'synthetic-configured-provider'}
    class Database:
        blocked=False
        calls=[]
        @asynccontextmanager
        async def transaction(self):yield
        async def execute(self,sql):assert sql=='SET LOCAL ROLE hub_media_worker'
        async def fetchval(self,sql,*args):
            self.calls.append((sql,args))
            if 'media_budget_blocked' in sql:return self.blocked
            if 'media_claim()' in sql:return job
            if 'media_image_begin' in sql:return True
            assert 'media_budget_exhausted' in sql and args==(UUID(job['id']),UUID(job['lease_token']),code)
            self.blocked=True;return 'budget_exhausted'
    class Provider:
        model='synthetic-configured-provider'
        calls=0
        async def suggest(self,*args):
            self.calls+=1;raise ProviderBudgetExceeded(code)
    db,provider=Database(),Provider()
    first=asyncio.run(media_worker.work_once(db,provider))
    assert first=={'status':'budget_exhausted','error_code':'budget_exhausted'}
    previous=len(db.calls)
    assert asyncio.run(media_worker.work_once(db,provider))==first
    assert len(db.calls)==previous+1 and provider.calls==1
    assert not any('translation' in sql or 'media_finish' in sql for sql,_ in db.calls)


def test_distinct_agent_keys_are_selected_explicitly(monkeypatch):
    seen=[]
    class Client:
        def __init__(self,**kwargs):seen.append(kwargs['api_key'])
    monkeypatch.setattr('openai.AsyncOpenAI',Client)
    monkeypatch.setenv('OPENAI_API_KEY','synthetic-api-only-value')
    monkeypatch.setenv('HUB_MEDIA_OPENAI_API_KEY','synthetic-media-only-value')
    monkeypatch.setenv('HUB_TRANSLATION_OPENAI_API_KEY','synthetic-translation-only-value')
    media_worker.OpenAIImageSuggester()
    content_translation.OpenAITranslator(key_variable='HUB_TRANSLATION_OPENAI_API_KEY')
    assert seen==['synthetic-media-only-value','synthetic-translation-only-value']


def test_embeddings_work_with_only_the_api_key(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','synthetic-api-only-value')
    for key in ('HUB_MEDIA_OPENAI_API_KEY','HUB_TRANSLATION_OPENAI_API_KEY'):
        monkeypatch.delenv(key,raising=False)
    calls=[]
    class Client:
        def __init__(self,**kwargs):
            assert kwargs['max_retries']==0
            self.embeddings=self
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def create(self,**kwargs):
            calls.append(True)
            return SimpleNamespace(data=[SimpleNamespace(index=0,embedding=[1,0])])
    monkeypatch.setattr('openai.AsyncOpenAI',Client)
    assert asyncio.run(knowledge_retrieval.embed(['synthetic public text']))==[[1,0]]
    assert calls==[True]
