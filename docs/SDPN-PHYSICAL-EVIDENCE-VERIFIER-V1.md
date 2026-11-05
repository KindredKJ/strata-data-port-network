# SDPN Physical Evidence Verifier v1

**Creator:** Kindred Jermaine Cox  
**Project:** Kindred Labs / Strata Data Port Network  
**Profile:** `kindred.sdpn.quic-wire.v1`

This verifier is an additive implementation of the signed-evidence callback required by the route-free local activation gate. It validates an Ed25519-signed performance window and a separate, independently trusted physical-host qualification receipt before the gate can activate a local SDPN session.

## Trust model

- The operator measurement key signs the exact canonical performance-window body.
- A separate physical-witness key signs the qualification receipt. The witness key must differ from the measurement key.
- Each trust map is provisioned by the operator and maps the lowercase SHA-256 fingerprint of an Ed25519 SubjectPublicKeyInfo DER key to its canonical base64 encoding. Public keys supplied inside evidence are never trusted automatically.
- Evidence uses the repository's `canonicalBytes` representation. Signatures are Ed25519 over those canonical bytes.
- The performance window must pass the existing schema, 60-pair minimum, five-minute duration, p95, p99, and loss checks before its signature can qualify.
- The qualification receipt is bound to the same operator network, session, peer, workload, and payload size. It expires within 12 hours, covers the measured window, contains two distinct hashed host identities, states that the hosts are independently physical and not virtualized, and asserts that the test did not change routes or expose a public listener.
- A valid witness signature proves which trusted witness made these statements. It does not remotely prove that the machines are physical. The witness must independently inspect the host separation and test setup; retain the witness procedure and original receipts with the private evidence bundle.
- The window must be no more than 10 minutes old by default and may not end more than 30 seconds in the future. Operators can set a stricter age limit.

## Evidence envelope

The evidence resolver returns this exact object for the window supplied to the gate:

~~~json
{
  "schema": "kindred.sdpn.signed-performance-evidence.v1",
  "performance": {
    "body": {},
    "keyId": "<sha256-of-ed25519-spki-der>",
    "signature": "<canonical-base64-ed25519-signature>"
  },
  "physicalQualification": {
    "body": {},
    "keyId": "<different-trusted-witness-key-fingerprint>",
    "signature": "<canonical-base64-ed25519-signature>"
  }
}
~~~

The `performance.body` must exactly equal the unsigned window being evaluated. `physicalQualification.body` uses schema `kindred.sdpn.physical-host-qualification.v1` and contains the binding, lifetime, host fingerprints, witness method, network-path fingerprint, and no-route/no-public-exposure assertions described above. The window's `qualificationReceiptSha256` is SHA-256 over the canonical complete `physicalQualification` envelope.

## Gate integration

`createSdpnSignedPerformanceEvidenceVerifierV1` returns the boolean callback accepted by `SdpnTeleportActivationGate`. The callback retrieves evidence from an operator-controlled store and returns `false` for missing, malformed, stale, misbound, untrusted, or invalidly signed evidence. The gate remains on baseline for any `false` result.

Keep private signing keys outside the repository in an HSM, OS keystore, or dedicated signing service. Configure trust maps through deployment configuration. Store raw host-level receipts privately; do not publish LAN addresses, machine identifiers, certificates, or secrets in pull requests or public artifacts.

## Native C++ verifier

`native/sdpn-evidence` provides the C++20 verifier library and `sdpn-evidence-verify` CLI for a future native host adapter. It uses OpenSSL Ed25519 and SHA-256, reads trust maps as JSON objects keyed by public-key fingerprints, and accepts the same signed evidence envelope as the Node gate callback. Build it with CMake, OpenSSL 3, and `nlohmann-json` 3.11 or newer:

~~~sh
cmake -S native/sdpn-evidence -B build/sdpn-evidence -DCMAKE_BUILD_TYPE=Release
cmake --build build/sdpn-evidence --parallel
ctest --test-dir build/sdpn-evidence --output-on-failure
~~~

The CLI accepts `--evidence`, `--operator-trust`, and `--witness-trust` JSON file paths. Trust files contain only operator-managed public keys; signing keys are not read by the verifier. A successful invocation emits a versioned result with evidence digests and `routeTableChanges: false`.

## Current boundary

The verifier code can validate evidence but does not create a hardware attestation, capture a physical network, produce a QUIC measurement, install an OS driver, or establish the 40% target. CI can compile the native verifier and verify its cryptographic logic with ephemeral test keys. Production qualification still requires two separately identified physical hosts, the versioned live transport, an independent witness, and three consecutive measured five-minute windows. The current SW06-F and INTERCONNECT QEMU receipts remain virtualized staging evidence.
