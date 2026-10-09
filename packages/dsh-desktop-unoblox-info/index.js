/**
 * Host half of the unoblox info strip under the composer.
 *
 * - Listens to `llm-pi-ai/response` (a seam added by the dsh-llm-pi-ai patch)
 *   and keeps what unoblox reported on the latest chat call per session:
 *   balance, charge and the model `unoblox/auto` routed to.
 * - Serves it to the renderer on one same-origin route. The API key never
 *   leaves this process; the route only says whether one is stored.
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { createTurnStore, turnFromHeaders } from './info.js'

export const name = 'dsh-desktop-unoblox-info'
export const inject = ['connection']
export const INFO_ROUTE = '/api/desktop-unoblox.info'

export const Config = z.object({
  provider: z.string().default('unoblox'),
  apiKeyEnv: z.string().default('UNOBLOX_API_KEY')
})

const NO_STORE = { 'Cache-Control': 'no-store' }

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {object} ctx - Cordis context.
 * @param {object} config - plugin config.
 * @param {{ now?: () => number }} [deps] - injectable for tests.
 */
export function apply(ctx, config, deps = {}) {
  const provider = config?.provider ?? 'unoblox'
  const ref = credentialRef(config?.apiKeyEnv ?? 'UNOBLOX_API_KEY')
  const turns = createTurnStore(deps.now === undefined ? {} : { now: deps.now })

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
      const key = await keyState()
      const turn = turns.session(sessionId)
      return Response.json({
        key,
        billing: turns.latestBilling() ?? null,
        turn: turn ?? null
      }, { headers: NO_STORE })
    }
  })
}
