# Kindred state-port integration

This adapter joins Kindred's recall-first state model to the currently proven SDPN transport
classes.

Priority order:

1. **REFERENCE** — if the destination can resolve the verified state, move only the locator and
   integrity identity.
2. **REDUCED_COPY** — for a local payload boundary, use the existing SW06-E Node worker ownership
   transfer candidate.
3. **PORTABLE_BUFFERED** — retain the conservative classification for other paths, but do not
   report execution until a real transport executor exists.

The adapter does not claim physical zero-copy or two-machine transport. SW06-E established reduced
explicit JavaScript payload copies across one local worker boundary, not hardware-level zero-copy.

## Canonical wire contract

The SDPN adapter does not reserialize a Python state object. The Kindred root supplies the exact
`kindred-canonical-json-v1` string (or equivalent bytes) plus its SHA-256 integrity hash. SDPN
verifies those exact bytes before any payload transfer.

This avoids cross-language JSON-number serialization differences from corrupting state identity.
The canonical Kindred state hash remains lineage identity; the explicit integrity hash verifies the
wire bytes being moved.

Reference mode does not instantiate the worker and moves no payload bytes.
