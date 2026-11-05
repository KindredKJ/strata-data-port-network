# SDPN Fast-Path Adapter v1 — Architecture and Evidence Contract

**Status:** Architecture proposal. No kernel adapter, OS driver, deployment, or performance gain is claimed here.

## Objective

Add an optional high-performance carrier to SDPN while preserving its logical Port identity, Tesseract state contract, authorization, and replaceable-substrate model. The adapter accelerates only explicitly selected SDPN sessions. It must leave unrelated host traffic on the operating system’s normal network path.

## Layering decision

“Under TCP/IP” has two deployment meanings, and SDPN must state which one a result uses:

1. **Host fast path:** on Linux, XDP can classify frames before the ordinary host IP stack. Selected SDPN frames may be redirected to an AF_XDP socket; all other frames pass to the normal stack. This is a host adapter, not a new global Internet underlay.
2. **Internet-compatible carrier:** between sites, carry SDPN sessions over UDP/IP. Prefer QUIC DATAGRAM for unreliable message delivery with QUIC connection security and congestion control. UDP-based designs must provide congestion control and path-MTU handling. QUIC DATAGRAM is still carried over UDP/IP; it does not sit below IP.
3. **Managed Layer 2 fabric:** a future Ethernet adapter may operate below IP inside a controlled network only when every participating NIC, switch, and link supports it. It cannot cross ordinary Internet transit as a new raw Layer 2 protocol.

The existing logical Port namespace remains independent of IP addresses. Every adapter record declares the actual carrier, reachability, security boundary, MTU, and measured performance. This is additive to the current master architecture.

## Linux v1 target

- Use XDP to match only provisioned SDPN tunnel traffic and redirect its receive queue to AF_XDP. Unmatched traffic uses XDP_PASS.
- Detect AF_XDP zero-copy support at runtime. Use zero-copy only when the selected NIC and driver advertise it; otherwise use the supported copy path or disable that acceleration mode. Never report zero-copy from API selection alone.
- Keep packet handling deterministic and bounded in the kernel. Do not run NTSA-X inference, cryptography with unbounded work, or route discovery in the per-packet BPF path.
- Run NTSA-X in the control plane to rank candidate paths or queues from verified telemetry. The control plane publishes bounded, expiring route/queue decisions; deterministic code validates and applies them.
- Reuse SDPN Port Zero identity, peer consent, and session policy at the endpoint boundary. Do not let the fast path create identity, grant authority, or bypass revocation.

Linux kernel references: [AF_XDP](https://docs.kernel.org/networking/af_xdp.html) documents copy and zero-copy modes and feature probing; [XDP/NAPI](https://docs.kernel.org/networking/napi.html) describes the kernel networking path.

## Platform sequence

| Platform | Adapter direction | Release boundary |
|---|---|---|
| Linux servers | XDP + AF_XDP fast path, with ordinary-stack fallback | First pilot; qualify exact kernel, NIC, driver, queue, and privilege combination |
| Windows Server | Separate WFP or NDIS filter implementation | Later platform-specific driver package and qualification; no shared Linux driver binary |
| Operator fabric | Optional Ethernet/Layer 2 adapter | Only in a managed fabric with end-to-end device and switch support |

Microsoft documents WFP callouts for advanced TCP/IP data processing and NDIS lightweight filters for traffic between protocol and miniport drivers. These are separate operating-system integration points, not proof of a universal latency improvement.

## Performance evidence

The 40% latency reduction is a target, not an established property of NTSA-X or SDPN. A result must be limited to the exact supported workload and hardware matrix.

Use the existing [SW06-G physical-host qualification](https://github.com/KindredKJ/strata-data-port-network/issues/22): two independently identified physical hosts; identical NICs, links, payloads, encryption, and settings; forward and reverse runs; warm-ups and repeated trials; loss, jitter, disconnect, and recovery cases. Preserve a new evidence file and leave historical receipts unchanged.

Record p50, p95, and p99 end-to-end latency, application goodput, wire throughput, CPU per useful bit, memory, packet loss, MTU behavior, reconnection/recovery, and measurement variability. Compare the existing SDPN transport and the fast path under the same conditions. Publish a 40% claim only for metrics and cases that independently meet it; do not generalize a single-host, VM, or loopback result.

## Security and operations contract

- Authenticate both peers and bind every fast-path session to its SDPN identity, authorization, expiry, and revocation state.
- Enforce congestion control, anti-replay, bounded queues, packet-size limits, and path-MTU discovery. A faster queue must not create unfairness or congestion collapse.
- Keep the normal route available for unmatched traffic and a documented recovery path for SDPN sessions if the adapter is unavailable.
- Emit opt-in, minimized operational counters with clear retention. Do not route payloads or user-identifying flow records to Kindred infrastructure by default.
- Ship separate signed packages per OS; document kernel/driver support, required privileges, install/uninstall, downgrade policy, and rollback before any public release.

Relevant standards: [RFC 9000, QUIC](https://www.rfc-editor.org/rfc/rfc9000.html); [RFC 9221, QUIC DATAGRAM](https://www.rfc-editor.org/rfc/rfc9221.html); [RFC 8085, UDP usage and congestion guidance](https://www.rfc-editor.org/rfc/rfc8085.html).

## Adoption path

Adoption should come from open specifications, interoperable reference implementations, measured benefits, and operator partnerships. For global inter-AS routing, operators must explicitly peer and exchange reachability; BGP is the established inter-Autonomous-System routing protocol ([RFC 4271](https://www.rfc-editor.org/rfc/rfc4271.html)). An endpoint adapter alone cannot make SDPN the global routing fabric or cause all traffic metrics to pass through Kindred infrastructure.

## Release sequence

1. Implement the Linux pilot as an isolated, opt-in adapter without changing the existing logical protocol or default route.
2. Run the SW06-G physical-host qualification and preserve the exact commit, hardware/driver matrix, commands, raw results, and independent review.
3. Add the Windows implementation only after the wire contract and benchmark show a real benefit; qualify it independently.
4. Publish a versioned interoperability specification and pursue operator trials and standards review before any global-routing claim.

**Not established by this proposal:** a 40% latency decrease, physical zero-copy, broad OS support, global reachability, operator adoption, NTSA-X acceleration of packet forwarding, or production readiness.