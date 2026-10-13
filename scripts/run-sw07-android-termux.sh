#!/data/data/com.termux/files/usr/bin/bash
# Android/Termux sender. Runs the existing SDPN cryptographic protocol unchanged.
set -Eeuo pipefail
if [[ $# -ne 1 ]]; then
  printf 'Usage: bash scripts/run-sw07-android-termux.sh RECEIVER_PRIVATE_IPV4\n' >&2
  exit 2
fi
host="$1"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
command -v node >/dev/null || { echo "Install Node.js 22+ in Termux" >&2; exit 1; }
[[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ]] || { echo "Node.js >=22 required" >&2; exit 1; }
node -e 'import("./scripts/benchmark-two-host.mjs").then(x=>x.requirePrivateIpv4(process.argv[1])).then(x=>{if(x.isLoopback)process.exit(1)}).catch(e=>{console.error(e.message);process.exit(1)})' "$host" || exit 2
mkdir -p "$repo/.local-evidence/sw07-mobile"
if [[ -z "${KINDRED_SDPN_PROOF_SECRET:-}" ]]; then
  IFS= read -r -s -p 'One-time receiver pairing secret: ' KINDRED_SDPN_PROOF_SECRET
  printf '\n'
  export KINDRED_SDPN_PROOF_SECRET
  trap 'unset KINDRED_SDPN_PROOF_SECRET' EXIT
fi
[[ ${#KINDRED_SDPN_PROOF_SECRET} -ge 32 ]] || { echo "Secret must be >=32 characters" >&2; exit 1; }
batch="$(date -u +%Y%m%dT%H%M%SZ)-$$"
for round in 1 2 3; do
  output="$repo/.local-evidence/sw07-mobile/phone-${batch}-${round}.json"
  node scripts/benchmark-two-host.mjs --host "$host" --port 47900 --sizes-mib 1,4,16 --trials 12 --warmup 2 --timeout-ms 30000 --output "$output"
  sha256sum "$output"
done
echo "SW07 Android phone-to-computer proof evidence saved locally."
echo "Software proof only; physical identity and production readiness remain unverified."
