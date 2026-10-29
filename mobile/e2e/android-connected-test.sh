#!/usr/bin/env bash
# Runs inside the Android emulator job: pairs the installed test build with a
# fresh bridge. The emulator reaches its host at 10.0.2.2. The bridge starts
# only now because its pairing link expires after five minutes.
set -euo pipefail
link="$(mobile/e2e/start-bridge.sh 10.0.2.2)"
echo "pairing link: ${link%%\?*}?token=…"
cd mobile/android
./gradlew --no-daemon connectedDebugAndroidTest \
  "-Pandroid.testInstrumentationRunnerArguments.pairingLink=$link"
