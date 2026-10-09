# Privacy and network policy

unoblox works follows two rules:

1. **No usage, analytics or telemetry data leaves the user's machine.**
2. **No silent network traffic.** The app contacts only the unoblox API, `api.unoblox.ai`, and, for update checks the user can turn off, GitHub. Any other connection must be something the user asked for at that moment.

## What the app contacts on its own

| Host | When | Why |
| --- | --- | --- |
| `api.unoblox.ai` | At startup | `GET /v1/models`: the live model list for the picker. Public, so no key is sent. |
| `api.unoblox.ai` | When the user sends a message | Chat completions, context compaction and the conversation title, using the user's key. |
| `api.unoblox.ai` | When the agent runs `web_search` | `POST /v1/search`. Only the query text is sent. |
| `github.com`, then GitHub's download host (`release-assets.githubusercontent.com` or `objects.githubusercontent.com`) | 15–30 s after launch, then every 6 hours, while **Check for Updates Automatically** is on (default); and whenever the user picks **Check for Updates…** | Over-the-air updates: `GET` of the signed `latest.json` from the public `unoblox/unoblox-works-releases` releases, then the new build's installer when it is newer. The request carries no installation id, key or usage data; GitHub sees an ordinary download (IP address, user agent). Turning the option off stops all scheduled update traffic. |

Nothing else is contacted automatically. This was verified by recording every outbound connection of the packaged Linux app (a logging proxy plus `strace` on every `connect()`), both idle after a fresh launch and through a full first-run session.

## What was switched off

These upstream (DeepSeek Harness / DSH Desktop) behaviours are disabled in `build/dsh-desktop.patch.yml` and `build/dsh-desktop-safe.patch.yml`, or in the main process:

| Upstream behaviour | Sent to | Change |
| --- | --- | --- |
| **Session telemetry** (`session-telemetry-otel`, `otel`): a 👍/👎 or `/feedback` uploaded the **entire conversation** (prompts, replies, tool output) with an anonymous user ID | `dsh-otel-collector.deepseeksvc.com` | Rows disabled. `DSH_TELEMETRY_DISABLED=1` is also set for the Harness process. |
| **Product analytics** (`product-analytics`, `desktop-product-telemetry`): clicks, model, plugin and session events with device and user IDs, batched every 30 s | `dsh-otel-collector.deepseeksvc.com` | Rows disabled. They had been off only because the profile was not named `desktop`. |
| Feedback buttons, dialog and `/feedback` (`message-feedback`, `ui-message-feedback`, `command-feedback`) | — | Removed. They existed to send the conversation to DeepSeek; with that gone they would promise a submission that goes nowhere. |
| DeepSeek account and request extensions (`deepseek-account`, `account-controller`, `deepseek-llm-api-extensions`, `session-log-deepseek`, `plugin-package-inventory-deepseek`) | `platform.deepseek.com`, `api.deepseek.com` | Rows disabled. The DeepSeek model and search routes were already off. |
| Update checks, which sent the installation ID, version and platform | `dshdesktop.com` | Replaced by unoblox's own updates (table above): a plain download of a signed file from GitHub, with no installation ID. |
| Crash reports, consent-gated but sent with the installation ID | `dshdesktop.com/crash` | The desktop service has no network: nothing is uploaded or offered for upload, and pending crash reports are deleted at the next launch. Recovery screens work from the current session's own evidence. |
| Spell-check dictionary download on Linux and Windows | Google (`redirector.gvt1.com`) | Chromium's spellchecker is off on Linux and Windows, with an empty dictionary list set as each session is created (switching it off alone still downloads the dictionary). macOS keeps its system spellchecker, which stays local. |
| Workbench market catalog fetched at every launch | `market.dshdesktop.com` | The workbench panel is off for the beta (its copy is Chinese-only and it lists the upstream catalog). If it returns, the catalog is fetched only when the user opens the market, refreshes, or installs from it. |
| npm registry ping when the plugin-install dialog opens | `registry.npmjs.org`, `registry.npmmirror.com` | `registryProbeEnabled: false`. |
| Plugin version lookups when a plugin breaks startup or Safe Mode opens | `registry.npmmirror.com`, `registry.npmjs.org` | Not done. Recovery offers its local actions (Safe Mode, removing the plugin). |
| Settings › Market offered to install the third-party dsh-market plugin | npm, then whatever the plugin does | Not offered: the entry is gone and the host refuses the install (`MARKET_OFFERED = false`). |
| Phone bridge listened on the local network from launch | — (inbound port) | Opens its port only when the user clicks Connect Phone, and closes it with the pairing window unless a phone paired. **Harness › Keep Phone Connected** (off by default) starts it with the app. |
| Connect Phone without a local network went straight to an internet tunnel | Cloudflare / Pinggy | Asks first. |

## What still uses the network, only on the user's request

- **Agent tools.** `web_fetch` loads a web page the agent chose for the user's task, and shell commands the agent runs (after the user's approval policy allows them) can reach whatever the command reaches. These are actions the user asked the agent to take.
- **Installing plugins** the user picks in the plugin dialog: npm and GitHub. A plugin's own behaviour after install is the plugin author's, so only install plugins you trust.
- **Image generation**, if the user configures an OpenAI or Volcengine key in its settings.
- **Phone pairing over the internet**, if the user picks Internet mode on the pairing page or agrees when no local network is found (Cloudflare or Pinggy).
- **Links** the user clicks (docs and the website), which open in the system browser.

## Kept on the machine

- The unoblox API key: in the Harness credential store, never sent anywhere but `api.unoblox.ai`, and never to the renderer.
- Conversations, workspaces and settings: under the app's user-data folder.
- Local diagnostics: the harness log, used only by the app's own recovery screens.

The phone bridge listens on the local network only while the user is pairing, while a phone paired this session, or when Keep Phone Connected is on (PIN-protected, inbound only, no advertising). It sends nothing out by itself.

## Chat widgets

Widgets the agent shows in the chat (charts, forms, calculators) run in a sandboxed frame with no network access. The chart library is bundled with the app and served by the local Harness. Several layers enforce this, because a content security policy alone does not stop every route:

- The frame's content security policy blocks requests, sockets, workers, nested pages, form posts and `<base>`.
- The main process records each widget frame when it is created and refuses any navigation of it, or of a frame inside it, away from its own document (`location`, meta refresh, links). A policy cannot block a frame navigating itself.
- WebRTC (STUN/TURN), which no policy covers, is removed from the widget, and the app window may not open UDP sockets for it.
- Nested frames, which would start with a fresh, unrestricted window, are removed as soon as a widget adds them.

A widget sends data only when the user submits it, and the submission becomes the user's next message in the conversation. A web link in a widget opens in the system browser only when the user clicks it. `test/widgets.test.ts` and `test/widget-frame-guard.test.ts` cover these rules. Over 100 escape attempts were also run against real Electron during development (fetch, images, CSS, sockets, beacons, navigation, WebRTC, nested frames, shadow DOM, tampering with built-ins), and none reached the network.

## Keeping it this way

`test/network-privacy.test.ts` composes the real upstream bundles with each Desktop patch and asserts every row above stays disabled. It also checks the Harness environment flag, the spell-check guard and the no-fetch-at-startup catalog. `test/update-manager.test.ts` checks that no update request is made while automatic checks are off and that only a correctly signed manifest is acted on, `test/mobile-bridge-demand.test.ts` covers when the phone bridge runs, and `test/market-installer.test.js` checks the market install is refused. When upgrading Harness, check new upstream rows against the two rules above.
