#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "$#" -eq 0 ]; then set -- --output "$ROOT/integration/repos.lock.json"; fi
exec python3 "$ROOT/evidence/verification/world_tools.py" update-lock "$@"
