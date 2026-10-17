/**
 * Host half of the context graph: durable knowledge that stays exact and
 * current across any number of compactions.
 *
 * - Capture: the Harness's own compaction call is also asked for graph
 *   changes (capture.js); they are applied to a local SQLite graph and cut
 *   out of the summary before it is stored.
 * - Injection: a size-capped slice of the graph is part of the runtime
 *   context on every request, with files marked when they changed after an
 *   item about them was recorded (graph.js, freshness.js).
 * - Lookup: the `context_lookup` tool searches everything else.
 * - Panel: two same-origin routes let the Context pill list, pin, edit and
 *   remove items. Nothing leaves this computer.
 */
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { captureInstruction, parseDelta, rewriteText, sessionUserWords, splitDelta, userWords } from './capture.js'
import { applyDelta, currentItems, DEFAULT_BUDGET, fileStates, lookup, renderSection, scopeOf } from './graph.js'
import { GraphStore, KINDS, MAX_TEXT, workspaceKey } from './store.js'

export const name = 'dsh-desktop-context-graph'
export const inject = ['sessions', 'systemPrompt', 'tools', 'connection']

export const TOOL_NAME = 'context_lookup'
export const GRAPH_ROUTE = '/api/desktop-context-graph'
export const ITEM_ROUTE = '/api/desktop-context-graph/item'
export const CONTEXT_NAME = 'desktop:context-graph'
/** After the stock sandbox (110), approval (115) and delegation (120) contexts. */
export const CONTEXT_ORDER = 130

export const Config = z.object({
  root: z.string().description('Folder for the graph database.'),
  budget: z.natural().default(DEFAULT_BUDGET).description('Characters of graph shown on every request.')
})

const NO_STORE = { 'Cache-Control': 'no-store' }

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * @param {object} ctx - Cordis context.
 * @param {{ root: string, budget?: number }} config
 * @param {{ store?: GraphStore }} [deps] - injectable for tests.
 */
