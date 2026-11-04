# ADR 0002 — INTERCONNECT user research and additive SDPN browser perks

- Status: **Proposed for review — not implemented, deployed, merged, or proven**
- Date: 2026-10-10
- Product: **INTERCONNECT**, the independent next-generation browser and search environment for the proposed SDPN Internet
- Authority: SDPN Port Zero and existing backend services retain all authorization and external-effect enforcement
- Relationship: Complements **ADR 0001** (additive SDPN portal). INTERCONNECT is a **separate native browser product**, not a portal replacement and not a mandatory shell for Kindred products.

## Executive decision

Design user-requested improvements as two classes of independently versioned capabilities:

1. **INTERCONNECT-native UX**: conventional web browsing, accessible UI, reader mode, privacy visibility, tabs, profiles, extensions, and visual navigation. These do not need to run in SDPN or require a remote connection.
2. **Optional SDPN interoperable services**: opt-in encrypted state sync, federated search, capability discovery, provenance, event prioritization, resource scheduling signals, and consent-governed agent operations. Each publishes a versioned interface and remains independently disableable.

**Non-negotiable preservation:** no Chromium/Blink/Electron/CEF dependency; no replacement of `public/app.html`, `public/app-core.mjs`, its CSP or crypto; no alterations to Port Zero, Python source candidates, Unified Quad, SW06-E/SW06-F, Kindred State Port, Zero Point, imported lineage, historical receipts, existing public routes, or deployment settings through this proposal. No change of network proof classification, including no unsupported physical zero-copy claim.

**Federated product policy:** other Kindred products keep their own rendering, data ownership, access control, identities, releases and domains. SDPN services are **optional** and cannot become dependencies for unrelated core product functions.

## Research: what people actually request

Evidence is directional; survey audiences, question wording, and sample selection differ. Do not pool percentages or claim population-wide precision.

| Evidence | Findings | Interpretation |
| --- | --- | --- |
| Mozilla Connect feature-priority survey, 2,852 self-selected participants, Sep 2024 | Site-specific settings 57.8%, blocker transparency 51.2%, customizable UI 46.4%, performance controls 45.7%, site-scoped extensions 43.5%, sync 42.7%, side-by-side tabs 42.4% (percentage selecting 'want most' *when shown that item*) | Fine-grained control and intelligible protections outrank novelty for this sample |
| Shift State of Browsing, vendor survey of 1,000 users, reported 2025/2026 | Multiple logins 39%, task organization 34%, notification blocking 31%; app switching and poor performance cause frustration | Prioritize persistent workspaces and minimized interruption; claims are vendor reported |
| Android Authority reader poll, over 2,000 votes, 2026 | Over 42% picked ad-blocking; 22.4% extensions; 19% privacy; 16.3% sync as one indispensable feature | Strong enthusiast demand for mobile blocking and add-ons |
| Gartner US Consumer Community, 377 respondents, June–July 2025 | 53% distrust/lack confidence in AI summaries; 41% report more frustrating AI overviews; 61% want a switch | AI answers must be optional, transparent, and source-attributed |
| Browser Choice Alliance poll, 2,000 US Windows users, Aug 2026 | 86% want primary control of browser selection; 80% support one-click default browser | Respect browser choice and frictionless export/import; industry-advocacy sponsor caveat |
| Reddit r/browsers threads, 2026 | Repeated requests for persistent groups, battery efficiency, mobile extensions, profiles, reliability and durable sync | Qualitative feature discovery, not a representative survey |
| University of Washington 2026 agentic browser study | Some agents create pathways for cross-origin access abuse through prompt injection | Separate web-content trust from agent action authority with deterministic origin boundaries |

Sources:
- https://connect.mozilla.org/t5/discussions/results-from-the-browser-features-survey/m-p/70264
- https://shift.com/blog/the-2026-state-of-browsing-report-is-here/
- https://www.androidauthority.com/browser-feature-absolutely-cant-live-without-poll-results-3667906/
- https://www.gartner.com/en/newsroom/press-releases/2025-09-03-gartner-survey-finds-53-percent-of-consumers-distrust-ai-powered-search-results0
- https://browserchoicealliance.org/the-browser-choice-gap-the-disparity-between-what-users-want-and-what-users-experience/
- https://www.reddit.com/r/browsers/comments/1waurro/i_need_help_finally_settling_on_a_browser/
- https://www.reddit.com/r/browsers/comments/1w9f25o/looking_for_a_batteryfriendly_android_browser/
- https://www.reddit.com/r/browsers/comments/1wg79th/looking_for_a_mobile_browser_that_supports/
- https://agent-security.cs.washington.edu/agentic_browsers_sop.html

