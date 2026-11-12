"""Contextual promotion ownership, reviewed scope and exact runtime boundaries."""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_permission_baseline import disposable_operator
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h
from test_promotions import boundary, headers, DRAFT, ID, PROJECT
from test_real_promotions import command, draft
from test_website_content import project_fixture


@pytest.mark.parametrize('changes', [
    {'project_id': None}, {'owning_brand_id': ID},
    {'excluded_project_ids': [PROJECT, PROJECT]}, {'excluded_project_ids': [None]},
    {'excluded_project_ids': [PROJECT] * 101}, {'excluded_project_ids': 'all'},
])
def test_scope_boundary_rejects_ambiguous_owner_or_exclusions(boundary, changes):
    client, store = boundary
    body = {'project_id': PROJECT, **changes}
    assert client.post('/v1/admin/promotions/resolve', headers=headers('viewer'), json=body).status_code == 422
    assert client.post('/v1/admin/promotions', headers=headers('editor'), json={**DRAFT, **changes}).status_code == 422
    assert not store.calls


def test_brand_owner_and_read_only_resolution_use_existing_boundary(boundary):
    client, store = boundary
    response = client.post('/v1/admin/promotions/resolve', headers=headers('viewer'),
                           json={'owning_brand_id': ID, 'excluded_project_ids': [PROJECT]})
    assert response.status_code == 200
    assert store.calls[-1][0] == 'SELECT hub.promotion_resolve($1::jsonb)::text'
    assert store.calls[-1][1] == ({'project_id': None, 'owning_brand_id': ID,
                                'targets': [], 'excluded_project_ids': [PROJECT]},)
    assert client.post('/v1/admin/promotions', headers=headers('editor'),
                       json={**DRAFT, 'project_id': None, 'owning_brand_id': ID}).status_code == 201
    assert store.calls[-1][1][-1]['project_id'] is None


def test_saved_scope_resolver_derives_owner_without_widening_create_dto(boundary):
    client, store = boundary
    body = {'promotion_id': ID, 'expected_revision': 2, 'targets': [], 'excluded_project_ids': []}
    response = client.post('/v1/admin/promotions/resolve', headers=headers('viewer'), json=body)
    assert response.status_code == 200
    assert store.calls[-1] == ('SELECT hub.promotion_resolve($1::jsonb)::text', (body,))
    for changes in ({'project_id': PROJECT}, {'owning_brand_id': PROJECT}, {'expected_revision': True},
                    {'expected_revision': 0}, {'excluded_project_ids': [PROJECT, PROJECT]}):
        before = len(store.calls)
        assert client.post('/v1/admin/promotions/resolve', headers=headers('viewer'), json=body | changes).status_code == 422
        assert len(store.calls) == before
    before = len(store.calls)
    assert client.post('/v1/admin/promotions', headers=headers('editor'), json={**DRAFT, **body}).status_code == 422
    assert len(store.calls) == before


def test_review_requires_scope_hash_but_old_revocation_does_not(boundary):
    client, store = boundary
    body = {'expected_revision': 1, 'review_type': 'DATA', 'decision': 'APPROVED',
            'evidence': 'Synthetic review evidence', 'change_reason': 'Synthetic scope check'}
    path = f'/v1/admin/promotions/{ID}/review'
    assert client.post(path, headers=headers('publisher'), json=body).status_code == 422
    assert not store.calls
    assert client.post(path, headers=headers('publisher'),
                       json={**body, 'expected_scope_hash': 'a' * 64}).status_code == 200
    assert client.post(path, headers=headers('publisher'),
                       json={**body, 'decision': 'REVOKED', 'expected_revision': 2, 'review_revision': 1}).status_code == 200


