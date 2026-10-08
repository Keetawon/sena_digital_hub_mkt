"""Invitations use protected Auth confirmation, never user-editable metadata."""
import asyncio
import json
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest

from test_accounts import accounts, h, REQUEST, decision


def operator(sql, *args):
    async def run():
        config = json.loads(Path('.local/development.json').read_text(encoding='utf-8'))
        db = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local', user='postgres', password=config['adminPassword'])
        try:
            return await db.fetch(sql, *args)
        finally:
            await db.close()
    return asyncio.run(run())


def auth_user(identity, email='new@example.test', confirmed=True, old=False):
    operator('create schema if not exists auth')
    operator('create table if not exists auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz)')
    operator("insert into auth.users values($1,$2,case when $3 then now() else null end,case when $4 then now()-interval '30 days' else clock_timestamp() end)", identity, email, confirmed, old)


def invite(client, **changes):
    return client.post('/v1/admin/account-invites', headers=h('admin'), json={
        'email': 'new@example.test', 'company_type': 'SENA', 'team': 'ทีมสมมติ', 'hub_role': 'editor', **changes})


@pytest.fixture(autouse=True)
def isolate_invites():
    # Account fixtures retain UUID isolation; these tests also reuse synthetic emails.
    operator('delete from hub.account_invite')
    operator("delete from hub.user_account where email in ('new@example.test','other@example.test')")


def accept(client, invitation):
    profile = {key: value for key, value in REQUEST.items() if key not in ('reason', 'requested_tasks')}
    return client.post('/v1/me/invite-accept', headers=h('new'), json={**profile, 'invite_id': invitation['id']})


def test_invite_accept_verified_case_insensitive_and_private_authority(accounts):
    client, ids = accounts
    created = invite(client, email=' NEW@Example.Test ', hub_role='agency', agency_code='KIN', company_type='AGENCY')
    assert created.status_code == 200
    invitation = created.json()['data']
    assert invitation['email'] == 'new@example.test' and invitation['company_name'] == 'KIN'
    auth_user(ids['new'], email='NEW@EXAMPLE.TEST')
    me = client.get('/v1/me', headers=h('new')).json()['data']
    assert me['invite']['id'] == invitation['id'] and me['status'] == 'PENDING'
    result = accept(client, invitation)
    assert result.status_code == 200
    account = result.json()['data']
    assert (account['status'], account['hub_role'], account['agency_code']) == ('ACTIVE', 'agency', 'KIN')
    assert (account['company_type'], account['company_name']) == ('AGENCY', 'KIN')
    assert account['decided_by'] == ids['admin']
    assert accept(client, invitation).status_code == 422
    rows = client.get('/v1/admin/account-invites', headers=h('admin')).json()['data']['items']
    assert rows[0]['status'] == 'ACCEPTED' and rows[0]['accepted_account_id'] == ids['new']
    events = client.get('/v1/admin/accounts', headers=h('admin')).json()['data']['events']
    assert len([e for e in events if e['account_id'] == ids['new'] and e['action'] == 'INVITE_ACCEPT']) == 1
    assert client.get('/v1/admin/accounts', headers=h('new')).status_code == 403


@pytest.mark.parametrize('proof', ['unverified', 'wrong_email', 'old_auth', 'no_auth'])
def test_invite_requires_confirmed_current_email_and_new_identity(accounts, proof):
    client, ids = accounts
    invitation = invite(client).json()['data']
    if proof != 'no_auth':
        auth_user(ids['new'], email='other@example.test' if proof == 'wrong_email' else 'new@example.test', confirmed=proof != 'unverified', old=proof == 'old_auth')
    me = client.get('/v1/me', headers=h('new')).json()['data']
    assert not (me.get('invite') or {}).get('id')
    assert accept(client, invitation).status_code == 422
    assert client.get('/v1/me', headers=h('new')).json()['data']['status'] == 'PENDING'


def test_duplicate_account_returns_id_and_live_invite_is_unique(accounts):
    client, ids = accounts
    client.get('/v1/me', headers=h('new'))
    existing = invite(client)
    assert existing.status_code == 409
    assert existing.json()['error']['code'] == 'account_exists'
    assert existing.json()['error']['account_id'] == ids['new']
    assert invite(client, email='other@example.test').status_code == 200
    duplicate = invite(client, email=' OTHER@EXAMPLE.TEST ')
    assert duplicate.status_code == 409 and duplicate.json()['error']['code'] == 'invite_exists'


@pytest.mark.parametrize('change', [
    {'hub_role': 'admin'}, {'hub_role': 'service_consumer'}, {'hub_role': 'agency'},
    {'hub_role': 'agency', 'agency_code': 'INVALID'}, {'company_type': 'CONTRACTOR'},
    {'email': 'not-an-email'},
])
def test_invite_validation(accounts, change):
    client, _ = accounts
    assert invite(client, **change).status_code == 422


