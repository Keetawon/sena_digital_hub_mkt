"""Real runtime/SQL and HTTP foundations. Fixtures never use the working cluster."""
import asyncio
import json
import os
from uuid import uuid4

import asyncpg
import pytest
from fastapi.testclient import TestClient

from sena_hub_api.auth import Authentication, Settings
from sena_hub_api.main import create_app
from test_permission_baseline import disposable_operator
from test_permission_db_baseline import runtime, FOUNDATION_TABLES, FOUNDATION_FUNCTIONS


@pytest.fixture
def permission_accounts(monkeypatch):
    roles = ['admin', 'second', 'viewer', 'editor', 'publisher', 'online_staff', 'agency', 'service_consumer', 'pending']
    ids = {role: uuid4() for role in roles}

    async def seed(remove=False):
        db = await disposable_operator()
        try:
            if remove:
                await db.execute('delete from hub.user_account where id=any($1::uuid[])', list(ids.values()))
            else:
                for role, uid in ids.items():
                    await db.execute("insert into hub.user_account(id,email,status,hub_role,agency_code) values($1,$2,$3,$4,$5)",
                        uid, f'{uid}@example.test', 'PENDING' if role == 'pending' else 'ACTIVE',
                        None if role == 'pending' else 'admin' if role == 'second' else role, 'KIN' if role == 'agency' else None)
        finally:
            await db.close()
    asyncio.run(seed())

    def verify(_self, token):
        return {'sub': str(ids[token]), 'email': f'{ids[token]}@example.test',
                'app_metadata': {'hub_role': 'admin', 'can_manage_users': True},
                'user_metadata': {'permissions': {'finance': ['view', 'edit', 'approve']}}}
    monkeypatch.setattr(Authentication, 'verify_jwt', verify)
    settings = Settings(database_url=os.environ['HUB_TEST_DATABASE_URL'], auth_mode='supabase',
                        environment='local', supabase_url='https://auth.example.invalid')
    try:
        with TestClient(create_app(settings), client=('127.0.0.1', 50000)) as client:
            yield client, ids
    finally:
        asyncio.run(seed(remove=True))


def h(role):
    return {'Authorization': f'Bearer {role}'}


def me(client, role):
    response = client.get('/v1/me', headers=h(role))
    assert response.status_code == 200
    return response.json()['data']


async def sql_as(db, uid, role, sql, *args):
    assert role in ('viewer', 'editor', 'publisher', 'admin', 'online_staff', 'agency', 'service_consumer')
    async with db.transaction():
        await db.execute(f'SET LOCAL ROLE {role}')
        await db.execute("select set_config('app.actor_id',$1,true)", str(uid))
        return await db.fetchval(sql, *args)


@pytest.mark.parametrize('role', ['viewer', 'editor', 'publisher', 'admin', 'online_staff', 'agency', 'service_consumer', 'pending'])
def test_permission_foundation_template_projection_and_real_sql_agree(permission_accounts, role):
    client, ids = permission_accounts
    account = me(client, role)
    caps = account['capabilities']
    assert len(caps['tabs']) == 12 and caps['locked_tabs'] == []
    assert len(caps['special_actions']) == 5
    assert caps['special_actions']['knowledge.publish_web'] is False
    assert caps['special_actions']['projects.manage_field_catalog'] is False
    assert caps['can_manage_users'] == (role == 'admin')
    assert caps['published_consumer'] == (role not in ('agency', 'service_consumer', 'pending'))
    assert caps['agency_registry'] == (role == 'agency')
    assert 'legacy_hub_role' not in account
    async def check():
        db = await runtime(probe=True)
        try:
            db_role = 'viewer' if role == 'pending' else role
            if role == 'service_consumer':
                assert not any(v for levels in caps['tabs'].values() for v in levels.values())
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await sql_as(db, ids[role], db_role, "select hub.can('projects','view')")
                return
            for tab, levels in caps['tabs'].items():
                for level, value in levels.items():
                    assert await sql_as(db, ids[role], db_role, 'select hub.can($1,$2)', tab, level) is value
            for action, value in caps['special_actions'].items():
                assert await sql_as(db, ids[role], db_role, 'select hub.can_special($1,$2)', action.split('.')[0], action) is value
        finally:
            await db.close()
    asyncio.run(check())
    catalog = client.get('/v1/admin/permissions/catalog', headers=h('admin')).json()['data']
    template = next((t for t in catalog['templates'] if t['code'] == role), None)
    if template and role != 'agency':
        for tab, levels in caps['tabs'].items():
            assert {k for k, v in levels.items() if v} == set(template['tabs'].get(tab, [])) & {'view', 'edit', 'approve'}


