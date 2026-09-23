import json
import tempfile
import unittest
from pathlib import Path

from scripts.validate_production_config import validate_file


ROOT = Path(__file__).resolve().parents[1]


class ProductionPolicyTests(unittest.TestCase):
    def test_canonical_production_policy_passes(self):
        self.assertEqual(validate_file(ROOT / "config/production-policy.json"), [])

    def test_prohibited_adapter_fails(self):
        policy = json.loads((ROOT / "config/production-policy.json").read_text())
        policy["persistence"]["adapter"] = "in-memory"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "production.json"
            path.write_text(json.dumps(policy), encoding="utf-8")
            self.assertTrue(any("prohibited" in item for item in validate_file(path)))

    def test_fail_open_and_development_signatures_fail(self):
        policy = json.loads((ROOT / "config/production-policy.json").read_text())
        policy["fail_closed"] = False
        policy["development_signatures_allowed"] = True
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "production.json"
            path.write_text(json.dumps(policy), encoding="utf-8")
            findings = validate_file(path)
        self.assertTrue(any("fail_closed" in item for item in findings))
        self.assertTrue(any("development_signatures_allowed" in item for item in findings))

    def test_authority_maps_deny_unsafe_assumptions_and_routes(self):
        identity = json.loads((ROOT / "architecture/identity-authority-map.yaml").read_text())
        network = json.loads((ROOT / "architecture/network-authority-map.yaml").read_text())
        self.assertFalse(identity["development_signatures_are_production_identity_proof"])
        self.assertEqual(identity["identity_systems"]["IAMI"]["authority"], "unresolved")
        denied = {(item["source"], item["destination"]) for item in network["denied_routes"]}
        self.assertIn(("external-system", "BRAINSTEM"), denied)
        self.assertFalse(network["provider_is_internal_authority"])


if __name__ == "__main__":
    unittest.main()
