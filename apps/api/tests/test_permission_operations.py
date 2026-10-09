"""Phase 5 real non-superuser SQL denials and next-request API permissions."""
import asyncio
import json
from uuid import uuid4

import asyncpg
import pytest
from fastapi.routing import APIRoute

from sena_hub_api.content_permissions import CONTENT_RULES
from test_permission_baseline import disposable_operator
from test_permission_db_baseline import runtime, OPERATIONS_TABLES
from test_permission_foundations import permission_accounts, h
from test_permission_content import set_bit
from test_permission_registry import call

EDIT = "memo_create memo_update memo_identifier_propose line_create revision_create revision_update correction_create ledger_import card_import ad_account_create channel_account_create ad_account_version_create channel_account_version_create commitment_create commitment_revise commitment_cover_create commitment_occurrence_create cost_classify".split()
APPROVE = "memo_confirm revision_confirm line_archive assignment_create assignment_replace assignment_end assignment_acknowledge correction_apply ad_account_version_confirm channel_account_version_confirm ad_account_version_close channel_account_version_close commitment_activate commitment_suspend card_batch_confirm card_batch_replace cost_allocate".split()
SPECIAL = "memo_identifier_review memo_identifier_retire correction_review correction_retire".split()
READ = {
    'finance': "ads.finance_read('memos')",
    'actuals': "ads.actuals_read('actuals')",
    'documents': "ads.actuals_read('document-tracking')",
    'exceptions': "ads.actuals_read('findings')",
    'archive': "ads.archive_read()",
}


def test_operations_route_coverage(permission_accounts):
    client, _ = permission_accounts
    actual = {(method, r.path) for r in client.app.routes if isinstance(r, APIRoute)
              and r.endpoint.__module__ in {'sena_hub_api.finance', 'sena_hub_api.actuals', 'sena_hub_api.archive'}
              for method in r.methods}
    expected = {k for k, v in CONTENT_RULES.items() if v[0] in READ}
    assert actual == expected
    assert len(actual) == 86


@pytest.mark.parametrize('role', ['hub_app', 'admin', 'online_staff'])
@pytest.mark.parametrize('level,actions', [('edit', EDIT), ('approve', APPROVE), ('special_actions', SPECIAL)])
def test_finance_every_command_denied_when_its_box_is_off(permission_accounts, role, level, actions):
    _, ids = permission_accounts
    async def check():
        actor = ids['admin']
        await set_bit(actor, 'finance', **({level: []} if level == 'special_actions' else {'can_' + level: False}))
        db = await runtime()
        try:
            # Neighboring V survives, and a different tab remains readable.
            assert await call(db, actor, "select ads.finance_read('memos')", role=role)
            assert await call(db, actor, "select ads.archive_read()", role=role)
            for action in actions:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, actor, 'select ads.finance_command($1,$2::jsonb)', action, '{}', role=role)
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('role', ['hub_app', 'admin', 'online_staff'])
@pytest.mark.parametrize('tab', tuple(READ))
def test_operations_view_off_blocks_sql_and_keeps_neighbor(permission_accounts, role, tab):
    _, ids = permission_accounts
    async def check():
        actor = ids['admin']
        db = await runtime()
        try:
            assert await call(db, actor, 'select ' + READ[tab], role=role)
            await set_bit(actor, tab, can_edit=False, can_approve=False, special_actions=[], can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, actor, 'select ' + READ[tab], role=role)
            neighbor = 'archive' if tab != 'archive' else 'finance'
            assert await call(db, actor, 'select ' + READ[neighbor], role=role)
            if tab == 'finance':
                for table in ('ads.memo', 'ads.media_line', 'ads.card_statement_control'):
                    if role == 'hub_app':
                        with pytest.raises(asyncpg.InsufficientPrivilegeError):
                            await call(db, actor, 'select count(*) from ' + table, role=role)
                    else:
                        assert await call(db, actor, 'select count(*) from ' + table, role=role) == 0
            for table in ('ads.archive_document', 'ads.finding_workflow', 'ads.document_follow_up'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, actor, 'insert into ' + table + ' default values returning 1', role=role)
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('tab,bit,action,payload', [
    ('archive', 'edit', 'confirm', {}), ('archive', 'edit', 'retry', {}),
    ('archive', 'approve', 'apply', {}), ('finance', 'edit', 'apply', {}),
    ('finance', 'approve', 'apply', {'mode': 'CARD_CREATE'}),
    ('archive', 'special_actions', 'hold', {}),
])
def test_archive_cross_tab_and_special_denials_precede_target_lookup(permission_accounts, tab, bit, action, payload):
    _, ids = permission_accounts
    async def check():
        await set_bit(ids['admin'], tab, **({bit: []} if bit == 'special_actions' else {'can_' + bit: False}))
        db = await runtime()
        try:
            for role in ('hub_app', 'admin', 'online_staff'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['admin'], 'select ads.archive_command($1,$2,$3::jsonb)',
                               action, uuid4(), json.dumps(payload), role=role)
                assert await call(db, ids['admin'], 'select ads.archive_read()', role=role)
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('tab,action', [('exceptions', 'workflow'), ('documents', 'follow-up')])
def test_operations_workflow_edit_off_precedes_snapshot_lookup(permission_accounts, tab, action):
    _, ids = permission_accounts
    async def check():
        await set_bit(ids['admin'], tab, can_edit=False)
        db = await runtime()
        try:
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['admin'], 'select ads.actuals_command($1,$2,$3::jsonb)', action, '0' * 64, '{}')
            assert await call(db, ids['admin'], 'select ' + READ[tab])
        finally:
            await db.close()
    asyncio.run(check())