@pytest.mark.parametrize('role', ['viewer', 'editor', 'publisher', 'online_staff', 'agency', 'service_consumer', 'pending'])
def test_permission_foundation_admin_endpoints_deny_forged_claims(permission_accounts, role):
    client, ids = permission_accounts
    assert client.get('/v1/admin/permissions/catalog', headers=h(role)).status_code == 403
    assert client.post(f'/v1/admin/accounts/{ids["viewer"]}/permissions', headers=h(role), json={}).status_code == 403


def test_permission_foundation_closed_storage_acl_and_definer_acl(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db = await runtime(probe=True)
        try:
            await db.execute('SET ROLE viewer')
            for table in sorted(FOUNDATION_TABLES):
                assert await db.fetchval("select relrowsecurity and relforcerowsecurity from pg_class where oid=$1::regclass", table)
                for role in ('viewer', 'editor', 'publisher', 'admin', 'online_staff', 'agency', 'service_consumer'):
                    for statement in [f'select * from {table}', f'delete from {table}', f'insert into {table} default values']:
                        with pytest.raises(asyncpg.InsufficientPrivilegeError):
                            await sql_as(db, ids['admin'], role, statement)
                policies = await db.fetch("select polroles from pg_policy where polrelid=$1::regclass", table)
                assert len(policies) == 1
                owner = await db.fetchval("select relowner from pg_class where oid=$1::regclass", table)
                assert list(policies[0]['polroles']) == [owner]
                assert not await db.fetchval("select pg_has_role(session_user,$1::oid,'MEMBER')", owner)
            for function in await db.fetch("select p.oid,n.nspname||'.'||p.proname name,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=any($1)", list(FOUNDATION_FUNCTIONS)):
                assert 'search_path=pg_catalog, pg_temp' in function['proconfig']
                # PUBLIC must not receive even helper execution through a default grant.
                assert not await db.fetchval("select exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where p.oid=$1 and acl.grantee=0 and privilege_type='EXECUTE')", function['oid'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await sql_as(db, ids['viewer'], 'viewer', 'select hub.permission_rows($1)', ids['admin'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await sql_as(db, ids['viewer'], 'admin', 'select hub.permission_catalog_read()')
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await sql_as(db, ids['viewer'], 'admin', "select hub.save_account_permissions($1,'{}',true,now())", ids['viewer'])
        finally:
            await db.close()
    asyncio.run(check())


def test_permission_foundation_missing_bad_actor_tab_level_and_agency_scope_deny(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db = await runtime(probe=True)
        try:
            for uid in ('', 'bad-uuid', uuid4()):
                assert await sql_as(db, uid, 'admin', "select hub.can('projects','view')") is False
                assert await sql_as(db, uid, 'admin', "select hub.can_special('brands','brands.manage_catalog')") is False
            for tab, level in [('typo','view'), ('projects','typo'), (None,'view'), ('releases','edit')]:
                assert await sql_as(db, ids['admin'], 'admin', 'select hub.can($1,$2)', tab, level) is False
            for agency, expected in [('KIN', True), ('COMBAY', False), ('kin', False), ('INVALID', False), (None, False)]:
                assert await sql_as(db, ids['agency'], 'agency', 'select hub.can_agency_registry($1)', agency) is expected
            assert await sql_as(db, ids['viewer'], 'admin', "select hub.can_agency_registry('KIN')") is False
        finally:
            await db.close()
    asyncio.run(check())


def test_permission_foundation_locked_grid_self_stale_and_flag_revocation(permission_accounts):
    client, ids = permission_accounts
    templates = client.get('/v1/admin/permissions/catalog', headers=h('admin')).json()['data']['templates']
    tabs = next(t['tabs'] for t in templates if t['code'] == 'admin')
    row = me(client, 'second')
    path = f'/v1/admin/accounts/{ids["second"]}/permissions'
    body = {'tabs': tabs, 'can_manage_users': False, 'updated_at': row['updated_at']}
    async def rollout(state):
        db = await disposable_operator()
        try:
            await db.execute("update hub.permission_catalog set rollout_state=$1 where tab='projects'", state)
        finally:
            await db.close()
    asyncio.run(rollout('LEGACY_LOCKED'))
    try:
        denied = client.post(path, headers=h('admin'), json={**body, 'tabs': {**tabs, 'projects': []}})
        assert denied.status_code == 403 and denied.json()['error']['code'] == 'permission_locked'
    finally:
        asyncio.run(rollout('MIGRATED'))
    assert client.post(f'/v1/admin/accounts/{ids["admin"]}/permissions', headers=h('admin'), json=body).status_code == 403
    assert client.post(path, headers=h('admin'), json=body).status_code == 200
    # Same session/JWT, next request: no accounts or catalog, data role unchanged.
    second = me(client, 'second')
    assert second['role'] == 'admin' and not second['can_manage_users']
    assert not second['capabilities']['can_manage_users']
    assert second['capabilities']['tabs']['finance']['edit']
    assert client.get('/v1/admin/accounts', headers=h('second')).status_code == 403
    assert client.get('/v1/admin/permissions/catalog', headers=h('second')).status_code == 403
    assert client.post(path, headers=h('admin'), json=body).status_code == 409
    async def check():
        db = await disposable_operator()
        runtime_db = await runtime(probe=True)
        try:
            event = await db.fetchrow("select before_value,after_value from hub.permission_event where account_id=$1 and action='PERMISSIONS'", ids['second'])
            assert json.loads(event['before_value'])['can_manage_users'] is True
            assert json.loads(event['after_value'])['can_manage_users'] is False
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await sql_as(runtime_db, ids['second'], 'admin', 'select hub.list_account_invites()')
        finally:
            await db.close()
            await runtime_db.close()
    asyncio.run(check())


@pytest.mark.parametrize('change', ['suspend', 'revoke', 'missing'])
def test_permission_foundation_next_request_reflects_status_and_permission_rows(permission_accounts, change):
    client, ids = permission_accounts
    assert me(client, 'editor')['capabilities']['tabs']['projects']['edit'] is True
    async def mutate():
        db = await disposable_operator()
        try:
            if change == 'suspend':
                await db.execute("update hub.user_account set status='SUSPENDED' where id=$1", ids['editor'])
            elif change == 'revoke':
                await db.execute("update hub.account_permission set can_edit=false where account_id=$1 and tab='projects'", ids['editor'])
            else:
                await db.execute("delete from hub.account_permission where account_id=$1 and tab='projects'", ids['editor'])
        finally:
            await db.close()
    asyncio.run(mutate())
    caps = me(client, 'editor')['capabilities']
    assert not caps['tabs']['projects']['edit']
    assert caps['tabs']['brands']['view'] == (change != 'suspend')
    if change == 'suspend':
        assert client.get('/v1/admin/projects', headers=h('editor')).status_code == 403
    # Tab rows are immutable to the app in Phase 1. This operator-only probe
    # verifies the helper/projection; domain paths migrate in subsequent phases.


@pytest.mark.parametrize('tab,changes', [
    ('projects', 'can_approve=true'), ('brands', 'can_approve=true'),
    ('promotions', 'can_approve=true'), ('releases', 'can_edit=true'),
    ('projects', 'can_view=false'), ('questions', 'can_edit=true'),
    ('brands', "special_actions='{archive.legal_hold}'"),
])
def test_permission_foundation_db_constraints_reject_invalid_boxes(permission_accounts, tab, changes):
    _, ids = permission_accounts
    async def check():
        db = await disposable_operator()
        try:
            with pytest.raises(asyncpg.CheckViolationError):
                await db.execute(f'update hub.account_permission set {changes} where account_id=$1 and tab=$2', ids['editor'], tab)
        finally:
            await db.close()
    asyncio.run(check())


def test_permission_foundation_locked_state_cannot_pretend_guards_exist(permission_accounts):
    async def check():
        db = await disposable_operator()
        try:
            await db.execute("update hub.permission_catalog set rollout_state='LEGACY_LOCKED',guards_ready=false where tab='projects'")
            for state in ('MIGRATED', 'DISABLED'):
                with pytest.raises(asyncpg.CheckViolationError):
                    await db.execute("update hub.permission_catalog set rollout_state=$1 where tab='projects'", state)
        finally:
            await db.execute("update hub.permission_catalog set rollout_state='MIGRATED',guards_ready=true where tab='projects'")
            await db.close()
    asyncio.run(check())


def test_permission_foundation_new_catalog_tab_defaults_to_nobody_and_template_copy_is_stable(permission_accounts):
    client, ids = permission_accounts
    before = me(client, 'editor')['capabilities']['tabs']
    async def check():
        db = await disposable_operator()
        caller = await runtime(probe=True)
        try:
            await db.execute("insert into hub.permission_catalog(tab,label_th,nav_group,levels,sensitivity) values('synthetic_probe','ทดสอบ','other','{view}','internal')")
            for role in ('admin', 'editor', 'viewer'):
                assert await sql_as(caller, ids[role], role, "select hub.can('synthetic_probe','view')") is False
            assert await db.fetchval('select permission_template_version from hub.user_account where id=$1', ids['editor']) == 1
            transaction = db.transaction()
            await transaction.start()
            try:
                await db.execute("insert into hub.permission_template(code,version,label_th,tabs) values('editor',2,'ทดสอบ','{}')")
                assert await db.fetchval('select permission_template_version from hub.user_account where id=$1', ids['editor']) == 1
            finally:
                await transaction.rollback()
        finally:
            await db.execute("delete from hub.permission_catalog where tab='synthetic_probe'")
            await db.close()
            await caller.close()
    asyncio.run(check())
    assert me(client, 'editor')['capabilities']['tabs'] == before


def test_permission_foundation_purge_anonymises_audit_and_removes_inert_grants(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db = await disposable_operator()
        try:
            await db.execute("update hub.user_account set status='REJECTED',decided_at=now()-interval '91 days' where id=$1", ids['editor'])
            assert await db.fetchval('select count(*) from hub.permission_event where account_id=$1', ids['editor']) > 0
            await db.execute('select hub.purge_rejected_accounts()')
            assert await db.fetchval('select count(*) from hub.permission_event where account_id=$1 or actor_id=$1', ids['editor']) == 0
            assert await db.fetchval('select count(*) from hub.account_permission where account_id=$1', ids['editor']) == 0
        finally:
            await db.close()
    asyncio.run(check())


def test_permission_foundation_concurrent_manager_removal_preserves_one(permission_accounts):
    _, ids = permission_accounts
    async def check():
        setup = await disposable_operator()
        old = []
        try:
            old = await setup.fetch("select id from hub.user_account where can_manage_users and id<>all($1::uuid[])", [ids['admin'], ids['second']])
            await setup.execute('update hub.user_account set can_manage_users=false where id=any($1::uuid[])', [r['id'] for r in old])
            versions = {r['id']: r['updated_at'] for r in await setup.fetch('select id,updated_at from hub.user_account where id=any($1::uuid[])', [ids['admin'], ids['second']])}
            tabs = await setup.fetchval("select tabs from hub.permission_template where code='admin' and version=1")
            async def remove(actor, target):
                db = await runtime(probe=True)
                try:
                    return await sql_as(db, actor, 'admin', 'select hub.save_account_permissions($1,$2::jsonb,false,$3)', target, tabs, versions[target])
                except asyncpg.InsufficientPrivilegeError:
                    return 'denied'
                finally:
                    await db.close()
            results = await asyncio.gather(remove(ids['admin'], ids['second']), remove(ids['second'], ids['admin']))
            assert results.count('denied') == 1
            assert await setup.fetchval("select count(*) from hub.user_account where status='ACTIVE' and can_manage_users") == 1
        finally:
            await setup.execute('update hub.user_account set can_manage_users=true where id=any($1::uuid[])', [r['id'] for r in old])
            await setup.close()
    asyncio.run(check())
