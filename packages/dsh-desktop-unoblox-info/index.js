/**
 * Host half of the Unoblox info strip under the composer.
 *
 * - Listens to `llm-pi-ai/response` (a seam added by the dsh-llm-pi-ai patch)
 *   and keeps what Unoblox reported on the latest chat call per session:
 *   balance, charge and the model `unoblox/auto` routed to.
 * - Reads the public search price host-side (cached, see info.js).
 * - Serves both to the renderer on one same-origin route. The API key never
 *   leaves this process; the route only says whether one is stored.
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { UNOBLOX_SEARCH_PRICING_URL, createPricingSource, createTurnStore, turnFromHeaders } from './info.js'

export const name = 'dsh-desktop-unoblox-info'
export const inject = ['connection']
export const INFO_ROUTE = '/api/desktop-unoblox.info'

export const Config = z.object({
  provider: z.string().default('unoblox'),
  apiKeyEnv: z.string().default('UNOBLOX_API_KEY'),
  searchPricingURL: z.string().default(UNOBLOX_SEARCH_PRICING_URL)
})

const NO_STORE = { 'Cache-Control': 'no-store' }

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {object} ctx - Cordis context.
 * @param {object} config - plugin config.
 * @param {{ fetch?: typeof fetch, now?: () => number }} [deps] - injectable for tests.
 */
export function apply(ctx, config, deps = {}) {
  const provider = config?.provider ?? 'unoblox'
  const ref = credentialRef(config?.apiKeyEnv ?? 'UNOBLOX_API_KEY')
  const turns = createTurnStore(deps.now === undefined ? {} : { now: deps.now })
  const pricing = createPricingSource({
    url: config?.searchPricingURL ?? UNOBLOX_SEARCH_PRICING_URL,
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    ...(deps.now === undefined ? {} : { now: deps.now })
  })

  ctx.on('llm-pi-ai/response', (response) => {
    if (!isRecord(response) || response.provider !== provider) return
    const turn = turnFromHeaders(response.headers)
    if (turn !== undefined) turns.record(response.sessionId, turn)
  })

  const keyState = async () => {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return 'unknown'
    try {
      const value = (await credentials.resolve(ref))?.value
      return typeof value === 'string' && value.length > 0 ? 'set' : 'missing'
    } catch (error) {
      ctx.logger.warn('unoblox-info: credential lookup failed: %s', error instanceof Error ? error.message : String(error))
      return 'unknown'
    }
  }

  ctx.connection.fetch.register({
    path: INFO_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const sessionId = new URL(request.url).searchParams.get('session') ?? undefined
      const [key, price] = await Promise.all([keyState(), pricing.read()])
      const turn = turns.session(sessionId)
      return Response.json({
        key,
        searchPricing: 'pricing' in price ? { ...price.pricing, fetchedAt: price.fetchedAt } : null,
        searchPricingError: 'error' in price ? price.error : null,
        billing: turns.latestBilling() ?? null,
        turn: turn ?? null
      }, { headers: NO_STORE })
    }
  })
}
