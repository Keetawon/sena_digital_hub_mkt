"""Writing proposals: no network, no content save, real hub_app denial checks."""
import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from decimal import Decimal
from uuid import uuid4

import asyncpg
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from sena_hub_api import writing_aid as writing
from sena_hub_api.auth import Actor
from sena_hub_api.provider_messages import MESSAGES
from test_permission_content import call
from test_permission_foundations import permission_accounts
from test_website_content import operator, project_fixture


class FakeDatabase:
    def __init__(self):
        self.calls = []
        self.active = False
        self.admission = {
            'status': 'ready', 'input_text': 'Green  20.5 homes {project} 20.5',
            'before': 'Green  20.5 homes {project} 20.5', 'max_length': 200,
            'source': {'translation_id': str(uuid4()), 'revision': 3},
        }
        self.finish = None

    async def fetchval(self, sql, *args):
        assert self.active
        self.calls.append((sql, args))
        if 'writing_aid_begin' in sql:
            return deepcopy(self.admission)
        if 'writing_aid_finish' in sql:
            if self.finish:
                return deepcopy(self.finish)
            error = args[1]
            return {'status': 'budget_exhausted' if error == 'budget_exhausted' else 'failed' if error else 'done',
                    'error_code': error, 'id': str(args[0]), 'model': 'stub-writing-v1',
                    'synthetic': True, 'input_tokens': 0, 'output_tokens': 0,
                    'completed_at': '2026-11-04T00:00:00Z', 'elapsed_ms': args[2]}
        assert 'writing_aid_state' in sql
        return {'eligible': True, 'budget': {'status': 'available'}, 'requests': []}


def unit_client(db, *, role='editor', status='ACTIVE', view=True, edit=True):
    app = FastAPI()

    async def identity(request: Request):
        request.state.account = {'status': status, 'hub_role': role,
                                 'capabilities': {'tabs': {'projects': {'view': view, 'edit': edit}}}}
        return Actor(uuid4(), role, 'KIN' if role == 'agency' else None)

    @asynccontextmanager
    async def database(request, actor):
        db.active = True
        try:
            yield db
        finally:
            db.active = False

    writing.register_writing_aid_routes(app, identity, database)
    return TestClient(app)


def body(**changes):
    return {'request_id': str(uuid4()), 'expected_revision': 3,
            'language': 'th', 'mode': 'proofread', **changes}


@pytest.mark.parametrize('language', ['th', 'en'])
@pytest.mark.parametrize('mode', ['draft', 'proofread', 'shorten'])
def test_stub_proposal_protects_exact_tokens_without_network_or_glossary(monkeypatch, language, mode):
    db = FakeDatabase()
    client = unit_client(db)

    def forbidden(*args, **kwargs):
        raise AssertionError('No network client or credential lookup is allowed')

    monkeypatch.setattr('socket.create_connection', forbidden)
    monkeypatch.setattr('openai.AsyncOpenAI', forbidden)
    import os
    getenv = os.getenv

    def no_credentials(key, *args):
        if key.startswith(('OPENAI_', 'HUB_TRANSLATION_', 'HUB_MEDIA_', 'HUB_WRITING_')):
            return forbidden()
        return getenv(key, *args)

    monkeypatch.setattr('os.getenv', no_credentials)
    original = writing.StubWritingProvider.generate

    async def inspect(self, text, selected_language, selected_mode):
        assert not db.active, 'Generation must run after admission commits'
        assert '20.5' not in text and '{project}' not in text
        assert selected_language == language and selected_mode == mode
        return await original(self, text, selected_language, selected_mode)

    monkeypatch.setattr(writing.StubWritingProvider, 'generate', inspect)
    response = client.post(f'/v1/admin/content/writing-aid/{uuid4()}/proposals',
                           json=body(language=language, mode=mode))
    assert response.status_code == 200
    data = response.json()['data']
    assert data['proposal']['before'] == db.admission['before']
    assert data['proposal']['after'] == 'Green 20.5 homes {project} 20.5'
    assert data['proposal']['acceptance'] == 'ordinary_draft_save'
    assert data['synthetic'] and data['input_tokens'] == data['output_tokens'] == 0
    assert data['model'] == writing.StubWritingProvider.model and data['completed_at']
    assert len(db.calls) == 2
    assert all('save' not in sql and 'publish' not in sql and 'approve' not in sql for sql, _ in db.calls)


