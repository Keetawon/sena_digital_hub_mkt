"""Synthetic checks; opt in to a disposable local database with HUB_INTAKE_TEST_DB=1."""
import copy
import hashlib
import importlib.util
import json
import os
import re
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('stage_pilot_intake', ROOT / 'scripts/stage-pilot-intake.py')
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)
PROJECTS = {'TEST-P01', 'TEST-P02'}
SNAPSHOT = '2026-01-02T03:04:05+00:00'


def sample_package(projects=PROJECTS, brand_id='000003', company_id='TEST-CO'):
    common = {'is_deleted': False, 'source_modified_at': '2026-01-01T12:34:56'}
    data = {
        'projects': [dict(common, project_id=p, project_name_th='Synthetic project',
                          brand_id=brand_id, company_id=company_id) for p in sorted(projects)],
        'brands': [dict(common, brand_id=brand_id, brand_name_th='Synthetic brand')],
        'companies': [dict(common, company_id=company_id, company_name_th='Synthetic company')],
        'models': [dict(common, project_id=p, model_id=m, model_name_th='Synthetic model',
                        model_type_id='TEST-TYPE', model_area='24.00')
                   for p in sorted(projects) for m in ('A1-1L', 'A1-1R')],
        'model_types': [dict(common, model_type_id='TEST-TYPE', model_type_name_th='Synthetic type',
                             source_modified_at=None)],
    }
    datasets = {
        name: {'source_relation': relation, 'primary_key': list(keys), 'source_snapshot_at': SNAPSHOT,
               'rows': [{'record': row, 'source_fingerprint': stage.pilot.fingerprint(row)} for row in data[name]]}
        for name, (relation, keys, _) in stage.pilot.SPECS.items()
    }
    return {'manifest_sha256': 'a' * 64,
            'manifest': {'synthetic_test': True, 'requested_project_ids': sorted(projects)}, 'datasets': datasets}


def write_package(folder, package=None):
    """Build the real review contract, with invented records and no REM connection."""
    package = package or sample_package()
    datasets = package['datasets']
    data = {name: [row['record'] for row in dataset['rows']] for name, dataset in datasets.items()}
    manifest = {
        'contract': 'sena_hub_residential_intake_review', 'contract_version': 1,
        'source_instance': 'SENA_PRD', 'verified_source_context': {'database_name': 'SENA_PRD'},
        'requested_project_ids': sorted(row['project_id'] for row in data['projects']), 'hub_import_performed': False,
        'human_mappings_confirmed': False, 'files': {}, 'datasets': {},
        'second_pass_read_times_utc': {name: SNAPSHOT for name in datasets},
        'complete_read_fingerprints': [stage.pilot.fingerprint(data)] * 2,
    }
    for name, dataset in datasets.items():
        stage.pilot.save_json(folder / f'{name}.json', dataset)
        manifest['datasets'][name] = {
            'file': f'{name}.json', 'source_relation': dataset['source_relation'],
            'primary_key': dataset['primary_key'],
            **{key: len(dataset['rows']) for key in ('row_count', 'source_count_first_pass', 'source_count_second_pass')},
        }
    stage.pilot.save_json(folder / 'review.json', stage.pilot.review(data))
    (folder / 'queries.sql').write_text('-- Synthetic fixture; no source query executed.\n', encoding='utf-8')
    for file in folder.iterdir():
        raw = file.read_bytes()
        manifest['files'][file.name] = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
    stage.pilot.save_json(folder / 'manifest.json', manifest)
    digest = hashlib.sha256((folder / 'manifest.json').read_bytes()).hexdigest()
    (folder / 'manifest.sha256').write_text(digest + '  manifest.json\n', encoding='ascii')
    return digest


