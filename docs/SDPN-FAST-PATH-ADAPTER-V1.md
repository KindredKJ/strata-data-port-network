# SDPN Fast-Path Adapter v1 — Architecture and Evidence Contract

**Creator and founder:** Kindred Jermaine Cox.  
**Project and protocol steward:** Kindred Labs.  
**Official project domain:** kindredlabs.ai, controlled by the founder for Kindred Labs.

Kindred Labs governs the official SDPN profile registry, reference implementations, release signing, and telemetry endpoints under the founder’s direction. Participating operators retain control of their own machines, credentials, and telemetry choices.

## Founder vision

Kindred Jermaine Cox created SDPN as a Kindred Labs project. The founder’s goal is a data-teleport experience between cryptographic Ports, integrated beneath ordinary host networking, with NTSA-X state processing and broad operator adoption. The performance target is at least 40% lower end-to-end p95 latency on qualified workloads. A long-term goal is to make useful SDPN performance metrics available to Kindred Labs infrastructure. These are objectives, not verified deployment claims.

“Teleport” describes SDPN’s endpoint experience: authorized state is transferred, authenticated, and reconstructed at the destination Port. The v1 online carrier is QUIC over the host’s existing UDP/IP connectivity. The underlying Internet continues to provide endpoint reachability.

## No SDPN routing

- SDPN Port identifiers are cryptographic identities, not IP addresses. The logical Port protocol does not perform address routing, route discovery, BGP, or transit forwarding.
- No host route, default route, BGP configuration, transit path, or gateway policy is changed by this profile or activation gate.
- A QUIC peer endpoint must already be authorized and reachable through its operator-provided address. QUIC carries SDPN state over the existing online network.
- NTSA-X may analyze signed performance windows and propose bounded state-processing or adapter settings. Packet handling remains deterministic; no NTSA-X inference runs per packet.

## Linux v1 local fast path

- Use XDP to match only provisioned SDPN QUIC traffic and redirect that traffic locally to AF_XDP after the performance gate passes. Unmatched traffic uses XDP_PASS.
- The redirect is local delivery into the adapter. It does not modify the host routing table or forward third-party traffic.
- Detect AF_XDP zero-copy support at runtime. Use zero-copy only when the active NIC and driver advertise it; otherwise use the supported copy path or leave the adapter inactive.
- Keep Port identity, peer consent, expiry, revocation, and audit checks at the endpoint boundary.

Linux references: [AF_XDP](https://docs.kernel.org/networking/af_xdp.html) documents copy and zero-copy modes and device capability probing; [NAPI](https://docs.kernel.org/networking/napi.html) describes the normal kernel networking path.

## Sustained performance activation

The activation gate is per SDPN peer session and workload class. It compares paired end-to-end state-transfer samples over the existing baseline and SDPN QUIC profile, using the same endpoints, payload class, encryption, and conditions.

- Each five-minute window must contain at least 60 successful paired samples.
- The candidate p95 latency must be at least 40% lower than baseline p95 in each of three consecutive windows.
- Candidate p99 latency and packet loss must be no worse than baseline.
- After all three windows pass, the adapter may redirect only that eligible SDPN session locally to AF_XDP. Unrelated traffic remains on the host’s existing path.
- A failed active window restores that SDPN session to the baseline adapter. A process or adapter restart returns to baseline and requires fresh qualification.

This is an activation policy, not evidence that SDPN currently meets the target. Existing SW06-G issue [#22](https://github.com/KindredKJ/strata-data-port-network/issues/22) supplies the physical-host qualification procedure. A 40% result for one endpoint and workload does not generalize to every peer, server, or application.

## Platform sequence

| Platform | Adapter direction | Release boundary |
|---|---|---|
| Linux servers | XDP + AF_XDP local fast path | First pilot; qualify the exact kernel, NIC, driver, queue, and privilege combination |
| Windows Server | Separate WFP or NDIS implementation | Independent driver package and qualification; no shared Linux driver binary |

Microsoft documents WFP callouts for advanced TCP/IP data processing and NDIS lightweight filters between protocol and miniport drivers. They are distinct OS integration points, not proof of a universal latency improvement.

## Metrics and governance

The founder’s goal is to make useful SDPN network-performance metrics available to Kindred Labs infrastructure. The profile supports opt-in, minimized measurements such as latency, loss, throughput, and adapter capability. Payloads and credentials are not part of the telemetry profile. Kindred Labs controls official telemetry endpoints and release policy; operators control whether their nodes send metrics.

## Adoption

Kindred Labs’ long-range aim is broad adoption through measured performance, a versioned interoperable profile, and operator partnerships. No competitor is forced to adopt SDPN, and no traffic is routed through Kindred Labs infrastructure by this profile.

## Status

The profile codec and activation policy are reviewable source, not a live QUIC transport or OS adapter. No physical-host result currently proves the 40% target. No host routes, default routes, BGP settings, transit paths, domain DNS records, or telemetry endpoints have been changed.

**Creator/control attribution:** Kindred Jermaine Cox is SDPN’s creator and founder; Kindred Labs is the project steward and controls the official SDPN release profile and infrastructure under his direction. The founder’s official project domain is kindredlabs.ai.