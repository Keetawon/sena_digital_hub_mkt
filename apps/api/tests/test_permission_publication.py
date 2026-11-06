"""Publication/knowledge permission probes use only a verified disposable cluster."""
import asyncio
from contextlib import asynccontextmanager
import json
from uuid import uuid4, UUID

import asyncpg
import pytest
from fastapi.routing import APIRoute

from sena_hub_api.content_permissions import CONTENT_RULES
from sena_hub_api import knowledge
from content_workflow_fixture import load_sql_fixture, publication_persona
from test_permission_baseline import disposable_operator, ROOT
from test_permission_db_baseline import runtime, PUBLICATION_TABLES, PUBLICATION_FUNCTIONS
from test_permission_foundations import permission_accounts, h
from test_permission_content import call, set_bit


@asynccontextmanager
async def rows(ids, *, role='hub_app'):
    db = await disposable_operator()
    transaction = db.transaction()
    await transaction.start()
    try:
        key = uuid4().hex
        candidate, release, promotion, preview = (uuid4() for _ in range(4))
        await db.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
        project = await db.fetchval("select id from hub.projects where rem_project_id='DEMO-001'")
        await db.execute("""insert into hub.public_promotions(id,project_id,code,benefit_type,starts_at,ends_at,created_by,updated_by)
            values($1,$2,$3,'other',now(),now()+interval '1 day',$4,$4)""", promotion, project, key.upper(), ids['editor'])
        await db.execute("insert into hub.publication_releases(id,change_reason,demo_mode,published_by) values($1,'Synthetic',false,$2)", release, ids['publisher'])
        await db.execute("""insert into hub.publication_release_members(release_id,entity_type,entity_id,public_id,after_version_id)
            values($1,'project',$2,'SYNTHETIC',$3)""", release, project, uuid4())
        await db.execute("insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint) values($1,'Synthetic',now(),'synthetic')", key)
        await db.execute("insert into staging.knowledge_batches values($1,'{}',now())", key * 2)
        await db.execute("""insert into staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,topic,source_ref,evidence)
            values($1,$2,'synthetic','section',array[$3],'design','synthetic','{}')""", candidate, key * 2, key)
        await db.execute("""insert into hub.knowledge_reviews(candidate_id,decision,applies_to_project_ids,note,reviewed_by)
            values($1,'accepted',array[$2],'Synthetic',$3)""", candidate, key, ids['editor'])
        await db.execute("insert into rag.project_fact_cards values($1,$2,'{}','DRAFT_PREVIEW')", key, key * 2)
        await db.execute("""insert into rag.knowledge_preview_chunks(candidate_id,project_ids,locale,chunk_text,keywords,content_sha256,embedding_model,embedding)
            values($1,array[$2],'th','Synthetic',array['Synthetic'],$3,'synthetic',array_fill(0::real,array[1536]))""", candidate, key, key * 2)
        payload = {'fact_card': {'model_catalogue_complete': True}, 'chunks': [{'source_ref': 'synthetic-knowledge'}],
                   'assets': [{'asset_id': '10000000-0000-0000-0000-000000000001', 'role': 'hero'}]}
        await db.execute("insert into hub.knowledge_preview_releases(id,rem_project_id,payload,reason,created_by) values($1,$2,$3::jsonb,'Synthetic',$4)",
                         preview, key, json.dumps(payload), ids['publisher'])
        assert role in ('hub_app', 'editor', 'publisher', 'viewer', 'admin')
        principal = 'hub_runtime' if role == 'hub_app' else 'hub_permission_probe'
        await db.execute('SET LOCAL SESSION AUTHORIZATION ' + principal)
        assert tuple(await db.fetchrow('select rolsuper,rolbypassrls from pg_roles where rolname=session_user')) == (False, False)
        yield db, {'promotion': promotion, 'release': release, 'candidate': candidate, 'preview': preview, 'project': key}
    finally:
        await transaction.rollback()
        await db.close()


