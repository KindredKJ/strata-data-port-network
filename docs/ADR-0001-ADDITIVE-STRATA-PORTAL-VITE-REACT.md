# ADR 0001: Additive Vite + React Strata Portal

- **Status:** Proposed for review (architecture decision; no runtime or production activation)
- **Date:** 2026-10-09
- **Owner:** Kindred Labs
- **Primary system:** Strata Data Port Network (SDPN)
- **Related systems:** StrataCast, AI Crawl, Kindred Root, Kindred Labs Superstructure, Kindred Genesis, K1 Assistant, Kindred Cloud, Kindred WATT

## Decision

Adopt **Vite + React + TypeScript for a new, opt-in Strata Portal browser application**. The portal is an additive **presentation, developer-experience, and observability** layer. It does **not** replace the currently deployed/static `public/app.html` encryption workspace, the Python Port Zero/control plane, the Unified Quad/Direct Pipe candidates, the Kindred state-port contract, the native Unreal runtime, or any current deployment provider.

Vite is a build/development tool, React is an interactive UI library. **Neither is a data transport, device attestation system, authorization authority, nor evidence of zero-copy transfer.** All security decisions and external effects remain enforced by backend services. Existing APIs, receipts, cryptography, and release gates remain authoritative.

## Observed repository facts at decision time

- SDPN `public/app.html` and `public/app-core.mjs`: a 16 MiB local AES-256-GCM encrypted-package workflow, with `connect-src 'none'` CSP for `/app.html`; it cannot upload or transmit packages through a remote network. Preserve this unchanged.
- SDPN `src/direct-pipe-worker-transfer.mjs` and `scripts/measure-worker-transfer.mjs`: local, Node worker ownership-transfer candidate, classified **REDUCED_COPY**; no proof of physical zero-copy.
- SDPN `docs/SW06-F-TWO-HOST-PROOF.md`: two-host proof harness exists, with explicit independent physical attestation and production gates.
- AI Crawl already uses React and Vite for its web game UI; keep its existing app and navigation.
- StrataCast `apps/genesis-world` already uses Vite 8.1 and Babylon.js; keep its renderer and its separate Unreal C++ plugin/build workflow. Vite/React do not compile Unreal.
- Genesis `apps/web` and `apps/public-web` use React with Next.js; **do not replace Next.js** simply to standardize tooling.
- K1 Assistant `dashboard/package.json` already uses Vite + React; its `latest` dependency ranges should be reviewed for reproducible, lockfile-pinned builds before upgrades.
- Existing `vite-react` repository is a standalone Vite/React candidate; it must not overwrite product-specific applications.
- The SDPN `candidates/` imports retain separate lineage and non-production classifications.

## Architecture and trust boundaries

```text
Web browser
  ├─ Existing /app.html              [unchanged; CSP connect-src 'none']
  └─ New /portal/ (isolated route)   [Vite-built React SPA]
        ├─ Local evidence reader     [user-selected, local only, no upload]
        ├─ Transfer/port observatory [display verified status and provenance]
        ├─ Developer console         [contracts, SDK explorer, diagnostics]
        └─ Authenticated UI client   [disabled until approved API integration]
               │ TLS, scoped identity and capability tokens
               ▼
        Approved server-side API gateway
               │ validates identity, scope, purpose, consent, policy,
               │ replay/idempotency, audit, and per-action authorization
               ▼
        Port Zero authority + existing SDPN adapters
               │
               ├─ Python network candidate
               ├─ Direct Pipe / worker candidate
               └─ Kindred state-port / SW06-F proof machinery
```

**The web application is not an authority.** Client-side controls cannot grant access, bypass consent, issue unilateral port activation, or upgrade a proof classification. Secure APIs are a separately approved workstream; a browser-based developer proxy must never expose local founder credentials.

## Incremental delivery contract

### Phase 0 — isolated, read-only portal

