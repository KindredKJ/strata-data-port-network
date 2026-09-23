import json, re, unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
class ProviderB2BPolicyTests(unittest.TestCase):
    def test_g3t_is_only_communications_provider_of_record(self):
        providers=json.loads((ROOT/"registry/providers.yaml").read_text())
        records=[p for p in providers["providers"] if p.get("provider_of_record")]
        self.assertEqual(records,[{"id":"g3t-connected","name":"G3T Connected","classification":"kindred_provider","domain":"communications","authority":"communications_service_delivery","provider_of_record":True,"requires_reconciliation":True}])
        self.assertFalse(providers["rail_defaults"]["provider_of_record"])
        self.assertIn("carrier",providers["taxonomy"]); self.assertIn("transport_rail",providers["taxonomy"])
    def test_brainstem_intouch_remains_separate(self):
        authority=json.loads((ROOT/"architecture/authority-map.yaml").read_text())["authorities"]
        self.assertIn("provider-of-record",authority["G3T Connected"])
        self.assertNotIn("provider-of-record",authority["Brainstem InTouch"])
    def test_kindred_one_is_b2b_enabler_and_tenant_first(self):
        model=json.loads((ROOT/"architecture/kindred-one-b2b.yaml").read_text())
        self.assertEqual(model["classification"],"B2B enablement and infrastructure platform")
        self.assertFalse(model["consumer_first"]); self.assertEqual(model["principal_context"],"organization-or-authorized-partner")
    def test_no_consumer_first_production_positioning(self):
        text="\n".join((ROOT/p).read_text().lower() for p in ["README.md","config/production-policy.json","registry/components.yaml","architecture/kindred-one-b2b.yaml"])
        self.assertNotRegex(text,r"direct[- ]to[- ]consumer|consumer[_ -]first[\"']?\s*:\s*true|retail end-user platform")
    def test_communications_contract_has_separate_dimensions(self):
        schema=json.loads((ROOT/"contracts/v1/CommunicationLifecycleEvent.schema.json").read_text())
        required=set(schema["properties"]["new_state"]["required"])
        self.assertEqual(required,{"request_status","g3t_provider_status","transport_rail_status","recipient_status","reconciliation_status","evidence_status","truth_class"})
