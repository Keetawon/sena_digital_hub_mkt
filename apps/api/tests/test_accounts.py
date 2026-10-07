"""Real disposable PostgreSQL account authority; JWT cryptography is tested separately."""
import os
import asyncio
import json
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from sena_hub_api.auth import Authentication, Settings
from sena_hub_api.main import create_app
from sena_hub_api.accounts import ACCESS_FIELD_MESSAGES


REQUEST = dict(display_name_th='ผู้สมัคร ทดสอบ', phone='020000000', team='ทีมสมมติ',
               requested_tasks=['edit'], reason='ดูแลโครงการสมมติ', privacy_acknowledged=True)


@pytest.fixture
def accounts(monkeypatch):
    identities = {'admin': '00000000-0000-0000-0000-000000000005', 'new': str(uuid4()), 'other': str(uuid4())}
    def verify(self, token):
        return {'sub': identities[token], 'email': f'{token}@example.test',
                'app_metadata': {'provider': 'google', 'hub_role': 'admin'}, 'user_metadata': {'hub_role': 'admin'}}
    monkeypatch.setattr(Authentication, 'verify_jwt', verify)
    settings = Settings(database_url=os.environ['HUB_TEST_DATABASE_URL'], auth_mode='supabase',
                        environment='production', supabase_url='https://example.supabase.co')
    with TestClient(create_app(settings), client=('127.0.0.1', 50000)) as client:
        yield client, identities


def h(who):
    return {'Authorization': f'Bearer {who}'}


def decision(client, target, action, role=None, agency=None, note='เหตุผลสมมติ'):
    row = client.get('/v1/me', headers=h(target)).json()['data']
    return client.post(f"/v1/admin/accounts/{row['id']}/decision", headers=h('admin'), json={
        'action': action, 'hub_role': role, 'agency_code': agency, 'note': note, 'updated_at': row['updated_at']})


def test_request_approval_immediate_role_suspend_and_privacy(accounts):
    client, ids = accounts
    me = client.get('/v1/me', headers=h('new')).json()['data']
    assert me['status'] == 'PENDING' and me['role'] is None
    assert me['sign_in_method'] == 'google'
    assert client.post('/v1/me/access-request', headers=h('new'), json={**REQUEST, 'hub_role': 'admin'}).status_code == 422
    assert client.post('/v1/me/access-request', headers=h('new'), json=REQUEST).status_code == 200
    assert client.patch('/v1/me/access-request', headers=h('new'), json={**REQUEST, 'team': 'ทีมแก้ไข'}).status_code == 200
    assert decision(client, 'new', 'approve', 'agency').status_code == 422
    assert decision(client, 'new', 'approve', 'agency', 'NOTREAL').status_code == 422
    assert decision(client, 'new', 'approve', 'editor').status_code == 200
    assert client.get('/v1/admin/projects', headers=h('new')).status_code == 200
    assert client.get('/v1/admin/accounts', headers=h('new')).status_code == 403
    names = client.get('/v1/accounts/display-names', headers=h('new')).json()['data']
    assert all(set(row) == {'id', 'display_name_th'} for row in names)
    assert decision(client, 'new', 'role', 'agency', 'KIN').status_code == 200
    assert client.get('/v1/admin/projects', headers=h('new')).status_code == 403
    registrations = client.get('/v1/admin/ads/registrations', headers=h('new')).json()['data']
    assert all(r['registration']['agency'] == 'KIN' for r in registrations)
    assert decision(client, 'new', 'suspend').status_code == 200
    assert client.get('/v1/admin/ads/registrations', headers=h('new')).status_code == 403
    assert decision(client, 'new', 'reactivate').status_code == 200
    assert client.get('/v1/admin/ads/registrations', headers=h('new')).status_code == 200
    assert decision(client, 'admin', 'role', 'viewer').status_code == 403
    assert decision(client, 'admin', 'suspend').status_code == 403


@pytest.mark.parametrize('state', ['PENDING', 'REJECTED', 'SUSPENDED'])
def test_all_other_api_routes_fail_closed(accounts, state):
    client, ids = accounts
    assert client.get('/v1/me', headers=h('new')).status_code == 200
    assert client.post('/v1/me/access-request', headers=h('new'), json=REQUEST).status_code == 200
    if state == 'REJECTED':
        assert decision(client, 'new', 'reject').status_code == 200
    elif state == 'SUSPENDED':
        assert decision(client, 'new', 'approve', 'viewer').status_code == 200
        assert decision(client, 'new', 'suspend').status_code == 200
    tested = 0
    for route in client.app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith('/v1/') or route.path in ('/v1/me', '/v1/me/access-request'):
            continue
        path = route.path
        for name in route.param_convertors:
            path = path.replace('{' + name + '}', str(uuid4()))
        for method in route.methods:
            response = client.request(method, path, headers=h('new'), json={} if method != 'GET' else None)
            assert response.status_code == 403, (method, path, response.status_code)
            tested += 1
    assert tested > 100
    assert client.get('/v1/me', headers=h('new')).json()['data']['status'] == state
    if state != 'PENDING':
        assert client.patch('/v1/me/access-request', headers=h('new'), json=REQUEST).status_code == 403


