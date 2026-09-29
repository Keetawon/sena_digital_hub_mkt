import copy
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import AsyncMock, patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('gold_intake', ROOT / 'scripts/stage-gold-project.py')
gold = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gold)


class GoldIntakeTests(unittest.TestCase):
    def test_cli_distinguishes_export_time_from_chat_receipt_without_database_access(self):
        project = {name: None for name in gold.TEXT_FIELDS}
        project.update(project_id='HYABC', rem_brand_id='25', company_id='HSP', moo=None, moo_eng=None,
                       latitude=None, longitude=None, source_snapshot_at='2026-09-17T08:00:00+00:00')
        models = [{'project_id': 'HYABC', 'project_model_key': 'synthetic-group', 'model_name': 'Synthetic',
                   'model_ids': ['A1'], 'technical_model_count': 1, 'model_attribute_variant': False}]
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            for name, value in (('project', project), ('models', models)):
                (folder / f'{name}.json').write_text(json.dumps(value), encoding='utf-8')
            base = ['stage-gold-project.py', '--project', str(folder / 'project.json'),
                    '--models', str(folder / 'models.json'), '--apply']

            def invoke(arguments, apply):
                with patch('sys.argv', base + arguments), patch.object(gold, 'ROOT', folder), \
                        patch.object(gold, 'apply_local', apply), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                    return gold.main()

            stamp = '2026-09-18T17:45:00+07:00'
            for flag in ('--captured-at', '--received-at'):
                with self.subTest(flag=flag):
                    apply = AsyncMock(return_value='staged')
                    self.assertEqual(invoke([flag, stamp], apply), 0)
                    apply.assert_awaited_once()
                    supplied_project, supplied_models, digest, provenance = apply.call_args.args
                    self.assertEqual((supplied_project, supplied_models), (project, models))
                    self.assertEqual(digest, hashlib.sha256(gold.canonical({'project': project, 'models': models})).hexdigest())
                    self.assertEqual(provenance['method'], 'operator_provided_gold_export')
                    self.assertFalse(provenance['human_approved'])
                    if flag == '--received-at':
                        self.assertIsNone(provenance['captured_at'])
                        self.assertEqual(provenance['received_at'], stamp)
                        self.assertEqual(provenance['transfer_method'], 'user_pasted_query_results')
                    else:
                        self.assertEqual(provenance['captured_at'], stamp)
                        self.assertNotIn('received_at', provenance)
                    self.assertEqual(supplied_project['source_snapshot_at'], project['source_snapshot_at'])
                    apply = AsyncMock()
                    self.assertEqual(invoke([flag, '2026-09-18T17:45:00'], apply), 1)
                    apply.assert_not_awaited()
            for arguments in ([], ['--captured-at', stamp, '--received-at', stamp]):
                apply = AsyncMock()
                with self.assertRaises(SystemExit) as error:
                    invoke(arguments, apply)
                self.assertEqual(error.exception.code, 2)
                apply.assert_not_awaited()

    def test_exact_scope_nulls_coordinate_pair_and_group_lineage(self):
        project = {name: None for name in gold.TEXT_FIELDS}
        project.update(project_id='HYABC', rem_brand_id='25', company_id='HSP', moo=None, moo_eng=None,
                       latitude=None, longitude=None, commercial_project_name='Synthetic commercial name',
                       source_snapshot_at='2026-09-18T08:00:00+00:00')
        models = [{'project_id':'HYABC', 'project_model_key':'synthetic-group', 'model_name':'Synthetic name',
                   'model_ids':['A1','A3'], 'technical_model_count':2, 'model_attribute_variant':True}]
        original = copy.deepcopy((project, models))
        self.assertEqual(gold.validate([project], models), original)
        self.assertEqual((project, models), original)
        for changes in ({'project_id':'KUBON'}, {'latitude':13.1}, {'latitude':True,'longitude':100},
                        {'latitude':91,'longitude':100}, {'commercial_brand':123}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                gold.validate(project | changes, models)
        self.assertEqual(gold.validate(project | {'latitude':0,'longitude':0}, models)[0]['latitude'], 0)
        with self.assertRaises(ValueError):
            gold.validate(project, models + [models[0] | {'project_model_key':'other'}])
        with self.assertRaises(ValueError):
            gold.validate(project, [models[0] | {'project_id':'B_PO'}])
        with self.assertRaises(ValueError):
            gold.validate(project, [])
        with self.assertRaises(ValueError):
            gold.validate(project | {'source_snapshot_at':'2026-09-18T08:00:00'}, models)
        for changes in ({'model_type_ids':'CON1'}, {'model_name_eng':{}}, {'technical_model_count':12}):
            with self.subTest(model_changes=changes), self.assertRaises(ValueError):
                gold.validate(project, [models[0] | changes])


@unittest.skipUnless(os.getenv('HUB_INTAKE_TEST_DB') == '1', 'Opt in to the disposable local PostgreSQL test')
class GoldIntakeDatabaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import asyncpg

        self.asyncpg = asyncpg
        self.connect = asyncpg.connect
        self.database = 'hub_gold_test_' + uuid.uuid4().hex
        self.assertRegex(self.database, r'^hub_gold_test_[0-9a-f]{32}$')
        self.admin = self.connection = None
        self.created = False
        self.addAsyncCleanup(self.cleanup_database)
        config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
        self.options = dict(host='127.0.0.1', port=55432, user='postgres',
                            password=config['adminPassword'], timeout=10)
        try:
            self.admin = await self.connect(database='postgres', **self.options)
            await self.admin.execute(f'CREATE DATABASE "{self.database}"')
            self.created = True
            self.connection = await self.connect(database=self.database, **self.options)
        except Exception:
            raise RuntimeError('Cannot open disposable local test database; start the existing local PostgreSQL runner.') from None
        for migration in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
            await self.connection.execute(migration.read_text(encoding='utf-8'))
        await self.connection.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)

    async def cleanup_database(self):
        if self.connection is not None:
            await self.connection.close()
        if self.admin is not None:
            try:
                if self.created:
                    if not re.fullmatch(r'hub_gold_test_[0-9a-f]{32}', self.database):
                        raise RuntimeError('Unsafe test database name; refusing cleanup')
                    await self.admin.execute(f'DROP DATABASE "{self.database}"')
            finally:
                await self.admin.close()

    async def test_local_apply_preserves_source_time_and_rejects_partial_or_conflicting_evidence(self):
        connection = self.connection
        await connection.execute("""INSERT INTO staging.rem_projects
            (rem_project_id,project_name_rem,rem_brand_id,rem_company_id,source_fingerprint)
            VALUES('HYABC','Synthetic project','25','HSP','synthetic')""")
        await connection.executemany("""INSERT INTO staging.rem_models
            (rem_project_id,rem_model_id,model_name_rem,source_fingerprint)
            VALUES('HYABC',$1,'Synthetic model','synthetic')""", [('A1',), ('A3',)])
        project = {name: None for name in gold.TEXT_FIELDS}
        project.update(project_id='HYABC', rem_brand_id='25', company_id='HSP', moo=None, moo_eng=None,
                       latitude=None, longitude=None, commercial_project_name='Synthetic commercial name',
                       source_snapshot_at='2026-09-17T15:00:00+07:00')
        models = [{'project_id': 'HYABC', 'project_model_key': 'synthetic-group', 'model_name': 'Synthetic name',
                   'model_ids': ['A1', 'A3'], 'technical_model_count': 2, 'model_attribute_variant': True}]
        provenance = {'method': 'synthetic_test', 'captured_at': '2026-09-18T10:00:00+00:00', 'human_approved': False}
        attempts = []

        async def redirected_connect(*args, **kwargs):
            # Verify the production entry point stays fixed, then replace only its
            # destination with this disposable database. Never connect it to Hub.
            self.assertFalse(args)
            self.assertEqual(set(kwargs), set(self.options) | {'database'})
            self.assertEqual(kwargs['database'], 'sena_hub_local')
            for key in ('host', 'port', 'user', 'timeout'):
                self.assertEqual(kwargs[key], self.options[key])
            self.assertTrue(kwargs['password'] == self.options['password'])
            self.assertRegex(self.database, r'^hub_gold_test_[0-9a-f]{32}$')
            attempts.append(self.database)
            return await self.connect(database=self.database, **self.options)

        async def apply(record, groups):
            record, groups = gold.validate(record, groups)
            digest = hashlib.sha256(gold.canonical({'project': record, 'models': groups})).hexdigest()
            return await gold.apply_local(record, groups, digest, provenance)

        async def unchanged_since(before):
            self.assertEqual(await connection.fetch('SELECT * FROM staging.dw_projects'), before)
            self.assertEqual(await connection.fetchval('SELECT count(*) FROM hub.projects'), 0)

        with patch.object(self.asyncpg, 'connect', redirected_connect):
            for changes in ({'rem_brand_id': 'wrong-brand'}, {'company_id': 'wrong-company'}):
                with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, 'identity disagrees'):
                    await apply(project | changes, models)
                await unchanged_since([])
            for ids in (['A1'], ['A1', 'UNKNOWN']):
                with self.subTest(model_ids=ids), self.assertRaisesRegex(ValueError, 'identity sets differ'):
                    await apply(project, [models[0] | {'model_ids': ids, 'technical_model_count': len(ids)}])
                await unchanged_since([])

            # A failed final insert must leave neither a partial snapshot nor audit row.
            await connection.execute('ALTER TABLE staging.dw_projects ADD CONSTRAINT test_reject CHECK(false)')
            with self.assertRaises(self.asyncpg.CheckViolationError):
                await apply(project, models)
            await unchanged_since([])
            self.assertEqual(await connection.fetchval(
                "SELECT count(*) FROM audit.change_log WHERE table_name='staging.dw_projects'"), 0)
            await connection.execute('ALTER TABLE staging.dw_projects DROP CONSTRAINT test_reject')

            self.assertEqual(await apply(project, models), 'staged')
            before = await connection.fetch('SELECT * FROM staging.dw_projects')
            self.assertEqual(len(before), 1)
            stored = before[0]
            self.assertEqual(stored['source_record'], project)
            self.assertEqual(stored['model_groups'], models)
            self.assertEqual(stored['provenance'], provenance)
            self.assertEqual(stored['source_snapshot_at'], datetime.fromisoformat(project['source_snapshot_at']))
            self.assertNotEqual(stored['source_snapshot_at'], datetime.fromisoformat(provenance['captured_at']))
            self.assertEqual(await apply(project, models), 'already_staged')
            await unchanged_since(before)
            with self.assertRaisesRegex(ValueError, 'existing Gold snapshot differs'):
                await apply(project | {'commercial_project_name': 'Changed synthetic name'}, models)
            await unchanged_since(before)
            self.assertEqual(await connection.fetchval(
                "SELECT count(*) FROM audit.change_log WHERE table_name='staging.dw_projects'"), 1)
        self.assertEqual(len(attempts), 8)


if __name__ == '__main__':
    unittest.main()
