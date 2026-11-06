"""Phase C: saved grids, atomic approvals, pinned invitations and reviewed batches.

All reads/writes use disposable fixtures; authority probes use hub_runtime/hub_app.
"""
import asyncio
import json
from uuid import uuid4

import asyncpg
import pytest

from test_accounts import REQUEST
from test_permission_baseline import disposable_operator
from test_permission_db_baseline import runtime
from test_permission_foundations import permission_accounts, h, me


def operator(sql, *args):
    async def run():
        db = await disposable_operator()
        try:
            return await db.fetch(sql, *args)
        finally:
            await db.close()
    return asyncio.run(run())


def runtime_value(actor, sql, *args):
    async def run():
        db = await runtime()
        try:
            async with db.transaction():
                await db.execute('SET LOCAL ROLE hub_app')
                await db.execute("select set_config('app.actor_id',$1,true)", str(actor))
                return await db.fetchval(sql, *args)
        finally:
            await db.close()
    return asyncio.run(run())


def save(client, ids, target='editor', **changes):
    return client.post(f'/v1/admin/accounts/{ids[target]}/permissions', headers=h('admin'),
        json={'updated_at': me(client, target)['updated_at'], **changes})


def directory(client):
    response = client.get('/v1/admin/accounts', headers=h('admin'))
    assert response.status_code == 200, response.text
    return response.json()['data']


def test_permission_accounts_custom_grid_is_live_in_sql_and_next_http_request(permission_accounts):
    client, ids = permission_accounts
    response = save(client, ids, template={'code': 'editor', 'version': 1},
        tabs={'projects': ['view', 'edit'], 'brands': ['view'], 'finance': ['view', 'edit']}, note='บันทึกภายใน')
    assert response.status_code == 200, response.text
    access = response.json()['data']['access']
    assert access['customised'] and access['template'] == {'code': 'editor', 'version': 1}
    assert not access['can_manage_users']
    for tab, level, allowed in [('projects','edit',True), ('projects','approve',False),
        ('brands','edit',False), ('finance','edit',True), ('finance','approve',False), ('archive','view',False)]:
        assert runtime_value(ids['editor'], 'select hub.can($1,$2)', tab, level) is allowed
    account = me(client, 'editor')
    assert account['capabilities']['tabs']['finance']['edit']
    assert not account['capabilities']['tabs']['archive']['view']
    assert client.get('/v1/admin/ads/archive/documents', headers=h('editor')).status_code == 403
    assert 'บันทึกภายใน' not in json.dumps(account, ensure_ascii=False)
    assert 'pending_count' not in account
    assert isinstance(me(client, 'admin')['pending_count'], int)
    assert len(account['capabilities']['catalog']) == 12
    assert all('tabs' not in row and 'email' not in row for row in account['capabilities']['catalog'])
    assert [r['tab'] for r in me(client, 'agency')['capabilities']['catalog']] == ['registry']
    assert me(client, 'service_consumer')['capabilities']['catalog'] == []
    history = directory(client)['permission_events']
    assert any(e['account_id'] == str(ids['editor']) and e['after_value'].get('note') == 'บันทึกภายใน' for e in history)


def test_permission_accounts_template_recopy_and_manager_flag_are_independent(permission_accounts):
    client, ids = permission_accounts
    assert save(client, ids, tabs={'projects': ['view']}).status_code == 200
    response = save(client, ids, template={'code': 'admin', 'version': 1})
    assert response.status_code == 200, response.text
    assert not response.json()['data']['access']['can_manage_users']
    assert client.get('/v1/admin/accounts', headers=h('editor')).status_code == 403
    denied = save(client, ids, can_manage_users=True)
    assert denied.status_code == 422 and denied.json()['error']['code'] == 'permission_admin_confirmation'
    confirmed = save(client, ids, can_manage_users=True, confirm_manage_users=True)
    assert confirmed.status_code == 200
    assert me(client, 'editor')['role'] == 'editor'  # Compatibility label is not authority.
    assert client.get('/v1/admin/accounts', headers=h('editor')).status_code == 200
    assert save(client, ids, template={'code': 'viewer', 'version': 1}).status_code == 200
    assert me(client, 'editor')['can_manage_users']
    assert not me(client, 'editor')['capabilities']['tabs']['projects']['edit']
    unchanged = save(client, ids, template={'code': 'viewer', 'version': 1})
    assert unchanged.status_code == 200 and unchanged.json()['data']['changed'] is False


