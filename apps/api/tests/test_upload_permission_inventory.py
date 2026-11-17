"""W9 finite database contract. Static checks are port-free; runtime checks use the existing disposable runner."""
import asyncio
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
INVENTORY = json.loads((ROOT / 'tests/permissions/upload-optimization-db.json').read_text(encoding='utf-8-sig'))
MIGRATION = ROOT / INVENTORY['migration']


def test_w9_static_finite_contract():
    sql = MIGRATION.read_text(encoding='utf-8-sig')
    names = {item['name'] for item in INVENTORY['functions']}
    assert len(names) == len(INVENTORY['functions']) == 10
    assert set(re.findall(r'(?im)^create table (hub\.\w+)', sql)) == set(INVENTORY['tables'])
    direct = set(re.findall(r'(?im)^create function (hub\.\w+)\(', sql))
    assert direct | {'hub.register_uploaded_asset_for_upload'} == names
    assert 'FUNCTION hub.register_uploaded_asset_for_upload(' in sql
    assert not re.search(r'(?im)^create (?:or replace )?function hub\.register_uploaded_asset\(', sql)
    declared = re.findall(r'(?ims)^create function (hub\.\w+)\((.*?)\) returns (\w+)', sql)
    for name, arguments, result in declared:
        row = next(item for item in INVENTORY['functions'] if item['name'] == name)
        assert re.sub(r'\s+', '', arguments) == re.sub(r'\s+', '', row['arguments']), name
        assert result == row['result'], name
    grant = re.search(r'(?is)\bgrant execute on function (.*?) to hub_app;', sql).group(1)
    entries = set(re.findall(r'(hub\.\w+)\(', grant))
    assert entries == {item['name'] for item in INVENTORY['functions'] if item['execute_roles']}
    assert len(entries) == 4
    assert not re.search(r'(?i)\b(?:insert into|update|delete from) hub\.(?:user_account|account_permission|permission_catalog|permission_template)\b', sql)
    guarded = set(re.findall(r'(?im)^create trigger upload_class_guard before .*? on (hub\.\w+)', sql))
    assert guarded == set(INVENTORY['class_guard_relations'])
    assert "if not found then return;end if;" in sql  # Historical class guard is a no-op.
    assert "original_checksum,processing_class" in sql
    assert "legacy_provenance_collision" in sql
    assert "expected_context_stamp is distinct from resolved->>'context_stamp'" in sql
    assert sql.count('create table ') == 2


def test_w9_runtime_private_inventory():
    from test_permission_db_baseline import FUNCTIONS_SQL, POLICIES_SQL, RELATIONS_SQL, runtime
    from test_content_scope_inventory import COLUMNS_SQL, FUNCTION_DETAILS_SQL, TABLE_DETAILS_SQL, TRIGGERS_SQL
    async def check():
        db = await runtime()
        roles = ['admin', 'agency', 'editor', 'hub_app', 'hub_media_worker',
                 'hub_translation_worker', 'online_staff', 'publisher', 'service_consumer', 'viewer']
        try:
            expected = {row['name']: row for row in INVENTORY['functions']}
            rows = [dict(row) for row in await db.fetch(FUNCTIONS_SQL, ['hub'], roles) if row['name'] in expected]
            assert len(rows) == len(expected) == 10
            details = {row['name']: dict(row) for row in await db.fetch(FUNCTION_DETAILS_SQL, sorted(expected))}
            for row in rows:
                name = row['name']
                assert row['security_definer'] is True, name
                assert row['config'] == ['search_path=pg_catalog, pg_temp'], name
                assert row['execute_roles'] == expected[name]['execute_roles'], name
                assert details[name]['nonowner_execute_roles'] == expected[name]['execute_roles'], name
                assert not details[name]['public_execute'] and not details[name]['delegated_grant_option'], name
                assert details[name]['default_count'] == 0, name
                arguments = expected[name]['arguments'].split(',') if expected[name]['arguments'] else []
                assert (details[name]['input_names'] or []) == [arg.split(' ', 1)[0] for arg in arguments], name
                assert details[name]['identity_types'] == [arg.split(' ', 1)[1] for arg in arguments], name
                assert details[name]['result'] == expected[name]['result'], name
            tables = set(INVENTORY['tables'])
            relations = [dict(row) for row in await db.fetch(RELATIONS_SQL, ['hub'], roles) if row['name'] in tables]
            assert len(relations) == 2
            assert all(row['rls'] and row['force_rls'] and row['grants'] == [] for row in relations)
            owners = {row['name']: dict(row) for row in await db.fetch(TABLE_DETAILS_SQL, sorted(tables))}
            assert all(not row['nonowner_grant'] and not row['owner_member'] for row in owners.values())
            policies = [dict(row) for row in await db.fetch(POLICIES_SQL, ['hub']) if row['schema'] + '.' + row['table'] in tables]
            assert len(policies) == 2
            for row in policies:
                assert row['name'] == 'upload_owner' and row['cmd'] == 'ALL'
                assert row['permissive'] == 'PERMISSIVE' and row['qual'] == row['with_check'] == 'true'
                assert row['roles'] == [owners[row['schema'] + '.' + row['table']]['owner']]
            columns = [dict(row) for row in await db.fetch(COLUMNS_SQL, sorted(tables))]
            for table, expected_columns in INVENTORY['columns'].items():
                actual = [row for row in columns if row['relation'] == table]
                assert [[row['name'], row['type']] for row in actual] == expected_columns, table
                assert all(not row['nonowner_grant'] for row in actual), table
                assert {row['name'] for row in actual if row['nullable']} == ({'original_width', 'original_height'} if table.endswith('sources') else set()), table
            triggers = [dict(row) for row in await db.fetch(TRIGGERS_SQL, sorted(tables))]
            assert len(triggers) == 4
            assert {(row['name'], row['function']) for row in triggers} == {
                ('upload_immutable', 'hub.reject_version_change()'), ('upload_audit', 'hub.asset_upload_audit()')}
            guards = [dict(row) for row in await db.fetch(TRIGGERS_SQL, INVENTORY['class_guard_relations']) if row['name'] == 'upload_class_guard']
            assert len(guards) == len(INVENTORY['class_guard_relations']) == 8
            assert all(row['function'] == 'hub.asset_upload_use_guard()' and row['enabled'] == 'O' for row in guards)
        finally:
            await db.close()
    asyncio.run(check())


if __name__ == '__main__':
    test_w9_static_finite_contract()
    print('PASS: W9 finite static SQL/ACL inventory (runtime not run)')

