# Sign in with unoblox

Users can sign in instead of pasting an API key. The first-run dialog and **Harness › Sign In with unoblox…** open the system browser on unoblox.ai; after the user signs in and approves, the app receives an API key for their account and stores it. **Harness › Sign Out of unoblox…** removes it from the computer.

## How it works

OAuth 2.0 authorization code with PKCE (S256) for a public client, as RFC 8252 describes for native apps (`src/main/unoblox/`):

1. The main process creates a PKCE verifier and a random `state`, and listens once on `127.0.0.1:53682`, the one redirect registered for the client. (Once identity's any-port matching is live, `SIGN_IN_ANY_PORT` switches to a port the OS picks.)
2. It opens `https://unoblox.ai/oauth/authorize?response_type=code&client_id=…&redirect_uri=http://127.0.0.1:<port>/callback&code_challenge=…&code_challenge_method=S256&state=…&scope=inference` in the system browser.
3. The browser comes back to `/callback`. Only a request with the right `state` ends the wait; the listener closes at once, or after 5 minutes (the code's lifetime).
4. The main process posts the code and verifier (no client secret), plus `device_id` (a random install id kept in `<userData>/unoblox-device.json`) and `device_name` (the computer's name), to `https://unoblox.ai/api/identity/oauth/token`. Identity keeps one active key per user, client and device, named "unoblox works on <device name>", and returns `{"key": "ub-gw-…"}`; the app reads `key` only.
5. It stores the key under `UNOBLOX_API_KEY` in the Harness credential store through the Harness `credentials/set` remote, the same store the paste field writes, and keeps an OS-encrypted copy (Electron `safeStorage`) only to revoke it later. The page only learns whether it worked; the key never reaches the renderer.
6. **Sign Out of unoblox…** revokes the key (`POST https://unoblox.ai/api/identity/oauth/revoke`, `token` and `client_id`, 10 s timeout), then removes it from the Harness store and the copy, even when unoblox.ai cannot be reached; the dialog then points to https://unoblox.ai/user/keys.

A second click while the browser is open does not start another sign-in; **Cancel** stops the wait and frees the port. If `UNOBLOX_API_KEY` is set in the environment the app starts from, the store refuses the write and the dialog says so.

## Configuration

- **Client id:** set at build time with `UNOBLOX_WORKS_SIGNIN_CLIENT_ID` (CI reads the repository variable of the same name). A build without a valid `ubc_…` id hides sign-in.
- **Registration:** a public client (no secret), scope `inference`, redirect `http://127.0.0.1:53682/callback` only. Consent screen name "unoblox works" with the app icon (`build/icon.png`, `build/brand/unoblox-mark.svg`).
- **Test builds:** `UNOBLOX_WORKS_SIGNIN_CLIENT_ID`, `UNOBLOX_WORKS_SIGNIN_AUTHORIZE_URL`, `UNOBLOX_WORKS_SIGNIN_TOKEN_URL`, `UNOBLOX_WORKS_SIGNIN_REVOKE_URL` and `UNOBLOX_WORKS_SIGNIN_ANY_PORT=1` at runtime point the app at staging (for example `http://localhost:13300/…` through the staging SSH tunnel). Development runs honour them; packaged builds only when built with `UNOBLOX_WORKS_SIGNIN_TEST_BUILD=1`. Only unoblox.ai, or `localhost`/`127.0.0.1` in test builds, are accepted.

## Waiting on the identity service

Identity is shipping these; it will say when each reaches staging and production:

- **The browser approval page** at `unoblox.ai/oauth/authorize` (404 in production today). Until it ships, builds stay without a client id.
- **`/oauth/revoke`** and **device keys** (`device_id`, `device_name`). The app already sends and calls them; before they exist identity ignores the extra token fields, and a failed revoke shows the "remove it on unoblox.ai" message.
- **Any-port loopback** for registered `127.0.0.1` redirects. Then set `SIGN_IN_ANY_PORT` to `true`.
- **New accounts start at ₹0.** Free (freemium) models work at ₹0 when named; `unoblox/auto` does not consider the balance and can be refused with 402. A refused turn then offers "Retry with a free model" and "Top up", and a revoked key offers "Sign in again" (docs/unoblox-provider.md, "When unoblox refuses a turn").
