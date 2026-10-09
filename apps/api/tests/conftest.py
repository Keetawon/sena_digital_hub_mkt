"""Fail before collection if an API test could reach the working database."""
import os
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]


def pytest_sessionstart(session):
    if session.config.option.collectonly:
        return
    # The shared guard verifies PostgreSQL's actual data_directory and a unique
    # database marker; setting an environment flag alone cannot authorize it.
    result = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import {assertDisposableTestDatabase} from './scripts/disposable-test-guard.mjs'; await assertDisposableTestDatabase();"],
        cwd=ROOT, env=os.environ, capture_output=True, text=True,
    )
    if result.returncode:
        raise pytest.UsageError("API tests require the disposable runner: npm run test:api -- [pytest arguments]. No tests were executed.")


@pytest.fixture(autouse=True)
def account_lookup_for_route_unit_tests(monkeypatch):
    """Route unit doubles have no lifespan/pool. Model their seeded ACTIVE accounts.

    Lifespan/integration suites use the real account lookup without interception.
    """
    from sena_hub_api.auth import Authentication, ALL_DEMO_ACTORS, DEMO_AGENCIES
    original = Authentication.load_account

    async def lookup(self, request, claims):
        if 'app' not in request.scope or not hasattr(request.app.state, 'pool'):
            role = next((r for r, uid in ALL_DEMO_ACTORS.items() if str(uid) == claims['sub']), None)
            assert role is not None, 'Unit test must supply an explicit account fixture'
            return {'id': claims['sub'], 'email': claims['email'], 'status': 'ACTIVE',
                    'hub_role': 'agency' if role in DEMO_AGENCIES else role,
                    'agency_code': DEMO_AGENCIES.get(role), 'display_name_th': role,
                    'can_manage_users': role == 'admin'}
        return await original(self, request, claims)

    monkeypatch.setattr(Authentication, 'load_account', lookup)
