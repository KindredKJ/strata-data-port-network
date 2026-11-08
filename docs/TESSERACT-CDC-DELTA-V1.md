# Tesseract CDC/1 — content-defined delta reconstruction

**Status:** additive candidate, not a replacement for canonical STRATA-TESSERACT-1, ZPS SW03, SW02, or native session policy.

## Why this is a meaningful SDPN networking advantage

Traditional full-file updates resend all file bytes. Fixed-size block deduplication can resend most of a file after bytes are inserted near the beginning because every subsequent block boundary shifts. Tesseract CDC/1 uses deterministic *content-defined* 8–64 KiB chunks (16 KiB target; rolling 48-byte buzhash window) so chunk boundaries are stable relative to content rather than absolute offsets.

A Port A preparing an updated object supplies a cryptographically hashed CDC manifest; Port B can reuse its own SHA-256-verified chunks, explicitly request only missing encoded information, and perform **complete SHA-256 verification before publishing**. Repeated identical blocks are materialized from verified local memory without requesting them twice.

**This is local, exact reconstruction at Port B.** The algorithm explicitly accounts for new bytes. It does not claim that a hash can recreate missing data, that cryptographic coordination substitutes for physical delivery, or that the code has created global physically route-free connectivity.

## Public API

`src/tesseract-cdc-delta.mjs`:

- `prepareCdcState(bytes)`: Versioned content-defined digest manifest plus separate locally available chunks; binary ceiling 4 MiB.
- `verifyCdcManifest(manifest)`: Strict schema, size, hash, chunk, profile and bounds validation.
- `planCdcDelta(manifest, hasLocalChunk)`: Inventory-based estimate of uniquely missing content; **not proof of possession**.
- `reconstructCdcDelta({manifest, readLocalChunk, receiveMissingChunk, adapter, onReconstructed})`: Verify local chunk bytes, use an explicitly supplied missing-chunk source where necessary, rebuild in original order, rehash the entire result and publish only if exact.

This module is designed to plug into the existing Native Port/Tesseract/ZPS runtime through callbacks. It **does not create a network listener** or trust arbitrary callbacks as proof of a remote link. The driver must be independently bound to an authorized, identity-verified session. A source of missing bytes is mandatory for novel information.

STRICT mode rejects descriptors using IP or conventional routing. The descriptor check is a software policy check, **not a physical audit**. No protocol should advertise worldwide native route-free capability before audited, geographically separated physical receipts exist.

## CDC/1 encrypted native Port request/response

`src/tesseract-cdc-native-session.mjs` now integrates with the existing
signed Ed25519/X25519/AES-256-GCM `native-session.mjs` implementation:

- `makeCdcSourceResponder({manifest,sourceChunks,session,signedSessionOffer,originRecord})`:
  Port A authenticates every inbound native encrypted request, checks that
  the requested content hash/length belongs to the signed state manifest,
  verifies its own stored source chunk and seals a response frame.
- `reconstructCdcOverNativeSession({manifest,session,signedSessionOffer,originRecord,
  readLocalChunk,exchangeEncryptedFrame})`: Port B checks the signed native
  session origin/target and exact state SHA-256, reuses its own local chunks
  and requests missing hashes using AEAD-sealed frames. The destination
  verifies every response before reconstruction and signs/publishes nothing
  until full SHA-256 matches.

The native session's own consent/expiry/replay/order checks remain active.
The source responder does not accept arbitrary file paths or execute remote
commands. Its request is 37 binary plaintext bytes (inside AES-GCM); each
response has a 33-byte chunk identifier header (inside AES-GCM) followed by
only the required missing chunk. Actual carrier delivery is injected via
`exchangeEncryptedFrame`; in unit tests it is explicitly **in-process**.
The code measures ciphertext frame bytes at the encryption boundary but
does not count external framing, radio/network overhead or global reachability.
STRICT mode rejects existing TCP/IP adapters in both participants.

The session offer, acceptance and encrypted frames must be delivered on a
qualified underlying adapter, whose physical operation must be audited
before claiming a non-routed physical connection. These APIs do **not**
create such an adapter or automatically turn a Port globally online.

## Baselines and metric scope

`npm run cdc:benchmark` runs the same deterministic 2 MiB binary payload with a 173-byte insertion near the start against:

1. **Full-file**: total updated payload bytes.
2. **Fixed-size 64 KiB**: unique SHA-256 chunks absent from the original object's 64 KiB-block set.
3. **CDC/1**: unique SHA-256 content-defined chunks absent from Port B's pre-existing original set.

It reports exact result SHA-256, logical new content bytes, logical savings percentage, preparation/reconstruction wall time, and explicit **false** statuses for physical no-routing proof, global availability, actual wire bytes and authenticated control overhead.

A *unit-test or in-process callback benchmark does not measure Internet goodput*. Additional design alternatives to compare under matched conditions: rsync delta, content-defined chunking from established systems, QUIC/WebTransport and traditional file transfer.

## Security and infrastructure gates

- Preserve Port 0 as the only founder authority; regular/admin permissions remain local and distinct.
- Bind future CDC/1 offers to the signed PRESENCE/1 outcome and NativeSessionPolicy; do not permit unsanctioned network acquisition.
- Sign and bind manifests to source/destination Port identities, session scope, quotas and expiry.
- Add a durable destination ZPS store with encrypted-at-rest verified CAS, crash-safe writes, retention and signed materialization receipts.
- Make missing-chunk fetches use a qualified **physical** native adapter and independently record the declared hardware dependency, actual bytes on wire, transport/authentication overhead, p50/p95/p99, CPU, RSS, energy and tamper/replay tests.
- Recheck inventory on every materialization: false-positive availability must never be accepted as proof.
- Expand beyond 4 MiB only after streaming, memory-bound reconstruction, disk persistence, quotas and recovery tests.
- Publish real geographical A→B measurements and compare against the same physical carrier and matching test hardware before declaring superiority.

## Commands

```bash
npm run cdc:test
npm run cdc:benchmark
npm test
```

These are executable tests of real binary transformation and exact byte counts—not a remote-delivery proof. Existing production and routing infrastructure remain untouched.
