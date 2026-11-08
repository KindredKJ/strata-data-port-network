# Tesseract MORPH/1 — State Transformation, Not Repeated Transmission

**Architecture:** Port A signs a control-only state transformation. Port B verifies the origin, destination, authenticated AES-GCM session and *its own exact base state*, then applies only the genuinely new information, reconstructs the target locally, persists verified ZPS state and signs a receipt.

This candidate is additive on top of the ZPS/CAS store and CDC/1 native encrypted session. It is not an implementation of an unverified physical data teleportation mechanism.

## Invention: state morphing instead of redundant data movement

For a common workload where a recipient already possesses the previous exact state:
- The origin finds the longest common **prefix** and **suffix** of the previous and updated binary object.
- The new manifest says: copy the old verified prefix; insert N literal new bytes; copy the old verified suffix.
- The origin signs a destination-bound and expiring cryptographic coordinate containing SHA-256 hashes, offsets, lengths and the exact new-byte commitment—but **not the bytes themselves**.
- The inserted bytes are sealed separately inside SDPN's existing Ed25519/X25519/HKDF/AES-256-GCM native session.
- The destination Port checks the source signature, trust-pinned Port identities, session scope, exact prior local state and AEAD authentication, reconstructs the target, verifies full SHA-256, encrypts and persists the updated ZPS content, and signs completion evidence.

This is **lossless**, even for binary formats; for text and images, data is still treated as exact bytes. Nothing about the filename, semantics or position in a network is required.

A 173-byte insertion into a 2 MiB existing high-entropy file can be represented by **173 new application payload bytes** plus a relatively small signed coordinate and session overhead. For the same workload, CDC/1 must transmit on the order of tens of KiB of content, while fixed 64 KiB blocks may require the entire file. The actual comparative values come from the repeatable CI benchmark, not from this design document.

## When MORPH is advantageous

MORPH/1 is a **single contiguous edit** optimization. When the previous state is missing, when the new edit span is larger than 256 KiB, or when many disjoint changes make this representation expensive, choose CDC/1, full verified delivery, or a later multi-splice implementation. Never signal success or use a reference-only shortcut when a destination cannot prove the base state. Signed identity registration is not evidence of a physical link.

The backend can use a deterministic planner to compare:
- `MORPH/1`: inserted bytes + signed control + encryption frame overhead + base-state lookup cost;
- `CDC/1`: missing unique chunks + signed manifest + authenticated frame overhead + cache lookup cost;
- `FULL`: all current payload bytes, fully authenticated and reconstructable.

Choose based on measured bytes, p95 CPU latency, power cost, memory, and verified availability; do not assume MORPH will always win.

## Actual code

- `src/tesseract-state-morph.mjs`: `prepareMorphDelta`, `signMorphCoordinate`, `sealMorphInsert`, `materializeMorphNative`, `verifyMorphReceipt`, `reconstructMorphLocally`.
- `test/tesseract-state-morph.test.mjs`: real AES-GCM native session fixtures, encrypted ZPS disk publication, tamper/base-absence and wrong-adapter rejection, signed Port B receipt.
- `scripts/benchmark-tesseract-morph.mjs`: matched high-entropy insertion baseline with full-file, fixed 64 KiB, CDC/1 and MORPH/1 logical payload counts.
- `test/tesseract-state-morph-benchmark.test.mjs`: exactness and comparative byte thresholds.

```bash
npm run morph:test
npm run morph:benchmark
npm test
```

## Moat extensions

1. **MORPH/2 multi-splice/state algebra:** minimum-edit source representation for many separated changes, optional copy-by-hash, verified DAG of prior state. Evaluate CPU time against edit-string length and prefer CDC when worse.
2. **MORPH-EXEC:** deterministically reconstruct an authorized result by executing a signed, sandboxed transformation on a known local state. Prove actual output hash and total compute watts, never claim zero new information if the transformation or its inputs were transmitted.
3. **MORPH-FORECAST:** permission-preserving local predictor pre-warms likely state without automatically sharing it. Measure actual cache hits, wasted bytes, energy and user cost.
4. **PORT-GRAVITY:** a policy engine chooses local fetch, delta, signed transform or compute-on-device using a verified cost model, per-Port privacy and host performance metrics.
5. **PROOF-OF-RECONSTRUCTION:** chain the signed Port B receipt to source signature, encrypted native session, persistent ZPS object, independent host separation and later physical adapter trace when those proofs actually exist.
6. **TESSERACT-STORAGE:** confidential, content-addressed encrypted snapshots, state history, garbage collection and gradual key rotation with crash recovery.
7. **NATIVE-GLOBAL:** signed geographically distributed presence, direct physical link research and actual underlay measurements; the coordination layer is not allowed to pretend that a hash carried new bytes.

**Security / physics:** Software cannot reconstruct previously unknown arbitrary data without its encoded information or valid previously shared state. The encrypted insert must still be physically delivered; these test fixtures use in-process native frames, not globally route-free physical transport. No DNS, cloud, real devices, network routes, production traffic or founder keys are changed.
