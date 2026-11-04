# ZPS data materializer and SDPN runtime contract

**Status:** CONCEPT / design contract. The implementation and evidence below are listed separately. This document does not enable a transport, execute user code, grant identity, or authorize production use.

## 1. Terms

### ZPS data materializer

The **ZPS data materializer** is the SDPN service that turns an explicitly authorized source snapshot or incoming transfer into a durable, integrity-verified, addressable representation at a destination port. It owns the data path from source read through staging, verification, publication, receipt, and bounded recovery.

Its core invariant is:

> A destination is visible as committed only after the complete authorized object is present and its length and content digest match the authorized manifest; a failed or uncertain operation leaves the source untouched and the destination either unchanged or quarantined.

The materializer handles arbitrary input as opaque bytes by default: files, source trees, binaries, media, structured records, stream segments, or runtime artifacts. A named parser/adapter may validate a declared format, but parsing does not imply execution. Unknown formats pass through only under policy and size limits.

The materializer does **not** execute code, decide policy, issue identity, silently widen permissions, invent a destination, or claim physical zero-copy. Execution belongs to an independently authorized runtime after materialization verification.

### SDPN runtime

A **runtime** is a versioned host execution environment that loads an identified artifact under a declared ABI and capability set, enforces resource limits and lifecycle rules, and returns outputs plus verifiable execution evidence. A runtime contract names at least:

- runtime engine and version, artifact digest, and ABI/interface version;
- permitted imports, network/file/device capabilities, and identity;
- memory, CPU/fuel, wall-time, concurrency, and output bounds;
- start, health, cancellation, crash, upgrade, and shutdown behavior;
- input/output schema, idempotency/replay rules, and receipt format.

The operating system, process supervisor, or container platform can host a runtime, but is not by itself the workload contract. A Wasmtime Component Model host is one possible runtime adapter. It does not make the materializer a runtime.

## 2. Rhythmic-only component versus data materializer

The SW02 WASM guest currently exposes a small numeric transition: it adds a delta to a 32-bit value and reports overflow. That is a computation component. The surrounding host admission layer checks artifact, authority, invocation, and replay constraints; those checks do not turn the guest function into a file or stream materializer.

A ZPS data materializer instead accepts an authorized data object or stream, stages bytes, verifies the manifest and content, publishes the object, and emits a receipt. It can optionally invoke a separate runtime, but only after the artifact is materialized and a distinct execution grant passes. “Rhythmic-only” describes the current guest’s behavior, not a capability to ingest real project files or user datasets.

## 3. Responsibility and interface boundaries

Implementations should keep these interfaces separate so a new source, carrier, store, or runtime can be qualified without rewriting the core:

| Interface | Responsibility |
| --- | --- |
| Source adapter | Read a consented, bounded source snapshot. Never mutate the source. |
| Port address resolver | Parse a versioned `port://` reference and resolve it using configured trust and routing data. The canonical URI grammar and resolver protocol require a versioned contract. |
| Carrier | Move bounded frames/chunks, sequence numbers, acknowledgements, and cancellation over a selected link. |
| Manifest/object store | Store versioned metadata, content-addressed chunks, staging state, and commit markers. |
| Grant/trust verifier | Check principal, destination, purpose, expiry, revocation, artifact digest, and allowed effects. |
| Materializer | Plan, stage, verify, commit, produce receipts, and reconcile interrupted work. |
| Runtime provider | Execute an explicitly authorized artifact under its ABI and resource/capability limits. |
| Receipt/provenance sink | Preserve linked transfer, verification, and execution receipts without exposing source contents. |
| Health reconciler | Compare observed state with signed desired policy and perform only allowlisted repairs. |

The first interoperable envelope should have a schema version, source/destination port references, opaque object ID, content hash, exact byte count, chunking/ordering rules, media/schema hint, grant reference, expiry, and receipt correlation ID. Unknown fields must be rejected or explicitly preserved according to that schema version; silent reinterpretation is prohibited. A checksum proves content consistency, not source authority or authorship; signatures and grants must be verified independently.

## 4. Materialization lifecycle

The implementation should use an explicit state machine:

1. **Authorize:** validate source, destination, content limit, grant, expiry, revocation, and allowed effects.
2. **Snapshot:** obtain a stable read-only source view and bind its digest/size to the transfer ID.
3. **Stage:** write bounded chunks to a private temporary area; record chunk indexes and digests; fsync data before recording durable progress.
4. **Verify:** verify every chunk, exact total length, whole-object digest, manifest signature/trust, and destination policy.
5. **Commit:** atomically publish from staging, refusing symlinks and conflicting destinations; persist the commit marker last.
6. **Receipt:** emit an idempotently addressable receipt for the committed object and observed evidence.
7. **Reconcile:** after interruption, resume only verified chunks under the same grant; otherwise quarantine the staging state and leave the destination unchanged.

Receipt identity must distinguish “data verified locally,” “peer acknowledged,” “transfer resumed,” “cross-host transfer completed,” and “zero-copy proved.” Never infer a stronger result from a weaker one.

## 5. Self-healing rules

Self-healing is a constrained reconciler, not unrestricted autonomous repair. Its states are **HEALTHY → DEGRADED → REPAIRING → VERIFIED** or **QUARANTINED**.

