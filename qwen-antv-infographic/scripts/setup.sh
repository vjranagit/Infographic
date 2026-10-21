#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
npm install --prefix "$HERE" --no-save --no-package-lock @antv/infographic@0.2.20 vite@6 playwright@1.57
npx --yes playwright@1.57 install chromium