## Architecture: browser features versus SDPN perks

```text
INTERCONNECT (independent native Rust application; non-Chromium)
  |- Accessible conventional Surface UI / profiles / tabs / workspaces
  |- Optional Spatial UI / GPU resource visualization
  |- Independent web engine adapter; web compatibility separately verified
  |- Local privacy and content filtering; per-origin permissions
  |- Traditional search | evidence-backed AI search | approved actions
  |- Local offline-first index; opt-in extension sandbox
  |
  +-- opt-in, authenticated, revocable SDPN client adapter
        |- Discovery v1: discover capabilities and resource metadata
        |- Search v1: federated permission-filtered query and provenance
        |- State v1: reference/verified checkpoint resolution
        |- Sync v1: client-side encrypted workspace metadata and recovery
        |- Events v1: priority-aware notifications and interruption budgets
        |- AgentIntent v1: narrow delegated capabilities and receipts
        +-- Port Zero: independent authoritative validation and revocation

Other Kindred apps -- optional integration contracts only
```

**Engine policy:** INTERCONNECT does not incorporate Chromium, Blink, Electron or CEF. Servo may be evaluated as an independent webpage engine adapter, but cannot be treated as a confirmed complete compatibility solution; establish a current engine matrix and web-platform-test results before commitment. Native SDPN resource rendering never depends on a webpage engine.

**Addressing policy:** `sdpn://` is a *proposed* logical address syntax, not a shipped or registered URI handler. Any deployment requires formal parsing, resource identity, versioning, replay prevention, resolution failure behavior, and safe handoff into Port Zero.

**Privacy boundaries:** querying an authorized remote port is NOT equivalent to being logged into the browser. Never send local history, typed URLs, personal files, wallet keys, passphrases or private indexed content to network search by default. No all-access agent tokens; backend enforcement at *discovery, retrieval, ranking, and execution*, not merely visual hiding of results.

## Priority capability program

Machine-readable feature specifications are in `docs/interconnect-feature-register.v1.json`.

### P0 — browser parity and user trust

1. **Site controls and privacy ledger:** understandable per-origin permissions, tracking decisions, clear-on-exit, isolated site state, per-site exceptions with expiration. Local browser enforcement; SDPN can publish optional privacy-policy metadata only.
2. **Predictable performance:** bounded tab suspension, protected active media/forms, adaptive GPU effects, memory/energy diagnostics, deterministic restore. Export only user-consented aggregate device capacity to SDPN schedulers.
3. **Durable workspaces:** groups, vertical tabs, pinned project contexts, session recovery, profile-specific history and search, import/export. Use verified state references for optional network recovery; do not equate a restored tab list with proof of remote state correctness.
4. **Search source control:** three modes, explicit **web links**, **cited AI research**, and **approved agent tasks**. Provide visible source dates, conflicting findings and provenance; never quietly substitute generated text for primary documents.
5. **AI master switch and agent firewall:** all intelligence features independently off-able. Read-only tools first. Explicit capability grant, origin scoping, quota, purpose, expiry, revocation, audit, idempotency and approval of external effects.
6. **Portable accessible interface:** keyboard first, contrast and reduced motion, reader mode, screen reader structure, text scaling, zoom, customizable toolbar and split view. Render spatial mode as an enhancement, not as the only path.
7. **Engine reliability:** compatibility matrix, secure process isolation, TLS/certificate handling, popup/download controls, update and sandbox policy, web-platform-tests, WebDriver BiDi conformance where supported, and a functional login/media/site smoke suite. Do not call a native shell a production browser without these gates.

### P1 — SDPN reusable network perks

