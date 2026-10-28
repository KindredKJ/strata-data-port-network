# Kindred External Proof v1 — threat model

## Scope

This document covers only the bounded external proof path:

```
independent caller
  -> Render Unified Quad proof route
  -> challenge + encrypted canonical state
  -> Strata proof service on Vercel
  -> Ed25519 signed receipt
  -> independent verification
```

It does not security-review the wider Genesis, Brainstem, Strata/SDPN, blockchain, financial or device-control architecture.

## Security objectives

1. A public caller cannot select an arbitrary network destination.
2. A public caller cannot invoke arbitrary code through the proof route.
3. The proof route cannot move money or write to a blockchain.
4. The proof route does not expose runtime bearer credentials, signing private keys or shared transport secrets.
5. Strata rejects modified, expired or unauthenticated challenge material.
6. Strata rejects payloads whose received SHA-256 differs from the challenge-bound state digest.
7. Receipts are independently verifiable with a pinned public Ed25519 key.
8. Receipt fields cannot be modified without invalidating the signature.
9. Private Unified Quad `/runtime/*` routes remain behind a separate fail-closed bearer-key boundary.
10. Evidence maturity claims remain false unless separately proven.

## Trust boundaries

### Public caller -> Render proof source

Untrusted input is accepted only by:

- `GET /proof/status`
- `POST /proof/jobs`
- bounded recovery checkpoint/resume routes on the isolated canary branch

The public job route accepts only:

- `HASH_TEXT`
- `CANONICALIZE_JSON`

Input/body size is bounded and an in-memory request-rate guard is present. The caller cannot supply a network URL.

### Render source -> Strata destination

The destination URL and trusted receipt public key are operator configuration.

For each transfer:

- Strata issues a short-lived stateless HMAC-SHA256 authenticated challenge.
- The challenge binds source node, destination node, state/job ID, state SHA-256, generation, payload SHA-256 and byte count.
- HKDF-SHA256 derives per-challenge AES-256-GCM material.
- The complete challenge token is bound as AES-GCM AAD.
- Strata verifies the received payload digest before issuing a receipt.

### Strata -> independent verifier

The receipt is signed with Ed25519. The private signing key is deployment secret material. The SPKI public key is intentionally committed to the public repository and the verifier pins it.

## Secret inventory

Secret values must never be committed or returned to callers.

- Unified Quad private runtime bearer key
- external proof shared challenge/encryption secret
- Strata Ed25519 private signing key
- sealed recovery capsule secret

Public/nonsecret:

- Ed25519 public key
- public key fingerprint
- signed receipt
- job IDs
- challenge IDs
- state SHA-256 values
- deployment/commit metadata
- benchmark timings

## Explicitly blocked capabilities

The v1 proof policy records:

- `moneyMovement: false`
- `blockchainWrite: false`
- `credentialAccess: false`
- `arbitraryNetworkTarget: false`
- `businessExternalEffects: NONE`

The public proof path is not a general tool-execution endpoint.

## Defended attacks

### Payload modification in transit

AES-256-GCM authentication plus SHA-256 state binding rejects modified ciphertext/plaintext.

### Challenge tampering

The stateless challenge is HMAC authenticated. Modified tokens fail verification.

### Challenge replay after expiry

Challenges carry short expiry timestamps and are rejected after expiry. **Current v1 does not maintain a server-side nonce replay cache inside the validity window.** A valid challenge may therefore be replayable during its short TTL if an attacker possesses the complete challenge and encrypted transfer body. Receipts remain bound to the same state/challenge; preventing all within-window replay is a future hardening gate.

### Receipt modification

Ed25519 signature verification fails if signed receipt content changes.

### Signing-key substitution

Source and standalone verifier pin the expected public key / key fingerprint.

### Arbitrary SSRF through public job request

The external destination is deployment configuration; it is not caller-controlled.

### Arbitrary code execution through public job request

Only two explicit deterministic operations are dispatched. Unsupported operations fail before network transfer.

### Access to private Unified Quad controls

Private `/runtime/*` routes require a separately configured bearer key on the hardened branch. Public proof routes are deliberately placed outside that private route family and do not proxy arbitrary runtime paths.

## Recovery capsule security

Recovery capsules contain the bounded job state encrypted with AES-256-GCM using a key derived from a recovery secret, random salt and recovery ID. The public capsule digest detects envelope changes before decryption, and AES-GCM authenticates the encrypted state.

The capsule is designed to be retained outside the source process. Publishing the private recovery secret would destroy this security boundary; it must remain deployment-only.

Recovery Proof #001 demonstrates a deliberate process replacement. It does not prove safe recovery from every arbitrary instruction boundary or physical power loss.

## Known limitations / review targets

1. Challenge replay within the short valid TTL has no durable nonce cache.
2. Source-side rate limiting is process-local and resets on restart.
3. The public source is currently a canary rather than the canonical production Unified Quad service.
4. Automatic failover is not implemented.
5. Physical host identity is not attested.
6. The external benchmark is small and sequential.
7. Secrets are provider-managed environment variables; dedicated KMS/HSM-backed signing has not been proven.
8. Key rotation and multi-key receipt verification policy are not yet implemented.
9. The bounded proof protocol has not yet received an independent human security audit.

## Requested external review

Reviewers should focus on:

- canonicalization ambiguities;
- HMAC token construction and replay;
- HKDF inputs/domain separation;
- AES-GCM nonce/key lifecycle;
- receipt signature verification and key pinning;
- request-size/rate-limit abuse;
- SSRF boundary;
- parser edge cases;
- recovery capsule tamper/replay risks;
- evidence-claim correctness.

Please report vulnerabilities privately through GitHub's available security reporting mechanism when possible. Do not publish exploitable secret material.
