"""All storage/identity values below are synthetic; no network or cloud calls."""
import hashlib
import io
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import UUID

import pytest
from botocore.exceptions import ClientError
from fastapi import HTTPException

from sena_hub_api import main, r2_assets, knowledge
from sena_hub_api.auth import Authentication
from sena_hub_api.r2_assets import R2Assets, BUCKET
from test_assets import image_bytes
from test_hosted_h1 import h1_settings, hosted_configuration, metadata_for, signed_client, signing_key


class MemoryS3:
    def __init__(self):
        self.objects = {}
        self.calls = []
        self.meta = SimpleNamespace(events=SimpleNamespace(register=lambda *args: None))

    def head_bucket(self, **kwargs):
        self.calls.append(('head', kwargs))
        return {}

    def put_object(self, **kwargs):
        self.calls.append(('put', kwargs))
        assert kwargs['IfNoneMatch'] == '*'
        if kwargs['Key'] in self.objects:
            raise ClientError({'Error': {'Code': 'PreconditionFailed'}}, 'PutObject')
        self.objects[kwargs['Key']] = kwargs['Body']
        return {}

    def get_object(self, **kwargs):
        self.calls.append(('get', kwargs))
        if kwargs['Key'] not in self.objects:
            raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'GetObject')
        data = self.objects[kwargs['Key']]
        return {'Body': io.BytesIO(data), 'ContentLength': len(data)}


@pytest.fixture
def configured(tmp_path, monkeypatch):
    config = {'endpoint_url': 'http://127.0.0.1:54329/r2', 'bucket': 'h1-synthetic-content',
              'access_key_id': 'H1_SYNTHETIC_ACCESS_ONLY', 'secret_access_key': 'H1-synthetic-secret-not-valid'}
    path = tmp_path / 'synthetic-r2.json'
    path.write_text(json.dumps(config), encoding='utf-8')
    client = MemoryS3()
    monkeypatch.setattr(r2_assets.boto3, 'client', lambda *args, **kwargs: client)
    settings = h1_settings(supabase_storage_key='', r2_credentials_file=str(path), r2_private_bucket_confirmed=True)
    return settings, client, path, config


def test_r2_private_config_and_replay(configured):
    settings, client, _, _ = configured
    store = R2Assets(settings)
    content = image_bytes()
    metadata = {**metadata_for(content), 'storage_bucket': BUCKET}
    store.require_private_bucket()
    assert store.install(content, metadata) is True
    assert store.install(content, metadata) is False
    assert store.read(metadata) == content
    assert len(client.objects) == 1
    assert metadata['storage_path'] not in client.objects  # Prefix separates originals from held candidates.


def test_reviewed_website_asset_reuses_only_its_exact_private_knowledge_hash(configured):
    settings, client, _, _ = configured
    store = R2Assets(settings)
    content = image_bytes()
    metadata = {**metadata_for(content), 'storage_bucket': BUCKET}
    evidence = {'sha256': metadata['checksum'], 'bytes': len(content), 'storage_bucket': BUCKET}
    store.install_knowledge(content, evidence)
    metadata['storage_path'] = 'knowledge/' + metadata['checksum']
    before = len(client.objects)
    assert store.read(metadata) == content
    assert store.install(content, metadata) is False
    assert len(client.objects) == before == 1
    for changes in [{'storage_path': 'knowledge/../other'}, {'storage_path': 'knowledge/' + '0' * 64},
                    {'storage_bucket': 'other'}, {'source_system': 'hub-local'}, {'mime_type': 'text/html'}]:
        with pytest.raises(HTTPException) as caught:
            store.read({**metadata, **changes})
        assert caught.value.status_code == 404
    client.objects[metadata['storage_path']] = b'changed'
    with pytest.raises(HTTPException) as caught:
        store.read(metadata)
    assert caught.value.status_code == 503


@pytest.mark.parametrize('field,value', [
    ('endpoint_url','https://attacker.invalid'), ('endpoint_url','http://169.254.169.254'),
    ('endpoint_url','http://127.0.0.1:54329/r2?token=not-valid'), ('bucket','../other'),
    ('access_key_id',''), ('secret_access_key',''),
])
def test_r2_wrong_target_fails_before_client(configured, monkeypatch, field, value):
    settings, _, path, config = configured
    path.write_text(json.dumps({**config,field:value}), encoding='utf-8')
    monkeypatch.setattr(r2_assets.boto3, 'client', lambda *a, **kw: pytest.fail('Invalid target reached SDK'))
    with pytest.raises(ValueError, match='details withheld'):
        R2Assets(settings)


@pytest.mark.parametrize('overrides', [
    {'r2_credentials_file':''}, {'r2_private_bucket_confirmed':False},
    {'supabase_storage_key':'synthetic-privileged-key-not-allowed'},
])
def test_hosted_requires_r2_and_confirmed_privacy(overrides):
    with pytest.raises(ValueError):
        hosted_configuration(**overrides)


@pytest.mark.parametrize('url', ['https://other.invalid/path','http://127.0.0.1:54329/r2/other-bucket/x',
                                 'http://127.0.0.1:54329/r2/h1-synthetic-content/x?redirect=1'])
