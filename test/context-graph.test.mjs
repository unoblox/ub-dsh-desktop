import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GraphStore, ftsQuery, workspaceKey } from '../packages/dsh-desktop-context-graph/store.js'
import { captureInstruction, parseDelta, quoteIsVerbatim, rewriteText, splitDelta, userWords } from '../packages/dsh-desktop-context-graph/capture.js'
import { applyDelta, currentItems, lookup, renderSection, scopeOf } from '../packages/dsh-desktop-context-graph/graph.js'
import { workspacePath } from '../packages/dsh-desktop-context-graph/freshness.js'
import { apply as applyPlugin, CONTEXT_NAME, GRAPH_ROUTE, ITEM_ROUTE, TOOL_NAME } from '../packages/dsh-desktop-context-graph/index.js'

let root = ''
let store
let clock = 1_000
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ctx-graph-ws-'))
  clock = 1_000
  store = new GraphStore(':memory:', { now: () => ++clock })
})
afterEach(async () => {
  store.close()
  await rm(root, { recursive: true, force: true })
})

const delta = (value) => `${'## Primary Request and Intent\n- build it'}\n<context-graph-delta>\n${JSON.stringify(value)}\n</context-graph-delta>`

describe('store', () => {
  it('keeps workspaces apart and conversation goals to their conversation', () => {
    const a = workspaceKey('/w/a')
    const b = workspaceKey('/w/b')
    store.put({ workspace: a, kind: 'rule', text: 'small letters', origin: 'model' })
    store.put({ workspace: a, sessionId: 's1', kind: 'goal', text: 'ship sign-in', origin: 'model' })
    store.put({ workspace: b, kind: 'fact', text: 'other project', origin: 'model' })
    expect(store.live(a, 's1').map((item) => item.kind).sort()).toEqual(['goal', 'rule'])
    expect(store.live(a, 's2').map((item) => item.kind)).toEqual(['rule'])
    expect(store.live(b, 's1').map((item) => item.text)).toEqual(['other project'])
  })

  it('searches words, files and links, and keeps replaced items as history', () => {
    const w = workspaceKey('/w')
    const old = store.put({ workspace: w, kind: 'fact', text: 'Sign-in listens on port 53682', files: [{ path: 'src/main/unoblox/sign-in-config.ts' }], origin: 'model' })
    const now = store.put({ workspace: w, kind: 'fact', text: 'Sign-in lets the OS pick the port', files: [{ path: 'src/main/unoblox/sign-in-config.ts' }], replaces: [old], origin: 'model' })
    const decision = store.put({ workspace: w, kind: 'decision', text: 'Use any-port loopback', links: [{ id: now, rel: 'about' }], origin: 'model' })
    expect(store.search(w, 's', 'pick').map((item) => item.id)).toEqual([now])
    expect(store.search(w, 's', 'port').map((item) => item.id).sort()).toEqual([now, decision].sort())
    expect(store.aboutFile(w, 's', 'sign-in-config.ts').map((item) => item.id)).toEqual([now])
    expect(store.neighbours(now, w, 's').map((item) => item.id)).toEqual([decision])
    expect(store.history(now).map((item) => item.text)).toEqual(['Sign-in listens on port 53682'])
    expect(store.get(old).supersededBy).toBe(now)
  })

  it('builds safe full-text queries from any input', () => {
    expect(ftsQuery('port "53682" OR drop table')).toBe('"port"* OR "53682"* OR "or"* OR "drop"* OR "table"*')
    expect(ftsQuery('***')).toBe('')
    expect(store.search(workspaceKey('/w'), 's', 'NEAR( " )')).toEqual([])
  })
})

