"""W6's reviewed catalogue boundary, including dynamically copied private delegates."""
import asyncio
import json
from pathlib import Path

from test_permission_db_baseline import (
    FUNCTIONS_SQL, POLICIES_SQL, RELATIONS_SQL, SCHEMAS, runtime,
)


INVENTORY = json.loads((Path(__file__).resolve().parents[3]
                        / 'tests/permissions/content-scope-db.json').read_text(encoding='utf-8'))
FUNCTIONS = INVENTORY['new_functions']
TABLES = INVENTORY['new_tables']
ROLES = INVENTORY['probe_roles']

FUNCTION_DETAILS_SQL = """select n.nspname||'.'||p.proname as name,p.prokind::text as kind,
 pg_get_function_arguments(p.oid) as arguments,pg_get_function_result(p.oid) as result,
 p.proargnames[1:p.pronargs] as input_names,
 array(select format_type(t,null) from unnest(p.proargtypes) t) as identity_types,
 p.pronargdefaults as default_count,pg_get_expr(p.proargdefaults,0) as defaults,
 array(select coalesce(r.rolname,'PUBLIC') from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
       left join pg_roles r on r.oid=a.grantee
       where a.grantee<>p.proowner and a.privilege_type='EXECUTE' order by 1) as nonowner_execute_roles,
 exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee<>p.proowner and a.is_grantable) as delegated_grant_option,
 exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname||'.'||p.proname=any($1::text[]) order by 1,2"""

TABLE_DETAILS_SQL = """select n.nspname||'.'||c.relname as name,
 c.relowner::regrole::text as owner,pg_has_role(session_user,c.relowner,'MEMBER') as owner_member,
 exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where a.grantee<>c.relowner) as nonowner_grant
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname||'.'||c.relname=any($1::text[]) order by 1"""

COLUMNS_SQL = """select n.nspname||'.'||c.relname as relation,a.attname as name,
 format_type(a.atttypid,a.atttypmod) as type,not a.attnotnull as nullable,
 pg_get_expr(d.adbin,d.adrelid) as default,
 exists(select 1 from aclexplode(a.attacl) acl
        where acl.grantee<>c.relowner) as nonowner_grant
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
 left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
 where n.nspname||'.'||c.relname=any($1::text[]) order by 1,a.attnum"""

KEYS_SQL = """select n.nspname||'.'||c.relname as relation,k.contype::text as kind,
 array(select a.attname from unnest(k.conkey) with ordinality x(id,ordinal)
       join pg_attribute a on a.attrelid=c.oid and a.attnum=x.id order by x.ordinal) as columns,
 case when k.contype='f' then rn.nspname||'.'||rc.relname end as reference,
 array(select a.attname from unnest(k.confkey) with ordinality x(id,ordinal)
       join pg_attribute a on a.attrelid=k.confrelid and a.attnum=x.id order by x.ordinal) as reference_columns,
 case when k.contype='f' then k.confdeltype::text end as delete_action
 from pg_constraint k join pg_class c on c.oid=k.conrelid
 join pg_namespace n on n.oid=c.relnamespace
 left join pg_class rc on rc.oid=k.confrelid left join pg_namespace rn on rn.oid=rc.relnamespace
 where n.nspname||'.'||c.relname=any($1::text[]) and k.contype in ('p','u','f')"""

TRIGGERS_SQL = """select n.nspname||'.'||c.relname as relation,t.tgname as name,
 t.tgenabled::text as enabled,t.tgtype as type,t.tgnargs as arguments,
 t.tgqual is null as unconditional,t.tgconstraint=0 as ordinary,
 pn.nspname||'.'||p.proname||'()' as function
 from pg_trigger t join pg_class c on c.oid=t.tgrelid
 join pg_namespace n on n.oid=c.relnamespace
 join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
 where n.nspname||'.'||c.relname=any($1::text[]) and not t.tgisinternal order by 1,t.tgname"""


def _unique(rows):
    result = {row['name']: dict(row) for row in rows}
    assert len(result) == len(rows), 'Unexpected overload or duplicate catalogue entry'
    return result