Safe automatic actions may include restarting an isolated worker, removing only uncommitted temporary data, resuming from a verified checkpoint, or reconstructing from a local verified cache under the original grant. Every action is bounded, idempotent, auditable, and followed by the same digest/size checks.

The reconciler must stop and quarantine on unknown formats, invalid or revoked grants, signature/trust failures, changed source snapshots, conflicting destinations, corrupted manifests, exhausted resource limits, or ambiguous commit outcomes. It must never overwrite a conflict, modify a source, disable authentication, renew or issue authority on its own, change a trust root, expand capabilities, execute a newly received artifact, or turn on a production route. Credential enrollment and signing-key custody require an explicitly configured owner-controlled trust provider; preflight can automate diagnosis and qualification without silently granting authority.

## 6. Interoperability and protocol evolution

The core speaks the versioned envelope and adapter interfaces, not every source protocol directly. Initial and future carriers can be qualified behind the same contract:

- **Implemented evidence:** same-host OS pipes in the SW09 candidate.
- **Next transport candidate:** authenticated two-host carrier with explicit peer identities and a resumable chunk protocol.
- **Offline/Internet-independent candidate:** removable or local-link bundles with a locally provisioned trust bundle and replay-safe receipt exchange.
- **Future streaming:** bounded queues, backpressure, chunk sequence/acknowledgement, checkpoint persistence, cancellation, per-chunk integrity, final-object digest, and deterministic behavior on disconnect.

QUIC is a possible IP-network carrier because it provides flow-controlled streams and connection migration, but it uses UDP/IP and therefore does not itself provide Internet independence. Disable 0-RTT for state-changing materialization until the application protocol has a reviewed replay design. Each new carrier still needs two-host qualification; a local pipe test is not cross-host evidence.

## 7. Qualification and durability targets

“Two to five times more durable” is a goal, not a measured result. Do not claim a multiplier until the same real-data workload and fault profile are run against a recorded baseline and candidate. Publish sample counts, OS/runtime/carrier versions, recovery-success rate, data-loss/corruption count, recovery-time distribution, and confidence bounds. If the baseline metric is zero, report absolute improvement instead of a multiplier.

Required safety invariants for every test:

- no unauthorized execution or external effect;
- source bytes unchanged;
- failed transfer never publishes partial bytes;
- successful output matches authorized digest and size exactly;
- duplicate/replayed requests remain idempotent;
- conflicts and invalid/revoked identity fail closed;
- every recovery action is bounded and receipt-linked.

Fault cases must include process termination before and after commit, host restart, disk full/partial write, corrupted or missing cache chunks, lost/duplicate/reordered frames, disconnect and route change, duplicate invocation, expired/revoked trust, signature mismatch, symlink/conflicting destination, unknown media type, quota exhaustion, and concurrent receive attempts.

Use real data as well as controlled fixtures. CI may use checked-in, non-sensitive project files. A user-selected local file should be exercised locally with consent; do not upload user data to public CI or artifacts. Receipts can record digest, size, adapter/version, and outcome without recording file contents. Keep generated synthetic data as stress/fault input, clearly labeled as synthetic.

## 8. Evidence ledger

| Capability | Status | Evidence and limit |
| --- | --- | --- |
| SW02 numeric WASM guest plus host admission | TESTED on its pinned PR head | CI passed on the SW02 head; guest behavior is arithmetic. It is not a ZPS materializer or streaming transfer. |
| SW09 local transfer and bounded local recovery | TESTED on its pinned PR head | 12 qualification cases passed. Two actual checked-in repository files transferred and were reconstructed in both directions with matching size/hash. The harness observed no network syscalls. |
| Same-host port-to-port over OS pipes | TESTED candidate | Two processes on one host; not a physical two-host or Internet-independent proof. |
| One-shot local self-heal | TESTED candidate | Reconstructed only from verified local cache under the original test grant; conflict and revoked-grant cases failed closed. Not an always-on production service. |
| Internet-independent discovery, real cross-host transport, production credentials, always-on self-healing, arbitrary-code execution | NOT TESTED / NOT ENABLED | Require separate implementations, grants, and evidence. |

## 9. Next implementation sequence

1. Keep SW09 pipe carrier and add the versioned envelope, manifest, and receipt contract with schema round-trip and unknown-version rejection tests.
2. Add an opt-in local real-file harness: user selects a file; the harness records only its path-local provenance, digest, size, and result; destination is atomically published only after verification.
3. Add bounded chunk/checkpoint persistence and crash injection against that real-file harness.
4. Add an authenticated two-host carrier and test on two physical hosts with controlled disconnect/restart, replay, identity rotation, and wrong-peer cases.
5. Add offline route/trust-bundle discovery and prove transfer with external Internet egress blocked.
6. Add a separately gated runtime-provider adapter and streaming protocols only after materializer safety/identity gates pass.

A milestone advances from CONCEPT to IMPLEMENTED when code exists, to TESTED only on reproducible receipts and passing required checks, to MERGED only after review and merge, and to DEPLOYED / PRODUCTION-VERIFIED only with deployment and live evidence.