class StagingOfflineTests(unittest.TestCase):
    def setUp(self):
        self.scope = patch.object(stage.pilot, 'PILOT_IDS', PROJECTS)
        self.scope.start()
        self.addCleanup(self.scope.stop)

    def test_exact_keys_raw_area_and_unverified_source_time(self):
        package = sample_package()
        before = copy.deepcopy(package)
        mirrors = stage.mirror_rows(package)
        self.assertEqual(package, before)
        self.assertEqual(mirrors['brands'][0]['rem_brand_id'], '000003')
        self.assertEqual({(r['rem_project_id'], r['rem_model_id']) for r in mirrors['models']},
                         {(p, m) for p in PROJECTS for m in ('A1-1L', 'A1-1R')})
        for rows in mirrors.values():
            for row in rows:
                self.assertIsNone(row['source_updated_at'])
                self.assertEqual(row['source_record']['source_modified_at'], '2026-01-01T12:34:56')
                self.assertEqual(row['source_snapshot_at'].isoformat(), SNAPSHOT)
                self.assertEqual(row['intake_manifest_sha256'], package['manifest_sha256'])
                self.assertNotIn('usable_area_sqm', row)
        self.assertTrue(all(r['source_record']['model_area'] == '24.00' for r in mirrors['models']))

    def test_ineligible_or_unresolved_records_cannot_become_selectable(self):
        changes = [
            ('models', 'is_deleted', None), ('models', 'is_deleted', True),
            ('models', 'is_deleted', 0), ('projects', 'brand_id', 'MISSING'),
            ('projects', 'company_id', 'MISSING'), ('models', 'model_type_id', 'MISSING'),
            ('model_types', 'is_deleted', True), ('models', 'project_id', 'OUTSIDE'),
        ]
        for name, field, value in changes:
            with self.subTest(dataset=name, field=field, value=value):
                package = sample_package()
                package['datasets'][name]['rows'][0]['record'][field] = value
                with self.assertRaises(ValueError):
                    stage.mirror_rows(package)
        package = sample_package()
        package['datasets']['models']['source_snapshot_at'] = '2026-01-02T03:04:05'
        with self.assertRaisesRegex(ValueError, 'UTC'):
            stage.mirror_rows(package)

    def test_unreviewed_manifest_and_tampered_bytes_are_stopped(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            digest = write_package(folder)
            with self.assertRaisesRegex(ValueError, 'explicitly reviewed'):
                stage.load_package(folder)
            # Only the fixture digest is permitted inside this test; production remains pinned.
            with patch.object(stage, 'REVIEWED_MANIFEST_SHA256', digest):
                self.assertEqual(stage.load_package(folder)['manifest_sha256'], digest)
                with (folder / 'models.json').open('ab') as handle:
                    handle.write(b' ')
                with self.assertRaisesRegex(ValueError, 'integrity mismatch'):
                    stage.load_package(folder)

    def test_superseded_review_remains_verifiable_but_cannot_be_loaded(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            old_digest = write_package(folder)
            with patch.object(stage.pilot, 'PILOT_IDS', {'TEST-NEW'}), \
                    patch.object(stage.pilot, 'HISTORICAL_PILOT_IDS', PROJECTS), \
                    patch.object(stage, 'REVIEWED_MANIFEST_SHA256', 'f' * 64):
                self.assertEqual(stage.pilot.verify_package(folder)['projects'], 2)
                self.assertNotEqual(old_digest, stage.REVIEWED_MANIFEST_SHA256)
                with self.assertRaisesRegex(ValueError, 'explicitly reviewed'):
                    stage.load_package(folder)


@unittest.skipUnless(os.getenv('HUB_INTAKE_TEST_DB') == '1', 'Opt in to the disposable local PostgreSQL test')
class StagingDatabaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import asyncpg

        self.asyncpg = asyncpg
        self.scope = patch.object(stage.pilot, 'PILOT_IDS', PROJECTS)
        self.scope.start()
        self.addCleanup(self.scope.stop)
        self.database = 'hub_intake_test_' + uuid.uuid4().hex
        self.assertRegex(self.database, r'^hub_intake_test_[0-9a-f]{32}$')
        self.admin = self.connection = None
        self.created = False
        self.addAsyncCleanup(self.cleanup_database)
        config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
        connection_options = dict(host='127.0.0.1', port=55432, user='postgres',
                                  password=config['adminPassword'], timeout=10)
        try:
            self.admin = await asyncpg.connect(database='postgres', **connection_options)
            await self.admin.execute(f'CREATE DATABASE "{self.database}"')
            self.created = True
            self.connection = await asyncpg.connect(database=self.database, **connection_options)
        except Exception:
            raise RuntimeError('Cannot open disposable local test database; start the existing local PostgreSQL runner.') from None
        for migration in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
            await self.connection.execute(migration.read_text(encoding='utf-8'))
        await stage.configure_json(self.connection)

    async def cleanup_database(self):
        if self.connection is not None:
            await self.connection.close()
        if self.admin is not None:
            try:
                if self.created:
                    if not re.fullmatch(r'hub_intake_test_[0-9a-f]{32}', self.database):
                        raise RuntimeError('Unsafe test database name; refusing cleanup')
                    await self.admin.execute(f'DROP DATABASE "{self.database}"')
            finally:
                await self.admin.close()

    async def test_transaction_replay_unconfirmed_selection_and_private_evidence(self):
        connection = self.connection
        package = sample_package()
        tables = ('intake_batches', 'rem_brands', 'rem_companies', 'rem_projects', 'rem_models')

        async def counts():
            return [await connection.fetchval(f'SELECT count(*) FROM staging.{name}') for name in tables]

        # Failure at the final insert must roll back the earlier batch and dictionaries.
        await connection.execute("ALTER TABLE staging.rem_models ADD CONSTRAINT test_reject CHECK(rem_model_id <> 'A1-1R')")
        with self.assertRaises(self.asyncpg.CheckViolationError):
            await stage.stage_package(connection, package)
        self.assertEqual(await counts(), [0, 0, 0, 0, 0])
        await connection.execute('ALTER TABLE staging.rem_models DROP CONSTRAINT test_reject')

        await connection.execute("INSERT INTO staging.rem_brands(rem_brand_id,brand_name_rem,source_fingerprint) VALUES('000003','Existing synthetic brand','existing')")
        with self.assertRaisesRegex(ValueError, 'conflict'):
            await stage.stage_package(connection, package)
        self.assertEqual(await counts(), [0, 1, 0, 0, 0])
        await connection.execute('DELETE FROM staging.rem_brands')

        self.assertEqual(await stage.stage_package(connection, package), 'staged')
        imported_at = await connection.fetchval('SELECT imported_at FROM staging.intake_batches')
        self.assertEqual(await stage.stage_package(connection, package), 'already_staged')
        self.assertEqual(await counts(), [1, 1, 1, 2, 4])
        self.assertEqual(await connection.fetchval('SELECT imported_at FROM staging.intake_batches'), imported_at)
        for table in ('brands', 'projects', 'model_types', 'entity_versions', 'brand_versions'):
            self.assertEqual(await connection.fetchval(f'SELECT count(*) FROM hub.{table}'), 0)
        self.assertEqual(await connection.fetchval('SELECT datasets FROM staging.intake_batches'), package['datasets'])
        for table in ('rem_brands', 'rem_companies', 'rem_projects', 'rem_models'):
            for row in await connection.fetch(f'SELECT source_updated_at,source_snapshot_at,source_record FROM staging.{table}'):
                self.assertIsNone(row['source_updated_at'])
                self.assertEqual(row['source_snapshot_at'].isoformat(), SNAPSHOT)
                self.assertEqual(row['source_record']['source_modified_at'], '2026-01-01T12:34:56')

        changed = copy.deepcopy(package)
        changed['manifest']['synthetic_test'] = 'different'
        with self.assertRaisesRegex(ValueError, 'conflict'):
            await stage.stage_package(connection, changed)
        # JSON false and zero compare equal in Python; replay must compare exact JSON evidence.
        await connection.execute("UPDATE staging.rem_models SET source_record=jsonb_set(source_record,'{is_deleted}','0') WHERE rem_project_id='TEST-P01' AND rem_model_id='A1-1L'")
        with self.assertRaisesRegex(ValueError, 'changed'):
            await stage.stage_package(connection, package)
        await connection.execute("UPDATE staging.rem_models SET source_record=jsonb_set(source_record,'{is_deleted}','false') WHERE rem_project_id='TEST-P01' AND rem_model_id='A1-1L'")
        with self.assertRaises(self.asyncpg.CheckViolationError):
            await connection.execute("UPDATE staging.intake_batches SET manifest='{}'")

        async with connection.transaction():
            await connection.execute('SET LOCAL ROLE admin')
            await connection.execute("SELECT set_config('app.actor_id',$1,true)", str(uuid.uuid4()))
            sources = await connection.fetchval('SELECT hub.list_rem_projects()')
            self.assertTrue(all(s['source_record'] and s['intake_manifest_sha256'] for s in sources))
            brand_id = await connection.fetchval("SELECT hub.create_brand_from_rem('000003')")
            project_id = await connection.fetchval("SELECT hub.create_project_from_rem('TEST-P01')")
            public_id = await connection.fetchval('SELECT public_project_id FROM hub.projects WHERE id=$1', project_id)
            detail = await connection.fetchval('SELECT hub.project_detail($1)', public_id)
            self.assertEqual(detail['source']['source_record']['project_id'], 'TEST-P01')
            self.assertEqual(len(detail['models']), 2)
            for model in detail['models']:
                self.assertEqual(model['match_status'], 'SUGGESTED')
                for field in ('verified_by', 'verified_at', 'bedrooms', 'bathrooms', 'usable_area_sqm'):
                    self.assertIsNone(model[field])
                self.assertEqual(model['source_record']['model_area'], '24.00')
                self.assertEqual(model['intake_manifest_sha256'], package['manifest_sha256'])

        for query, identifier in [('SELECT hub.draft_payload($1)', project_id),
                                  ('SELECT hub.brand_draft_payload($1)', brand_id)]:
            payload = json.dumps(await connection.fetchval(query, identifier))
            self.assertNotIn('source_record', payload)
            self.assertNotIn('intake_manifest_sha256', payload)
        for statement in ('SELECT * FROM staging.intake_batches', 'SELECT * FROM staging.rem_models',
                          'SELECT hub.list_rem_projects()', 'SELECT hub.list_rem_brands()'):
            with self.assertRaises(self.asyncpg.InsufficientPrivilegeError):
                async with connection.transaction():
                    await connection.execute('SET LOCAL ROLE service_consumer')
                    await connection.fetch(statement)
        async with connection.transaction():
            await connection.execute('SET LOCAL ROLE service_consumer')
            self.assertEqual(await connection.fetchval('SELECT count(*) FROM public_api.projects'), 0)
            self.assertEqual(await connection.fetchval('SELECT count(*) FROM public_api.brands'), 0)

    async def test_replacement_retains_history_and_rolls_back_any_partial_retirement(self):
        connection = self.connection
        old = sample_package()
        new = sample_package({'TEST-NEW'}, brand_id='000004', company_id='NEW-CO')
        new['manifest_sha256'] = 'b' * 64
        self.assertEqual(await stage.stage_package(connection, old), 'staged')

        async def stored_sources():
            return {name: [dict(row) for row in await connection.fetch(
                f'SELECT * FROM staging.{name} ORDER BY 1')]
                for name in ('intake_batches', 'rem_brands', 'rem_companies', 'rem_projects', 'rem_models')}

        original = await stored_sources()
        with patch.object(stage.pilot, 'PILOT_IDS', {'TEST-NEW'}), \
                patch.object(stage.pilot, 'HISTORICAL_PILOT_IDS', PROJECTS), \
                patch.object(stage, 'SUPERSEDED_MANIFEST_SHA256', old['manifest_sha256']):
            # Existing drafts and their evidence remain intact while new intake proceeds.
            transaction = connection.transaction()
            await transaction.start()
            try:
                await connection.execute('SET LOCAL ROLE admin')
                await connection.execute("SELECT set_config('app.actor_id',$1,true)", str(uuid.uuid4()))
                await connection.fetchval("SELECT hub.create_project_from_rem('TEST-P01')")
                await connection.execute('SET LOCAL ROLE NONE')
                drafts = {table: await connection.fetch(f'SELECT * FROM hub.{table} ORDER BY 1')
                          for table in ('projects', 'model_types', 'entity_versions')}
                self.assertEqual(await stage.stage_package(connection, new), 'staged')
                self.assertEqual(await stage.stage_package(connection, new), 'already_staged')
                combined = await stored_sources()
                for table, rows in original.items():
                    self.assertTrue(all(row in combined[table] for row in rows), table)
                self.assertEqual(len(combined['intake_batches']), 2)
                self.assertEqual({row['rem_project_id'] for row in combined['rem_projects']}, PROJECTS | {'TEST-NEW'})
                self.assertEqual(len(combined['rem_models']), 6)
                for table, rows in drafts.items():
                    self.assertEqual(await connection.fetch(f'SELECT * FROM hub.{table} ORDER BY 1'), rows)
            finally:
                await transaction.rollback()

            # Changed evidence and unrelated rows must stop retirement as well.
            await connection.execute("UPDATE staging.rem_models SET source_record=jsonb_set(source_record,'{is_deleted}','0') WHERE rem_project_id='TEST-P01'")
            with self.assertRaisesRegex(ValueError, 'changed'):
                await stage.stage_package(connection, new)
            await connection.execute("UPDATE staging.rem_models SET source_record=jsonb_set(source_record,'{is_deleted}','false') WHERE rem_project_id='TEST-P01'")
            await connection.execute("UPDATE staging.rem_models SET intake_manifest_sha256=NULL WHERE rem_project_id='TEST-P01'")
            with self.assertRaisesRegex(ValueError, 'unrelated'):
                await stage.stage_package(connection, new)
            await connection.execute("UPDATE staging.rem_models SET intake_manifest_sha256=$1 WHERE rem_project_id='TEST-P01'", old['manifest_sha256'])
            await connection.execute("UPDATE staging.rem_projects SET project_name_rem='Changed derived label' WHERE rem_project_id='TEST-P01'")
            with self.assertRaisesRegex(ValueError, 'changed'):
                await stage.stage_package(connection, new)
            await connection.execute("UPDATE staging.rem_projects SET project_name_rem='Synthetic project' WHERE rem_project_id='TEST-P01'")
            self.assertEqual(await stored_sources(), original)

            # A late failure inserting the new models restores every deleted old mirror.
            await connection.execute("ALTER TABLE staging.rem_models ADD CONSTRAINT test_new_failure CHECK(rem_project_id <> 'TEST-NEW')")
            with self.assertRaises(self.asyncpg.CheckViolationError):
                await stage.stage_package(connection, new)
            self.assertEqual(await stored_sources(), original)
            await connection.execute('ALTER TABLE staging.rem_models DROP CONSTRAINT test_new_failure')

            self.assertEqual(await stage.stage_package(connection, new), 'staged')
            self.assertEqual(await stage.stage_package(connection, new), 'already_staged')
            stored = await stored_sources()
            self.assertEqual(len(stored['intake_batches']), 2)
            retained = next(row for row in stored['intake_batches'] if row['manifest_sha256'] == old['manifest_sha256'])
            self.assertEqual(retained, original['intake_batches'][0])
            self.assertEqual([row['rem_project_id'] for row in stored['rem_projects']], ['TEST-NEW'])
            self.assertEqual({row['rem_project_id'] for row in stored['rem_models']}, {'TEST-NEW'})
            self.assertEqual(len(stored['rem_models']), 2)
            self.assertEqual([row['rem_brand_id'] for row in stored['rem_brands']], ['000004'])
            self.assertEqual([row['rem_company_id'] for row in stored['rem_companies']], ['NEW-CO'])
            self.assertEqual(await connection.fetchval('SELECT count(*) FROM hub.projects'), 0)


if __name__ == '__main__':
    unittest.main()
