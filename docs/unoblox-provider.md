# Unoblox provider

DSH Desktop connects to models through the [Unoblox](https://unoblox.ai/docs/quickstart) gateway by default. Unoblox speaks the OpenAI Chat Completions API, so it runs as a hand-declared `llm-pi-ai` route. Desktop does not add a separate LLM adapter for it.

| Field | Value |
| --- | --- |
| Route id | `unoblox` |
| Protocol (`api`) | `openai-completions` |
| `baseURL` | `https://api.unoblox.ai/v1` |
| Credential reference (`apiKeyEnv`) | `UNOBLOX_API_KEY` |
| Seeded model | `unoblox/auto` (the Unoblox router picks the model and fails over between providers) |

The constants live in `packages/dsh-desktop-onboarding/unoblox-provider.js`.

## How it is wired

- **Route seeding (host).** When the profile boots, `dsh-desktop-onboarding` waits for the Loader to settle. If the active profile has no `unoblox` route, the plugin writes one to `llm-pi-ai.providers.unoblox` through the settings service. If new agents still use the stock default (`deepseek-official`), the plugin also switches that default to `unoblox` / `unoblox/auto`. It then records `providerSeed: unoblox-1` in its own settings. Because of that marker, the route is not added again after a user deletes it.
- **Why not `dsh-desktop.patch.yml`?** That file is applied with `--patch`, which outranks the profile. The settings service refuses form writes that an overlay would override. If the route were configured there, users could no longer add or edit providers in Settings → Models.
- **API key (client).** The first-run dialog has an API-key field for Unoblox. The key (`ub-gw-…`) goes to the Harness credential store under `UNOBLOX_API_KEY` and never into profile configuration. Users who skip the dialog, or who already had an installation, can enter the key on the Unoblox row in Settings → Models.
- **More models.** In Settings → Models, the Unoblox route can discover other catalog models (`GET /v1/models` with the stored key) and add them.

## Changing the endpoint or defaults

Edit the constants in `unoblox-provider.js`. Profiles that already have a `unoblox` route keep it. To roll a new route shape out to existing profiles, bump `UNOBLOX_SEED_VERSION` and write a migration for the existing route. Bumping the version alone does not overwrite a route that is already there.
