# Kindred External Proof v1

## Purpose

This feature creates an externally hosted, independently verifiable evidence boundary between a Kindred runtime and Strata. It is intentionally narrow: a source runtime submits the canonical bytes of one bounded job state, Strata authenticates the transfer challenge, verifies the encrypted payload, and returns an Ed25519-signed receipt.

This is evidence of an external cross-service state transfer when the deployed endpoints and receipt verify. It is **not** by itself evidence of physical zero-copy, two separately attested physical machines, failover/resume, global SDPN reach, production readiness, customer adoption, or financial activity.

## Endpoints

- `GET /api/proof/status` — public nonsecret readiness and signing-key fingerprint.
- `POST /api/proof/challenge` — issues a short-lived stateless HMAC-authenticated transfer challenge.
- `POST /api/proof/transfer` — accepts an AES-256-GCM encrypted canonical payload and returns a signed receipt.

## Cryptographic contract

- Canonical payload digest: SHA-256.
- Challenge authentication: HMAC-SHA256 over a canonical stateless token.
- Session key: HKDF-SHA256 from the server-side proof secret plus per-challenge nonce/id.
- Application payload encryption: AES-256-GCM with the challenge token bound as AAD.
- Receipt signature: Ed25519.
- Public verification key: `public/proof-public-key.pem`.
- Receipt verification: `node scripts/verify-external-receipt.mjs --receipt <receipt.json>`.

The shared challenge/encryption secret and Ed25519 private key are deployment secrets and must never be committed. The public verification key is deliberately committed so anyone can verify a returned receipt.

## Receipt evidence

A valid receipt binds:

- source service identity,
- destination service identity,
- state/job ID,
- state hash,
- generation,
- payload SHA-256,
- received SHA-256,
- byte counts,
- transport authentication/integrity facts,
- Vercel deployment metadata when available,
- observation timestamp,
- signing key ID.

The receipt deliberately records:

- `physicalMachineAttestationProven: false`
- `productionReadyClaim: false`

Those values remain false until separate evidence gates prove them.

## Evidence gates

A deployed v1 proof may be classified **VERIFIED_EXTERNAL** only after:

1. Strata status reports configured and exposes the expected public key ID.
2. A source Kindred runtime submits a real bounded job state from an independently hosted service.
3. Strata decrypts and verifies that state and returns a signed receipt.
4. The source runtime verifies the pinned Ed25519 public key and signature.
5. The same receipt passes the standalone verifier outside the source runtime.
6. The deployment commit IDs and receipt are retained in the evidence bundle.

This version does not claim forced-failure recovery. That requires durable checkpoint state plus a separate recovery executor and will be a later gate.
