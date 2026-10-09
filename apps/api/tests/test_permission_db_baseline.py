"""Reviewed legacy grants/RLS inventory and real runtime SQL entry probes."""
import asyncio
import json
import os
from pathlib import Path
import re

import asyncpg
import pytest

from sena_hub_api.auth import ALL_DEMO_ACTORS, DEMO_AGENCIES

BASELINE = json.loads((Path(__file__).resolve().parents[3] / 'tests/permissions/legacy-db.json').read_text(encoding='utf-8'))
SCHEMAS = ['hub', 'ads', 'audit', 'staging', 'internal', 'rag', 'public_api']
ROLES = ['admin', 'editor', 'publisher', 'viewer', 'online_staff', 'agency', 'service_consumer']
FUNCTIONS_SQL = """select n.nspname||'.'||p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosecdef as security_definer,p.proconfig as config,
 array(select r from unnest($2::text[]) r where has_function_privilege(r,p.oid,'execute') order by r) as execute_roles
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1) order by 1,2"""
RELATIONS_SQL = """select n.nspname||'.'||c.relname as name,c.relkind::text as kind,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,
 array(select r||':'||priv from unnest($2::text[]) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) priv
 where has_table_privilege(r,c.oid,priv) order by 1) as grants from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname=any($1) and c.relkind in ('r','p','v','m') order by 1"""
POLICIES_SQL = """select schemaname as schema,tablename as table,policyname as name,permissive,roles,cmd,qual,with_check
 from pg_policies where schemaname=any($1) order by 1,2,3"""
SCHEMAS_SQL = """select nspname as name,array(select r from unnest($2::text[]) r
 where has_schema_privilege(r,oid,'usage') order by r) as usage_roles from pg_namespace where nspname=any($1) order by 1"""


async def runtime():
    db = await asyncpg.connect(os.environ['HUB_TEST_DATABASE_URL'])
    attributes = await db.fetchrow('select rolname,rolsuper,rolbypassrls from pg_roles where rolname=current_user')
    assert tuple(attributes.values()) == ('hub_runtime', False, False)
    return db


def test_live_catalog_matches_reviewed_local_baseline():
    async def check():
        db = await runtime()
        try:
            for name, sql, args in [('schemas', SCHEMAS_SQL, [SCHEMAS, ROLES]), ('functions', FUNCTIONS_SQL, [SCHEMAS, ROLES]), ('relations', RELATIONS_SQL, [SCHEMAS, ROLES]), ('policies', POLICIES_SQL, [SCHEMAS])]:
                actual = [dict(row) for row in await db.fetch(sql, *args)]
                assert actual == BASELINE[name], name
            assert sum(f['security_definer'] for f in BASELINE['functions']) == 134
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('persona', tuple(ALL_DEMO_ACTORS))
def test_direct_relation_grants_under_real_non_superuser_runtime(persona):
    async def check():
        db = await runtime()
        role = 'agency' if persona in DEMO_AGENCIES else persona
        try:
            for relation in BASELINE['relations']:
                assert re.fullmatch(r'[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*', relation['name'])
                transaction = db.transaction()
                await transaction.start()
                try:
                    await db.execute(f'SET LOCAL ROLE {role}')
                    await db.execute("select set_config('app.actor_id',$1,true),set_config('app.agency_code',$2,true)", str(ALL_DEMO_ACTORS[persona]), DEMO_AGENCIES.get(persona, ''))
                    statement = f"select * from {relation['name']} limit 0"
                    usage = next(s['usage_roles'] for s in BASELINE['schemas'] if s['name'] == relation['name'].split('.')[0])
                    if role + ':SELECT' in relation['grants'] and role in usage:
                        await db.execute(statement)
                    else:
                        with pytest.raises(asyncpg.InsufficientPrivilegeError):
                            await db.execute(statement)
                finally:
                    await transaction.rollback()
        finally:
            await db.close()
    asyncio.run(check())


READ_ENTRIES = [
    ('projects', "select hub.project_detail((select public_project_id from hub.projects where rem_project_id='DEMO-001'))", {'admin', 'editor', 'publisher', 'viewer'}),
    ('brands', 'select hub.list_brands()', {'admin', 'editor', 'publisher', 'viewer'}),
    ('promotions', "select hub.promotion_read(null,'{}'::jsonb)", {'admin', 'editor', 'publisher', 'viewer'}),
    ('releases', 'select hub.release_read(null)', {'admin', 'editor', 'publisher', 'viewer'}),
    ('knowledge', 'select * from hub.knowledge_candidate_rows()', {'admin', 'editor', 'publisher', 'viewer'}),
    ('registry', 'select ads.registry_settings()', {'admin', 'online_staff', 'agency'}),
    ('finance', "select ads.finance_read('memos',null,'{}'::jsonb)", {'admin', 'online_staff'}),
    ('actuals', "select ads.actuals_read('actuals',null,'{}'::jsonb)", {'admin', 'online_staff'}),
    ('documents', "select ads.actuals_read('document-tracking',null,'{}'::jsonb)", {'admin', 'online_staff'}),
    ('exceptions', "select ads.actuals_read('findings',null,'{}'::jsonb)", {'admin', 'online_staff'}),
    ('archive', "select ads.archive_read(null,'{}'::jsonb)", {'admin', 'online_staff'}),
]


@pytest.mark.parametrize('persona', tuple(ALL_DEMO_ACTORS))
def test_security_definer_read_entry_ceilings_and_positive_neighbours(persona):
    async def check():
        db = await runtime()
        role = 'agency' if persona in DEMO_AGENCIES else persona
        try:
            for tab, sql, allowed in READ_ENTRIES:
                transaction = db.transaction()
                await transaction.start()
                try:
                    await db.execute(f'SET LOCAL ROLE {role}')
                    await db.execute("select set_config('app.actor_id',$1,true),set_config('app.agency_code',$2,true)", str(ALL_DEMO_ACTORS[persona]), DEMO_AGENCIES.get(persona, ''))
                    if role in allowed:
                        await db.execute(sql)
                    else:
                        with pytest.raises(asyncpg.InsufficientPrivilegeError):
                            await db.execute(sql)
                finally:
                    await transaction.rollback()
        finally:
            await db.close()
    asyncio.run(check())
