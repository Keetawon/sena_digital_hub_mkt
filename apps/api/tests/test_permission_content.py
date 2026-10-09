"""Phase 2 tests against disposable PostgreSQL and the non-bypass runtime."""
import asyncio
import json
from datetime import datetime
from uuid import UUID, uuid4

import asyncpg
import pytest
from fastapi.routing import APIRoute

from sena_hub_api.content_permissions import CONTENT_RULES

from test_permission_baseline import disposable_operator, ROOT
from test_permission_db_baseline import runtime, CONTENT_FUNCTIONS, CONTENT_TABLES
from test_permission_foundations import permission_accounts, h


async def call(db, uid, query, *args, role='hub_app'):
    assert role in ('hub_app', 'admin', 'editor', 'publisher', 'viewer')
    async with db.transaction():
        await db.execute(f'SET LOCAL ROLE {role}')
        await db.execute("select set_config('app.actor_id',$1,true)", str(uid))
        return await db.fetchval(query, *args)


async def set_bit(uid, tab, **bits):
    assert set(bits) <= {'can_view', 'can_edit', 'can_approve', 'special_actions'}
    db = await disposable_operator()
    try:
        for column, value in bits.items():
            await db.execute(f'update hub.account_permission set {column}=$1 where account_id=$2 and tab=$3', value, uid, tab)
    finally:
        await db.close()


def test_content_populated_backfill_preserves_editor_and_records_migration_audit(permission_accounts):
    _, ids = permission_accounts
    migration = (ROOT / 'supabase/migrations/202610090047_content_permissions.sql').read_text(encoding='utf-8')
    backfill = migration.split('-- Begin historical asset binding backfill.')[1].split('-- End historical asset binding backfill.')[0]
    async def check():
        db = await disposable_operator()
        transaction = db.transaction()
        await transaction.start()
        try:
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
            asset = await db.fetchval('select asset_id from hub.brand_assets where deleted_at is null limit 1')
            assert asset is not None
            await db.execute('update hub.assets set first_bound_at=null where id=$1', asset)
            before = await db.fetchrow('select updated_by,updated_at from hub.assets where id=$1', asset)
            await db.execute("select set_config('app.actor_id','',true),set_config('app.change_reason','',true)")
            await db.execute(backfill)
            await db.execute('SET CONSTRAINTS ALL IMMEDIATE')
            after = await db.fetchrow('select updated_by,updated_at,first_bound_at from hub.assets where id=$1', asset)
            assert after['first_bound_at'] is not None
            assert (after['updated_by'], after['updated_at']) == (before['updated_by'], before['updated_at'])
            assert await db.fetchval("select tgenabled::text from pg_trigger where tgrelid='hub.assets'::regclass and tgname='touch'") == 'O'
            audit = await db.fetchrow("""select actor,reason from audit.change_log where table_name='hub.assets'
                and after_row->>'id'=$1 order by id desc limit 1""", str(asset))
            assert audit['actor'] is None
            assert audit['reason'] == 'Phase 2 migration: historical asset binding backfill'
            assert await db.fetchval("select current_setting('app.actor_id')") == ''
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())


def test_content_route_map_has_no_unmapped_core_entry(permission_accounts):
    client, _ = permission_accounts
    prefixes = ('/v1/admin/projects', '/v1/admin/brands', '/v1/admin/brand-requests',
                '/v1/admin/assets', '/v1/admin/sources/projects', '/v1/admin/sources/brands')
    actual = {(method, route.path) for route in client.app.routes if isinstance(route, APIRoute)
              and route.path.startswith(prefixes) for method in route.methods}
    assert actual == set(CONTENT_RULES)


