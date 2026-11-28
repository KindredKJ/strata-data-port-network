# SW06-F: secure two-host transport proof gate

This harness makes the physical two-host SDPN gate executable without claiming the gate has
already passed.

## Wire security

The challenge request contains only proof metadata. The canonical Kindred state payload is
encrypted before it crosses the network.

The sender and receiver derive a per-session key from the one-time pairing secret, random
challenge, and session ID using HKDF-SHA-256. The payload is protected with AES-256-GCM and the
full state/proof transcript is authenticated as associated data.

The receiver therefore accepts plaintext only after challenge/response authentication,
AES-256-GCM authentication, byte-count verification, and SHA-256 verification all succeed.

The pairing secret is ephemeral. It must never be committed to Git or reused as a long-term Kindred
authority key.

## Evidence

The receipt records state ID, canonical state hash, generation, exact payload hashes, source and
destination host fingerprints, loopback status, encryption status, cipher, transport class, and the
two-host result.

`twoHostNetworkProofSatisfied` becomes true only when authentication and integrity pass, host
fingerprints differ, and the receiver observes a non-loopback peer.

Even a successful receipt keeps `physicalMachineAttestationProven=false` and
`productionReadyClaim=false`: this gate is network/software evidence, not TPM attestation or
physical zero-copy proof.

## Windows launchers

Receiver:

```powershell
pwsh ./scripts/Start-SW06FReceiver.ps1
```

Sender:

```powershell
pwsh ./scripts/Invoke-SW06FProof.ps1 -ReceiverIp <receiver-ip> -PairingSecret <one-time-secret>
```

The sender uses the local Kindred Root proof-export endpoint, sends the exact canonical bytes,
stores the returned receipt, and asks Kindred Root to verify/import it.

## Current status

CI proves protocol behavior on loopback and must keep `twoHostNetworkProofSatisfied=false`.
The physical gate changes only after two real authorized hosts complete the run and Kindred verifies
the receipt.

## Additive protocol hardening (October 7, 2026)

Founder: **Kindred Jermaine Cox / Kindred Labs**. Existing component identities,
wire MAC vector, candidate classifications and predecessor lineage are preserved.

The receiver caps outstanding sessions (default 128), expires challenges after
30 seconds, rejects ambiguous identifiers and malformed MACs, and consumes an
authenticated session before asynchronous work to prevent concurrent replay.
The sender binds the returned receipt to the exact session, host fingerprints,
state hash and byte count, and rejects elevated physical/production claims.

The PowerShell launcher now requires strict boolean MAC, lineage and encryption
success, an exact state hash, and the two-host software gate. For deliberately
scoped local work, `-AllowLoopbackEvidence` is explicit; it does not authorize any
physical claim. A hashes index accompanies the payload and receipt. Successful
completion clears stale native exit status. This change affects the SW06-F
launcher; the historical SW02 PowerShell wrapper was not recovered or modified.

CI retains Node protocol and Windows verification-gate logs. These jobs verify
behavior and parsing; they do not execute two physical machines or import a real
founder-authorized receipt. The existing transport uses its documented ephemeral
pairing-key AES-GCM/HKDF scheme; mutual TLS and physical identity attestation
remain separate prerequisites where required by the deployment policy.
