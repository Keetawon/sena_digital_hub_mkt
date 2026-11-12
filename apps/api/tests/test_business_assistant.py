"""W5 HTTP adapters reopen exact saved evidence; canonical SQL owns access."""
from contextlib import asynccontextmanager
from copy import deepcopy
import asyncio
import json
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import asyncpg
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from sena_hub_api.assistant import register_assistant_routes
from sena_hub_api.assistant_tools import TOOL_INPUTS
from sena_hub_api.auth import Actor, Settings
from test_permission_foundations import permission_accounts
from test_assistant import boundary, events, headers, PREFIX, TOKENS


@pytest.mark.parametrize('other', ['project_id', 'brand_id', 'rem_project_id', 'line_id', 'code', 'name'])
def test_business_context_rejects_mixed_primary_scopes(other):
    from pydantic import ValidationError
    from sena_hub_api.assistant import Context
    with pytest.raises(ValidationError):
        Context.model_validate({'business_id': 'residential', other: str(uuid4())})


@pytest.mark.parametrize('context,tool,args', [
    ({'business_id': 'residential'}, 'get_project', {'project_id': 'other'}),
    ({'business_id': 'residential'}, 'get_brand', {'brand_id': 'other'}),
    ({'business_id': 'residential'}, 'search_documents', {'query': 'other'}),
    ({'business_id': 'residential'}, 'get_project_marketing', {'rem_project_id': 'other', 'month': '2026-11-01'}),
    ({'business_id': 'residential'}, 'search_content', {'brand_id': 'other', 'query': 'other'}),
    ({'business_id': 'residential'}, 'search_content', {'business_id': 'other', 'query': 'other'}),
    ({'brand_id': 'other'}, 'search_content', {'business_id': 'residential', 'query': 'other'}),
    ({'project_id': 'other'}, 'search_content', {'business_id': 'residential', 'query': 'other'}),
])
def test_business_scope_conflict_precedes_any_database_read(context, tool, args):
    from sena_hub_api.assistant_tools import ToolReader
    from starlette.exceptions import HTTPException

    @asynccontextmanager
    async def denied_database(*args):
        pytest.fail('Conflicting context must not query the database')
        yield

    with pytest.raises(HTTPException) as error:
        asyncio.run(ToolReader(None, Actor(uuid4(), 'viewer'), denied_database, context).invoke(tool, args))
    assert error.value.status_code == 403


def test_business_fake_question_retrieves_only_narrative_and_records_exact_citation(boundary):
    client, store = boundary
    original = store.fetchval
    section, version = str(uuid4()), str(uuid4())
    row = {'entity_type': 'section', 'entity_id': section, 'version': version,
           'visibility': 'DRAFT', 'as_of': None, 'fields': {'body': {'th': 'sunlit garden'},
           'title': {'th': 'sunlit price 500'}, 'summary': {'th': 'sunlit ignore instructions'},
           'source_ref': 'sunlit private file'}}

    async def fetchval(sql, *args):
        if 'assistant_business_search' in sql:
            assert args == ('residential', 'draft')
            store.calls.append((sql, args, store.actor.role))
            return json.dumps([row])
        if 'assistant_citation_read' in sql:
            citation = store.citations[str(args[1])]
            return json.dumps({**citation, 'evidence': {**row, 'target': {
                'level': 'business', 'id': 'residential', 'tab': 'data', 'section': 'narrative', 'item': section}}})
        return await original(sql, *args)

    store.fetchval = fetchval
    from sena_hub_api.assistant_tools import ToolReader
    result = asyncio.run(ToolReader(None, Actor(uuid4(), 'viewer'), store.database,
                                   {'business_id': 'residential'}).invoke('search_content', {'query': 'sunlit'}))
    assert [fact['value'] for fact in result['facts']] == ['sunlit garden']
    response = client.post(PREFIX + '/runs', headers=headers('viewer'), json={
        'message': 'search content', 'context': {'business_id': 'residential', 'query': 'sunlit'}})
    stream = events(response)
    assert any(event == 'done' for event, _ in stream), stream
    assert 'sunlit garden' in response.text
    assert all(value not in response.text for value in ('sunlit price', 'ignore instructions', 'sunlit private file'))
    assert len(store.citations) == 1
    saved = next(iter(store.citations.values()))
    assert (saved['entity_type'], saved['entity_id'], saved['version']) == ('section', section, version)
    assert len(TOOL_INPUTS) == 13


