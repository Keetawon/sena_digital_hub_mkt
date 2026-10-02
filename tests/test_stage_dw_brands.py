"""Invented brand dictionary checks; disposable localhost database only."""
import copy
import hashlib
import importlib.util
import json
import os
import unittest
import uuid
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('dw_brands', ROOT / 'scripts/stage-dw-brands.py')
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)
STAMP = '2026-10-02T07:11:04+00:00'


def package():
    rows = []
    for brand_id, status, count in [('000003', 'active', 2), ('TEST-DELETED', 'deleted', 1), ('TEST-UNKNOWN', 'unknown', 0)]:
        rows.append({'brand_id': brand_id, 'brand_name_th': 'แบรนด์สมมติ ' + brand_id, 'brand_name_en': 'Synthetic ' + brand_id,
                     'brand_code': None, 'source_created_at_raw': '2021-01-01T12:00:00.017', 'source_modified_at_raw': None,
                     'deletion_flag_raw': {'active': '0', 'deleted': '1', 'unknown': None}[status], 'deletion_status': status,
                     'extracted_at': STAMP, 'source_snapshot_id': 'synthetic-snapshot', 'residential_project_count': count,
                     'non_deleted_residential_project_count': count, 'has_residential_projects': count > 0})
    exceptions = [{'exception_key': 'e' * 64, 'issue_code': 'UNKNOWN_DELETION_STATUS', 'brand_ids': ['TEST-UNKNOWN'],
                   'project_ids': [], 'owner_role': 'REM_BRAND_STEWARD', 'disposition': 'REVIEW_REQUIRED'}]
    return {'manifest_sha256': 'b' * 64, 'datasets': {'brands': rows, 'exceptions': exceptions}, 'manifest': {
        'contract_version': 'rem-brand-master-test-v1', 'environment': 'test', 'synthetic': False,
        'source_relation': 'gold_rem_brand_test.dim_brand', 'snapshot_at': STAMP, 'source_snapshot_id': 'synthetic-snapshot',
        'counts': {'brands': 3, 'exceptions': 1, 'brands_by_deletion_status': {'active': 1, 'deleted': 1, 'unknown': 1},
                   'exceptions_by_issue': {'UNKNOWN_DELETION_STATUS': 1}}, 'files': {},
    }}


def write_package(folder, data):
    for name, rows in data['datasets'].items():
        content = json.dumps(rows, ensure_ascii=False).encode('utf-8')
        (folder / f'{name}.json').write_bytes(content)
        data['manifest']['files'][f'{name}.json'] = {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest(),
                                                  'columns': list(rows[0]), 'row_count': len(rows)}
    content = json.dumps(data['manifest']).encode('utf-8')
    (folder / 'manifest.json').write_bytes(content)
    return hashlib.sha256(content).hexdigest()


class OfflineTests(unittest.TestCase):
    def test_manifest_pin_hashes_counts_and_text_ids(self):
        with TemporaryDirectory() as temporary:
            folder = Path(temporary)
            digest = write_package(folder, package())
            with self.assertRaisesRegex(ValueError, 'reviewed'):
                stage.load_package(folder)
            with patch.object(stage, 'REVIEWED_MANIFEST_SHA256', digest):
                loaded = stage.load_package(folder)
                rows = stage.mirror_rows(loaded)
                self.assertEqual([row['is_deleted'] for row in rows], [False, True, None])
                self.assertEqual(rows[0]['rem_brand_id'], '000003')
                self.assertIsNone(rows[0]['source_updated_at'])
                self.assertEqual(rows[0]['source_record']['source_created_at_raw'], '2021-01-01T12:00:00.017')
                (folder / 'brands.json').write_bytes((folder / 'brands.json').read_bytes() + b' ')
                with self.assertRaisesRegex(ValueError, 'integrity'):
                    stage.load_package(folder)
            data = package()
            data['manifest']['counts']['brands'] = 4
            digest = write_package(folder, data)
            with patch.object(stage, 'REVIEWED_MANIFEST_SHA256', digest), self.assertRaisesRegex(ValueError, 'counts'):
                stage.load_package(folder)

    def test_numeric_duplicate_ids_unknown_status_and_mixed_lineage_are_rejected(self):
        changes = [('brand_id', 3), ('brand_id', 'TEST-DELETED'), ('deletion_status', 'unknown'),
                   ('extracted_at', '2026-10-02T07:11:04'), ('source_snapshot_id', 'other'),
                   ('residential_project_count', True)]
        for key, value in changes:
            with self.subTest(key=key), TemporaryDirectory() as temporary:
                data = package()
                data['datasets']['brands'][0][key] = value
                folder = Path(temporary)
                digest = write_package(folder, data)
                with patch.object(stage, 'REVIEWED_MANIFEST_SHA256', digest), self.assertRaises(ValueError):
                    stage.load_package(folder)