@pytest.mark.parametrize('tab', ['projects', 'brands'])
@pytest.mark.parametrize('role', ['hub_app', 'admin', 'editor', 'publisher', 'viewer'])
def test_content_view_revoked_at_real_sql_and_rpc(permission_accounts, tab, role):
    _, ids = permission_accounts
    async def check():
        db = await runtime()
        try:
            table, rpc = ('hub.projects', 'hub.progress_rows(null)') if tab == 'projects' else ('hub.brands', 'hub.list_brands()')
            assert await call(db, ids['viewer'], f'select count(*) from {table}', role=role) > 0
            await call(db, ids['viewer'], f'select {rpc}', role=role)
            await set_bit(ids['viewer'], tab, can_view=False)
            assert await call(db, ids['viewer'], f'select count(*) from {table}', role=role) == 0
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], f'select {rpc}', role=role)
            # A granted neighboring tab still works; the requested SQL role is
            # deliberately sometimes stronger than the real account role.
            other = 'hub.list_brands()' if tab == 'projects' else 'hub.progress_rows(null)'
            await call(db, ids['viewer'], f'select {other}', role=role)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['admin'], f'update {table} set updated_at=now()', role=role)
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('account', ['viewer', 'pending', 'agency', 'service_consumer'])
def test_content_sd_mutation_entries_deny_without_capabilities(permission_accounts, account):
    _, ids = permission_accounts
    async def check():
        db = await runtime()
        try:
            entries = await db.fetch("""select p.oid::regprocedure::text signature,p.proname,
                array(select format_type(t,null) from unnest(p.proargtypes) t) types
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='hub' and has_function_privilege('hub_app',p.oid,'execute') and p.prosecdef
                and p.proname ~ '^(create_|patch_|update_|review_|publish_|withdraw_|rollback_|bind_|unbind_|add_|prefill_|assign_|save_|confirm_|resolve_|register_)'""")
            assert len(entries) >= 30
            for entry in entries:
                args = ','.join('null::' + t for t in entry['types'])
                with pytest.raises((asyncpg.InsufficientPrivilegeError, asyncpg.NoDataFoundError)):
                    await call(db, ids[account], f"select hub.{entry['proname']}({args})")
            # Renamed implementations are not alternate callable entry points.
            assert not await db.fetchval("""select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='hub' and p.proname like '%_before_%' and has_function_privilege('hub_app',p.oid,'execute'))""")
        finally:
            await db.close()
    asyncio.run(check())


def test_content_api_revocation_and_publisher_edit_removed(permission_accounts):
    client, ids = permission_accounts
    assert client.get('/v1/admin/projects', headers=h('viewer')).status_code == 200
    asyncio.run(set_bit(ids['viewer'], 'projects', can_view=False))
    assert client.get('/v1/admin/projects', headers=h('viewer')).status_code == 403
    assert client.get('/v1/admin/brands', headers=h('viewer')).status_code == 200
    assert client.post('/v1/admin/projects', headers=h('publisher'), json={'rem_project_id': 'SYNTHETIC-NONE'}).status_code == 403
    assert client.get('/v1/admin/projects', headers=h('publisher')).status_code == 200


def test_content_asset_uploader_exception_binding_and_revocation(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db = await runtime()
        checksum = uuid4().hex + uuid4().hex
        asset = None
        metadata = json.dumps(dict(original_filename='synthetic-permission.png', mime_type='image/png',
            storage_path=checksum+'.png', checksum=checksum, file_size=100, asset_type='image', width=10, height=10))
        try:
            result = json.loads(await call(db, ids['editor'], 'select hub.register_uploaded_asset($1::jsonb)', metadata))
            asset = result['asset']['id']
            assert result['asset']['owner_id'] == str(ids['editor'])
            assert await call(db, ids['editor'], 'select hub.can_read_asset($1::uuid)', asset)
            assert not await call(db, ids['viewer'], 'select hub.can_read_asset($1::uuid)', asset)
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['admin'], 'select hub.asset_file($1::uuid)', asset)
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['admin'], 'select hub.register_uploaded_asset($1::jsonb)', metadata)
            # Forging a destination UUID cannot manufacture a binding to the
            # hidden upload, even for another real editor.
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['admin'], "select hub.bind_brand_asset($1,$2,'logo_primary','{}',now())", uuid4(), UUID(asset))
            project = await call(db, ids['editor'], "select hub.project_detail(public_project_id) from hub.projects where rem_project_id='DEMO-001'")
            project = json.loads(project)
            await call(db, ids['editor'], "select hub.bind_project_asset($1,$2,'floor_plan','{\"th\":\"Synthetic\"}',$3)",
                       UUID(project['id']), UUID(asset), datetime.fromisoformat(project['updated_at']))
            assert await call(db, ids['viewer'], 'select hub.can_read_asset($1::uuid)', asset)
            # The owning uploader loses access after binding if Projects V is
            # removed, despite retaining Brands E and having uploaded the file.
            await set_bit(ids['editor'], 'projects', can_edit=False)
            await set_bit(ids['editor'], 'projects', can_view=False)
            assert not await call(db, ids['editor'], 'select hub.can_read_asset($1::uuid)', asset)
            operator = await disposable_operator()
            try:
                await operator.execute('delete from hub.entity_assets where asset_id=$1::uuid', asset)
            finally:
                await operator.close()
            assert not await call(db, ids['editor'], 'select hub.can_read_asset($1::uuid)', asset)
            assert not await call(db, ids['viewer'], 'select hub.can_read_asset($1::uuid)', asset)
        finally:
            await db.close()
            if asset:
                operator = await disposable_operator()
                try:
                    await operator.execute('delete from hub.entity_assets where asset_id=$1::uuid', asset)
                    await operator.execute('delete from hub.assets where id=$1::uuid', asset)
                finally:
                    await operator.close()
    asyncio.run(check())


