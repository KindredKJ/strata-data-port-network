# PORT/1 — SDPN-native addressing, signed port domains and INTERCONNECT
Founder and operator: **Kindred Jermaine Cox / Kindred Labs**. Project: **Strata Data Port Network**.
Current status: real independent source implementation with executable tests; **not** an IANA-registered globally supported URI scheme, root DNS zone, live network carrier or production service.

## 1. Design and authority
- `port://` is an SDPN-native custom **URI scheme**. An OS/native application must elect to register and handle it. It does **not** replace `https://` in ordinary browsers, Internet routers, or the HTTP/TLS transport stack.
- `www` is a conventional DNS hostname label, **not a transport protocol**. The custom `port://` namespace must not be described as an existing globally delegable TLD.
- Each native namespace is **self-certifying**, split into two 32-character hexadecimal DNS-shaped labels solely for URI compatibility: `port://<service>.<32-hex>.<32-hex>.sdpn/<resource>`. A namespace's two halves reconstruct the complete SHA-256-derived Port Zero public-key identity. The `.sdpn` suffix is **private to this URI scheme**, not a claimed ICANN DNS registration.
- Human-readable, scoped subdomains such as `portal`, `api`, `memory`, `storage`, `interconnect`, and `enterprise.api` are **signed by that namespace's Ed25519 owner** and point to authorized candidate Port Zero identities. The root address is also signed. Names do not automatically start their named services.
- Each manifest binds the issuer public key, issuer Port Zero identifier, explicit subdomain-to-target assignments, revision, issuance, bounded expiry and Ed25519 signature. Invalid/expired/tampered manifests, rollback, conflicting revisions, unregistered aliases, URI credentials, query tokens, URI ports, percent-encoded path manipulation, traversal, unknown schemes and revoked issuers fail closed.
- Resolution only answers **which cryptographic port identity** a signed name points to. It does **not** authenticate a person/legal owner, establish peer reachability, grant access, install a transport, move data, perform physical zero-copy, issue a user credential or take any remote action.
- This preserves Port Zero authority, existing `native-session` consent/policy, Tesseract/ZPS boundaries, distinct Genesis deployment and independent SDPN ownership. Data planes remain wholly unchanged.

## 2. Create actual locally signed port addresses

Run these commands from the current SDPN Git checkout, with Node.js 22+ installed. No npm package installation, hosting credits, cloud account, DNS provider, Genesis endpoint, or financial service is required.

### Windows PowerShell
```powershell
node .\scripts\port-domain.mjs init
```

### Linux / WSL bash
```bash
node scripts/port-domain.mjs init
```

The command generates a **new independent** Ed25519 namespace key locally under `~/.sdpn/port-owner-key.pem` and a separate publicly shareable signed namespace mapping at `~/.sdpn/port-names.json`. The resulting JSON displays the exact real generated owner identity and `port://` addresses. Keep the private key **off GitHub, websites, chat, analytics and browser storage**. Back it up and protect it; loss of the private key forfeits administrative control over its namespace. Protect filesystem ownership/ACLs (owner-only `0600` modes on Unix); for commercial deployment migrate signing to a hardware- or OS-protected key system and maintain independently signed recovery/rotation records. No founder legal title or monopoly over `port` is conferred by generating a key.

To renew the short-lived manifest (one hour maximum per signature):
```bash
node scripts/port-domain.mjs renew
```

To bind a new name or subdomain to a real Port Zero ID from an authorized peer:
```bash
node scripts/port-domain.mjs bind clients.enterprise strata:port:ed25519:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

The command shown illustrates **syntax only**; the 64-hex target above is not a real verified peer identity. For actual operation use a targetPort returned from another live key-owned Port Zero identity. No remote enrollment or owner consent is inferred by the binding.

The local manifest lists seven root/service identifiers on initial issuance. They are actual **signed reservations** within your own namespace, not deployed applications. For stable live operation, a legitimate deployment must distribute refreshed signed manifests, trusted owner policy and revocation state via independently authorized channels. Each owner can operate a separate namespace (federation) with deterministic full-ID partitioning, without a mandatory global registry or DNS server.

## 3. Resolve and activate PORT without a network request

Take an actual URI from the `init` output and run:

### Windows PowerShell
```powershell
node .\scripts\port-resolve.mjs '<YOUR_GENERATED_PORT_URI>' --manifest "$HOME\.sdpn\port-names.json"
.\scripts\Install-SDPNPortProtocol.ps1 -Action Install
```

The URI above is a user-supplied argument: paste an actual generated address in its place. The registration is user-scoped in `HKCU:\Software\Classes\port`, not a system-wide `http://` or `https://` takeover. It rejects an existing different handler unless `-Force` is explicitly requested. Native activation opens a verification window that clearly states whether the signed name is recognized **and that no network connection is active**.