describe('capture', () => {
  it('splits the graph block off the checkpoint and validates it', () => {
    const { summary, raw } = splitDelta(delta({ items: [{ kind: 'fact', text: 'x' }] }))
    expect(summary).toBe('## Primary Request and Intent\n- build it')
    expect(parseDelta(raw)).toEqual({ items: [{ kind: 'fact', text: 'x', files: [], symbols: [], replaces: [], links: [] }], confirm: [], remove: [] })
    expect(parseDelta('```json\n{"items":[{"kind":"bogus","text":"x"},{"kind":"rule","text":"y","quote":"q","status":"done"}]}\n```')?.items)
      .toEqual([{ kind: 'rule', text: 'y', quote: 'q', files: [], symbols: [], replaces: [], links: [] }])
    expect(parseDelta('{not json')).toBeUndefined()
    expect(splitDelta('no block here')).toEqual({ summary: 'no block here' })
    // A block cut off by the token limit is dropped, not guessed.
    expect(splitDelta('sum\n<context-graph-delta>\n{"items":[')).toEqual({ summary: 'sum', raw: '{"items":[' })
  })

  it('accepts a quote only when the user wrote it', () => {
    const words = userWords([
      { role: 'user', content: [{ type: 'text', text: 'unoblox is all small letters – everywhere' }] },
      { role: 'user', content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n"never print the key"' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'I will never print the key' }] }
    ])
    expect(quoteIsVerbatim('unoblox is all small letters - everywhere', words)).toBe(true)
    expect(quoteIsVerbatim('never print the key', words)).toBe(false)
    expect(quoteIsVerbatim('unoblox must be lowercase', words)).toBe(false)
  })

  it('cuts the block out of a streamed answer before the Harness assembles it', async () => {
    const answer = delta({ items: [] })
    const chunks = [
      { type: 'block-start', index: 0, blockType: 'text' },
      ...answer.match(/.{1,7}/gsu).map((text) => ({ type: 'text-delta', index: 0, text })),
      { type: 'block-end', index: 0, block: { type: 'text', text: answer } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } }
    ]
    async function* stream() { yield* chunks }
    let seen = ''
    const out = []
    for await (const chunk of rewriteText(stream(), async (text) => { seen = text; return splitDelta(text).summary })) out.push(chunk)
    expect(seen).toBe(answer)
    const text = out.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
    expect(text).toBe('## Primary Request and Intent\n- build it')
    expect(out.find((chunk) => chunk.type === 'block-end').block.text).toBe(text)
    expect(out.at(-1).type).toBe('finish')
  })
})

describe('graph', () => {
  it('records changes, flags files edited since, and keeps the user\'s edits', async () => {
    await writeFile(join(root, 'config.ts'), 'export const PORT = 53682\n')
    const scope = scopeOf(root, 's1')
    const words = userWords([{ role: 'user', content: [{ type: 'text', text: 'Never print the API key.' }] }])
    const first = await applyDelta(store, scope, parseDelta(JSON.stringify({ items: [
      { kind: 'rule', text: 'Do not print the key', quote: 'Never print the API key.' },
      { kind: 'rule', text: 'Made-up rule', quote: 'something the user never said' },
      { kind: 'fact', text: 'The port is 53682', files: ['config.ts', '../outside.txt', '/etc/passwd'], links: [{ to: '#0', rel: 'relates-to' }] },
      { kind: 'goal', text: 'Ship sign-in' },
      { kind: 'task', text: 'Write docs', status: 'open' }
    ] })), { words, compactionId: 'c1' })
    expect(first).toMatchObject({ added: 5, quotesRejected: 1 })
    const fact = store.live(scope.workspace, 's1').find((item) => item.kind === 'fact')
    expect(fact.files.map((file) => file.path)).toEqual(['config.ts'])
    expect(fact.links).toEqual([{ id: first.ids[0], rel: 'relates-to' }])
    let section = await renderSection(store, scope)
    expect(section).toContain('"Never print the API key."')
    expect(section).toContain('Made-up rule (paraphrased)')
    expect(section).toContain('files: config.ts')
    expect(section).not.toContain('config.ts (changed')
    // Unchanged graph and files: the same text, so no new snapshot is sent.
    expect(await renderSection(store, scope)).toBe(section)

    await writeFile(join(root, 'config.ts'), 'export const PORT = 0\n')
    section = await renderSection(store, scope)
    expect(section).toContain('config.ts (changed since recorded: re-read before relying on this)')

    // The user edits the fact; a later compaction cannot reword or remove it.
    store.put({ ...fact, workspace: scope.workspace, text: 'The OS picks the port', origin: 'user' })
    await applyDelta(store, scope, { items: [{ id: fact.id, kind: 'fact', text: 'The port is 53682 again', files: [], symbols: [], replaces: [], links: [] }], confirm: [], remove: [fact.id] }, { words: [] })
    expect(store.get(fact.id)).toMatchObject({ text: 'The OS picks the port', origin: 'user' })
    expect(store.get(fact.id).deletedAt).toBeUndefined()
  })

  it('updates a restated item instead of duplicating it, and hides finished tasks', async () => {
    const scope = scopeOf(root, 's1')
    await applyDelta(store, scope, parseDelta(JSON.stringify({ items: [{ kind: 'task', text: 'Write docs', status: 'open' }] })))
    await applyDelta(store, scope, parseDelta(JSON.stringify({ items: [{ kind: 'task', text: 'write  docs', status: 'done' }] })))
    expect(store.live(scope.workspace, 's1')).toHaveLength(1)
    expect(await renderSection(store, scope)).toBe('')
  })

  it('stays within its budget and points to the lookup tool for the rest', async () => {
    const scope = scopeOf(root, 's1')
    const items = Array.from({ length: 300 }, (_, n) => ({ kind: 'fact', text: `Fact number ${String(n)} about the build pipeline and its caches` }))
    await applyDelta(store, scope, parseDelta(JSON.stringify({ items: items.slice(0, 40) })))
    for (let start = 40; start < 300; start += 40) await applyDelta(store, scope, parseDelta(JSON.stringify({ items: items.slice(start, start + 40) })))
    const section = await renderSection(store, scope, { budget: 2000 })
    expect(section.length).toBeLessThanOrEqual(2000)
    expect(section).toMatch(/\(\d+ more items are not shown here; use context_lookup\.\)$/u)
    expect(await lookup(store, scope, { query: 'number 7 pipeline', limit: 3 })).toContain('Fact number 7 ')
    expect(currentItems(store, scope).split('\n')).toHaveLength(151)
  })

  it('accepts only paths inside the workspace', () => {
    expect(workspacePath('/w', 'src/a.ts')).toBe('src/a.ts')
    expect(workspacePath('/w', '/w/src/a.ts')).toBe('src/a.ts')
    expect(workspacePath('/w', '../x')).toBeUndefined()
    expect(workspacePath('/w', '/etc/passwd')).toBeUndefined()
    expect(workspacePath('/w', 'https://example.com/a')).toBeUndefined()
  })
})

