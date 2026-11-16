"""Closed W7 catalogue contract; read-only checks in the disposable API gate."""
import asyncio
import hashlib
import json
from pathlib import Path
import re

import asyncpg
import pytest

from sena_hub_api.auth import ALL_DEMO_ACTORS
from test_permission_db_baseline import FUNCTIONS_SQL, POLICIES_SQL, RELATIONS_SQL, ROLES, runtime

ROOT = Path(__file__).resolve().parents[3]
INVENTORY = json.loads((ROOT / 'tests/permissions/content-writing-db.json').read_text(encoding='utf-8'))
FUNCTIONS = INVENTORY['new_functions']['entries']
TABLES = INVENTORY['new_tables']['entries']
FUNCTION_NAMES = {row['name'] for row in FUNCTIONS}
TABLE_NAMES = {row['name'] for row in TABLES}
PROBE_ROLES = INVENTORY['probe_roles']


def test_writing_inventory_is_finite_and_pins_the_reviewed_migration():
    provenance = INVENTORY['provenance']
    source = (ROOT / provenance['migration']).read_bytes()
    assert hashlib.sha256(source).hexdigest() == provenance['sha256']
    text = source.decode('utf-8')
    assert INVENTORY['schema_version'] == 1
    assert len(TABLES) == len(TABLE_NAMES) == INVENTORY['new_tables']['expected_count'] == 2
    assert len(FUNCTIONS) == len(FUNCTION_NAMES) == INVENTORY['new_functions']['expected_count'] == 9
    assert len({row['signature'] for row in FUNCTIONS}) == 9
    assert INVENTORY['new_functions']['expected_overloads'] == []
    assert set(PROBE_ROLES) == set(ROLES) | {'hub_app', 'hub_media_worker', 'hub_translation_worker'}
    assert len(PROBE_ROLES) == len(set(PROBE_ROLES))
    assert set(re.findall(r'(?im)^create function (hub\.[a-z_]+)\(', text)) == FUNCTION_NAMES
    assert set(re.findall(r'(?im)^create table (hub\.[a-z_]+) \(', text)) == TABLE_NAMES
    assert {row['name'] for row in FUNCTIONS if row['execute_roles']} == {
        'hub.writing_aid_state', 'hub.writing_aid_begin', 'hub.writing_aid_finish',
    }
    assert all(row['security_definer'] and not row['public_execute']
               and row['config'] == ['search_path=pg_catalog, pg_temp']
               and row['execute_roles'] in ([], ['hub_app']) for row in FUNCTIONS)
    assert [row['name'] for row in INVENTORY['changed_existing_functions']] == ['hub.save_content_field']


def test_writing_functions_have_exact_signatures_and_only_three_runtime_entries():
    async def check():
        db = await runtime()
        try:
            await db.execute('SET ROLE hub_app')
            expected = FUNCTIONS + INVENTORY['changed_existing_functions']
            names = {row['name'] for row in expected}
            rows = [dict(row) for row in await db.fetch(FUNCTIONS_SQL, ['hub'], PROBE_ROLES)
                    if row['name'] in names or row['name'].startswith('hub.writing_aid_')]
            keys = ('name', 'arguments', 'security_definer', 'config', 'execute_roles')
            assert sorted(rows, key=lambda row: (row['name'], row['arguments'])) == sorted(
                [{key: row[key] for key in keys} for row in expected], key=lambda row: (row['name'], row['arguments']))
            for entry in expected:
                actual = await db.fetchrow("""select p.provolatile::text as volatility,
                    p.pronargdefaults as argument_defaults, pg_get_function_result(p.oid) as result,
                    array(select coalesce(r.rolname::text,'PUBLIC')
                          from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
                          left join pg_roles r on r.oid=acl.grantee
                          where acl.grantee<>p.proowner and acl.privilege_type='EXECUTE' order by 1) as grants,
                    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
                           where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute,
                    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
                           where acl.grantee<>p.proowner and acl.is_grantable) as delegated_grant,
                    pg_has_role('hub_app',p.proowner,'MEMBER') as app_is_owner
                    from pg_proc p where p.oid=$1::regprocedure""", entry['signature'])
                assert actual is not None, entry['signature']
                assert {key: actual[key] for key in ('volatility', 'argument_defaults', 'result', 'public_execute')} == {
                    key: entry[key] for key in ('volatility', 'argument_defaults', 'result', 'public_execute')}, entry['signature']
                # The raw ACL also catches PUBLIC and any unlisted new role.
                assert actual['grants'] == entry['execute_roles'], entry['signature']
                assert not actual['delegated_grant'] and not actual['app_is_owner'], entry['signature']
        finally:
            await db.close()
    asyncio.run(check())