@pytest.mark.parametrize('tabs', [
    {'projects':['edit','approve']}, {'brands':['edit']}, {'promotions':['view','edit','approve']},
    {'releases':['view','edit']}, {'questions':['view','edit']}, {'actuals':['view','approve']},
    {'brands':['view','archive.legal_hold']}, {'unknown':['view']},
])
def test_permission_accounts_invalid_grid_cannot_change_any_row(permission_accounts, tabs):
    client, ids = permission_accounts
    before = me(client, 'editor')
    response = save(client, ids, tabs=tabs)
    assert response.status_code == 422, response.text
    assert me(client, 'editor') == before
    with pytest.raises(asyncpg.CheckViolationError):
        runtime_value(ids['admin'], 'select hub.configure_account_access($1,$2::jsonb)', ids['editor'],
            json.dumps({'updated_at': before['updated_at'], 'tabs': tabs}))
    assert me(client, 'editor') == before


def test_permission_accounts_self_private_helpers_and_stale_denied(permission_accounts):
    client, ids = permission_accounts
    before = me(client, 'editor')
    assert save(client, ids, target='admin', can_manage_users=False).status_code == 403
    assert save(client, ids, tabs={'projects':['view']}).status_code == 200
    stale = client.post(f'/v1/admin/accounts/{ids["editor"]}/permissions', headers=h('admin'),
        json={'updated_at':before['updated_at'], 'tabs':{}})
    assert stale.status_code == 409
    for sql in ["select * from hub.permission_notice_ack", "select hub.permission_rows($1)",
        "select hub.write_account_access($1,'{}',$1,'FORGED')"]:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            runtime_value(ids['admin'], sql, *([ids['editor']] if '$1' in sql else []))


def test_permission_accounts_atomic_custom_approval_and_explicit_manager(permission_accounts):
    client, ids = permission_accounts
    assert client.post('/v1/me/access-request', headers=h('pending'), json=REQUEST).status_code == 200
    before = me(client, 'pending')
    path = f'/v1/admin/accounts/{ids["pending"]}/decision'
    body = {'action':'approve', 'updated_at':before['updated_at'], 'template':{'code':'admin','version':1},
        'tabs':{'promotions':['view','edit','approve']}, 'note':'หมายเหตุเฉพาะผู้ดูแล'}
    assert client.post(path, headers=h('admin'), json=body).status_code == 422
    assert me(client, 'pending') == before
    body['tabs'] = {'projects':['view','edit'], 'finance':['view','edit']}
    accepted = client.post(path, headers=h('admin'), json=body)
    assert accepted.status_code == 200, accepted.text
    account = me(client, 'pending')
    assert account['status'] == 'ACTIVE' and not account['can_manage_users']
    assert account['capabilities']['tabs']['projects']['edit']
    assert account['capabilities']['tabs']['finance']['edit']
    assert not account['capabilities']['tabs']['brands']['view']
    assert account['decision_note'] == ''
    assert 'หมายเหตุเฉพาะผู้ดูแล' not in json.dumps(account, ensure_ascii=False)


def test_permission_accounts_agency_fixed_profile_keeps_code_correction(permission_accounts):
    client, ids = permission_accounts
    for change in [{'template':{'code':'editor','version':1}}, {'tabs':{'registry':['view','edit']}}, {'can_manage_users':True}]:
        assert save(client, ids, target='agency', **change).status_code == 403
    assert save(client, ids, target='agency', agency_code='unknown').status_code == 422
    corrected = save(client, ids, target='agency', agency_code='COMBAY', note='แก้รหัสตามทะเบียน')
    assert corrected.status_code == 200, corrected.text
    assert me(client, 'agency')['agency'] == 'COMBAY'
    assert runtime_value(ids['agency'], "select hub.can_agency_registry('COMBAY')") is True
    assert runtime_value(ids['agency'], "select hub.can_agency_registry('KIN')") is False
    assert save(client, ids, template={'code':'agency','version':1}).status_code == 403


def batch(ids, selection=None, change=None):
    return {'selection': selection or {'kind':'accounts','account_ids':[str(ids['editor']),str(ids['viewer']),str(ids['admin']),str(ids['agency']),str(ids['pending'])]},
        'change': change or {'kind':'template','template':{'code':'publisher','version':1}}, 'note':'เปลี่ยนแม่แบบชุดทดสอบ'}


