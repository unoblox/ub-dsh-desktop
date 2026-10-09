#!/usr/bin/env bash
# Install the latest unoblox works beta on macOS (Apple Silicon) or Linux x64
# from this repository's "Build beta installers" runs.
#
#   gh api -H "Accept: application/vnd.github.raw" \
#     "repos/unoblox/ub-dsh-desktop/contents/scripts/install-beta.sh?ref=claude/charming-bohr-lpab0z" | bash
#
# Needs the GitHub CLI signed in to an account that can read the repository
# (brew install gh / apt install gh, then gh auth login). Files that gh
# downloads carry no "downloaded from the internet" mark, so macOS opens the
# ad-hoc signed app without the Privacy & Security step. Browser downloads
# still get the prompt; only a notarized build removes that.
set -euo pipefail

REPO="${UNOBLOX_REPO:-unoblox/ub-dsh-desktop}"
BRANCH="${UNOBLOX_BRANCH:-claude/charming-bohr-lpab0z}"
APP_NAME='unoblox works'

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf 'install-beta: %s\n' "$*" >&2; exit 1; }

command -v gh >/dev/null 2>&1 || die "the GitHub CLI is missing: install it (brew install gh, or apt install gh), run gh auth login, then try again"

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) artifact='unoblox-beta-macos-apple-silicon' ;;
  Darwin/*) die 'the beta supports Apple Silicon Macs only (M1 or later)' ;;
  Linux/x86_64) artifact='unoblox-beta-linux-x64' ;;
  *) die "no beta for $(uname -s) $(uname -m); on Windows use install-beta.ps1" ;;
esac

say "Finding the latest $APP_NAME beta…"
# The artifacts API lists newest first; keep this branch's unexpired builds.
run_id="$(gh api "repos/$REPO/actions/artifacts?name=$artifact&per_page=30" \
  --jq "[.artifacts[] | select(.expired | not) | select(.workflow_run.head_branch == \"$BRANCH\")][0].workflow_run.id // empty")" \
  || die "could not list builds of $REPO; check gh auth status"
[ -n "$run_id" ] || die "no unexpired $artifact build on $BRANCH; run the Build beta installers workflow"

work="$(mktemp -d)"
mount=''
cleanup() {
  if [ -n "$mount" ]; then hdiutil detach "$mount" -quiet || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

say "Downloading build $run_id…"
gh run download "$run_id" -R "$REPO" -n "$artifact" -D "$work"

if [ "$(uname -s)" = Darwin ]; then
  dmg="$(find "$work" -maxdepth 1 -name '*.dmg' | head -n 1)"
  [ -n "$dmg" ] || die "the build has no .dmg"
  mount="$work/mount"
  mkdir "$mount"
  hdiutil attach "$dmg" -nobrowse -readonly -quiet -mountpoint "$mount"
  source_app="$mount/$APP_NAME.app"
  [ -d "$source_app" ] || die "the disk image has no $APP_NAME.app"
  target="/Applications/$APP_NAME.app"
  if pgrep -xq "$APP_NAME"; then
    say "Quitting the running $APP_NAME…"
    osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do pgrep -xq "$APP_NAME" || break; sleep 0.5; done
    pgrep -xq "$APP_NAME" && die "$APP_NAME is still running; quit it and try again"
  fi
  say "Installing to $target…"
  rm -rf "$target"
  ditto "$source_app" "$target"
  # Belt and braces: the copy has no quarantine mark, but clear any inherited one.
  xattr -dr com.apple.quarantine "$target" 2>/dev/null || true
  if [ -d "/Applications/unoblox.app" ]; then
    say "Note: the earlier beta, /Applications/unoblox.app, is still installed. You can delete it; your data is kept."
  fi
  say "Opening $APP_NAME…"
  open "$target"
else
  deb="$(find "$work" -maxdepth 1 -name '*.deb' | head -n 1)"
  appimage="$(find "$work" -maxdepth 1 -name '*.AppImage' | head -n 1)"
  if [ -n "$deb" ] && command -v apt-get >/dev/null 2>&1; then
    say "Installing $(basename "$deb") (asks for your password)…"
    # apt reads the file as root; keep it readable outside the private temp dir.
    chmod 755 "$work"
    chmod 644 "$deb"
    sudo apt-get install -y "$deb"
    say "Installed. Open $APP_NAME from your applications menu, or run unoblox-works."
  elif [ -n "$appimage" ]; then
    mkdir -p "$HOME/Applications"
    target="$HOME/Applications/unoblox-works.AppImage"
    install -m 755 "$appimage" "$target"
    say "Installed $target. It needs FUSE 2 (libfuse2) to start."
  else
    die "the build has no .deb or .AppImage"
  fi
fi
