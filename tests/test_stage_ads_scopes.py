"""A/B intake preserves exact source IDs and quarantines ambiguous evidence."""
import copy
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('stage_ads_scopes', Path(__file__).parents[1] / 'scripts/stage-ads-scopes.py')
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


class AdsScopesTest(unittest.TestCase):
    def setUp(self):
        self.groups = [{'project_group_id': 'C-DEMO-TEST1', 'project_id_set': ['00001', '00002'], 'member_count': 2,
                        'project_name_th': 'โครงการทดสอบ', 'project_name_en': 'Demo Project',
                        'source_snapshot_at': '2026-09-29T12:00:00+07:00'}]
        self.members = [{'project_group_id': 'C-DEMO-TEST1', 'project_id': phase,
                         'project_name': 'เฟสทดสอบ', 'project_name_eng': f'PHASE {phase}',
                         'membership_status': 'CURRENT_REFERENCE', 'valid_from': None, 'valid_to': None,
                         'reference_observed_at': '2026-09-29T12:00:00+07:00'} for phase in ['00001', '00002']]

    def test_valid_pair_replay_and_exact_ids(self):
        first = stage.validate(self.groups, self.members)
        second = stage.validate(copy.deepcopy(self.groups), list(reversed(self.members)))
        self.assertEqual(first, second)
        scopes, issues, snapshot = first
        self.assertEqual(issues, [])
        self.assertEqual(len(scopes), 3)
        self.assertEqual(scopes[1]['members'][0]['member_id'], '00001')
        self.assertEqual(snapshot.isoformat(), '2026-09-29T12:00:00+07:00')
        self.assertNotIn('effective_from', scopes[1]['members'][0])

    def test_quarantine_unknown_parent_duplicates_and_mismatch(self):
        for mutate in [lambda: self.members.append(copy.deepcopy(self.members[0])),
                       lambda: self.members[0].update(project_group_id='C-DEMO-OTHER'),
                       lambda: self.groups[0].update(project_id_set=['00001', '00003']),
                       lambda: self.members[0].update(project_id=1),
                       lambda: self.members[0].update(valid_from='2026-01-01'),
                       lambda: self.groups[0].update(source_snapshot_at='2026-09-29T12:00:00'),
                       lambda: self.groups[0].update(project_name_en=None),
                       lambda: self.groups[0].update(project_name_th='\ufffd')]:
            self.setUp()
            mutate()
            with self.subTest(evidence=self.members):
                self.assertTrue(stage.validate(self.groups, self.members)[1])

    def test_non_ascii_phase_needs_exact_steward_alias(self):
        self.groups[0]['project_id_set'][0] = '000_01'
        self.members[0]['project_id'] = '000_01'
        self.assertTrue(stage.validate(self.groups, self.members)[1])
        scopes, issues, _ = stage.validate(self.groups, self.members, [
            {'project_group_id': 'C-DEMO-TEST1', 'project_id': '000_01', 'name_alias': 'P00001'}])
        self.assertEqual(issues, [])
        row = next(x for x in scopes if x['scope_code'].endswith('-P00001'))
        self.assertEqual(row['members'][0]['member_id'], '000_01')

    def test_colliding_alias_quarantines(self):
        aliases = [{'project_group_id': 'C-DEMO-TEST1', 'project_id': phase, 'name_alias': 'SAME'} for phase in ['00001', '00002']]
        self.assertTrue(stage.validate(self.groups, self.members, aliases)[1])


if __name__ == '__main__':
    unittest.main()
