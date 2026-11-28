# SDPN interactive session routing

This layer gives SDPN a transport classification for Kindred's persistent interface sessions.

It is deliberately separate from SW06-F state-transfer proof semantics.

## Route classes

```text
state reference available
        -> REFERENCE

small frame + persistent streaming endpoint
        -> INTERACTIVE_BUFFERED

otherwise
        -> PORTABLE_BUFFERED
```

A reference frame carries the locator/state reference rather than inlining the referenced state.
A small text/tool/event/output frame can use the persistent interactive session lane. Larger or
non-streaming frames remain conservatively buffered.

The route planner returns `executed=false`; planning a route is not evidence that bytes crossed a
network.

## Ordering and backpressure

`SessionSequencer` enforces monotonically increasing sequence numbers per
`session_id + source_peer_id`, tracks unacknowledged frames, and rejects new work when the
configured in-flight window is full.

This is the transport-side complement to Kindred Root's durable session/frame ledger.

## Boundary

SDPN transports interface frames and state references. Kindred Root remains responsible for peer
identity, session membership, capability policy, cognition, recall, authority, and external-effect
gates.