@pytest.mark.parametrize('fault,expected', [
    ('number', 'invalid_output'), ('missing_marker', 'invalid_output'),
    ('duplicate_marker', 'invalid_output'), ('html', 'invalid_output'),
    ('length', 'invalid_output'), ('ambiguous', 'provider_error'), ('quota', 'budget_exhausted'),
])
def test_failure_is_bounded_and_never_retries(monkeypatch, caplog, fault, expected):
    db = FakeDatabase()
    attempts = []

    async def fail(self, text, language, mode):
        attempts.append(text)
        marker = next(iter(writing.re.findall(r'\[KEEP_[^\]]+\]', text)))
        if fault == 'number':
            return text + ' 99'
        if fault == 'missing_marker':
            return text.replace(marker, '')
        if fault == 'duplicate_marker':
            return text + marker
        if fault == 'html':
            return '<script>' + text
        if fault == 'length':
            return text + 'x' * 201
        error = RuntimeError('Private source and provider response must not escape')
        if fault == 'quota':
            error.status_code = 429
            error.code = 'insufficient_quota'
        raise error

    monkeypatch.setattr(writing.StubWritingProvider, 'generate', fail)
    response = unit_client(db).post(f'/v1/admin/content/writing-aid/{uuid4()}/proposals', json=body())
    data = response.json()['data']
    assert data['error_code'] == expected and 'proposal' not in data
    assert len(attempts) == 1 and len(db.calls) == 2
    assert 'Private source' not in response.text and not caplog.records
    if fault == 'quota':
        assert data['message'] == MESSAGES['state_budget']


@pytest.mark.parametrize('status', ['running', 'ambiguous', 'done', 'failed', 'budget_exhausted'])
def test_replayed_admission_does_not_generate(monkeypatch, status):
    db = FakeDatabase()
    db.admission = {'status': status, 'replayed': True}

    async def forbidden(*args):
        pytest.fail('A request ID may be attempted only once')

    monkeypatch.setattr(writing.StubWritingProvider, 'generate', forbidden)
    response = unit_client(db).post(f'/v1/admin/content/writing-aid/{uuid4()}/proposals', json=body())
    assert response.json()['data']['status'] == status
    assert len(db.calls) == 1 and 'proposal' not in response.json()['data']


@pytest.mark.parametrize('error', ['permission_revoked', 'source_changed'])
def test_revoked_or_changed_source_does_not_return_generated_text(error):
    db = FakeDatabase()
    db.finish = {'status': 'failed', 'error_code': error}
    response = unit_client(db).post(f'/v1/admin/content/writing-aid/{uuid4()}/proposals', json=body())
    assert response.json()['data'] == db.finish


@pytest.mark.parametrize('options', [
    {'role': 'agency'}, {'role': 'service_consumer'}, {'status': 'PENDING'},
    {'edit': False}, {'view': False, 'edit': False},
])
def test_route_rejects_non_editors_before_database(options):
    db = FakeDatabase()
    response = unit_client(db, **options).post(f'/v1/admin/content/writing-aid/{uuid4()}/proposals', json=body())
    assert response.status_code == 403 and not db.calls


def test_route_accepts_only_references_and_has_no_accept_action():
    db = FakeDatabase()
    client = unit_client(db, edit=False)
    source = uuid4()
    assert client.get(f'/v1/admin/content/writing-aid/{source}').status_code == 200
    assert client.post(f'/v1/admin/content/writing-aid/{source}/accept', json={}).status_code == 404
    client = unit_client(db)
    for changes in ({'text': 'Untrusted customer text'}, {'prompt': 'Fetch another source'},
                    {'context': [{'translation_id': str(uuid4()), 'expected_revision': 1, 'text': 'private'}]}):
        assert client.post(f'/v1/admin/content/writing-aid/{source}/proposals', json=body(**changes)).status_code == 422


