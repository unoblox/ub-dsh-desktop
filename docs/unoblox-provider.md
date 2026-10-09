# Unoblox provider

DSH Desktop serves models only through the [Unoblox](https://unoblox.ai/docs/quickstart) gateway. Unoblox speaks the OpenAI Chat Completions API, so it runs as one hand-declared `llm-pi-ai` route. Desktop does not add a separate LLM adapter for it.

| Field | Value |
| --- | --- |
| Route id | `unoblox` |
| Protocol (`api`) | `openai-completions` |
| `baseURL` | `https://api.unoblox.ai/v1` |
| Credential reference (`apiKeyEnv`) | `UNOBLOX_API_KEY` |
| Models | `unoblox/auto` (default; the Unoblox router picks the model and fails over between providers) plus the live Unoblox catalog |

## How the lock works

`build/dsh-desktop.patch.yml` and `build/dsh-desktop-safe.patch.yml` hold the same model rows. Keep those identical; only the web-search rows differ. Harness applies these files with `--patch`, as the CLI layer that comes after the bundle, profile and home layers. A patch row's `config` replaces the entry's whole config. As a result:

- `llm-pi-ai` gets a provider set containing only `unoblox`. Routes that a profile declared earlier (OpenAI, a custom gateway, and so on) are hidden but not deleted. The settings service refuses Models-page writes that this overlay would override.
- `llm-deepseek` and `llm-deepseek-account` are disabled, which removes the official DeepSeek API-key and account routes.
- `agent-default-model` is pinned to `unoblox` / `unoblox/auto`. Users can pick another Unoblox model per session in the model picker. Harness then tries to save that as the new default; the overlay refuses the save and Harness logs a warning, so new sessions start on Auto again.
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

## Info strip under the composer

`packages/dsh-desktop-unoblox-info` adds two icon pills to the composer dock (slot `conversation.composer.dock`, order 30). They sit on the same row as the stock stats pills and the context meter, with the same pill metrics. Nothing shown is a copied number:

| Pill | Source | Tooltip / accessible label |
| --- | --- | --- |
| Wallet icon + balance, e.g. `₹383.63` | `balance_inr` in the `x-unoblox-freemium` header of the latest chat response from any conversation | The gateway's own `note` sentence (charge, tier) |
| Sparkle icon + model, e.g. `gemma-4-26b-a4b-it` | `x-unoblox-served-model` / `x-unoblox-selected-model` of this conversation's latest reply | Full slug and `x-unoblox-selection-reason` |

- Nothing renders until Unoblox has reported a value: no loading or placeholder text. A missing key shows a warning pill, "No API key". A failed refresh keeps the values already shown. The pills refresh when a turn ends.
- In a narrow window the strip shrinks before the stock pills. The balance never truncates; the model name does.
- The search price and the per-reply charge are no longer shown in the row; the charge is still in the balance tooltip, as part of the gateway's note.
- Unoblox has no balance endpoint: `/v1/key`, `/v1/credits`, `/v1/balance`, `/v1/usage`, `/v1/account`, `/v1/me` and `/v1/generation(s)` all return 404 (`UB-REQ-404`) with a valid key. The strip therefore shows no balance pill until this Harness process has made a chat call. The balance is per account and shows in every conversation; the charge and the model belong to the conversation's own latest reply.
- Search responses carry no cost or balance (only `usage.search_requests` and the `srch_…` id), and no rate-limit headers were seen on any endpoint. Token counts and cache hits are in the stock stats pills.
- How the headers reach the plugin: the `dsh-llm-pi-ai` patch passes pi-ai's `onResponse` hook and publishes each successful response's status and headers (cookies removed, no body) as the Cordis event `llm-pi-ai/response` (`{ provider, model, sessionId?, status, headers }`). The plugin keeps entries for `provider: unoblox` only. Remove this part of the patch when upstream offers an equivalent response observer.
- Header values reach JavaScript as Latin-1 views of the bytes, while Unoblox sends UTF-8 (`₹`, `—`). `info.js` decodes them back before showing the note.
- The renderer reads one same-origin route, `GET /api/desktop-unoblox.info?session=<id>`, behind the Harness session cookie (401 without it). The response contains `key: set | missing | unknown`, never the key itself.
- The search privacy notice is not repeated in the strip, because no API response carries it. It stays in the first-run dialog.
- Safe Mode does not load the strip.

## Live captures (2026-10-07, key redacted)

- `POST /v1/chat/completions` with `unoblox/auto` → 200. `unoblox/auto` is not listed by `GET /v1/models` (65 models), and `GET /v1/models/unoblox/auto` is 404, but chat accepts it. Headers: `x-unoblox-selector: unoblox/auto`, `x-unoblox-selected-model` / `x-unoblox-served-model: google/gemma-4-26b-a4b-it`, `x-unoblox-selection-reason: unoblox/auto -> google/gemma-4-26b-a4b-it (best value: quality-per-price over capable models)`, `x-unoblox-cache: BYPASS` (`non_zero_temperature`), `x-generation-id: <uuid>`, `x-unoblox-freemium: {"balance_inr":…,"balance_requirement_inr":1000.0,"base_inr":0.0,"charged_inr":0.0,"gst_inr":0.0,"gst_rate_bps":0,"note":"Charged ₹0.00 at standard rates — …","stage":"paid","tier":"freemium"}`. A non-streaming body repeats that block as `unoblox`, plus OpenAI `usage`.
- Streaming (`stream: true`): the same headers, with `"charged_estimated": true`. The final chunk carries `usage` even without `stream_options`, and the stream has no `unoblox` block.
- `POST /v1/search` → 200 `{ requestId: "srch_…", results: [{ id, url, title, snippet, highlights[], publishedDate }], usage: { search_requests: 1 } }`, headers `x-generation-id: srch_…`, `x-unoblox-cache-reason: search_no_retention`, `cache-control: no-store`. A wrong key gives 401 `UB-GW-007`; no key gives `UB-GW-076`.
- A real Harness run (temporary `DSH_HOME`, key only in `.credentials.yaml`, child environment without the key) made a chat turn ("pong") and a `web_search` turn (answer `https://tokio.rs/tokio/tutorial/select.html`) through `api.unoblox.ai`. The info route then returned that session's balance and routed model.

## API key

The key (`ub-gw-…`) is never written to configuration. It is stored in the Harness credential store under `UNOBLOX_API_KEY`:

- New installs: the first-run dialog (`packages/dsh-desktop-onboarding/client.js`) has an Unoblox API-key field. The dialog also shows on any launch while no key is stored. Unoblox is the only provider, so this covers upgrades from DSH Desktop, development builds and a removed key. It reads only whether the key is configured, never its value.
- Everyone else: enter the key on the Unoblox row in Settings → Models. With the overlay in place, that card writes no settings and only stores the credential.

## Model catalog

The model picker offers what Unoblox serves, not a copied list:

- At startup the Desktop main process fetches `GET https://api.unoblox.ai/v1/models`. The listing is public, so no key is needed. `src/main/unoblox/model-catalog.ts` keeps text models with tool support (the agent needs tools): 64 of the 65 listed on 2026-10-07, leaving out DeepSeek-OCR. Each row carries the id, name, `context_length`, `max_completion_tokens` when given, and text/image input. Auto comes first, then the free models, then the rest by name. The listing has no free-tier flag, so a model counts as free when its prompt and completion prices are both zero (and its per-request price, if any): on 2026-10-09 that was Gemma 4 26B A4B Instruct and Qwen3.8-27B. The picker shows names only, so their names end in " · free"; the picker keeps this order.
- The rows reach Harness through `DSH_DESKTOP_UNOBLOX_MODELS`. Both patch files read it with a `!!js` expression. A missing or malformed value yields Auto alone, so it can never break boot.
- Harness reads configuration at launch, so the catalog is per launch. A launch waits at most 2.5 s for the listing. After that it uses the last good listing cached in `<userData>/harness/unoblox-models.json`, or Auto alone on a first offline launch, and the harness log names the source. Each Harness restart fetches again.
- `unoblox/auto` stays the default model.

## Changing the endpoint

Edit the `llm-pi-ai` row in both patch files, and `UNOBLOX_MODELS_URL` if the listing moves. `test/unoblox-provider.test.ts` composes the real base bundle, a profile that declares other providers, and each Desktop patch, then asserts the locked result, including the catalog expression for set, missing and malformed values.
