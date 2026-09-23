# Verification status — 2026-09-23

This repository contains imported candidate source and inherited historical receipts. Source import establishes presence and provenance; it does not establish clean checkout test success, deployed operation, zero-copy transport, or independent review.

## Imported commits

- Python Strata network and contracts: `1cd44b93c2bc1f924fbda5f7717ec491ec590aeb` from open Superstructure PR #3.
- Unified Quad / Direct Pipe: `999bf2c51da3d014d71150e2295287128a57e63a` from open Superstructure PR #5.

The authoritative source is `KindredKJ/kindred-labs-superstructure`. Candidate snapshots retain their original relative paths under separate roots. [The manifest](../lineage/source-manifest.json) lists every imported file and its original Git blob SHA-1. No historical receipt has been regenerated during import.

## Scope and limits

PR #5 reports a portable buffered Direct Pipe result and expressly leaves reduced-copy and zero-copy unproven. Its review identified missing versioned schemas, helper files discovered as tests, unconfigured evidence output paths, writes to tracked historical receipts, workstation-specific absolute paths, and security or correctness issues in mandate validation, authorization, consent, activation plans, event integrity, state concurrency, fencing and process metrics. Those findings require reproduction and repairs.

PR #3 provides a separate Python control plane and Strata network candidate. It has not been merged with PR #5 or verified together as one system. The import does not verify a physical two-machine network result, ZPS SW03 reconstruction hardening, or local-only machine changes outside the two pinned Git commits.

## Promotion gates

1. Run the Python contract generator and tests in a clean checkout.
2. Repair the full Unified Quad suite without overwriting historical receipts; run it in a clean checkout.
3. Validate authorization and consent boundaries with negative tests before external actuation.
4. Resolve overlapping port and transport contracts while preserving Port Zero's authority.
5. Compare source files to the pinned Git blob IDs and record fresh test receipts at the promoted commit.
6. Measure any reduced-copy or zero-copy claim with source detachment or equivalent ownership proof, worker integrity checks, copy counts, and a reproducible baseline.
7. Verify the intended two-device boundary, recovery behavior, security properties and supported platform set before a production claim.

Historical source records may contain workstation-specific paths. They are retained for exact lineage and are not portable commands.
