# Kindred Cross-Provider Recovery Proof #001

**Observed:** 2026-10-28T02:37:42.662Z

This evidence reuses the exact sealed checkpoint created earlier on the Render-hosted Genesis/Unified Quad runtime.

## Provenance

Original checkpoint:

- Recovery ID: `recovery-0c26b65a-7095-49e6-a256-ec5d33ed276c`
- Capsule SHA-256: `1ce112f769af2aa3b046a3b7dad562895a73d2d1891658000bb4d249f232cbff`
- Original source node: `genesis-render-node-a`
- Original source boot: `boot-ab405d54-08e0-4cb9-b7dd-1bb521701cca`
- Validated input SHA-256: `78d26e8d56089c6d07c0648897990dd9eb8370079341af8e5436f85cd8849b76`

The capsule was retained outside Render in the independent client environment. It was **not regenerated** for this test.

## Cross-provider recovery

The independent client submitted that unchanged capsule to production Strata on Vercel.

Vercel recovery node:

`strata-vercel-recovery-node-c`

Production Vercel deployment:

`dpl_HsjgbaDu7Dgo6eJGD1qMVtTPPX21`

Commit:

`f4712945f5c40a91ea860cb386ca5beb8b169e59`

The Vercel recovery runtime:

1. validated the capsule envelope digest;
2. authenticated and decrypted the sealed checkpoint;
3. required the embedded source node to equal the configured Render source identity;
4. re-executed only the bounded `HASH_TEXT` operation;
5. reproduced the original validated input hash;
6. produced output hash `50096515f6071b3812ee4b5d60189aca39aa4bfd839530485a4abcb5fd947432`;
7. signed the cross-provider recovery record with the public Kindred External Proof Ed25519 identity.

The independent Vercel client then verified the signed record separately. All 14 checks passed.

## Evidence classification

**VERIFIED_EXTERNAL_CROSS_PROVIDER_RECOVERY**

This establishes that one Render-created sealed checkpoint can be authenticated and resumed on a distinct Vercel recovery runtime.

It does **not** establish:

- automatic failover or automatic outage detection;
- abrupt power-loss recovery;
- physical-machine attestation;
- physical zero-copy transport;
- wider SDPN production readiness;
- commercial/customer use.

## Verify

```bash
node scripts/verify-cross-provider-recovery.mjs \
  --envelope examples/external-proof-v1/cross-provider-recovery-001/recovery.envelope.json
```

No recovery secret or private signing key is published.
