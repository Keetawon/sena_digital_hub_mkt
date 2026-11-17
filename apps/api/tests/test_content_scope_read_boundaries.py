"""W6 final read boundaries: synthetic bytes/providers; real RLS uses the existing disposable fixture."""
import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import timedelta
import hashlib
import io
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from sena_hub_api import knowledge, main
from sena_hub_api.auth import Authentication
from sena_hub_api.staff_media import THUMBNAILS_SQL
from test_api import settings, TOKENS
from test_permission_foundations import permission_accounts


PROJECT = 'BOUNDARY-A'
NEIGHBOUR = 'BOUNDARY-B'
CANDIDATE = UUID(int=8801)
RELEASE = UUID(int=8802)
CONTENT = b'Synthetic private source bytes'
HEADERS = {'Authorization': 'Bearer ' + TOKENS['admin']}


def source(text='PRIVATE BEFORE'):
    return {'fact_card': {'name': {'th': text}, 'status': {'raw': 2, 'source_ref': 'synthetic:boundary'},
                         'model_catalogue_complete': True},
            'chunks': [{'id': str(uuid4()), 'candidate_id': str(CANDIDATE), 'kind': 'faq', 'embedding': [1.0, 0.0],
                        'keywords': ['garden'], 'evidence': {'short_answer': {'th': text}},
                        'source_url': None, 'source_ref': 'synthetic:boundary', 'batch_sha256': '8' * 64}]}


def project_row(project=PROJECT, text='PRIVATE BEFORE'):
    return {'category': 0, 'project_id': project, 'card': source(text)['fact_card'], 'candidates': 0,
            'progress_candidates': [], 'gaps': 0, 'thumbnail': None, 'brand_logo': None}


@pytest.fixture
def boundary(monkeypatch, tmp_path):
    state = SimpleNamespace(source=source(), visible=True, evidence={'sha256': hashlib.sha256(CONTENT).hexdigest(),
        'bytes': len(CONTENT), 'mime': 'application/pdf', 'storage_bucket': 'synthetic-private'},
        status='ACTIVE', role='admin', knowledge_view=True, account_reads=0, calls=[], gaps=[], embeds=[],
        storage_hook=None, thumbnail_hook=None, embed_hook=None, gap_hook=None, projection_hook=None,
        projects=[project_row()], pack=None, dashboard=None)
    state.pack = {'card': source()['fact_card'], 'items': [{'id': str(CANDIDATE), 'kind': 'faq',
        'evidence': {'short_answer': {'th': 'Permitted answer'}, 'locations': ['PRIVATE PATH'], 'validated_metadata': {'private': True}}}],
        'followup': {'questions': []}, 'faq_controls': {str(CANDIDATE): {'read_only': True, 'cluster_ids': ['exact-cluster']}}}
    original = Authentication.load_account

    async def account(self, request, claims):
        result = await original(self, request, claims)
        state.account_reads += 1
        result.update(status=state.status, hub_role=state.role)
        result['capabilities']['tabs']['knowledge']['view'] = state.knowledge_view
        return result

    class DB:
        async def fetch(self, statement, *args):
            state.calls.append((statement, args))
            if statement == knowledge.PROJECTS_SQL:
                if state.projection_hook: await state.projection_hook()
                return deepcopy(state.projects)
            if statement == knowledge.PREVIEW_CARDS_SQL:
                return [{'rem_project_id': PROJECT, 'payload': deepcopy(state.source['fact_card']), 'aliases': []}] if state.visible else []
            pytest.fail('Unexpected split projection read')

        async def fetchval(self, statement, *args):
            state.calls.append((statement, args))
            if "SELECT evidence FROM hub.knowledge_candidate_rows()" in statement:
                assert args == (CANDIDATE,)
                return deepcopy(state.evidence) if state.visible else None
            if statement == knowledge.PREVIEW_SOURCE_SQL or statement == 'SELECT hub.knowledge_preview_read($1,$2)':
                assert args == ((PROJECT,) if statement == knowledge.PREVIEW_SOURCE_SQL else (RELEASE, PROJECT))
                return deepcopy(state.source) if state.visible else None
            if statement == knowledge.PACK_SQL:
                if state.projection_hook: await state.projection_hook()
                return deepcopy(state.pack) if state.visible else None
            if 'hub.brand_completeness()' in statement:
                assert THUMBNAILS_SQL in statement
                if state.projection_hook: await state.projection_hook()
                return deepcopy(state.dashboard)
            pytest.fail('Unexpected final source read')

        async def execute(self, statement, *args):
            assert "hub.record_knowledge_gap($1,'NO_ANSWER',$2)" in statement
            state.gaps.append(args)
            if state.gap_hook: await state.gap_hook()

    @asynccontextmanager
    async def database(request, actor):
        yield DB()

    async def embed(texts):
        state.embeds.append(texts)
        if state.embed_hook: await state.embed_hook()
        return [[1.0, 0.0]]

    def stored(evidence):
        assert evidence['sha256'] == hashlib.sha256(CONTENT).hexdigest()
        if state.storage_hook: state.storage_hook()
        return CONTENT

    monkeypatch.setattr(Authentication, 'load_account', account)
    monkeypatch.setattr(main, 'database', database)
    monkeypatch.setattr(knowledge, 'embed', embed)
    config = settings()
    app = main.create_app(config)
    app.state.hosted_assets = SimpleNamespace(read_knowledge=stored)
    path = tmp_path / hashlib.sha256(CONTENT).hexdigest()
    path.write_bytes(CONTENT)
    monkeypatch.setattr(knowledge, 'file_path', lambda evidence: path)
    local_read = knowledge.local_candidate_bytes

    def local(evidence):
        result = local_read(evidence)
        if state.storage_hook: state.storage_hook()
        return result

    def thumbnail(content, evidence):
        if state.thumbnail_hook: state.thumbnail_hook()
        return b'Synthetic checked thumbnail'

    monkeypatch.setattr(knowledge, 'local_candidate_bytes', local)
    monkeypatch.setattr(knowledge, 'private_thumbnail', thumbnail)
    state.client = TestClient(app, client=('127.0.0.1', 50000))
    state.config = config
    return state


