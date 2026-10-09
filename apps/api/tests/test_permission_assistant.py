"""Assistant capability probes use disposable PostgreSQL, no provider calls."""
import asyncio
import json
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_permission_baseline import disposable_operator
from test_permission_db_baseline import runtime
from test_permission_foundations import permission_accounts, h
from test_permission_content import call, set_bit


RULES = [
    ('get_project', 'project', 'projects'), ('find_projects', 'project', 'projects'),
    ('get_models', 'project', 'projects'), ('get_brand', 'brand', 'brands'),
    ('check_publish_readiness', 'project', 'projects'), ('check_publish_readiness', 'brand', 'brands'),
    ('check_publish_readiness', 'promotion', 'promotions'), ('search_content', 'project', 'projects'),
    ('search_content', 'brand', 'brands'), ('get_promotions', 'promotion', 'promotions'),
    ('get_campaign', 'campaign', 'registry'), ('find_campaigns', 'campaign', 'registry'),
    ('get_project_marketing', 'media_line', 'finance'), ('get_line_actuals', 'media_line', 'actuals'),
    ('explain_name', 'naming_rule', 'registry'), ('search_documents', 'memo', 'archive'),
]


@pytest.mark.parametrize('tool,kind,tab', RULES)
@pytest.mark.parametrize('role', ['hub_app', 'admin', 'viewer'])
def test_assistant_exact_source_permission_and_neighbor(permission_accounts, tool, kind, tab, role):
    _, ids = permission_accounts
    async def check():
        db = await runtime(probe=role != 'hub_app')
        try:
            before = json.loads(await call(db, ids['admin'], 'select internal.assistant_access($1,$2)::text', tool, kind, role=role))
            assert tool in before['allowed_tools']
            await set_bit(ids['admin'], tab, can_edit=False, can_approve=False, special_actions=[], can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['admin'], 'select internal.assistant_access($1,$2)', tool, kind, role=role)
            neighbor = ('get_brand', 'brand') if tab != 'brands' else ('get_project', 'project')
            after = json.loads(await call(db, ids['admin'], 'select internal.assistant_access($1,$2)::text', *neighbor, role=role))
            assert before['fingerprint'] != after['fingerprint']
            assert not {'email', 'phone', 'tabs', 'account_id', 'can_manage_users'} & after.keys()
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('entry,tab', [
    ("internal.assistant_project_reference('synthetic')", 'promotions'),
    ("internal.assistant_campaign_codes('',null,null,null,null,5)", 'registry'),
    ("internal.assistant_campaign_codes('',null,date '2026-10-01',null,null,5)", 'finance'),
    ("internal.assistant_marketing_lines('synthetic',date '2026-10-01')", 'finance'),
    ("internal.assistant_marketing_lines('synthetic',date '2026-10-01')", 'actuals'),
    ("internal.assistant_content_version('project','synthetic',gen_random_uuid())", 'projects'),
    ("internal.assistant_content_version('brand','synthetic',gen_random_uuid())", 'brands'),
])
def test_assistant_bounded_sql_entry_denies_missing_capability(permission_accounts, entry, tab):
    _, ids = permission_accounts
    async def check():
        db = await runtime()
        try:
            await set_bit(ids['admin'], tab, can_edit=False, can_approve=False, special_actions=[], can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['admin'], 'select ' + entry)
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('query', [
    "select internal.assistant_project_reference('missing-synthetic') is null",
    "select count(*)=0 from internal.assistant_campaign_codes('missing-synthetic',null,null,null,null,5)",
    "select count(*)=0 from internal.assistant_campaign_codes('missing-synthetic',null,date '2026-10-01',null,null,5)",
    "select count(*)=0 from internal.assistant_marketing_lines('missing-synthetic',date '2026-10-01')",
    "select internal.assistant_content_version('project','missing-synthetic',gen_random_uuid()) is null",
    "select internal.assistant_content_version('brand','missing-synthetic',gen_random_uuid()) is null",
])
def test_assistant_bounded_sql_positive_empty_results(permission_accounts, query):
    _, ids = permission_accounts
    async def check():
        db = await runtime()
        try:
            assert await call(db, ids['admin'], query) is True
        finally:
            await db.close()
    asyncio.run(check())


