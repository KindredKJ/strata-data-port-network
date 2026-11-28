# PORTAL/1 — Founder's independently operated search, AI and PORT application

**Founder:** Kindred Jermaine Cox  
**Organization:** Kindred Labs  
**Product:** PORTAL, an independently scoped application of the Strata Data Port Network (SDPN)  
**Release classification:** Implemented source with automated tests, not a globally deployed search engine or alternative Internet.

## Product mandate

PORTAL makes useful AI easier to discover, learn, apply, and turn into owned digital assets. It is an SDPN product, **not** the mandatory frontend, runtime, identity provider, DNS gate, or asset owner for Kindred Genesis, StrataCast, K1, Brainstem or any other Kindred application. SDPN remains independently operable when those optional consumers are offline.

PORTAL's first release is **functional offline/loopback software** with no paid cloud API, hosted embedding provider, subscription, Vercel endpoint, Genesis hostname or browser extension required. It uses Node.js built-ins. It does NOT pretend to have crawled the Internet, trained a foundational AI model, or served millions of users.

## Architecture

\`\`\`text
Local browser -> PORTAL UI (http://127.0.0.1:8790)
  |                                  |
  +-- Search -> real SDPN docs + owner-created site index
  |            -> scored results, snippets, inspectable original text
  |
  +-- AI Tasks -> per-task grounded instructions
  |              -> explicitly configured local OpenAI-compatible model
  |              -> unavailable if actual model is not running
  |
  +-- Create site -> bounded, escaped, durable local file
  |                  -> native localhost preview /p/<real-slug>
  |                  -> operator action signs port://subdomain.<self-certifying-ID>.sdpn
  |                  -> INTERCONNECT displays signed local website without HTTP fetch
  |
  +-- Namespace -> cryptographically verified Port Zero signed record
                  -> never grants session or network access by itself
\`\`\`

### What users can do immediately

1. **Search** SDPN's checked-in first-party architecture and verification documents and their own actually saved sites, with source links and verbatim reading. Ranking uses deterministic document frequency, term frequency and title relevance. The UI clearly labels current local index coverage.
2. **Ask AI** to learn, research, create, build and plan. The server sends text to a user-operated OpenAI-compatible HTTP model on **127.0.0.1 only**. It does not invent fallback answers and requires no remote paid API. Local model inference only works when a suitable model is already running and configured.
3. **Create sites** in the browser, persist page content under a private owner-controlled folder, and instantly preview escaped, non-executable content on the loopback server. Data is never uploaded by this feature.
4. **Publish a PORT** explicitly using a local operator command that must have access to the owner's existing separate private Port Zero key. The signed namespace alias maps to the owner's real cryptographic port identifier. It does not make the site available worldwide.
5. **Open a locally signed site** in the native INTERCONNECT proof with JavaScript disabled and networking blocked, using the same \`port://\` address. The renderer loads owned content only after signature verification and owner-target checks.

### Windows PowerShell — start working now

From the checked-out SDPN repository directory:

\`\`\`powershell
node --version
node .\apps\portal\server.mjs
\`\`\`

Open **http://127.0.0.1:8790**. This is the actual first-party Portal UI running locally, not a third-party cloud deployment. The port address comes from the server startup log. The service binds **only** to \`127.0.0.1\`.

Create a site using the web form. Then, in a separate PowerShell window from the same repository directory, initialize the private Port Zero namespace if you have not already done so:

\`\`\`powershell
node .\scripts\port-domain.mjs init
\`\`\`

**Do not re-run \`init\` if the namespace already exists.** Use \`node .\scripts\port-domain.mjs renew\` to refresh the signed namespace record instead.

To actually bind a page to a PORT address, run with the exact saved slug shown in Portal:

\`\`\`powershell
node .\apps\portal\publish.mjs publish my-portal-site
\`\`\`

The command will *only* succeed if the actual site \`my-portal-site\` exists and you control the signed local namespace. The returned URI is a real signed owner namespace, not an externally registered domain.

To use PORT in the Windows shell, optionally run:

\`\`\`powershell
.\scripts\Install-SDPNPortProtocol.ps1 -Action Install
\`\`\`

This is a separately approved, per-user OS association, not the default HTTP or HTTPS browser handler.

### Linux / WSL bash — start and verify

\`\`\`bash
node --version
node apps/portal/server.mjs
\`\`\`

From a second shell, after saving a site in the UI:

\`\`\`bash
node scripts/port-domain.mjs init
node apps/portal/publish.mjs publish my-portal-site
\`\`\`

For INTERCONNECT on a Linux machine with working GTK/WebKitGTK installation, supply the actual signed URI output and manifest path:

\`\`\`bash
python3 interconnect/browser.py --port-manifest "$HOME/.sdpn/port-names.json"
\`\`\`

Paste the exact signed \`port://\` address into INTERCONNECT. Only a site actually saved under the same local Portal data directory and signed by that owner can appear as an offline native PORT website.

### Local model integration (no subscription or paid credits)

Install/run an OpenAI-compatible inference runtime on your own machine by its documented native method, with the HTTP endpoint bound to \`127.0.0.1:8080\`. Select the **real model identifier** actually loaded by the runtime, then launch Portal with the environment variable \`PORTAL_LOCAL_MODEL\` set to that identifier. A previous user's model candidate may be used only after verifying the actual running model ID.

PowerShell example that reads the active local model identifier directly from the compatible \`/v1/models\` endpoint without hard-coding a fabricated name:

\`\`\`powershell
$models = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/v1/models'
if (-not $models.data -or -not $models.data[0].id) { throw 'No active local compatible model found' }
$env:PORTAL_LOCAL_MODEL = [string]$models.data[0].id
node .\apps\portal\server.mjs
\`\`\`

This does not install, launch or invent the local model itself. If a compatible model is not running, Portal reports it as unavailable rather than substituting dummy AI content. The chat adapter uses \`/v1/chat/completions\`, and implementation compatibility depends on the chosen actual local runtime. No external API key is embedded.

### Real verification

\`\`\`bash
node --test apps/portal/test/*.test.mjs
python3 -m unittest discover -s interconnect/tests -v
npm test
\`\`\`

The tests exercise native HTTP serving, genuine checked-in document search, owner-created site persistence, strict origin/intent boundaries, inert HTML rendering, 503 when a local model is unavailable, actual HTTP message exchange with an isolated test responder, signed port publication, native offline site reading, and malformed route refusal. Test responders are **test-only**; no test content is shipped as a fake production answer or website.

## Security, rights, and cost

- UI and service are loopback-only by default, with same-origin POST enforcement and per-process mutation-intent token; **no public Internet endpoint or general signup is exposed**. It is not yet hardened for arbitrary untrusted multi-tenant customers.
- The Port Zero private signing key never enters HTTP responses or client-side code. Operator publication remains a separate machine-local CLI action.
- PORTAL can show only signed namespace metadata, not peer secrets, raw ledgers, external devices, or unauthorized data.
- The editor stores text-only content and renders it with HTML escaping; arbitrary HTML and scripts are not executable in owner-created sites.
- The index only reads permitted SDPN documents and saved sites. Public Internet crawling, ingestion permissions, rights/licensing, RFC 9309 robots handling, deduplication, spam defense, ranking evaluation, takedown workflows, trust and safety review, and scalable storage/search all require their own engineering and operational work.
- Self-hosting avoids subscription/provider dependency for this local service, but global connectivity, compute hardware, bandwidth, power, domain acquisition, certificates, ongoing security operations and high availability cannot be delivered at guaranteed zero cost.

## Scale / revenue roadmap and explicit promotion gates

| Phase | Customer capability | Revenue strategy | Non-negotiable verification |
|---|---|---|---|
| PORTAL/1 | Own search, guided local AI, durable website/PORT creation | No payments activated | Clean checkout tests, operator review, actual browser smoke |
| PORTAL/2 | Opt-in federated discovery of signed tenant PORT indexes, contextual retrieval, peer discovery | Enterprise paid PORT namespaces, business search placement clearly marked | Authenticated peer and index signatures, tenant isolation, consent/revocation, unbiased organic ranking |
| PORTAL/3 | Public HTTPS gateway into approved PORT apps, managed tenant hosting, website builder, measurable usage | Paid hosting tiers, usage-based API/access, business subscriptions | Carrier independence, bounded metering, billing reconciliation, audited operator controls, live SLA evidence |
| PORTAL/4 | Public web crawling/search alongside native PORT discovery, semantic multimodal AI, accessible onboarding | Enterprise retrieval and AI automation products | Respect RFC 9309, source attribution/licensing, real distributed benchmarks, abuse defenses, privacy and compliance |
| PORTAL/5 | Federated worldwide service mesh and interoperable enterprise PORT clients | Commercial network capacity and verified service agreements | Multi-region physically distinct hosts, signed receipts, recovery drills, failover, transparent unit economics |

**Commercial recommendation:** prioritize the premium business PORT builder and verifiable enterprise content discovery ahead of attempting full Google-index parity. Customers can directly pay for reliable publishing, agent access policies, availability, private search and audit controls; global general-purpose search ranking is considerably more infrastructure-intensive. No customer payments, Stripe purchases, live subscriptions, global DNS registrations or founder income have been created by this source release.

Independent interfaces and product identities must remain intact. ChatGPT and Kindred Labs AI can be opt-in clients over separately approved authenticated adapters and cannot take control of Portal or SDPN.
