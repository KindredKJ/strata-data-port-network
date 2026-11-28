# SW07 — Device-native network presence

Kindred Labs / Strata Data Port Network (SDPN)

## Founder requirement

An SDPN user should use ordinary **device network settings** to select connectivity; the experience must not depend on a desktop terminal or a permanent companion application foreground process. Phone, tablet, spatial/XR and future embedded implementations must share protocol semantics without pretending their radios or operating systems are identical.

## Two separate OS-native surfaces

### 1. Wi-Fi settings: “Strata Data Port Network”

A compatible, authorized Wi-Fi access point must **actually broadcast** the SSID `Strata Data Port Network` on a radio supported by nearby devices. The operating system—not the SDPN app—then lists it with other Wi-Fi networks. Selecting it creates an ordinary Wi-Fi link, subject to WPA2/WPA3 authentication, DHCP, routing, and the radio's actual capacity. An SSID alone does not create an SDPN backhaul, access to the open internet, or an alternative non-radio physical medium.

Practical pilot: configure a dedicated Wi-Fi router/access point's SSID to `Strata Data Port Network`, choose a unique strong WPA2/WPA3 key, and securely connect the PC running the SDPN SW06-F receiver to the same reachable LAN. Check AP/client isolation, firewall scope and private IP reachability. Guest Wi-Fi often **blocks LAN access by default**; do not broadly disable network isolation except in a controlled test network. Do not publish passwords.

The next embedded gateway step is an actual SDPN router/access-point service: DHCP, routing and authorization to verified peers, replay/revocation handling, optional upstream internet, safe fallback and independent measurements. A Wi-Fi network carrying SDPN traffic still uses conventional RF/Wi-Fi spectrum.

### 2. Android: Settings → Network & internet → VPN

`mobile/android` declares `StrataVpnService` protected by `android.permission.BIND_VPN_SERVICE`, and provides a button that opens the system VPN Settings screen. Android may show the installed VPN-capable app among system VPN apps depending on OS/version and enrollment state; it will **not** be a functioning or connected VPN merely because the service is declared.

The service is **fail-closed**, does not call `VpnService.Builder.establish()`, does not intercept device packets, and cannot blackhole normal traffic. Android VPN preparation requires explicit user consent; only one prepared VPN service is active at a time. Before activation, implement a reviewed authenticated remote gateway, packet framing and forwarding, DNS/routing choices, fail-closed connection/disconnection recovery, MTU handling, key rotation and packet-level security. The existing SW06-F proof transfers *application payloads*, not arbitrary IP packets. They must not be mistaken for an IP tunnel.

The app also declares an optional inactive Quick Settings tile as a convenient entry point. It does not claim to make SDPN a native cellular network operator.

### 3. iPhone/iPad and XR

On iOS/iPadOS, native network integration requires Apple Network Extension capabilities and the proper entitlement and review process (custom packet tunnels use Packet Tunnel Provider). Simple personal VPN profiles support specific built-in VPN protocols; the SW06-F application protocol is **not** automatically compatible with those. Nearby Wi-Fi SSIDs, however, appear normally when broadcast by an actual AP.

On Android-based XR headsets, use the native Android Wi-Fi and VPN APIs subject to device capability. On Apple spatial devices or other restricted wearables, use the platform vendor's approved Network Extension/enterprise networking APIs. Hardware vendors, OS policies, app signing, permissions and packet routing remain separate gates.

## Security and public claims

No implicit network switching, no hidden permissions, no VPN connection before a functioning authenticated gateway, no public internet port forwarding, no device identifier disclosure in public receipts, no claim of spectrum-free connectivity, and no production authorization inferred from a successful SW06-F receipt. Benchmarks must clearly separate application goodput, Wi-Fi link capacity, device-to-device transfer and internet reachability.

## Current deliverable

- Android native SW06-F sender and authenticated receipt verification candidate.
- Direct links to OS Wi-Fi and VPN settings; Quick Settings tile entry.
- Registered, **inactive** VPN-service integration boundary that deliberately refuses a fake connection.
- Router/AP SSID deployment instructions, and the protocol-to-IP gateway work still required.

## Graduation tests

1. Build Android APK in clean CI with a pinned Gradle + Android SDK toolchain.
2. Prove Android-to-PC encrypted SW06-F transfer on real Android and real Windows/Linux hardware.
3. Broadcast `Strata Data Port Network` on a controlled AP and verify it is selectable in stock device Settings.
4. Test network changes, rejoin, disconnect, malformed receipts, wrong secrets, and constrained network traffic without affecting the normal connection.
5. Implement and audit a real IP-packet VPN gateway before showing an **active** VPN profile or allowing system-wide routing.
6. Add iOS Network Extension and XR clients through platform-specific build and entitlement checks.

The Wi-Fi SSID and VPN mode are complementary—do not market either as bypassing the internet's physical infrastructure.