export function apply(ctx, config, deps = {}) {
  const store = deps.store ?? new GraphStore(join(config.root, 'graph.sqlite'))
  ctx.effect(() => () => { if (deps.store === undefined) store.close() }, 'context-graph: store')
  const budget = config.budget ?? DEFAULT_BUDGET
  const compactions = new Map()

  /** The graph scope of a live session: its workspace folder and id. */
  const scopeOfSession = (session) => {
    const root = session?.header?.cwd
    const sessionId = session?.header?.id ?? session?.id
    if (typeof root !== 'string' || root === '' || sessionId === undefined) return undefined
    const scope = scopeOf(root, String(sessionId))
    try {
      store.rememberSession(scope.sessionId, scope.workspace, root)
    } catch (error) {
      ctx.logger.warn('context-graph: session not recorded: %s', errorText(error))
    }
    return scope
  }

  /** A conversation's scope for the panel, live or from the last time it was seen. */
  const scopeOfId = (sessionId) => {
    const live = ctx.sessions.get(sessionId)
    if (live !== undefined) return scopeOfSession(live)
    const known = store.sessionScope(sessionId)
    return known === undefined ? undefined : { ...known, sessionId }
  }

  ctx.on('session/event', (session, event) => {
    if (event?.type === 'compaction/start' && typeof event.data?.compactionId === 'string') compactions.set(session?.header?.id ?? session?.id, event.data.compactionId)
  })

  // Capture: piggyback on the compaction call, then cut the graph block out.
  ctx.on('llm/stream', (options, next) => {
    if (options?.purpose !== 'compaction' || options.sessionId === undefined) return next()
    const session = ctx.sessions.get(options.sessionId)
    const scope = scopeOfSession(session)
    const last = Array.isArray(options.messages) ? options.messages.at(-1) : undefined
    if (scope === undefined || last?.role !== 'user' || !Array.isArray(last.content)) return next()
    let words
    try {
      words = [...userWords(options.messages.slice(0, -1)), ...sessionUserWords(session)]
      // The Harness passes a fresh options object per call; its messages are frozen, the list is not.
      options.messages = [...options.messages.slice(0, -1), { ...last, content: [...last.content, { type: 'text', text: captureInstruction(currentItems(store, scope)) }] }]
    } catch (error) {
      ctx.logger.warn('context-graph: compaction left as is: %s', errorText(error))
      return next()
    }
    const compactionId = compactions.get(options.sessionId)
    return rewriteText(next(), async (text) => {
      const { summary, raw } = splitDelta(text)
      if (raw === undefined) {
        ctx.logger.info('context-graph: compaction %s recorded no graph changes', compactionId ?? '(manual)')
        return text
      }
      try {
        const delta = parseDelta(raw)
        if (delta === undefined) ctx.logger.warn('context-graph: compaction %s returned an unreadable graph block; skipped', compactionId ?? '(manual)')
        const stats = await applyDelta(store, scope, delta, { words, ...(compactionId === undefined ? {} : { compactionId }) })
        ctx.logger.info('context-graph: compaction %s: %d added, %d updated, %d confirmed, %d removed, %d quotes not verbatim, %d replaced items not restored',
          compactionId ?? '(manual)', stats.added, stats.updated, stats.confirmed, stats.removed, stats.quotesRejected, stats.staleRejected)
      } catch (error) {
        // The summary still goes through; only this compaction's graph changes are lost.
        ctx.logger.warn('context-graph: graph changes not saved: %s', errorText(error))
      }
      return summary
    })
  })

  // Injection: an entry in the runtime context, filled in asynchronously
  // (file checks) during assembly.
  ctx.effect(() => ctx.systemPrompt.context({ name: CONTEXT_NAME, order: CONTEXT_ORDER, text: '' }), 'context-graph: runtime context')
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next()
    if (!result.contexts.some((entry) => entry.name === CONTEXT_NAME)) return result
    const scope = scopeOfSession(context?.agent?.session)
    if (scope === undefined) return result
    let text = ''
    try {
      text = await renderSection(store, scope, { budget })
    } catch (error) {
      ctx.logger.warn('context-graph: not shown this step: %s', errorText(error))
    }
    return { ...result, contexts: result.contexts.map((entry) => entry.name === CONTEXT_NAME ? { ...entry, text } : entry) }
  })

  ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: [
      'Search the workspace context graph: durable rules, goals, decisions, facts, tasks and error fixes recorded from earlier in this and other conversations in this workspace, kept across compactions.',
      'Look up by words (query), by a file path (file), or by an item id from the Context graph section (id: returns its history and linked items).',
      'Use it before re-reading files or asking the user about something that may already be settled. Items about files that changed since they were recorded are marked; re-read those files.'
    ].join(' '),
    parameters: {
      query: { type: 'string', description: 'Words to search for.' },
      file: { type: 'string', description: 'A workspace file path; returns items about that file.' },
      id: { type: 'string', description: 'An item id such as d-1a2b3c4d.' },
      limit: { type: 'integer', description: 'Most items to return (1–30, default 12).' }
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, result) => [{ type: 'text', text: result.text }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const scope = scopeOfSession(exec?.agent?.session)
      if (scope === undefined) throw new Error('the context graph needs a conversation with a workspace folder')
      const query = typeof args.query === 'string' && args.query.trim() !== '' ? args.query.trim().slice(0, 300) : undefined
      const file = typeof args.file === 'string' && args.file.trim() !== '' ? args.file.trim() : undefined
      const id = typeof args.id === 'string' && args.id.trim() !== '' ? args.id.trim() : undefined
      if (query === undefined && file === undefined && id === undefined) throw new Error('give a query, a file or an id')
      const limit = Math.min(30, Math.max(1, Number.isInteger(args.limit) ? args.limit : 12))
      return { text: await lookup(store, scope, { query, file, id, limit }) }
    }
  }))

  // Panel routes. Same origin, behind the Harness session cookie.
  ctx.connection.fetch.register({
    path: GRAPH_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url)
      const sessionId = url.searchParams.get('session') ?? ''
      const scope = sessionId === '' ? undefined : scopeOfId(sessionId)
      if (scope === undefined) return Response.json({ workspace: null, items: [] }, { headers: NO_STORE })
      const query = url.searchParams.get('q')?.trim() ?? ''
      const items = query === '' ? store.live(scope.workspace, scope.sessionId) : store.search(scope.workspace, scope.sessionId, query, 200)
      const view = []
      for (const item of items) {
        view.push({
          id: item.id,
          kind: item.kind,
          text: item.text,
          ...(item.quote === undefined ? {} : { quote: item.quote }),
          ...(item.status === undefined ? {} : { status: item.status }),
          pinned: item.pinned,
          origin: item.origin,
          shared: item.sessionId === undefined,
          updatedAt: item.updatedAt,
          files: await fileStates(scope.root, item)
        })
      }
      return Response.json({ workspace: scope.root, items: view }, { headers: NO_STORE })
    }
  })

  ctx.connection.fetch.register({
    path: ITEM_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      // JSON only and same origin: a form post from another site cannot reach this.
      const origin = request.headers.get('origin')
      if (!(request.headers.get('content-type') ?? '').includes('application/json') || (origin !== null && origin !== new URL(request.url).origin)) {
        return Response.json({ error: 'refused' }, { status: 403, headers: NO_STORE })
      }
      let body
      try {
        body = await request.json()
      } catch {
        return Response.json({ error: 'not JSON' }, { status: 400, headers: NO_STORE })
      }
      const scope = typeof body?.session === 'string' ? scopeOfId(body.session) : undefined
      if (scope === undefined) return Response.json({ error: 'unknown conversation' }, { status: 404, headers: NO_STORE })
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : ''
      try {
        if (body.action === 'add') {
          if (!KINDS.includes(body.kind) || text === '') return Response.json({ error: 'kind and text are required' }, { status: 400, headers: NO_STORE })
          // What the user types is their own words: a rule keeps it as the quote.
          const id = store.put({ workspace: scope.workspace, sessionId: scope.sessionId, kind: body.kind, text, ...(body.kind === 'rule' ? { quote: text } : {}), ...(body.kind === 'task' ? { status: 'open' } : {}), origin: 'user', pinned: body.kind === 'rule' })
          return Response.json({ ok: true, id }, { headers: NO_STORE })
        }
        const item = typeof body.id === 'string' ? store.get(body.id) : undefined
        if (item === undefined || item.workspace !== scope.workspace || item.deletedAt !== undefined) return Response.json({ error: 'unknown item' }, { status: 404, headers: NO_STORE })
        if (body.action === 'pin' || body.action === 'unpin') store.setPinned(item.id, scope.workspace, body.action === 'pin')
        else if (body.action === 'delete') store.remove(item.id, scope.workspace)
        else if (body.action === 'edit' && text !== '') {
          store.put({ ...item, workspace: scope.workspace, text, ...(item.kind === 'rule' ? { quote: text } : {}), origin: 'user' })
        } else if (body.action === 'done' && item.kind === 'task') store.put({ ...item, workspace: scope.workspace, status: 'done', origin: 'user' })
        else return Response.json({ error: 'unknown action' }, { status: 400, headers: NO_STORE })
        return Response.json({ ok: true }, { headers: NO_STORE })
      } catch (error) {
        ctx.logger.warn('context-graph: panel change failed: %s', errorText(error))
        return Response.json({ error: errorText(error) }, { status: 500, headers: NO_STORE })
      }
    }
  })
}

export { workspaceKey }
