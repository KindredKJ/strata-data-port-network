"""Generated contract models. Do not edit manually."""
from dataclasses import dataclass, field
from typing import Any

@dataclass(frozen=True)
class NeedEnvelope:
    id: str
    issued_at: str
    data: dict[str, Any]
    truth_class: str
    schema_version: str = "1.0.0"
    evidence_references: tuple[str, ...] = field(default_factory=tuple)

@dataclass(frozen=True)
class OutcomeContract:
    id: str
    issued_at: str
    data: dict[str, Any]
    truth_class: str
    schema_version: str = "1.0.0"
    evidence_references: tuple[str, ...] = field(default_factory=tuple)

@dataclass(frozen=True)
class CapabilityManifest:
    id: str
    issued_at: str
    data: dict[str, Any]
    truth_class: str
    schema_version: str = "1.0.0"
    evidence_references: tuple[str, ...] = field(default_factory=tuple)

@dataclass(frozen=True)
class ClaimRecord:
    id: str
    issued_at: str
    data: dict[str, Any]
    truth_class: str
    schema_version: str = "1.0.0"
    evidence_references: tuple[str, ...] = field(default_factory=tuple)

@dataclass(frozen=True)
class CognitiveTransaction:
    id: str
    issued_at: str
    data: dict[str, Any]
    truth_class: str
    schema_version: str = "1.0.0"
    evidence_references: tuple[str, ...] = field(default_factory=tuple)

@dataclass(frozen=True)
class ExecutionIntent:
    id: str
    issued_at: str
    data: dict[str, Any]
    truth_class: str
    schema_version: str = "1.0.0"
    evidence_references: tuple[str, ...] = field(default_factory=tuple)

@dataclass(frozen=True)
class EvidenceReceipt:
    id: str
    issued_at: str
    data: dict[str, Any]
    truth_class: str
    schema_version: str = "1.0.0"
    evidence_references: tuple[str, ...] = field(default_factory=tuple)

@dataclass(frozen=True)
class OutcomeCapsule:
    id: str
    issued_at: str
    data: dict[str, Any]
    truth_class: str
    schema_version: str = "1.0.0"
    evidence_references: tuple[str, ...] = field(default_factory=tuple)

@dataclass(frozen=True)
class EvolutionProposal:
    id: str
    issued_at: str
    data: dict[str, Any]
    truth_class: str
    schema_version: str = "1.0.0"
    evidence_references: tuple[str, ...] = field(default_factory=tuple)

@dataclass(frozen=True)
class KJManifest:
    id: str
    issued_at: str
    data: dict[str, Any]
    truth_class: str
    schema_version: str = "1.0.0"
    evidence_references: tuple[str, ...] = field(default_factory=tuple)

@dataclass(frozen=True)
class WorldContext:
    id: str
    issued_at: str
    data: dict[str, Any]
    truth_class: str
    schema_version: str = "1.0.0"
    evidence_references: tuple[str, ...] = field(default_factory=tuple)
