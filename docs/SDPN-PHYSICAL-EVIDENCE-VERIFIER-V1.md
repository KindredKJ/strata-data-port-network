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

## Current boundary

The verifier code can validate evidence but does not create a hardware attestation, capture a physical network, produce a QUIC measurement, install an OS driver, or establish the 40% target. CI can verify the cryptographic logic with ephemeral test keys. Production qualification still requires two separately identified physical hosts, the versioned live transport, an independent witness, and three consecutive measured five-minute windows. The current SW06-F and INTERCONNECT QEMU receipts remain virtualized staging evidence.
