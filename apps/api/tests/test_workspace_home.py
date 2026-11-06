"""W2 uses the real caller and disposable SQL; reads never create gap/audit rows."""
import asyncio

import asyncpg
import pytest

from content_workflow_fixture import load_sql_fixture
from sena_hub_api.workspace_home import workspace_href
from urllib.parse import parse_qs, urlsplit
from test_permission_baseline import ROOT, disposable_operator
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h
from test_project_content_core import runtime


@pytest.mark.parametrize('role', ['agency', 'service_consumer', 'pending', 'online_staff'])
@pytest.mark.parametrize('path', ['/v1/admin/content/search?q=DEMO', '/v1/admin/content/home'])
def test_workspace_requires_active_internal_source_view(permission_accounts, role, path):
    client, _ = permission_accounts
    assert client.get(path, headers=h(role)).status_code == 403


def test_search_filters_sources_before_results_and_retains_neighbour(permission_accounts):
    client, ids = permission_accounts
    response = client.get('/v1/admin/content/search', params={'q': 'DEMO'}, headers=h('viewer'))
    assert response.status_code == 200, response.text
    before = response.json()['data']['items']
    assert any(row['kind'] == 'project' for row in before)
    assert 'no-store' in response.headers['cache-control']
    asyncio.run(set_bit(ids['viewer'], 'projects', can_view=False))
    response = client.get('/v1/admin/content/search', params={'q': 'DEMO'}, headers=h('viewer'))
    assert response.status_code == 200, response.text
    restricted = response.json()['data']['items']
    assert not any(row['kind'] == 'bud' for row in restricted)
    assert all(row['context']['tab'] == 'faq' for row in restricted if row['kind'] == 'project')
    asyncio.run(set_bit(ids['viewer'], 'knowledge', can_view=False))
    closed = client.get('/v1/admin/content/search', params={'q': 'DEMO'}, headers=h('viewer'))
    assert closed.status_code == 200
    assert not any(row['kind'] in ('project', 'bud') for row in closed.json()['data']['items'])
    assert client.get('/v1/admin/brands', headers=h('viewer')).status_code == 200
    assert all(row['href'].startswith('/') and not row['href'].startswith('//') for row in before)


def test_home_reads_do_not_record_gaps_or_audit_and_project_revocation_clears_counts(permission_accounts):
    client, ids = permission_accounts

    async def counts():
        db = await disposable_operator()
        try:
            return tuple(await db.fetchrow('select (select count(*) from audit.change_log),(select count(*) from hub.content_gaps)'))
        finally:
            await db.close()

    before = asyncio.run(counts())
    for _ in range(2):
        response = client.get('/v1/admin/content/home', headers=h('viewer'))
        assert response.status_code == 200, response.text
        data = response.json()['data']
        assert data['project_total'] >= len(data['projects']) > 0
        for project in data['projects']:
            assert 'project=' in project['href']
            for field in project['readiness']['items']:
                assert 'field=' in field['href']
        assert not any(key in str(data) for key in ('password', 'access_token', 'special_actions', 'account_permission'))
    assert asyncio.run(counts()) == before
    asyncio.run(set_bit(ids['viewer'], 'projects', can_view=False))
    response = client.get('/v1/admin/content/home', headers=h('viewer'))
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['projects'] == [] and data['project_total'] == 0 and data['buds'] == []
    assert data['brands'], 'Brands View must retain its own readiness without Projects View'
    assert all(row['projects'] == 0 and row['project_required_missing'] == 0 for row in data['brands'])
    assert all('readiness' in row and 'items' in row['readiness'] for row in data['brands'])


