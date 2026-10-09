"""Registry capabilities and mandatory external scope on real runtime SQL."""
import asyncio
from contextlib import asynccontextmanager
import json
from uuid import uuid4

import asyncpg
import pytest
from fastapi.routing import APIRoute

from sena_hub_api.content_permissions import CONTENT_RULES
from test_permission_baseline import disposable_operator
from test_permission_db_baseline import runtime, REGISTRY_TABLES, REGISTRY_FUNCTIONS
from test_permission_foundations import permission_accounts, h
from test_permission_content import set_bit


async def call(db, actor, query, *args, role='hub_app', agency='COMBAY'):
    assert role in ('hub_app', 'admin', 'online_staff', 'agency')
    async with db.transaction():
        await db.execute(f'SET LOCAL ROLE {role}')
        await db.execute("select set_config('app.actor_id',$1,true),set_config('app.agency_code',$2,true)", str(actor), agency)
        return await db.fetchval(query, *args)


@asynccontextmanager
async def rows(ids, invalid_agency=None):
    db = await disposable_operator()
    tx = db.transaction()
    await tx.start()
    try:
        scope = uuid4()
        token = 'C-TEST-' + scope.hex[:5].upper()
        await db.execute("select set_config('app.actor_id',$1,true)", str(ids['admin']))
        await db.execute("""insert into ads.scope_code(scope_id,scope_code,kind,label_th,label_en,member_signature,status)
            values($1,$2,'GROUP','โครงการทดสอบ','SYNTHETIC',ads.scope_signature($3::jsonb),'ACTIVE')""",
            scope, token, json.dumps([{'member_type': 'GROUP', 'member_id': token}]))
        await db.execute("insert into ads.scope_member(scope_id,member_type,member_id) values($1,'GROUP',$2)", scope, token)
        result = {}
        for agency in ('KIN', 'COMBAY'):
            value = await call(db, ids['admin'], "select ads.issue_registration($1,'LEADS',$2)", scope, agency)
            result[agency] = json.loads(value)
        if invalid_agency:
            # Rollback-only vocabulary mutations never affect another request.
            await db.execute('RESET ROLE')
            assignments = {'inactive': "status='INACTIVE'", 'alias': "alias_of='COMBAY'",
                           'future': "active_from=current_date+100", 'expired': "active_to=current_date-100"}
            await db.execute('update ads.vocab set ' + assignments[invalid_agency] + " where vocab_type='AGENCY' and code='KIN'")
        await db.execute('SET LOCAL SESSION AUTHORIZATION hub_runtime')
        assert tuple(await db.fetchrow('select rolsuper,rolbypassrls from pg_roles where rolname=session_user')) == (False, False)
        yield db, scope, result
    finally:
        await tx.rollback()
        await db.close()


def test_registry_route_coverage(permission_accounts):
    client, _ = permission_accounts
    # Finance also has registration children: exact registry handler module is
    # the reviewed boundary, not a broad /ads prefix.
    actual = {(method, route.path) for route in client.app.routes if isinstance(route, APIRoute)
              and route.endpoint.__module__ == 'sena_hub_api.ads' for method in route.methods}
    assert actual == {key for key, value in CONTENT_RULES.items() if value[0] == 'registry'}
    assert len(actual) == 10


@pytest.mark.parametrize('role', ['hub_app', 'admin', 'online_staff'])
def test_registry_view_off_denies_all_rows_and_read_helpers(permission_accounts, role):
    _, ids = permission_accounts
    async def check():
        async with rows(ids) as (db, scope, data):
            for table in REGISTRY_TABLES - {'ads.setting', 'ads.code_sequence', 'ads.native_binding'}:
                assert await call(db, ids['admin'], f'select count(*) from {table}', role=role) > 0
            await call(db, ids['admin'], 'select ads.registry_settings()', role=role)
            await set_bit(ids['admin'], 'registry', can_edit=False, can_view=False)
            for table in REGISTRY_TABLES - {'ads.setting', 'ads.code_sequence'}:
                assert await call(db, ids['admin'], f'select count(*) from {table}', role=role) == 0
            assert await call(db, ids['admin'], 'select ads.registration_detail($1)', data['KIN']['registration']['code'], role=role) is None
            for entry in ('ads.registry_settings()', 'ads.test_issuing_enabled()'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['admin'], 'select ' + entry, role=role)
            await call(db, ids['admin'], "select ads.finance_read('memos',null,'{}')", role='admin')
    asyncio.run(check())


