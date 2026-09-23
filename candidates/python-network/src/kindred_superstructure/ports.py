"""Protected Port Zero and bounded external Strata Data Ports."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from abc import ABC, abstractmethod
from dataclasses import dataclass

from .models import GovernedEnvelope, Receipt, ReceiptState, TruthClass
from .persistence import SQLiteState
from .security import Signer, digest
from .transport import CircuitBreaker, Transport, TransportUnavailable


def _time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class ExternalPort:
    """Production external boundary backed by a durable provider adapter."""

    production_ready = True

    def __init__(self, port_id: str, signer: Signer, adapter: "ProviderAdapter",
                 state: SQLiteState) -> None:
        if not adapter.ready().ready:
            raise RuntimeError(f"provider adapter blocked: {adapter.ready().blocker}")
        self.port_id, self.signer, self.adapter = port_id, signer, adapter
        self.state = state

    def receive(self, envelope: GovernedEnvelope) -> Receipt:
        if envelope.origin_port != "strata-data-port-zero":
            return self._receipt(envelope, ReceiptState.REJECTED, "Port Zero authentication required")
        if self.port_id not in envelope.destination_ports:
            return self._receipt(envelope, ReceiptState.REJECTED, "destination policy rejected")
        if not envelope.signatures or not self.signer.verify(envelope.unsigned_dict(), envelope.signatures[0]):
            return self._receipt(envelope, ReceiptState.QUARANTINED, "invalid signature")
        if digest(envelope.payload) != envelope.payload_hash:
            return self._receipt(envelope, ReceiptState.QUARANTINED, "payload integrity failure")
        fresh = self.state.claim_nonce(self.port_id, envelope.nonce)
        if not fresh:
            return self._receipt(envelope, ReceiptState.QUARANTINED, "replay detected")
        result = self.adapter.execute(dict(envelope.payload), envelope.idempotency_key)
        # Provider acceptance is never promoted to verified internal truth here.
        return self._receipt(envelope, result.state, result.reference_hash, TruthClass.PROVIDER_REPORTED)

    def _receipt(self, envelope: GovernedEnvelope, state: ReceiptState, detail: str,
                 truth: TruthClass | None = None) -> Receipt:
        body = {"message_id": envelope.message_id, "port_id": self.port_id,
                "state": state.value, "detail": detail}
        return Receipt(envelope.message_id, self.port_id, state, detail,
                       truth or envelope.truth_class, digest(body), self.signer.sign(body))


@dataclass(frozen=True)
class AdapterReadiness:
    ready: bool
    adapter_id: str
    evidence_reference: str | None = None
    blocker: str | None = None


@dataclass(frozen=True)
class ProviderResult:
    state: ReceiptState
    reference_hash: str


class ProviderAdapter(ABC):
    """Credential-bound provider interface; implementations own reconciliation."""

    @abstractmethod
    def ready(self) -> AdapterReadiness: ...

    @abstractmethod
    def execute(self, payload: dict, idempotency_key: str) -> ProviderResult: ...


class PortZero:
    """Internal anchor. Authenticates callers and is the only path to external ports."""

    def __init__(self, signer: Signer, transport: Transport,
                 identities: set[str], max_attempts: int = 2, state: SQLiteState | None = None) -> None:
        self.signer, self.transport, self.identities = signer, transport, identities
        self.max_attempts = max_attempts
        self.state = state
        self._idempotency: dict[str, list[Receipt]] = {}
        self.evidence: list[str] = []
        self.breakers: dict[str, CircuitBreaker] = {}

    def dispatch(self, envelope: GovernedEnvelope) -> list[Receipt]:
        if envelope.source_identity not in self.identities:
            raise PermissionError("internal identity authentication failed")
        if envelope.origin_port != "strata-data-port-zero":
            raise PermissionError("external bypass of Port Zero denied")
        if _time(envelope.expires_at) <= datetime.now(timezone.utc):
            raise TimeoutError("envelope expired")
        prior = self.state.get_receipts(envelope.idempotency_key) if self.state else self._idempotency.get(envelope.idempotency_key)
        if prior is not None:
            return prior
        signed = replace(envelope, payload_hash=digest(envelope.payload), signatures=())
        signed = replace(signed, signatures=(self.signer.sign(signed.unsigned_dict()),))
        last_error: Exception | None = None
        for _attempt in range(1, self.max_attempts + 1):
            try:
                receipts = self.transport.dispatch(signed)
                for destination in signed.destination_ports:
                    self.breakers.setdefault(destination, CircuitBreaker()).success()
                if self.state:
                    self.state.record_outcome(signed.idempotency_key, receipts)
                    self.evidence = self.state.evidence_hashes()
                else:
                    self._idempotency[signed.idempotency_key] = receipts
                    self.evidence.extend(receipt.evidence_hash for receipt in receipts)
                return receipts
            except TransportUnavailable as exc:
                last_error = exc
                for destination in signed.destination_ports:
                    self.breakers.setdefault(destination, CircuitBreaker()).failure()
        raise TransportUnavailable(f"bounded retries exhausted: {last_error}")
