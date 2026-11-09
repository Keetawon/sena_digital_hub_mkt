"""W5's reviewed additive catalog; live checks use the existing disposable runtime."""
import asyncio
import json
from pathlib import Path
import re

from test_permission_db_baseline import (
    FUNCTIONS_SQL, POLICIES_SQL, RELATIONS_SQL, ROLES, runtime,
)


ROOT = Path(__file__).resolve().parents[3]
INVENTORY = json.loads((ROOT / 'tests/permissions/content-business-db.json').read_text(encoding='utf-8'))
TABLES = {row['name'] for row in INVENTORY['relations']}
FUNCTIONS = {row['name'] for row in INVENTORY['functions']}
APP_READS = {'hub.business_references', 'hub.business_content', 'internal.assistant_business_search'}
CALLER_ROLES = [*ROLES, 'hub_app']

# Check every non-owner ACL, including unknown future roles, PUBLIC/default ACLs
# and grant options. The historical catalog query also checks effective grants.
TABLE_ACL_SQL = """
select n.nspname||'.'||c.relname as name,
 case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
 a.privilege_type, a.is_grantable
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
where n.nspname||'.'||c.relname=any($1::text[]) and a.grantee<>c.relowner
order by 1,2,3
"""
FUNCTION_ACL_SQL = """
select n.nspname||'.'||p.proname as name,
 pg_get_function_identity_arguments(p.oid) as arguments,
 case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
 a.privilege_type, a.is_grantable
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
where n.nspname||'.'||p.proname=any($1::text[]) and a.grantee<>p.proowner
order by 1,2,3,4
"""


def test_business_inventory_matches_all_new_migration_objects():
    source = (ROOT / INVENTORY['migration']).read_text(encoding='utf-8')
    tables = set(re.findall(r'^create table ([a-z_]+\.[a-z_]+)\s*\(', source, re.M | re.I))
    assert tables == TABLES == {'hub.businesses', 'hub.brand_business'}
    assert len(INVENTORY['relations']) == len(INVENTORY['policies']) == 2
    assert all(row['kind'] == 'r' and row['rls'] and row['force_rls'] and row['grants'] == []
               for row in INVENTORY['relations'])
    assert all(row['name'] == 'business_owner' and row['roles'] == ['postgres']
               and row['cmd'] == 'ALL' and row['permissive'] == 'PERMISSIVE'
               and row['qual'] == row['with_check'] == 'true' for row in INVENTORY['policies'])
    definitions = re.findall(
        r'^create function ([a-z_]+\.[a-z_]+)\((.*?)\)\s+returns(.*?)\bas \$\$',
        source, re.M | re.S | re.I,
    )
    actual = []
    for name, arguments, header in definitions:
        arguments = re.sub(r',\s*', ', ', ' '.join(arguments.split()))
        assert re.search(r'\bset search_path\s*=\s*pg_catalog\s*,\s*pg_temp\s*$', header, re.I)
        actual.append((name, arguments, 'security definer' in header.lower()))
    expected = [(row['name'], row['arguments'], row['security_definer']) for row in INVENTORY['functions']]
    assert sorted(actual) == expected
    assert len(expected) == len(FUNCTIONS) == 10
    assert sum(row['security_definer'] for row in INVENTORY['functions']) == 9
    assert [row['name'] for row in INVENTORY['functions'] if not row['security_definer']] == ['hub.faq_scope_rank']
    assert {row['name'] for row in INVENTORY['functions'] if row['execute_roles']} == APP_READS
    assert all(row['execute_roles'] == (['hub_app'] if row['name'] in APP_READS else [])
               and row['public_execute'] is False
               and row['config'] == ['search_path=pg_catalog, pg_temp']
               for row in INVENTORY['functions'])


def test_business_tables_have_exact_owner_only_policies_force_rls_and_no_direct_grants():
    async def check():
        db = await runtime()
        try:
            relations = [dict(row) for row in await db.fetch(RELATIONS_SQL, ['hub'], CALLER_ROLES)
                         if row['name'] in TABLES]
            policies = [dict(row) for row in await db.fetch(POLICIES_SQL, ['hub'])
                        if row['schema'] + '.' + row['table'] in TABLES]
            assert relations == INVENTORY['relations']
            assert policies == INVENTORY['policies']
            assert await db.fetch(TABLE_ACL_SQL, sorted(TABLES)) == []
        finally:
            await db.close()
    asyncio.run(check())


def test_business_function_modes_search_paths_public_revocation_and_exact_runtime_entries():
    async def check():
        db = await runtime()
        try:
            functions = [dict(row) for row in await db.fetch(FUNCTIONS_SQL, ['hub', 'internal'], CALLER_ROLES)
                         if row['name'] in FUNCTIONS]
            grants = [dict(row) for row in await db.fetch(FUNCTION_ACL_SQL, sorted(FUNCTIONS))]
            public = {(row['name'], row['arguments']) for row in grants if row['grantee'] == 'PUBLIC'}
            for row in functions:
                row['public_execute'] = (row['name'], row['arguments']) in public
            assert functions == INVENTORY['functions']
            expected_grants = [
                {'name': row['name'], 'arguments': row['arguments'], 'grantee': role,
                 'privilege_type': 'EXECUTE', 'is_grantable': False}
                for row in INVENTORY['functions'] for role in row['execute_roles']
            ]
            assert grants == expected_grants
        finally:
            await db.close()
    asyncio.run(check())