def test_publication_routes_have_complete_mapping(permission_accounts):
    client, _ = permission_accounts
    prefixes = ('/v1/admin/promotions', '/v1/admin/releases', '/v1/admin/knowledge')
    actual = {(method, route.path) for route in client.app.routes if isinstance(route, APIRoute)
              and route.path.startswith(prefixes) for method in route.methods}
    assert actual == {key for key in CONTENT_RULES if key[1].startswith(prefixes)}
    assert ('GET', '/v1/admin/promotions/references') in actual
    assert len(actual) == 21


@pytest.mark.parametrize('tab,table,rpc', [
    ('promotions', 'hub.public_promotions', 'hub.promotion_read()'),
    ('releases', 'hub.publication_releases', 'hub.release_read()'),
    ('knowledge', 'hub.knowledge_reviews', 'hub.knowledge_candidate_rows()'),
])
@pytest.mark.parametrize('role', ['hub_app', 'editor', 'publisher', 'viewer', 'admin'])
def test_publication_view_off_denies_rows_rpc_and_preserves_neighbor(permission_accounts, tab, table, rpc, role):
    _, ids = permission_accounts
    async def check():
        async with rows(ids, role=role) as (db, data):
            reads = [rpc]
            if tab == 'releases':
                reads.append('hub.release_candidates(false)')
            elif tab == 'knowledge':
                reads.extend(["hub.knowledge_followup('synthetic-none')", "hub.knowledge_model_catalogue('synthetic-none')",
                              'hub.knowledge_preview_read(null,null)',
                              f"hub.record_knowledge_gap('{data['project']}','NO_ANSWER',repeat('b',64))"])
            if role == 'hub_app' or tab == 'knowledge':
                assert await call(db, ids['viewer'], f'select count(*) from {table}', role=role) > 0
            else:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['viewer'], f'select count(*) from {table}', role=role)
            for entry in reads:
                await call(db, ids['viewer'], 'select ' + entry, role=role)
            await set_bit(ids['viewer'], tab, can_view=False)
            if role == 'hub_app' or tab == 'knowledge':
                assert await call(db, ids['viewer'], f'select count(*) from {table}', role=role) == 0
            for entry in reads:
                if tab == 'releases' and entry == rpc:
                    # N6 preserves history through either entry permission. Raw
                    # release rows and candidate authoring retain their own gate.
                    history = await call(db, ids['viewer'], 'select ' + entry, role=role)
                    history = json.loads(history) if isinstance(history, str) else history
                    assert any(item['id'] == str(data['release']) for item in history['items'])
                else:
                    with pytest.raises(asyncpg.InsufficientPrivilegeError):
                        await call(db, ids['viewer'], 'select ' + entry, role=role)
            if tab == 'releases':
                await set_bit(ids['viewer'], 'knowledge', can_view=False)
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['viewer'], 'select ' + rpc, role=role)
            await call(db, ids['viewer'], 'select hub.list_brands()', role=role)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['admin'], f'delete from {table}', role=role)
    asyncio.run(check())


