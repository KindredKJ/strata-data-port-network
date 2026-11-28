# SDPN standalone operation and optional Kindred Labs / ChatGPT integration

**Founder:** Kindred Jermaine Cox. **Product:** Strata Data Port Network.
**Scope:** SDPN's existing static landing page and browser-encrypted package workspace.
**Classification:** Implemented source candidate; do not label production-deployed without an independent release receipt.

## What is independent

SDPN is a separate product, repository, logical protocol, deployment, access-control boundary, and release stream from Project Genesis. It has no required runtime dependency on Genesis's hostname, domain delegation, browser extension or availability. Attribution to Kindred Labs is not a network dependency.

The preexisting Vercel URL is one optional publication channel, **not an authority, network transport or requirement for standalone operation**. The provider-independent static host in `scripts/serve-standalone.mjs` uses only Node.js built-ins. It serves the existing `public/` assets with an explicit route allowlist and no remote uploads or analytics. The release still requires a machine to run it; no provider can be assumed permanently free or available.

## Run without third-party hosting or package installation

From an SDPN checkout on a machine with Node.js 22 or newer:

### Windows PowerShell

```powershell
node --version
node .\scripts\serve-standalone.mjs
# Browser: http://127.0.0.1:8787/
# Encrypted workspace: http://127.0.0.1:8787/app.html
# Static-host health: http://127.0.0.1:8787/healthz
```

### Linux / WSL bash

```bash
node --version
node scripts/serve-standalone.mjs
curl -fsS http://127.0.0.1:8787/healthz
```

No `npm install`, Vercel account, Cloudflare account, paid credits, DNS change, Genesis authorization, model API or subscription is needed **to operate this static web service locally**. The encrypted package can be transferred out of band; this service does not itself deliver files, enroll remote peers, activate Port Zero or start the distributed network.

The default loopback bind prevents unsolicited remote use. For explicitly approved LAN testing only, set `SDPN_HOST=0.0.0.0` and `SDPN_PORT=8787` in the process environment. Use a firewall and trusted network; do not expose this HTTP listener directly to the public Internet. Public deployment requires a separately administered HTTPS ingress, machine hardening, monitoring, recovery, and a real external smoke test. DNS is a convenience for human-readable HTTPS names, not a dependency of the core SDPN identity model; physical Internet transports may still require IP routing.

## Preserve product boundaries

```text
Kindred Labs AI / Genesis (optional consumer)    ChatGPT (optional client)
               |                                      |
               +----------- separately approved ------+
                              scoped adapter
                                  |
                         SDPN independent API
                       (not provided by this host)
                                  |
                    Port Zero / policy / audit
                                  |
                      Authorized SDPN transport
```

- SDPN's native authority remains independent. A Kindred Labs AI outage must not stop SDPN's already authorized local workflows.
- Kindred Labs AI may **optionally** consume SDPN via a separately deployed, versioned, authenticated adapter. Do not proxy founder credentials, private ledgers, model memories or entire storage into a public app.
- ChatGPT is an optional **client/integration surface**, not an infrastructure or database hosting target. A future ChatGPT-accessible connector requires a reachable HTTPS server, a least-privilege authenticated API, per-user consent, revocation, tenant isolation, rate limiting, durable audit, and approval for every external effect. This change does **not** register or install such a connector.
- Do not make the Genesis domain, its extension, the ChatGPT product, Vercel, or StrataCast a mandatory core SDPN dependency. Do not merge separate product applications into SDPN's repository.

## Acceptance and promotion

Run `node --test test/standalone-host.test.mjs`, followed by repository `npm test`. CI should run the existing Node, Python and Windows gates independently. Validate: no arbitrary file disclosure, browser workspace's `connect-src 'none'`, CSP/security headers, read-only request methods, actual localhost responses, and shutdown/restart behavior.

Only the static host's `/healthz` is asserted by this change. It is **not** a native SDPN network status, zero-copy attestation, remote handshake, global reachability, payment system or production authorization. Keep separate gates for real physical hosts, signed port identity, end-to-end encryption, consent/revocation, data recovery, and measured transport. Existing historical receipts and working candidates must not be rewritten to imply new proof.