@pytest.mark.parametrize('view_off', [False, True])
@pytest.mark.parametrize('entry', [
    "ads.preview_scope('ZONE',null,array[]::text[])",
    'ads.preview_existing_scope(null)', "ads.create_scope('ZONE',null,array[]::text[])",
    "ads.issue_registration(null,'LEADS','KIN')", "ads.add_variant('MISSING',null)",
    "ads.bind_native('MISSING',null,'META','0001','0002')",
])
def test_registry_each_mutation_requires_edit_and_view(permission_accounts, entry, view_off):
    _, ids = permission_accounts
    async def check():
        db = await runtime()
        try:
            # Positive permission reaches normal validation, not a policy error.
            with pytest.raises(asyncpg.PostgresError) as error:
                await call(db, ids['online_staff'], 'select ' + entry)
            assert error.value.sqlstate != '42501'
            await set_bit(ids['online_staff'], 'registry', can_edit=False)
            if view_off:
                await set_bit(ids['online_staff'], 'registry', can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['online_staff'], 'select ' + entry)
            if not view_off:
                await call(db, ids['online_staff'], 'select ads.registry_settings()')
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('role', ['hub_app', 'admin', 'online_staff', 'agency'])
def test_agency_scope_ignores_forged_role_and_agency_guc(permission_accounts, role):
    _, ids = permission_accounts
    async def check():
        async with rows(ids) as (db, scope, data):
            own, other = data['KIN'], data['COMBAY']
            assert await call(db, ids['agency'], 'select hub.registry_agency()', role=role, agency='COMBAY') == 'KIN'
            assert await call(db, ids['agency'], 'select ads.registration_detail($1)', other['registration']['code'], role=role) is None
            assert await call(db, ids['agency'], 'select ads.registration_detail($1)', own['registration']['code'], role=role)
            result = json.loads(await call(db, ids['agency'], "select ads.bind_native($1,$2,'META','000ACC','000ID')",
                own['registration']['code'], own['names'][0]['name_id'], role=role))
            assert result['method'] == 'AGENCY_RETURNED' and result['code'] == own['registration']['code']
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['agency'], "select ads.bind_native($1,$2,'META','000ACC','000OTHER')",
                    other['registration']['code'], other['names'][0]['name_id'], role=role)
            for entry in ("ads.issue_registration(null,'LEADS','KIN')", "ads.add_variant('MISSING',null)", "ads.create_scope('ZONE',null,array[]::text[])"):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['agency'], 'select ' + entry, role=role)
    asyncio.run(check())


@pytest.mark.parametrize('invalid', ['inactive', 'alias', 'future', 'expired'])
def test_agency_must_remain_active_canonical_and_date_valid(permission_accounts, invalid):
    _, ids = permission_accounts
    async def check():
        async with rows(ids, invalid) as (db, scope, data):
            assert await call(db, ids['agency'], 'select hub.registry_agency()') is None
            for table in REGISTRY_TABLES - {'ads.setting', 'ads.code_sequence'}:
                assert await call(db, ids['agency'], f'select count(*) from {table}') == 0
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['agency'], "select ads.bind_native($1,$2,'META','0001','0002')",
                    data['KIN']['registration']['code'], data['KIN']['names'][0]['name_id'])
    asyncio.run(check())


def test_registry_next_request_revocation_and_suspension(permission_accounts):
    client, ids = permission_accounts
    prefix = '/v1/admin/ads'
    assert client.get(prefix + '/registrations', headers=h('online_staff')).status_code == 200
    asyncio.run(set_bit(ids['online_staff'], 'registry', can_edit=False))
    assert client.get(prefix + '/registrations', headers=h('online_staff')).status_code == 200
    for path in ('/registrations', '/registrations/preview', '/registrations/MISSING/names', '/registrations/MISSING/bindings'):
        assert client.post(prefix + path, headers=h('online_staff'), json={}).status_code == 403
    asyncio.run(set_bit(ids['online_staff'], 'registry', can_view=False))
    for path in ('/settings', '/vocab', '/scopes', '/registrations', '/registrations/MISSING'):
        assert client.get(prefix + path, headers=h('online_staff')).status_code == 403
    assert client.post(prefix + '/names/validate', headers=h('online_staff'), json={}).status_code == 403
    assert client.get('/v1/me', headers=h('online_staff')).status_code == 200
    async def suspend():
        db = await disposable_operator()
        try:
            await db.execute("update hub.user_account set status='SUSPENDED' where id=$1", ids['agency'])
        finally:
            await db.close()
    assert client.get(prefix + '/registrations', headers=h('agency')).status_code == 200
    asyncio.run(suspend())
    assert client.get(prefix + '/registrations', headers=h('agency')).status_code == 403


def test_registry_acl_operator_boundary_and_closed_helpers(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db = await runtime()
        try:
            await db.execute('SET ROLE hub_app')
            for table in REGISTRY_TABLES:
                assert await db.fetchval('select relrowsecurity and relforcerowsecurity from pg_class where oid=$1::regclass', table)
                assert not await db.fetchval("select has_table_privilege('hub_app',$1,'INSERT,UPDATE,DELETE')", table)
            assert not await db.fetchval("select pg_has_role(session_user,'ads_registry_writer','MEMBER')")
            for role in ('hub_app', 'admin', 'online_staff', 'agency'):
                for entry in ("ads.cancel_registration('MISSING','Synthetic')", "ads.set_approval(true,'Synthetic','Synthetic')"):
                    with pytest.raises(asyncpg.InsufficientPrivilegeError):
                        await call(db, ids['admin'], 'select ' + entry, role=role)
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['admin'], "update ads.vocab set label_en='FORGED'", role=role)
            for name in REGISTRY_FUNCTIONS:
                row = await db.fetchrow("select p.oid,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=$1", name)
                assert 'search_path=pg_catalog, pg_temp' in row['proconfig']
                assert not await db.fetchval("select exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=$1 and a.grantee=0)", row['oid'])
            for actor in ('', 'invalid', str(uuid4()), str(ids['pending'])):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, actor, 'select ads.registry_settings()')
        finally:
            await db.close()
    asyncio.run(check())