@pytest.mark.parametrize('field,value', [
    ('display_name_th', 'Synthetic Google User'), ('phone', '02+000000'),
    ('team', ''), ('requested_tasks', []), ('reason', ''), ('privacy_acknowledged', False),
])
def test_request_has_specific_thai_field_errors_without_writing(accounts, field, value):
    client, _ = accounts
    before = client.get('/v1/me', headers=h('new')).json()['data']
    response = client.post('/v1/me/access-request', headers=h('new'), json={**REQUEST, field: value})
    assert response.status_code == 422
    assert {'field': field, 'message': ACCESS_FIELD_MESSAGES[field]} in response.json()['error']['details']
    after = client.get('/v1/me', headers=h('new')).json()['data']
    assert before == after


@pytest.mark.parametrize('phone,valid', [
    ('+66 (02) 123-4567', True), ('02000000', True), ('0' * 30, True),
    ('+' + '0' * 30, True), ('02+000000', False), ('++02000000', False),
    ('0200000', False), ('0' * 31, False), ('๐๒๐๐๐๐๐๐', False),
])
def test_phone_validation(accounts, phone, valid):
    client, _ = accounts
    response = client.post('/v1/me/access-request', headers=h('new'), json={**REQUEST, 'phone': phone})
    assert response.status_code == (200 if valid else 422)


def test_account_decision_errors_and_reopen_preserve_notes(accounts):
    client, ids = accounts
    client.post('/v1/me/access-request', headers=h('new'), json=REQUEST)
    for action, role, agency, note, code in [
        ('approve', 'agency', None, '', 'account_agency_invalid'),
        ('approve', 'agency', 'NOTREAL', '', 'account_agency_invalid'),
        ('reject', None, None, '   ', 'account_reject_reason'),
    ]:
        result = decision(client, 'new', action, role, agency, note)
        assert result.status_code == 422
        assert result.json()['error']['code'] == code
        assert 'สิทธิ์สื่อ' not in result.json()['error']['message']
    assert decision(client, 'admin', 'role', 'admin').json()['error']['code'] == 'account_self_decision'
    assert decision(client, 'admin', 'suspend').json()['error']['code'] == 'account_last_admin'
    assert decision(client, 'new', 'reject', note='ขอรายละเอียดเพิ่มเติม').status_code == 200
    rejected = client.get('/v1/me', headers=h('new')).json()['data']
    assert decision(client, 'new', 'reopen', note='กรุณาแก้ไขแล้วส่งใหม่').status_code == 200
    reopened = client.get('/v1/me', headers=h('new')).json()['data']
    assert reopened['status'] == 'PENDING' and reopened['role'] is None
    assert reopened['privacy_acknowledged_at'] is None
    assert reopened['reason'] == REQUEST['reason']
    assert decision(client, 'new', 'approve', 'viewer').status_code == 422
    stale = client.post(f"/v1/admin/accounts/{ids['new']}/decision", headers=h('admin'), json={
        'action': 'reject', 'note': 'stale', 'updated_at': rejected['updated_at']})
    assert stale.status_code == 409 and stale.json()['error']['code'] == 'conflict'
    assert client.patch('/v1/me/access-request', headers=h('new'), json={**REQUEST, 'team': 'ทีมใหม่'}).status_code == 200
    assert decision(client, 'new', 'approve', 'agency', 'KIN').status_code == 200
    events = client.get('/v1/admin/accounts', headers=h('admin')).json()['data']['events']
    reopened_event = next(e for e in events if e['account_id'] == ids['new'] and e['action'] == 'reopen')
    assert reopened_event['previous_decision_note'] == 'ขอรายละเอียดเพิ่มเติม'
    assert reopened_event['decision_note'] == 'กรุณาแก้ไขแล้วส่งใหม่'
    assert (reopened_event['old_status'], reopened_event['new_status']) == ('REJECTED', 'PENDING')


def test_anonymised_request_cannot_reopen(accounts):
    client, ids = accounts
    client.post('/v1/me/access-request', headers=h('new'), json=REQUEST)
    assert decision(client, 'new', 'reject', note='ข้อมูลสมมติที่ต้องลบ').status_code == 200
    async def age_and_purge():
        config = json.loads(Path('.local/development.json').read_text(encoding='utf-8'))
        db = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local', user='postgres', password=config['adminPassword'])
        try:
            await db.execute("update hub.user_account set decided_at=now()-interval '91 days' where id=$1", ids['new'])
            await db.fetchval('select hub.purge_rejected_accounts()')
            assert not await db.fetchval("select exists(select 1 from hub.user_account_event where decision_note=$1 or previous_decision_note=$1)", 'ข้อมูลสมมติที่ต้องลบ')
        finally:
            await db.close()
    asyncio.run(age_and_purge())
    result = decision(client, 'new', 'reopen')
    assert result.status_code == 422
    assert result.json()['error']['code'] == 'account_anonymised'
