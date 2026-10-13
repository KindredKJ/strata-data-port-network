# SW07 — Strata Network, system-level mobile connection architecture

**Founder direction:** Strata Data Port Network must be accessible through familiar device-level network controls, not a required terminal or a standalone file-transfer application. This is a binding product requirement for mobile phones, tablets, smart glasses, wearable computers, and XR devices.

## Two legitimate network entry points

| User interface | Implementation | Required dependency | Security/claim boundary |
| --- | --- | --- | --- |
| Wi-Fi Settings → **Strata Data Port Network** | A real WPA3-capable access point broadcasts the SSID \`Strata Data Port Network\` and supplies DHCP/local networking | Physical Wi-Fi access point/router or AP-capable device, deployed and configured by the operator | Seeing an SSID only proves the AP is broadcasting; it does not automatically mean SDPN routing, global reach, private identity, or internet service are available |
| VPN / Network Settings → **Strata Data Port Network** | Platform IP tunnel managed by Android \`VpnService\`, or Apple NetworkExtension packet tunnel | An SDPN gateway that forwards encrypted IP packets and returns packets, routes, DNS, lifecycles, authenticated device identities and explicit user permission | Do **not** register an always-on or active VPN that black-holes arbitrary traffic. No system tunnel shall be advertised as connected until routing and recovery are verified |
| Android Quick Settings → **Strata Network** | Native Android \`TileService\` opens the built-in SDPN connection screen | Native app installed; user adds the tile | Quick-access entry only. The tile is INACTIVE while no actual system tunnel is running. A successful proof transfer is not an active VPN. |

## What exists in this revision

1. \`mobile/android/\` is a native Android project, not a wrapped website.
2. \`Sw06fClient.kt\` implements SW06-F v2 protocol challenge/response, HKDF-SHA256, AES-256-GCM, SHA-256, HMAC receipt verification and fail-closed claim checks, directly compatible with the Node receiver on a private LAN.
3. \`MainActivity.kt\` supports a secure one-time secret entry and synthetic 1 MiB encrypted phone-to-PC proof, with explicit software-proof-only status.
4. \`StrataNetworkTileService.kt\` provides Android Quick Settings access. It **opens** the pairing/proof UI and never claims device-wide network connectivity.
5. \`scripts/run-sw07-android-termux.sh\` provides a secondary Android/Termux path for repeatable 1/4/16 MiB tests. It is an optional engineering harness, not the end-user onboarding flow.
6. CI builds the Android debug APK and runs unit tests. No production VPN, global network, user-chat backend, push service, SSID deployment, or physical-device benchmark is claimed.

## Immediate pilot: discover SDPN in a phone's Wi-Fi list

On a Windows computer supporting Mobile Hotspot, open **Settings → Network & internet → Mobile hotspot → Properties → Edit**. Set the broadcast name to **Strata Data Port Network**, choose a unique strong Wi-Fi password, and enable the hotspot. On the phone, open **Settings → Wi-Fi** and choose **Strata Data Port Network**. Then test the existing SW06-F Node receiver on the computer using the Android client and an independent pairing secret.

This is a **real SSID**, because an access point actually broadcasts it. It does **not** mean device-wide SDPN routing, global reach, permanent chat, or replacement for spectrum-based connectivity is operational. The host/router remains responsible for actual link, DHCP and routing. Never publish the Wi-Fi password or ephemeral SW06-F secret in GitHub.

An attacker can impersonate the visible SSID. SDPN must verify the receiver identity cryptographically; never trust the Wi-Fi name alone.
## Next engineering gate: usable system networking

### Android VPN transport
- Build a secure SDPN gateway and encrypted bidirectional IP encapsulation. Define the device/agent identity and Port Zero permissions; separate control plane (pairing, consent, revocation, audit) from data plane (routing, packet transmission, congestion control, DNS).
- Implement \`VpnService\` using \`VpnService.prepare\` and Android's user consent. Protect the gateway control socket from routing into its own TUN. Only start after authentication and a live forwarding path has been verified.
- Initially use narrowly scoped routes for SDPN-private address space with trustworthy DNS behavior; leave unrelated internet traffic on the normal network. Avoid default-route claims until actual full-tunnel operation is fully implemented and independently verified.
- Supply network settings entry and Android Quick Settings connect/disconnect with truthful connected/recovering/disconnected states. If the gateway fails, disconnect/restore normal routing rather than silently dropping traffic.
- Test Wi-Fi/cellular handoff, device sleep, packet fragmentation/MTU, lost network, replay, credential revocation and battery consumption.

### iPhone and iPad
- Implement the same protocol via Apple NetworkExtension \`NEPacketTunnelProvider\`, \`NETunnelProviderManager\` and user-approved installation. The Network Extension entitlement is required and OS policies may restrict available deployment modes.
- Never imply iOS adds a new nearby Wi-Fi SSID unless an actual AP broadcasts it. A configured VPN is managed under the operating system VPN/network settings.
- Validate entitlement, signing, distribution and background behavior on devices rather than inferring functionality from Android tests.

### Physical Wi-Fi network / AP
- A compatible Wi-Fi AP/router must actually transmit the SSID; do not misrepresent the SSID as a wireless protocol that uses no spectrum.
- The operator configures WPA3-SAE or an appropriate enterprise WLAN authentication mode, AP isolation policy, DHCP, and an approved SDPN gateway on that local network.
- A connected device still needs SDPN authentication before privileged agents, devices, shared storage, or Genesis companion services become accessible.
- Protect against rogue AP impersonation: verify SDPN service identity cryptographically rather than trusting only the visible SSID.
- Future deployments can expose SDPN through standard Wi-Fi hardware, local gateway appliances, managed enterprise WLANs, home routers or access-point-capable hardware; exact capabilities require measured prototypes.

## One consistent user journey

1. Install the authorized SDPN client or join an authenticated SDPN-enabled Wi-Fi network.
2. Open normal network controls and discover or select **Strata Data Port Network**.
3. The user explicitly authorizes the network profile or pairs with a cryptographically verified SDPN gateway.
4. The OS displays genuine connection state. Authorized traffic travels through SDPN; everyday connectivity is not disrupted.
5. Genesis companion, agent messaging, files, applications, and distributed services are exposed **only once** their corresponding identity, permissions, transport and application services are implemented and tested.

## Hard nonclaims

- SDPN today is **not** a replacement for existing carrier spectrum, IP reachability, Wi-Fi radio, DNS, or global routing.
- The SW06-F proof transmits **one application payload**, not arbitrary IP packets. A verified proof does not automatically provide chat, broadband, or device-wide network selection.
- A shell script on Termux is a developer convenience, not the shipping mobile user experience.
- Physical separation, zero-copy, true full-tunnel networking, persistent multi-node messaging and production readiness all require separate evidence before announcement.

### Acceptance tests for system-level network graduation

- User selects SDPN through device networking UI and sees accurate connection status.
- Routed SDPN traffic works bidirectionally between at least two independent physical devices.
- Unrelated traffic stays functional and private; tests include handoff and network loss.
- The client exposes reproducible routing, encryption, memory, battery, and throughput results; it does not misclassify RAM copy speed as internet bandwidth.
- Secure pairing, revocation, bounded buffers and verified service identity are mandatory before exposing agents or Genesis state.
