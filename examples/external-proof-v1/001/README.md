# Kindred External Proof #001

**Observed:** 2026-10-28T02:15:17.165Z

This bundle preserves the first completed Kindred External Proof v1 cross-provider receipt.

## Path exercised

1. An independent Vercel sandbox in `iad1` submitted a public `HASH_TEXT` job.
2. The source runtime was `kindred-external-proof-canary.onrender.com` on Render, logical identity `genesis-render-node-a`.
3. The source runtime executed the bounded deterministic operation, canonicalized the job state and bound it to SHA-256 `5ca869c0b666c8c9b5621e368a226b69042f97e421b8f723207812b1f1e4bb15`.
4. The source runtime requested a short-lived Strata challenge, encrypted the 951-byte canonical state with challenge-derived AES-256-GCM material, and transferred it over HTTPS.
5. Production Strata on Vercel, logical identity `strata-vercel-node-b`, authenticated and decrypted the payload, reproduced the same SHA-256, and emitted an Ed25519-signed receipt.
6. The Render source verified the pinned Strata signing key and signature before returning HTTP 201.
7. The independent Vercel client separately verified the saved envelope against the committed public key. All twelve verification checks passed.

## Bound evidence

- Source service: Render canary `srv-dbglh1ec6qcc73c14gjg`
- Source deployment: `dep-dbglkkmc6qcc73c1frjg`
- Source code branch: private Genesis external-proof feature branch
- Destination provider: Vercel
- Destination deployment: `dpl_Djfya8BHBfu77WoypyqPZyEK8BAV`
- Destination commit: `85581c46f8ac14d1fcebb8ba1b4308bf0764a6bc`
- External client: restricted Vercel sandbox in `iad1`
- State ID: `proof-job-3c1bcfd4-91f0-454a-8f4d-c7e9c41b9fd2`
- State SHA-256: `5ca869c0b666c8c9b5621e368a226b69042f97e421b8f723207812b1f1e4bb15`
- Receipt signing key ID: `9cccc27fedfbdb987a3f2f442c550ee4c9978f1a29bc017831f81ff4d4439dd5`

## Evidence classification

This establishes **VERIFIED_EXTERNAL cross-provider execution evidence** for the bounded proof path: an independent caller reached a Render-hosted Kindred runtime, a deterministic state was produced, the state was authenticated/encrypted and transferred to production Strata on Vercel, Strata verified the state and signed a receipt, and a third environment independently verified that receipt.

It does **not** establish:

- forced process/VM failure recovery,
- physical-machine attestation,
- zero-copy physical transport,
- global SDPN reach,
- production readiness of the wider Kindred stack,
- commercial use or customer adoption,
- financial settlement,
- blockchain/mainnet execution.

Those remain separate evidence gates.

## Verify

The signed envelope is `receipt.envelope.json`. The public key is already committed at `public/proof-public-key.pem`.

Run:

```bash
node scripts/verify-external-receipt.mjs \
  --receipt examples/external-proof-v1/001/receipt.envelope.json
```

Expected result: every verifier line reports `PASS`.
