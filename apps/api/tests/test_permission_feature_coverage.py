"""Feature onboarding coverage must itself catch missing authorization work."""
import asyncio
import re

import pytest
import asyncpg
from fastapi.routing import APIRoute

from sena_hub_api.content_permissions import CONTENT_RULES, SHARED_RULES, route_class
from test_permission_baseline import ROOT, disposable_operator
from test_permission_db_baseline import assert_reviewed_database_boundary, runtime
from test_permission_foundations import permission_accounts, h
from test_permission_content import call


def assert_classified_routes(pairs):
    expected = set(CONTENT_RULES) | {key for key, value in SHARED_RULES.items() if value != 'unavailable'}
    assert pairs == expected, {'unmapped': pairs - expected, 'removed': expected - pairs}


def assert_catalog_navigation(catalog, nav):
    # Accounts is deliberately not a data-tab permission; the separate flag
    # controls it. Everything else must exist in the server-owned catalog.
    assert len(nav) == len(set(nav)), 'Duplicate navigation tab'
    assert set(nav) == set(catalog) | {'accounts'}, {
        'unmapped': set(nav) - set(catalog) - {'accounts'},
        'missing': set(catalog) - set(nav),
    }


def test_navigation_and_route_actions_match_live_permission_catalog(permission_accounts):
    client, _ = permission_accounts
    data = client.get('/v1/admin/permissions/catalog', headers=h('admin')).json()['data']
    catalog = {row['tab']: row for row in data['tabs']}
    source = (ROOT / 'apps/admin/components/hub-navigation-data.ts').read_text(encoding='utf-8')
    nav = re.findall(r'\bid:\s*["\']([a-z_]+)["\']\s*,\s*href:', source)
    assert_catalog_navigation(catalog, nav)
    for (_method, _path), (tab, action) in CONTENT_RULES.items():
        if tab == 'assets':
            # Shared bytes/upload predicate is a documented disjunction of
            # these source tabs; it must not become an unowned extra nav tab.
            assert action in ('view', 'edit')
            assert {'projects', 'brands', 'knowledge'} <= catalog.keys()
            continue
        assert tab in catalog, tab
        for level in action if isinstance(action, tuple) else (action,):
            assert level in catalog[tab]['levels'] + catalog[tab]['special_actions'], (tab, level)
    pairs = {(method, route.path) for route in client.app.routes if isinstance(route, APIRoute)
             for method in route.methods}
    assert_classified_routes(pairs)


def test_coverage_rejects_an_unmapped_api_method_or_navigation_item(permission_accounts):
    client, _ = permission_accounts
    pairs = {(method, route.path) for route in client.app.routes if isinstance(route, APIRoute)
             for method in route.methods}
    assert_classified_routes(pairs)
    for addition in [('GET', '/v1/admin/feature-without-permission'), ('DELETE', '/v1/admin/permissions/catalog')]:
        assert route_class(*addition) is None
        with pytest.raises(AssertionError):
            assert_classified_routes(pairs | {addition})
    with pytest.raises(AssertionError):
        assert_catalog_navigation({'projects'}, ['projects', 'accounts', 'unmapped'])
    with pytest.raises(AssertionError):
        assert_catalog_navigation({'projects', 'new_tab'}, ['projects', 'accounts'])


@pytest.mark.parametrize('mutation', ['unclassified_table', 'rls_disabled', 'force_rls_removed', 'guard_removed'])
def test_database_coverage_detects_unreviewed_or_unguarded_feature_storage(mutation):
    async def check():
        # Verify the ordinary, actual non-superuser view of pg_catalog first.
        db = await runtime()
        try:
            await assert_reviewed_database_boundary(db)
        finally:
            await db.close()
        operator = await disposable_operator()
        try:
            transaction = operator.transaction()
            await transaction.start()
            try:
                if mutation == 'unclassified_table':
                    await operator.execute('create table hub.unreviewed_permission_test(id integer)')
                elif mutation == 'rls_disabled':
                    await operator.execute('alter table hub.projects disable row level security')
                elif mutation == 'force_rls_removed':
                    await operator.execute('alter table hub.projects no force row level security')
                else:
                    # Keep the table, FORCE RLS and policies present, but remove
                    # their actual permission predicates. RLS-on alone is not enough.
                    await operator.execute('alter policy content_permission on hub.projects using(true)')
                    await operator.execute('alter policy content_app_read on hub.projects using(true)')
                with pytest.raises(AssertionError):
                    await assert_reviewed_database_boundary(operator)
            finally:
                await transaction.rollback()
            await assert_reviewed_database_boundary(operator)
        finally:
            await operator.close()
    asyncio.run(check())


@pytest.mark.parametrize('tab,path', [
    ('projects', '/v1/admin/projects'), ('brands', '/v1/admin/brands'),
    ('promotions', '/v1/admin/promotions'), ('releases', '/v1/admin/releases'),
    ('knowledge', '/v1/admin/knowledge/projects'), ('registry', '/v1/admin/ads/registrations'),
    ('finance', '/v1/admin/ads/memos'), ('actuals', '/v1/admin/ads/actuals'),
    ('documents', '/v1/admin/ads/document-tracking'), ('archive', '/v1/admin/ads/archive'),
    ('exceptions', '/v1/admin/ads/findings'), ('questions', '/v1/admin/questions'),
])
def test_explicit_grid_assignment_and_removal_control_every_tab_on_next_request(permission_accounts, tab, path):
    client, ids = permission_accounts
    neighbour = 'brands' if tab == 'questions' else 'questions'
    neighbour_path = '/v1/admin/brands' if tab == 'questions' else '/v1/admin/questions'
    target = f'/v1/admin/accounts/{ids["viewer"]}/permissions'
    def assign(tabs):
        version = client.get('/v1/me', headers=h('viewer')).json()['data']['updated_at']
        response = client.post(target, headers=h('admin'), json={'updated_at': version, 'tabs': tabs})
        assert response.status_code == 200, response.json()
    assign({tab: ['view'], neighbour: ['view']})
    assert client.get('/v1/me', headers=h('viewer')).json()['data']['role'] == 'viewer'
    assert client.get(path, headers=h('viewer')).status_code == 200
    async def sql(allowed):
        db = await runtime()
        try:
            if allowed:
                await call(db, ids['viewer'], 'select hub.require_permission($1,\'view\')', tab)
            else:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['viewer'], 'select hub.require_permission($1,\'view\')', tab)
            assert await call(db, ids['viewer'], 'select hub.can($1,\'view\')', neighbour)
        finally:
            await db.close()
    asyncio.run(sql(True))
    assign({neighbour: ['view']})
    assert client.get(path, headers=h('viewer')).status_code == 403
    assert client.get(neighbour_path, headers=h('viewer')).status_code == 200
    asyncio.run(sql(False))