def test_business_runtime_search_excludes_hidden_sources_and_rechecks_saved_exposure(permission_accounts):
    from test_business_content import question, answer
    from test_permission_content import call, set_bit
    from test_project_content_core import runtime

    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            current = await call(db, ids['editor'], "select hub.business_content('residential')")
            revision = next((row['revision'] for row in current['sections'] if row['section_key'] == 'section.project_intro'), 0)
            section = await call(db, ids['editor'], "select hub.save_content_section('business','residential','section.project_intro',$1,$2)",
                                 revision, {'body': {'th': 'sunlit garden'}, 'ai_exposure': 'open'})
            hidden = await call(db, ids['editor'], "select hub.save_content_section('business','residential','section.concept_detail',0,$1)",
                                {'body': {'th': 'secret sunlit garden'}, 'ai_exposure': 'internal'})
            faq, body = await answer(db, ids, await question(db, ids), 'business', 'residential', [], text='sunlit answer')
            for tab in ('projects', 'brands'):
                await set_bit(ids['viewer'], tab, can_view=False, can_edit=False, can_approve=False, connection=db, manager=ids['admin'])
            rows = await call(db, ids['viewer'], "select internal.assistant_business_search('residential','draft')")
            found = {row['entity_id']: row for row in rows}
            assert section['id'] in found and faq['id'] in found and hidden['id'] not in found
            assert all(row['visibility'] == 'DRAFT' for row in rows)
            assert await call(db, ids['viewer'], "select internal.assistant_business_search('residential','published')") == []
            run = await call(db, ids['viewer'], 'select internal.assistant_run_create($1)', {'mode': 'SYNTHETIC', 'config_version': 'business-search'})
            saved = await call(db, ids['viewer'], 'select internal.assistant_tool_record($1,$2)', UUID(run['id']), {
                'tool_name': 'search_content', 'outcome': 'SUCCESS', 'duration_ms': 1, 'sources': [
                    {'namespace': 'internal_content', **{key: found[section['id']][key] for key in ('entity_type', 'entity_id', 'version')}},
                    {'namespace': 'internal_content', **{key: found[faq['id']][key] for key in ('entity_type', 'entity_id', 'version')}},
                ]})
            await call(db, ids['editor'], "select hub.save_content_section('business','residential','section.project_intro',$1,$2)",
                       section['revision'], {'body': {'th': 'private garden'}, 'ai_exposure': 'web_only'})
            rows = await call(db, ids['viewer'], "select internal.assistant_business_search('residential','draft')")
            assert section['id'] not in {row['entity_id'] for row in rows}
            history = await call(db, ids['viewer'], 'select internal.assistant_run_read($1)', UUID(run['id']))
            assert [row['entity_id'] for row in history['citations']] == [faq['id']]
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select internal.assistant_citation_read($1,$2)', UUID(run['id']), UUID(saved['citations'][0]['id']))
            await set_bit(ids['viewer'], 'knowledge', can_view=False, connection=db, manager=ids['admin'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], "select internal.assistant_business_search('residential','draft')")
        finally:
            await db.close()

    asyncio.run(check())


