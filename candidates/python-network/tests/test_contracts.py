import json
import unittest
from pathlib import Path
from kindred_superstructure import contracts

NAMES = ["NeedEnvelope", "OutcomeContract", "CapabilityManifest", "ClaimRecord",
         "CognitiveTransaction", "ExecutionIntent", "EvidenceReceipt", "OutcomeCapsule",
         "EvolutionProposal", "KJManifest", "WorldContext"]

class ContractTests(unittest.TestCase):
    def test_schema_spine_is_versioned_and_closed(self):
        for name in NAMES:
            data = json.loads((Path("contracts/v1") / f"{name}.schema.json").read_text())
            self.assertTrue(data["$schema"].endswith("2020-12/schema"))
            self.assertEqual(data["properties"]["schema_version"]["const"], "1.0.0")
            self.assertFalse(data["additionalProperties"])

    def test_generated_bindings_exist(self):
        self.assertTrue(all(hasattr(contracts, name) for name in NAMES))