@pytest.mark.parametrize('revoked', ['action', 'view'])
@pytest.mark.parametrize('account,tab,bit,entry', [
    ('editor', 'promotions', 'can_edit', "hub.promotion_command('create',null,'{}')"),
    ('editor', 'promotions', 'can_edit', "hub.promotion_command('update',null,'{}')"),
    ('publisher', 'promotions', 'can_approve', "hub.promotion_command('review',null,'{}')"),
    ('viewer', 'promotions', 'publish', "hub.promotion_command('publish',null,'{}')"),
    ('viewer', 'promotions', 'publish', "hub.promotion_command('withdraw',null,'{}')"),
    ('viewer', 'releases', 'publish', "hub.release_publish('[]','Synthetic',false)"),
    ('viewer', 'releases', 'publish', "hub.release_rollback(null,'Synthetic')"),
    ('editor', 'knowledge', 'can_edit', "hub.review_knowledge_candidate(null,0,'accepted','{}','Synthetic',false,null,null)"),
    ('editor', 'knowledge', 'can_edit', "hub.review_knowledge_question('synthetic-none',0,'verified','Synthetic','Synthetic')"),
    ('publisher', 'knowledge', 'can_approve', "hub.lock_knowledge_asset(null)"),
    ('publisher', 'knowledge', 'can_approve', "hub.knowledge_link_approved_asset(null,null,0)"),
    ('publisher', 'knowledge', 'can_approve', "hub.publish_knowledge_preview('synthetic-none','{}','Synthetic')"),
])
def test_publication_one_mutation_bit_off_at_sd_entry(permission_accounts, account, tab, bit, entry, revoked):
    _, ids = permission_accounts
    async def check():
        if bit == 'publish':
            await publication_persona(ids)
        db = await runtime()
        try:
            with pytest.raises(asyncpg.PostgresError) as allowed:
                await call(db, ids[account], 'select ' + entry)
            assert allowed.value.sqlstate != '42501'
            if bit == 'publish':
                source_tab = 'knowledge' if tab == 'releases' else tab
                if revoked == 'view':
                    # Releases V is history-only under N2. Its publication
                    # command requires Knowledge V plus the existing special.
                    if source_tab == 'knowledge':
                        await set_bit(ids[account], source_tab, special_actions=[], can_view=False)
                    else:
                        await set_bit(ids[account], source_tab, can_view=False)
                else:
                    await set_bit(ids[account], 'knowledge', special_actions=[])
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids[account], 'select ' + entry)
                assert await call(db, ids[account], "select hub.can($1,'view')", source_tab) is (revoked == 'action')
                await call(db, ids[account], 'select hub.list_brands()')
                return
            if revoked == 'view':
                # Foundation storage is stricter than an ineffective stored bit:
                # E/A without V is rejected atomically. Then revoke a valid row.
                with pytest.raises(asyncpg.CheckViolationError):
                    await set_bit(ids[account], tab, can_view=False)
                assert await call(db, ids[account], "select hub.can($1,$2)", tab, bit.removeprefix('can_'))
            await set_bit(ids[account], tab, **{bit: False})
            if revoked == 'view':
                await set_bit(ids[account], tab, can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids[account], 'select ' + entry)
            assert await call(db, ids[account], "select hub.can($1,'view')", tab) is (revoked == 'action')
            await call(db, ids[account], 'select hub.list_brands()')
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('tab', ['projects', 'brands', 'promotions'])
def test_mixed_release_publish_and_rollback_require_every_member_view(permission_accounts, tab):
    _, ids = permission_accounts
    async def check():
        await publication_persona(ids)
        db = await disposable_operator()
        transaction = db.transaction()
        await transaction.start()
        try:
            # Reuse the existing complete synthetic brand/project/media fixture.
            fixture = (ROOT / 'supabase/tests/residential_demo.sql').read_text(encoding='utf-8').split('-- Every new table')[0]
            await load_sql_fixture(db, ids['admin'])
            await db.execute(fixture.replace('begin;', '', 1))
            project = await db.fetchval("select current_setting('test.residential_project')::uuid")
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
            promotion = json.loads(await db.fetchval("""select hub.promotion_command('create',null,jsonb_build_object(
                'project_id',$1::uuid,'code','SYNTHETIC-PERMISSION-OFFER','benefit_type','other',
                'title',jsonb_build_object('th','Synthetic'),'summary',jsonb_build_object('th','Synthetic'),
                'conditions_public',jsonb_build_object('th','Synthetic'),'legal_terms',jsonb_build_object('th','Synthetic'),
                'disclaimer',jsonb_build_object('th','Synthetic'),'starts_at',now(),'ends_at',now()+interval '1 day'))""", project))
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['publisher']))
            for kind in ('DATA', 'LEGAL'):
                await db.fetchval("""select hub.promotion_command('review',$1,jsonb_build_object('expected_revision',1,
                    'review_type',$2::text,'decision','APPROVED','evidence','Synthetic','change_reason','Synthetic'))""", UUID(promotion['id']), kind)
            candidates = json.loads(await db.fetchval('select hub.release_candidates(false)'))['items']
            selected = {str(project), promotion['id'], await db.fetchval("select current_setting('test.residential_brand')")}
            members = [{k: item[k] for k in ('entity_type', 'entity_id', 'expected_updated_at', 'expected_revision', 'expected_published_version_id')}
                       for item in candidates if item['entity_id'] in selected]
            assert len(members) == 3
            await db.execute('SET LOCAL SESSION AUTHORIZATION hub_runtime')
            snapshot = """select jsonb_build_object('projects',(select jsonb_object_agg(id,published_version_id) from hub.projects),
                'brands',(select jsonb_object_agg(id,published_version_id) from hub.brands),
                'promotions',(select jsonb_object_agg(id,published_version_id) from hub.public_promotions),
                'release_count',(select count(*) from hub.publication_releases),
                'promotion_versions',(select count(*) from hub.promotion_versions))"""
            assert not await call(db, ids['viewer'], "select hub.can($1,'approve')", tab)
            before = await call(db, ids['admin'], snapshot)
            await set_bit(ids['viewer'], tab, can_view=False)
            for demo in (False, True):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['viewer'], 'select hub.release_publish($1::jsonb,$2,$3)', json.dumps(members), 'Synthetic', demo)
                assert await call(db, ids['admin'], snapshot) == before
            await set_bit(ids['viewer'], tab, can_view=True)
            result = json.loads(await call(db, ids['viewer'], 'select hub.release_publish($1::jsonb,$2,false)', json.dumps(members), 'Synthetic'))
            published = await call(db, ids['admin'], snapshot)
            await set_bit(ids['viewer'], tab, can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.release_rollback($1,$2)', UUID(result['id']), 'Synthetic')
            assert await call(db, ids['admin'], snapshot) == published
            await set_bit(ids['viewer'], tab, can_view=True)
            restored = json.loads(await call(db, ids['viewer'], 'select hub.release_rollback($1,$2)', UUID(result['id']), 'Synthetic'))
            assert restored['status'] == 'ROLLED_BACK'
            # Release V alone cannot disclose members/candidates from a hidden tab.
            await set_bit(ids['viewer'], tab, can_view=False)
            read = json.loads(await call(db, ids['viewer'], 'select hub.release_read($1)', UUID(result['id'])))
            assert all(m['entity_type'] + 's' != tab for m in read['members'])
            candidates = json.loads(await call(db, ids['viewer'], 'select hub.release_candidates(false)'))['items']
            assert all(m['entity_type'] + 's' != tab for m in candidates)
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())


