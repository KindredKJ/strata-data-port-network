# Verification status — 2026-09-23

This repository contains imported candidate source and inherited historical receipts. Source import establishes presence and provenance; it does not establish clean checkout test success, deployed operation, zero-copy transport, or independent review.

## Imported commits

- Python Strata network and contracts: `1cd44b93c2bc1f924fbda5f7717ec491ec590aeb` from open Superstructure PR #3.
- Unified Quad / Direct Pipe: `999bf2c51da3d014d71150e2295287128a57e63a` from open Superstructure PR #5.

The authoritative source is `KindredKJ/kindred-labs-superstructure`. Candidate snapshots retain their original relative paths under separate roots. [The manifest](../lineage/source-manifest.json) lists every imported file and its original Git blob SHA-1. No historical receipt has been regenerated during import.

## Reproducible checks

At repository commit `29c12dac1ca352df327f2ea25df34198d96778cc`, [GitHub Actions run 35884929707](https://github.com/KindredKJ/strata-data-port-network/actions/runs/35884929707) completed successfully with both jobs:

- Python 3.12: contract generator `--check` and standard-library `unittest` candidate suite (60 tests locally).
- Node 24: focused `direct-pipe-runtime.v1.test.mjs` with evidence written to the runner's temporary directory.

The same checks passed in a clean local clone with Python 3.12.14 and Node 24.19.0. The focused Node test first failed without `KINDRED_DIRECT_PIPE_EVIDENCE`; rerunning it with a temporary output path passed. The broader Unified Quad suite is still outside this passing gate.

## Scope and limits

On 2026-09-24, the new SW06-E worker transfer candidate passed three local Node 24 tests: source detachment and digest integrity, input boundary rejection, and capacity/close behavior. `npm run measure` completed 16 transfers of 4 MiB per path and printed a machine-specific JSON result. The buffered baseline counted one explicit payload copy per transfer; the worker transfer counted zero explicit JavaScript payload copies while confirming detachment and matching digests. This is a local worker-thread boundary result, not proof of zero physical copies, a second device, or production operation. See [SW06-E](SW06-E-WORKER-TRANSFER.md). GitHub Actions will independently check the committed version.

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