8. **Encrypted sync and handoff:** end-to-end encrypted client-owned bookmarks/workspaces/preferences; devices enrolled explicitly, selective data categories, visible device list and per-device revocation. Recovery/replay tests; no insecure key escrow.
9. **Federated semantic + keyword + graph search:** independently permissioned connectors, query routing, rank-with-provenance, ACL checks at every stage, index freshness/eviction, bounded caching, accessible no-AI fallback. Public-web index and crawling are a separate costly workstream, not already supplied by SDPN.
10. **Notification QoS and interruption control:** global/user-defined quiet modes plus per-source priority and burst bounds. Do not bypass OS emergency accessibility features; no delivery claims without receipts.
11. **Extension capability isolation:** non-Chromium extension API subset only if tested; signed packages, per-origin opt-in access, per-operation permissions, runtime limits and untrusted-extension confinement. Do not claim full Chrome Web Store compatibility.
12. **Offline-first resilient state:** local navigation and index access remain usable when SDPN is disconnected; verified checkpoint restore and explicit conflict reconciliation once reconnected; never classify local snapshots as certified network state.

### P2 — genuinely new internet features

13. **Native capability navigation:** query and navigate authenticated identities, resources, agents, services and live state via Port Zero-resolved SDPN names.
14. **Spatial Knowledge Universe:** optional GPU 2D/3D relationship graph; preserve accessible Surface fallback and performance guardrails.
15. **Near-data computing and result references:** secure sandboxed workload placement, consent, verifiable provenance and selective transfers. Do not assert actual physical zero-copy without proof.
16. **Opt-in federated collaboration:** share a bounded verified resource or workspace snapshot, not an automatically shared browsing history.

## Proposed interfaces (names only; NOT operational APIs)

All SDPN service API versions must be independently reviewed. Anticipated envelopes:
- `sdpn.discovery.v1`: resource ID, signed origin, capability descriptor, policy version, expiration, proof class
- `sdpn.search.v1`: query scope, permitted corpus IDs, result provenance, ACL decision ref, index timestamp
- `sdpn.state-sync.v1`: device identity, encrypted client blob, version vector, hash, revocation epoch
- `sdpn.event-qos.v1`: event ID, priority class, tenant, TTL, dedupe key, recipient policy
- `sdpn.agent-intent.v1`: explicit intent ID, origin allowlist, allowed methods/resources, cost/time limits, approval and durable receipt
- `sdpn.ux-preferences.v1`: locally owned UI settings, export/import, opt-in sync metadata; no private content in telemetry

Each interface requires a typed schema, threat model, negative tests, scope/tenancy enforcement, migration strategy and a documented offline failure mode **before** runtime activation.

## Sequencing and release gates

- **Gate A, specification/registry:** draft-only addition, source links, review, conflicts resolved against ADR 0001 and open SDPN PRs; no production effects. THIS PROPOSAL IS GATE A.
- **Gate B, independent browser vertical slice:** native non-Chromium shell, accessible basic web browsing, local profiles, site controls, tab recovery and tests; engine security and compatibility explicitly measured.
- **Gate C, optional network read-only:** Port Zero-backed discovery and federated search with scoped identity, consent, rate limits, ACL-negative tests, no secret leakage, revocation, and disconnected behavior; no broad agent actuation.
- **Gate D, secure sync and orchestration:** cross-device tests, local encryption/recovery, replay/rollback tests, independent agent approval receipts, malicious-page prompt-injection testing, explicit opt-in.
- **Gate E, spatial and distributed capability proof:** GPU and accessibility evaluation, two-physical-host evidence tied to exact commits, correctness/latency/energy baselines and tested fallback.
- **Gate F, product release:** browser compatibility/sandbox/security review, installation/uninstall, update supply chain, crash recovery, P95/power regression budgets, multi-platform smoke tests and enterprise governance review.

**Performance targets are hypotheses until measured:** browser UI 60 FPS on a defined baseline, indexed local search P95 <250 ms over a defined 100k-document corpus, background idle CPU and battery budgets measured on reference hardware. Publish reproducible receipts, not promises of superiority.

**Backwards-compatibility gates:** root `npm test`, existing candidate Python contract/tests, Direct Pipe worker tests and measurements must pass with fresh evidence; no change to incumbent crypto, ports, routes or CSP in this workstream; all network capabilities require a flag and consent; existing clients continue unchanged without INTERCONNECT installed.

## Out of scope of this ADR

No website crawling deployment, app store release, revenue claim, new token economy, proof promotion, automatic sync of browsing history, privacy-invading monetization, network enrollment, production agent action, device remote control or migration of existing Kindred products. Implementation tasks shall be reviewed and merged separately from this research proposal.