def test_brand_ownership_exclusions_and_review_scope_are_additive(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            await project_fixture(db, ids['editor'])
            projects = await db.fetch('select id,public_project_id,brand_id from hub.projects where deleted_at is null order by id limit 2')
            assert len(projects) == 2
            brand = await db.fetchval('select id from hub.brands where deleted_at is null order by id limit 1')
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
            await db.execute('update hub.projects set brand_id=$1 where id=any($2::uuid[])', brand, [p['id'] for p in projects])
            row = await command(db, ids['editor'], 'create', **(draft(None, owning_brand_id=str(brand)) | {'project_id': None}))
            assert row['project_id'] is None and row['owning_brand_id'] == str(brand)
            scope = row['scope']
            assert {p['public_project_id'] for p in projects} <= set(row['target_project_ids'])
            assert scope['count'] == len(scope['items'])
            assert row['applies_via']['scope_level'] == 'brand'
            public_brand = await db.fetchval('select public_brand_id from hub.brands where id=$1', brand)
            listing = await call(db, ids['viewer'], 'select hub.workspace_promotions($1,$2)', 'brand', public_brand)
            assert any(item['id'] == row['id'] for item in listing['items'])
            project_listing = await call(db, ids['viewer'], 'select hub.workspace_promotions($1,$2)', 'project', projects[1]['public_project_id'])
            assert next(item for item in project_listing['items'] if item['id'] == row['id'])['source']['kind'] == 'brand'
            assert listing['context']['owning_brand_id'] == str(brand)
            expired = await command(db, ids['editor'], 'create', **(draft(None, owning_brand_id=str(brand),
                starts_at=(datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
                ends_at=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat()) | {'project_id': None}))
            expired_rows = await call(db, ids['viewer'], 'select hub.workspace_promotions($1,$2,null,$3)', 'brand', public_brand, 'expired')
            assert [item['id'] for item in expired_rows['items']] == [expired['id']]
            for kind, ref, predecessor in [('brand', public_brand, 'data'), ('project', projects[0]['public_project_id'], 'unit-types')]:
                page = await call(db, ids['viewer'], 'select hub.workspace_page($1,$2)', kind, ref)
                assert page['tabs'].index('promotions') == page['tabs'].index(predecessor) + 1
            await db.execute("update hub.account_permission set can_view=false where account_id=$1 and tab='promotions'", ids['viewer'])
            denied_page = await call(db, ids['viewer'], 'select hub.workspace_page($1,$2)', 'project', projects[0]['public_project_id'])
            assert 'promotions' not in denied_page['tabs'] and denied_page['overview']['promotions'] is None
            for fn in ('workspace_promotions', 'workspace_promotion_suggestions'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['viewer'], f'select hub.{fn}($1,$2)', 'project', projects[0]['public_project_id'])
            await db.execute("update hub.account_permission set can_view=true where account_id=$1 and tab='promotions'", ids['viewer'])
            with pytest.raises(asyncpg.SerializationError):
                await command(db, ids['publisher'], 'review', row, review_type='DATA', decision='APPROVED',
                              evidence='Synthetic', change_reason='Synthetic', expected_scope_hash='0' * 64)
            approved = await command(db, ids['publisher'], 'review', row, review_type='DATA', decision='APPROVED',
                                     evidence='Synthetic', change_reason='Synthetic', expected_scope_hash=scope['scope_hash'])
            assert approved['reviews'][0]['resolved_project_ids'] == row['target_project_ids']
            changed = await command(db, ids['editor'], 'update', approved, excluded_project_ids=[str(projects[1]['id'])])
            assert changed['draft_revision'] == row['draft_revision'] + 1
            assert projects[1]['public_project_id'] not in changed['target_project_ids']
            assert not changed['reviews'] and len(changed['review_history']) == 1
            assert changed['review_history'][0]['resolved_project_ids'] == row['target_project_ids']
            excluded_listing = await call(db, ids['viewer'], 'select hub.workspace_promotions($1,$2)', 'project', projects[1]['public_project_id'])
            assert not any(item['id'] == row['id'] for item in excluded_listing['items'])
            for change in ({'project_id': str(projects[0]['id'])}, {'owning_brand_id': str(brand)}):
                with pytest.raises(asyncpg.InvalidParameterValueError):
                    await command(db, ids['editor'], 'update', changed, **change)
            with pytest.raises(asyncpg.InvalidParameterValueError):
                await command(db, ids['editor'], 'update', changed, excluded_project_ids=[str(projects[0]['id'])] * 2)
            row = await command(db, ids['publisher'], 'review', changed, review_type='DATA', decision='APPROVED',
                                evidence='Synthetic', change_reason='Synthetic', expected_scope_hash=changed['scope']['scope_hash'])
            row = await command(db, ids['publisher'], 'review', row, review_type='LEGAL', decision='APPROVED',
                                evidence='Synthetic', change_reason='Synthetic', expected_scope_hash=row['scope']['scope_hash'])
            assert not any(item['field'] == 'review_scope' for item in row['readiness']['missing'])
            await db.execute('update hub.projects set brand_id=null where id=$1', projects[0]['id'])
            stale = await call(db, ids['publisher'], 'select hub.promotion_read($1)', UUID(row['id']))
            assert any(item['field'] == 'review_scope' for item in stale['readiness']['missing'])
            assert stale['review_history'] == row['review_history']
            assert stale['draft_revision'] == row['draft_revision']
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


def test_contextual_permission_function_grants_are_closed_by_default(permission_accounts):
    async def check():
        db = await disposable_operator()
        try:
            private = ['promotion_owner_guard()', 'promotion_scope_projects(uuid,uuid,jsonb,uuid[])',
                       'validate_promotion_scope(uuid,uuid,jsonb,uuid[])', 'promotion_scope_snapshot(uuid)',
                       'promotion_scope_access(uuid,text)', 'promotion_scope_visible(uuid)',
                       'workspace_promotion_rows(text,text,text)']
            entries = ['promotion_resolve(jsonb)', 'workspace_promotions(text,text,text,text,integer,integer,uuid)',
                       'workspace_promotion_suggestions(text,text,text,integer,integer,uuid,text)']
            for signature in private + entries:
                name = 'hub.' + signature
                row = await db.fetchrow('select proconfig,prosecdef,proacl,proowner from pg_proc where oid=$1::regprocedure', name)
                assert 'search_path=pg_catalog, pg_temp' in row['proconfig']
                assert row['prosecdef'] is (signature != 'promotion_owner_guard()')
                assert not await db.fetchval("select exists(select 1 from pg_proc,aclexplode(coalesce(proacl,acldefault('f',proowner))) a where oid=$1::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')", name)
                for role in ('hub_app', 'hub_runtime', 'editor', 'publisher', 'viewer', 'admin', 'online_staff', 'agency', 'service_consumer'):
                    granted = await db.fetchval("select has_function_privilege($1,$2,'execute')", role, name)
                    assert granted == (role == 'hub_app' and signature in entries), (role, name)
        finally:
            await db.close()
    asyncio.run(check())


def test_scope_resolution_runtime_denial_and_allowed_neighbour(permission_accounts):
    client, ids = permission_accounts
    project = asyncio.run(_project_id())
    body = {'project_id': str(project)}
    path = '/v1/admin/promotions/resolve'
    assert client.post(path, headers=h('viewer'), json=body).status_code == 200
    asyncio.run(set_bit(ids['viewer'], 'promotions', can_view=False))
    assert client.post(path, headers=h('viewer'), json=body).status_code == 403
    assert client.get('/v1/admin/projects', headers=h('viewer')).status_code == 200

    async def direct():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        try:
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.promotion_resolve($1)', body)
            assert await call(db, ids['editor'], 'select hub.promotion_resolve($1)', body)
            for signature in ('hub.promotion_scope_snapshot($1::uuid)', "hub.promotion_scope_access($1::uuid,'view')"):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['editor'], 'select ' + signature, project)
        finally:
            await db.close()
    asyncio.run(direct())
    asyncio.run(set_bit(ids['viewer'], 'promotions', can_view=True))
    asyncio.run(set_bit(ids['viewer'], 'projects', can_view=False))
    assert client.post(path, headers=h('viewer'), json=body).status_code == 403
    assert client.get('/v1/admin/brands', headers=h('viewer')).status_code == 200


async def _project_id():
    db = await disposable_operator()
    try:
        return await db.fetchval('select id from hub.projects where deleted_at is null order by id limit 1')
    finally:
        await db.close()


@pytest.mark.parametrize('query', ['limit=101', 'offset=-1', 'filter=secret', 'item=invalid',
                                   'phase=a&phase=b', 'include_private=1'])
def test_contextual_query_rejects_unknown_or_ambiguous_filters(permission_accounts, query):
    client, _ = permission_accounts
    assert client.get('/v1/admin/content/workspace/project/any/promotions?' + query, headers=h('viewer')).status_code == 422


def test_suggestions_are_text_only_scoped_and_audited_on_create(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            project = await project_fixture(db, ids['editor'])
            other = await project_fixture(db, ids['editor'])
            batch = uuid4().hex * 2
            await db.execute("insert into staging.knowledge_batches(manifest_sha256,manifest) values($1,'{}')", batch)
            website, km = uuid4(), uuid4()
            for candidate, evidence in ((website, {
                'source_kind': 'sena_public_website', 'website_item_kind': 'promotion_terms',
                'website_value': {'heading': 'Synthetic website promotion', 'text': 'Offer 99000 until 2030-12-31', 'locator': '/not-projected'},
                'website_source': {'page_url': 'https://www.sena.co.th/synthetic/', 'fetched_at': '2026-11-05T09:00:00+07:00'},
                'benefit_value': '99000', 'valid_to': '2030-12-31', 'private_path': '/excluded/file',
            }), (km, {'title': 'Synthetic legacy offer', 'benefit': '99000', 'conditions': 'Until 2030-12-31',
                      'valid_to': '2030-12-31', 'verbatim_numeric_text': 'Never a typed amount', 'as_of': None})):
                await db.execute("""insert into staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,topic,source_url,source_ref,evidence)
                    values($1::uuid,$2,$1::uuid::text,'promotion',$3,'commercial_terms','https://www.sena.co.th/synthetic/','Synthetic source',$4)""",
                                 candidate, batch, [project['rem_project_id']], evidence)
            await db.execute("insert into staging.knowledge_followup_batches(manifest_sha256,manifest) values($1,'{}')", batch)
            await db.execute("""insert into staging.knowledge_promotion_annotations(candidate_id,batch_sha256,cluster_id,category,phash,cluster_size,ocr_end_date,likely_expired,date_unknown)
                values($1,$2,'synthetic','text_not_promotion','0000000000000000',1,'2010-01-01',true,false)""", km, batch)
            listing = await call(db, ids['editor'], 'select hub.workspace_promotion_suggestions($1,$2)', 'project', project['public_project_id'])
            assert listing['total'] == 2
            web = next(item for item in listing['items'] if item['source'] == 'website')
            old = next(item for item in listing['items'] if item['source'] == 'km')
            assert web['captured_at'] == '2026-11-05T09:00:00+07:00' and old['captured_at'] is None
            assert old['flags'] == {'likely_expired': True, 'undated': False, 'not_a_promotion': True}
            assert set(web['text']) == set(old['text']) == {'title', 'summary', 'conditions_public'}
            assert web['text']['summary'] == 'Offer 99000 until 2030-12-31'
            assert web['text']['title'] == 'Synthetic website promotion'
            assert not any(key in json.dumps(listing) for key in ('private_path', 'benefit_value', 'valid_to', 'verbatim_numeric_text'))
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['editor'], 'select hub.workspace_promotion_suggestions($1,$2,null,1,0,$3,$4)',
                           'project', other['public_project_id'], website, 'website')
            suggestion = {'kind': 'project', 'ref': project['public_project_id'], 'candidate_id': str(website), 'source': 'website'}
            row = await command(db, ids['editor'], 'create', **draft(project['id'], suggestion=suggestion))
            assert row['project_id'] == str(project['id'])
            assert await db.fetchval("select count(*) from audit.change_log where table_name='hub.public_promotions' and reason like $1", '%' + str(website) + '%') == 1
            with pytest.raises(asyncpg.CheckViolationError):
                await command(db, ids['editor'], 'create', **draft(other['id'], suggestion=suggestion))
            await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false where account_id=$1 and tab='knowledge'", ids['editor'])
            limited = await call(db, ids['editor'], 'select hub.workspace_promotion_suggestions($1,$2)', 'project', project['public_project_id'])
            assert [item['id'] for item in limited['items']] == [str(website)]
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], 'select hub.workspace_promotion_suggestions($1,$2,null,1,0,$3,$4)',
                           'project', project['public_project_id'], km, 'km')
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())
