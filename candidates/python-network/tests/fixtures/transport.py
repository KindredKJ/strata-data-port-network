from collections.abc import Callable
from kindred_superstructure.models import GovernedEnvelope, Receipt, RouteMode
from kindred_superstructure.transport import Transport, TransportUnavailable

class InMemoryTestTransport(Transport):
    production_ready = False
    def __init__(self):
        self._handlers: dict[str, Callable[[GovernedEnvelope], Receipt]] = {}
        self._available: dict[str, bool] = {}
        self.dead_letters = []
    def register(self, port_id, handler): self._handlers[port_id] = handler; self._available[port_id] = True
    def set_available(self, port_id, available): self._available[port_id] = available
    def dispatch(self, envelope):
        destinations = envelope.destination_ports
        if envelope.route_mode is RouteMode.DIRECT and len(destinations) != 1: raise ValueError("direct routing requires exactly one destination")
        if envelope.route_mode is RouteMode.SPLIT and len(destinations) < 2: raise ValueError("split routing requires at least two destinations")
        receipts, failures = [], []
        for destination in destinations:
            if destination not in self._handlers or not self._available.get(destination, False): failures.append(destination)
            else: receipts.append(self._handlers[destination](envelope))
        if failures:
            self.dead_letters.append((envelope, ",".join(failures)))
            if envelope.route_mode is not RouteMode.MULTICAST or not receipts:
                raise TransportUnavailable("unavailable destinations: " + ", ".join(failures))
        return receipts
