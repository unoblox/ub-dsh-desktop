/**
 * Unoblox model gateway route for DSH Desktop.
 *
 * Unoblox speaks the OpenAI Chat Completions API (https://unoblox.ai/docs/quickstart),
 * so it is declared as a hand-written `llm-pi-ai` route rather than a new LLM
 * adapter. The route is written into the active profile's settings document —
 * the same layer the Models page edits — instead of the Desktop `--patch`
 * overlay: an overlay outranks the profile, and the settings service refuses
 * every form write it would override, which would lock users out of adding or
 * editing other providers.
 *
 * The API key never enters configuration. The route names the credential
 * reference `UNOBLOX_API_KEY`; the onboarding dialog or the Models page stores
 * the `ub-gw-…` key under that reference in the Harness credential store.
 */

export const UNOBLOX_ROUTE = 'unoblox'
export const UNOBLOX_KEY_REF = 'UNOBLOX_API_KEY'
export const UNOBLOX_BASE_URL = 'https://api.unoblox.ai/v1'
// The router picks the best-value model that can serve the request and fails
// over across upstream providers, so it is a safe default for every account.
export const UNOBLOX_DEFAULT_MODEL = 'unoblox/auto'
// Bump when the seeded route changes shape and existing profiles should be
// offered the new one. A profile that already has an `unoblox` route keeps it.
export const UNOBLOX_SEED_VERSION = 'unoblox-1'

const PI_AI_NS = 'llm-pi-ai'
// The stock default the base bundle ships; only an untouched default is moved.
const STOCK_DEFAULT_PROVIDER = 'deepseek-official'

/** The `llm-pi-ai` provider profile for the Unoblox gateway. */
export function unobloxProviderProfile() {
  return {
    displayName: 'Unoblox',
    apiKeyEnv: UNOBLOX_KEY_REF,
    api: 'openai-completions',
    baseURL: UNOBLOX_BASE_URL,
    // More catalog models can be discovered and adopted from Settings → Models,
    // which lists them through `GET {baseURL}/models` with this route's key.
    models: [{ id: UNOBLOX_DEFAULT_MODEL, name: 'Unoblox Auto' }]
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Add the Unoblox route to the profile once and make it the default model for
 * new agents when the profile still uses the stock default.
 *
 * @param {object} deps
 * @param {{ describe: () => unknown[], mutate: (ns: string, ops: unknown[], revision?: number) => Promise<void> }} deps.settings
 * @param {{ currentSelection: () => { provider?: string }, saveSelection: (next: object) => Promise<void> } | undefined} deps.agentDefaultModel
 * @param {string} deps.selfNs - this plugin's settings namespace, where the seed marker lives.
 * @param {unknown} deps.seeded - the seed marker currently in this plugin's config.
 * @returns {Promise<'already-seeded' | 'adapter-absent' | 'seeded'>}
 */
export async function seedUnobloxProvider({ settings, agentDefaultModel, selfNs, seeded }) {
  // A marker keeps a user's deliberate deletion of the route from being undone.
  if (seeded === UNOBLOX_SEED_VERSION) return 'already-seeded'

  const descriptors = settings.describe()
  const piAi = Array.isArray(descriptors)
    ? descriptors.find((row) => isRecord(row) && row.ns === PI_AI_NS)
    : undefined
  // Without an active pi-ai entry there is nowhere to write the route; leave
  // the marker unset so a later launch retries.
  if (!isRecord(piAi)) return 'adapter-absent'

  const providers = isRecord(piAi.value) && isRecord(piAi.value.providers) ? piAi.value.providers : {}
  if (!Object.hasOwn(providers, UNOBLOX_ROUTE)) {
    await settings.mutate(PI_AI_NS, [{
      op: 'set',
      path: ['providers', UNOBLOX_ROUTE],
      value: unobloxProviderProfile()
    }], typeof piAi.revision === 'number' ? piAi.revision : undefined)
  }

  if (agentDefaultModel !== undefined) {
    const current = agentDefaultModel.currentSelection()
    if (current?.provider === STOCK_DEFAULT_PROVIDER) {
      await agentDefaultModel.saveSelection({ provider: UNOBLOX_ROUTE, model: UNOBLOX_DEFAULT_MODEL })
    }
  }

  await settings.mutate(selfNs, [{ op: 'set', path: ['providerSeed'], value: UNOBLOX_SEED_VERSION }])
  return 'seeded'
}