def _literal_parameters(declaration):
    # The reviewed declarations have only simple literal defaults, not expressions
    # containing commas. Compare types/names/defaults without executing SQL text.
    names, types, defaults = [], [], []
    for argument in declaration.split(',') if declaration else []:
        parameter, separator, default = argument.strip().partition(' default ')
        name, sql_type = parameter.split(' ', 1)
        sql_type = 'timestamp with time zone' if sql_type == 'timestamptz' else sql_type
        names.append(name)
        types.append(sql_type)
        if separator:
            if default.lower() == 'null':
                default = 'NULL::' + sql_type
            elif default.startswith("'"):
                default += '::' + sql_type
            defaults.append(default)
    return names, types, defaults


def test_content_scope_new_functions_and_private_delegate_signatures():
    async def check():
        names = set(FUNCTIONS['names'])
        assert len(names) == len(FUNCTIONS['names']) == FUNCTIONS['expected_count'] == 213
        assert FUNCTIONS['expected_rows_per_name'] == 1 and FUNCTIONS['expected_overloads'] == []
        assert set(FUNCTIONS['exceptions']) <= names
        pairs = []
        for key in ('private_wrapper_delegates', 'private_account_delegates'):
            group = FUNCTIONS[key]
            pairs.extend((group['schema'] + '.' + name,
                          group['schema'] + '.' + name + group['name_suffix'])
                         for name in group['base_names'])
        copies = FUNCTIONS['special_private_copies']
        source_names = {source for source, _ in pairs}
        source_names.update(copy['source'].split('(')[0] for copy in copies.values())
        db = await runtime()
        try:
            rows = _unique([row for row in await db.fetch(FUNCTIONS_SQL, ['hub', 'internal'], ROLES)
                            if row['name'] in names])
            assert set(rows) == names
            details = _unique(await db.fetch(FUNCTION_DETAILS_SQL, sorted(names | source_names)))
            assert set(details) == names | source_names
            for name, row in rows.items():
                expected = FUNCTIONS['defaults'] | FUNCTIONS['exceptions'].get(name, {})
                assert details[name]['kind'] == 'f', name
                for key in ('security_definer', 'config', 'execute_roles'):
                    assert row[key] == expected[key], (name, key, row[key], expected[key])
                assert details[name]['nonowner_execute_roles'] == expected['execute_roles'], name
                assert not details[name]['delegated_grant_option'], name
                assert details[name]['public_execute'] is expected['public_execute'], name
            for name, declaration in FUNCTIONS['literal_argument_declarations'].items():
                expected_names, expected_types, defaults = _literal_parameters(declaration)
                actual = details[name]
                assert (actual['input_names'] or []) == expected_names, name
                assert actual['identity_types'] == expected_types, name
                assert actual['default_count'] == len(defaults), name
                assert actual['defaults'] == (', '.join(defaults) or None), name
            for name, copy in copies.items():
                assert details[name]['identity_types'] == copy['identity_types'], name
                source = copy['source'].split('(')[0]
                assert details[name]['result'] == details[source]['result'], name
                if name.endswith('_before_scopes'):
                    pairs.append((source, name))
            for source, delegate in pairs:
                # Original guarded entry ACLs belong to the predecessor inventory;
                # the copied implementation must never become another entry point.
                assert details[delegate]['arguments'] == details[source]['arguments'], delegate
                assert details[delegate]['result'] == details[source]['result'], delegate
                assert rows[delegate]['execute_roles'] == [], delegate
                assert not details[delegate]['public_execute'], delegate
        finally:
            await db.close()
    asyncio.run(check())