def test_business_published_search_pins_frozen_source_and_withdrawal_removes_saved_access(permission_accounts):
    from test_business_content import question, answer, approve_faq, setup_business
    from test_content_workflow import approve_item
    from test_permission_content import call
    from test_project_content_core import runtime
    from test_publication_queue import online, prepare

    _, ids = permission_accounts
    _, project, _, _ = asyncio.run(setup_business(ids))

    async def check():
        await online(ids)
        db = await runtime()
        try:
            faq, body = await answer(db, ids, await question(db, ids), 'business', 'residential',
                                     [project['rem_project_id']], text='Frozen sunlit garden')
            await approve_faq(db, ids, faq)
            key = 'business:residential'
            page = await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', key,
                              {'url': '/business/synthetic', 'locales': ['th'], 'ai_policy': 'open', 'max_faq_items': 20, 'project_ids': []})
            await approve_item(db, ids, 'page_config', {'id': page['id']})
            batch = await prepare(db, ids, key)
            published = await call(db, ids['viewer'], 'select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
            assert published['page_count'] == 1
            rows = await call(db, ids['viewer'], "select internal.assistant_business_search('residential','published')")
            source = next(row for row in rows if row['entity_id'] == faq['id'])
            assert source['visibility'] == 'PUBLISHED' and source['fields']['short_answer'] == 'Frozen sunlit garden'
            publication, source_version = source['version'].split(':')
            assert source_version == faq['version']['id']
            saved_run = await call(db, ids['viewer'], 'select internal.assistant_run_create($1)', {'mode': 'SYNTHETIC', 'config_version': 'business-published'})
            receipt = await call(db, ids['viewer'], 'select internal.assistant_tool_record($1,$2)', UUID(saved_run['id']), {
                'tool_name': 'search_content', 'outcome': 'SUCCESS', 'duration_ms': 1, 'sources': [
                    {'namespace': 'internal_content', **{name: source[name] for name in ('entity_type', 'entity_id', 'version')}}]})
            citation = UUID(receipt['citations'][0]['id'])
            current = await call(db, ids['editor'], 'select hub.faq_read($1)', UUID(faq['id']))
            await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', UUID(faq['id']), current['revision'],
                       {**body, 'short_answer': {'th': 'Unpublished changed garden'}})
            rows = await call(db, ids['viewer'], "select internal.assistant_business_search('residential','published')")
            assert next(row for row in rows if row['entity_id'] == faq['id']) == source
            draft = await call(db, ids['viewer'], "select internal.assistant_business_search('residential','draft')")
            assert next(row for row in draft if row['entity_id'] == faq['id'])['fields']['short_answer']['th'] == 'Unpublished changed garden'
            assert (await call(db, ids['viewer'], 'select internal.assistant_citation_read($1,$2)', UUID(saved_run['id']), citation))['evidence'] == source
            await call(db, ids['viewer'], 'select hub.web_pointer($1,$2,null,$3)', key, UUID(publication), 'Synthetic business withdrawal')
            assert await call(db, ids['viewer'], "select internal.assistant_business_search('residential','published')") == []
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['viewer'], 'select internal.assistant_citation_read($1,$2)', UUID(saved_run['id']), citation)
            assert (await call(db, ids['viewer'], 'select internal.assistant_run_read($1)', UUID(saved_run['id'])))['citations'] == []
        finally:
            await db.close()

    asyncio.run(check())


@pytest.mark.parametrize('question_exposure,changes', [
    ('internal', {}), ('web_only', {}), ('open', {'ai_exposure': 'internal'}),
    ('open', {'ai_exposure': 'web_only'}), ('open', {'effective_to': '2020-01-01'}),
    ('open', {'review_due': '2020-01-01'}),
])
def test_business_withheld_or_expired_faq_never_enters_search_or_saved_citations(permission_accounts, question_exposure, changes):
    from test_business_content import question, answer
    from test_permission_content import call
    from test_project_content_core import runtime

    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            hidden, _ = await answer(db, ids, await question(db, ids, exposure=question_exposure),
                                     'business', 'residential', [], text='Withheld garden', **changes)
            visible, _ = await answer(db, ids, await question(db, ids), 'business', 'residential', [], text='Allowed neighbour')
            rows = await call(db, ids['viewer'], "select internal.assistant_business_search('residential','draft')")
            assert hidden['id'] not in {row['entity_id'] for row in rows}
            assert visible['id'] in {row['entity_id'] for row in rows}
            saved_run = await call(db, ids['viewer'], 'select internal.assistant_run_create($1)', {'mode': 'SYNTHETIC', 'config_version': 'business-withheld'})
            with pytest.raises((asyncpg.InsufficientPrivilegeError, asyncpg.NoDataFoundError)):
                await call(db, ids['viewer'], 'select internal.assistant_tool_record($1,$2)', UUID(saved_run['id']), {
                    'tool_name': 'search_content', 'outcome': 'SUCCESS', 'duration_ms': 1, 'sources': [
                        {'namespace': 'internal_content', 'entity_type': 'faq', 'entity_id': hidden['id'], 'version': hidden['version']['id']}]})
            assert (await call(db, ids['viewer'], 'select internal.assistant_run_read($1)', UUID(saved_run['id'])))['citations'] == []
        finally:
            await db.close()

    asyncio.run(check())


