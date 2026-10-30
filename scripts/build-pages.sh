#!/usr/bin/env bash
# Builds the static GitHub Pages version into ./out
# (no server: data is stored in the browser, admin passkey gate runs client-side).
set -euo pipefail
cd "$(dirname "$0")/.."
STASH=.pages-stash
mkdir -p "$STASH"
restore() {
  [ -d "$STASH/api" ] && mv "$STASH/api" app/api
  [ -f "$STASH/proxy.ts" ] && mv "$STASH/proxy.ts" proxy.ts
  [ -f "$STASH/instrumentation.ts" ] && mv "$STASH/instrumentation.ts" instrumentation.ts
  rmdir "$STASH" 2>/dev/null || true
}
trap restore EXIT
mv app/api "$STASH/api"
mv proxy.ts "$STASH/proxy.ts"
mv instrumentation.ts "$STASH/instrumentation.ts"
STATIC_EXPORT=1 NEXT_PUBLIC_DATA_MODE=local NEXT_PUBLIC_BASE_PATH="${BASE_PATH-/attendance-system}" npx next build
touch out/.nojekyll
echo "Static site written to ./out"