def test_knowledge_hidden_project_and_asset_data_removed_from_preview_snapshot(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with rows(ids) as (db, data):
            before = json.loads(await call(db, ids['viewer'], 'select hub.knowledge_preview_read($1,$2)', data['preview'], data['project']))
            assert before['fact_card']['model_catalogue_complete'] is True and len(before['assets']) == 1
            await set_bit(ids['viewer'], 'projects', can_view=False)
            assert await call(db, ids['viewer'], 'select hub.knowledge_model_catalogue($1)', data['project']) is None
            after = json.loads(await call(db, ids['viewer'], 'select hub.knowledge_preview_read($1,$2)', data['preview'], data['project']))
            assert after['fact_card']['model_catalogue_complete'] is None and after['assets'] == []
            assert after['chunks'] == before['chunks']
            assert await call(db, ids['viewer'], 'select count(*) from hub.knowledge_preview_releases where id=$1', data['preview']) == 0
            await set_bit(ids['viewer'], 'knowledge', can_view=False)
            for query in ('select count(*) from rag.knowledge_preview_chunks', 'select count(*) from rag.project_fact_cards'):
                assert await call(db, ids['viewer'], query) == 0
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.knowledge_preview_read($1,$2)', data['preview'], data['project'])
    asyncio.run(check())


def test_knowledge_revocation_denies_api_before_embedding_and_files(permission_accounts, monkeypatch):
    client, ids = permission_accounts
    async def forbidden_embed(_):
        raise AssertionError('Permission denial must precede embeddings')
    monkeypatch.setattr(knowledge, 'embed', forbidden_embed)
    asyncio.run(set_bit(ids['admin'], 'knowledge', can_edit=False, can_approve=False))
    assert client.get('/v1/admin/knowledge/projects', headers=h('admin')).status_code == 200
    asyncio.run(set_bit(ids['admin'], 'knowledge', can_view=False))
    for path in ('projects', f'candidates/{uuid4()}/file'):
        assert client.get('/v1/admin/knowledge/' + path, headers=h('admin')).status_code == 403
    assert client.post('/v1/admin/knowledge/preview', headers=h('admin'), json={'question': 'Synthetic'}).status_code == 403
    assert client.get('/v1/admin/projects', headers=h('admin')).status_code == 200


@pytest.mark.parametrize('choice', ['accepted', 'rejected', 'missing'])
def test_legacy_faq_api_denies_every_decision_without_creating_rows(permission_accounts, choice):
    client, _ = permission_accounts
    candidate = uuid4()
    fingerprint = uuid4().hex * 2

    async def seed_or_read(seed=False):
        operator = await disposable_operator()
        try:
            if seed:
                await operator.execute("insert into staging.knowledge_batches(manifest_sha256,manifest) values($1,'{}')", fingerprint)
                await operator.execute("""insert into staging.knowledge_candidates
                    (id,batch_sha256,source_key,kind,project_ids,topic,source_ref,evidence)
                    values($1,$2,'n7-api','faq',array['DEMO-001'],'design','synthetic-n7','{}')""", candidate, fingerprint)
            return json.loads(await operator.fetchval("""select jsonb_build_object(
                'faqs',(select count(*) from hub.faqs where candidate_id=$1),
                'versions',(select count(*) from hub.faq_versions v join hub.faqs f on f.id=v.faq_id where f.candidate_id=$1),
                'reviews',(select count(*) from hub.knowledge_reviews where candidate_id=$1),
                'audit',(select count(*) from audit.change_log where table_name in ('hub.knowledge_reviews','hub.faqs')
                  and after_row->>'candidate_id'=$1::text))""", candidate))
        finally:
            await operator.close()

    before = asyncio.run(seed_or_read(True))
    assert before == {'faqs': 0, 'versions': 0, 'reviews': 0, 'audit': 0}
    path = f'/v1/admin/knowledge/candidates/{candidate}/review'
    body = {'expected_revision': 0, 'decision': choice, 'applies_to_project_ids': ['DEMO-001'], 'reason': 'Synthetic N7 denial'}
    for role in ('editor', 'publisher', 'viewer'):
        assert client.post(path, headers=h(role), json=body).status_code == 403
    response = client.post(path, headers=h('admin'), json=body)
    assert response.status_code == 422, response.text
    assert asyncio.run(seed_or_read()) == before


def test_publication_storage_has_forced_rls_and_no_direct_writes(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db = await runtime()
        try:
            await db.execute('SET ROLE hub_app')
            for name in sorted(PUBLICATION_TABLES):
                schema, relation = name.split('.')
                row = await db.fetchrow('''select c.oid,c.relrowsecurity,c.relforcerowsecurity,c.relowner from pg_class c
                    join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relname=$2''', schema, relation)
                assert row['relrowsecurity'] and row['relforcerowsecurity']
                assert not await db.fetchval("select pg_has_role(session_user,$1::oid,'MEMBER')", row['relowner'])
                for privilege in ('INSERT', 'UPDATE', 'DELETE'):
                    assert not await db.fetchval("select has_table_privilege('hub_app',$1::oid,$2)", row['oid'], privilege)
            for function in await db.fetch('''select p.oid,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname||'.'||p.proname=any($1)''', list(PUBLICATION_FUNCTIONS)):
                assert 'search_path=pg_catalog, pg_temp' in function['proconfig']
                assert not await db.fetchval("""select exists(select 1 from pg_proc p,
                    lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
                    where p.oid=$1 and acl.grantee=0 and privilege_type='EXECUTE')""", function['oid'])
            for actor in ('', 'invalid', str(ids['pending']), str(ids['agency']), str(ids['service_consumer'])):
                for query in ('hub.promotion_read()', 'hub.release_read()', 'hub.knowledge_candidate_rows()'):
                    with pytest.raises(asyncpg.InsufficientPrivilegeError):
                        await call(db, actor, 'select ' + query)
        finally:
            await db.close()
    asyncio.run(check())