@pytest.mark.parametrize('tab,level,account,entry', [
    ('projects', 'can_edit', 'editor', "hub.patch_project(null,'{}',null)"),
    ('projects', 'can_approve', 'publisher', "hub.publish_project(null,'synthetic')"),
    ('brands', 'can_edit', 'editor', "hub.update_brand_draft(null,'{}',null)"),
    ('brands', 'can_approve', 'publisher', "hub.publish_brand(null,'synthetic')"),
    ('knowledge', 'can_approve', 'publisher', "hub.review_asset('10000000-0000-0000-0000-000000000003',null,'approved','synthetic',null,null,'synthetic')"),
])
def test_content_single_bit_off_denies_command_with_view_retained(permission_accounts, tab, level, account, entry):
    _, ids = permission_accounts
    async def check():
        db = await runtime()
        try:
            assert await call(db, ids[account], 'select hub.can($1,$2)', tab, level.removeprefix('can_'))
            # With the bit on, the command reaches its ordinary missing/stale
            # input validation. The same SQL must deny before that with it off.
            with pytest.raises(asyncpg.PostgresError) as allowed:
                await call(db, ids[account], 'select ' + entry)
            assert allowed.value.sqlstate != '42501'
            await set_bit(ids[account], tab, **{level: False})
            assert await call(db, ids[account], 'select hub.can($1,\'view\')', tab)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids[account], 'select ' + entry)
            await call(db, ids[account], 'select hub.list_brands()')
        finally:
            await db.close()
    asyncio.run(check())


def test_content_special_removed_does_not_remove_normal_brand_edit(permission_accounts):
    client, ids = permission_accounts
    asyncio.run(set_bit(ids['admin'], 'brands', special_actions=[]))
    assert client.get('/v1/admin/brands', headers=h('admin')).status_code == 200
    assert client.get('/v1/admin/brands/bulk-preview', headers=h('admin')).status_code == 403
    async def check():
        db = await runtime()
        try:
            assert await call(db, ids['admin'], "select hub.can('brands','edit')")
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['admin'], "select hub.brand_bulk_preview(null)")
        finally:
            await db.close()
    asyncio.run(check())


def test_content_hidden_brand_and_knowledge_removed_from_details_cache_and_history(permission_accounts):
    _, ids = permission_accounts
    async def check():
        await set_bit(ids['viewer'], 'brands', can_view=False)
        await set_bit(ids['viewer'], 'knowledge', can_view=False)
        db = await runtime()
        try:
            raw = await call(db, ids['viewer'], "select hub.project_detail(public_project_id) from hub.projects where rem_project_id='DEMO-001'")
            data = json.loads(raw)
            assert set(data['brand_summary']) == {'public_name'}
            assert not data.get('brand') or set(data['brand']) == {'public_name'}
            assert not await call(db, ids['viewer'], "select hub.can_read_asset('10000000-0000-0000-0000-000000000003')")
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['viewer'], "select hub.asset_file('10000000-0000-0000-0000-000000000003')")
            rows = json.loads(await call(db, ids['viewer'], "select jsonb_agg(to_jsonb(c)) from hub.progress_inputs() c"))
            assert rows
            for row in rows:
                assert row['brand_logo'] is None and row['knowledge'] == {}
                assert 'brand_logo' not in row['summary'] and 'knowledge' not in row['summary']
                if row['record'] and row['record']['detail'].get('brand'):
                    assert set(row['record']['detail']['brand']) == {'public_name'}
            # A direct old-role query cannot recover unprojected snapshots.
            assert await call(db, ids['viewer'], 'select count(*) from hub.entity_versions', role='viewer') == 0
            await call(db, ids['viewer'], 'select hub.project_versions($1)', UUID(data['id']))
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select * from hub.project_progress_cache')
        finally:
            await db.close()
    asyncio.run(check())


