"""Production transport contract with bounded resilience controls."""

from __future__ import annotations

from dataclasses import dataclass
from abc import ABC, abstractmethod

from .models import GovernedEnvelope, Receipt, RouteMode


class TransportUnavailable(RuntimeError): pass


@dataclass
class CircuitBreaker:
    threshold: int = 2
    failures: int = 0
    open: bool = False

    def success(self) -> None:
        self.failures = 0
        self.open = False

    def failure(self) -> None:
        self.failures += 1
        self.open = self.failures >= self.threshold


class Transport(ABC):
    """Authenticated durable transport adapter contract."""

    production_ready: bool = False

    @abstractmethod
    def dispatch(self, envelope: GovernedEnvelope) -> list[Receipt]: ...
