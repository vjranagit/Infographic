#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
test -d "$HERE/node_modules/@antv/infographic" -a -d "$HERE/node_modules/playwright" || { echo '{"ok":false,"error":"run scripts/setup.sh first"}'; exit 1; }
python3 "$HERE/scripts/build.py" "$1" "$2"