/** A Cordis-like host: listeners, waterfalls, one live session, tools and routes. */
function host(sessionRoot) {
  const listeners = new Map()
  const routes = new Map()
  const tools = new Map()
  const contexts = []
  const logs = []
  const session = { header: { id: 's1', cwd: sessionRoot } }
  const ctx = {
    on: (name, listener) => { listeners.set(name, [...(listeners.get(name) ?? []), listener]) },
    effect: (setup) => { setup() },
    logger: { info: (...args) => logs.push(['info', ...args]), warn: (...args) => logs.push(['warn', ...args]) },
    sessions: { get: (id) => id === 's1' ? session : undefined },
    systemPrompt: { context: (entry) => { contexts.push(entry); return () => {} } },
    tools: { register: (tool) => { tools.set(tool.name, tool) } },
    connection: { fetch: { register: (route) => routes.set(`${route.methods[0]} ${route.path}`, route.fetch) } }
  }
  const emit = (name, ...args) => listeners.get(name)?.forEach((listener) => listener(...args))
  const waterfall = (name, ...args) => {
    const chain = [...(listeners.get(name) ?? [])]
    const inner = args.pop()
    const next = () => (chain.shift() ?? inner)(...args)
    args.push(next)
    return next()
  }
  return { ctx, emit, waterfall, routes, tools, contexts, logs, session }
}

