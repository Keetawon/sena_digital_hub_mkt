"""Shared routes and projections obey table authority under the real runtime."""
import asyncio
import json
from datetime import timedelta
from uuid import uuid4

import asyncpg
import pytest
from fastapi.routing import APIRoute

from sena_hub_api.content_permissions import CONTENT_RULES, SHARED_RULES, route_class
from test_permission_baseline import disposable_operator
from test_permission_content import call, set_bit
from test_permission_db_baseline import runtime
from test_permission_foundations import permission_accounts, h


async def clear_tabs(actor, *, manager=False):
    db = await disposable_operator()
    try:
        async with db.transaction():
            await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false,special_actions='{}' where account_id=$1", actor)
            if manager:
                await db.execute('update hub.user_account set can_manage_users=true where id=$1', actor)
    finally:
        await db.close()


def test_every_api_route_has_exact_capability_or_shared_classification(permission_accounts):
    client, _ = permission_accounts
    actual = {(method, r.path) for r in client.app.routes if isinstance(r, APIRoute) for method in r.methods}
    shared = {key for key, value in SHARED_RULES.items() if value != 'unavailable'}
    assert not CONTENT_RULES.keys() & SHARED_RULES.keys()
    assert actual == CONTENT_RULES.keys() | shared
    assert set(SHARED_RULES.values()) <= {'own_account', 'accounts', 'internal', 'assistant', 'public', 'environment', 'health', 'unavailable', 'content_registry', 'content_translation', 'content_workspace'}
    assert {key for key, value in SHARED_RULES.items() if value == 'content_workspace'} == {
        ('GET', '/v1/admin/content/search'), ('GET', '/v1/admin/content/home')}
    assert {key for key, value in SHARED_RULES.items() if value == 'content_registry'} == {('GET', '/v1/admin/content/fields')}
    assert {key for key, value in SHARED_RULES.items() if value == 'content_translation'} == {
        ('POST', '/v1/admin/content/translations/{translation_id}/review'), ('POST', '/v1/admin/content/translations/{translation_id}/retry')}
    for key in actual:
        assert route_class(*key) == ('capability' if key in CONTENT_RULES else SHARED_RULES[key])
    # Prefixes must never silently authorize a newly added endpoint.
    for method, path in [('GET', '/v1/admin/projects/new-unmapped-route'), ('POST', '/v1/admin/accounts'),
                         ('GET', '/v1/new-public-feed'), ('POST', '/v1/admin/questions')]:
        assert route_class(method, path) is None


def test_questions_view_off_denies_http_and_sql_without_losing_other_views(permission_accounts):
    client, ids = permission_accounts
    response = client.get('/v1/admin/questions', headers=h('viewer'))
    assert response.status_code == 200 and response.json()['data']['questions']
    asyncio.run(set_bit(ids['viewer'], 'questions', can_view=False))
    assert client.get('/v1/admin/questions', headers=h('viewer')).status_code == 403
    assert client.get('/v1/admin/brands', headers=h('viewer')).status_code == 200
    assert client.get('/v1/me', headers=h('viewer')).json()['data']['status'] == 'ACTIVE'
    async def check():
        db = await runtime()
        try:
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], "select hub.require_permission('questions','view')")
            assert await call(db, ids['viewer'], "select hub.can('brands','view')")
        finally:
            await db.close()
    asyncio.run(check())


