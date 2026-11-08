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

## Browser Workspace v1

The [browser workspace](https://stratadataportnetwork.vercel.app/app.html) is an additive, general-public file handoff: seal a file up to 16 MiB with a unique passphrase, move the resulting `.strata` package using a channel of your choice, then open and verify it in another browser. It uses Web Crypto AES-256-GCM, PBKDF2-SHA256 (310,000 iterations), and SHA-256 integrity checks. File bytes, filename, and passphrase are processed locally; the package contains encrypted data and public cryptographic parameters. No account or founder credential is required. Run `node test/browser-package.test.mjs` for the focused package checks.

This is **PORTABLE_BUFFERED_ENCRYPTED_PACKAGE** execution, not a live Strata network transfer. The site does not upload, host, or deliver packages. It has no remote revocation after a recipient possesses the package and passphrase. Keep the passphrase in a separate channel. It does not establish Port Zero production authorization, SW02/SW06-F two-physical-machine proof, or ZPS SW03 completion.

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

The current founder master directive requires **cryptographic native port identity,
no IP addresses or conventional routing in the logical protocol**, mandatory Tesseract
state engines and bound AI workers, and explicit communications substrates. Strata
Cloud is optional. Global availability remains an unproven production gate.
See [SW09 native materialization and Strata Cloud coordination](docs/SW09-NATIVE-NO-IP-MATERIALIZATION.md).
The [master directive reconciliation](docs/MASTER-ARCHITECTURE-RECONCILIATION-2026-10-13.md)
contains the complete component/sequence diagrams, inspected inventory and production gates.
Existing TCP/IP candidates may supply explicitly disclosed underlying adapters;
they do not establish elimination of routing on that substrate.
The new direct non-IP ZPS candidate is retained in the canonical private Superstructure;
its same-host proof does not establish global reach or a production native network.

The inherited SW06 baseline reports **PORTABLE_BUFFERED** transport. SW06-E adds a locally tested **REDUCED_COPY** worker ownership boundary. It does not establish physical **ZERO_COPY**, two-machine transport, or production readiness. See [verification status](docs/VERIFICATION.md).

For the next two-physical-machine performance gate, use the additive [SW06-F encrypted application-goodput benchmark](docs/SW06-F-PHYSICAL-HOST-BENCHMARK.md). It records p50/p95 latency, goodput and verified per-transfer receipts, but cannot itself attest distinct physical machines or production readiness.

The next engineering gate is to repair the source test and authorization findings, reconcile the two candidate interfaces, and publish reproducible results tied to exact commits. No public service, wallet, financial transaction or production deployment is started by this repository.

## Rights and security

Copyright © 2026 Kindred Jermaine Cox and Kindred Labs. [LICENSE.md](LICENSE.md) distinguishes the **Apache-2.0 open-source `community/` distribution** from the separately proprietary remainder of the repository. Repository visibility alone does not grant permission to use the proprietary source. Please avoid putting secrets or private data into issues. Use GitHub private vulnerability reporting if available.

## Standalone static workspace (no hosting provider)

SDPN's existing encrypted browser workspace has a provider-independent, dependency-free Node.js host:

```bash
node scripts/serve-standalone.mjs
# http://127.0.0.1:8787/ and /app.html
node --test test/standalone-host.test.mjs
```

This serves static files only; it does **not** launch the native distributed protocol, establish a physical zero-copy transfer, or publish an authenticated Internet API. Vercel is an optional existing publication surface, not an SDPN runtime prerequisite. Project Genesis and `kindredlabs.ai` are not required to launch the standalone host. See [independence, security boundaries, Windows instructions and optional ChatGPT/Kindred AI adapters](docs/STANDALONE-INDEPENDENCE-AND-INTEGRATION.md).

## PORT/1 — SDPN-native `port://` addresses

SDPN now has a self-certifying, Ed25519-signed **custom URI overlay** and local founder-owned namespace issuer. This is independent of the Project Genesis DNS configuration; it does not require Vercel or Cloudflare. Native `port://` addresses have operator-signed domains and subdomains, real revision/expiry/revocation checks and explicit target Port Zero identifiers; **they do not grant remote access or replace Internet HTTPS**.

```bash
node scripts/port-domain.mjs init
node scripts/port-domain.mjs renew
```

On Windows, register the custom URI handler explicitly with `scripts/Install-SDPNPortProtocol.ps1`. INTERCONNECT Linux can independently verify a generated `port://` name against the local manifest using `--port-uri` and `--port-manifest`, displaying a secure offline status view. **Read the full installation, security and integration contract in [PORT/1 native naming](docs/PORT-URI-AND-NATIVE-NAMES.md).**

## PORTAL/1 — search, practical local AI and owned PORT websites

[Founder's complete PORTAL release and runbook](docs/PORTAL-FOUNDERS-RELEASE.md)

PORTAL is an independent, dependency-free Node.js user-facing application with real first-party SDPN document search, guided local AI model access (if a compatible local model is actually running), and durable user-created web pages. An authorized local operator can sign a saved site as a `port://` alias and open it as a real offline native website inside INTERCONNECT. It never silently uploads files, transfers keys, activates network authority or claims global web search.

```bash
node apps/portal/server.mjs
# Open http://127.0.0.1:8790
node --test apps/portal/test/*.test.mjs
```

The local native service requires neither a Vercel/Cloudflare deployment nor the Genesis domain. Creating a worldwide alternative discovery network and monetized managed PORT platform is an explicit future production program, not a current deployment claim.

## Founder Port Zero / numbered registry (candidate)

The [additive founder-anchored numbered port registry](docs/FOUNDER-PORT-ZERO-NUMBERED-REGISTRY.md) reserves numeric **Port 0** for the explicitly pinned founder signing key and assigns Port 1, 2, 3, ... to independent cryptographic identities. It includes a local, durable, single-writer CLI and signed short-lived Tesseract presence records. Existing Port IDs, signed sessions, transport adapters, and Port Zero policy remain unchanged. This is **not** an online global presence service or proof of physically route-free transmission; adapters must disclose actual IP/routing dependencies.

## Tesseract split-plane, strict non-routed reference materialization (candidate)

The [split-plane architecture and executable reference tests](docs/TESSERACT-SPLIT-PLANE-REFERENCE-MATERIALIZATION.md) make each destination port responsible for reconstruction using its own **pre-existing** content-addressed state. Port A sends signed *hash/reference-only* control messages, and Port B returns a signed exact-reconstruction receipt. This strict candidate rejects disclosed IP/routed adapters, does not transport object bytes, and cannot reconstruct unknown remote bytes from hashes alone. **It is not a global networking or new-data teleportation proof.** The package also exposes per-port regular/admin authority checks and a declared direct-hardware-driver boundary; physical radio connectivity and global reachability still require independent qualification.

## Automatic native host assimilation (installer candidate)

A new Port can [assimilate the installed machine](docs/NATIVE-MACHINE-ASSIMILATION.md) into a **private, local-only** capability catalog. It detects OS-visible disks, software, executable utilities, services and hardware classes. The existing Windows `port://` installer now invokes assimilation automatically; other SDPN installers can call `npm run port:install`, with `npm run port:assimilate` to refresh the catalog. Actual utility execution requires the Port's local **admin** role, OS permissions and a selected executable allowlist. Discovery does **not** transfer files, establish remote access, use IP routing, create Port 0 founder credentials or prove global network connectivity.

## SDPN/2 full-stack plan + PRESENCE/1 (candidate)

The [SDPN next-generation 17-layer engineering charter](docs/SDPN-NEXT-GENERATION-STACK.md) sets an executable program for better device integration, identity, coordination, native state reconstruction, storage, computation, applications, operations, and commercial services with measurable benchmarks. **Port 0 stays founder-exclusive**. The initial **PRESENCE/1** cryptographic challenge/response module (`src/port-presence-proof.mjs`) verifies an exact registered Port's signed presence response with replay tracking and rejects routed/IP adapter descriptors in STRICT mode. It transports **no payload** and **does not yet establish global reachability or physical route-free transmission**. Test with `npm run port:presence:test`.

## Tesseract CDC/1 — content-defined, lossless delta reconstruction (candidate)

The [new CDC/1 delta engine](docs/TESSERACT-CDC-DELTA-V1.md) builds deterministic SHA-256-verifiable content-defined chunks so destination Ports can reuse pre-existing state and acquire only **missing information** over an explicitly disclosed, authorized carrier. It is not a claim that unknown bytes teleport, or that local tests prove global routing-free delivery. The `npm run cdc:benchmark` command measures real in-process logical payload bytes against full-file and fixed 64 KiB-block baselines. The `npm run cdc:test` command covers exactness, shifted insertions, deduplication, corruption, unavailable state, and strict rejection of routed/IP adapter descriptors.

## ZPS/CAS-v1 — Durable encrypted Port reconstruction + signed receipt (candidate)

The [ZPS persistent reconstruction module](docs/ZPS-DURABLE-CAS-SIGNED-RECEIPTS.md) adds a local, Port-owned AES-256-GCM content-addressed chunk store, immutable file writes, bounded encrypted disk quota, exact state publication, and reopen/reconstruction tests. The destination Port signs its completed CDC/1 encrypted-session reconstruction and storage publication; both Port records and the original signed state/session offer are independently checked. Use `npm run zps:test` and `npm run zps:benchmark` for real filesystem-backed local verification. This is **not** physical power-loss qualification, verified two-device delivery, canonical historical ZPS integration, or proof of worldwide routing-free transport. Port 0 remains founder-exclusive.

## Tesseract MORPH/1 — Signed state algebra and encrypted 173-byte updates (candidate)

The [MORPH/1 state transformation architecture](docs/TESSERACT-MORPH-STATE-ALGEBRA.md) turns an already-verified old state into its exact new version by transmitting **only the new binary edit span** through the existing encrypted native Port session. Signed cryptographic coordination contains hashes, offsets and the destination identity—not payload bytes. Port B reconstructs from its own prior encrypted ZPS state, verifies SHA-256, persists the result and signs completion. A reproducible matched benchmark compares MORPH/1 against CDC/1, fixed-block and full-file logical payloads; `npm run morph:test` and `npm run morph:benchmark`. Missing old state or edits exceeding the single-splice 256 KiB budget require another qualified transport mode. This is **not** a worldwide physically route-free delivery proof.

## Community SDPN — free-to-use, open-source foundation

SDPN now includes an independently distributable and usable [**Apache-2.0 Community SDK**](community/README.md). Anyone can generate/export/import a portable Ed25519 Port Zero identity, sign and resolve PORT/1-compatible aliases, and use or modify the Apache-licensed community code commercially without purchasing a subscription. Its module code has no private-runtime or cloud-service dependencies. [Founder governance and commercial boundary](docs/OPEN-CORE-FOUNDER-GOVERNANCE.md) define user-owned identity, optional managed services, and a clear distinction between features implemented today and free future network modules.

```bash
node --test community/test/*.test.mjs
node --test test/community-interop.test.mjs
node apps/portal/server.mjs
# Inspect GET http://127.0.0.1:8790/api/plans
```

**Precise licensing:** only `community/` is newly open-source by this change. Other files in this repository, including preserved imported candidates, retain their own licenses and attribution until the necessary rights review and explicit further relicensing. A free protocol does not make electricity, public Internet access, hardware, or managed hosted AI free. Commercial Creator/Business/Enterprise tiers are cataloged as *planned*, not purchasable or activated. The full network and global discovery infrastructure remain separate release gates.
