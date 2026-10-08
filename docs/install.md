# Install Unoblox Beta

Unoblox Beta is free to install on macOS, Windows and Linux. The beta is not yet signed with paid Apple or Microsoft certificates, so your computer asks you to confirm it once on first open. After that it opens like any other app.

You need an Unoblox API key. The app asks for it on first launch.

## macOS (Apple Silicon: M1 or later)

1. Download `Unoblox-Beta-…-mac-arm64.dmg`. Intel Macs are not supported by the beta.
2. Open the disk image and drag **Unoblox** onto **Applications**.
3. Open Unoblox from Applications. macOS says it cannot verify the app: click **Done**.
4. Open **System Settings › Privacy & Security**, scroll down to the message about Unoblox and click **Open Anyway**. Confirm with your password or Touch ID.

You only do steps 3 and 4 once. If macOS ever says the app is "damaged", the download was incomplete: download it again.

## Windows 10 and 11 (64-bit)

1. Download `Unoblox-Beta-…-windows-x64-setup.exe` and run it.
2. If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**.
3. Follow the installer. It adds Unoblox to the Start menu and the desktop.

## Linux (64-bit)

**Ubuntu, Debian and derivatives (recommended):**

1. Download `Unoblox-Beta-…-linux-amd64.deb`.
2. Install it: double-click it to open Software Install, or run `sudo apt install ./Unoblox-Beta-*-linux-amd64.deb`.
3. Open **Unoblox** from your applications menu.

The package sets up Chromium's sandbox (including the AppArmor profile Ubuntu 24.04 and later need), so it starts without extra steps.

**Other distributions (AppImage):**

1. Download `Unoblox-Beta-…-linux-x86_64.AppImage`.
2. Make it executable: right-click › Properties › Permissions › "Allow executing file as program", or run `chmod +x Unoblox-Beta-*.AppImage`.
3. Double-click it.

If the AppImage does not start, it usually needs FUSE 2 (`sudo apt install libfuse2t64` on Ubuntu 24.04+, `libfuse2` on 22.04). On Ubuntu 24.04+ the AppImage also cannot use Chromium's sandbox; use the `.deb` there.

## Privacy

Unoblox talks only to `api.unoblox.ai` on its own and collects no usage data. See [privacy](privacy.md).

## Updates

The beta does not update itself. To update, install the newer beta over the old one; your conversations and settings are kept.
