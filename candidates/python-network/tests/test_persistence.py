import tempfile
import unittest
from pathlib import Path

from kindred_superstructure import KindredRuntime
from kindred_superstructure.persistence import PersistenceUnavailable, SQLiteState
from tests.fixtures.runtime import RuntimeFixture


class DurableStateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary.name) / "state.sqlite3"
        self.state = SQLiteState(self.path)

    def tearDown(self):
        self.state.close()
        self.temporary.cleanup()

    def test_replay_claim_survives_reopen(self):
        self.assertTrue(self.state.claim_nonce("economy", "nonce-1"))
        self.state.close()
        self.state = SQLiteState(self.path)
        self.assertFalse(self.state.claim_nonce("economy", "nonce-1"))

    def test_outcome_and_evidence_are_atomic_and_durable(self):
        runtime = RuntimeFixture()
        receipt = runtime.execute({}, ("watt",))[0]
        self.state.record_outcome("operation-1", [receipt])
        self.assertEqual(self.state.get_receipts("operation-1"), [receipt])
        self.assertEqual(self.state.evidence_hashes(), [receipt.evidence_hash])
        with self.assertRaises(Exception):
            self.state.record_outcome("operation-1", [receipt])
        self.assertEqual(len(self.state.evidence_hashes()), 1)

    def test_double_entry_and_budget_constraints(self):
        with self.state.transaction() as db:
            db.execute("INSERT INTO identities(identity_id,authority) VALUES ('owner','kindred')")
            db.execute("INSERT INTO accounts(account_id,currency,owner_identity) VALUES ('cash','USD','owner')")
            db.execute("INSERT INTO accounts(account_id,currency,owner_identity) VALUES ('payable','USD','owner')")
            db.execute("INSERT INTO budgets(budget_id,account_id,limit_minor) VALUES ('b1','cash',1000)")
        self.state.post_journal("j1", [("cash", -250), ("payable", 250)])
        with self.assertRaises(ValueError):
            self.state.post_journal("unbalanced", [("cash", -1)])
        self.state.reserve_budget("b1", "o1", 700)
        with self.assertRaises(ValueError):
            self.state.reserve_budget("b1", "o2", 301)

    def test_agent_conformance_required_for_contract(self):
        manifest = {"permitted_actions": ["code"], "permitted_strata": ["economy"],
                    "financial_policy": {"maximum_minor": 100}, "revocation_state": "active"}
        self.state.admit_agent("requester", "org", "cap-r", manifest)
        with self.state.transaction() as db:
            db.execute("INSERT INTO accounts(account_id,currency,owner_identity) VALUES ('agent-cash','USD','requester')")
            db.execute("INSERT INTO budgets(budget_id,account_id,limit_minor) VALUES ('agent-budget','agent-cash',100)")
        self.state.reserve_budget("agent-budget", "agent-obligation", 50)
        with self.assertRaises(PermissionError):
            self.state.create_a2a_contract("contract", "requester", "executor", "agent-obligation", "hash")
        self.state.admit_agent("executor", "org", "cap-e", manifest)
        self.state.create_a2a_contract("contract", "requester", "executor", "agent-obligation", "hash")

    def test_backup_restore_and_integrity(self):
        self.assertTrue(self.state.claim_nonce("watt", "durable"))
        backup = self.state.backup(Path(self.temporary.name) / "backup.sqlite3")
        restored = SQLiteState.restore(backup, Path(self.temporary.name) / "restored.sqlite3")
        try:
            self.assertFalse(restored.claim_nonce("watt", "durable"))
        finally:
            restored.close()

    def test_in_memory_and_unconfigured_production_fail_closed(self):
        with self.assertRaises(PersistenceUnavailable):
            SQLiteState(":memory:")
        with self.assertRaises(RuntimeError):
            KindredRuntime()


if __name__ == "__main__":
    unittest.main()