def hosted(state):
    # Constructed locally above: no storage constructor or configuration file is read.
    object.__setattr__(state.config, 'environment', 'hosted-test')
    object.__setattr__(state.config, 'r2_credentials_file', Path('synthetic-not-opened'))


def revoke(state, change):
    if change == 'suspend': state.status = 'SUSPENDED'
    elif change == 'demote': state.role = 'editor'
    elif change == 'permission': state.knowledge_view = False
    elif change == 'scope': state.visible = False
    elif change == 'storage': state.evidence['storage_bucket'] = 'replaced-identity'
    else: raise AssertionError(change)


@pytest.mark.parametrize('stage', ['local', 'storage', 'thumbnail'])
@pytest.mark.parametrize('change,status', [('suspend', 403), ('demote', 403), ('permission', 403), ('scope', 404), ('storage', 409)])
def test_private_bytes_are_discarded_when_authority_or_exact_storage_identity_changes(boundary, stage, change, status):
    if stage != 'local': hosted(boundary)
    setattr(boundary, 'thumbnail_hook' if stage == 'thumbnail' else 'storage_hook', lambda: revoke(boundary, change))
    response = boundary.client.get(f'/v1/admin/knowledge/candidates/{CANDIDATE}/file' + ('?thumbnail=true' if stage == 'thumbnail' else ''), headers=HEADERS)
    assert response.status_code == status
    assert CONTENT not in response.content and b'Synthetic checked thumbnail' not in response.content
    assert response.headers['cache-control'] == 'no-store'
    assert boundary.account_reads >= 2


@pytest.mark.parametrize('mode', ['local', 'hosted', 'thumbnail'])
def test_unchanged_private_source_preserves_bytes_and_attachment_or_thumbnail_contract(boundary, mode):
    if mode != 'local': hosted(boundary)
    response = boundary.client.get(f'/v1/admin/knowledge/candidates/{CANDIDATE}/file' + ('?thumbnail=true' if mode == 'thumbnail' else ''), headers=HEADERS)
    assert response.status_code == 200
    assert response.content == (b'Synthetic checked thumbnail' if mode == 'thumbnail' else CONTENT)
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert response.headers['content-type'] == ('image/webp' if mode == 'thumbnail' else 'application/octet-stream')
    if mode != 'thumbnail': assert response.headers['content-disposition'] == f'attachment; filename="{boundary.evidence["sha256"]}"'
    assert len(boundary.calls) == 2 and boundary.calls[0] == boundary.calls[1]