def test_manage_users_flag_without_data_boxes_is_independent_of_legacy_role(permission_accounts):
    client, ids = permission_accounts
    asyncio.run(clear_tabs(ids['viewer'], manager=True))
    me = client.get('/v1/me', headers=h('viewer')).json()['data']
    assert me['role'] == 'viewer' and me['capabilities']['can_manage_users'] is True
    assert not any(enabled for levels in me['capabilities']['tabs'].values() for enabled in levels.values())
    directory = client.get('/v1/admin/accounts', headers=h('viewer'))
    assert directory.status_code == 200
    data = directory.json()['data']
    assert data['actor_id'] == str(ids['viewer'])
    target = next(row for row in data['items'] if row['id'] == str(ids['publisher']))
    decision = client.post(f'/v1/admin/accounts/{ids["publisher"]}/decision', headers=h('viewer'),
        json={'action': 'suspend', 'note': 'Synthetic manager-only decision', 'updated_at': target['updated_at']})
    assert decision.status_code == 200
    assert client.get('/v1/me', headers=h('publisher')).json()['data']['status'] == 'SUSPENDED'
    assert client.get('/v1/admin/permissions/catalog', headers=h('viewer')).status_code == 200
    for path in ('projects', 'brands', 'questions', 'ads/memos', 'ads/finance-references', 'ads/registrations'):
        assert client.get('/v1/admin/' + path, headers=h('viewer')).status_code == 403, path
    async def check():
        db = await runtime()
        try:
            directory = json.loads(await call(db, ids['viewer'], 'select hub.account_directory()'))
            assert directory['actor_id'] == str(ids['viewer'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.list_brands()')
            # Management uses a bounded definer, never raw private table grants.
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select * from hub.user_account_event')
        finally:
            await db.close()
    asyncio.run(check())


def test_finance_reference_projection_works_without_registry_and_denies_without_finance(permission_accounts):
    client, ids = permission_accounts
    asyncio.run(set_bit(ids['online_staff'], 'registry', can_edit=False, can_view=False))
    response = client.get('/v1/admin/ads/finance-references', headers=h('online_staff'))
    assert response.status_code == 200
    data = response.json()['data']
    assert set(data) == {'vocab', 'scopes'}
    assert data['vocab'] and data['scopes']
    assert all(set(row) == {'vocab_type', 'code', 'label_th', 'can_use'} and row['can_use'] is True for row in data['vocab'])
    assert all(set(row) == {'scope_id', 'scope_code', 'label_th', 'can_use'} and row['can_use'] is True for row in data['scopes'])
    assert client.get('/v1/admin/ads/vocab', headers=h('online_staff')).status_code == 403
    assert client.get('/v1/admin/ads/scopes?kind=A', headers=h('online_staff')).status_code == 403
    assert client.get('/v1/admin/ads/memos', headers=h('online_staff')).status_code == 200
    async def check():
        db = await runtime()
        try:
            assert json.loads(await call(db, ids['online_staff'], 'select hub.finance_references()')) == data
            assert await call(db, ids['online_staff'], 'select count(*) from ads.vocab') == 0
            await set_bit(ids['online_staff'], 'finance', can_edit=False, can_approve=False, can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['online_staff'], 'select hub.finance_references()')
        finally:
            await db.close()
    asyncio.run(check())
    assert client.get('/v1/admin/ads/finance-references', headers=h('online_staff')).status_code == 403


def test_account_and_finance_references_only_offer_canonical_current_vocab(permission_accounts):
    client, ids = permission_accounts
    prefix = 'SHARED-' + uuid4().hex[:8].upper()
    states = ('TODAY', 'OPEN', 'INACTIVE', 'PROPOSED', 'ALIAS', 'FUTURE', 'EXPIRED')
    codes = {state: f'{prefix}-{state}' for state in states}

    async def fixtures():
        db = await disposable_operator()
        try:
            today = await db.fetchval("select (now() at time zone 'Asia/Bangkok')::date")
            async with db.transaction():
                for kind in ('AGENCY', 'BUD'):
                    for state, code in codes.items():
                        await db.execute("""insert into ads.vocab(vocab_type,code,label_th,label_en,status,
                            active_from,active_to,alias_of,source_reference) values($1,$2,'ทดสอบสิทธิ์','Synthetic reference',$3,$4,$5,$6,'synthetic-shared-permission-test')""",
                            kind, code, state if state in ('INACTIVE', 'PROPOSED') else 'ACTIVE',
                            today if state == 'TODAY' else today + timedelta(days=1) if state == 'FUTURE' else None,
                            today if state == 'TODAY' else today - timedelta(days=1) if state == 'EXPIRED' else None,
                            codes['TODAY'] if state == 'ALIAS' else None)
        finally:
            await db.close()

    # Vocabulary forbids deletion. Unique synthetic rows stay in this verified
    # disposable cluster until teardown; never bypass the business guard.
    asyncio.run(fixtures())
    asyncio.run(set_bit(ids['online_staff'], 'registry', can_edit=False, can_view=False))
    response = client.get('/v1/admin/ads/finance-references', headers=h('online_staff'))
    assert response.status_code == 200
    offered = {(row['vocab_type'], row['code']) for row in response.json()['data']['vocab'] if row['code'] in codes.values()}
    assert offered == {(kind, codes[state]) for kind in ('AGENCY', 'BUD') for state in ('TODAY', 'OPEN')}
    directory = client.get('/v1/admin/accounts', headers=h('admin'))
    assert directory.status_code == 200
    assert {row['code'] for row in directory.json()['data']['agencies'] if row['code'] in codes.values()} == {codes['TODAY'], codes['OPEN']}


@pytest.mark.parametrize('role', ['viewer', 'editor', 'publisher', 'admin', 'online_staff', 'service_consumer'])
def test_active_internal_and_existing_consumer_keep_public_payloads_with_no_boxes(permission_accounts, role):
    client, ids = permission_accounts
    public = client.get('/v1/brands', headers=h('service_consumer'))
    assert public.status_code == 200 and public.json()['data']
    asyncio.run(clear_tabs(ids[role]))
    response = client.get('/v1/brands', headers=h(role))
    assert response.status_code == 200 and response.json()['data'] == public.json()['data']
    for path in ('/v1/projects', '/v1/promotions'):
        assert client.get(path, headers=h(role)).status_code == 200
    assert client.get('/v1/admin/brands', headers=h(role)).status_code == 403
    async def check():
        db = await runtime()
        try:
            await call(db, ids[role], 'select hub.require_public_reader()')
            assert await call(db, ids[role], 'select count(*) from public_api.read_brands()') > 0
        finally:
            await db.close()
        operator = await disposable_operator()
        try:
            await operator.execute("update hub.user_account set status='SUSPENDED' where id=$1", ids[role])
        finally:
            await operator.close()
        db = await runtime()
        try:
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids[role], 'select hub.require_public_reader()')
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids[role], 'select count(*) from public_api.read_brands()')
        finally:
            await db.close()
    asyncio.run(check())
    assert client.get('/v1/brands', headers=h(role)).status_code == 403


