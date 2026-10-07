"""Real disposable PostgreSQL account authority; JWT cryptography is tested separately."""
import os
from uuid import uuid4

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from sena_hub_api.auth import Authentication, Settings
from sena_hub_api.main import create_app


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