def test_private_helpers_are_not_callable(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            for sql in ("select hub.workspace_project_bu()", "select hub.content_scope_allowed('project','unknown','view')",
                        'select hub.workspace_review_rows()', 'select hub.workspace_content_tasks()'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['viewer'], sql)
            for actor in ('agency', 'pending', 'service_consumer'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids[actor], "select hub.workspace_search('test',20)")
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('path', [
    '/v1/admin/content/search?limit=31', '/v1/admin/content/search?q=' + 'x' * 121,
    '/v1/admin/content/home?offset=-1', '/v1/admin/content/home?limit=101',
    '/v1/admin/content/home?task=unknown', '/v1/admin/content/home?brand=../../private',
])
def test_workspace_input_bounds(permission_accounts, path):
    client, _ = permission_accounts
    assert client.get(path, headers=h('viewer')).status_code == 422


def test_href_is_local_and_preserves_exact_bu_and_item_context():
    assert workspace_href('bud', {'bud': '  BUD-031  ', 'url': 'https://example.invalid'}) == '/home?bud=++BUD-031++'
    assert workspace_href('faq', {'faq': 'f-1', 'question': 'project_fee'}) == '/faq?faq=f-1&question=project_fee'


@pytest.mark.parametrize('kind,context,path,keys', [
    ('', {'project': 'P-1', 'field': 'project.meta_title'}, '/', {'project': 'P-1', 'field': 'project.meta_title'}),
    ('price', {'project': 'P-1', 'tab': 'prices', 'unit_type': 'U-1', 'item': 'price-1'}, '/', {'unit_type': 'U-1', 'item': 'price-1'}),
    ('', {'project': 'P-1', 'tab': 'buildings', 'field': 'building.name', 'building': 'B-1', 'grain': 'building'}, '/content', {'building': 'B-1', 'grain': 'building'}),
    ('', {'project': 'P-1', 'media_category': 'floor_plan', 'target_type': 'building', 'target_key': 'B-1', 'floor_from': 2, 'floor_to': 3, 'tags': ['pool', 'roof'], 'usage': 'gallery'}, '/media', {'floor_from': '2', 'floor_to': '3', 'target_key': 'B-1', 'tags': '["pool","roof"]'}),
    ('brand', {'brand': 'B-1', 'field': 'assets.logo_primary'}, '/', {'brand': 'B-1', 'field': 'assets.logo_primary'}),
    ('glossary', {'tab': 'glossary', 'term': 'synthetic'}, '/faq', {'term': 'synthetic'}),
    ('', {'gap': 'gap-1', 'project': 'P-1'}, '/home', {'gap': 'gap-1', 'project': 'P-1'}),
])
def test_exact_target_context_is_preserved(kind, context, path, keys):
    target = urlsplit(workspace_href(kind, context))
    assert target.path == path
    query = parse_qs(target.query)
    assert all(query[key] == [value] for key, value in keys.items())


def test_workspace_sql_projection_regressions():
    """Run the transactional projection cases under the documented quick gate."""
    async def check():
        db = await disposable_operator()
        try:
            await load_sql_fixture(db)
            await db.execute((ROOT / 'supabase/tests/workspace_home.sql').read_text(encoding='utf-8'))
        finally:
            await db.close()
    asyncio.run(check())


def test_inherited_fact_answer_keeps_unit_specific_missing_price_task(permission_accounts):
    from test_faq_coverage import answer, question
    from test_unit_type_workflow import create_type, project
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            parent = await project(db, ids['editor'])
            unit = await create_type(db, ids['editor'], parent)
            core = await call(db, ids['editor'], 'select to_jsonb(p) from hub.projects p where public_project_id=$1', parent['public_project_id'])
            key = await question(db, ids, keys=['price.amount'], kind='fact')
            await answer(db, ids, core, key, answer_kind='fact', fact_keys=['price.amount'], short_answer={'th': '{project} {amount}'})
            assert not await call(db, ids['viewer'], "select exists(select 1 from hub.faqs where scope_type='unit_type' and scope_id=$1)", unit['id'])
            home = await call(db, ids['viewer'], "select hub.workspace_home(null,null,0,100,'fact_missing')")
            assert any(row['context'].get('unit_type') == unit['public_commercial_type_id'] and row['context'].get('question') == key
                       and row['context']['tab'] == 'prices' for row in home['tasks'])
        finally:
            await db.close()
    asyncio.run(check())


def test_page_configuration_task_opens_single_publishing_workspace():
    from urllib.parse import parse_qs, urlsplit
    from sena_hub_api.workspace_home import workspace_href

    href = workspace_href('page_config', {
        'tab': 'publication', 'page': 'project:W4+synthetic', 'field': 'page.url',
        'item': 'exact-config-id', 'version': 'exact-review-id',
        'href': 'https://untrusted.invalid/',
    })
    parsed = urlsplit(href)
    assert not parsed.scheme and not parsed.netloc and parsed.path == '/publish'
    assert parse_qs(parsed.query) == {
        'tab': ['configuration'], 'page': ['project:W4+synthetic'],
        'field': ['page.url'], 'item': ['exact-config-id'], 'version': ['exact-review-id'],
    }
