# SW06-F: two-host transport proof harness

This harness makes the next SDPN gate executable without claiming it has already passed.

## What it does

The receiver and sender establish a challenge/response session over HTTP/TCP, authenticate the
proof exchange with an HMAC secret, transfer the exact canonical payload bytes, verify byte count
and SHA-256 at the destination, and return a MAC-protected receipt.

The receipt records:

- source and destination host fingerprints;
- whether those fingerprints differ;
- whether the TCP peer was loopback;
- authentication result;
- payload byte count and SHA-256 result;
- state identity supplied by Kindred;
- transport classification;
- whether the software evidence satisfies the two-host network criterion.

`twoHostNetworkProofSatisfied` can become true only when all of the following are observed in the
same run:

1. payload integrity passes;
2. challenge/response authentication passes;
3. source and destination host fingerprints differ;
4. the receiver does not observe a loopback peer.

Even then, the receipt keeps `physicalMachineAttestationProven=false`. The harness does not
provide TPM/hardware attestation and should not be described as proof of physical zero-copy.

## Run on two machines

Set the same temporary proof secret on both machines. Do not commit the secret.

Receiver:

```bash
KINDRED_SDPN_PROOF_SECRET="<temporary-secret>" \
node scripts/two-machine-receiver.mjs --host 0.0.0.0 --port 47900
```

Sender:

```bash
KINDRED_SDPN_PROOF_SECRET="<temporary-secret>" \
node scripts/two-machine-sender.mjs \
  --host <receiver-ip> \
  --port 47900 \
  --payload <canonical-state-file> \
  --state-id <state-id> \
  --state-hash <kindred-state-hash> \
  --receipt evidence/two-host-proof.json
```

The canonical payload file should be the exact `kindred-canonical-json-v1` bytes emitted by
Kindred root.

## Current status

The committed automated test exercises the complete protocol on loopback and must keep
`twoHostNetworkProofSatisfied=false`. A real two-host receipt is not created by CI and remains a
separate physical-network gate.