@unittest.skipUnless(os.getenv('HUB_INTAKE_TEST_DB') == '1', 'Opt in to disposable local PostgreSQL')
class DatabaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import asyncpg
        self.pg = asyncpg
        self.database = 'hub_brand_intake_test_' + uuid.uuid4().hex
        config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
        options = dict(host='127.0.0.1', port=55432, user='postgres', password=config['adminPassword'])
        self.admin = await asyncpg.connect(database='postgres', **options)
        await self.admin.execute(f'CREATE DATABASE "{self.database}"')
        self.addAsyncCleanup(self.cleanup)
        self.db = await asyncpg.connect(database=self.database, **options)
        for migration in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
            # Brand/intake dependencies only; later unrelated role DDL is cluster-wide.
            if int(migration.name[8:12]) <= 7 or migration.name.startswith('202610020026_'):
                await self.db.execute(migration.read_text(encoding='utf-8'))
        await stage.pilot_stage.configure_json(self.db)

    async def cleanup(self):
        if getattr(self, 'db', None):
            await self.db.close()
        self.assertRegex(self.database, r'^hub_brand_intake_test_[0-9a-f]{32}$')
        await self.admin.execute(f'DROP DATABASE "{self.database}"')
        await self.admin.close()

    async def test_atomic_intake_exact_replay_immutability_and_admin_identity_only(self):
        data = package()
        await self.db.execute("ALTER TABLE staging.rem_brands ADD CONSTRAINT test_fail CHECK(rem_brand_id<>'TEST-UNKNOWN')")
        with self.assertRaises(self.pg.CheckViolationError):
            await stage.stage_package(self.db, data)
        self.assertEqual(await self.db.fetchval('SELECT count(*) FROM staging.intake_batches'), 0)
        self.assertEqual(await self.db.fetchval('SELECT count(*) FROM staging.rem_brands'), 0)
        await self.db.execute('ALTER TABLE staging.rem_brands DROP CONSTRAINT test_fail')
        self.assertEqual(await stage.stage_package(self.db, data), 'staged')
        before = await self.db.fetch('SELECT * FROM staging.intake_batches')
        self.assertEqual(await stage.stage_package(self.db, data), 'already_staged')
        self.assertEqual(await self.db.fetch('SELECT * FROM staging.intake_batches'), before)
        self.assertEqual(await self.db.fetchval('SELECT count(*) FROM hub.brands'), 0)
        with self.assertRaises(self.pg.CheckViolationError):
            await self.db.execute('UPDATE staging.intake_batches SET imported_at=now()')
        await self.db.execute("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000005',false)")
        await self.db.execute('SET ROLE admin')
        for source in ('TEST-DELETED', 'TEST-UNKNOWN'):
            with self.assertRaises(self.pg.NoDataFoundError):
                await self.db.fetchval('SELECT hub.create_brand_from_rem($1)', source)
        brand = await self.db.fetchval("SELECT hub.create_brand_from_rem('000003')")
        created = await self.db.fetchrow('SELECT rem_brand_id,public_name,description,slug,published_version_id FROM hub.brands WHERE id=$1', brand)
        self.assertEqual(dict(created), dict(rem_brand_id='000003', public_name={}, description={}, slug='', published_version_id=None))
        sources = await self.db.fetchval('SELECT hub.list_rem_brands()')
        unknown = next(row for row in sources if row['rem_brand_id'] == 'TEST-UNKNOWN')
        self.assertEqual(unknown['deletion_status'], 'unknown')
        self.assertEqual(unknown['exception_codes'], ['UNKNOWN_DELETION_STATUS'])
        await self.db.execute('SET ROLE editor')
        with self.assertRaises(self.pg.InsufficientPrivilegeError):
            await self.db.fetchval("SELECT hub.create_brand_from_rem('000003')")
        await self.db.execute('RESET ROLE')
        await self.db.execute("UPDATE staging.rem_brands SET source_record=jsonb_set(source_record,'{has_residential_projects}','1') WHERE rem_brand_id='000003'")
        with self.assertRaisesRegex(ValueError, 'changed'):
            await stage.stage_package(self.db, data)

    async def test_fresh_synthetic_bootstrap_supplies_hub_owned_public_name(self):
        for file in ('supabase/seed.sql', 'scripts/sample-intake.sql', 'scripts/sample-brands.sql'):
            await self.db.execute((ROOT / file).read_text(encoding='utf-8'))
        public = await self.db.fetchval("SELECT payload#>>'{public_name,th}' FROM public_api.brands WHERE payload->>'rem_brand_id'='DEMO-BRAND-01'")
        self.assertEqual(public, 'แบรนด์จำลอง — สำหรับทดสอบเท่านั้น')

    async def test_bounded_predecessor_enrichment_preserves_hub_and_rejects_conflicts(self):
        # The real pilot format is reused with invented identities, including its immutable batch.
        spec = importlib.util.spec_from_file_location('pilot_tests', ROOT / 'tests/test_stage_pilot_intake.py')
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        old = helper.sample_package()
        digest = next(iter(stage.PREDECESSORS))
        old['manifest_sha256'] = digest
        with patch.object(stage.pilot_stage.pilot, 'PILOT_IDS', helper.PROJECTS):
            await stage.pilot_stage.stage_package(self.db, old)
        await self.db.execute("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000005',false)")
        await self.db.execute('SET ROLE admin')
        await self.db.fetchval("SELECT hub.create_brand_from_rem('000003')")
        await self.db.execute('RESET ROLE')
        saved_hub = await self.db.fetch('SELECT * FROM hub.brands')
        saved_old = await self.db.fetchrow('SELECT * FROM staging.intake_batches WHERE manifest_sha256=$1', digest)
        incoming = package()
        row = incoming['datasets']['brands'][0]
        source = old['datasets']['brands']['rows'][0]['record']
        row.update(brand_name_th=source['brand_name_th'], brand_name_en=source.get('brand_name_en'), brand_code=source.get('brand_code'),
                   source_created_at_raw=source.get('source_created_at'), source_modified_at_raw=source['source_modified_at'])
        conflict = copy.deepcopy(incoming)
        conflict['datasets']['brands'][0]['brand_name_th'] = 'Changed identity'
        with self.assertRaisesRegex(ValueError, 'identity'):
            await stage.stage_package(self.db, conflict)
        self.assertEqual(await self.db.fetchval('SELECT count(*) FROM staging.intake_batches'), 1)
        self.assertEqual(await stage.stage_package(self.db, incoming), 'staged')
        self.assertEqual(await self.db.fetch('SELECT * FROM hub.brands'), saved_hub)
        self.assertEqual(await self.db.fetchrow('SELECT * FROM staging.intake_batches WHERE manifest_sha256=$1', digest), saved_old)


if __name__ == '__main__':
    unittest.main()
