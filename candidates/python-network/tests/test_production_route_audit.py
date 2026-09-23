import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("audit_routes", ROOT / "scripts/audit_production_routes.py")
MODULE = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(MODULE)

class ProductionRouteAuditTests(unittest.TestCase):
    def test_product_tree_has_no_fixture_effect_routes(self):
        self.assertEqual(MODULE.audit(), [])

    def test_fixture_handlers_are_confined_to_tests(self):
        fixture = ROOT / "tests/fixtures/runtime.py"
        self.assertTrue(fixture.is_file())
        self.assertFalse((ROOT / "src/kindred_superstructure/domains.py").exists())
