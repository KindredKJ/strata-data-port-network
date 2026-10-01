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
