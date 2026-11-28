# Cross-Provider Recovery Proof #001

**Observed:** 2026-10-28T02:37:42.662Z  
**Independently verified:** 2026-10-28T16:51:10Z  
**Verifier runtime:** Node.js v24.22.1, isolated workspace outside Render and Vercel

The signed envelope records one bounded `HASH_TEXT` recovery on the production Strata Vercel deployment. It identifies the same Recovery #001 capsule preserved in `../recovery-001/recovery.summary.json`, the original Render source node and boot, and the distinct logical Vercel recovery node.

## Independent verification

The verifier checks the envelope signature against the repository-pinned Ed25519 public key. It compares the capsule and recovered input hashes to the separately preserved Recovery #001 summary, and recomputes the output hash from the signed output object using canonical bytes.

All 16 checks passed in the third environment. The captured output is in `verify.txt`.

Run it from the repository root:

```sh
node scripts/verify-cross-provider-recovery.mjs \
  --envelope examples/external-proof-v1/cross-provider-recovery-001/recovery.envelope.json \
  --expected-evidence examples/external-proof-v1/recovery-001/recovery.summary.json
```

The public key defaults to `public/proof-public-key.pem`. The verifier does not require or publish the capsule plaintext, recovery secret, or private signing key.

## Proven scope

This verifies one preserved Render capsule was reported as executed on the distinct Vercel recovery node for the bounded `HASH_TEXT` operation, with matching checkpoint input hash and recomputed output hash.

It does not prove automatic failover, abrupt termination or power-loss recovery, physical-machine attestation, physical zero-copy transport, wider SDPN production readiness, or commercial/customer use. Those claims remain false.

## Record

- Recovery ID: `recovery-0c26b65a-7095-49e6-a256-ec5d33ed276c`
- Capsule SHA-256: `1ce112f769af2aa3b046a3b7dad562895a73d2d1891658000bb4d249f232cbff`
- Validated input SHA-256: `78d26e8d56089c6d07c0648897990dd9eb8370079341af8e5436f85cd8849b76`
- Recomputed output SHA-256: `50096515f6071b3812ee4b5d60189aca39aa4bfd839530485a4abcb5fd947432`
- Vercel production deployment: `dpl_HsjgbaDu7Dgo6eJGD1qMVtTPPX21`
- Production commit: `f4712945f5c40a91ea860cb386ca5beb8b169e59`
