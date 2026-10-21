/**
 * Host half of the unoblox info strip under the composer.
 *
 * - Listens to `llm-pi-ai/response` (a seam added by the dsh-llm-pi-ai patch)
 *   and keeps what unoblox reported on the latest chat call per session:
 *   balance, charge and the model `unoblox/auto` routed to.
 * - Serves it to the renderer on one same-origin route. The API key never
 *   leaves this process; the route only says whether one is stored.
 * - Adds up what each task (turn) and conversation spent, from unoblox's own
 *   per-response charge, and enforces the per-task budget the user set: the
 *   agent's next model call in a task over budget is not made, and the turn
 *   ends asking the user (spend.js). A default budget (session `*`) covers
 *   conversations that set none of their own.
 * - Keeps this computer's usage history (usage.js) for Settings › Usage: one
 *   line per charged response, served as daily, per-model and
 *   per-conversation totals.
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { join } from 'node:path'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { createTurnStore, turnFromHeaders } from './info.js'
import { createBudgetStore, createSpendTracker } from './spend.js'
import { createUsageLedger } from './usage.js'

export const name = 'dsh-desktop-unoblox-info'
export const inject = ['connection']
export const INFO_ROUTE = '/api/desktop-unoblox.info'
export const BUDGET_ROUTE = '/api/desktop-unoblox.budget'
export const USAGE_ROUTE = '/api/desktop-unoblox.usage'
export const BUDGET_CODE = 'UNOBLOX_BUDGET'
/** The budget store's key for the default task budget. */
export const DEFAULT_BUDGET = '*'

export const Config = z.object({
  provider: z.string().default('unoblox'),
  apiKeyEnv: z.string().default('UNOBLOX_API_KEY'),
  // unoblox's freemium models in picker order (DSH_DESKTOP_UNOBLOX_FREE_MODELS,
  // see build/dsh-desktop.patch.yml); offered when a turn is refused for balance.
  freeModels: z.array(z.string()).default([]),
  // The cheapest models by listed price (DSH_DESKTOP_UNOBLOX_LOW_COST_MODELS),
  // offered below the freemium threshold, where every model is charged.
  lowCostModels: z.array(z.string()).default([]),
  // Folder for the task budgets and usage history; none keeps them in memory.
  root: z.string().default('')
})

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Whether a POST comes from this app's own page. The Harness hands routes a
 * request whose URL is not the page's origin, so the browser's own signals
 * decide: Sec-Fetch-Site, else an Origin whose host is the request's Host.
 * Clients without an Origin (not a browser page) pass on the session cookie.
 */
