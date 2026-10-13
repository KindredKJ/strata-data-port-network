# SW08 — Strata CloudSignal

Kindred Labs / Strata Data Port Network

**Superseded native requirement (2026-10-13):** the founder requires no routing and
no IP in native SDPN. [SW09](SW09-NATIVE-NO-IP-MATERIALIZATION.md) governs native
CloudSignal. The IP gateway design below is retained historical/optional compatibility
scope; it is not a prerequisite for native materialization. Native Android health
remains unqualified and disconnected.

## Founder design requirement

SDPN must be an **actual bidirectionally functioning network**. Its recognizable identity uses **four ascending clouds instead of conventional signal bars**. Each cloud lights up in succession when verified packet-routing service quality improves. All clouds outlined means **not connected**, including during pairing or standalone one-off payload proof.

| Lit clouds | Label | Meaning |
|---|---|---|
| 0/4 | Disconnected | No fresh evidence for a functioning authenticated SDPN packet gateway |
| 1/4 | Weak | Routing established, but poor measured network health |
| 2/4 | Fair | Routing established, limited usable performance |
| 3/4 | Strong | Routing established, good measured performance |
| 4/4 | Excellent | Routing established, all provisional performance thresholds satisfied |

## Product surfaces

- Android native app: cloud icon and text state with accessibility semantics.
- Android Quick Settings: cloud-shaped `VectorDrawable` replacing the previous generic icon. Tile remains inactive unless there is genuine SDPN route forwarding.
- Future managed Android VPN: cloud fill derived from packet-level validated gateway health.
- Future iOS/iPadOS/visionOS: equivalent artwork in a permitted OS network profile, app or widget; cannot replace the built-in cellular/Wi-Fi status symbols.
- Real Wi-Fi: physical SDPN access point SSID appears among Wi-Fi network names; the phone's **built-in Wi-Fi radio signal bars remain OS-owned**.

The four clouds are the brand-specific *network overlay quality*, not Wi-Fi RSSI and not a claim of radio coverage. The system status bar cannot be overwritten by an ordinary third-party app.

## Quality gate

`CloudSignal.level` is a provisional, deterministic classifier over a **fresh** health sample, gated by all of:

- Authenticated SDPN gateway.
- Verified working **bidirectional IP packet routing**, not merely an SW06-F encrypted payload transfer.
- Reachable remote peer.
- Network sample age <= 15 seconds with valid loss, p95 RTT, jitter and goodput.

The quality classification takes the **worst** of four provisional metrics to avoid overstating it:

| Signal cap | Loss | P95 RTT | Jitter | Application goodput |
|---|---|---|---|---|
| 1 cloud | >=10% | >=600 ms | >=150 ms | <1 Mbps |
| 2 clouds | >=3% | >=250 ms | >=60 ms | <5 Mbps |
| 3 clouds | >=1% | >=100 ms | >=20 ms | <20 Mbps |
| 4 clouds | below those limits | below those limits | below those limits | >=20 Mbps |

These are **UX tuning thresholds** only, NOT contractual SLAs, not physical connection strength, and not validated across regions, carriers or XR devices.

No real SDPN packet-forwarding gateway has been implemented. `SdpnNetworkHealthSource.currentGatewayHealth()` therefore always returns **null**, so the shipped icon stays **0/4/disconnected**, even when a phone can encrypt a proof to a PC. Do not replace this with synthetic data, force-connected state, hotspot RSSI, or successful proof alone.

## Network implementation necessary for a real positive indicator

1. Identity-verified, authenticated packet-routing SDPN gateway.
2. Android `VpnService` packet tunnel with user consent, reciprocal IP routing and DNS choices, no blackhole of regular internet.
3. Regular gateway packet-level liveness, loss, latency and jitter measurements, with bounded retries and cryptographic freshness.
4. Correct cellular/Wi-Fi handover, route cleanup, state restoration, data caps and battery budgets.
5. Physically deployed AP hardware when the product presents itself as a Wi-Fi SSID.
6. Independent Android hardware validation, then Apple NetworkExtension and XR platform qualification.

**Never claim SDPN is a replacement for internet transport, actual radio spectrum, or Wi-Fi until independent measurements support exactly that capability.** The four-cloud brand identity is available now; the routed network is not.