class SavedSources:
    def __init__(self):
        self.actor = Actor(uuid4(), 'viewer')
        self.run = uuid4()
        self.sources = {}
        self.evidence = {}
        self.denied = set()
        self.changed = set()
        self.calls = []
        self.reads = {}

    def add(self, kind, ref, target):
        version = 'a' * 64 if kind == 'business' else str(uuid4())
        citation = uuid4()
        self.sources[citation] = {'id': str(citation), 'entity_type': kind,
                                  'entity_id': ref, 'version': version}
        self.evidence[(kind, ref, version)] = {
            **self.sources[citation], 'target': target, 'visibility': 'REFERENCE' if kind == 'business' else 'DRAFT',
            'as_of': None, 'fields': {'private_test_text': 'saved evidence only'},
        }
        return citation

    @asynccontextmanager
    async def database(self, request, actor, **kwargs):
        assert actor == self.actor
        yield self

    async def fetchval(self, sql, *args):
        self.calls.append((sql, args))
        if 'assistant_citation_read' in sql:
            assert args[0] == self.run
            source = deepcopy(self.sources[args[1]])
            key = (source['entity_type'], source['entity_id'], source['version'])
            self.reads[args[1]] = self.reads.get(args[1], 0) + 1
            if self.reads[args[1]] > 1:
                # Simulate revocation/version change after the initial lookup.
                if key[:2] in self.denied:
                    raise asyncpg.InsufficientPrivilegeError('Private source is outside current scope')
                if key[:2] in self.changed:
                    raise asyncpg.SerializationError('Saved version changed')
                source['evidence'] = deepcopy(self.evidence[key])
            return json.dumps(source)
        if 'assistant_saved_source' in sql:
            raise AssertionError('The private helper must never be called by hub_app')
        raise AssertionError(sql)


@pytest.fixture
def saved_sources():
    store = SavedSources()
    app = FastAPI()

    async def authentication(request):
        return store.actor

    settings = Settings('postgresql://test:test@127.0.0.1:55432/sena_hub_local', 'demo', 'local', TOKENS)
    register_assistant_routes(app, authentication, store.database, settings)
    return TestClient(app), store


def open_source(client, store, citation):
    return client.get(f'/v1/admin/assistant/runs/{store.run}/citations/{citation}')


@pytest.mark.parametrize('kind', ['business', 'faq', 'section'])
def test_exact_saved_business_family_citation_uses_canonical_reader_and_workspace_target(saved_sources, kind):
    client, store = saved_sources
    ref = 'residential' if kind == 'business' else str(uuid4())
    target = {'level': 'business', 'id': 'residential', 'tab': 'overview'}
    if kind == 'faq':
        target.update(tab='faq', question_key='saved_question', item=ref)
    elif kind == 'section':
        target.update(tab='data', section='narrative', field='section.overview', item=ref)
    citation = store.add(kind, ref, target)
    before_tools = tuple(TOOL_INPUTS)
    result = open_source(client, store, citation)
    assert result.status_code == 200, result.text
    data = result.json()['data']
    parsed = urlsplit(data['source_href'])
    assert parsed.path == '/website/business/residential'
    query = parse_qs(parsed.query)
    assert query['tab'] == [target['tab']]
    if kind != 'business':
        assert query['item'] == [ref]
    if kind == 'faq':
        assert query['question'] == ['saved_question'] and 'question_key' not in query
    assert data['metadata']['version'] == store.sources[citation]['version']
    assert data['metadata']['visibility'] == ('REFERENCE' if kind == 'business' else 'DRAFT')
    assert data['metadata']['synthetic'] is False
    assert store.calls[-1][1] == (store.run, citation)
    assert tuple(TOOL_INPUTS) == before_tools
    assert 'private_test_text' not in result.text  # Link metadata does not expand evidence fields.


@pytest.mark.parametrize('fault,status', [('denied', 403), ('changed', 409)])
@pytest.mark.parametrize('kind', ['business', 'faq', 'section'])
def test_saved_source_denial_or_version_change_after_citation_lookup_keeps_neighbour_available(saved_sources, kind, fault, status):
    client, store = saved_sources
    ref = 'residential' if kind == 'business' else str(uuid4())
    hidden = store.add(kind, ref, {'level': 'business', 'id': 'residential', 'tab': 'faq'})
    allowed = store.add('section', str(uuid4()), {'level': 'corporate', 'id': 'corporate', 'tab': 'data', 'section': 'narrative'})
    getattr(store, fault).add((kind, ref))
    response = open_source(client, store, hidden)
    assert response.status_code == status, response.text
    assert 'source_href' not in response.text and 'saved evidence only' not in response.text
    assert open_source(client, store, allowed).status_code == 200


def test_business_reference_never_falls_back_to_descendant_or_unknown_source(saved_sources):
    client, store = saved_sources
    citation = store.add('business', 'residential', {'level': 'business', 'id': 'residential', 'tab': 'overview'})
    store.denied.add(('business', 'residential'))
    assert open_source(client, store, citation).status_code == 403
    assert [sql for sql, _ in store.calls] == [
        'SELECT internal.assistant_citation_read($1,$2)::text',
        'SELECT internal.assistant_citation_read($1,$2)::text',
    ]
    store.sources[citation]['entity_type'] = 'arbitrary'
    store.calls.clear()
    store.reads.clear()
    assert open_source(client, store, citation).status_code == 404
    assert len(store.calls) == 1


