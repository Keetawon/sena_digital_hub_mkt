"""Legacy route-entry ceilings, with real account lookup on disposable PostgreSQL.

Handlers stop AFTER real dependencies. Object/state authorization is exercised
by the domain SQL/API suites, and by each later phase's direct-SQL deny tests.
"""
import asyncio
import json
import os
from pathlib import Path
import re
import secrets
from uuid import uuid4

import asyncpg
import pytest
from fastapi import Response
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from sena_hub_api.auth import Authentication, Settings
from sena_hub_api.main import create_app

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = json.loads((ROOT / 'tests/permissions/legacy-routes.json').read_text(encoding='utf-8'))
FOUNDATION = json.loads((ROOT / 'tests/permissions/foundation-routes.json').read_text(encoding='utf-8'))
SHARED = json.loads((ROOT / 'tests/permissions/shared-routes.json').read_text(encoding='utf-8'))
ACCOUNTS_UI = json.loads((ROOT / 'tests/permissions/accounts-ui-routes.json').read_text(encoding='utf-8'))
PROJECT_CONTENT = json.loads((ROOT / 'tests/permissions/project-content-routes.json').read_text(encoding='utf-8'))
MEDIA = json.loads((ROOT / 'tests/permissions/media-routes.json').read_text(encoding='utf-8'))
UNITS = json.loads((ROOT / 'tests/permissions/unit-type-routes.json').read_text(encoding='utf-8'))
FAQ_INTAKE = json.loads((ROOT / 'tests/permissions/faq-intake-routes.json').read_text(encoding='utf-8'))
FAQ_COVERAGE = json.loads((ROOT / 'tests/permissions/faq-coverage-routes.json').read_text(encoding='utf-8'))
WEB = json.loads((ROOT / 'tests/permissions/web-publication-routes.json').read_text(encoding='utf-8'))
ARTICLES = json.loads((ROOT / 'tests/permissions/article-routes.json').read_text(encoding='utf-8'))
COMMERCIAL = json.loads((ROOT / 'tests/permissions/project-commercial-routes.json').read_text(encoding='utf-8'))
AMENITIES = json.loads((ROOT / 'tests/permissions/project-amenities-routes.json').read_text(encoding='utf-8'))
WORKSPACE = json.loads((ROOT / 'tests/permissions/workspace-home-routes.json').read_text(encoding='utf-8'))
ROUTES = [r for r in MANIFEST['routes'] if not r['conditional_h1']] + FOUNDATION['routes'] + SHARED['routes'] + ACCOUNTS_UI['routes'] + PROJECT_CONTENT['routes'] + MEDIA['routes'] + UNITS['routes'] + FAQ_INTAKE['routes'] + COMMERCIAL['routes'] + FAQ_COVERAGE['routes'] + AMENITIES['routes'] + ARTICLES['routes'] + WEB['routes']
ROLES = ('viewer', 'editor', 'publisher', 'admin', 'online_staff', 'agency_kin', 'agency_combay', 'service_consumer')
ROUTES += WORKSPACE['routes']
STATES = ('ACTIVE', 'PENDING', 'REJECTED', 'SUSPENDED')
INLINE_READS = {'/v1/me', '/v1/accounts/display-names', '/v1/capabilities', '/v1/admin/questions'}


async def disposable_operator():
    """Verify the actual cluster on the same connection before ANY mutation."""
    run = Path(os.environ['HUB_DISPOSABLE_TEST_RUN']).resolve(strict=True)
    assert run.is_relative_to((ROOT / '.local/test-runs').resolve(strict=True))
    marker = json.loads((run / 'run.json').read_text(encoding='utf-8'))
    expected = (run / 'postgres').resolve(strict=True)
    assert expected != (ROOT / '.local/postgres').resolve()
    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
    db = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local', user='postgres', password=config['adminPassword'])
    try:
        assert Path(await db.fetchval('SHOW data_directory')).resolve(strict=True) == expected
        assert await db.fetchval('SELECT run_id FROM public.disposable_test_run') == marker['run_id']
    except BaseException:
        await db.close()
        raise
    return db


class PrivateIdentityMap(dict):
    def __repr__(self):
        return '<disposable identities; authentication material hidden>'


@pytest.fixture(scope='module')
def baseline_client():
    identities = PrivateIdentityMap({(role, status): {'id': uuid4(), 'token': secrets.token_urlsafe(32)} for role in ROLES for status in STATES})

    async def seed(remove=False):
        db = await disposable_operator()
        try:
            if remove:
                await db.execute('delete from hub.user_account where id=any($1::uuid[])', [i['id'] for i in identities.values()])
            else:
                for (role, status), identity in identities.items():
                    agency = {'agency_kin': 'KIN', 'agency_combay': 'COMBAY'}.get(role)
                    await db.execute("insert into hub.user_account(id,email,display_name_th,status,hub_role,agency_code) values($1,$2,'บัญชีสมมติ',$3,$4,$5)",
                                     identity['id'], f"{identity['id']}@example.test", status, 'agency' if agency else role, agency)
        finally:
            await db.close()

    asyncio.run(seed())
    by_token = {identity['token']: identity for identity in identities.values()}

    def verify(_self, token):
        identity = by_token[token]
        # Deliberately forged claims; the real table lookup must win.
        return {'sub': str(identity['id']), 'email': f"{identity['id']}@example.test", 'role': 'admin',
                'app_metadata': {'hub_role': 'admin', 'agency_code': 'COMBAY'},
                'user_metadata': {'hub_role': 'admin', 'can_manage_users': True}}

    async def entry_reached(**_kwargs):
        return Response(status_code=204)

    settings = Settings(database_url=os.environ['HUB_TEST_DATABASE_URL'], auth_mode='supabase',
                        environment='local', supabase_url='https://auth.example.invalid')
    patch = pytest.MonkeyPatch()
    patch.setattr(Authentication, 'verify_jwt', verify)
    app = create_app(settings)
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path not in INLINE_READS:
            route.dependant.call = entry_reached
    try:
        with TestClient(app, client=('127.0.0.1', 50000)) as client:
            yield client, identities
    finally:
        patch.undo()
        asyncio.run(seed(remove=True))