def test_assistant_exact_old_version_projects_hidden_brand_and_assets(permission_accounts):
    _, ids = permission_accounts
    async def check():
        await set_bit(ids['viewer'], 'brands', can_view=False)
        db = await disposable_operator()
        transaction = db.transaction()
        await transaction.start()
        try:
            project = await db.fetchrow("select id,public_project_id from hub.projects where rem_project_id='DEMO-001'")
            base = await db.fetchval('select coalesce(max(version_no),0) from hub.entity_versions where project_id=$1', project['id'])
            payload = {'public_name': {'th': 'Synthetic history'},
                       'brand': {'public_name': {'th': 'Synthetic brand'}, 'description': 'Hidden brand detail'},
                       'brand_version_id': str(uuid4()), 'assets': [{'id': str(uuid4()), 'storage_path': 'hidden-synthetic.png'}]}
            await db.execute("""insert into hub.entity_versions(project_id,version_no,payload,publisher,change_reason)
                select $1,n,$2::jsonb,$3,'Synthetic citation history' from generate_series($4::integer,$5::integer) n""",
                project['id'], json.dumps(payload), ids['publisher'], base + 1, base + 105)
            oldest = await db.fetchval('select id from hub.entity_versions where project_id=$1 and version_no=$2', project['id'], base + 1)
            await db.execute('SET LOCAL SESSION AUTHORIZATION hub_runtime')
            await db.execute('SET LOCAL ROLE hub_app')
            assert await db.fetchval('select session_user') == 'hub_runtime'
            assert not await db.fetchval('select rolsuper or rolbypassrls from pg_roles where rolname=current_user')
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['viewer']))
            result = json.loads(await db.fetchval("select internal.assistant_content_version('project',$1,$2)::text", project['public_project_id'], oldest))
            assert result['payload']['public_name'] == payload['public_name']
            assert result['payload']['brand'] == {'public_name': {'th': 'Synthetic brand'}}
            assert result['payload']['assets'] == [] and 'brand_version_id' not in result['payload']
            assert await db.fetchval("select internal.assistant_content_version('project','different-synthetic-project',$1)", oldest) is None
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())


def test_assistant_history_citations_recheck_finance_filter_and_uuid_ownership(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db = await runtime(probe=True)
        outer = db.transaction()
        await outer.start()
        try:
            run = json.loads(await call(db, ids['admin'], "select internal.assistant_run_create($1::jsonb)::text",
                                       json.dumps({'mode': 'SYNTHETIC', 'config_version': 'permission-test'})))
            rid = UUID(run['id'])
            receipt = json.loads(await call(db, ids['admin'], 'select internal.assistant_tool_record($1,$2::jsonb)::text', rid,
                json.dumps({'tool_name': 'find_campaigns', 'outcome': 'SUCCESS', 'duration_ms': 1, 'requires_finance': True,
                            'sources': [{'namespace': 'internal_ads', 'entity_type': 'campaign', 'entity_id': 'SYNTHETIC', 'version': 'synthetic'}]})))
            cid = UUID(receipt['citations'][0]['id'])
            assert await call(db, ids['admin'], 'select internal.assistant_citation_read($1,$2)', rid, cid, role='viewer')
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['second'], 'select internal.assistant_run_read($1)', rid)
            await set_bit(ids['admin'], 'finance', can_edit=False, can_approve=False, special_actions=[], can_view=False)
            history = json.loads(await call(db, ids['admin'], 'select internal.assistant_run_read($1)::text', rid))
            assert history['citations'] == [] and history['tools'] == []
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['admin'], 'select internal.assistant_citation_read($1,$2)', rid, cid)
            assert await call(db, ids['admin'], "select internal.assistant_access('find_campaigns','campaign',false)")
            assert await call(db, ids['admin'], 'select internal.assistant_run_finish($1,$2::jsonb)', rid,
                              json.dumps({'status': 'CANCELLED', 'duration_ms': 1}))
        finally:
            await outer.rollback()
            await db.close()
    asyncio.run(check())


def test_assistant_manager_project_proposal_and_external_config_denied(permission_accounts):
    client, ids = permission_accounts
    for role in ['agency', 'service_consumer', 'pending']:
        assert client.get('/v1/admin/assistant/config', headers=h(role)).status_code == 403
    config = client.get('/v1/admin/assistant/config', headers=h('publisher'))
    assert config.status_code == 200, config.text
    assert config.json()['data']['proposal_fields'] == {}
    async def check():
        db = await runtime()
        try:
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['publisher'], 'select internal.assistant_proposal_create($1::jsonb)', json.dumps({
                    'entity_type': 'project', 'entity_id': str(uuid4()), 'field_path': 'meta_title.th',
                    'new_text': 'Synthetic', 'expected_updated_at': '2026-10-09T00:00:00Z'}))
            for table in ['assistant_run', 'assistant_tool', 'assistant_citation', 'assistant_proposal', 'assistant_proposal_application']:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['admin'], f'select count(*) from internal.{table}')
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['admin'], 'select internal.assistant_require_actor()')
        finally:
            await db.close()
    asyncio.run(check())
