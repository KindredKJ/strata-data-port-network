"""Immutable transport records and canonical serialization."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Mapping


class RouteMode(str, Enum):
    DIRECT = "direct"
    SPLIT = "split"
    MULTICAST = "multicast"


class ReceiptState(str, Enum):
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    DELIVERED = "delivered"
    ACKNOWLEDGED = "acknowledged"
    ESCALATED = "escalated"
    FAILED = "failed"
    RETRYING = "retrying"
    RECOVERED = "recovered"
    EXPIRED = "expired"
    QUARANTINED = "quarantined"


class TruthClass(str, Enum):
    SIMULATED = "simulated"
    ESTIMATED = "estimated"
    OBSERVED = "observed"
    PROVIDER_REPORTED = "provider-reported"
    VERIFIED = "verified"


class Classification(str, Enum):
    PUBLIC = "public"
    INTERNAL = "internal"
    PROTECTED = "protected"


@dataclass(frozen=True)
class Signature:
    key_id: str
    algorithm: str
    value: str
    assurance: str = "development-only"


@dataclass(frozen=True)
class GovernedEnvelope:
    schema_version: str
    message_id: str
    correlation_id: str
    causation_id: str
    trace_id: str
    source_identity: str
    source_component: str
    source_authority: str
    origin_port: str
    destination_ports: tuple[str, ...]
    route_mode: RouteMode
    payload_type: str
    payload: Mapping[str, Any]
    payload_hash: str
    truth_class: TruthClass
    classification: Classification
    disclosure_policy: tuple[str, ...]
    world_context: Mapping[str, Any]
    policy_references: tuple[str, ...]
    issued_at: str
    expires_at: str
    nonce: str
    idempotency_key: str
    sequence: int
    signatures: tuple[Signature, ...] = field(default_factory=tuple)

    def unsigned_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["route_mode"] = self.route_mode.value
        value["truth_class"] = self.truth_class.value
        value["classification"] = self.classification.value
        value.pop("signatures")
        return value


@dataclass(frozen=True)
class Receipt:
    message_id: str
    port_id: str
    state: ReceiptState
    detail: str
    truth_class: TruthClass
    evidence_hash: str
    signature: Signature
    attempt: int = 1
