"""Fail-closed production composition root for the governed runtime."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from .models import Classification, GovernedEnvelope, RouteMode, TruthClass
from .ports import ExternalPort, PortZero
from .persistence import SQLiteState
from .security import DevelopmentHMACSigner, Signer, digest
from .transport import Transport


class KindredRuntime:
    def __init__(self, *, database_path: str | None = None,
                 signer: Signer | None = None,
                 transport: Transport | None = None, external_ports: dict[str, ExternalPort] | None = None,
                 identities: set[str] | None = None) -> None:
        if not database_path:
            raise RuntimeError("production startup requires durable persistence")
        if signer is None or isinstance(signer, DevelopmentHMACSigner):
            raise RuntimeError("production startup requires an authorized managed-key signer")
        if transport is None or not transport.production_ready:
            raise RuntimeError("production startup requires a durable authenticated transport adapter")
        if not external_ports:
            raise RuntimeError("production startup requires configured real external-port adapters")
        if any(not port.production_ready or port.state is None for port in external_ports.values()):
            raise RuntimeError("production external ports require durable ready provider adapters")
        if not identities:
            raise RuntimeError("production startup requires persisted authenticated identities")
        self.state = SQLiteState(database_path)
        self.signer = signer
        self.transport = transport
        self.ports = dict(external_ports)
        self.port_zero = PortZero(signer, transport, identities, state=self.state)

    def envelope(self, payload: dict, destinations: tuple[str, ...],
                 route_mode: RouteMode = RouteMode.DIRECT,
                 identity: str = "brainstem", ttl_seconds: int = 60,
                 idempotency_key: str | None = None,
                 truth_class: TruthClass | None = None) -> GovernedEnvelope:
        if truth_class is None:
            raise ValueError("production intent requires an explicit evidence-qualified truth class")
        now = datetime.now(timezone.utc)
        uid = str(uuid4())
        return GovernedEnvelope(
            "1.0.0", uid, uid, uid, uid, identity, "unified-quad-runtime",
            "protected-kindred-authority", "strata-data-port-zero", destinations,
            route_mode, "ExecutionIntent", payload, digest(payload),
            truth_class,
            Classification.INTERNAL, tuple(payload.get("disclose", ())),
            {"environment": "production"},
            ("protocol.default-deny.v1",), now.isoformat(),
            (now + timedelta(seconds=ttl_seconds)).isoformat(), str(uuid4()),
            idempotency_key or uid, 1,
        )

    def execute(self, *args, **kwargs):
        return self.port_zero.dispatch(self.envelope(*args, **kwargs))
