# ZPS/CAS-v1 — Encrypted, Port-Sovereign Persistent Reconstruction

**Classification:** implemented candidate layered onto PR #54 CDC/1, PR #53 PRESENCE/1 and PR #52 founder-only Port 0. This is a new persistent content-store adapter, not a replacement or verified merge of the preserved STRATA-TESSERACT-1 or canonical private ZPS SW03 code.

## Working components

`src/zps-durable-cas.mjs` provides `DurablePortChunkStore.open({directory,portId,encryptionKey,maxStoredBytes})`. It accepts an **external 32-byte AES-256-GCM key**, binds authentication to the owning cryptographic Port ID, stores each SHA-256-verified 8–64 KiB CDC chunk encrypted in a private, immutable content-addressed file, and rejects corrupted files, incorrect keys, foreign Port IDs and duplicates. The store writes each new chunk using an exclusive temporary file, file fsync, hard-link publication, best-effort directory fsync, bounded quotas and an exclusive same-host write lock. It never moves a disk mount, creates network routes, generates a founder key, or uploads a chunk. A stale lock must be inspected and recovered explicitly.

`store.importPrepared()`, `store.publishManifest()`, `store.readPublishedState()`, and `store.reconstruct()` verify **every chunk and the entire final SHA-256**. A state manifest is only published after all constituent data is accessible and verified. After closing and reopening the same store with the same key, the original bytes can be reconstructed again. Indexed manifests contain file hashes and sizes **in local metadata** and are not encrypted; treat this as a private state catalog.

`src/zps-signed-materialization.mjs` connects the real encrypted NativeSession CDC/1 transfer to the Port's persistent store. `reconstructPublishAndReceipt()` reads already-available destination chunks locally, requests missing chunks over the **already established signed AES-GCM Port session**, authenticates each reply, stores new verified chunks encrypted, materializes all bytes, publishes a durable local state index, then has **Port B** sign the receipt. Receipts include exact state digest, Port A/B IDs, native session ID, missing unique bytes, ciphertext request/response bytes and time. `verifyZpsMaterializationReceipt()` independently verifies both pinned Port records and signatures, signed state scope, receipt constraints and timing, even after session expiry (using historical peer records). This proves the signer asserted completion with verifiable software protocol binding; it is not independent physical attestation.

Port 0 remains founder-only. Other Ports retain regular/admin roles over themselves, and one Port's key cannot decrypt another Port's storage merely through file copying. All storage and native-session behavior remains local to those explicitly authorized ports.

## Proof labels and limitations

| Evidence claim | Current status |
|---|---|
| Real encrypted chunk bytes persisted on a local filesystem | Executed test |
| File integrity, corruption, missing data and incorrect-key rejection | Executed test |
| Filesystem close/reopen with same key and exact reconstruction | Executed test |
| Native signed session Port A → Port B missing chunk request and publication | In-process encrypted session integration test |
| Signed destination receipt bound to original session and state | Executed test |
| Separate OS process crash / actual abrupt physical power loss | NOT VERIFIED |
| Actual Windows + Android physical-host native link | NOT VERIFIED by this module |
| Canonical original Tesseract/ZPS SW03 integrated | NOT VERIFIED |
| Real globally routed or physically non-routed data delivery | NOT VERIFIED |
| Native hardware-independent global transport | NOT VERIFIED |

**No new information is created from a hash.** If the target Port does not already hold the state, it needs the new bytes through an actually qualified physical carrier. Native strict mode rejects the disclosed routed/IP transport adapters. Declared non-routing does not establish physical proof.

The store only handles 64 KiB chunk objects and candidate-sized CDC manifests (4 MiB max per object). This is not a customer multi-tenant storage service. Hardware-backed key custody, rotation, encrypted state-index metadata, dedupe privacy, crash recovery under abrupt power cut, genuine cold-cache trials, concurrent multi-process writers, authenticated native radio drivers, and canonical ZPS integration are follow-up gates.

## Tests and benchmark

```bash
npm run zps:test
npm run zps:benchmark
npm test
```

The local benchmark writes and fsyncs 1 MiB of deterministic data encrypted on the CI runner's actual filesystem, closes/reopens the store, then measures 10 exact warm-cache reconstruction trials (p50/p95/p99). Values are captured in the standalone **SDPN ZPS encrypted persistence** workflow as an artifact. It intentionally reports false for physical power interruption, separate OS process restart, verified cold cache, two-host transport and globally routing-free connectivity.

## Next inventions / hard technical moats

1. **PORT-GRAVITY / State Locality Engine:** authorization-aware on-device content locality and reusable-cache scoring; measure saved true physical bytes and disk/energy cost, with no unconsented remote replication.
2. **TESSERACT-ENTROPY / Information Floor:** account for the true incompressible bytes unknown to each destination before any transfer; compare raw, compressed, CDC, erasure-coded and reconstructable state to avoid fake teleportation claims.
3. **PORT-PROOF / Evidence Attestation:** versioned signed session + storage receipts, audit challenge replay, signed hardware adapter evidence, actual carrier packets and independent power-loss/gateway tests.
4. **PORT-MORPH / Universal Hardware Broker:** automatically discover OS-native GPU/NPU, storage, apps, services, radios and APIs; execute local capabilities under local Port-admin and OS permission scope. Measure hardware coverage and watts per completed operation.
5. **ORBIT-OPT / Adaptive Scheduling:** optimize among exact reconstruction, local compute, preexisting cache and missing-byte delivery by p95, energy and cost—not by advertised nominal bitrate.
6. **ZPS-CONTINUITY / Durable State Migration:** encrypted metadata and keys, content lineage, snapshots, resume from verified chunks, offline device handoff and proofs of durable commit.
7. **PORT-NATIVE / Global Signed Presence:** decentralized identity and signed coordinated presence, bounded availability receipts, local peer sessions and user-owned services, without assuming a physical connection exists from registration alone.
8. **INTERCONNECT / Consumer SDK:** native PORTAL apps, local-first sites, direct sharing, developer APIs, per-Port paid storage/compute services and isolated managed coordination.
9. **ROUTE-FREE PHY / Research Frontier:** find or design an independently tested physical substrate supporting non-forwarded, distance-spanning transfer of novel information. This cannot be demonstrated solely through software collapse/reconstruction or signed presence.

**Differentiation is proved on matched systems.** Compare end-to-end goodput, p50/p95/p99, exactness, energy per reconstructed MiB, cold-start, cost/GB, recovery, device coverage, security, reliability and actual underlay routing against standard HTTPS/QUIC, content sync and cloud storage. Publish failures as well as wins.

No production DNS, network routes, cloud services, mobile installations, secrets or live traffic are changed by this PR.
