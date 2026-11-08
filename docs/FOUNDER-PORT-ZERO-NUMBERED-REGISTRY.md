# Founder Port Zero and sequential numbered ports (v1)

This is an additive implementation for Kindred Labs SDPN. It **does not** replace the
existing `strata:port:ed25519:...` identities, PORT/1 names, peer-session cryptography,
Tesseract or ZPS. It never configures IP addresses, host routes, relay nodes, DNS,
production redirection, or a transport listener.

## Numbering and trust

- **Port 0 is reserved for the founder authority.** Its registry key must be
  explicitly pinned by every trusting client and must remain under founder control.
  No software signature alone proves a legal person's identity: the operator must
  establish that the pinned public key belongs to the founder.
- Additional ports are assigned **1, 2, 3, ...** by the single founder-signed
  writer. The assignment binds the decimal port number to the existing
  self-certifying Ed25519 Port ID/public key.
- Numbers are permanent; revocation makes the number inactive, never available
  for reissue. A replacement key receives a fresh number.
- Each registry event is Ed25519 signed with a monotonically increasing sequence
  and previous-event SHA-256 commitment. Readers verify the complete chain and
  the explicit pinned Port 0 trust anchor.
- Concurrent global writers, distributed consensus, publication, witness
  checkpoints and permanent audit replicas are **not** implemented. Two signed
  forks created with the same authority key cannot be detected by chain
  verification in isolation. A single-writer durable authority and independently
  pinned checkpoints are required before global numbering claims.

## Local operator commands (Node 22+)

This CLI reuses the **existing** operator-owned Ed25519 key
`~/.sdpn/port-owner-key.pem`, generated separately by the PORT/1
operator tooling. It **does not** generate or upload a founder key. Before using
it, confirm that the existing key is the intended founder authority and
securely pin its displayed `strata:port:ed25519:...` public ID. Do not
paste private keys into commands or GitHub. To use a custom working directory,
pass `--dir /your/private/directory` on every command.

```bash
node scripts/numbered-port-registry.mjs init --founder-id strata:port:ed25519:YOUR_PINNED_FOUNDER_KEY_HASH
node scripts/numbered-port-registry.mjs enroll --founder-id strata:port:ed25519:YOUR_PINNED_FOUNDER_KEY_HASH --public-key BASE64_ED25519_SPKI_OF_THE_NEW_PORT
node scripts/numbered-port-registry.mjs inspect --founder-id strata:port:ed25519:YOUR_PINNED_FOUNDER_KEY_HASH
node scripts/numbered-port-registry.mjs revoke --founder-id strata:port:ed25519:YOUR_PINNED_FOUNDER_KEY_HASH --number 1
```

The ledger is stored in an owner-private `port-number-registry.jsonl` file with
one signed event per line; the CLI appends and fsyncs records under an exclusive
single-host lock. Interrupted writes and abandoned locks **fail visibly** instead
of silently rewriting historic events. This is a single-host operator
implementation, not a cross-machine globally consistent service. Protect
and back up the ledger; use independent checkpoints, durable storage and
recovery testing before production.

The `createFounderPortZero`, `assignNumberedPort`,
`revokeNumberedPort`, `verifyNumberedRegistry`, and
`resolveNumberedPort` functions can be consumed directly from
`src/numbered-port-registry.mjs`.

## Tesseract presence versus connectivity

`signNumberedTesseractPresence` signs a short-lived peer record with the
existing native identity and binds it to the signed numbered registry's
current chain head. `verifyNumberedTesseractPresence` verifies the two
signatures, current registration, expiry, declared Tesseract engine,
bound worker, and `native.materialize.v1` capability.

**A signed declaration is not online presence.** A verified record returns
`networkConnected: false`, `globallyReachable: false` and
`materializationVerified: false`. Those states require an actually
executed reciprocal native session, exact reconstruction, and independent
receipts. Existing native peer session policy still governs authorized
transfer; the numeric identifier grants no new permissions.

Global online participation requires a reachability service or peer discovery
distribution using a **disclosed communication substrate**. SDPN's logical
identities and reconstruction state can be IP-free while the actual carrier
uses existing IP routing. If physically IP-free global transport is demanded,
that remains a separate unproved networking research program. No additional
hardware purchase is required by this registry feature.

## Verification

```bash
node --test test/numbered-port-registry.test.mjs
npm test
```

Tests cover Port 0 pinning, monotonic numbering, duplicate rejection,
signature/hash-chain tampering, revocation, no number reuse, short-lived
Tesseract presence, policy-preserving native session interoperation, and
honest disclosure of existing IP adapter routing.

No active SDPN networks, Android mobile services, DNS, or production
environments are modified by adding these modules.