def test_permission_accounts_batch_preview_apply_audit_and_replay(permission_accounts):
    client, ids = permission_accounts
    body = batch(ids)
    before = me(client, 'editor')
    preview = client.post('/v1/admin/permissions/preview', headers=h('admin'), json=body)
    assert preview.status_code == 200, preview.text
    review = preview.json()['data']
    assert review['change_count'] == 2
    assert {x['reason'] for x in review['excluded']} == {'self','external','inactive'}
    assert me(client, 'editor') == before
    apply_body = {**body,'digest':review['digest'],'confirmed':True}
    applied = client.post('/v1/admin/permissions/apply', headers=h('admin'), json=apply_body)
    assert applied.status_code == 200, applied.text
    result = applied.json()['data']
    assert result['changed_count'] == 2
    assert me(client,'editor')['capabilities']['tabs']['projects']['approve']
    assert not me(client,'editor')['capabilities']['tabs']['projects']['edit']
    assert not me(client,'editor')['can_manage_users']
    events = [e for e in directory(client)['permission_events'] if e['after_value'].get('batch_id') == result['batch_id']]
    assert len(events) == 2 and all(e['action'] == 'TEMPLATE_APPLY' for e in events)
    assert client.post('/v1/admin/permissions/apply', headers=h('admin'), json=apply_body).status_code == 409


@pytest.mark.parametrize('change', ['target', 'membership', 'request', 'digest'])
def test_permission_accounts_batch_stale_is_atomic(permission_accounts, change):
    client, ids = permission_accounts
    team = 'ทีม-' + uuid4().hex
    operator('update hub.user_account set team=$1 where id=any($2::uuid[])', team, [ids['editor'],ids['viewer']])
    body = batch(ids, selection={'kind':'team','team':team})
    review = client.post('/v1/admin/permissions/preview', headers=h('admin'), json=body).json()['data']
    if change == 'target':
        operator('update hub.user_account set updated_at=clock_timestamp() where id=$1', ids['viewer'])
    elif change == 'membership':
        operator('update hub.user_account set team=$1 where id=$2', team, ids['online_staff'])
    elif change == 'request':
        body['change'] = {'kind':'template','template':{'code':'viewer','version':1}}
    else:
        review['digest'] = '0'*64
    result = client.post('/v1/admin/permissions/apply', headers=h('admin'), json={**body,'digest':review['digest'],'confirmed':True})
    assert result.status_code == 409, result.text
    assert result.json()['error']['code'] == 'permission_preview_stale'
    assert me(client, 'editor')['capabilities']['tabs']['projects']['edit']
    assert not me(client, 'viewer')['capabilities']['tabs']['projects']['approve']


@pytest.mark.parametrize('role', ['editor','viewer','publisher','online_staff','agency','pending','service_consumer'])
def test_permission_accounts_batch_routes_and_rpc_require_live_manager(permission_accounts, role):
    client, ids = permission_accounts
    body = batch(ids)
    assert client.post('/v1/admin/permissions/preview', headers=h(role), json=body).status_code == 403
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        runtime_value(ids[role], 'select hub.preview_account_permissions($1::jsonb)', json.dumps(body))


def test_permission_accounts_batch_rejects_unknown_target_and_unconfirmed_apply(permission_accounts):
    client, ids = permission_accounts
    body = batch(ids, selection={'kind':'accounts','account_ids':[str(uuid4())]})
    assert client.post('/v1/admin/permissions/preview', headers=h('admin'), json=body).status_code == 404
    body = batch(ids)
    preview = client.post('/v1/admin/permissions/preview', headers=h('admin'), json=body).json()['data']
    assert client.post('/v1/admin/permissions/apply', headers=h('admin'), json={**body,'digest':preview['digest']}).status_code == 422
    assert client.post('/v1/admin/permissions/apply', headers=h('admin'), json={**body,'digest':preview['digest'],'confirmed':False}).status_code == 422


