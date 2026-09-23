"""Explicit negative/unit-test transport fixture with no product effects."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from kindred_superstructure.models import Classification, GovernedEnvelope, RouteMode, TruthClass
from dataclasses import replace
from kindred_superstructure.models import Receipt, ReceiptState
from kindred_superstructure.ports import PortZero
from kindred_superstructure.security import DevelopmentHMACSigner, digest
from tests.fixtures.transport import InMemoryTestTransport

def _fixture_result(payload: dict):
    return {"fixture_digest": digest(payload)}, TruthClass.SIMULATED

class TestExternalPort:
    def __init__(self, port_id, signer): self.port_id, self.signer, self.seen = port_id, signer, set()
    def receive(self, envelope):
        if envelope.origin_port != "strata-data-port-zero": return self._receipt(envelope, ReceiptState.REJECTED, "Port Zero required")
        if self.port_id not in envelope.destination_ports: return self._receipt(envelope, ReceiptState.REJECTED, "destination rejected")
        if not envelope.signatures or not self.signer.verify(envelope.unsigned_dict(), envelope.signatures[0]): return self._receipt(envelope, ReceiptState.QUARANTINED, "invalid signature")
        if envelope.nonce in self.seen: return self._receipt(envelope, ReceiptState.QUARANTINED, "replay detected")
        self.seen.add(envelope.nonce); result, truth = _fixture_result(dict(envelope.payload))
        return self._receipt(envelope, ReceiptState.ACKNOWLEDGED, digest(result), truth)
    def _receipt(self, envelope, state, detail, truth=None):
        body = {"message_id": envelope.message_id, "port_id": self.port_id, "state": state.value, "detail": detail}
        return Receipt(envelope.message_id, self.port_id, state, detail, truth or envelope.truth_class, digest(body), self.signer.sign(body))

class RuntimeFixture:
    def __init__(self, secret: bytes = b"unit-test-only-secret"):
        self.signer = DevelopmentHMACSigner(secret)
        self.transport = InMemoryTestTransport()
        self.ports = {name: TestExternalPort(name, self.signer)
                      for name in ("communications", "economy", "watt")}
        for name, port in self.ports.items(): self.transport.register(name, port.receive)
        self.port_zero = PortZero(self.signer, self.transport, {"brainstem"})

    def envelope(self, payload, destinations, route_mode=RouteMode.DIRECT,
                 identity="brainstem", ttl_seconds=60, idempotency_key=None):
        now, uid = datetime.now(timezone.utc), str(uuid4())
        return GovernedEnvelope(
            "1.0.0", uid, uid, uid, uid, identity, "test-fixture",
            "test-fixture-authority", "strata-data-port-zero", destinations,
            route_mode, "FixtureIntent", payload, digest(payload), TruthClass.SIMULATED,
            Classification.INTERNAL, (), {"environment": "unit-test"},
            ("test.fixture-only",), now.isoformat(),
            (now + timedelta(seconds=ttl_seconds)).isoformat(), str(uuid4()),
            idempotency_key or uid, 1)

    def execute(self, *args, **kwargs):
        return self.port_zero.dispatch(self.envelope(*args, **kwargs))
