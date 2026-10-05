"""Synthetic contract tests; no DB connection or real source files."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('review_projects', Path(__file__).resolve().parents[1] / 'scripts/review-dw-projects.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def row(columns, **values):
    return {key: values.get(key) for key in columns}


def fixture(folder):
    project = row(review.PROJECT_COLUMNS, ProjectID='00001', ProjectName='Synthetic project', ProjectType='H',
                  BrandID='000001', ProjectStatus='2', isDeleteRaw='0', isDeleted=False)
    model = row(review.MODEL_COLUMNS, ProjectID='00001', ModelID='001 ', ModelName='Synthetic model', isDeleteRaw='0', isDeleted=False)
    gold = {'project_model_key': 'synthetic-group', 'project_id': '00001', 'model_ids': ['001 '], 'model_type_ids': [], 'model_names_eng': [], 'technical_model_count': 1}
    counts = {'projects': 1, 'models': 1, 'gold_projects': 1, 'gold_models': 1, 'exceptions': 0,
              'gold_project_rows': 0, 'missing_gold_project_rows': 1, 'exceptions_by_type': {}}
    datasets = {'projects': [project], 'models': [model], 'gold_projects': [{'project_id': '00001', 'gold': None}], 'gold_models': [gold],
                'exceptions': [], 'review': {'counts': counts}}
    metadata = {}
    for name, data in datasets.items():
        content = (json.dumps(data, ensure_ascii=False) + '\n').encode()
        (folder / (name + '.json')).write_bytes(content)
        columns = review.PROJECT_COLUMNS if name == 'projects' else review.MODEL_COLUMNS if name == 'models' else list(data if name == 'review' else data[0] if data else {})
        metadata[name + '.json'] = {'bytes': len(content), 'sha256': review.digest(content), 'row_count': 1 if name == 'review' else len(data), 'columns': columns}
    stamp = '2026-10-03T09:00:00+00:00'
    manifest = {'contract_version': 'rem-project-model-review-v1', 'environment': 'local_review', 'synthetic': True,
                'files': metadata, 'counts': counts, 'gold_project_columns': [f'field_{n}' for n in range(105)], 'gold_project_nested_column_count': 105,
                'consistency': {'cross_database_consistent_snapshot': False}, 'extracted_at': stamp,
                'sources': {key: {'read_started_at': stamp, 'read_finished_at': stamp} for key in ('rem', 'dw')}}
    return write_manifest(folder, manifest)


def write_manifest(folder, manifest):
    content = (json.dumps(manifest) + '\n').encode()
    (folder / 'manifest.json').write_bytes(content)
    digest = review.digest(content)
    (folder / 'manifest.sha256').write_text(digest + '  manifest.json\n', encoding='ascii')
    return digest


class ReviewTests(unittest.TestCase):
    def test_integrity_is_complete_and_reviewed_hash_is_an_argument(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp); digest = fixture(folder)
            package = review.load_package(folder, digest)
            self.assertTrue(package['manifest']['synthetic'])
            self.assertEqual(package['datasets']['models'][0]['ModelID'], '001 ')
            self.assertTrue(review.reconcile(package['datasets']['models'], package['datasets']['gold_models'])['exact_coverage_passes'])
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                review.load_package(folder, '0' * 64)
            (folder / 'models.json').write_bytes(b'[]')
            with self.assertRaisesRegex(ValueError, 'hash or size'):
                review.load_package(folder, digest)

    def test_reviewed_hash_does_not_hide_bad_columns_counts_or_deletion_types(self):
        for mutation in ('columns', 'count', 'deletion'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                folder = Path(temp); fixture(folder)
                manifest = json.loads((folder / 'manifest.json').read_text())
                if mutation == 'columns':
                    manifest['files']['models.json']['columns'].append('invented')
                elif mutation == 'count':
                    manifest['counts']['models'] = 2
                else:
                    rows = json.loads((folder / 'models.json').read_text()); rows[0]['isDeleted'] = 0
                    content = json.dumps(rows).encode(); (folder / 'models.json').write_bytes(content)
                    manifest['files']['models.json'].update(bytes=len(content), sha256=review.digest(content))
                with self.assertRaises(ValueError):
                    review.load_package(folder, write_manifest(folder, manifest))

    def test_exact_reconciliation_reports_deleted_unmapped_space_mismatch_and_multiple_groups(self):
        raw = [{'ProjectID': 'P', 'ModelID': key, 'isDeleted': deleted} for key, deleted in [('A ', False), ('D', True), ('M', False)]]
        gold = [{'project_id': 'P', 'project_model_key': key, 'model_ids': ids} for key, ids in [('g1', ['A', 'M']), ('g2', ['M'])]]
        result = review.reconcile(raw, gold)
        self.assertFalse(result['exact_coverage_passes'])
        self.assertEqual([r['ModelID'] for r in result['raw_without_group']], ['A ', 'D'])
        self.assertEqual(result['ungrouped_deleted_count'], 1)
        self.assertEqual(result['raw_in_multiple_groups'][0]['ModelID'], 'M')
        self.assertEqual(result['gold_ids_without_raw'][0]['model_id'], 'A')

    def test_dw_only_snapshot_keeps_rem_unread_and_preserves_watermarks(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp); fixture(folder)
            manifest = json.loads((folder / 'manifest.json').read_text())
            manifest['consistency'].update(rem_isolation='NOT READ', dw_isolation='REPEATABLE READ READ ONLY')
            manifest['sources']['rem'] = {'read_started_at': None, 'read_finished_at': None, 'identity': {'database_name': None}}
            manifest['sources']['dw']['identity'] = {'bronze_load_watermarks': {'synthetic': {'load_ids': ['20261005']}}}
            manifest['gold_source_watermarks'] = {'synthetic': {'minimum_at': '2026-10-03T09:00:00+00:00'}}
            package = review.load_package(folder, write_manifest(folder, manifest))
            result = review.report(package)
            self.assertIsNone(result['source_read_windows']['rem']['read_started_at'])
            self.assertEqual(result['bronze_load_watermarks'], manifest['sources']['dw']['identity']['bronze_load_watermarks'])
            self.assertEqual(result['gold_source_watermarks'], manifest['gold_source_watermarks'])
            manifest['sources']['rem']['read_started_at'] = manifest['extracted_at']
            with self.assertRaisesRegex(ValueError, 'invented read evidence'):
                review.load_package(folder, write_manifest(folder, manifest))

    def test_status_scope_retains_unknown_raw_codes_and_excludes_deleted(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp); package = review.load_package(folder, fixture(folder))
            base = package['datasets']['projects'][0]
            package['datasets']['projects'] = [dict(base, ProjectID=str(i), ProjectStatus=status, isDeleted=deleted)
                                              for i, (status, deleted) in enumerate([('0', False), ('1', False), ('2', False), ('3', False), ('4', False), (None, False), ('2', True)])]
            result = review.report(package)
            self.assertEqual(result['default_scope_count'], 3)
            self.assertEqual([r['ProjectStatus'] for r in result['unknown_status_projects']], ['4', None])
            self.assertIn('LOCAL_HYABC_COMPARISON_NOT_RUN', result['blockers'])

    def test_comparison_normalizes_only_measure_and_timestamp_representation(self):
        self.assertTrue(review.equivalent('ModifyDate', '2026-01-01T01:00:00.123000', '2026-01-01T01:00:00.123'))
        self.assertTrue(review.equivalent('ModelArea', '25.20', '25.2'))
        self.assertFalse(review.equivalent('ModelID', '001 ', '001'))
        self.assertFalse(review.equivalent('BrandID', '000001', '1'))

    def test_package_comparison_separates_raw_noops_from_private_gold_measure_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp); before = review.load_package(folder, fixture(folder))
            before['datasets']['gold_models'][0].update(available_unit_count=2, source_snapshot_at='2026-10-03')
            after = copy.deepcopy(before)
            after['datasets']['gold_models'][0].update(available_unit_count=1, source_snapshot_at='2026-10-05')
            result = review.compare_packages(before, after)
            self.assertFalse(result['database_applied'])
            self.assertEqual(result['datasets']['models']['identical_rows'], 1)
            self.assertEqual(result['datasets']['gold_models']['price_or_unit_count_changed_rows'], 1)
            after['datasets']['gold_models'][0]['available_unit_count'] = 2
            result = review.compare_packages(before, after)
            self.assertEqual(result['datasets']['gold_models']['changed_rows'], 1)
            self.assertEqual(result['datasets']['gold_models']['price_or_unit_count_changed_rows'], 0)

    def test_hyabc_checks_pilot_model_set_gold_identity_and_protected_synthetic_model(self):
        pilot = {'project_id': 'HYABC', 'brand_id': '25', 'company_id': 'HSP', 'project_type': 'C', 'project_status': '2'}
        project = row(review.PROJECT_COLUMNS, ProjectID='HYABC', BrandID='25', CompanyID='HSP', ProjectGroupID='SYNTHETIC-G', ProjectType='C', ProjectStatus='2')
        models = [{'project_id': 'HYABC', 'model_id': f'M{i:02}'} for i in range(13)]
        incoming_models = [row(review.MODEL_COLUMNS, ProjectID='HYABC', ModelID=m['model_id']) for m in models]
        gold = {'project_id': 'HYABC', 'rem_brand_id': '25', 'company_id': 'HSP', 'rem_project_group_id': 'SYNTHETIC-G',
                'marketing_project_group_id': 'SYNTHETIC-G', 'commercial_brand': 'SYNTHETIC'}
        groups = [{'project_model_key': 'group-' + m['model_id'], 'project_id': 'HYABC', 'model_ids': [m['model_id']]} for m in models]
        tables = {'staging.rem_projects': [{'rem_project_id': 'HYABC', 'intake_manifest_sha256': 'synthetic-pilot', 'source_record': pilot}],
                  'staging.intake_batches': [{'manifest_sha256': 'synthetic-pilot', 'datasets': {'projects': {'rows': [{'record': pilot}]}, 'models': {'rows': [{'record': m} for m in models]}}}],
                  'staging.dw_projects': [{'rem_project_id': 'HYABC', 'source_record': gold, 'model_groups': groups}],
                  'staging.rem_models': [{'rem_project_id': 'HYABC', 'rem_model_id': m['model_id'], 'source_record': m} for m in models]
                      + [{'rem_project_id': 'HYABC', 'rem_model_id': 'DEMO-HYABC-01', 'source_record': {'synthetic_only': True}}]}
        package = {'datasets': {'projects': [project], 'models': incoming_models, 'gold_projects': [{'project_id': 'HYABC', 'gold': gold}], 'gold_models': groups}}
        result = review.compare_hyabc(package, tables)
        self.assertTrue(result['identity_matches']); self.assertTrue(result['status_is_expected_2'])
        self.assertEqual(result['local_synthetic_models_preserved'], ['DEMO-HYABC-01'])
        changed = copy.deepcopy(package)
        changed['datasets']['gold_projects'][0]['gold']['rem_brand_id'] = '000025'
        self.assertFalse(review.compare_hyabc(changed, tables)['identity_matches'])
        changed = copy.deepcopy(package); changed['datasets']['models'][0]['ModelID'] += ' '
        self.assertFalse(review.compare_hyabc(changed, tables)['raw_model_ids_match'])


if __name__ == '__main__':
    unittest.main()
