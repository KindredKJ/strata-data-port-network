# Kindred Recovery Proof #001

**Checkpoint:** 2026-10-28T02:21:57.988Z  
**Resume:** 2026-10-28T02:23:31.946Z

This bundle preserves the first externally verified Kindred recovery across a deliberately forced Render process replacement.

## Procedure

1. An independent Vercel sandbox requested a bounded recovery checkpoint from the Render-hosted Unified Quad runtime.
2. Render boot `boot-ab405d54-08e0-4cb9-b7dd-1bb521701cca` validated the job input and sealed it into an authenticated encrypted recovery capsule.
3. The independent client retained the opaque capsule outside Render. Capsule SHA-256: `1ce112f769af2aa3b046a3b7dad562895a73d2d1891658000bb4d249f232cbff`.
4. Render deployment `dep-dbglol0n74is73cr9350` was deliberately triggered against the same source commit `6735cf2ef2ec82698e845f25a8b9a94c790040b7`, replacing the source process.
5. The new process reported boot `boot-fad28493-7d47-4ce0-b857-72ea89b5709e`.
6. The independent client submitted the exact saved capsule to the new boot.
7. The new boot authenticated/decrypted the capsule, reproduced the checkpoint input hash, resumed the bounded operation, transferred the new canonical state to Strata, and verified the returned Ed25519 receipt.
8. The independent client separately checked capsule continuity, boot replacement, input continuity, receipt signature, pinned key, transport authentication and state integrity. All 18 checks passed.

## Evidence classification

**VERIFIED_EXTERNAL_FORCED_REDEPLOY_RECOVERY**

This proves recovery of the bounded proof job across a deliberate Render deployment/process replacement using a sealed state capsule retained outside the source process.

It does **not** prove:

- abrupt process kill at an arbitrary instruction,
- physical power interruption,
- automatic failover without an external recovery trigger,
- a second physical machine attestation,
- Zero Point physical zero-copy transport,
- wider-stack production readiness,
- customer/commercial use.

Those remain separate evidence gates.

## Files

- `recovery.summary.json` — normalized recovery facts and maturity limits.
- `receipt.envelope.json` — signed post-recovery Strata receipt.
- `verify.txt` — independent third-environment verification output.

The private recovery secret and plaintext capsule state are deliberately not published.
