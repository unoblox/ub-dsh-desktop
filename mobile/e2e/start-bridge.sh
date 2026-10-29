#!/usr/bin/env bash
# Starts the desktop's phone bridge in the background (bridge-server.ts) and
# prints its pairing link. Usage: mobile/e2e/start-bridge.sh <address the phone uses>
# Run from the repository root after `npm ci --ignore-scripts`. The bridge
# stops with the job; its log is mobile/e2e/.out/bridge.log.
set -euo pipefail
address="${1:?address the phone reaches this machine at}"
out=mobile/e2e/.out
mkdir -p "$out"
rm -f "$out/bridge.json"
npx --no-install esbuild mobile/e2e/bridge-server.ts --bundle --platform=node --format=esm \
  --packages=external --outfile="$out/bridge-server.mjs" --log-level=warning
BRIDGE_ADDRESS="$address" nohup node "$out/bridge-server.mjs" > "$out/bridge.json" 2> "$out/bridge.log" &
for _ in $(seq 1 100); do
  if [ -s "$out/bridge.json" ]; then
    node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).pairingUrl)' "$out/bridge.json"
    exit 0
  fi
  sleep 0.2
done
echo "the bridge did not start:" >&2
cat "$out/bridge.log" >&2
exit 1