- Implement within `apps/strata-portal/` as an independent, buildable app; no alteration to SDPN root npm scripts, incumbent public routes, package/crypto implementation, or production deployment configuration until isolated tests pass.
- Begin with **local evidence import** using browser File API. Accept a bounded, validated allowlist of SDPN receipt schemas; reject unrecognized or malformed JSON. No arbitrary code evaluation or network calls.
- Display explicit provenance: schema version, source classification, commit/evidence identity if present, measured latency units, observed copy semantics, integrity flags, and limitations. Distinguish **observed evidence**, **unverified claims**, and **unavailable data**; never invent connection or throughput measurements.
- No sensitive data, pairing secrets, passphrases, wallet keys, or whole file payloads in logs, URLs, analytics, telemetry, or browser storage.
- Separate `/portal/` CSP; preserve `/app.html` CSP and crypto workflow exactly. Any initial portal can use `connect-src 'none'` until a vetted read-only gateway is present.
- Include component, accessibility, input-validation, build, and regression checks; ensure deterministic dependencies and lockfile.

### Phase 1 — authenticated read-only network observability

- Only after server-side contracts and access controls are reviewed, add a scoped gateway API for **health, active-capability metadata, consent/audit receipts, and proof status**. Verify authenticated operation end-to-end; avoid exposing private physical topology to unauthenticated users.
- Provide latency, errors, health trends, and validated provenance. Label mock, local, software two-host, hardware-attested, and production-ready categories distinctly.
- Use optional server-sent events or WebSocket telemetry through the gateway with backend authorization, rate limits, bounded buffers, and revocation-aware disconnects; never put bearer tokens into URL query strings.

### Phase 2 — explicitly authorized orchestration

- Initiate **requests** for enrollments, transfers, or revocations only through separately reviewed backend APIs and explicit operator approvals. Require backend authorization, idempotency/replay protection, receipt generation, and auditable failure modes.
- Integrate approved Kindred systems using versioned OpenAPI/event contracts and adapters. Every integration is opt-in and independently reversible.
- Preserve SDPN proof promotion gates (including actual authorized two-host measurement); UI status does not promote experimental code to production.

## Broader Kindred ecosystem integration policy

| Repository/system | Additive opportunity | Preserve |
|---|---|---|
| SDPN | React portal, local proof inspector, then read-only port telemetry | Port Zero; static encrypted-package app; worker/Python protocols |
| AI Crawl | Shared authenticated account/achievements/transfer widgets and story metadata views | Game combat/economy/save authority; existing Vite frontend |
| StrataCast | CinePlay library, render-job status, asset catalog, native proof viewer | Babylon world engine, Unreal pipeline, CinePlay runtime |
| Genesis | Reusable UI components and typed client contracts embedded in existing React/Next surfaces | Next routing, SSR, sessions, service APIs |
| K1 Assistant / Brainstem | Reviewable agent-run timelines, approvals, audit/evidence explorer | Agent orchestration, model runtimes, approval logic |
| Kindred Root / Superstructure | Operator dashboards for verified state/identity/lineage | Python/native runtimes, policies, durable records |
| Kindred WATT / Kindred Cloud | Real-time authorized energy or service-status views, customer dashboards | Physical/provider integrations, billing, activation authority |

**Prefer sharing** accessible design tokens, framework-agnostic typed API schemas, React UI packages, and validated event types. Do not force all 30 repositories into one monorepo, React app, Vite major version, or deployment target. Where Vite is already present, qualify toolchain upgrades with lockfile, unit, integration, and production build evidence; do not mass-update dependency versions.

## Review and promotion gates

1. Independent portal build/tests and read-only evidence-validation tests pass on a clean checkout.
2. Existing SDPN `npm test`, worker measurements, Python candidate checks, and Windows verification gate remain unchanged and pass.
3. CI shows no modified historical manifests/receipts, authorization semantics, crypto code, or published deployment assets without separate review.
4. Security review: CSP, data minimization, authentication, consent, audit and revocation, no key exposure, dependency/lockfile pinning.
5. A preview build is labeled **non-production**; release needs explicit sign-off and deployment smoke tests.
6. Any claim of a live distributed network, physical zero-copy, certified two-host transport, or Unreal-native integration requires its own evidence and does not follow from a successful Vite build.

## Exclusions

No direct deployment, default-route replacement, remote device operation, cross-repo mass migration, change to permission policy, or native runtime refactor is authorized by this ADR. A draft PR records the decision and implementation boundaries only.