def test_content_base_role_forced_rls_and_closed_helper_acl(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db = await runtime()
        try:
            await db.execute('SET ROLE hub_app')
            assert tuple(await db.fetchrow("select rolcanlogin,rolinherit,rolsuper,rolbypassrls from pg_roles where rolname='hub_app'")) == (False, False, False, False)
            for table in sorted(CONTENT_TABLES):
                row = await db.fetchrow('select relrowsecurity,relforcerowsecurity,relowner from pg_class where oid=$1::regclass', table)
                assert row['relrowsecurity'] and row['relforcerowsecurity']
                assert not await db.fetchval("select pg_has_role(session_user,$1::oid,'MEMBER')", row['relowner'])
                for privilege in ('INSERT', 'UPDATE', 'DELETE'):
                    assert not await db.fetchval("select has_table_privilege('hub_app',$1,$2)", table, privilege)
            helpers = await db.fetch("""select p.oid,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname||'.'||p.proname=any($1)""", list(CONTENT_FUNCTIONS))
            assert len(helpers) == len(CONTENT_FUNCTIONS)
            for function in helpers:
                assert 'search_path=pg_catalog, pg_temp' in function['proconfig']
                assert not await db.fetchval("""select exists(select 1 from pg_proc p,
                    lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
                    where p.oid=$1 and acl.grantee=0 and privilege_type='EXECUTE')""", function['oid'])
            for uid in ('', 'bad-uuid', str(ids['pending'])):
                assert not await call(db, uid, "select hub.can_read_asset('10000000-0000-0000-0000-000000000003')")
        finally:
            await db.close()
    asyncio.run(check())


def test_content_brand_reader_gets_only_project_reference_without_projects_view(permission_accounts):
    _, ids = permission_accounts
    async def check():
        await set_bit(ids['viewer'], 'projects', can_view=False)
        db = await runtime()
        try:
            brands = json.loads(await call(db, ids['viewer'], 'select hub.list_brands()'))
            references = [project for brand in brands for project in brand['projects']]
            assert references
            assert all(set(project) == {'public_project_id', 'public_name'} for project in references)
            assert await call(db, ids['viewer'], 'select count(*) from hub.projects') == 0
        finally:
            await db.close()
    asyncio.run(check())


def test_content_project_history_keeps_numeric_order_and_limit(permission_accounts):
    _, ids = permission_accounts
    async def check():
        # Immutable version fixtures live only inside this rolled-back transaction.
        db = await disposable_operator()
        transaction = db.transaction()
        await transaction.start()
        try:
            project = await db.fetchval("select id from hub.projects where rem_project_id='DEMO-001'")
            base = await db.fetchval('select coalesce(max(version_no),0) from hub.entity_versions where project_id=$1', project)
            await db.execute("""insert into hub.entity_versions(project_id,version_no,payload,publisher,change_reason)
                select $1,n,'{}',$2,'Synthetic history ordering' from generate_series($3::integer,$4::integer) n""",
                project, ids['publisher'], base + 1, base + 105)
            await db.execute('SET LOCAL SESSION AUTHORIZATION hub_runtime')
            await db.execute('SET LOCAL ROLE hub_app')
            assert await db.fetchval('select session_user') == 'hub_runtime'
            assert not await db.fetchval('select rolsuper or rolbypassrls from pg_roles where rolname=current_user')
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['viewer']))
            result = json.loads(await db.fetchval('select hub.project_versions($1)', project))
            assert [row['version_no'] for row in result] == list(range(base + 105, base + 5, -1))
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())


def test_content_uploader_loses_unbound_upload_after_edit_revoked(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db = await runtime()
        asset = None
        checksum = uuid4().hex + uuid4().hex
        try:
            metadata = json.dumps(dict(original_filename='synthetic-unbound.png', mime_type='image/png',
                storage_path=checksum+'.png', checksum=checksum, file_size=100, asset_type='image', width=10, height=10))
            asset = json.loads(await call(db, ids['editor'], 'select hub.register_uploaded_asset($1::jsonb)', metadata))['asset']['id']
            for tab in ('projects', 'brands', 'knowledge'):
                await set_bit(ids['editor'], tab, can_edit=False)
            assert not await call(db, ids['editor'], 'select hub.can_read_asset($1::uuid)', asset)
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['editor'], 'select hub.asset_detail($1::uuid)', asset)
        finally:
            await db.close()
            if asset:
                operator = await disposable_operator()
                try:
                    await operator.execute('delete from hub.assets where id=$1::uuid', asset)
                finally:
                    await operator.close()
    asyncio.run(check())
