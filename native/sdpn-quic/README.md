# SDPN QUIC transport pilot

**Creator:** Kindred Jermaine Cox  
**Organization:** Kindred Labs  
**Wire profile:** `kindred.sdpn.quic-wire.v1`  
**ALPN:** `sdpn/1`

This is the first native QUIC socket for the SDPN profile. It is a Linux C++20 pilot built on Microsoft's MsQuic v2.6.3, pinned to release commit `16ca4d8d785d34fb22285e7c652e477ac16475a5`. The endpoint uses QUIC v1/TLS 1.3, mutual certificate authentication, reliable bidirectional streams, and the profile's 12-byte stream-record header.

## Scope

The `TRANSPORT_PROBE` (`0x30`) and `TRANSPORT_ECHO` (`0x31`) records are diagnostics. They carry an 8-byte sequence followed by opaque test bytes. They are not native state frames, do not establish a Port session, and cannot activate the local SDPN adapter gate. The client report explicitly records `fortyPercentGatePassed: false`, `physicalHostAttestationProven: false`, `packetLossMeasured: false`, `routeTableChanges: false`, and `trafficRedirected: false`.

The listener accepts a literal RFC1918 IPv4 address only. `--allow-loopback` is reserved for local integration tests. It rejects wildcard and public binds. It opens only the QUIC UDP listener and does not add routes, change the default route, alter BGP, or redirect existing application traffic. Reachability uses the host operator's already configured UDP/IP path.

Each client sample includes a fresh QUIC handshake plus one reliable stream echo. This is diagnostic end-to-end exchange latency, not a paired baseline comparison and not the three consecutive five-minute activation evidence. Keep server and client certificates and keys under operator control; the configured CA must issue both the server and client certificates. The server certificate must have the endpoint IPv4 address in its IP subject alternative name.

## Build and local integration test

```sh
cmake -S native/sdpn-quic -B build/sdpn-quic -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON
cmake --build build/sdpn-quic --parallel 2
ctest --test-dir build/sdpn-quic --output-on-failure
```

The build fetches MsQuic at the pinned commit and its recorded QuicTLS submodule. The integration test creates a short-lived local CA and mTLS certificates, starts the listener on loopback, performs three real QUIC stream round trips, and checks that the result remains diagnostic.

## Two-host pilot

Provision a private CA and issue distinct client and server certificates. Keep private keys on their respective hosts with owner-only permissions. Install the CA certificate, server certificate, and server key on host B; install the CA certificate, client certificate, and client key on host A. Ensure the certificates use TLS server/client extended key usage and that host B's certificate contains its private IPv4 address as an IP SAN.

On host B, bind the QUIC listener to its specific private interface address:

```sh
./build/sdpn-quic/sdpn-quic-pilot server \
  --bind-address "$SDPN_HOST_B_PRIVATE_IPV4" --port 47901 \
  --cert /etc/sdpn/server.crt --key /etc/sdpn/server.key \
  --ca /etc/sdpn/ca.crt
```

On host A, create a new evidence path and run the client. The client accepts 30–120 second operation timeouts, with a 120-second default:

```sh
./build/sdpn-quic/sdpn-quic-pilot client \
  --server-address "$SDPN_HOST_B_PRIVATE_IPV4" --port 47901 \
  --cert /etc/sdpn/client.crt --key /etc/sdpn/client.key \
  --ca /etc/sdpn/ca.crt --trials 60 --payload-bytes 65536 \
  --timeout-ms 120000 \
  --output "./sdpn-quic-$(date -u +%Y%m%dT%H%M%SZ).json"
```

Allow inbound UDP/47901 only between the two pilot hosts using the operators' existing host firewall policy. No global route, default route, BGP/transit policy, DNS record, or application traffic is changed. The pilot does not include a Windows driver, XDP/AF_XDP redirector, production service manager, public listener, or automatic rollback/redirect path. Do not use its samples as activation-gate evidence until they are paired with the baseline transport and the existing signed physical-witness verifier requirements.
