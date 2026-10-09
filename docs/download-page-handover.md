# Handover: public download page and one-command install for unoblox works

Status: brief for the agent that builds this, written 2026-10-08. Nothing below exists yet unless marked **exists**. Decisions that belong to the product owner are listed in section 10; ask before choosing.

## 1. Goal

People install **unoblox works** (the desktop app in this repository, always written in lowercase) with one command that downloads, verifies, installs and opens it, with **no Gatekeeper or SmartScreen confirmation**, and with no GitHub account or other tools.

| OS | Command the page shows |
| --- | --- |
| macOS (Apple Silicon) and Linux x64, in Terminal | `curl -fsSL https://unoblox.ai/install.sh \| bash` |
| Windows 10/11 x64, in PowerShell | `irm https://unoblox.ai/install.ps1 \| iex` |
| Windows, from Command Prompt or Win+R | `powershell -ExecutionPolicy Bypass -NoProfile -Command "irm https://unoblox.ai/install.ps1 \| iex"` |

The URLs are placeholders until the owner picks hosting (section 10). There is no single command that runs unchanged on all three systems (Windows has no `bash`), so the page detects the visitor's OS and shows the matching command, with tabs for the others.

Deliverables:

1. Public hosting for the installers and a `latest.json` manifest (section 4).
2. A publish step in CI that fills that hosting from a green build (section 5).
3. `install.sh` and `install.ps1` (section 6).
4. The download page (section 7).
5. CI that runs the published one-liners on real macOS, Windows and Linux runners and launch-tests the installed app (section 8).

## 2. Why a command avoids the prompts

- **macOS:** Gatekeeper checks an app only if its files carry the `com.apple.quarantine` attribute. Browsers, Mail and AirDrop add it; `curl` does not. The beta is ad-hoc signed (a valid signature with no Apple certificate), so without quarantine it opens directly. The script also runs `xattr -dr com.apple.quarantine` on the installed app in case anything added the mark.
- **Windows:** SmartScreen checks files carrying the Mark of the Web (the `Zone.Identifier` stream). Browsers add it; `Invoke-WebRequest` and `curl.exe` do not. The script still runs `Unblock-File` on the installer before starting it.
- **Linux:** no equivalent check. The `.deb` sets up Chromium's sandbox and the AppArmor profile Ubuntu 24.04+ needs; installing it needs `sudo`.

Limits to state on the page and keep in mind:

- Anyone who downloads the `.dmg` or `.exe` with a browser still gets the prompt. Only paid signing fixes that: Apple Developer ID plus notarization, and a Windows code-signing certificate.
- **Windows Smart App Control** (on by default on some clean Windows 11 installs) blocks unsigned apps whatever their origin. The script cannot get around it: detect it and say so (section 6.3).
- Company-managed Macs and PCs (MDM, AppLocker, WDAC) may block unsigned apps. Apple or Microsoft can tighten these rules in future OS releases. Signing is the durable fix; this is the beta's free route.
- A script piped into a shell is only as trustworthy as its host. Serve everything over HTTPS from a domain unoblox controls, verify SHA-256 checksums, and keep the scripts short and readable.

## 3. What exists today

**Exists**, in this repository (`unoblox/ub-dsh-desktop`, private), on branch `claude/charming-bohr-lpab0z`:

