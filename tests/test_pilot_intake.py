"""Offline safety checks for pilot source evidence, using synthetic records."""
import copy
import importlib.util
import unittest
from unittest.mock import patch
from decimal import Decimal
from pathlib import Path

spec = importlib.util.spec_from_file_location('pilot_intake', Path(__file__).resolve().parents[1] / 'scripts' / 'prepare-pilot-intake.py')
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


def sample():
    common = {'is_deleted':False, 'source_modified_at':'2026-01-01T00:00:00'}
    return {
        'projects':[dict(common, project_id=p, project_name_th='Synthetic project', brand_id='000003', company_id='DEMO') for p in sorted(pilot.PILOT_IDS)],
        'brands':[dict(common, brand_id='000003', brand_name_th='Synthetic brand')],
        'companies':[dict(common, company_id='DEMO', company_name_th='Synthetic company')],
        'models':[dict(common, project_id=p, model_id='SAME-CODE', model_name_th='Synthetic model', model_type_id='TYPE', model_area='24.00') for p in sorted(pilot.PILOT_IDS)],
        'model_types':[dict(common, model_type_id='TYPE', model_type_name_th='Synthetic type')],
    }


class PilotIntakeTests(unittest.TestCase):
    def setUp(self):
        scope = patch.object(pilot, 'PILOT_IDS', {'TEST-P01', 'TEST-P02'})
        scope.start()
        self.addCleanup(scope.stop)

    def test_exact_keys_do_not_approve_or_convert_area(self):
        data = sample()
        before = copy.deepcopy(data)
        result = pilot.review(data)
        self.assertEqual(data, before)
        self.assertEqual(result['flags'], [])
        self.assertFalse(result['hub_import_performed'])
        self.assertFalse(result['publication_authorized'])
        for row in result['model_mapping_candidates']:
            self.assertEqual(row['match_status'], 'SUGGESTED')
            self.assertIsNone(row['verified_by'])
            self.assertIsNone(row['verified_at'])
            self.assertIsNone(row['usable_area_sqm'])
            self.assertIsNone(row['model_area_unit'])
            self.assertEqual(row['model_area_raw'], '24.00')
        self.assertEqual(data['brands'][0]['brand_id'], '000003')

    def test_duplicate_keys_and_scope_are_rejected(self):
        for mutation in ('duplicate','wrong_project','missing_project','numeric_flag'):
            with self.subTest(mutation=mutation):
                data = sample()
                if mutation == 'duplicate':
                    data['models'].append(copy.deepcopy(data['models'][0]))
                elif mutation == 'wrong_project':
                    data['models'][0]['project_id'] = 'OUTSIDE'
                elif mutation == 'missing_project':
                    data['projects'].pop()
                else:
                    data['models'][0]['is_deleted'] = 0
                with self.assertRaises(ValueError):
                    pilot.identity_checks(data)

    def test_unknown_deleted_and_unresolved_data_are_retained(self):
        data = sample()
        data['models'][0].update(is_deleted=None, model_type_id='MISSING', model_area=None)
        data['models'][1]['is_deleted'] = True
        data['projects'][0]['company_id'] = 'MISSING'
        result = pilot.review(data)
        codes = {f['code'] for f in result['flags']}
        self.assertTrue({'source_status_unknown','source_deleted','source_reference_missing','model_type_unresolved','model_area_not_positive'}.issubset(codes))
        self.assertEqual(len(result['model_mapping_candidates']), 2)
        self.assertIsNone(data['models'][0]['is_deleted'])

    def test_fingerprints_preserve_raw_distinctions(self):
        self.assertEqual(pilot.scalar(Decimal('24.00')), '24.00')
        self.assertNotEqual(pilot.fingerprint({'deleted':None}), pilot.fingerprint({'deleted':False}))
        self.assertNotEqual(pilot.fingerprint({'id':'000003'}), pilot.fingerprint({'id':'3'}))
        self.assertEqual(pilot.fingerprint({'b':1,'a':2}), pilot.fingerprint({'a':2,'b':1}))


if __name__ == '__main__':
    unittest.main()