@pytest.mark.parametrize('state', ['expired', 'cancelled'])
def test_expired_cancelled_invite_falls_back_and_cannot_accept(accounts, state):
    client, ids = accounts
    invitation = invite(client).json()['data']
    if state == 'expired':
        operator("update hub.account_invite set expires_at=now()-interval '1 second' where id=$1", invitation['id'])
    else:
        assert client.post(f"/v1/admin/account-invites/{invitation['id']}/decision", headers=h('admin'), json={'action': 'cancel', 'expires_at': invitation['expires_at']}).status_code == 200
    auth_user(ids['new'])
    me = client.get('/v1/me', headers=h('new')).json()['data']
    assert 'หมดอายุหรือถูกยกเลิก' in me['invite']['message']
    assert accept(client, invitation).status_code == 422
    assert client.post('/v1/me/access-request', headers=h('new'), json=REQUEST).status_code == 200


def test_extend_stale_cancel_audit_and_no_existing_account_upgrade(accounts):
    client, ids = accounts
    invitation = invite(client).json()['data']
    path = f"/v1/admin/account-invites/{invitation['id']}/decision"
    extended = client.post(path, headers=h('admin'), json={'action': 'extend', 'expires_at': invitation['expires_at']})
    assert extended.status_code == 200 and extended.json()['data']['expires_at'] > invitation['expires_at']
    assert client.post(path, headers=h('admin'), json={'action': 'cancel', 'expires_at': invitation['expires_at']}).status_code == 409
    auth_user(ids['new'])
    client.get('/v1/me', headers=h('new'))
    assert client.post(path, headers=h('admin'), json={'action': 'cancel', 'expires_at': extended.json()['data']['expires_at']}).status_code == 200
    events = client.get('/v1/admin/accounts', headers=h('admin')).json()['data']['events']
    assert [e['action'] for e in events if e['invite_id'] == invitation['id']] == ['INVITE_CANCEL', 'INVITE_EXTEND', 'INVITE_CREATE']


def test_admin_notes_never_leak_to_me_and_retention_scrubs_profile(accounts):
    client, ids = accounts
    assert client.post('/v1/me/access-request', headers=h('new'), json={**REQUEST, 'company_type': 'CONTRACTOR', 'company_name': 'บริษัทสมมติ'}).status_code == 200
    for action, role, note in [('approve','editor','บันทึกส่วนตัวอนุมัติ'),('role','viewer','บันทึกส่วนตัวสิทธิ์'),('suspend',None,'แจ้งผู้ใช้ระงับ'),('reactivate',None,'บันทึกส่วนตัวเปิดใช้')]:
        assert decision(client, 'new', action, role, note=note).status_code == 200
        me = client.get('/v1/me', headers=h('new')).json()['data']
        assert me['decision_note'] == (note if action == 'suspend' else '')
    assert decision(client, 'new', 'suspend', note=' ').json()['error']['code'] == 'account_suspend_reason'
    operator("update hub.user_account set status='REJECTED',decided_at=now()-interval '91 days' where id=$1", ids['new'])
    operator('select hub.purge_rejected_accounts()')
    me = client.get('/v1/me', headers=h('new')).json()['data']
    assert me['company_name'] is None and me['position'] is None and me['company_type'] is None


def test_new_company_fields_required_and_sena_name_normalised(accounts):
    client, _ = accounts
    for field in ['company_type','position']:
        body = {k:v for k,v in REQUEST.items() if k != field}
        assert client.post('/v1/me/access-request', headers=h('new'), json=body).status_code == 422
    result = client.post('/v1/me/access-request', headers=h('new'), json={**REQUEST, 'company_type':'AGENCY'})
    assert result.status_code == 422 and result.json()['error']['details'][0]['field'] == 'company_name'
    result = client.post('/v1/me/access-request', headers=h('new'), json={**REQUEST,'company_name':'unused'})
    assert result.status_code == 200 and result.json()['data']['company_name'] is None


@pytest.mark.parametrize('column,value', [('status','INACTIVE'), ('alias_of','COMBAY'), ('active_to','2000-01-01')])
def test_invite_agency_must_be_active_canonical_and_date_valid(accounts, column, value):
    client, _ = accounts
    # Column names are fixed by this parametrized test, never supplied by a caller.
    previous = operator(f"select {column} from ads.vocab where vocab_type='AGENCY' and code='KIN'")[0][column]
    try:
        if column == 'active_to':
            from datetime import date
            value = date.fromisoformat(value)
        operator(f"update ads.vocab set {column}=$1 where vocab_type='AGENCY' and code='KIN'", value)
        result = invite(client, hub_role='agency', agency_code='KIN')
        assert result.status_code == 422 and result.json()['error']['code'] == 'account_agency_invalid'
    finally:
        operator(f"update ads.vocab set {column}=$1 where vocab_type='AGENCY' and code='KIN'", previous)