@pytest.mark.parametrize('role', ['agency', 'pending'])
def test_public_boundary_does_not_expand_to_external_or_pending_accounts(permission_accounts, role):
    client, ids = permission_accounts
    for path in ('/v1/brands', '/v1/projects', '/v1/promotions'):
        assert client.get(path, headers=h(role)).status_code == 403
    async def check():
        db = await runtime()
        try:
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids[role], 'select count(*) from public_api.read_brands()')
        finally:
            await db.close()
    asyncio.run(check())


def test_hidden_brand_csv_cannot_export_while_projects_remain_visible(permission_accounts):
    client, ids = permission_accounts
    path = '/v1/admin/brands/completeness.csv?status=all'
    assert client.get(path, headers=h('viewer')).status_code == 200
    asyncio.run(set_bit(ids['viewer'], 'brands', can_view=False))
    denied = client.get(path, headers=h('viewer'))
    assert denied.status_code == 403 and 'text/csv' not in denied.headers['content-type']
    assert client.get('/v1/admin/projects', headers=h('viewer')).status_code == 200


def test_runtime_has_only_base_role_and_cannot_read_technical_exports(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db = await runtime()
        try:
            assumable = await db.fetch("select rolname from pg_roles where rolname<>session_user and pg_has_role(session_user,oid,'SET') order by rolname")
            assert [row['rolname'] for row in assumable] == ['hub_app']
            forbidden = ['admin', 'editor', 'publisher', 'viewer', 'online_staff', 'agency', 'service_consumer',
                         'ads_finance_writer', 'ads_actuals_writer', 'ads_registry_writer', 'ads_document_worker',
                         'ads_export_reader', 'ads_export_owner', 'hub_export_owner']
            for role in forbidden:
                assert not await db.fetchval("select pg_has_role(session_user,$1,'MEMBER')", role)
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    async with db.transaction():
                        await db.execute('SET LOCAL ROLE ' + role)
            await call(db, ids['admin'], "select hub.can('finance','view')")
            exports = await db.fetch("select n.nspname||'.'||c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('ads_export','hub_export') and c.relkind='v'")
            assert {'ads_export.memo', 'hub_export.brand_published'} <= {row['name'] for row in exports}
            for row in exports:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['admin'], 'select * from ' + row['name'] + ' limit 1')
        finally:
            await db.close()
    asyncio.run(check())


def test_new_functions_default_private_and_application_cannot_create_in_hub_schemas():
    async def check():
        db = await runtime()
        schemas = ['hub', 'ads', 'staging', 'audit', 'internal', 'rag', 'public_api', 'ads_export', 'hub_export']
        try:
            # Discover the actual migration/technical owners from their objects;
            # never impersonate them or create a function with operator powers.
            owners = await db.fetch("""select distinct r.oid,r.rolname from pg_roles r where r.oid in (
                select p.proowner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1)
                union select c.relowner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1)
                ) order by r.rolname""", schemas)
            names = {row['rolname'] for row in owners}
            assert {'ads_registry_writer', 'ads_finance_writer', 'ads_actuals_writer', 'ads_export_owner', 'hub_export_owner'} <= names
            migration_owner = await db.fetchval("select pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='hub' and c.relname='permission_catalog'")
            assert migration_owner in names
            for owner in owners:
                # No global ACL row means PostgreSQL's built-in PUBLIC EXECUTE
                # default, not a private function. A schema-only REVOKE is not enough.
                public_global = await db.fetchval("""select exists(select 1 from aclexplode(coalesce(
                    (select defaclacl from pg_default_acl where defaclrole=$1 and defaclnamespace=0 and defaclobjtype='f'),
                    acldefault('f',$1))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE')""", owner['oid'])
                assert not public_global, owner['rolname']
                public_schema = await db.fetchval("""select exists(select 1 from pg_default_acl d
                    join pg_namespace n on n.oid=d.defaclnamespace cross join lateral aclexplode(d.defaclacl) acl
                    where d.defaclrole=$1 and d.defaclobjtype='f' and n.nspname=any($2)
                    and acl.grantee=0 and acl.privilege_type='EXECUTE')""", owner['oid'], schemas)
                assert not public_schema, owner['rolname']
            for schema in schemas:
                assert not await db.fetchval("select has_schema_privilege('hub_app',$1,'CREATE')", schema), schema
        finally:
            await db.close()
    asyncio.run(check())
