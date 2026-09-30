# Kindred state-port integration

This adapter joins Kindred's recall-first state model to the currently proven SDPN transport
classes.

Priority order:

1. **REFERENCE** — if the destination can resolve the verified state, move only the locator and
   integrity identity.
2. **REDUCED_COPY** — for a local payload boundary, use the existing SW06-E Node worker ownership
   transfer candidate.
3. **PORTABLE_BUFFERED** — retain the conservative fallback classification for other paths.

The adapter does not claim physical zero-copy or two-machine transport. SW06-E established reduced
explicit JavaScript payload copies across one local worker boundary, not hardware-level zero-copy.

The state hash is checked before any payload transfer. Reference mode does not instantiate the
worker and moves no payload bytes.
