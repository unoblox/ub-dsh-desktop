# Install unoblox works beta

unoblox works beta is free to install on macOS, Windows and Linux. The beta is not yet signed with paid Apple or Microsoft certificates, so your computer asks you to confirm it once on first open. After that it opens like any other app.

You need an unoblox API key. The app asks for it on first launch.

## Install from the command line (no first-open prompt)

If you have the [GitHub CLI](https://cli.github.com) signed in to an account that can read this repository (`gh auth login`), one command downloads the latest beta build and installs it. Files downloaded by `gh` carry no "downloaded from the internet" mark, so macOS and Windows open the app without the confirmation steps below.

macOS (Apple Silicon) and Linux x64, in Terminal:

```bash
gh api -H "Accept: application/vnd.github.raw" "repos/unoblox/ub-dsh-desktop/contents/scripts/install-beta.sh?ref=claude/charming-bohr-lpab0z" | bash
```

Windows x64, in PowerShell:

```powershell
gh api -H "Accept: application/vnd.github.raw" "repos/unoblox/ub-dsh-desktop/contents/scripts/install-beta.ps1?ref=claude/charming-bohr-lpab0z" | Out-String | Invoke-Expression
```

The scripts (`scripts/install-beta.sh`, `scripts/install-beta.ps1`) replace an installed unoblox works, then open it. On Linux they install the `.deb` with apt, which asks for your password.

## macOS (Apple Silicon: M1 or later)

1. Download `unoblox-works-beta-…-mac-arm64.dmg`. Intel Macs are not supported by the beta.
2. Open the disk image and drag **unoblox works** onto **Applications**.
3. Open unoblox works from Applications. macOS says it cannot verify the app: click **Done**.
4. Open **System Settings › Privacy & Security**, scroll down to the message about unoblox works and click **Open Anyway**. Confirm with your password or Touch ID.

You only do steps 3 and 4 once. If macOS ever says the app is "damaged", the download was incomplete: download it again.

## Windows 10 and 11 (64-bit)

1. Download `unoblox-works-beta-…-windows-x64-setup.exe` and run it.
2. If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**.
3. Follow the installer. It adds unoblox works to the Start menu and the desktop.

## Linux (64-bit)

**Ubuntu, Debian and derivatives (recommended):**

1. Download `unoblox-works-beta-…-linux-amd64.deb`.
2. Install it: double-click it to open Software Install, or run `sudo apt install ./unoblox-works-beta-*-linux-amd64.deb`. It replaces an earlier beta package named `unoblox`.
3. Open **unoblox works** from your applications menu.

The package sets up Chromium's sandbox (including the AppArmor profile Ubuntu 24.04 and later need), so it starts without extra steps.

**Other distributions (AppImage):**

1. Download `unoblox-works-beta-…-linux-x86_64.AppImage`.
2. Make it executable: right-click › Properties › Permissions › "Allow executing file as program", or run `chmod +x unoblox-works-beta-*.AppImage`.
3. Double-click it.

If the AppImage does not start, it usually needs FUSE 2 (`sudo apt install libfuse2t64` on Ubuntu 24.04+, `libfuse2` on 22.04). On Ubuntu 24.04+ the AppImage also cannot use Chromium's sandbox; use the `.deb` there.

## Privacy

unoblox works talks only to `api.unoblox.ai` on its own and collects no usage data. See [privacy](privacy.md).

## Updates

unoblox works updates itself. Shortly after it starts, and every few hours, it checks for a newer beta, downloads it in the background and shows **Update ready**; click **Restart and install** when it suits you. Your conversations, settings and API key are kept.

- Turn the automatic check off under **Harness › Check for Updates Automatically** (macOS: in the **unoblox works** menu). **Check for Updates…** still works.
- macOS: the app must be in the Applications folder to update itself.
- Linux: the AppImage replaces itself. The .deb updates through the system password prompt.
- Updates are signed: the app installs only builds published by unoblox.