def test_every_concrete_route_has_a_reviewed_permission_mapping(baseline_client):
    client, _ = baseline_client
    actual = {(method, route.path) for route in client.app.routes if isinstance(route, APIRoute) for method in route.methods}
    expected = {(r['method'], r['path']) for r in ROUTES}
    assert len(WORKSPACE['routes']) == 2
    assert len(PROJECT_CONTENT['routes']) == 32
    assert len(MEDIA['routes']) == 18  # H5e adds the projects/view AI-state read.
    assert len(COMMERCIAL['routes']) == 6
    assert len(UNITS['routes']) == 7
    assert len(FAQ_INTAKE['routes']) == 3
    assert len(FAQ_COVERAGE['routes']) == 5
    assert len(ARTICLES['routes']) == 8
    assert len(WEB['routes']) == 14
    assert len(AMENITIES['routes']) == 11
    assert len(expected) == len(ROUTES) == 200 + len(FOUNDATION['routes']) + len(SHARED['routes']) + len(ACCOUNTS_UI['routes']) + len(PROJECT_CONTENT['routes']) + len(MEDIA['routes']) + len(UNITS['routes']) + len(FAQ_INTAKE['routes']) + len(COMMERCIAL['routes']) + len(FAQ_COVERAGE['routes']) + len(AMENITIES['routes']) + len(ARTICLES['routes']) + len(WEB['routes']) + len(WORKSPACE['routes'])
    assert actual == expected, {'unmapped': sorted(actual - expected), 'removed': sorted(expected - actual)}
    assert all(r['tab'] and r['level'] in {'view', 'edit', 'approve', 'admin', 'other', 'edit/approve'} for r in ROUTES)


def test_no_role_header_authenticates_an_anonymous_route_caller(baseline_client):
    client, _ = baseline_client
    for entry in ROUTES:
        path = re.sub(r'\{[^}]+\}', '00000000-0000-0000-0000-000000000000', entry['path'])
        response = client.request(entry['method'], path, headers={'X-Hub-Role': 'admin'},
                                  json={} if entry['method'] != 'GET' else None)
        assert response.status_code == (204 if path == '/health' else 401), (entry['method'], entry['path'])


@pytest.mark.parametrize('role', ROLES)
@pytest.mark.parametrize('status', STATES)
def test_every_route_entry_uses_account_authority_despite_forged_claims(baseline_client, role, status):
    client, identities = baseline_client
    identity = identities[role, status]
    db_role = 'agency' if role.startswith('agency_') else role
    headers = {'Authorization': f"Bearer {identity['token']}", 'X-Hub-Role': 'admin', 'X-Agency-Code': 'COMBAY'}
    version = client.get('/v1/me', headers=headers).json()['data']['updated_at']
    for entry in ROUTES:
        method, path = entry['method'], entry['path']
        url = re.sub(r'\{[^}]+\}', '00000000-0000-0000-0000-000000000000', path)
        response = client.request(method, url, headers=headers, json={} if method != 'GET' else None)
        limited = path in ('/health', '/v1/me', '/v1/me/access-request') or status == 'PENDING' and path == '/v1/me/invite-accept'
        denied = (status != 'ACTIVE' and not limited) or status == 'ACTIVE' and db_role not in entry['entry_roles']
        # Owner-approved Phase 2 conversion: publisher draft/model/media edits
        # require E. Model confirmation/rejection is also E.
        if status == 'ACTIVE' and db_role == 'publisher':
            if entry['tab'].startswith('projects') and entry['level'] == 'edit' or entry['path'].endswith('/models/{public_model_id}/review'):
                denied = True
            # Promotion drafts remain denied to publisher at both boundaries;
            # the old brand_writer dependency already enforced this entry rule.
            if entry['tab'] == 'promotions' and entry['level'] == 'edit':
                denied = True
        if status == 'ACTIVE' and entry['path'].startswith('/v1/admin/knowledge/'):
            # These guards used to live inside handlers, beyond this entry probe.
            if entry['path'].endswith('/preview-release') or entry['path'].endswith('/rights/approve'):
                denied = db_role != 'publisher'
        if status == 'ACTIVE' and path == '/v1/admin/ads/archive/{document_id}/hold':
            # Phase 5 moves the existing inline legal-hold guard ahead of the
            # stubbed handler. Default template access is unchanged.
            denied = db_role != 'admin'
        # Owner decision: exact published website payloads are independent of
        # internal tab boxes; agency remains excluded from the direct API.
        if status == 'ACTIVE' and entry['tab'].startswith('published'):
            denied = db_role not in {'viewer', 'editor', 'publisher', 'admin', 'online_staff', 'service_consumer'}
        expected = {403} if denied else {200, 422} if path in INLINE_READS else {204, 422}
        assert response.status_code in expected, (role, status, method, path, response.status_code)
        if path == '/v1/me':
            account = response.json()['data']
            assert account['status'] == status
            assert account['role'] == (db_role if status == 'ACTIVE' else None)
            assert account['agency'] == ({'agency_kin': 'KIN', 'agency_combay': 'COMBAY'}.get(role) if status == 'ACTIVE' else None)
    assert client.get('/v1/me', headers=headers).json()['data']['updated_at'] == version
