import dataclasses
import unittest

from kindred_superstructure import ReceiptState, RouteMode, TruthClass
from kindred_superstructure.transport import TransportUnavailable
from tests.fixtures.runtime import RuntimeFixture


class RuntimeScenarios(unittest.TestCase):
    def setUp(self):
        self.runtime = RuntimeFixture()

    def test_fixture_communications_receipt_is_not_product_delivery(self):
        receipt = self.runtime.execute({"recipient": "fixture", "message": "hello", "secret": "redacted"}, ("communications",))[0]
        self.assertEqual(receipt.state, ReceiptState.ACKNOWLEDGED)
        self.assertEqual(receipt.truth_class, TruthClass.SIMULATED)
        self.assertEqual(len(self.runtime.port_zero.evidence), 1)

    def test_fixture_economy_receipt_is_not_product_settlement(self):
        receipt = self.runtime.execute({"test_budget": 10, "test_cost": 4}, ("economy",))[0]
        self.assertEqual(receipt.state, ReceiptState.ACKNOWLEDGED)
        self.assertEqual(receipt.truth_class, TruthClass.SIMULATED)

    def test_fixture_watt_receipt_never_claims_real_effect(self):
        receipt = self.runtime.execute({"samples_watts": [10, 20]}, ("watt",))[0]
        self.assertEqual(receipt.truth_class, TruthClass.SIMULATED)
        self.assertEqual(receipt.state, ReceiptState.ACKNOWLEDGED)

    def test_idempotency_returns_same_receipt_without_new_evidence(self):
        envelope = self.runtime.envelope({}, ("watt",), idempotency_key="same")
        first = self.runtime.port_zero.dispatch(envelope)
        second = self.runtime.port_zero.dispatch(dataclasses.replace(envelope, nonce="other"))
        self.assertEqual(first, second)
        self.assertEqual(len(self.runtime.port_zero.evidence), 1)

    def test_external_port_replay_is_quarantined(self):
        envelope = self.runtime.envelope({}, ("watt",))
        signed = dataclasses.replace(envelope, signatures=(self.runtime.signer.sign(envelope.unsigned_dict()),))
        self.assertEqual(self.runtime.ports["watt"].receive(signed).state, ReceiptState.ACKNOWLEDGED)
        self.assertEqual(self.runtime.ports["watt"].receive(signed).state, ReceiptState.QUARANTINED)

    def test_invalid_signature_is_quarantined(self):
        envelope = self.runtime.envelope({}, ("watt",))
        other = RuntimeFixture(b"different-secret")
        signed = dataclasses.replace(envelope, signatures=(other.signer.sign(envelope.unsigned_dict()),))
        self.assertEqual(self.runtime.ports["watt"].receive(signed).state, ReceiptState.QUARANTINED)

    def test_expired_and_unauthenticated_fail_closed(self):
        with self.assertRaises(TimeoutError):
            self.runtime.execute({}, ("watt",), ttl_seconds=-1)
        with self.assertRaises(PermissionError):
            self.runtime.execute({}, ("watt",), identity="provider")

    def test_multicast_partial_failure_preserves_success_and_dead_letter(self):
        envelope = self.runtime.envelope({}, ("communications", "missing"), RouteMode.MULTICAST)
        receipts = self.runtime.port_zero.dispatch(envelope)
        self.assertEqual(len(receipts), 1)
        self.assertEqual(len(self.runtime.transport.dead_letters), 1)

    def test_split_failure_retries_then_opens_circuit(self):
        envelope = self.runtime.envelope({}, ("communications", "missing"), RouteMode.SPLIT)
        with self.assertRaises(TransportUnavailable):
            self.runtime.port_zero.dispatch(envelope)
        self.assertTrue(self.runtime.port_zero.breakers["missing"].open)
        self.assertEqual(len(self.runtime.transport.dead_letters), 2)

    def test_direct_requires_one_destination(self):
        with self.assertRaises(ValueError):
            self.runtime.execute({}, ("watt", "economy"))


if __name__ == "__main__":
    unittest.main()