describe('plugin', () => {
  it('captures through the compaction call, shows the slice, and answers lookups and the panel', async () => {
    await writeFile(join(root, 'brand.ts'), 'export const BRAND = "unoblox"\n')
    const h = host(root)
    applyPlugin(h.ctx, { root: '' }, { store })
    expect(h.contexts.map((entry) => entry.name)).toEqual([CONTEXT_NAME])
    h.emit('session/event', h.session, { type: 'compaction/start', data: { compactionId: 'cmp-1' } })

    const options = {
      purpose: 'compaction',
      sessionId: 's1',
      messages: [
        Object.freeze({ role: 'user', content: Object.freeze([{ type: 'text', text: 'unoblox is all small letters – everywhere' }]) }),
        Object.freeze({ role: 'user', content: Object.freeze([{ type: 'text', text: 'You are now acting as a compaction engine' }]) })
      ]
    }
    const answer = delta({ items: [
      { kind: 'rule', text: 'Brand is lowercase', quote: 'unoblox is all small letters – everywhere' },
      { kind: 'fact', text: 'The brand constant lives in brand.ts', files: ['brand.ts'] }
    ] })
    let sentInstruction = ''
    const stream = h.waterfall('llm/stream', options, () => {
      sentInstruction = options.messages.at(-1).content.at(-1).text
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: answer }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    })
    let summary = ''
    for await (const chunk of stream) if (chunk.type === 'text-delta') summary += chunk.text
    expect(sentInstruction).toContain('<context-graph-delta>')
    expect(summary).toBe('## Primary Request and Intent\n- build it')
    expect(h.logs.some(([level, message]) => level === 'info' && String(message).includes('compaction %s'))).toBe(true)

    // Other calls pass through untouched.
    const plain = { purpose: 'title', sessionId: 's1', messages: [] }
    expect(h.waterfall('llm/stream', plain, () => 'untouched')).toBe('untouched')

    const assembled = await h.waterfall('system-prompt/assemble', { contexts: [{ name: CONTEXT_NAME, text: '' }, { name: 'sandbox:policy', text: 'x' }] }, { agent: { session: h.session } }, async (assembly) => assembly)
    const section = assembled.contexts[0].text
    expect(section).toContain('"unoblox is all small letters – everywhere"')
    expect(section).toContain('files: brand.ts')
    expect(assembled.contexts[1].text).toBe('x')

    const tool = h.tools.get(TOOL_NAME)
    expect((await tool.execute({ file: 'brand.ts' }, { agent: { session: h.session } })).text).toContain('The brand constant lives in brand.ts')
    await expect(tool.execute({}, { agent: { session: h.session } })).rejects.toThrow('give a query')

    const list = await (await h.routes.get(`GET ${GRAPH_ROUTE}`)(new Request(`http://127.0.0.1${GRAPH_ROUTE}?session=s1`))).json()
    expect(list.workspace).toBe(root)
    expect(list.items).toHaveLength(2)
    const rule = list.items.find((item) => item.kind === 'rule')
    const post = (body, headers = { 'content-type': 'application/json' }) => h.routes.get(`POST ${ITEM_ROUTE}`)(new Request(`http://127.0.0.1${ITEM_ROUTE}`, { method: 'POST', headers, body: JSON.stringify(body) }))
    expect((await post({ session: 's1', id: rule.id, action: 'pin' })).status).toBe(200)
    expect(store.get(rule.id).pinned).toBe(true)
    expect((await post({ session: 's1', action: 'add', kind: 'rule', text: 'Answer in English' })).status).toBe(200)
    expect(store.live(store.sessionScope('s1').workspace, 's1').find((item) => item.text === 'Answer in English')).toMatchObject({ quote: 'Answer in English', origin: 'user', pinned: true })
    // Not JSON, or from another site: refused.
    expect((await post({ session: 's1', id: rule.id, action: 'delete' }, { 'content-type': 'text/plain' })).status).toBe(403)
    expect((await post({ session: 's1', id: rule.id, action: 'delete' }, { 'content-type': 'application/json', origin: 'https://evil.example' })).status).toBe(403)
    expect(store.get(rule.id).deletedAt).toBeUndefined()
    expect((await post({ session: 's9', id: rule.id, action: 'delete' })).status).toBe(404)
  })

  it('leaves the summary alone when the model records nothing or the block is unreadable', async () => {
    const h = host(root)
    applyPlugin(h.ctx, { root: '' }, { store })
    for (const text of ['## Summary only', 'sum\n<context-graph-delta>\n{broken\n</context-graph-delta>']) {
      const options = { purpose: 'compaction', sessionId: 's1', messages: [{ role: 'user', content: [{ type: 'text', text: 'compact' }] }] }
      let out = ''
      for await (const chunk of h.waterfall('llm/stream', options, () => (async function* () { yield { type: 'text-delta', index: 0, text }; yield { type: 'finish', reason: { kind: 'stop' } } })())) {
        if (chunk.type === 'text-delta') out += chunk.text
      }
      expect(out).toBe(text.startsWith('sum') ? 'sum' : text)
    }
    expect(h.logs.some(([level, message]) => level === 'warn' && String(message).includes('unreadable'))).toBe(true)
  })
})

describe('capture instruction', () => {
  it('lists the current items by id for the compaction call', () => {
    expect(captureInstruction('')).toContain('The graph is empty so far.')
    expect(captureInstruction('[r-00000001] rule: "x"')).toContain('Current graph items:\n[r-00000001] rule: "x"')
  })
})