async def invoke(db, actor, sql, *args):
    try:
        return await call(db, actor, sql, *args)
    finally:
        await db.execute('SET LOCAL ROLE postgres')


async def enable_field(db, admin, key, enabled=True):
    # Explicit local-fixture opt-in through the same guarded registry writer.
    # Temporarily equip this synthetic Admin, then restore its original special.
    specials = await db.fetchval("select special_actions from hub.account_permission where account_id=$1 and tab='projects'", admin)
    try:
        await db.execute("update hub.account_permission set special_actions=array_append(special_actions,'projects.manage_field_catalog') where account_id=$1 and tab='projects' and not 'projects.manage_field_catalog'=any(special_actions)", admin)
        revision = await db.fetchval('select revision from hub.field_catalog where field_key=$1', key)
        return await invoke(db, admin, 'select hub.save_content_field($1,$2,$3)', key, revision, {'ai_writing_enabled': enabled})
    finally:
        await db.execute("update hub.account_permission set special_actions=$2 where account_id=$1 and tab='projects'", admin, specials)


async def seed_source(db, actor, admin=None):
    project = await project_fixture(db, actor)
    await invoke(db, actor, "select hub.save_content_section('project',$1,'section.project_intro',0,$2)",
                 project['public_project_id'], {'body': {'th': 'Green  20 homes {project}', 'en': 'Green  20 homes {project}'}})
    source = await db.fetchrow("select * from hub.content_translations where scope_id=$1 and field_key='section.project_intro'",
                               project['public_project_id'])
    if admin is not None:
        await enable_field(db, admin, 'section.project_intro')
    return project, source


BEGIN = 'select hub.writing_aid_begin($1,$2,$3,$4,$5,$6)'
FINISH = 'select hub.writing_aid_finish($1,$2,$3)'


