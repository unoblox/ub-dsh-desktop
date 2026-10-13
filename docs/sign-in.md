# Sign in with unoblox

Users can sign in instead of pasting an API key. The first-run dialog and **Harness › Sign In with unoblox…** open the system browser on unoblox.ai; after the user signs in and approves, the app receives an API key for their account and stores it. **Harness › Sign Out of unoblox…** removes it from the computer.

## How it works

OAuth 2.0 authorization code with PKCE (S256) for a public client, as RFC 8252 describes for native apps (`src/main/unoblox/`):

1. The main process creates a PKCE verifier and a random `state`, and listens once on `127.0.0.1` at the first free port of 53682, 53683, 53684.
2. It opens `https://unoblox.ai/oauth/authorize?response_type=code&client_id=…&redirect_uri=http://127.0.0.1:<port>/callback&code_challenge=…&code_challenge_method=S256&state=…&scope=inference` in the system browser.
3. The browser comes back to `/callback`. Only a request with the right `state` ends the wait; the listener closes at once, or after 5 minutes (the code's lifetime).
4. The main process posts the code and verifier (no client secret) to `https://unoblox.ai/api/identity/oauth/token` and receives `{"key": "ub-gw-…"}`.
5. It stores the key under `UNOBLOX_API_KEY` in the Harness credential store through the Harness `credentials/set` remote, the same store the paste field writes. The page only learns whether it worked; the key never reaches the renderer.

A second click while the browser is open does not start another sign-in; **Cancel** stops the wait and frees the port. If `UNOBLOX_API_KEY` is set in the environment the app starts from, the store refuses the write and the dialog says so.

## Configuration

- **Client id:** set at build time with `UNOBLOX_WORKS_SIGNIN_CLIENT_ID` (CI reads the repository variable of the same name). A build without a valid `ubc_…` id hides sign-in.
- **Registration:** the client must be public (no secret) and list these redirect URIs exactly, because identity matches the port too: `http://127.0.0.1:53682/callback`, `http://127.0.0.1:53683/callback`, `http://127.0.0.1:53684/callback`. Scope `inference`.
- **Test builds:** `UNOBLOX_WORKS_SIGNIN_CLIENT_ID`, `UNOBLOX_WORKS_SIGNIN_AUTHORIZE_URL` and `UNOBLOX_WORKS_SIGNIN_TOKEN_URL` at runtime point the app at staging (for example `http://localhost:13300/…` through the staging SSH tunnel). Development runs honour them; packaged builds only when built with `UNOBLOX_WORKS_SIGNIN_TEST_BUILD=1`. Only unoblox.ai, or `localhost`/`127.0.0.1` in test builds, are accepted.

## Waiting on the identity service

- **The browser page.** `unoblox.ai/oauth/authorize` returns 404 in production: the consent page exists only on the `ub-chat-feature` branch. Until it ships, sign-in cannot be completed and the build should stay without a client id.
- **Revoking on sign-out.** There is no `/oauth/revoke`; sign-out removes the key from this computer and tells the user to delete it on unoblox.ai.
- **One key per device.** Each sign-in mints a new key named `oauth:<client name>`; the token request cannot set a device label yet.
- **Any-port loopback (RFC 8252 §7.3).** With it, the fixed port list could go.
- **New accounts start at ₹0**, so a new user can sign in but not chat until they top up.