def test_writing_storage_is_owner_only_force_rls_with_no_column_grant_escape():
    async def check():
        db = await runtime()
        try:
            await db.execute('SET ROLE hub_app')
            rows = [dict(row) for row in await db.fetch(RELATIONS_SQL, ['hub'], PROBE_ROLES)
                    if row['name'] in TABLE_NAMES or row['name'].startswith('hub.writing_ai_')]
            keys = ('name', 'kind', 'rls', 'force_rls', 'grants')
            assert sorted(rows, key=lambda row: row['name']) == sorted(
                [{key: row[key] for key in keys} for row in TABLES], key=lambda row: row['name'])
            policies = [dict(row) for row in await db.fetch(POLICIES_SQL, ['hub'])
                        if row['schema'] + '.' + row['table'] in TABLE_NAMES]
            assert len(policies) == INVENTORY['new_tables']['expected_policy_count'] == 2
            assert sorted(policies, key=lambda row: row['table']) == sorted(
                [row['policy'] for row in TABLES], key=lambda row: row['table'])
            for table in TABLES:
                name = table['name']
                assert re.fullmatch(r'hub\.writing_ai_(settings|requests)', name)
                security = await db.fetchrow("""select
                    (select count(*)=1 and bool_and(polroles=array[c.relowner]::oid[])
                     from pg_policy where polrelid=c.oid) as only_owner_policy,
                    exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
                           where acl.grantee<>c.relowner) as outsider_table_grant,
                    exists(select 1 from pg_attribute a,lateral aclexplode(a.attacl) acl
                           where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
                             and acl.grantee<>c.relowner) as outsider_column_grant,
                    pg_has_role(session_user,c.relowner,'MEMBER') as runtime_is_owner
                    from pg_class c where c.oid=$1::regclass""", name)
                assert security['only_owner_policy'], name
                assert not security['outsider_table_grant'] and not security['outsider_column_grant'], name
                assert not security['runtime_is_owner'], name
                # Actual non-bypass application entry stays closed, not only its
                # displayed metadata. This statement cannot modify any row.
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    async with db.transaction(readonly=True):
                        await db.execute('SET LOCAL ROLE hub_app')
                        await db.fetch(f'select * from {name} limit 0')
        finally:
            await db.close()
    asyncio.run(check())


def test_writing_reuses_audit_and_touch_without_raw_text_storage():
    async def check():
        db = await runtime()
        try:
            await db.execute('SET ROLE hub_app')
            count = 0
            for table in TABLES:
                columns = await db.fetch("""select attname::text from pg_attribute
                    where attrelid=$1::regclass and attnum>0 and not attisdropped order by attnum""", table['name'])
                assert [row['attname'] for row in columns] == table['columns'], table['name']
                rows = [dict(row) for row in await db.fetch("""select t.tgname::text as name,
                    t.tgfoid::regprocedure::text as function,t.tgenabled::text as enabled,t.tgtype::integer as type
                    from pg_trigger t where t.tgrelid=$1::regclass and not t.tgisinternal order by t.tgname""", table['name'])]
                expected = [{key: trigger[key] for key in ('name', 'function', 'enabled', 'type')}
                            for trigger in table['triggers']]
                assert rows == sorted(expected, key=lambda row: row['name']), table['name']
                count += len(rows)
            assert count == INVENTORY['new_tables']['expected_trigger_count'] == 4
        finally:
            await db.close()
    asyncio.run(check())


def test_writing_defaults_are_stub_zero_budget_and_registry_opt_in_is_false():
    async def check():
        db = await runtime()
        try:
            await db.execute('SET ROLE hub_app')
            for entry in INVENTORY['column_defaults']:
                row = await db.fetchrow("""select format_type(a.atttypid,a.atttypmod) as type,
                    not a.attnotnull as nullable,pg_get_expr(d.adbin,d.adrelid) as default
                    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
                    where a.attrelid=$1::regclass and a.attname=$2 and not a.attisdropped""", entry['table'], entry['column'])
                assert row is not None, (entry['table'], entry['column'])
                assert dict(row) == {key: entry[key] for key in ('type', 'nullable', 'default')}, (entry['table'], entry['column'])
            # Read the default-off fixture state through the ordinary View
            # projection. Do not add grants, seed rows or call the registry writer.
            async with db.transaction(readonly=True):
                await db.execute('SET LOCAL ROLE hub_app')
                await db.execute("select set_config('app.actor_id',$1,true),set_config('app.agency_code','',true)", str(ALL_DEMO_ACTORS['viewer']))
                value = await db.fetchval('select hub.content_fields()')
                catalog = json.loads(value) if isinstance(value, str) else value
                assert catalog['items'], 'Default registry fixture must be populated'
                assert all(field['ai_writing_enabled'] is False for field in catalog['items'])
                assert catalog['can_manage'] is False
        finally:
            await db.close()
    asyncio.run(check())
