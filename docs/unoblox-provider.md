# Unoblox provider

DSH Desktop serves models only through the [Unoblox](https://unoblox.ai/docs/quickstart) gateway. Unoblox speaks the OpenAI Chat Completions API, so it runs as one hand-declared `llm-pi-ai` route. Desktop does not add a separate LLM adapter for it.

| Field | Value |
| --- | --- |
| Route id | `unoblox` |
| Protocol (`api`) | `openai-completions` |
| `baseURL` | `https://api.unoblox.ai/v1` |
| Credential reference (`apiKeyEnv`) | `UNOBLOX_API_KEY` |
| Model | `unoblox/auto` (the Unoblox router picks the model and fails over between providers) |

## How the lock works

`build/dsh-desktop.patch.yml` and `build/dsh-desktop-safe.patch.yml` hold the same model rows. Keep those identical; only the web-search rows differ. Harness applies these files with `--patch`, as the CLI layer that comes after the bundle, profile and home layers. A patch row's `config` replaces the entry's whole config. As a result:

- `llm-pi-ai` gets a provider set containing only `unoblox`. Routes that a profile declared earlier (OpenAI, a custom gateway, and so on) are hidden but not deleted. The settings service refuses Models-page writes that this overlay would override.
- `llm-deepseek` and `llm-deepseek-account` are disabled, which removes the official DeepSeek API-key and account routes.
- `agent-default-model` is pinned to `unoblox` / `unoblox/auto`. When a session changes model, Harness tries to save that as the new default. The overlay refuses the save and Harness logs a warning. There is no other model to choose.
- `web-search-deepseek` is disabled, because it called DeepSeek directly with a DeepSeek key. In the normal profile, web search goes through Unoblox instead (see below). Safe Mode keeps `web_search` off, because recovery must not load optional product plugins.

The patched `@deepseek-ai/dsh-client-ui-settings-models` hides the Models page's **Add** button (`DESKTOP_PROVIDER_SET_LOCKED`). Users therefore never see an add-provider flow that the overlay would refuse.

## Web search

`packages/dsh-desktop-unoblox-search` registers the `unoblox` search backend. `dsh-desktop.patch.yml` mounts it and selects it with `web.searchProvider: unoblox`.

- Each search sends `POST https://api.unoblox.ai/v1/search` with `{ query, numResults }`, a `Bearer` key and an `Idempotency-Key`. Unoblox runs the search on Perplexity's Search API.
- The key is the same `UNOBLOX_API_KEY` used for chat. It is read from the credential store on every search, so a key added after startup works without a restart. The upstream Exa and Perplexity plugins read their key once, from config or a fixed environment variable. They cannot see keys entered in the app, which is why Desktop has its own plugin.
- `numResults` is the tool's `maxResults`, limited to 1–20 (default 8). Results map to `url`, `title`, `snippet` (taken from the first highlight when there is no snippet) and `publishedAt`. Results without an http(s) URL are dropped.
- Unoblox's `error` text and `UB-GW-…` code reach the model verbatim. A per-key or platform-wide rate limit (`UB-GW-303`/`312`, with `Retry-After` ≤ 2 s) and a backend failure (`UB-GW-305`) get one retry with the same idempotency key, so a retried search is billed once. Billing, policy, daily-cap and switched-off errors are reported without a retry.
- Privacy: only the query text is sent, to Unoblox and on to Perplexity (United States). Unoblox does not store queries. The first-run dialog shows this disclosure next to the key field.
- `web_fetch` stays local (`fetchProvider: http`) and Unoblox does not bill for it.

## API key

The key (`ub-gw-…`) is never written to configuration. It is stored in the Harness credential store under `UNOBLOX_API_KEY`:

- New installs: the first-run dialog (`packages/dsh-desktop-onboarding/client.js`) has an Unoblox API-key field.
- Everyone else: enter the key on the Unoblox row in Settings → Models. With the overlay in place, that card writes no settings and only stores the credential.

## Changing the endpoint or models

Edit the `llm-pi-ai` row in both patch files. `models` is the complete catalog that users can pick from, and they cannot add to it from the UI. Add any further Unoblox model ids (`author/model` slugs) there. `test/unoblox-provider.test.ts` composes the real base bundle, a profile that declares other providers, and each Desktop patch. It asserts the locked result.
