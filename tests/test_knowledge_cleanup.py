"""Pure cleanup rules; no DB or network and no real files mutated."""
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('cleanup',Path(__file__).parents[1]/'scripts/clean-knowledge.py')
cleanup=importlib.util.module_from_spec(spec);spec.loader.exec_module(cleanup)
class CleanupTests(unittest.TestCase):
    def test_size_alone_never_drops_a_small_plan(self):
        self.assertIsNone(cleanup.chrome_reason(['https://sena.co.th/unit-plan.png'],[64,64],'image/png'))
        self.assertEqual(cleanup.chrome_reason(['https://sena.co.th/arrow.png'],[64,64],'image/png'),'tiny_ui_icon_both_edges_at_most_96px')
    def test_theme_font_and_tracking_evidence_is_excluded_with_reason(self):
        for url,dim in [('https://sena.co.th/wp-content/plugins/foo/a.png',[900,900]),('https://sena.co.th/pixel.png',[1,1]),('https://sena.co.th/logo-white.png',[600,200])]:self.assertIsNotNone(cleanup.chrome_reason([url],dim,'image/png'))
    def test_variant_family_preserves_host_and_crop_names(self):
        self.assertEqual(cleanup.family('https://sena.co.th/a-300x200.webp'),cleanup.family('https://sena.co.th/a.webp'))
        self.assertNotEqual(cleanup.family('https://sena.co.th/a-cut.webp'),cleanup.family('https://sena.co.th/a.webp'))
        self.assertNotEqual(cleanup.family('https://brands.sena.co.th/a.webp'),cleanup.family('https://sena.co.th/a.webp'))
if __name__=='__main__':unittest.main()