def test_local_file_read_is_bounded_and_integrity_checked(monkeypatch):
    lengths = []
    class Stream(io.BytesIO):
        def read(self, size=-1): lengths.append(size); return super().read(size)
    class File:
        def is_file(self): return True
        def open(self, mode): assert mode == 'rb'; return Stream(b'1234567890')
    monkeypatch.setattr(knowledge, 'KNOWLEDGE_MAX_BYTES', 8)
    monkeypatch.setattr(knowledge, 'file_path', lambda evidence: File())
    content = knowledge.local_candidate_bytes({}, max_bytes=knowledge.KNOWLEDGE_MAX_BYTES)
    assert len(content) == 9 and lengths == [9]
    with pytest.raises(HTTPException) as error:
        knowledge.checked_candidate_bytes(content, {'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)})
    assert error.value.status_code == 503
    for invalid in [{'sha256': '0' * 64}, {'sha256': hashlib.sha256(b'12345678').hexdigest(), 'bytes': True},
                    {'sha256': hashlib.sha256(b'12345678').hexdigest(), 'bytes': 7}]:
        with pytest.raises(HTTPException): knowledge.checked_candidate_bytes(b'12345678', invalid)
    assert knowledge.checked_candidate_bytes(b'12345678', {'sha256': hashlib.sha256(b'12345678').hexdigest(), 'bytes': 8}) == b'12345678'


@pytest.mark.parametrize('release', [False, True])
@pytest.mark.parametrize('change,status', [('suspend', 403), ('demote', 403), ('permission', 403), ('scope', 404)])
def test_embedding_await_cannot_return_old_card_or_release_chunks(boundary, release, change, status):
    async def changed(): revoke(boundary, change)
    boundary.embed_hook = changed
    body = {'question': 'garden evidence', 'project_id': PROJECT, **({'release_id': str(RELEASE)} if release else {})}
    response = boundary.client.post('/v1/admin/knowledge/preview', headers=HEADERS, json=body)
    assert response.status_code == status and 'PRIVATE BEFORE' not in response.text
    assert response.headers['cache-control'] == 'no-store'
    assert boundary.embeds == [['garden evidence']]


@pytest.mark.parametrize('release', [False, True])
def test_final_preview_uses_current_authorized_projection_and_exact_selected_version(boundary, release):
    async def changed(): boundary.source = source('AUTHORIZED AFTER')
    boundary.embed_hook = changed
    response = boundary.client.post('/v1/admin/knowledge/preview', headers=HEADERS,
        json={'question': 'garden evidence', 'project_id': PROJECT, **({'release_id': str(RELEASE)} if release else {})})
    assert response.status_code == 200 and 'PRIVATE BEFORE' not in response.text
    value = response.json()['data']
    assert value['answer'] == 'AUTHORIZED AFTER' and value['fact_card']['name']['th'] == 'AUTHORIZED AFTER'
    assert value['release_id'] == (str(RELEASE) if release else None)
    assert value['mode'] == ('PRIVATE_PREVIEW' if release else 'DRAFT_PREVIEW')
    assert value['citations'][0]['candidate_id'] == str(CANDIDATE)


@pytest.mark.parametrize('release', [False, True])
@pytest.mark.parametrize('change', ['scope', 'suspend', 'fresh'])
def test_gap_write_await_rechecks_source_before_any_card_or_retrieved_metadata_returns(boundary, release, change):
    boundary.source['chunks'] = []
    async def changed():
        if change == 'fresh': boundary.source = source('AUTHORIZED AFTER GAP')
        else: revoke(boundary, change)
    boundary.gap_hook = changed
    response = boundary.client.post('/v1/admin/knowledge/preview', headers=HEADERS,
        json={'question': 'garden evidence', 'project_id': PROJECT, **({'release_id': str(RELEASE)} if release else {})})
    assert response.status_code == {'scope': 404, 'suspend': 403, 'fresh': 200}[change]
    assert 'PRIVATE BEFORE' not in response.text
    assert boundary.gaps == [(PROJECT, hashlib.sha256(b'garden evidence').hexdigest())]
    if change == 'fresh': assert response.json()['data']['answer'] == 'AUTHORIZED AFTER GAP'


def test_project_list_and_pack_are_current_complete_projections_without_old_hidden_rows(boundary):
    async def changed(): boundary.projects = [project_row(NEIGHBOUR, 'Permitted neighbour')]
    boundary.projection_hook = changed
    response = boundary.client.get('/v1/admin/knowledge/projects', headers=HEADERS)
    assert response.status_code == 200 and 'PRIVATE BEFORE' not in response.text
    rows = response.json()['data']
    assert [row['project_id'] for row in rows] == [NEIGHBOUR, 'KNOWLEDGE_TERMS']
    assert rows[0]['candidates'] == 0 and rows[0]['progress']['state'] == 'not_started'
    assert len(boundary.calls) == 1
    boundary.calls.clear()
    response = boundary.client.get('/v1/admin/knowledge/projects/' + NEIGHBOUR, headers=HEADERS)
    assert response.status_code == 200 and 'PRIVATE PATH' not in response.text and 'validated_metadata' not in response.text
    assert response.json()['data']['items'][0]['read_only'] is True
    assert response.json()['data']['items'][0]['cluster_ids'] == ['exact-cluster']
    assert len(boundary.calls) == 1


@pytest.mark.parametrize('csv', [False, True])
def test_dashboard_and_csv_use_one_current_source_and_media_projection(boundary, csv):
    from test_brand_completeness import row
    async def changed():
        visible = {**row(), 'name_th': 'Permitted neighbour', 'rem_brand_id': '0088', 'public_brand_id': 'brd_neighbour'}
        boundary.dashboard = {'rows': [visible], 'counts': {'total': 1}, '_media': {'0088': {'id': 'safe-asset', 'public_url': '/safe-file'}}}
    boundary.projection_hook = changed
    response = boundary.client.get('/v1/admin/brands/completeness' + ('.csv' if csv else ''), headers=HEADERS)
    assert response.status_code == 200 and 'Permitted neighbour' in response.text
    assert response.headers['cache-control'] == 'no-store'
    assert len(boundary.calls) == 1
    if csv: assert 'PRIVATE' not in response.text and '/safe-file' not in response.text
    else:
        value = response.json()['data']
        assert value['counts']['total'] == 1 and '_media' not in value
        assert value['rows'][0]['thumbnail'] == {'id': 'safe-asset', 'public_url': '/safe-file'}


@pytest.mark.integration
def test_final_projections_enforce_fake_clock_bu_expiry_without_maintenance_and_keep_explicit_and_unrestricted_neighbours(permission_accounts):
    from sena_hub_api.brand_completeness import DASHBOARD_SQL
    from test_content_scopes import NOW, clock, membership, scope_database, selected
    from test_content_workflow import inventory_brand_fixture
    from test_permission_content import call
    from test_website_content import project_fixture
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            await clock(db)
            projects = [await project_fixture(db, ids['editor']) for _ in range(2)]
            brands = [await inventory_brand_fixture(db, ids['editor']) for _ in range(2)]
            # Hub ownership governs registered brands. A conflicting source-only
            # assignment must not relabel an inaccessible existing brand as new.
            await db.execute('''update staging.rem_projects set rem_brand_id=(select rem_brand_id from hub.brands where id=$1)
                where rem_project_id=$2''', brands[0]['id'], projects[1]['rem_project_id'])
            batch = uuid4().hex * 2
            await db.execute('insert into staging.knowledge_batches(manifest_sha256,manifest) values($1,$2)', batch, {'synthetic': True})
            candidates = []
            for index, (project, brand) in enumerate(zip(projects, brands)):
                await db.execute('update hub.projects set brand_id=$1 where id=$2', brand['id'], project['id'])
                card = source('Scope boundary ' + str(index))['fact_card']
                await db.execute('insert into rag.project_fact_cards(rem_project_id,batch_sha256,payload) values($1,$2,$3)', project['rem_project_id'], batch, card)
                candidate = uuid4(); candidates.append(candidate)
                await db.execute("""insert into staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,topic,source_ref,evidence)
                    values($1,$2,$3,'faq',$4,'synthetic','synthetic:boundary',$5)""", candidate, batch, str(candidate), [project['rem_project_id']],
                    {'short_answer': {'th': 'Scope boundary ' + str(index)}, 'question': {'th': 'Synthetic garden question'}})
                await db.execute("""insert into rag.knowledge_preview_chunks(candidate_id,project_ids,locale,chunk_text,keywords,content_sha256,embedding_model,embedding)
                    values($1,$2,'th','Synthetic garden evidence',array['garden'],repeat('8',64),'deterministic-fixture',$3)""",
                    candidate, [project['rem_project_id']], [1.0] + [0.0] * 1535)
            await membership(db, [(projects[0]['rem_project_id'], ' BU A '), (projects[1]['rem_project_id'], 'BU-B')], watermark=NOW-timedelta(days=6, hours=23))
            for tab in ('knowledge', 'brands'):
                await selected(db, ids['admin'], tab, 'view', projects=[projects[1]['rem_project_id']], bus=[' BU A '])

            async def read(actor, sql, *args):
                try:return await call(db, actor, sql, *args)
                finally:await db.execute('RESET ROLE')

            async def rows(actor, sql, *args):
                return await read(actor, 'select coalesce(jsonb_agg(to_jsonb(r)),\'[]\') from (' + sql + ') r', *args)

            before = await rows(ids['admin'], knowledge.PROJECTS_SQL)
            assert {p['rem_project_id'] for p in projects} <= {row['project_id'] for row in before}
            pack = await read(ids['admin'], knowledge.PACK_SQL, projects[0]['rem_project_id'], [*knowledge.PROGRAMMES, 'KNOWLEDGE_TERMS'])
            assert pack['card']['name']['th'] == 'Scope boundary 0' and str(candidates[0]) in pack['faq_controls']
            current = await read(ids['admin'], knowledge.PREVIEW_SOURCE_SQL, projects[0]['rem_project_id'])
            assert current['chunks'][0]['candidate_id'] == str(candidates[0])
            dashboard = await read(ids['admin'], DASHBOARD_SQL)
            assert {b['public_brand_id'] for b in brands} <= {row['public_brand_id'] for row in dashboard['rows']}
            epoch = await db.fetchval('select authorization_epoch from hub.content_scope_state')

            # No settlement/import/maintenance call: only the private fixture clock advances.
            await clock(db, NOW+timedelta(hours=1))
            after = await rows(ids['admin'], knowledge.PROJECTS_SQL)
            assert projects[0]['rem_project_id'] not in {row['project_id'] for row in after}
            assert projects[1]['rem_project_id'] in {row['project_id'] for row in after}
            assert await read(ids['admin'], knowledge.PACK_SQL, projects[0]['rem_project_id'], [*knowledge.PROGRAMMES, 'KNOWLEDGE_TERMS']) is None
            assert await read(ids['admin'], knowledge.PREVIEW_SOURCE_SQL, projects[0]['rem_project_id']) is None
            remaining = await read(ids['admin'], knowledge.PREVIEW_SOURCE_SQL, projects[1]['rem_project_id'])
            assert remaining['fact_card']['name']['th'] == 'Scope boundary 1'
            assert remaining['chunks'][0]['candidate_id'] == str(candidates[1])
            choices = await rows(ids['admin'], knowledge.PREVIEW_CARDS_SQL, 'garden')
            assert projects[0]['rem_project_id'] not in {row['rem_project_id'] for row in choices}
            dashboard = await read(ids['admin'], DASHBOARD_SQL)
            assert brands[0]['public_brand_id'] not in {row['public_brand_id'] for row in dashboard['rows']}
            assert brands[1]['public_brand_id'] in {row['public_brand_id'] for row in dashboard['rows']}
            unrestricted = await rows(ids['second'], knowledge.PROJECTS_SQL)
            assert {p['rem_project_id'] for p in projects} <= {row['project_id'] for row in unrestricted}
            assert await db.fetchval('select authorization_epoch from hub.content_scope_state') == epoch
    asyncio.run(check())