def test_permission_accounts_new_tab_notice_grants_nothing_then_explicit_assignment(permission_accounts):
    client, ids = permission_accounts
    tab = 'synthetic_rollout'
    operator("insert into hub.permission_catalog(tab,label_th,nav_group,levels,sensitivity) values($1,'ทดสอบ','other','{view,edit}','internal')", tab)
    try:
        catalog = client.get('/v1/admin/permissions/catalog', headers=h('admin')).json()['data']
        assert next(c for c in catalog['tabs'] if c['tab']==tab)['new_for_actor']
        assert runtime_value(ids['admin'], 'select hub.can($1,\'view\')', tab) is False
        acknowledged = client.post(f'/v1/admin/permissions/notices/{tab}/ack', headers=h('admin'), json={'catalog_digest':catalog['catalog_digest']})
        assert acknowledged.status_code == 200
        assert runtime_value(ids['admin'], 'select hub.can($1,\'view\')', tab) is False
        second = client.get('/v1/admin/permissions/catalog', headers=h('second')).json()['data']
        assert next(c for c in second['tabs'] if c['tab']==tab)['new_for_actor']
        body = batch(ids, selection={'kind':'accounts','account_ids':[str(ids['editor'])]}, change={'kind':'tab','tab':tab,'levels':['view']})
        assert client.post('/v1/admin/permissions/preview', headers=h('admin'), json=body).status_code == 403
        operator("update hub.permission_catalog set guards_ready=true,rollout_state='MIGRATED' where tab=$1",tab)
        preview = client.post('/v1/admin/permissions/preview', headers=h('admin'), json=body).json()['data']
        result = client.post('/v1/admin/permissions/apply', headers=h('admin'), json={**body,'digest':preview['digest'],'confirmed':True})
        assert result.status_code == 200, result.text
        assert runtime_value(ids['editor'], 'select hub.can($1,\'view\')', tab) is True
        assert runtime_value(ids['editor'], 'select hub.can($1,\'edit\')', tab) is False
        assert runtime_value(ids['viewer'], 'select hub.can($1,\'view\')', tab) is False
    finally:
        operator('delete from hub.permission_notice_ack where tab=$1',tab)
        operator('delete from hub.account_permission where tab=$1',tab)
        operator('delete from hub.permission_catalog where tab=$1',tab)


def test_permission_accounts_template_versions_are_immutable_and_do_not_recopy(permission_accounts):
    _, ids = permission_accounts
    async def run():
        db = await disposable_operator()
        try:
            before = await db.fetchval('select hub.permission_rows($1)',ids['editor'])
            transaction = db.transaction()
            await transaction.start()
            try:
                await db.execute("insert into hub.permission_template(code,version,label_th,tabs) values('editor',999,'ทดสอบ','{}')")
                assert await db.fetchval('select hub.permission_rows($1)',ids['editor']) == before
                for statement in ["update hub.permission_template set tabs='{}' where code='editor' and version=1",
                                  "delete from hub.permission_template where code='editor' and version=1"]:
                    with pytest.raises(asyncpg.PostgresError):
                        async with db.transaction():
                            await db.execute(statement)
            finally:
                await transaction.rollback()
        finally:
            await db.close()
    asyncio.run(run())


def test_permission_accounts_invite_pins_version_and_never_grants_manager(permission_accounts):
    client, ids = permission_accounts
    operator('delete from hub.user_account where id=$1', ids['pending'])
    address = f'{ids["pending"]}@example.test'
    body = {'email':address,'company_type':'SENA','team':'ทีมสมมติ','template':{'code':'editor','version':1}}
    denied = client.post('/v1/admin/account-invites', headers=h('admin'), json={**body,'template':{'code':'admin','version':1}})
    assert denied.status_code == 422
    invitation = client.post('/v1/admin/account-invites', headers=h('admin'), json=body)
    assert invitation.status_code == 200, invitation.text
    invitation = invitation.json()['data']
    assert invitation['permission_template'] == 'editor' and invitation['permission_template_version'] == 1
    # A later version has different boxes. The operator owns template definitions;
    # runtime acceptance below is the real non-superuser HTTP/database path.
    operator("insert into hub.permission_template(code,version,label_th,tabs) values('editor',999,'ทดสอบรุ่นใหม่','{\"projects\":[\"view\"]}')")
    try:
        operator('create schema if not exists auth')
        operator('create table if not exists auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz)')
        operator('insert into auth.users values($1,$2,clock_timestamp(),clock_timestamp())',ids['pending'],address.upper())
        pending = me(client,'pending')
        assert pending['invite']['template'] == {'code':'editor','version':1}
        profile = {k:v for k,v in REQUEST.items() if k not in ('reason','requested_tasks')}
        accepted = client.post('/v1/me/invite-accept', headers=h('pending'), json={**profile,'invite_id':invitation['id']})
        assert accepted.status_code == 200, accepted.text
        account = me(client,'pending')
        assert account['status'] == 'ACTIVE' and not account['can_manage_users']
        assert account['capabilities']['template_version'] == 1
        assert account['capabilities']['tabs']['projects']['edit']
        assert runtime_value(ids['pending'], "select hub.can('brands','edit')") is True
    finally:
        operator('delete from auth.users where id=$1',ids['pending'])
        operator('delete from hub.account_invite where id=$1',invitation['id'])
        # Disposable-only fixture teardown restores the version catalog. This
        # never grants runtime execution or weakens a tested authorization path.
        async def remove_version():
            db = await disposable_operator()
            try:
                async with db.transaction():
                    await db.execute('alter table hub.permission_template disable trigger permission_template_immutable')
                    await db.execute("delete from hub.permission_template where code='editor' and version=999")
                    await db.execute('alter table hub.permission_template enable trigger permission_template_immutable')
            finally:
                await db.close()
        asyncio.run(remove_version())