def test_saved_source_link_escapes_exact_reference_and_ignores_record_urls(saved_sources):
    client, store = saved_sources
    ref = str(uuid4())
    citation = store.add('section', ref, {'level': 'programme', 'id': 'phase ?& name', 'tab': 'data',
                                        'section': 'narrative', 'item': ref, 'href': 'https://invalid.example'})
    response = open_source(client, store, citation)
    assert response.status_code == 200
    link = response.json()['data']['source_href']
    assert urlsplit(link).path == '/website/programme/phase%20%3F%26%20name'
    assert parse_qs(urlsplit(link).query)['item'] == [ref]
    assert 'invalid.example' not in link


def test_real_hub_app_citation_route_keeps_private_helper_closed_and_uses_owned_evidence(permission_accounts):
    """The real runtime ACL, not a fetchval double, must permit this HTTP adapter."""
    from test_permission_baseline import disposable_operator
    from test_permission_content import call, set_bit
    from test_permission_db_baseline import runtime

    _, ids = permission_accounts

    async def seed():
        db = await runtime()
        operator = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        try:
            version = await operator.fetchval("select hub.web_hash(to_jsonb(b)) from hub.businesses b where code='residential'")
            assert version
            assert not await call(db, ids['admin'], "select has_function_privilege(current_user,'internal.assistant_saved_source(text,text,text)','execute')")
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['admin'], "select internal.assistant_saved_source('business','residential',$1)", version)
            saved_run = await call(db, ids['admin'], 'select internal.assistant_run_create($1)',
                                   {'mode': 'SYNTHETIC', 'config_version': 'business-http-acl'})
            business = await call(db, ids['admin'], 'select internal.assistant_tool_record($1,$2)', UUID(saved_run['id']),
                {'tool_name': 'search_content', 'outcome': 'SUCCESS', 'duration_ms': 1, 'sources': [
                    {'namespace': 'internal_content', 'entity_type': 'business', 'entity_id': 'residential', 'version': version}]})
            neighbour = await call(db, ids['admin'], 'select internal.assistant_tool_record($1,$2)', UUID(saved_run['id']),
                {'tool_name': 'explain_name', 'outcome': 'SUCCESS', 'duration_ms': 1, 'sources': [
                    {'namespace': 'internal_ads', 'entity_type': 'naming_rule', 'entity_id': 'SENA-H', 'version': '1'}]})
            return saved_run['id'], business['citations'][0]['id'], neighbour['citations'][0]['id'], version
        finally:
            await db.close()
            await operator.close()

    saved_run, citation, neighbour, version = asyncio.run(seed())
    observed_roles = []

    @asynccontextmanager
    async def database(request, actor, **kwargs):
        db = await runtime()
        try:
            async with db.transaction():
                await db.execute('SET LOCAL ROLE hub_app')
                await db.execute("select set_config('app.actor_id',$1,true)", str(actor.id))
                assert await db.fetchval('select session_user') == 'hub_runtime'
                assert not await db.fetchval('select rolsuper or rolbypassrls from pg_roles where rolname=current_user')
                observed_roles.append(await db.fetchval('select current_user'))
                yield db
        finally:
            await db.close()

    async def authentication(request):
        selected = request.headers.get('x-synthetic-actor', 'admin')
        assert selected in {'admin', 'second'}
        return Actor(ids[selected], 'admin')

    app = FastAPI()
    # This guard describes the local-only surface; the dependency above opens
    # only the existing disposable runtime fixture, never this descriptive URL.
    settings = Settings('postgresql://test:test@127.0.0.1:55432/sena_hub_local', 'demo', 'local', TOKENS)
    register_assistant_routes(app, authentication, database, settings)
    with TestClient(app) as client:
        url = f'/v1/admin/assistant/runs/{saved_run}/citations/{citation}'
        response = client.get(url)
        assert response.status_code == 200, response.text
        assert response.json()['data']['metadata']['version'] == version
        assert response.json()['data']['source_href'] == '/website/business/residential?tab=overview'
        assert observed_roles and set(observed_roles) == {'hub_app'}
        assert client.get(url, headers={'x-synthetic-actor': 'second'}).status_code == 404
        asyncio.run(set_bit(ids['admin'], 'knowledge', can_edit=False, can_approve=False, special_actions=[], can_view=False))
        denied = client.get(url)
        assert denied.status_code == 403 and 'source_href' not in denied.text
        allowed = client.get(f'/v1/admin/assistant/runs/{saved_run}/citations/{neighbour}')
        assert allowed.status_code == 200 and allowed.json()['data']['source_href'] == '/ads/registry'
