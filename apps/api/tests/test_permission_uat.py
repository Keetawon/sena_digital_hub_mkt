"""Synthetic UAT identities remain optional, local, and table-authorized."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import secrets
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from sena_hub_api.auth import ALL_DEMO_ACTORS, DEMO_ROLES, LOCAL_UAT_ACTORS, Settings
from sena_hub_api.main import create_app
from test_permission_baseline import ROOT, disposable_operator
from test_permission_db_baseline import runtime

spec = importlib.util.spec_from_file_location('permission_uat_seed',ROOT/'scripts/seed-permissions-uat.py')
seed_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed_module)


def tokens():
    return {name:secrets.token_hex(32) for name in (*DEMO_ROLES,*LOCAL_UAT_ACTORS)}


def settings(values=None, **changes):
    return Settings(**{'database_url':os.environ['HUB_TEST_DATABASE_URL'],'auth_mode':'demo',
        'environment':'local','demo_tokens':values if values is not None else tokens(),**changes})


def operator(sql,*args):
    async def run():
        db = await disposable_operator()
        try:
            return await db.fetch(sql,*args)
        finally:
            await db.close()
    return asyncio.run(run())


@pytest.fixture
def uat():
    async def initialize():
        db = await disposable_operator()
        try:
            before = await db.fetch('select id,to_jsonb(a)::text value from hub.user_account a order by id')
            events = await db.fetch('select id,to_jsonb(e)::text value from hub.user_account_event e order by id')
            permission_events = await db.fetch('select id,to_jsonb(e)::text value from hub.permission_event e order by id')
            acks = await db.fetch('select to_jsonb(a)::text value from hub.permission_notice_ack a order by actor_id,tab')
            await seed_module.seed(db)
            return before,events,permission_events,acks
        finally:
            await db.close()
    before,events,permission_events,acks = asyncio.run(initialize())
    values = tokens()
    headers = lambda persona:{'Authorization':'Bearer '+values[persona]}
    try:
        with TestClient(create_app(settings(values)),client=('127.0.0.1',50000)) as client:
            yield client,headers
    finally:
        async def cleanup():
            db = await disposable_operator()
            try:
                await seed_module.cleanup_disposable(db)
                assert await db.fetch('select id,to_jsonb(a)::text value from hub.user_account a order by id') == before
                assert await db.fetch('select id,to_jsonb(e)::text value from hub.user_account_event e order by id') == events
                assert await db.fetch('select id,to_jsonb(e)::text value from hub.permission_event e order by id') == permission_events
                assert await db.fetch('select to_jsonb(a)::text value from hub.permission_notice_ack a order by actor_id,tab') == acks
            finally:
                await db.close()
        asyncio.run(cleanup())


def account(client,headers,persona):
    response = client.get('/v1/me',headers=headers(persona))
    assert response.status_code == 200,response.text
    return response.json()['data']


def test_uat_seed_exact_profiles_and_real_runtime_permissions(uat):
    client,headers = uat
    assert len(ALL_DEMO_ACTORS) == len(DEMO_ROLES) == 8
    assert [uid.int for uid in ALL_DEMO_ACTORS.values()] == list(range(1,9))
    admin = account(client,headers,'uat_admin')
    somchai = account(client,headers,'uat_somchai')
    suspended = account(client,headers,'uat_suspended')
    assert admin['id'] == str(LOCAL_UAT_ACTORS['uat_admin']) and admin['can_manage_users']
    assert admin['capabilities']['template'] == 'admin' and admin['capabilities']['template_version'] == 1
    assert somchai['display_name_th'] == 'สมชาย ทดสอบ' and not somchai['can_manage_users']
    assert somchai['capabilities']['template'] == 'editor' and somchai['capabilities']['template_version'] == 1
    assert somchai['capabilities']['customised']
    actual = {tab:{level for level,allowed in levels.items() if allowed}
              for tab,levels in somchai['capabilities']['tabs'].items() if any(levels.values())}
    assert actual == {tab:set(levels) for tab,levels in seed_module.SOMCHAI_TABS.items()}
    assert suspended['status'] == 'SUSPENDED' and not suspended['capabilities']['can_manage_users']
    assert client.get('/v1/admin/accounts',headers=headers('uat_admin')).status_code == 200
    assert client.get('/v1/admin/accounts',headers=headers('uat_somchai')).status_code == 403
    assert client.get('/v1/projects',headers=headers('uat_suspended')).status_code == 403
    assert client.get('/v1/admin/projects',headers=headers('uat_suspended')).status_code == 403

    async def sql_check():
        db = await runtime()
        try:
            async with db.transaction():
                await db.execute('SET LOCAL ROLE hub_app')
                await db.execute("select set_config('app.actor_id',$1,true)",str(LOCAL_UAT_ACTORS['uat_somchai']))
                for tab,level,allowed in [('projects','edit',True),('brands','edit',False),('finance','edit',True),
                                         ('finance','approve',False),('archive','view',False),('actuals','view',False)]:
                    assert await db.fetchval('select hub.can($1,$2)',tab,level) is allowed
        finally:
            await db.close()
    asyncio.run(sql_check())


def test_uat_seed_replay_preserves_changed_grid_suspension_and_ack(uat):
    client,headers = uat
    target = account(client,headers,'uat_somchai')
    path = f'/v1/admin/accounts/{target["id"]}'
    changed = client.post(path+'/permissions',headers=headers('uat_admin'),json={
        'updated_at':target['updated_at'],'tabs':{'projects':['view']}})
    assert changed.status_code == 200,changed.text
    updated = account(client,headers,'uat_somchai')
    assert client.post(path+'/decision',headers=headers('uat_admin'),json={
        'action':'suspend','updated_at':updated['updated_at'],'note':'ระงับบัญชี UAT สมมติ'}).status_code == 200
    catalog = client.get('/v1/admin/permissions/catalog',headers=headers('uat_admin')).json()['data']
    actuals = next(row for row in catalog['tabs'] if row['tab']=='actuals')
    assert actuals['new_for_actor'] and actuals['guards_ready'] and actuals['rollout_state']=='MIGRATED'
    assert client.post('/v1/admin/permissions/notices/actuals/ack',headers=headers('uat_admin'),
        json={'catalog_digest':catalog['catalog_digest']}).status_code == 200
    snapshot = account(client,headers,'uat_somchai')
    async def replay():
        db = await disposable_operator()
        try:
            before = await db.fetch('select id,to_jsonb(e)::text value from hub.permission_event e order by id')
            result = await seed_module.seed(db)
            assert result['inserted'] == 0 and result['preserved'] == 3
            assert await db.fetch('select id,to_jsonb(e)::text value from hub.permission_event e order by id') == before
        finally:
            await db.close()
    asyncio.run(replay())
    assert account(client,headers,'uat_somchai') == snapshot
    catalog = client.get('/v1/admin/permissions/catalog',headers=headers('uat_admin')).json()['data']
    assert not next(row for row in catalog['tabs'] if row['tab']=='actuals')['new_for_actor']


def test_uat_admin_label_does_not_override_revoked_manager_flag(uat):
    client,headers = uat
    target = account(client,headers,'uat_admin')
    result = client.post(f'/v1/admin/accounts/{target["id"]}/permissions',headers=headers('admin'),
        json={'updated_at':target['updated_at'],'can_manage_users':False})
    assert result.status_code == 200,result.text
    assert account(client,headers,'uat_admin')['role'] == 'admin'
    assert client.get('/v1/admin/accounts',headers=headers('uat_admin')).status_code == 403


@pytest.mark.parametrize('collision',['id','email'])
def test_uat_seed_collision_rolls_back_every_new_identity(collision):
    async def run():
        db = await disposable_operator()
        transaction = db.transaction()
        await transaction.start()
        try:
            uid = LOCAL_UAT_ACTORS['uat_somchai'] if collision=='id' else uuid4()
            email = 'different-synthetic@example.test' if collision=='id' else 'uat-somchai@example.test'
            await db.execute('insert into hub.user_account(id,email) values($1,$2)',uid,email)
            before = await db.fetch('select to_jsonb(a)::text value from hub.user_account a order by id')
            with pytest.raises(ValueError,match='UAT_IDENTITY_CONFLICT'):
                await seed_module.seed(db)
            assert await db.fetch('select to_jsonb(a)::text value from hub.user_account a order by id') == before
            assert not await db.fetchval('select exists(select 1 from public.local_migrations where name=$1)',seed_module.MARKER)
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(run())


@pytest.mark.parametrize('invalid',['missing','short','duplicate','base_duplicate','non_ascii'])
def test_uat_optional_token_group_rejects_invalid_values(invalid):
    values = tokens()
    if invalid=='missing':
        del values['uat_somchai']
    elif invalid=='short':
        values['uat_admin'] = secrets.token_hex(4)
    elif invalid=='duplicate':
        values['uat_somchai'] = values['uat_admin']
    elif invalid=='base_duplicate':
        values['uat_somchai'] = values['editor']
    else:
        values['uat_somchai'] = 'ท'*40
    with pytest.raises(ValueError):
        settings(values)
    assert settings({k:v for k,v in tokens().items() if k in DEMO_ROLES}).auth_mode == 'demo'


def test_uat_tokens_cannot_enable_supabase_or_remote_demo():
    with pytest.raises(ValueError):
        settings(auth_mode='supabase',environment='production',supabase_url='https://synthetic.example.invalid')
    with pytest.raises(ValueError):
        settings(environment='production')
    with TestClient(create_app(settings()),client=('192.0.2.1',50000)) as client:
        assert client.get('/v1/me').status_code == 403


def test_uat_target_guard_refuses_working_mode_for_disposable_database():
    async def run():
        db = await disposable_operator()
        try:
            await seed_module.verify_target(db,disposable=True)
            with pytest.raises(ValueError,match='UAT_WORKING_TARGET_REQUIRED'):
                await seed_module.verify_target(db,disposable=False)
        finally:
            await db.close()
    asyncio.run(run())


def test_uat_working_cleanup_and_hosted_mode_fail_before_connection(monkeypatch):
    async def forbidden(**_):
        pytest.fail('No database connection is allowed for rejected UAT mode')
    monkeypatch.setattr(seed_module.asyncpg,'connect',forbidden)
    with pytest.raises(ValueError,match='UAT_CLEANUP_DISPOSABLE_ONLY'):
        asyncio.run(seed_module.run(SimpleNamespace(cleanup=True,disposable=False)))
    monkeypatch.setenv('HUB_ENV','hosted-test')
    with pytest.raises(ValueError,match='UAT_LOCAL_MODE_REQUIRED'):
        asyncio.run(seed_module.run(SimpleNamespace(cleanup=False,disposable=False)))


def test_uat_backup_uses_fixed_local_target_and_keeps_secret_out_of_arguments(monkeypatch,tmp_path):
    monkeypatch.setattr(seed_module,'ROOT',tmp_path)
    password = secrets.token_hex(32)
    def dump(command,**options):
        assert password not in ' '.join(command)
        assert options['env']['PGPASSWORD'] == password
        assert '--host=127.0.0.1' in command and '--port=55432' in command
        assert '--dbname=sena_hub_local' in command and options['capture_output']
        output = Path(next(value[7:] for value in command if value.startswith('--file=')))
        output.write_bytes(b'PGDMP'+b'0'*1024)
    monkeypatch.setattr(seed_module.subprocess,'run',dump)
    path = seed_module.working_backup(password)
    assert path.is_relative_to(tmp_path/'.local/backups')
