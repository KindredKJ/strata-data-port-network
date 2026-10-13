# SW07 — Windows-hosted “Strata Data Port Network” Wi-Fi pilot

The requirement is a native OS network list entry. The only legitimate way to make the exact network name appear in **Settings → Wi-Fi → Available networks** is to have an actual compatible Wi-Fi radio/router advertise the SSID. A mobile app cannot make an imaginary SSID appear as a normal nearby Wi-Fi access point.

## Fastest physical Wi-Fi pilot using a Windows 11 computer

1. On a Windows 11 laptop with a supported Wi-Fi adapter, open **Settings → Network & internet → Mobile hotspot**.
2. Share the computer's existing authorized network connection **over Wi-Fi** (only if supported). In **Properties → Edit**, choose network name **Strata Data Port Network** and a strong unique network password.
3. Turn **Mobile hotspot** on. If Windows cannot provide a hotspot or internet-share capability, use a dedicated WPA2/WPA3 router/access point instead. Do not claim a radio-based SSID is available if no transmitter is broadcasting.
4. On your Android phone, open **Settings → Connections / Network & internet → Wi-Fi**, find **Strata Data Port Network**, and join using the password. On iPhone/iPad, use **Settings → Wi‑Fi**.
5. Confirm the phone has a local private IP and can reach the authorized computer across that LAN. Windows network/firewall profile and hotspot client isolation must allow the intentionally scoped TCP 47900 SW06-F proof receiver. Never expose this port publicly.
6. Run the SW06-F receiver from the pinned source on the computer, then use the Android native application to pair and perform a **verified encrypted application-level transfer**. This does **not** automatically enable device-wide SDPN routing.

## What the pilot does and does not establish

It proves the desired *human-facing network selection workflow* using an ordinary AP/SSID, subject to independent phone and radio verification. The Wi-Fi connection itself is not a new physical networking medium. Without an SDPN gateway, the SSID is a branded local Wi-Fi network, not a general-purpose replacement internet, and any upstream internet still relies on the existing provider.

A real SDPN network deployment adds an authenticated multi-device control plane, gateway, routing/recovery, name resolution, lifecycle provisioning, revocation and port authorization. For off-LAN operation, the client will need a real system VPN/packet tunnel or native network extension with user approval. An inactive Android VpnService declaration must not impersonate an active connection.

## Technical acceptance criteria

- The SSID is visible among unmodified stock Android/iOS Wi-Fi scan results *while an authorized AP is broadcasting*.
- The phone joins and obtains a valid LAN address with WPA2/WPA3 protection.
- An encrypted SW06-F mobile → PC transfer succeeds with integrity-verified receipts; a wrong secret fails.
- The phone retains normal network access and can disconnect/rejoin safely.
- Wi-Fi channel/spectrum, AP model, source hardware, negotiated link rate, application goodput and actual internet capability are recorded separately.
- No physical-zero-copy, spectrum-free, production authorization or internet-replacement claims are inferred from the SSID.

For a multi-site deployment use provisioned SDPN Wi-Fi gateway hardware and independently validated packet transport, not merely a hotspot name.