Remove only the SDPN-owned registered handler:
```powershell
.\scripts\Install-SDPNPortProtocol.ps1 -Action Uninstall
```

### Linux / WSL bash
```bash
node scripts/port-resolve.mjs '<YOUR_GENERATED_PORT_URI>' --manifest "$HOME/.sdpn/port-names.json"
python3 interconnect/browser.py --port-manifest "$HOME/.sdpn/port-names.json" --port-uri '<YOUR_GENERATED_PORT_URI>'
```

The second command opens INTERCONNECT on a supported Linux GTK/WebKitGTK device with its normal subprocess sandbox and ephemeral profile. Its `port://` address bar now loads a **signed-name status page entirely offline**. It does not navigate to the data port directly or enable JavaScript, downloads, local files or user authority. A true port data session still requires peer verification, owner policy and an explicit physical transport adapter; it cannot be supplied by an address bar alone.

## 4. Security and expansion plan

```text
OS protocol launcher or INTERCONNECT address bar
        |
        v
Canonical port:// URI parser [rejects mixed/unsafe URL syntax]
        |
        v
Offline Ed25519-signed PORT name manifest [expiry + revocation + revision]
        |
        v
Verified cryptographic target Port Zero identifier
        |
        +-- CURRENT: offline-only identity status (no external effect)
        |
        +-- NEXT separately gated transport plane:
                authorized, revocable native peer session
                + explicit carrier/substrate declaration
                + authenticated encrypted state framing
                + per-tenant scopes, quotas, durable receipts
                + independent two-physical-host measurements
```

**Scaling:** namespaces are distributed by deterministic public-key identifiers, not a central DNS zone. Per-owner signed alias manifests bound mapping and allow independent expiry/revisions; peer/session control already exists separately. Multi-node authoritative replication, recovery, anti-rollback persistence, trust distribution, and measured high-availability latency remain separate work.

**Commercial product paths (not yet revenue-active):** managed signed enterprise namespaces; authenticated private-port gateways; governed agent data exchange; auditable tenant-level bandwidth/storage quotas; receipts-based metering and enterprise SLA offerings. Billing, consumer identity, usage accounting and payment collection must be deployed and independently reconciled before any sales claim. Native schemes do not create exclusive trademark or TLD rights.

**Public access:** if a normal web browser must open SDPN, continue to use **HTTPS on an independently registered, controlled domain** or a specifically approved secure gateway. A public DNS subdomain can be called `port` on that owned domain, but that is distinct from `port://` and still requires DNS delegation and TLS. No domain purchase, IANA scheme assignment, global `.sdpn` TLD grant, public port enrollment, or Internet DNS change occurs in this work.

Standards: [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986) (URI syntax); [RFC 7595](https://www.rfc-editor.org/rfc/rfc7595) (URI scheme registration); [IANA URI scheme registry](https://www.iana.org/assignments/uri-schemes); [MDN protocol-handler restrictions](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/registerProtocolHandler).

## 5. Verification and limitations
- `npm test` includes a full signed namespace, CLI creation/renewal/delegation, traversal/collision/revocation denial, and no-connection assertions.
- `python3 -m unittest discover -s interconnect/tests -v` exercises actual cross-language signed-name verification as well as escaped offline display.
- Windows checks parse every script under `scripts/*.ps1` in CI; registration requires an actual logged-in Windows session and an explicit user action before OS integration can be called operating-system verified.
- SDPN's existing signed native session and two-guest proofs remain separately classified; no physical carrier, production distribution, globally unique legal namespace or founder credential is created by CI.
