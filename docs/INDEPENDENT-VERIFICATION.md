# Independent verification

Kindred External Proof v1 is designed so an outsider can create and verify a fresh receipt without receiving any Kindred private credential.

## Requirements

- Node.js 22 or newer
- Internet access
- A checkout of this public repository

## One-command live proof

```bash
node scripts/run-independent-proof.mjs --text "your own verification text"
```

By default the client calls the bounded Render proof source at:

```
https://kindred-external-proof-canary.onrender.com
```

The script:

1. checks the public source status;
2. submits a new `HASH_TEXT` job;
3. receives the combined Render + Strata response;
4. verifies the Strata receipt using the public Ed25519 key committed in this repository;
5. checks state-hash continuity and explicit non-claims;
6. prints the job ID, state SHA-256, challenge ID, key ID and destination commit.

No bearer token, transport secret, private signing key, wallet key or payment credential is required.

## What a successful run establishes

A successful run establishes that **your machine**, at that moment, reached the externally hosted Kindred proof source, caused a bounded deterministic computation, received a Strata-signed receipt from the independently hosted destination service, and verified that receipt locally.

It does not establish wider SDPN production readiness, automatic failover, physical host attestation, physical zero-copy, customer adoption, financial settlement or blockchain execution.

## Report an independent result

Please open a GitHub issue containing:

- date/time in UTC;
- OS;
- Node version;
- command used;
- PASS/FAIL output;
- job ID;
- state SHA-256;
- challenge ID;
- receipt key ID.

Do **not** post cookies, authorization headers, environment secrets, private keys or unrelated machine data.

The project will treat an outside reproducible run as independent witness evidence, separate from Kindred-operated cloud tests.
