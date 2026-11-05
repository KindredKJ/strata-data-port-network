# SDPN UDP/QUIC Wire Profile v1

**Creator:** Kindred Jermaine Cox  
**Founder and project authority:** Kindred Jermaine Cox  
**Project:** Kindred Labs / Strata Data Port Network  
**Official project domain:** kindredlabs.ai  
**Profile ID:** `kindred.sdpn.quic-wire.v1`  
**ALPN:** `sdpn/1`

Kindred Jermaine Cox created SDPN. Kindred Labs, under his direction, controls the official profile registry, release signing policy, reference implementations, and official SDPN infrastructure. The profile does not transfer ownership of the project or `kindredlabs.ai` domains.

## Founder directive and status

The founder’s vision is to establish SDPN as a data-transport layer integrated beneath standard host networking, use NTSA-X’s non-Transformer, tokenless state processing in the system, and pursue at least 40% lower latency. The long-term ambition is a globally useful SDPN fabric whose participating operators can send agreed performance metrics to Kindred Labs infrastructure.

These are founder goals. This repository does not yet demonstrate NTSA-X accelerating packet forwarding, a 40% latency reduction, a server driver release, global deployment, or centralized network telemetry. The phrase “teleport data” describes the Port-to-Port user experience of authenticated state transfer and destination reconstruction.

## Layering and reachability

SDPN has **no logical routing layer**. A Port ID is a cryptographic endpoint identity; it does not encode a network address. SDPN does not discover routes, forward third-party packets, modify host routes, change default routes, advertise BGP prefixes, or operate transit.

For global online reach, a peer must already be reachable through its operator-provisioned endpoint using the host’s existing Internet connection. This v1 profile uses QUIC over UDP/IP, so the existing TCP/IP underlay and Internet routing provide reachability. The SDPN wire protocol itself performs no routing.

On Linux, a future XDP/AF_XDP adapter may redirect only matched SDPN frames locally into the adapter before normal host-stack processing. It does not rewrite the host routing table or act as a transit router. Other operating systems require separate native adapters.

## Transport profile

| Parameter | V1 requirement |
|---|---|
| QUIC | QUIC v1, RFC 9000 |
| TLS | TLS 1.3 through QUIC |
| ALPN | `sdpn/1`; reject unknown or lower versions without fallback |
| State data | Reliable QUIC bidirectional streams |
| Latency probes | QUIC DATAGRAM, RFC 9221, only after the peer negotiates a non-zero datagram limit |
| Online carrier | UDP over the endpoint’s existing IPv4/IPv6 connectivity |
| SDPN route tables | None |

QUIC protects the online connection. SDPN Port records and native sessions continue to enforce peer identity, consent, expiry, revocation, and end-to-end state-frame authentication.

## Stream record framing

Each record on an SDPN QUIC stream has a 12-byte header followed by its body. Integers are unsigned and big-endian.

| Offset | Bytes | Field |
|---:|---:|---|
| 0 | 4 | ASCII magic `SDPN` |
| 4 | 1 | Wire version, exactly `1` |
| 5 | 1 | Record type |
| 6 | 2 | Flags, reserved and exactly zero |
| 8 | 4 | Body length in bytes |
| 12 | variable | Body |

Maximum native ciphertext is 32 MiB. Maximum record body is 32 MiB plus the 40-byte native-frame prefix. Receivers reject unknown types, unsupported versions, non-zero reserved bits, over-limit lengths, truncated records, and trailing bytes.

| Type | Name | Body |
|---:|---|---|
| `0x01` | `PORT_BIND` | Canonical JSON signed SDPN peer record; verify with the existing native identity verifier |
| `0x02` | `SESSION_OFFER` | Canonical JSON signed native-session offer |
| `0x03` | `SESSION_ACCEPT` | Canonical JSON signed native-session acceptance |
| `0x10` | `NATIVE_FRAME` | Binary session frame, defined below |
| `0x20` | `RECEIPT` | Canonical JSON SDPN receipt |

Canonical JSON is produced and checked with the existing `canonicalBytes` implementation. Control records never grant authority by themselves; existing SDPN policy and peer verification still apply.

### Native frame body

The `NATIVE_FRAME` body is the existing encrypted native-session frame encoded without base64 expansion:

| Offset | Bytes | Field |
|---:|---:|---|
| 0 | 16 | Session UUID bytes, network order |
| 16 | 8 | Sequence number, unsigned big-endian; current native-session limit is 0–1023 |
| 24 | 16 | AES-GCM authentication tag |
| 40 | variable | Ciphertext, at most 32 MiB |

The stream record sequence and session UUID must match the authenticated native session. QUIC stream ordering supplies reliable transport; the receiver still enforces native-session sequence, authentication, state scope, and quotas.

## QUIC DATAGRAM probe

Data state travels on reliable streams. DATAGRAM is used only for optional latency probes; losing a probe never loses state.

Each probe or echo is exactly 40 bytes:

| Offset | Bytes | Field |
|---:|---:|---|
| 0 | 4 | ASCII magic `SDPN` |
| 4 | 1 | Wire version, exactly `1` |
| 5 | 1 | `0x40` probe or `0x41` echo |
| 6 | 2 | Flags, reserved and exactly zero |
| 8 | 16 | Native session UUID |
| 24 | 8 | Probe sequence, unsigned big-endian |
| 32 | 8 | Sender monotonic timestamp in nanoseconds |

The echo returns the session UUID, sequence, and timestamp unchanged. The sender measures RTT with its own monotonic clock; peers do not need synchronized clocks. Receivers reject malformed, unknown-version, wrong-length, or unnegotiated datagrams.

## Local activation gate

The local adapter may redirect a provisioned SDPN session only after three consecutive five-minute windows, each with at least 60 successful paired end-to-end samples. For every window, p95 candidate latency must be 40% or more below the existing baseline; candidate p99 and packet loss must be no worse. A required injected evidence-verification callback must validate signed measurements, physical-host qualification, peer/session/workload binding, and freshness for every window; unavailable or invalid verification keeps the session on baseline. A failed active window immediately restores that session to the baseline adapter. A restarted process returns to baseline and must qualify again.

This gate changes only local delivery of that SDPN session. It does not change host/default routes, BGP, transit, or unrelated traffic. A per-session 40% result is not a universal claim about other peers, workloads, or networks.

## Metrics and founder control

The official profile defines latency, loss, throughput, and adapter-capability measurements for participating nodes. Kindred Labs controls the official telemetry endpoint and profile releases. Operators explicitly configure telemetry participation; state payloads and credentials are never part of this profile’s metrics.

## Implementation status

Repository code provides the binary record codec and deterministic activation-gate policy. The gate requires an injected evidence verifier and will remain on baseline without one. This branch does not yet provide a QUIC socket implementation, XDP/AF_XDP driver, Windows driver, production evidence verifier or activation callback, physical-host qualification receipt, or deployed telemetry endpoint. No network or domain configuration is changed by defining this profile.

## Standards

- [RFC 9000 — QUIC](https://www.rfc-editor.org/rfc/rfc9000.html)
- [RFC 9221 — QUIC DATAGRAM](https://www.rfc-editor.org/rfc/rfc9221.html)
- [RFC 8085 — UDP Usage Guidelines](https://www.rfc-editor.org/rfc/rfc8085.html)
- [Linux AF_XDP documentation](https://docs.kernel.org/networking/af_xdp.html)