export function fromSameOrigin(request) {
  const site = request.headers.get('sec-fetch-site')
  if (site === 'same-origin') return true
  if (site !== null && site !== 'none') return false
  const origin = request.headers.get('origin')
  if (origin === null) return true
  try {
    return new URL(origin).host === (request.headers.get('host') ?? new URL(request.url).host)
  } catch {
    return false
  }
}

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
  const modelList = (value) => Array.isArray(value) ? value.filter((id) => typeof id === 'string' && id !== '') : []
  const freeModels = modelList(config?.freeModels)
  const lowCostModels = modelList(config?.lowCostModels)
  const spend = createSpendTracker(deps.now === undefined ? {} : { now: deps.now })
  const root = typeof config?.root === 'string' && config.root !== '' ? config.root : undefined
  const budgets = createBudgetStore(root === undefined ? undefined : join(root, 'budgets.json'))
  const usage = createUsageLedger(root === undefined ? undefined : join(root, 'usage.jsonl'), deps.now === undefined ? {} : { now: deps.now })
  // Conversation titles seen this run, for the usage list.
  const titles = new Map()
  // The conversation's own budget, else the default one.
  const budgetFor = async (sessionId) => (await budgets.get(sessionId)) ?? (await budgets.get(DEFAULT_BUDGET))

  ctx.on('llm-pi-ai/response', (response) => {
    if (!isRecord(response) || response.provider !== provider) return
    const turn = turnFromHeaders(response.headers)
    if (turn !== undefined) turns.record(response.sessionId, turn)
    if (turn?.billing !== undefined) spend.charge(response.sessionId, turn.billing)
    if (turn?.billing?.chargedInr !== undefined) {
      const sessionId = typeof response.sessionId === 'string' ? response.sessionId : undefined
      usage.record({
        session: sessionId,
        title: sessionId === undefined ? undefined : titles.get(sessionId),
        model: turn.routing?.servedModel ?? turn.routing?.selectedModel,
        chargedInr: turn.billing.chargedInr,
        estimated: turn.billing.chargedEstimated,
        balanceInr: turn.billing.balanceInr
      }).catch((error) => ctx.logger.warn('unoblox-info: usage not recorded: %s', error instanceof Error ? error.message : String(error)))
    }
  })

  ctx.on('session/event', (session, event) => {
    const sessionId = String(session?.header?.id ?? session?.id)
    if (event?.type === 'turn/start') spend.turnStarted(sessionId, event.data?.turn)
    if (event?.type === 'session/title' && typeof event.data?.title === 'string') {
      titles.delete(sessionId)
      titles.set(sessionId, event.data.title)
      while (titles.size > 500) titles.delete(titles.keys().next().value)
    }
  })

  // Budget: before each of the agent's own model calls (not compaction or
  // titles), a task that has spent its budget stops and asks the user.
  ctx.on('llm/stream', (options, next) => {
    const agentCall = deps.isAgentCall ?? isAgentLoopRequest
    if (typeof options?.sessionId !== 'string' || !agentCall(options)) return next()
    const sessionId = options.sessionId
    return (async function* () {
      let budget
      try {
        budget = await budgetFor(sessionId)
      } catch (error) {
        ctx.logger.warn('unoblox-info: budget unreadable, not enforced: %s', error instanceof Error ? error.message : String(error))
      }
      const spent = spend.taskSpent(sessionId)
      // Stop before going over: the next step is expected to cost about what
      // recent steps here did. A task's first step always runs.
      const nextStep = spent > 0 ? spend.view(sessionId)?.stepInr ?? 0 : 0
      if (budget !== undefined && (spent >= budget || spent + nextStep > budget)) {
        ctx.logger.info('unoblox-info: task budget reached in %s (₹%s of ₹%s, next step about ₹%s)', sessionId, spent.toFixed(2), budget.toFixed(2), nextStep.toFixed(2))
        yield { type: 'finish', reason: { kind: 'error', failure: { message: `This task stopped at its budget: ₹${spent.toFixed(2)} spent of ₹${budget.toFixed(2)}, and the next step would cost about ₹${nextStep.toFixed(2)}.`, code: BUDGET_CODE } } }
        return
      }
      yield* next()
    })()
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
      const ownBudget = sessionId === undefined ? undefined : await budgets.get(sessionId).catch(() => undefined)
      const defaultBudgetInr = await budgets.get(DEFAULT_BUDGET).catch(() => undefined)
      const budgetInr = sessionId === undefined ? undefined : ownBudget ?? defaultBudgetInr
      return Response.json({
        key,
        billing: turns.latestBilling() ?? null,
        turn: turn ?? null,
        spend: spend.view(sessionId) ?? null,
        budgetInr: budgetInr ?? null,
        budgetIsDefault: budgetInr !== undefined && ownBudget === undefined,
        defaultBudgetInr: defaultBudgetInr ?? null,
        freeModels,
        lowCostModels
      }, { headers: NO_STORE })
    }
  })

  ctx.connection.fetch.register({
    path: USAGE_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const params = new URL(request.url).searchParams
      const days = Number(params.get('days') ?? 30)
      const offset = params.get('offset')
      const offsetMinutes = offset === null ? undefined : Number(offset)
      if (!Number.isInteger(days) || days < 1 || days > 366 || (offsetMinutes !== undefined && (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 900))) {
        return Response.json({ error: 'days must be 1–366 and offset a whole number of minutes' }, { status: 400, headers: NO_STORE })
      }
      try {
        const summary = await usage.summary({ days, offsetMinutes, titles })
        const defaultBudgetInr = await budgets.get(DEFAULT_BUDGET).catch(() => undefined)
        return Response.json({ ...summary, billing: turns.latestBilling() ?? null, key: await keyState(), defaultBudgetInr: defaultBudgetInr ?? null }, { headers: NO_STORE })
      } catch (error) {
        ctx.logger.warn('unoblox-info: usage unreadable: %s', error instanceof Error ? error.message : String(error))
        return Response.json({ error: 'usage history unreadable' }, { status: 500, headers: NO_STORE })
      }
    }
  })

  // A budget stop is the user's decision point: never retried, even under an
  // "always retry" policy, which would otherwise loop on it.
  ctx.on('agent/request-error', (payload, next) => payload?.failure?.code === BUDGET_CODE ? undefined : next(), { prepend: true })

  ctx.connection.fetch.register({
    path: BUDGET_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      // JSON only and same origin: a form post from another site cannot set it.
      if (!(request.headers.get('content-type') ?? '').includes('application/json') || !fromSameOrigin(request)) {
        return Response.json({ error: 'refused' }, { status: 403, headers: NO_STORE })
      }
      let body
      try {
        body = await request.json()
      } catch {
        return Response.json({ error: 'not JSON' }, { status: 400, headers: NO_STORE })
      }
      if (typeof body?.session !== 'string' || body.session === '' || !(body.budgetInr === null || typeof body.budgetInr === 'number')) {
        return Response.json({ error: 'session and budgetInr (a number, or null to remove it) are required' }, { status: 400, headers: NO_STORE })
      }
      try {
        await budgets.set(body.session, body.budgetInr)
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof RangeError ? 400 : 500, headers: NO_STORE })
      }
      return Response.json({ ok: true, budgetInr: body.budgetInr }, { headers: NO_STORE })
    }
  })
}