def test_sdk_cannot_redirect_signed_request(configured, url):
    store = R2Assets(configured[0])
    with pytest.raises(HTTPException):
        store._check_destination(SimpleNamespace(url=url))


@pytest.mark.parametrize('change', [{'storage_bucket':'hub-test-assets'}, {'source_system':'hub-local'},
                                   {'storage_path':'../secrets'}, {'file_size':True}])
def test_r2_metadata_fails_before_io(configured, change):
    store = R2Assets(configured[0])
    metadata = {**metadata_for(image_bytes()),'storage_bucket':BUCKET,**change}
    with pytest.raises(HTTPException): store.read(metadata)
    assert not configured[1].calls


def test_r2_hash_size_and_safe_errors(configured, monkeypatch):
    settings, client, _, config = configured
    store = R2Assets(settings)
    content = image_bytes()
    metadata = {**metadata_for(content),'storage_bucket':BUCKET}
    store.install(content,metadata)
    key = next(iter(client.objects))
    client.objects[key] = b'x' * len(content)
    with pytest.raises(HTTPException) as error: store.read(metadata)
    assert error.value.detail['code'] == 'file_unavailable'
    def denied(**kwargs):
        raise ClientError({'Error':{'Code':'AccessDenied','Message':config['secret_access_key']}},'GetObject')
    monkeypatch.setattr(client,'get_object',denied)
    with pytest.raises(HTTPException) as error: store.read(metadata)
    assert error.value.status_code == 503
    assert config['secret_access_key'] not in str(error.value)
    assert config['access_key_id'] not in repr(settings)


def test_knowledge_originals_are_hash_addressed(configured):
    store = R2Assets(configured[0])
    content = b'<svg><script>synthetic held content</script></svg>'
    evidence = {'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content),'storage_bucket':BUCKET}
    assert store.install_knowledge(content,evidence) is True
    assert store.read_knowledge(evidence) == content
    with pytest.raises(HTTPException): store.read_knowledge({**evidence,'storage_bucket':'other'})


def test_private_thumbnail_revalidates_and_transcodes():
    content=image_bytes()
    metadata=metadata_for(content)
    evidence={'validated_metadata':metadata}
    thumbnail=knowledge.private_thumbnail(content,evidence)
    assert thumbnail[:4]==b'RIFF' and thumbnail[8:12]==b'WEBP'
    with pytest.raises(HTTPException): knowledge.private_thumbnail(b'<svg>untrusted</svg>',evidence)
    with pytest.raises(HTTPException): knowledge.private_thumbnail(content,{'validated_metadata':{**metadata,'checksum':'0'*64}})


def test_hosted_knowledge_file_checks_db_and_uses_attachment(configured, signing_key, monkeypatch):
    settings, s3, _, _ = configured
    store = R2Assets(settings)
    content = b'<svg><script>held original</script></svg>'
    evidence = {'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content),'storage_bucket':BUCKET,'mime':'image/png'}
    store.install_knowledge(content,evidence)
    calls = []
    class DB:
        async def fetchval(self,sql,*args):
            calls.append(sql)
            return evidence
    @asynccontextmanager
    async def database(request,actor): yield DB()
    monkeypatch.setattr(main,'database',database)
    client, headers = signed_client(signing_key,role='admin',settings=settings)
    path = f'/v1/admin/knowledge/candidates/{UUID(int=900)}/file'
    response = client.get(path,headers=headers)
    assert response.status_code == 200 and response.content == content
    assert calls == ["SELECT evidence FROM hub.knowledge_candidate_rows() WHERE id=$1 AND kind='asset'"] * 2
    assert response.headers['content-type'] == 'application/octet-stream'
    assert response.headers['content-disposition'].startswith('attachment;')
    assert response.headers['cache-control'] == 'no-store'
    for role in ('viewer', 'editor', 'publisher'):
        other, other_headers = signed_client(signing_key, role=role, settings=settings)
        before = len(s3.calls)
        assert other.get(path, headers=other_headers).status_code == 403
        assert len(calls) == 2 and len(s3.calls) == before
    original = Authentication.load_account
    async def hidden(self,request,claims):
        account = await original(self,request,claims)
        account['capabilities']['tabs']['knowledge']['view'] = False
        return account
    monkeypatch.setattr(Authentication,'load_account',hidden)
    before = len(s3.calls)
    assert client.get(path,headers=headers).status_code == 403
    assert len(calls) == 2 and len(s3.calls) == before


@pytest.mark.parametrize('path,body', [('preview',{'question':'test'}),
    ('projects/SYNTHETIC/preview-release',{'expected_reviews':{},'reason':'test','confirmed':True})])
def test_hosted_knowledge_never_runs_preview(configured, signing_key, monkeypatch, path, body):
    monkeypatch.setattr(main,'database',lambda *a: pytest.fail('Deferred operation reached DB'))
    client,headers = signed_client(signing_key,role='admin',settings=configured[0])
    response = client.post('/v1/admin/knowledge/'+path,headers=headers,json=body)
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'knowledge_preview_unavailable'