def test_permission_accounts_purge_scrubs_permission_notes_and_notice_ack(permission_accounts):
    client, ids = permission_accounts
    assert save(client, ids, tabs={'projects':['view']},note='ข้อมูลส่วนบุคคลสมมติ').status_code == 200
    operator("insert into hub.permission_notice_ack(actor_id,tab) values($1,'projects')",ids['editor'])
    operator("update hub.user_account set status='REJECTED',company_name='บริษัทสมมติ',position='ตำแหน่งสมมติ',decided_at=now()-interval '91 days' where id=$1",ids['editor'])
    operator('select hub.purge_rejected_accounts()')
    assert operator('select count(*) n from hub.permission_notice_ack where actor_id=$1',ids['editor'])[0]['n'] == 0
    assert operator('select company_name,position from hub.user_account where id=$1',ids['editor'])[0]['company_name'] is None
    assert operator("select count(*) n from hub.permission_event where after_value::text like '%ข้อมูลส่วนบุคคลสมมติ%'")[0]['n'] == 0


def test_permission_accounts_batch_blocks_concurrent_pending_team_membership(permission_accounts):
    _, ids = permission_accounts
    team = 'ทีมพร้อมกัน-' + uuid4().hex
    operator('update hub.user_account set team=$1 where id=$2',team,ids['editor'])
    body = batch(ids, selection={'kind':'team','team':team})

    async def run():
        first, second, observer = await runtime(), await runtime(), await disposable_operator()
        pending = None
        try:
            for db, actor in [(first,ids['admin']), (second,ids['pending'])]:
                await db.execute('begin')
                await db.execute('SET LOCAL ROLE hub_app')
                await db.execute("select set_config('app.actor_id',$1,true)",str(actor))
            # Hold the exact apply lock, then stage the competing real runtime
            # submission. Its pending row was not in the reviewed team yet.
            await first.execute("select pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0))")
            review = json.loads(await first.fetchval('select hub.preview_account_permissions($1::jsonb)',json.dumps(body)))
            pending = asyncio.create_task(second.fetchval('select hub.submit_access_request($1::jsonb)',json.dumps({**REQUEST,'team':team})))
            blocked = False
            for _ in range(100):
                if await observer.fetchval('select wait_event_type from pg_stat_activity where pid=$1',second.get_server_pid()) == 'Lock':
                    blocked = True
                    break
                await asyncio.sleep(0.02)
            assert blocked and not pending.done(), 'Pending team edit must wait for the batch review lock'
            result = json.loads(await first.fetchval('select hub.apply_account_permissions($1::jsonb,$2)',json.dumps(body),review['digest']))
            assert result['changed_count'] == 1
            assert {row['account_id'] for row in result['items']} == {str(ids['editor'])}
            await first.execute('commit')
            submitted = json.loads(await asyncio.wait_for(pending,5))
            assert submitted['team'] == team and submitted['status'] == 'PENDING'
            await second.execute('commit')
            assert await observer.fetchval("select count(*) from hub.account_permission where account_id=$1 and (can_edit or can_approve)",ids['pending']) == 0
        finally:
            await first.execute('rollback')
            if pending is not None:
                await asyncio.gather(pending,return_exceptions=True)
            await second.execute('rollback')
            await first.close()
            await second.close()
            await observer.close()
    asyncio.run(run())


@pytest.mark.parametrize('tab', ['projects', 'brands'])
def test_n1_manager_explicitly_assigns_edit_and_approve_without_default_changes(permission_accounts, tab):
    client, ids = permission_accounts
    before_admin = me(client, 'admin')['capabilities']
    before_publisher = me(client, 'publisher')['capabilities']
    assert not me(client, 'editor')['capabilities']['tabs'][tab]['approve']
    response = save(client, ids, tabs={tab: ['view', 'edit', 'approve']})
    assert response.status_code == 200, response.text
    assert me(client, 'editor')['capabilities']['tabs'][tab] == {'view': True, 'edit': True, 'approve': True}
    assert me(client, 'admin')['capabilities'] == before_admin
    assert me(client, 'publisher')['capabilities'] == before_publisher
    assert not before_publisher['special_actions']['knowledge.publish_web']