| Item | Facts |
| --- | --- |
| Product | Name `unoblox works` (lowercase; `src/shared/brand.ts`). App id `ai.unoblox.works`. Version from `package.json` (`0.1.1` now). Electron 43, electron-builder 26.15.3. |
| Build workflow | `.github/workflows/build-installers.yml` ("Build beta installers"). It runs on `workflow_dispatch` with input `target` = `all`, `macos`, `windows` or `linux`. Each platform builds, tests, packages with `electron-builder.beta.cjs`, launch-tests the packaged app (`scripts/smoke-packaged.mjs`), then uploads an Actions artifact (14-day retention, login required). Latest all-green run: `37802448262` (commit `e9504a4`). |
| Artifacts | `unoblox-beta-macos-apple-silicon`, `unoblox-beta-windows-x64`, `unoblox-beta-linux-x64`. |
| Files inside | `unoblox-works-beta-<version>-mac-arm64.dmg` · `unoblox-works-beta-<version>-windows-x64-setup.exe` · `unoblox-works-beta-<version>-linux-amd64.deb` · `unoblox-works-beta-<version>-linux-x86_64.AppImage` |
| macOS | Apple Silicon only. Ad-hoc signed (`identity: '-'`), hardened runtime off, not notarized. The DMG holds `unoblox works.app` and an Applications link. |
| Windows | Unsigned NSIS installer (`oneClick: false`). A silent install (`/S`) installs for the current user under `%LOCALAPPDATA%\Programs\unoblox works\unoblox works.exe`; verify this on a runner. |
| Linux | `.deb` package `unoblox-works` (conflicts with and replaces the first betas' `unoblox`). Installs to `/opt/unoblox works/`, links the command `unoblox-works`, adds a menu entry and the AppArmor profile. Depends on libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1 and libsecret-1-0. The AppImage needs FUSE 2 and cannot use Chromium's sandbox on Ubuntu 24.04+. |
| User data | Kept across reinstalls and renames. macOS `~/Library/Application Support/dsh-desktop`, Windows `%APPDATA%\dsh-desktop`, Linux `~/.config/dsh-desktop`. Installers and scripts must never delete it. |
| Earlier betas | Installed as "unoblox" (`/Applications/unoblox.app`, Windows app "unoblox", deb `unoblox`). The scripts should mention they can be removed, never remove them silently. |
| Reference scripts | `scripts/install-beta.sh` and `scripts/install-beta.ps1` install from Actions artifacts through the GitHub CLI. They are internal only, but their install steps (DMG mount, `ditto`, quitting the running app, silent NSIS, apt) are the starting point for the public scripts. |
| Privacy rule | The app collects no usage data and contacts nothing but `api.unoblox.ai` on its own (`docs/privacy.md`). The install scripts and download page must keep that promise: no analytics calls, install pings or third-party trackers, unless the owner decides otherwise for the web page. |

## 4. Hosting and the release manifest

Requirements: public HTTPS, no login, stable URLs, large files (the DMG and `.deb` are around 250 MB each), and Range/resume support if possible.

**Recommended:** a public repository `unoblox/unoblox-works-releases` (name to confirm), holding only releases, with no source code. GitHub Releases serves any size of file for free from a CDN, and `https://github.com/<owner>/<repo>/releases/latest/download/<file>` always points at the newest release. The scripts and page are served from `unoblox.ai`, which can also redirect `/download/<platform>` to the release asset.

Alternatives are object storage behind a CDN (Cloudflare R2, S3 plus CloudFront) on a `dl.unoblox.ai` subdomain, or making this repository public, which the owner may not want.

Each release carries a manifest, `latest.json`, that the scripts read, so they never guess file names:

```json
{
  "name": "unoblox works",
  "version": "0.1.1",
  "channel": "beta",
  "published": "2026-10-08T16:00:00Z",
  "commit": "e9504a4",
  "files": {
    "macos-arm64":    { "url": "https://…/unoblox-works-beta-0.1.1-mac-arm64.dmg",              "sha256": "…", "size": 0 },
    "windows-x64":    { "url": "https://…/unoblox-works-beta-0.1.1-windows-x64-setup.exe",      "sha256": "…", "size": 0 },
    "linux-x64-deb":  { "url": "https://…/unoblox-works-beta-0.1.1-linux-amd64.deb",            "sha256": "…", "size": 0 },
    "linux-x64-appimage": { "url": "https://…/unoblox-works-beta-0.1.1-linux-x86_64.AppImage", "sha256": "…", "size": 0 }
  }
}
```

Keep a stable manifest URL (for example `https://unoblox.ai/works/latest.json`, or the release asset `…/releases/latest/download/latest.json`). Also publish `SHA256SUMS` for people who verify by hand.

## 5. Publish step (CI)

Add a job to `build-installers.yml`, or a separate `publish-beta.yml` triggered by `workflow_run` or dispatch, that:

1. Runs only when the owner asks (a `publish: true` dispatch input) and only after all three platform jobs passed. Never publish a build that failed its smoke test.
2. Downloads the three artifacts (`actions/download-artifact`), computes SHA-256 and size for each file, and writes `latest.json` and `SHA256SUMS`.
3. Creates a release in the public releases repository, tagged `v<version>-beta.<run number>` or as the owner prefers, and uploads the four installers, `latest.json` and `SHA256SUMS`. Use a fine-grained token limited to that repository's contents, stored as a secret (for example `RELEASES_TOKEN`), or a GitHub App. Never put tokens or API keys in files or logs.
4. Uploads or updates `install.sh`, `install.ps1` and the stable `latest.json` copy wherever the website serves them, or opens a PR on the website repository.
5. Checks every URL in the manifest anonymously (`curl -fsSIL`) before finishing.

Versioning: today every beta is `0.1.1`. Before the first public release, bump `package.json` per release, or let the publish job set the version (`npm version --no-git-tag-version <x>`) before packaging. Otherwise "latest" cannot be told apart from older builds.

## 6. Install scripts

Shared rules:

- **Readable and short.** HTTPS only, `set -euo pipefail` (bash) or `$ErrorActionPreference = 'Stop'` (PowerShell), and a clear one-line message for every failure.
- **Downloads and checks:** read the manifest, download to a fresh temporary directory, verify SHA-256 against the manifest, and stop on a mismatch.
- **Safe to re-run:** running the command again updates in place. Quit a running copy first, and never delete user data.
- **No collection:** no telemetry and no calls to anything except the hosting URLs.
- **Overrides:**
  - `UNOBLOX_WORKS_MANIFEST` points at a staging manifest.
  - `UNOBLOX_WORKS_VERSION` pins a version, if older releases stay hosted.
  - `UNOBLOX_WORKS_NO_LAUNCH=1` skips opening the app, for CI.
- **Wrapped in a function:** put the whole script in a function called on the last line. A connection cut halfway through `curl | bash` then runs nothing instead of half a script.
- **Uninstall:** add an uninstall option, or document uninstalling (section 7).

### 6.1 `install.sh`: macOS

1. Require `uname -m` = `arm64`. On Intel, say the beta supports Apple Silicon only and exit. Check the minimum macOS version for Electron 43 (macOS 12 or later; confirm against Electron's release notes) and stop with a clear message below it.
2. Download the DMG with `curl -fL --retry 3 -o`, and verify it with `shasum -a 256`.
3. Mount it with `hdiutil attach -nobrowse -readonly -mountpoint <tmp>/mnt`.
4. If `unoblox works` is running, quit it with `osascript -e 'quit app "unoblox works"'`, wait, and stop if it won't quit.
5. Install to `/Applications/unoblox works.app`. Remove the old bundle, then `ditto` the new one in, which keeps signatures and symlinks. If `/Applications` isn't writable (a standard user account), install to `~/Applications` instead and say so; do not use `sudo` on macOS.
6. Run `xattr -dr com.apple.quarantine` on the installed app, then `codesign --verify --deep --strict` on it. If the check fails, say the download is damaged.
7. Detach the DMG in a cleanup trap, then `open` the app (unless NO_LAUNCH).
8. If `/Applications/unoblox.app` exists, print that the old beta can be deleted and that data is kept.

### 6.2 `install.sh`: Linux

1. Require `x86_64`.
2. If `apt-get` exists, use the `.deb`:
   - Download and verify it.
   - Make it readable by root: `chmod 644` the file and `755` its directory, because apt reads it as `_apt`.
   - Install with `sudo apt-get install -y <absolute path>`; apt installs the dependencies. Explain the password prompt before it appears.
   - Without sudo rights, fall back to the AppImage.
3. Otherwise use the AppImage:
   - Install it to `~/.local/opt/unoblox-works/unoblox-works.AppImage` with mode 755, and symlink `~/.local/bin/unoblox-works`.
   - Write `~/.local/share/applications/unoblox-works.desktop` and an icon so it shows in the app menu.
   - Warn when `libfuse.so.2` is missing (`ldconfig -p | grep libfuse.so.2`), with the distro's package name: `libfuse2t64` on Ubuntu 24.04+, `fuse-libs` on Fedora.
   - On Ubuntu 24.04+ where the AppImage cannot sandbox, recommend the `.deb` path.
4. Start the app detached (`nohup unoblox-works >/dev/null 2>&1 &`) unless NO_LAUNCH, or tell the user to open it from the menu.
5. Fedora/RPM is out of scope for now. electron-builder can add an `rpm` target later.

### 6.3 `install.ps1`: Windows

1. At the top, `[Net.ServicePointManager]::SecurityProtocol = 'Tls12'`. Windows PowerShell 5.1 does not default to TLS 1.2.
2. Require 64-bit Windows. On ARM64 Windows the x64 build runs under emulation: allow it with a note.
3. Detect Smart App Control. The registry value `HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy` `VerifiedAndReputablePolicyState` = 1 means on. When it's on, explain that it blocks unsigned apps and stop, rather than leaving a broken install.
4. Download with `Invoke-WebRequest -UseBasicParsing -OutFile`. For speed on 5.1, set `$ProgressPreference = 'SilentlyContinue'` during the download. Verify with `Get-FileHash -Algorithm SHA256`, then `Unblock-File`.
5. Stop a running `unoblox works` process (`Get-Process -Name 'unoblox works'`).
6. Run the installer silently with `Start-Process -Wait -PassThru -ArgumentList '/S'` and check the exit code. Confirm on a runner that `/S` installs for the current user without a UAC prompt.
7. Launch `%LOCALAPPDATA%\Programs\unoblox works\unoblox works.exe` (unless NO_LAUNCH). Mention that the old "unoblox" beta can be uninstalled in Settings › Apps.
8. Never reference the script's own path: `irm | iex` runs it from memory. Execution policy does not apply to `iex`, but the Command Prompt form passes `-ExecutionPolicy Bypass` anyway.

## 7. Download page

Location to confirm with the owner: for example `https://unoblox.ai/works` or `/download`, in the unoblox.ai website's repository and stack. Ask where that lives; it is not this repository.

Content:

- **Heading:** "unoblox works", lowercase as everywhere, the tagline "Make it happen." and a one-paragraph description. Reuse the README's first paragraphs and `build/brand/` assets: the "u." mark and the gold `#D9A64A`.
- **The command:** OS detection (`navigator.userAgentData.platform`, falling back to `navigator.userAgent`) selects a tab (macOS, Windows, Linux) with the command, a copy button and "Paste into Terminal / PowerShell and press Return". Say what the command does, in four short steps, and link to the script source so people can read it first.
- **Requirements:**
  - macOS: Apple Silicon (M1 or later), macOS 12+ (confirm).
  - Windows: 10 or 11, 64-bit.
  - Linux: x64, Ubuntu 22.04+/Debian 12 for the `.deb`, AppImage elsewhere.
  - Everywhere: an unoblox API key from the developer portal, which the app asks for on first launch.
- **Manual downloads:** direct links to the DMG, setup `.exe`, `.deb` and AppImage, with sizes and SHA-256. Under each, show the one-time confirmation that browser downloads still need:
  - macOS: open the app, click **Done**, then System Settings › Privacy & Security › **Open Anyway**.
  - Windows: **More info** › **Run anyway**.
  - Copy these from `docs/install.md`.
- **Uninstall:**
  - macOS: quit the app, then delete `/Applications/unoblox works.app`.
  - Windows: Settings › Apps › unoblox works › Uninstall.
  - Linux: `sudo apt remove unoblox-works`, or delete the AppImage files.
  - Everywhere: data lives in the `dsh-desktop` folder (paths in section 3); remove it only to erase settings, conversations and the stored key.
- **Trust and privacy:** "beta, not yet signed by Apple or Microsoft"; collects no usage data; talks only to `api.unoblox.ai`. Link to the privacy doc.
- **Version line:** "Version x.y.z (beta), published <date>", read from `latest.json` at load time or baked in at deploy time.
- **Mobile visitors:** the app is desktop-only; offer "email me the link" only if the owner wants it, otherwise just say so.
- **No trackers:** no third-party trackers by default (privacy promise). Ask the owner before adding any analytics to the page.
- **Accessibility and layout:** keyboard-usable tabs and copy button (announce "Copied" with `aria-live`), AA contrast in light and dark, and works at phone width.

## 8. Acceptance tests

Automate as a workflow that runs after publishing (or against a staging manifest):

| Runner | Steps | Pass when |
| --- | --- | --- |
| `macos-15` (arm64) | Run the exact page command with `UNOBLOX_WORKS_NO_LAUNCH=1`. | `/Applications/unoblox works.app` exists and has no `com.apple.quarantine` (`xattr -p` fails). `codesign --verify --deep --strict` passes, and `spctl --assess` reports it as not notarized, as expected. `node scripts/smoke-packaged.mjs "/Applications/unoblox works.app"` passes (it needs `CI=true`). |
| `windows-2022` | Run the PowerShell command, then the Command Prompt form, from a fresh session. | The exe exists under `%LOCALAPPDATA%\Programs\unoblox works`, no `Zone.Identifier` stream on the installer, uninstall entry present, smoke script passes against the install directory. |
| `ubuntu-24.04` | Run the command (apt path), then again with `apt-get` hidden (AppImage path). | `dpkg -s unoblox-works`, `/usr/bin/unoblox-works` and the AppArmor profile exist, and the smoke script passes against `/opt/unoblox works` with the sandbox on. The AppImage path writes the `.desktop` entry. |
| all | Re-run the command. | It updates in place; user data is untouched. |
| all | Use a manifest with a wrong checksum. | The script stops before installing. |

Manual checks before announcing:
- On a real Apple Silicon Mac that never had the app: the app opens with no prompt.
- On a Windows 11 PC: the app opens with no SmartScreen dialog, and the script's message is clear when Smart App Control is on.
- On a desktop Ubuntu 24.04: install and open.

Record what was and was not verified, as `AGENTS.md` (section 4) requires.

## 9. Constraints from this repository

- Read `AGENTS.md` first. Use npm, and don't add lockfiles or commit build outputs. Installers are built on their own OS by CI (`scripts/verify-target.mjs`); do not cross-build.
- Never print, log or commit API keys or tokens, or put them in fixtures.
- Don't open pull requests or push to other branches without the owner's say-so. Work on the branch you are given.
- The privacy promise (`docs/privacy.md`) applies to anything the app or its installer does on a user's machine.

## 10. Decisions for the owner (ask before building)

1. **Hosting:** a public releases repository (recommended, name?), `dl.unoblox.ai` object storage, or making this repository public.
2. **URLs:** where the page and scripts live (for example `unoblox.ai/works`, `unoblox.ai/install.sh`), and which repository and stack host unoblox.ai.
3. **Publishing:** who triggers it, and the version and tag scheme.
4. **Analytics** on the download page: none (default), or which.
5. **Linux scope:** `.deb` and AppImage only, or also RPM for Fedora.
6. **Signing plan:** Apple Developer ID and Windows signing remove the browser-download prompts and Smart App Control blocks. The page copy should change when they land.