def test_finance_statement_status_cannot_evade_approval_and_drafts_still_work(permission_accounts):
    _, ids = permission_accounts
    async def check():
        actor = ids['admin']
        db = await runtime()
        tx = db.transaction()
        await tx.start()
        try:
            payload = dict(operator_ref='PERMISSION-' + uuid4().hex, issuer='SYNTHETIC', cycle_start='2026-10-01',
                           cycle_end='2026-10-31', due_date='2026-11-15', declared_total='10.00', total_meaning='NET_CHARGES', evidence_ref='SYNTHETIC')
            await set_bit(actor, 'finance', can_approve=False)
            draft = json.loads(await call(db, actor, 'select ads.finance_command($1,$2::jsonb)', 'statement_create', json.dumps(payload)))
            assert draft['review_status'] != 'CONFIRMED'
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, actor, 'select ads.finance_command($1,$2::jsonb)', 'statement_create', json.dumps({**payload, 'review_status': 'CONFIRMED'}))
            await set_bit(actor, 'finance', can_approve=True, can_edit=False)
            confirmed = json.loads(await call(db, actor, 'select ads.finance_command($1,$2::jsonb)', 'statement_create',
                json.dumps({**payload, 'operator_ref': payload['operator_ref'] + '-A', 'review_status': 'CONFIRMED'})))
            assert confirmed['review_status'] == 'CONFIRMED'
            await set_bit(actor, 'finance', can_approve=False, can_edit=True)
            for extra in ({}, {'review_status': 'DRAFT'}):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, actor, 'select ads.finance_command($1,$2::jsonb)', 'statement_update',
                               json.dumps({'id': confirmed['id'], 'expected_version': confirmed['row_version'], **extra}))
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('tab,path', [('finance', 'memos'), ('actuals', 'actuals'), ('documents', 'document-tracking'),
                                     ('exceptions', 'findings'), ('archive', 'archive')])
def test_operations_next_request_revocation_api_and_session_survives(permission_accounts, tab, path):
    client, ids = permission_accounts
    url = '/v1/admin/ads/' + path
    assert client.get(url, headers=h('admin')).status_code == 200
    asyncio.run(set_bit(ids['admin'], tab, can_edit=False, can_approve=False, special_actions=[], can_view=False))
    assert client.get(url, headers=h('admin')).status_code == 403
    response = client.get('/v1/me', headers=h('admin')).json()['data']
    assert response['status'] == 'ACTIVE' and response['capabilities']['tabs'][tab]['view'] is False
    assert client.get(url, headers=h('online_staff')).status_code == 200


def test_operations_tables_force_rls_and_private_helpers_not_executable(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db = await runtime()
        try:
            for table in OPERATIONS_TABLES:
                assert tuple(await db.fetchrow("select relrowsecurity,relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname||'.'||c.relname=$1", table)) == (True, True)
            for helper in ("ads.finance_extended_command('memo_create','{}',null)", "ads.finance_put('ads.memo','{}')",
                           "ads.actuals_documents(null)", "ads.actuals_meta()", "hub.operations_projection('{}')", "hub.workflow_actor_label()"):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['admin'], 'select ' + helper)
        finally:
            await db.close()
    asyncio.run(check())


