# Strata Data Port Network

**Sole founder and creator: Kindred Jermaine Cox.** Strata Data Port Network is a Kindred Labs project.

[Visit the public launch site](https://stratadataportnetwork.vercel.app) · [Read verification status](docs/VERIFICATION.md)

The Strata Data Port Network is Kindred Labs' research into permissioned data ports, identity-bound device presence, and governed transport across local and distributed environments. This repository contains preserved, separately identified implementation candidates from the Kindred Labs Superstructure. It is a public source repository; the implementation candidates are **not a production release**.

## Source layout

| Path | Origin | What is present |
|---|---|---|
| [`candidates/python-network/`](candidates/python-network/) | Superstructure [PR #3](https://github.com/KindredKJ/kindred-labs-superstructure/pull/3), commit `1cd44b93c2bc1f924fbda5f7717ec491ec590aeb` | Python ports, transport, Strata network, contracts, architecture, tests and readiness records |
| [`candidates/unified-quad-direct-pipe/`](candidates/unified-quad-direct-pipe/) | Superstructure [PR #5](https://github.com/KindredKJ/kindred-labs-superstructure/pull/5), commit `999bf2c51da3d014d71150e2295287128a57e63a` | Unified Quad runtime, Direct Pipe source, tests and historical evidence |
| [`src/direct-pipe-worker-transfer.mjs`](src/direct-pipe-worker-transfer.mjs) | This repository, SW06-E | Worker ownership transfer candidate with source detachment and integrity checks |

Both source pull requests were open and unmerged when imported on 2026-09-23. Their original paths, blob IDs and sizes appear in [`lineage/source-manifest.json`](lineage/source-manifest.json). The candidates have not been reconciled into one default network runtime. The authoritative topology and founder approval record remain in the Superstructure; its historical classification and approval text are not altered by the import.

## Run the imported candidates

The Python candidate requires Python 3.11 or newer. From this repository root:

```bash
cd candidates/python-network
python -m venv .venv
. .venv/bin/activate
python -m pip install -e . pytest
python scripts/generate_contracts.py --check
python -m pytest -q
```

The Direct Pipe candidate requires Node.js 22 or newer. Its source and focused test may be run from its own package root:

```bash
cd candidates/unified-quad-direct-pipe/runtime/unified-quad
KINDRED_DIRECT_PIPE_EVIDENCE=/tmp/strata-buffered-evidence.json node --test test/direct-pipe-runtime.v1.test.mjs
```

For the newer worker boundary, run `npm test` and `npm run measure` from the repository root. See [SW06-E design and limits](docs/SW06-E-WORKER-TRANSFER.md).

The full Unified Quad `npm test` command in the source commit has open review findings, including missing versioned schemas, helper discovery, evidence output paths and tracked-evidence writes. Do not treat that suite as a passing gate until repaired. Historical receipts in `evidence/` are inherited records, not proof that the tests ran in this repository.

## Verification and roadmap

The inherited SW06 baseline reports **PORTABLE_BUFFERED** transport. SW06-E adds a locally tested **REDUCED_COPY** worker ownership boundary. It does not establish physical **ZERO_COPY**, two-machine transport, or production readiness. See [verification status](docs/VERIFICATION.md).

The next engineering gate is to repair the source test and authorization findings, reconcile the two candidate interfaces, and publish reproducible results tied to exact commits. No public service, wallet, financial transaction or production deployment is started by this repository.

## Rights and security

Copyright © 2026 Kindred Jermaine Cox and Kindred Labs. All rights reserved. See [LICENSE.md](LICENSE.md). Repository visibility does not grant a license to use, redistribute or deploy the code. Please avoid putting secrets or private data into issues. Use GitHub private vulnerability reporting if available.
