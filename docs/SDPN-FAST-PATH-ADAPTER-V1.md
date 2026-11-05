# SDPN Fast-Path Adapter v1 — Architecture and Evidence Contract

**Creator and founder:** Kindred Jermaine Cox.  
**Project and protocol steward:** Kindred Labs.  
Kindred Labs governs the official SDPN profile registry, reference implementations, release signing, and telemetry endpoints under the founder’s direction. Participating operators retain control of their own machines, router policies, credentials, and telemetry choices.

## Founder vision

Kindred Jermaine Cox created SDPN as a Kindred Labs project. The founder’s objective is a data-teleport experience between cryptographic Ports, integrated beneath ordinary host networking, with NTSA-X state processing and a long-term path toward broad operator adoption. The performance target is at least 40% lower end-to-end p95 latency on qualified workloads. The ambition to become a primary global transport fabric and receive foundational network metrics at Kindred Labs is a strategic goal, not a verified deployment claim.

“Teleport” describes SDPN’s endpoint experience: authorized state is transferred, authenticated, and reconstructed at the destination Port. The v1 online carrier is QUIC over the host’s existing UDP/IP connectivity. A host fast-path hook may intercept eligible frames before the ordinary local IP stack; Internet paths still use the participating networks’ existing IP reachability.

## Protocol boundaries

- SDPN Port identifiers are cryptographic identities, not IP addresses. The logical Port protocol does not perform address routing, route discovery, BGP, or transit forwarding.
- A QUIC peer endpoint must already be authorized and reachable through its operator-provided address. QUIC carries SDPN state; it does not make physical network paths disappear.
- Host-route, default-route, BGP, and transit integration is a separate, opt-in policy adapter. One measured path does not qualify every route domain.
- NTSA-X may analyze signed performance windows and propose bounded state-processing or adapter settings. Packet handling remains deterministic; no NTSA-X inference runs per packet.

## Linux v1 fast path

- Use XDP to match only provisioned SDPN QUIC traffic and redirect that traffic locally to AF_XDP. Unmatched traffic uses XDP_PASS.
- Detect AF_XDP zero-copy support at runtime. Use zero-copy only when the active NIC and driver advertise it; otherwise use the supported copy path or leave the adapter inactive.
- Do not change the host default route or advertise routes from the fast-path process.
- Keep native Port identity, consent, expiry, revocation, and audit checks at the endpoint boundary.

Linux references: [AF_XDP](https://docs.kernel.org/networking/af_xdp.html) documents copy and zero-copy modes and device capability probing; [NAPI](https://docs.kernel.org/networking/napi.html) describes the normal kernel networking path.

## Host and network policy activation

The future route-policy adapter may target four scopes together: host routes, the default route, BGP, and transit. It must prepare one explicit route bundle and activate the bundle only after every enrolled scope qualifies. Network-wide updates are not inherently atomic: BGP propagation and route convergence remain asynchronous, so the adapter must stage changes, verify the resulting state, and restore the prior policy if any scope fails.

The activation rule is deliberately measurable:

- Compare paired, end-to-end state-transfer samples on the current baseline and the SDPN QUIC profile, with the same endpoints, payload class, encryption, and conditions.
- Each route scope must show at least 60 successful paired samples in each five-minute window.
- In every one of three consecutive windows, candidate p95 latency must be at least 40% lower than baseline p95. Candidate p99 latency and packet loss must be no worse than baseline.
- Activate all configured scopes together only after the three windows pass. A failed active window triggers restoration of the baseline bundle.

These thresholds are the activation policy; they do not establish that SDPN currently meets the target. Existing SW06-G issue [#22](https://github.com/KindredKJ/strata-data-port-network/issues/22) supplies the physical-host qualification procedure. Host prefixes, default-route gateways, local ASNs, BGP peers, prefix filters, transit providers, and rollback state must be supplied by each participating operator before route integration can be applied.

## Platform sequence

| Platform | Adapter direction | Release boundary |
|---|---|---|
| Linux servers | XDP + AF_XDP local fast path | First pilot; qualify the exact kernel, NIC, driver, queue, and privilege combination |
| Windows Server | Separate WFP or NDIS implementation | Independent driver package and qualification; no shared Linux driver binary |
| Operator routing | Host/default-route policy plus BGP/transit adapter | Only after every enrolled scope clears the performance gate and the operator supplies route policy |

Microsoft documents WFP callouts for advanced TCP/IP data processing and NDIS lightweight filters between protocol and miniport drivers. They are distinct OS integration points, not proof of a universal latency improvement.

## Metrics and governance

The founder’s goal is to make useful SDPN network-performance metrics available to Kindred Labs infrastructure. The v1 profile carries opt-in, minimized measurements—latency, loss, throughput, adapter mode, and coarse hardware/software capability. Payloads, credentials, and user-identifying flow records are excluded by default. Kindred Labs controls official telemetry endpoints and release policy; operators control whether their nodes send telemetry.

## Adoption

Kindred Labs’ long-range aim is primary-fabric adoption through measured performance, a versioned interoperable profile, and operator partnerships. No competitor is forced to adopt it, and no traffic is routed through Kindred Labs infrastructure unless an operator explicitly configures that path. BGP and transit participation require the operator’s ASN, peers, prefixes, and routing policy.

## Status

This proposal and its profile codec define a protocol format and activation contract. They do not install an OS adapter or route bundle. No physical-host result currently proves the 40% target, no QUIC transport implementation is connected to the codec, and no host routes, default routes, BGP announcements, transit paths, or telemetry endpoints have been changed.

**Creator/control attribution:** Kindred Jermaine Cox is SDPN’s creator and founder; Kindred Labs is the project steward and controls the official SDPN release profile and infrastructure under his direction.