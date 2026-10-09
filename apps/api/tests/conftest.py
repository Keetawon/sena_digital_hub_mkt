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
            # Expected owner templates for route doubles only. Real lifespan
            # tests load capabilities from SQL and verify next-request changes.
            view = role in {'viewer', 'editor', 'publisher', 'admin'}
            edit = role in {'editor', 'admin'}
            approve = role == 'publisher'
            capabilities = {
                'tabs': {tab: {'view': view, 'edit': edit, 'approve': approve}
                         for tab in ('projects', 'brands', 'promotions', 'knowledge')},
                'special_actions': {'brands.manage_catalog': role == 'admin'},
            }
            capabilities['tabs']['releases'] = {'view': view, 'edit': False, 'approve': approve}
            capabilities['tabs']['registry'] = {'view': role in {'admin', 'online_staff'},
                                                'edit': role in {'admin', 'online_staff'}, 'approve': False}
            for tab in ('finance', 'archive', 'actuals', 'documents', 'exceptions'):
                capabilities['tabs'][tab] = {'view': role in {'admin', 'online_staff'},
                    'edit': tab != 'actuals' and role in {'admin', 'online_staff'},
                    'approve': tab in {'finance', 'archive'} and role in {'admin', 'online_staff'}}
            for action in ('finance.review_identifiers_corrections', 'archive.legal_hold'):
                capabilities['special_actions'][action] = role == 'admin'
            capabilities['agency_registry'] = role in DEMO_AGENCIES
            capabilities['tabs']['questions'] = {'view': role in {'viewer', 'editor', 'publisher', 'admin', 'online_staff'}, 'edit': False, 'approve': False}
            capabilities['published_consumer'] = role in {'viewer', 'editor', 'publisher', 'admin', 'online_staff'}
            capabilities['can_manage_users'] = role == 'admin'
            return {'id': claims['sub'], 'email': claims['email'], 'status': 'ACTIVE',
                    'hub_role': 'agency' if role in DEMO_AGENCIES else role,
                    'agency_code': DEMO_AGENCIES.get(role), 'display_name_th': role,
                    'can_manage_users': role == 'admin', 'capabilities': capabilities}
        return await original(self, request, claims)

    monkeypatch.setattr(Authentication, 'load_account', lookup)
