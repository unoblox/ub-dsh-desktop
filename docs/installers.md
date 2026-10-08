# Installers for macOS, Windows and Linux

Each installer is built on its own operating system. `scripts/verify-target.mjs` refuses cross-builds, because the app ships native pieces (the Harness native loader, the Office Python payload and the LibreOffice engine) that must match the target.

| Platform | Installer | User experience |
| --- | --- | --- |
| macOS Apple Silicon / Intel | `.dmg` (plus `.zip`) | Open the dmg and drag the app to Applications. |
| Windows x64 | NSIS `…-setup.exe` | Run the setup, choose a folder, and get desktop and Start menu shortcuts. |
| Linux x64 | `.AppImage` | One file: `chmod +x` and double-click, or run it. No install step and no root. |

## Building

On the matching machine:

```bash
npm ci
npm run package:dev:mac:arm64   # or package:dev:mac:x64 on an Intel Mac
npm run package:dev:win         # Windows
npm run package:dev:linux       # Linux
```

Output goes to `dist-dev/`. The `package:dev:*` scripts use `electron-builder.dev.cjs`, which:

- uses its own app id, name and user data, so it never collides with a release install;
- publishes nothing;
- leaves the auto-update manager off. That matters for this fork: the release config's update feed (`dshdesktop.com`) belongs to upstream DSH Desktop. A release-config build would offer upstream's build, which has no Unoblox, as an "update".

`.github/workflows/build-installers.yml` (manual dispatch) builds all four installers on native GitHub runners and keeps them as workflow artifacts. GitHub Actions is currently disabled on this repository; enable it (Settings → Actions) before dispatching. The Linux job also runs `scripts/smoke-packaged-linux.mjs` against the packaged app under Xvfb.

## Linux specifics

- **Office:** the Python payload is pinned per target in `scripts/office-runtime/lock.json`. `linux-x64` and `linux-arm64` were added from the same upstream lock that the other targets came from. LibreOffice has no native Linux package in `@deepseek-ai/libreoffice-kit` 0.1.3, so Linux uses its WASM engine (conversion and rendering both verified). A patch to `libreoffice-kit` fixes its "is the native package installed?" check inside `app.asar`. There, Electron's `fs.lstatSync(…, { throwIfNoEntry: false })` returns `null` instead of `undefined`, so the kit reported an incomplete native engine instead of falling back to WASM.
- **AppImage and FUSE:** AppImages mount through FUSE 2. Ubuntu 22.04 and later do not install `libfuse2` by default. Users without it can either install it (`sudo apt install libfuse2t64` on 24.04) or run `./dsh-desktop-…AppImage --appimage-extract-and-run`.
- **Sandbox on Ubuntu 24.04:** AppArmor restricts unprivileged user namespaces, which Chromium's sandbox uses. If the AppImage exits at once with a sandbox error, that is the cause. A signed `.deb` with an AppArmor profile is the long-term fix; `--no-sandbox` works as a stopgap.
- **No `.deb` yet:** a `.deb` needs a maintainer name and email. `package.json` still names upstream's author, so the target is off until a maintainer is chosen. Add `"maintainer": "Name <email>"` under `build.linux` and a `deb` entry to `build.linux.target`.

## Verified on Linux x64 (2026-10-07, Ubuntu 24.04 container, Xvfb)

- `npm run build` and `electron-builder --linux --config electron-builder.dev.cjs` pass, including every after-pack gate: ASAR unpack, packaged PPT runtime, Office Python smoke, and LibreOffice (WASM) conversion.
- `scripts/smoke-packaged-linux.mjs` passes against `linux-unpacked` and the extracted AppImage. It checks the real `web` profile (not Safe Mode), Harness ready in about 5 s, token login, bootstrap registration, workspace and session creation, and the Unoblox info route.
- A first-run journey in the real Electron window (driven over CDP, temporary HOME, key not in the environment):
  1. The first-run dialog shows, with a password-type key field.
  2. "Connect and continue" stores the key in the credential store.
  3. A chat turn and a `web_search` turn complete through Unoblox.
  4. The composer dock shows the Unoblox balance and the routed model as icon pills, on the same row as the stock stats.
- Not verified here: macOS and Windows installers (they need native runners), AppImage under real FUSE and the desktop's AppArmor policy, and Wayland sessions.

## Not done by these builds

- **Signing.** macOS builds are unsigned and not notarized, so Gatekeeper blocks the first open (right-click → Open, or System Settings → Privacy & Security → Open Anyway). Windows builds are unsigned, so SmartScreen shows "Windows protected your PC" (More info → Run anyway). Signed releases need the publisher's certificates; see `release.yml` and `docs/release-runbook.md`.
- **Release identity.** The release config still carries upstream's identity: app id `io.dsh.desktop`, product name "DSH Desktop", Windows `publisherName`, the update feed and the crash-report endpoint `https://dshdesktop.com/crash`. Crash reports are only sent after the user agrees in a dialog. A release of this fork needs its own values for all of these.