def test_migration_keeps_existing_fields_off_until_explicit_registry_opt_in(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await operator()
        tx = db.transaction()
        await tx.start()
        try:
            assert not await db.fetchval('select exists(select 1 from hub.field_catalog where ai_writing_enabled)')
            default = await db.fetchval("select column_default from information_schema.columns where table_schema='hub' and table_name='field_catalog' and column_name='ai_writing_enabled'")
            assert default == 'false'
            _, source = await seed_source(db, ids['editor'])
            assert (await invoke(db, ids['editor'], 'select hub.writing_aid_state($1)', source['id']))['eligible'] is False
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await invoke(db, ids['editor'], BEGIN, source['id'], source['revision'], 'th', 'proofread', uuid4(), [])
            assert not await db.fetchval('select exists(select 1 from hub.writing_ai_requests where translation_id=$1)', source['id'])
            revision = await db.fetchval("select revision from hub.field_catalog where field_key='section.project_intro'")
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await invoke(db, ids['editor'], "select hub.save_content_field('section.project_intro',$1,$2)", revision, {'ai_writing_enabled': True})
            enabled = await enable_field(db, ids['admin'], 'section.project_intro')
            assert enabled['ai_writing_enabled'] is True
            assert (await invoke(db, ids['editor'], 'select hub.writing_aid_state($1)', source['id']))['eligible'] is True
            with pytest.raises(asyncpg.CheckViolationError):
                await enable_field(db, ids['admin'], 'project.ad_disclaimer')
            assert not await db.fetchval("select ai_writing_enabled from hub.field_catalog where field_key='project.ad_disclaimer'")
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


def test_real_sql_source_permissions_idempotence_and_no_content_write(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await operator()
        tx = db.transaction()
        await tx.start()
        try:
            _, source = await seed_source(db, ids['editor'], ids['admin'])
            fingerprint = "select md5(jsonb_build_object('sections',(select jsonb_agg(to_jsonb(v) order by id) from hub.content_section_versions v),'translations',(select jsonb_agg(to_jsonb(t) order by id) from hub.content_translations t))::text)"
            before = await db.fetchval(fingerprint)
            for actor in ('viewer', 'publisher', 'pending', 'agency', 'service_consumer'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await invoke(db, ids[actor], BEGIN, source['id'], source['revision'], 'th', 'proofread', uuid4(), [])
            state = await invoke(db, ids['viewer'], 'select hub.writing_aid_state($1)', source['id'])
            assert state['eligible'] and not state['requests']
            request = uuid4()
            args = (source['id'], source['revision'], 'th', 'proofread', request, [])
            admission = await invoke(db, ids['editor'], BEGIN, *args)
            assert admission['status'] == 'ready' and admission['input_text'] == source['th_text']
            again = await invoke(db, ids['editor'], BEGIN, *args)
            assert again['status'] == 'running' and again['replayed'] and 'input_text' not in again
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await invoke(db, ids['admin'], FINISH, request, None, 1)
            done = await invoke(db, ids['editor'], FINISH, request, None, 1)
            assert done['status'] == 'done' and done['synthetic'] and done['input_tokens'] == done['output_tokens'] == 0
            state = await invoke(db, ids['viewer'], 'select hub.writing_aid_state($1)', source['id'])
            assert not state['requests'], 'Usage is actor-owned'
            assert before == await db.fetchval(fingerprint)
            audit = await db.fetchval("select jsonb_agg(after_row) from audit.change_log where table_name='hub.writing_ai_requests' and after_row->>'id'=$1", str(request))
            assert audit and 'Green' not in str(audit) and 'input_text' not in str(audit)
            await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false where account_id=$1 and tab='projects'", ids['editor'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await invoke(db, ids['editor'], BEGIN, *args)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await invoke(db, ids['editor'], 'select hub.writing_aid_state($1)', source['id'])
            assert await invoke(db, ids['editor'], 'select hub.list_brands()') is not None
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('change,expected', [('revision', 'source_changed'), ('grant', 'permission_revoked'),
                                            ('eligibility', 'permission_revoked'), ('inactive', 'permission_revoked')])
@pytest.mark.parametrize('aged', [False, True])
def test_finish_rechecks_current_source_and_authority(permission_accounts, change, expected, aged):
    _, ids = permission_accounts

    async def check():
        db = await operator()
        tx = db.transaction()
        await tx.start()
        try:
            _, source = await seed_source(db, ids['editor'], ids['admin'])
            request = uuid4()
            await invoke(db, ids['editor'], BEGIN, source['id'], source['revision'], 'en', 'shorten', request, [])
            if aged:
                await db.execute("update hub.writing_ai_requests set created_at=statement_timestamp()-interval '11 minutes' where id=$1", request)
                state = await invoke(db, ids['editor'], 'select hub.writing_aid_state($1)', source['id'])
                assert next(row for row in state['requests'] if row['id'] == str(request))['status'] == 'ambiguous'
            if change == 'revision':
                await db.execute('update hub.content_translations set revision=revision+1 where id=$1', source['id'])
            elif change == 'grant':
                await db.execute("update hub.account_permission set can_edit=false where account_id=$1 and tab='projects'", ids['editor'])
            elif change == 'eligibility':
                await db.execute("update hub.field_catalog set ai_writing_enabled=false where field_key='section.project_intro'")
            else:
                await db.execute("update hub.user_account set status='SUSPENDED' where id=$1", ids['editor'])
            result = await invoke(db, ids['editor'], FINISH, request, None, 1)
            assert result['status'] == 'failed' and result['error_code'] == expected
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('aged', [False, True])
def test_context_permission_revision_and_budget_month_isolation(permission_accounts, aged):
    _, ids = permission_accounts

    async def check():
        db = await operator()
        tx = db.transaction()
        await tx.start()
        try:
            _, source = await seed_source(db, ids['editor'], ids['admin'])
            brand = await db.fetchrow("select id,public_brand_id from hub.brands where deleted_at is null order by id limit 1")
            await db.execute("update hub.brands set description=$2 where id=$1", brand['id'], {'th': 'Calm gardens', 'en': 'Calm gardens'})
            context = await db.fetchrow("select * from hub.content_translations where field_key='brand.description' and scope_id=$1", brand['public_brand_id'])
            await enable_field(db, ids['admin'], 'brand.description')
            refs = [{'translation_id': str(context['id']), 'expected_revision': context['revision']}]
            request = uuid4()
            admission = await invoke(db, ids['editor'], BEGIN, source['id'], source['revision'], 'th', 'draft', request, refs)
            assert 'Calm gardens' in admission['input_text']
            if aged:
                await db.execute("update hub.writing_ai_requests set created_at=statement_timestamp()-interval '11 minutes' where id=$1", request)
                state = await invoke(db, ids['editor'], 'select hub.writing_aid_state($1)', source['id'])
                assert next(row for row in state['requests'] if row['id'] == str(request))['status'] == 'ambiguous'
            await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false where account_id=$1 and tab='brands'", ids['editor'])
            result = await invoke(db, ids['editor'], FINISH, request, None, 1)
            assert result['error_code'] == 'permission_revoked'
            state = await invoke(db, ids['editor'], 'select hub.writing_aid_state($1)', source['id'])
            assert not state['requests'], 'Revoked context references must not leak through recent requests'
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await invoke(db, ids['editor'], BEGIN, source['id'], source['revision'], 'th', 'draft', uuid4(), refs)

            media = await db.fetchval('select to_jsonb(s) from hub.media_ai_settings s')
            await db.execute('update hub.writing_ai_settings set monthly_cap_usd=0.01,request_ceiling_usd=0.01')
            request = uuid4()
            args = (source['id'], source['revision'], 'th', 'proofread')
            assert (await invoke(db, ids['editor'], BEGIN, *args, request, []))['status'] == 'ready'
            assert (await invoke(db, ids['editor'], FINISH, request, 'provider_error', 1))['status'] == 'failed'
            assert (await invoke(db, ids['editor'], BEGIN, *args, uuid4(), []))['status'] == 'budget_exhausted'
            await db.execute("update hub.writing_ai_requests set budget_month=budget_month-interval '1 month' where id=$1", request)
            reset = uuid4()
            assert (await invoke(db, ids['editor'], BEGIN, *args, reset, []))['status'] == 'ready'
            await invoke(db, ids['editor'], FINISH, reset, 'budget_exhausted', 1)
            assert (await invoke(db, ids['editor'], 'select hub.writing_aid_state($1)', source['id']))['budget']['status'] == 'budget_exhausted'
            assert await db.fetchval('select to_jsonb(s) from hub.media_ai_settings s') == media
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


def test_registry_admin_control_and_hard_exclusions_survive_forced_flags(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await operator()
        tx = db.transaction()
        await tx.start()
        try:
            project, _ = await seed_source(db, ids['editor'], ids['admin'])
            revision = await db.fetchval("select revision from hub.field_catalog where field_key='section.project_intro'")
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await invoke(db, ids['admin'], "select hub.save_content_field('section.project_intro',$1,$2)", revision, {'ai_writing_enabled': False})
            await db.execute("update hub.account_permission set special_actions=array_append(special_actions,'projects.manage_field_catalog') where account_id=$1 and tab='projects'", ids['admin'])
            changed = await invoke(db, ids['admin'], "select hub.save_content_field('section.project_intro',$1,$2)", revision, {'ai_writing_enabled': False})
            assert changed['ai_writing_enabled'] is False
            catalog = await invoke(db, ids['viewer'], 'select hub.content_fields()')
            assert next(x for x in catalog['items'] if x['field_key'] == 'section.project_intro')['ai_writing_enabled'] is False
            forbidden = await db.fetchval("select revision from hub.field_catalog where field_key='project.ad_disclaimer'")
            with pytest.raises(asyncpg.CheckViolationError):
                await invoke(db, ids['admin'], "select hub.save_content_field('project.ad_disclaimer',$1,$2)", forbidden, {'ai_writing_enabled': True})
            await db.execute("update hub.field_catalog set ai_writing_enabled=true where field_key='project.ad_disclaimer'")
            await db.execute("update hub.projects set ad_disclaimer=$2 where id=$1", project['id'], {'th': 'Private legal terms 99', 'en': 'Private legal terms 99'})
            legal = await db.fetchrow("select * from hub.content_translations where owner_key=$1 and field_key='project.ad_disclaimer'", str(project['id']))
            state = await invoke(db, ids['editor'], 'select hub.writing_aid_state($1)', legal['id'])
            assert state['eligible'] is False
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await invoke(db, ids['editor'], BEGIN, legal['id'], legal['revision'], 'th', 'draft', uuid4(), [])

            await enable_field(db, ids['admin'], 'faq.detail')
            for topic in ('design', 'commercial_terms', 'investment_context', 'buying_process', 'programmes', 'contacts', 'media_documents'):
                question = 'writing_' + uuid4().hex
                await db.execute("""insert into hub.faq_questions(question_key,topic,default_level,question_template,answer_kind,status)
                    values($1,$2,'corporate','{"th":"Synthetic terms question"}','text','approved')""", question, topic)
                faq = await invoke(db, ids['editor'], 'select hub.save_faq(null,0,$1)', {
                    'question_key': question, 'scope_type': 'corporate', 'scope_id': 'sena',
                    'question': {'th': 'Synthetic terms question'}, 'short_answer': {'th': 'Restricted terms 99'},
                    'detail': {'th': 'Restricted terms 99'}, 'answer_kind': 'text',
                })
                source = await db.fetchrow("select * from hub.content_translations where owner_key=$1 and field_key='faq.detail'", faq['id'])
                eligible = topic == 'design'
                assert (await invoke(db, ids['editor'], 'select hub.writing_aid_state($1)', source['id']))['eligible'] is eligible
                if eligible:
                    request = uuid4()
                    assert (await invoke(db, ids['editor'], BEGIN, source['id'], source['revision'], 'th', 'draft', request, []))['status'] == 'ready'
                    assert (await invoke(db, ids['editor'], FINISH, request, None, 1))['status'] == 'done'
                else:
                    with pytest.raises(asyncpg.InsufficientPrivilegeError):
                        await invoke(db, ids['editor'], BEGIN, source['id'], source['revision'], 'th', 'draft', uuid4(), [])
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


def test_concurrent_admission_cannot_overspend_monthly_cap(permission_accounts):
    _, ids = permission_accounts

    async def check():
        setup = await operator()
        workers = []
        previous = await setup.fetchrow('select monthly_cap_usd,request_ceiling_usd,blocked_month from hub.writing_ai_settings')
        previous_flag = await setup.fetchval("select ai_writing_enabled from hub.field_catalog where field_key='section.project_intro'")
        requests = [uuid4(), uuid4()]
        try:
            # This fixture belongs to the disposable cluster. Keep its ordinary
            # content history intact; the runner discards the cluster afterward.
            _, source = await seed_source(setup, ids['editor'], ids['admin'])
            spent = await setup.fetchval("select coalesce(sum(charged_usd),0) from hub.writing_ai_requests where budget_month=date_trunc('month',current_timestamp at time zone 'Asia/Bangkok')::date")
            await setup.execute('update hub.writing_ai_settings set monthly_cap_usd=$1,request_ceiling_usd=0.01,blocked_month=null', spent + Decimal('0.01'))
            workers = [await operator(), await operator()]

            async def reserve(db, request):
                return await invoke(db, ids['editor'], BEGIN, source['id'], source['revision'], 'th', 'proofread', request, [])

            results = await asyncio.gather(*(reserve(db, request) for db, request in zip(workers, requests)))
            assert sorted(r['status'] for r in results) == ['budget_exhausted', 'ready']
            assert await setup.fetchval('select sum(charged_usd) from hub.writing_ai_requests where id=any($1::uuid[])', requests) == Decimal('0.01')
            ready = requests[next(i for i, result in enumerate(results) if result['status'] == 'ready')]
            assert (await invoke(setup, ids['editor'], FINISH, ready, 'provider_error', 1))['status'] == 'failed'
            assert (await invoke(setup, ids['editor'], BEGIN, source['id'], source['revision'], 'th', 'proofread', ready, []))['replayed']
        finally:
            await enable_field(setup, ids['admin'], 'section.project_intro', previous_flag)
            await setup.execute('update hub.writing_ai_settings set monthly_cap_usd=$1,request_ceiling_usd=$2,blocked_month=$3', *previous.values())
            await setup.execute('delete from hub.writing_ai_requests where id=any($1::uuid[])', requests)
            for db in workers:
                await db.close()
            await setup.close()
    asyncio.run(check())


def test_orphaned_admission_is_read_only_ambiguous_and_keeps_charge_and_late_finish(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await operator()
        tx = db.transaction()
        await tx.start()
        try:
            _, source = await seed_source(db, ids['editor'], ids['admin'])
            await db.execute('update hub.writing_ai_settings set monthly_cap_usd=100,request_ceiling_usd=0.01,blocked_month=null')
            fingerprint = "select md5(jsonb_build_object('sections',(select jsonb_agg(to_jsonb(v) order by id) from hub.content_section_versions v),'translations',(select jsonb_agg(to_jsonb(t) order by id) from hub.content_translations t))::text)"
            before = await db.fetchval(fingerprint)
            request, newer = uuid4(), uuid4()
            args = (source['id'], source['revision'], 'th', 'proofread')
            assert (await invoke(db, ids['editor'], BEGIN, *args, request, []))['status'] == 'ready'
            fresh = await invoke(db, ids['editor'], 'select hub.writing_aid_state($1)', source['id'])
            assert fresh['requests'][0]['status'] == 'running'
            await db.execute("update hub.writing_ai_requests set created_at=statement_timestamp()-interval '11 minutes' where id=$1", request)
            physical = await db.fetchval('select to_jsonb(r) from hub.writing_ai_requests r where id=$1', request)
            audit_before = await db.fetchval('select count(*) from audit.change_log')
            for _ in range(2):
                observed = await invoke(db, ids['editor'], 'select hub.writing_aid_state($1)', source['id'])
                old = next(row for row in observed['requests'] if row['id'] == str(request))
                assert old['status'] == 'ambiguous' and old['completed_at'] is None
                assert Decimal(str(old['charged_usd'])) == Decimal('0.01')
            replay = await invoke(db, ids['editor'], BEGIN, *args, request, [])
            assert replay['status'] == 'ambiguous' and replay['replayed']
            assert 'input_text' not in replay and 'proposal' not in replay
            assert await db.fetchval('select to_jsonb(r) from hub.writing_ai_requests r where id=$1', request) == physical
            assert await db.fetchval('select count(*) from audit.change_log') == audit_before
            assert (await invoke(db, ids['editor'], BEGIN, *args, newer, []))['status'] == 'ready'
            charges = await db.fetchval('select sum(charged_usd) from hub.writing_ai_requests where id=any($1::uuid[])', [request, newer])
            assert charges == Decimal('0.02'), 'A new explicit request is charged separately; the old charge remains'
            done = await invoke(db, ids['editor'], FINISH, request, None, 600000)
            assert done['status'] == 'done' and done['completed_at'] is not None
            assert Decimal(str(done['charged_usd'])) == Decimal('0.01')
            observed = await invoke(db, ids['editor'], 'select hub.writing_aid_state($1)', source['id'])
            assert observed['requests'][0]['id'] == str(newer)
            assert observed['requests'][0]['status'] == 'running'
            assert next(row for row in observed['requests'] if row['id'] == str(request))['status'] == 'done'
            await invoke(db, ids['editor'], FINISH, newer, None, 1)
            observed = await invoke(db, ids['editor'], 'select hub.writing_aid_state($1)', source['id'])
            assert observed['requests'][0]['id'] == str(newer) and observed['requests'][0]['status'] == 'done'
            assert before == await db.fetchval(fingerprint), 'Recovery never saves ordinary content'
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())