def test_content_scope_tables_are_owner_only_with_exact_columns_keys_and_audit():
    async def check():
        definitions = {table['name']: table for table in TABLES['tables']}
        names = sorted(definitions)
        assert len(names) == len(TABLES['tables']) == TABLES['expected_count'] == 7
        db = await runtime()
        try:
            relations = _unique([row for row in await db.fetch(RELATIONS_SQL, ['hub'], ROLES)
                                 if row['name'] in definitions])
            assert set(relations) == set(names)
            details = _unique(await db.fetch(TABLE_DETAILS_SQL, names))
            assert set(details) == set(names)
            policies = [dict(row) for row in await db.fetch(POLICIES_SQL, ['hub'])
                        if row['schema'] + '.' + row['table'] in definitions]
            assert len(policies) == len(names) * TABLES['defaults']['policy_count']
            for name, row in relations.items():
                for key in ('kind', 'rls', 'force_rls', 'grants'):
                    assert row[key] == TABLES['defaults'][key], (name, key)
                assert not details[name]['nonowner_grant'], name
                assert not details[name]['owner_member'], name
                owned = [policy for policy in policies if policy['schema'] + '.' + policy['table'] == name]
                assert len(owned) == 1, name
                for key, expected in TABLES['defaults']['policy'].items():
                    assert owned[0][key] == expected, (name, key, owned[0][key])
                assert owned[0]['roles'] == [details[name]['owner']], name
            columns = [dict(row) for row in await db.fetch(COLUMNS_SQL, names)]
            for name, definition in definitions.items():
                expected = []
                for column in definition['columns']:
                    value = {'relation': name, **column, 'default': column.get('default'), 'nonowner_grant': False}
                    if value['default'] == "'{}'":
                        value['default'] += '::' + column['type']
                    expected.append(value)
                assert [column for column in columns if column['relation'] == name] == expected, name
            expected_keys = set()
            for name, definition in definitions.items():
                expected_keys.add((name, 'p', tuple(definition['primary_key']), None, (), None))
                for columns in definition.get('unique_keys', []):
                    expected_keys.add((name, 'u', tuple(columns), None, (), None))
                for key in definition.get('foreign_keys', []):
                    reference, reference_columns = key['references'].rstrip(')').split('(')
                    expected_keys.add((name, 'f', tuple(key['columns']), reference,
                                       tuple(reference_columns.split(',')),
                                       'c' if key.get('on_delete') == 'CASCADE' else 'a'))
            actual_keys = {(row['relation'], row['kind'], tuple(row['columns']), row['reference'],
                            tuple(row['reference_columns']), row['delete_action'])
                           for row in await db.fetch(KEYS_SQL, names)}
            assert actual_keys == expected_keys
            indexes = [dict(row) for row in await db.fetch("""select n.nspname||'.'||t.relname as relation,
                c.relname as name,i.indisunique as unique,
                array(select a.attname from unnest(i.indkey) with ordinality key(number,ordinal)
                      join pg_attribute a on a.attrelid=t.oid and a.attnum=key.number order by key.ordinal) as columns,
                pg_get_expr(i.indpred,i.indrelid) as predicate
                from pg_index i join pg_class c on c.oid=i.indexrelid
                join pg_class t on t.oid=i.indrelid join pg_namespace n on n.oid=t.relnamespace
                where n.nspname||'.'||t.relname=any($1::text[]) and i.indpred is not null order by 1,2""", names)]
            assert indexes == TABLES['partial_indexes']
            triggers = [dict(row) for row in await db.fetch(TRIGGERS_SQL, names)]
            audit = TABLES['defaults']['audit_trigger']
            assert audit['timing'] == 'AFTER' and audit['level'] == 'ROW'
            assert set(audit['events']) == {'INSERT', 'UPDATE', 'DELETE'}
            assert triggers == [{'relation': name, 'name': audit['name'], 'enabled': 'O',
                                 'type': 29, 'arguments': 0, 'unconditional': True,
                                 'ordinary': True, 'function': audit['function']} for name in names]
        finally:
            await db.close()
    asyncio.run(check())


def test_content_scope_restrictive_policies_cover_exact_reviewed_relations():
    async def check():
        expected = INVENTORY['existing_restrictive_policies']
        names = set(expected['relations'])
        assert len(names) == len(expected['relations']) == expected['expected_count'] == 92
        db = await runtime()
        try:
            policies = [dict(row) for row in await db.fetch(POLICIES_SQL, SCHEMAS)
                        if row['name'] == expected['name']]
            assert len(policies) == len(names)
            assert {row['schema'] + '.' + row['table'] for row in policies} == names
            for row in policies:
                name = row['schema'] + '.' + row['table']
                for key in ('permissive', 'cmd', 'with_check'):
                    assert row[key] == expected[key], (name, key)
                assert sorted(row['roles']) == sorted(expected['roles']), name
                predicate = f"hub.content_row_visible('{row['table']}'::text,to_jsonb({row['table']}.*))"
                actual = ''.join(row['qual'].split())
                assert actual in (predicate, '(' + predicate + ')'), (name, row['qual'])
        finally:
            await db.close()
    asyncio.run(check())
