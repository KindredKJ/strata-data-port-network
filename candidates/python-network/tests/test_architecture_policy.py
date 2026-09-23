"""Architecture invariants over the JSON-compatible canonical YAML registries."""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_yaml(relative_path: str):
    """Load canonical files without a third-party YAML runtime.

    JSON is a strict subset of YAML 1.2, so these documents remain valid YAML while
    architecture-policy validation stays reproducible with Python's standard library.
    """
    with (ROOT / relative_path).open(encoding="utf-8") as stream:
        return json.load(stream)


class ArchitecturePolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sequence = load_yaml("architecture/canonical-sequence.yaml")
        cls.authorities = load_yaml("architecture/authority-map.yaml")
        cls.boundary = load_yaml("architecture/protected-boundary.yaml")
        cls.strata = load_yaml("architecture/strata-topology.yaml")
        cls.ports = load_yaml("architecture/port-topology.yaml")
        cls.components = load_yaml("registry/components.yaml")
        cls.providers = load_yaml("registry/providers.yaml")

    def test_canonical_sequence_is_exact(self):
        self.assertEqual(
            self.sequence["sequence"],
            ["Protocol", "Tesseract", "Unified Quad Runtime", "Modular Core"],
        )

    def test_runtime_and_strata_axes_are_distinct(self):
        self.assertEqual(self.sequence["axis"]["Unified Quad Runtime"], "horizontal-x")
        self.assertEqual(self.sequence["axis"]["StrataFortress"], "vertical-y")

    def test_port_zero_is_inside_protected_environment(self):
        self.assertIn("Strata Data Port Zero", self.boundary["inside"])
        self.assertNotIn("Strata Data Port Zero", self.boundary["outside"])
        self.assertEqual(self.boundary["port_zero"]["placement"], "inside")
        zero = next(port for port in self.ports["ports"] if port["id"] == "zero")
        self.assertEqual(zero["placement"], "inside-protected-boundary")
        self.assertEqual(zero["authority"], "Unified Quad Runtime")

    def test_brainstem_is_protected_and_never_a_stratum(self):
        self.assertIn("BRAINSTEM", self.boundary["inside"])
        self.assertIn("BRAINSTEM", self.strata["not_strata"])
        brainstem = next(item for item in self.components["components"] if item["id"] == "brainstem")
        self.assertEqual(brainstem["boundary"], "protected")
        self.assertFalse(brainstem["stratum"])

    def test_kindred_cloud_is_a_quadrant_not_the_runtime(self):
        cloud = next(item for item in self.components["components"] if item["id"] == "kindred-cloud")
        self.assertEqual(cloud["classification"], "quadrant")
        self.assertFalse(cloud["is_runtime"])
        self.assertNotEqual(cloud["authority"], "Unified Quad Runtime")

    def test_every_external_port_routes_only_via_zero(self):
        external = [port for port in self.ports["ports"] if port["kind"] == "external"]
        self.assertGreater(len(external), 0)
        for port in external:
            with self.subTest(port=port["id"]):
                self.assertEqual(port["placement"], "outside-protected-boundary")
                self.assertEqual(port["route_via"], "zero")
                self.assertEqual(port["may_receive_from"], ["zero"])

    def test_providers_cannot_be_internal_authorities(self):
        self.assertIn("transport-rails", self.authorities["non_authorities"])
        self.assertIn("carriers", self.authorities["non_authorities"])
        self.assertFalse(self.providers["defaults"]["internal_authority"])
        for provider in self.providers["providers"]:
            with self.subTest(provider=provider.get("id", "unnamed")):
                self.assertFalse(provider.get("internal_authority", False))

    def test_watt_block_is_record_only(self):
        watt = next(item for item in self.components["components"] if item["id"] == "watt-block")
        self.assertEqual(watt["classification"], "record-only")
        allowed = set(self.authorities["authorities"]["WATT-BLOCK"])
        prohibited = set(self.authorities["watt_block_prohibited"])
        self.assertEqual(allowed, {"record", "hash", "timestamp", "link", "verify"})
        self.assertTrue(allowed.isdisjoint(prohibited))

    def test_all_canonical_yaml_is_json_compatible_and_versioned(self):
        # These control documents deliberately use JSON's YAML 1.2 subset so
        # trust-boundary validation never depends on an optional parser. Other
        # operational registry reports may use native YAML and are validated by
        # their own inventory tooling.
        documents = sorted((ROOT / "architecture").glob("*.yaml")) + [
            ROOT / "registry" / name
            for name in ("capabilities.yaml", "components.yaml", "contracts.yaml",
                         "environments.yaml", "ports.yaml", "providers.yaml",
                         "repositories.yaml", "strata.yaml")
        ]
        self.assertGreaterEqual(len(documents), 15)
        for document in documents:
            with self.subTest(document=document.relative_to(ROOT)):
                with document.open(encoding="utf-8") as stream:
                    payload = json.load(stream)
                self.assertRegex(payload["schema_version"], r"^\d+\.\d+\.\d+$")


if __name__ == "__main__":
    unittest.main()
