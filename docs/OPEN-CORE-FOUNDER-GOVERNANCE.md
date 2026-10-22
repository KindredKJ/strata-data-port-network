# Founder governance — free SDPN network and optional managed services

**Decision date:** October 2026  
**Founder and original SDPN project creator:** Kindred Jermaine Cox  
**Company:** Kindred Labs  
**Status:** Implemented initial separately licensed SDPN Community SDK; wider system open-source migration **not complete**.

## 1. Free by design

SDPN's public network **protocol** must be as generally accessible as Internet protocols: no fee to implement a compliant client, create and control an Ed25519 Port identity, use signed Port names, exchange signed metadata, self-host compatible nodes, discover consenting peers, establish authorized sessions or transmit over one's own available connectivity. The software grant for `community/` is Apache-2.0.

Open-source software is not free Internet access or free hardware. Electricity, endpoint devices, paid ISP links, leased addresses, optional compute and off-site redundancy can cost money. A compatible self-hosted alternative must always remain possible without Kindred Labs' managed platform.

No account, subscription, payment, token, centralized identity custody, blockchain wallet, Kindred Genesis DNS, Strata Cloud availability, hosted AI, or proprietary commercial API is a prerequisite for using the **open-source SDK's implemented functions**.

## 2. Open-source license and historical boundaries

The source in `community/` is a new independently distributable Apache-2.0 component with its own [LICENSE](../community/LICENSE), [NOTICE](../community/NOTICE), package metadata and tests. It deliberately does not import or bundle proprietary sources. It emits an on-wire signed namespace compatible with SDPN PORT/1, checked by a separate repository integration test.

The original `LICENSE.md` restricted the rest of the repository. That restriction remains in effect for sources **outside** `community/` unless another file-specific license applies. Imported Superstructure, candidate Python and other source may carry separate restrictive licenses. Release of their existing code under Apache-2.0 requires validation of all authors' rights, third-party dependencies and upstream provenance first. **A public GitHub repository alone does not make its contents open source.**

Proposed licensing target after the audit: promote genuinely reusable identity, transport adapters, protocol clients and SDKs into the community distribution with an OSI-approved license, or freshly develop replacements with appropriate contributor permission. Keep paid hosting operation, contracted SLAs, internal infrastructure, secrets, consumer data and unreleased proprietary applications separate. Do not falsely call the entire SDPN repository fully open source until each path is actually licensed.

## 3. What founders, creators and users own

- **Kindred Labs' organization and brand:** Independent of the copyright license. Apache-2.0 does not transfer the founder's company equity, legal identity, product trademarks, domain registrations, or platform accounts. Brand licensing remains separate and subject to relevant trademark law.
- **Community users:** May generate and hold their own cryptographic keys, form their own PORT namespaces and participate without asking Kindred Labs for payment. Keys identify cryptographic control, **not** an independently verified natural person, a registered business or ownership of an Internet TLD.
- **PORT site creators:** Own their original submissions subject to third-party IP constraints. A managed host receives only the contractually required right to store, serve and remove content, not ownership of an entire identity.
- **Portability and exit:** Supported format exports, customer-controlled keys, independent resolution, usable backups and predictable cancellation must remain goals. A customer should not lose their Port identifier for refusing an upgrade.
- **Identity verification:** Voluntary, evidence-backed person and organization verification may be offered as an optional service. Verification tiers cannot be used to misstate who someone is or convert a personal key into a legal identity claim.
- **Competition:** Open-source recipients can commercially use/fork the licensed code. The commercial advantage must be superior operations and customer experience rather than pretending open software can be exclusively controlled.

## 4. Economic separation

| Product category | Software/network cost | Service available now? | Revenue path |
|---|---|---|---|
| SDPN Community | Free Apache-2.0 SDK, no payment needed | New identity and signed-name SDK code, tests | Not monetized |
| Portal Free | Local-first workspace, local search and page creation | Existing localhost prototype | Not monetized |
| Portal Creator | Optional managed sites, backup, custom web domains, hosted AI allotments | Planned | Monthly hosting subscription + measured compute overages |
| Portal Business | Optional teams, business PORT pages, paid tools and real usage reporting | Planned | Per-business subscription + published service fees |
| SDPN Enterprise | Optional support, governance, dedicated deployment and service-level agreements | Planned | Annual B2B contracts, support and consumption-based agreements |

No price is activated. Price hypotheses for future experimentation (not offers): Creator $12/month, Business $59/month, enterprise customized with minimum committed annual spend. These numbers require capacity costing, payments reconciliation, tax and compliance checks, customer research and actual deliverability before publication. Domain registrations and outside ISP charges may not be zero even when the open protocol costs zero.

Potential additional revenue surfaces: paid developer delivery/storage, opt-in verified business discovery, usage-metered hosted AI, legitimate sponsored search placements clearly separated from organic ranking, enterprise support and dedicated PORT hosting. Never sell unconsented identity data as a hidden monetization source.

### Cost / margin promotion gate

A subscription tier must have a measured `contribution margin = recognized revenue - variable model inference - storage - network egress - payment processing - other per-customer support costs`, including realistic peak demand and abuse controls. Launch only when the service really runs and the customer can see prices, terms, usage and cancellation. Unlimited hosted AI cannot be honestly sold without bounded service cost.

## 5. Tier firewall — implemented policy

`community/src/access.mjs` is the executable source of the first capability catalog. Every free protocol primitive evaluates as allowed without payment; managed capabilities are explicitly **unavailable**, not secretly enabled, until real authenticated billing/entitlement infrastructure is deployed. Portal's `/api/plans` publishes that same catalog. Client UI cannot grant server privileges by changing a price or label.

The tariff boundary must never cover free identity/key ownership, creating or resolving signed PORT aliases, self-hosted software, or authorized use of a user's own infrastructure. Operator-managed services may impose resource quotas, explicit contractual usage limits, fair abuse protection and payment requirements only on the services actually supplied by that operator.

## 6. Security and contributor governance

- Do not accept contributor code without documented rights and review. Apache-2.0 Section 5 covers submissions when intentionally made as contributions; maintain a clear pull-request record of scope, license, provenance, non-infringement and source changes. Legal review can establish additional contribution practices.
- Use CI that builds and tests the open community directory **without any** non-community source dependency; separately test compatibility with the existing proprietary runtime.
- Founder status is historical/project attribution. It does not automatically give exclusive copyright title to future contributors or coerce user identities into founder control.
- Keep API compatibility versioned; changes to signature or canonical wire bytes require interop and downgrade testing.
- Do not invent registrar approvals, IANA scheme registration, globally unique short-name rights, guaranteed zero-cost internet connectivity, deployed high availability or live payment results.
- Security advisories and disclosed vulnerabilities should be reviewed and fixed without placing safety updates for free protocol users behind payment.

## 7. Launch-readiness levels

1. **Implemented / Tested:** Community identity, signed aliases, verifiers and free service catalog with passing unit and native compatibility tests.
2. **Open-source published:** Apache-2.0 code and notices merged to public branch, independent checkout tests pass; this applies only to explicitly licensed source scope.
3. **Interoperable deployment:** At least two independent implementations exchange real signed Port records and authorized data sessions on separate hardware, with adverse testing and evidence.
4. **Managed preview:** User-consented hosted services, identity/tenant separation, metering and receipts, support and security controls validated; not production.
5. **Paid production:** Durable multi-host availability, identity recovery, compliance, real payments and entitlements, cost/margin reports and customer support. No production claim until measured.

**Operating principle:** Free protocol and user control attract adoption; useful managed services generate revenue without taking users' identities hostage.
