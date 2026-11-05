#!/usr/bin/env bash
set -euo pipefail

binary="${1:?path to sdpn-quic-pilot required}"
tmp="$(mktemp -d)"
server_pid=""
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 ]]; then
    for log in server.log client.log report.json; do
      if [[ -s "$tmp/$log" ]]; then
        printf '\n===== %s =====\n' "$log" >&2
        cat "$tmp/$log" >&2
      fi
    done
  fi
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp"
  exit "$status"
}
trap cleanup EXIT

openssl req -x509 -newkey rsa:3072 -nodes -days 1 -keyout "$tmp/ca.key" \
  -out "$tmp/ca.crt" -subj "/CN=SDPN QUIC Pilot Test CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

for identity in server client; do
  openssl req -newkey rsa:2048 -nodes -keyout "$tmp/$identity.key" \
    -out "$tmp/$identity.csr" -subj "/CN=$identity.sdpn.test"
  if [[ "$identity" == server ]]; then
    usage="serverAuth"
    san="subjectAltName=IP:127.0.0.1,DNS:localhost"
  else
    usage="clientAuth"
    san="subjectAltName=DNS:client.sdpn.test"
  fi
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=%s\n%s\n' \
    "$usage" "$san" > "$tmp/$identity.ext"
  openssl x509 -req -in "$tmp/$identity.csr" -CA "$tmp/ca.crt" \
    -CAkey "$tmp/ca.key" -CAcreateserial -days 1 -sha256 \
    -extfile "$tmp/$identity.ext" -out "$tmp/$identity.crt"
done

if "$binary" server --bind-address 0.0.0.0 --port 47901 \
  --cert "$tmp/server.crt" --key "$tmp/server.key" --ca "$tmp/ca.crt" \
  >"$tmp/wildcard.log" 2>&1; then
  echo "wildcard listener unexpectedly accepted" >&2
  exit 1
fi
grep -q 'endpoint must be RFC1918 IPv4' "$tmp/wildcard.log"

"$binary" server --bind-address 127.0.0.1 --allow-loopback --port 47901 \
  --cert "$tmp/server.crt" --key "$tmp/server.key" --ca "$tmp/ca.crt" \
  >"$tmp/server.log" 2>&1 &
server_pid=$!
for _ in $(seq 1 100); do
  if grep -q 'SDPN_QUIC_PILOT_READY' "$tmp/server.log"; then break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then cat "$tmp/server.log"; exit 1; fi
  sleep 0.1
done
grep -q 'SDPN_QUIC_PILOT_READY' "$tmp/server.log" || { cat "$tmp/server.log"; exit 1; }

"$binary" client --server-address 127.0.0.1 --allow-loopback --port 47901 \
  --cert "$tmp/client.crt" --key "$tmp/client.key" --ca "$tmp/ca.crt" \
  --trials 3 --payload-bytes 4096 --timeout-ms 30000 \
  > "$tmp/report.json" 2> "$tmp/client.log"
grep -q '"classification": "DIAGNOSTIC_NOT_GATE_EVIDENCE"' "$tmp/report.json"
grep -q '"successfulExchanges": 3' "$tmp/report.json"
grep -q '"fortyPercentGatePassed": false' "$tmp/report.json"
grep -q '"routeTableChanges": false' "$tmp/report.json"
grep -q '"trafficRedirected": false' "$tmp/report.json"
echo "mTLS QUIC loopback stream round-trip passed; artifact correctly remains diagnostic."