def test_actuals_cached_finance_payload_is_projected_in_the_database(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db = await disposable_operator()
        tx = db.transaction()
        await tx.start()
        try:
            batch = uuid4()
            await db.execute("insert into staging.ads_actuals_batch(id,snapshot_id,snapshot_at,fingerprint,manifest,relations,status,created_by) values($1,$2,now(),$3,'{}','{}','APPLIED',$4)", batch, str(batch), batch.hex * 2, ids['admin'])
            await db.execute('update staging.ads_actuals_current set batch_id=$1', batch)
            row = {'line_key': 'SYNTHETIC-PERM', 'scope_code': 'SYNTHETIC', 'revision_no': 1, 'is_applicable': True,
                   'approved_gross': '123.00', 'components': [{'memo_id': 'HIDDEN', 'gross_amount': '123.00'}]}
            await db.execute('insert into staging.ads_actuals_dim values($1,$2,$3,$4::jsonb)', batch, 'SYNTHETIC-PERM', 'r1', json.dumps(row))
            await db.execute('SET LOCAL SESSION AUTHORIZATION hub_runtime')
            assert tuple(await db.fetchrow('select rolsuper,rolbypassrls from pg_roles where rolname=session_user')) == (False, False)
            before = json.loads(await call(db, ids['admin'], "select ads.actuals_read('actuals','SYNTHETIC-PERM')"))
            assert before['line']['approved_gross'] == '123.00'
            await set_bit(ids['admin'], 'finance', can_edit=False, can_approve=False, special_actions=[], can_view=False)
            after = json.loads(await call(db, ids['admin'], "select ads.actuals_read('actuals','SYNTHETIC-PERM')"))
            assert after['line'] == {'line_key': 'SYNTHETIC-PERM', 'scope_code': 'SYNTHETIC'}
            assert 'HIDDEN' not in json.dumps(after)
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('hidden_tabs', [('registry',), ('finance',), ('registry', 'finance')])
def test_actuals_campaign_bridge_hides_other_tabs_and_keeps_platform_observations(permission_accounts, hidden_tabs):
    _, ids = permission_accounts
    async def check():
        db = await disposable_operator()
        tx = db.transaction()
        await tx.start()
        try:
            batch = uuid4()
            line_key = 'SYNTHETIC-BRIDGE-' + batch.hex
            await db.execute("insert into staging.ads_actuals_batch(id,snapshot_id,snapshot_at,fingerprint,manifest,relations,status,created_by) values($1,$2,now(),$3,'{}','{}','APPLIED',$4)", batch, str(batch), batch.hex * 2, ids['admin'])
            await db.execute('update staging.ads_actuals_current set batch_id=$1', batch)
            dimension = {'line_key': line_key, 'revision_no': 1, 'is_applicable': True, 'approved_gross': '100.00'}
            await db.execute('insert into staging.ads_actuals_dim values($1,$2,$3,$4::jsonb)', batch, line_key, 'r1', json.dumps(dimension))
            observations = {'platform': 'GOOGLE', 'account_id': '000SYNTHETIC', 'campaign_id': '000CAMPAIGN',
                            'month': '2026-10-01', 'line_key': line_key, 'observed_code': 'SYNTHETIC-CODE',
                            'observed_name': 'SYNTHETIC CAMPAIGN', 'registration_code': 'SYNTHETIC-REFERENCE'}
            registry = {'name_id': 'REGISTRY-NAME', 'scope_id': 'REGISTRY-SCOPE', 'binding_name_id': 'REGISTRY-BINDING'}
            finance = {'revision_key': 'FINANCE-REVISION', 'assignment_id': 'FINANCE-ASSIGNMENT',
                       'correction_target_id': 'FINANCE-CORRECTION', 'candidate_line_keys': ['FINANCE-CANDIDATE']}
            mixed = {'match_method': 'HUB_NATIVE_ID', 'conflict_codes': ['BOUND_IDENTITY_CONFLICT'],
                     'temporal_provenance': {'source_record_refs': ['HIDDEN-SOURCE']}, 'source_record_refs': ['HIDDEN-SOURCE']}
            bridge = {**observations, **registry, **finance, **mixed}
            await db.execute("insert into staging.ads_actuals_bridge values($1,$2,$3,$4,'2026-10-01',$5::jsonb)",
                             batch, observations['platform'], observations['account_id'], observations['campaign_id'], json.dumps(bridge))
            monthly = {'line_key': line_key, 'month': '2026-10-01', 'approved_month_gross': '100.00',
                       'platform_media_spend': '12.34', 'attributed_leads': 2, 'media_cpl': '6.17'}
            await db.execute("insert into staging.ads_actuals_monthly values($1,$2,'2026-10-01',$3,$4::jsonb)",
                             batch, line_key, 'r1', json.dumps(monthly))
            await db.execute('SET LOCAL SESSION AUTHORIZATION hub_runtime')
            assert tuple(await db.fetchrow('select rolsuper,rolbypassrls from pg_roles where rolname=session_user')) == (False, False)
            query = "select ads.actuals_read('actuals',$1)"
            before = json.loads(await call(db, ids['admin'], query, line_key))
            assert before['campaigns'] == [bridge]
            for tab in hidden_tabs:
                await set_bit(ids['admin'], tab, can_edit=False, can_approve=False, special_actions=[], can_view=False)
            expected = {**observations, **({} if 'registry' in hidden_tabs else registry),
                        **({} if 'finance' in hidden_tabs else finance)}
            for role in ('hub_app', 'admin', 'online_staff'):
                after = json.loads(await call(db, ids['admin'], query, line_key, role=role))
                assert after['campaigns'] == [expected]
                assert after['months'][0]['platform_media_spend'] == '12.34'
                assert after['months'][0]['attributed_leads'] == 2
                assert after['months'][0]['media_cpl'] == '6.17'
                if 'finance' in hidden_tabs:
                    assert 'approved_month_gross' not in after['months'][0]
                assert 'HIDDEN-SOURCE' not in json.dumps(after)
            for tab in hidden_tabs:
                await set_bit(ids['admin'], tab, can_view=True)
            restored = json.loads(await call(db, ids['admin'], query, line_key))
            assert restored['campaigns'] == [bridge]
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())
