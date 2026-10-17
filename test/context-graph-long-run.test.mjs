import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GraphStore } from '../packages/dsh-desktop-context-graph/store.js'
import { DELTA_CLOSE, DELTA_OPEN } from '../packages/dsh-desktop-context-graph/capture.js'
import { apply as applyPlugin, CONTEXT_NAME, TOOL_NAME } from '../packages/dsh-desktop-context-graph/index.js'

// 300 compactions of one long conversation, through the plugin's real
// capture and injection path. The stand-in model behaves like a real one
// at its worst: each checkpoint keeps only the last few points of the
// previous one (so the recursive summary loses early facts), it restates
// items in other words, paraphrases quotes, now and then returns a broken
// graph block or none at all, and tries to remove a pinned rule.
const ROUNDS = 300
const RULE_1 = 'unoblox is all small letters – everywhere'
const RULE_2 = 'Never print, log or commit the API key.'

let root = ''
let store
let clock = 0
let h
const summaries = []

function host() {
  const listeners = new Map()
  const tools = new Map()
  // The conversation's full log, as the Harness keeps it on disk.
  const log = []
  const session = { header: { id: 'long', cwd: root }, snapshotEvents: () => log, log }
  const ctx = {
    on: (name, listener) => { listeners.set(name, [...(listeners.get(name) ?? []), listener]) },
    effect: (setup) => { setup() },
    logger: { info: () => {}, warn: () => {} },
    sessions: { get: (id) => id === 'long' ? session : undefined },
    systemPrompt: { context: () => () => {} },
    tools: { register: (tool) => tools.set(tool.name, tool) },
    connection: { fetch: { register: () => {} } }
  }
  const waterfall = (name, ...args) => {
    const chain = [...(listeners.get(name) ?? [])]
    const inner = args.pop()
    const next = () => (chain.shift() ?? inner)(...args)
    args.push(next)
    return next()
  }
  const emit = (name, ...args) => listeners.get(name)?.forEach((listener) => listener(...args))
  applyPlugin(ctx, { root: '' }, { store })
  return { waterfall, emit, tools, session }
}

/** What the user says in round n, and what the stand-in model records from it. */
function round(n) {
  const said = [`Round ${String(n)}: keep going with the pipeline work.`]
  const items = []
  if (n === 1) {
    said.push(RULE_1)
    items.push({ kind: 'rule', text: 'Write the brand in lowercase', quote: RULE_1 })
    items.push({ kind: 'goal', text: 'Ship the desktop app with sign-in' })
    items.push({ kind: 'fact', text: 'Sign-in listens on port 53682', files: ['src/sign-in-config.ts'], symbols: ['SIGN_IN_PORTS'] })
  }
  if (n === 7) {
    said.push(RULE_2)
    // Paraphrased the first time: rejected as a quote, kept as text.
    items.push({ kind: 'rule', text: 'Keep the key secret', quote: 'Do not print the key' })
  }
  // Quoted exactly one compaction later: the user's words are gone from the
  // model's view by then, but not from the conversation log.
  if (n === 8) items.push({ kind: 'rule', text: 'Keep the key secret', quote: RULE_2 })
  if (n % 10 === 0) items.push({ kind: 'fact', text: `Build step ${String(n)} caches artifacts under out/step-${String(n)}` })
  if (n % 25 === 0) items.push({ kind: 'task', text: `Review step ${String(n)}`, status: 'open' })
  if (n % 25 === 5 && n > 25) items.push({ kind: 'task', text: `review step ${String(n - 5)}`, status: 'done' })
  if (n % 3 === 0) items.push({ kind: 'fact', text: 'sign-in LISTENS on port 53682' })
  return { said, items }
}

async function compact(n, previous) {
  const { said, items } = round(n)
  for (const text of said) h.session.log.push({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  const messages = [
    ...(previous === '' ? [] : [{ role: 'user', content: [{ type: 'text', text: `<compacted-summary>\n${previous}\n</compacted-summary>` }] }]),
    ...said.map((text) => ({ role: 'user', content: [{ type: 'text', text }] })),
    { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    { role: 'user', content: [{ type: 'text', text: 'You are now acting as a compaction engine for this AI coding assistant.' }] }
  ]
  let block
  const extra = {}
  if (n === 120) {
    // The decision changes: the model replaces the old fact by id.
    const old = store.search(store.sessionScope('long').workspace, 'long', 'port 53682', 1)[0]
    items.push({ kind: 'fact', text: 'Sign-in lets the OS pick the port', files: ['src/sign-in-config.ts'], replaces: [old.id] })
  }
  if (n === 150) {
    const pinned = store.live(store.sessionScope('long').workspace, 'long').find((item) => item.pinned)
    extra.remove = [pinned.id]
  }
  if (n % 37 === 0) block = `${DELTA_OPEN}\n{"items": [ {"kind": "fact", "text": "half\n${DELTA_CLOSE}`
  else if (n % 41 === 0) block = ''
  else block = `${DELTA_OPEN}\n${JSON.stringify({ items, ...extra })}\n${DELTA_CLOSE}`
  // Recursive summary: the previous checkpoint's last few points plus this round.
  const points = [...previous.split('\n').filter(Boolean).slice(-4), `- round ${String(n)}: ${said[0]}`]
  const answer = `${points.join('\n')}\n${block}`
  h.emit('session/event', h.session, { type: 'compaction/start', data: { compactionId: `cmp-${String(n)}` } })
  const options = { purpose: 'compaction', sessionId: 'long', messages }
  let summary = ''
  for await (const chunk of h.waterfall('llm/stream', options, () => (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    for (const piece of answer.match(/[\s\S]{1,40}/gu)) yield { type: 'text-delta', index: 0, text: piece }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })())) {
    if (chunk.type === 'block-end') summary = chunk.block.text
  }
  return summary
}

async function section() {
  const assembled = await h.waterfall('system-prompt/assemble', { contexts: [{ name: CONTEXT_NAME, text: '' }] }, { agent: { session: h.session } }, async (assembly) => assembly)
  return assembled.contexts[0].text
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ctx-graph-long-'))
  await writeFile(join(root, 'src-placeholder'), '')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(join(root, 'src')))
  await writeFile(join(root, 'src', 'sign-in-config.ts'), 'export const SIGN_IN_PORTS = [53682]\n')
  store = new GraphStore(join(root, '.graph', 'graph.sqlite'), { now: () => ++clock })
  h = host()
  let previous = ''
  for (let n = 1; n <= ROUNDS; n++) {
    previous = await compact(n, previous)
    summaries.push(previous)
    if (n === 2) {
      // The user pins the first rule in the Context panel.
      const rule = store.live(store.sessionScope('long').workspace, 'long').find((item) => item.kind === 'rule')
      store.setPinned(rule.id, rule.workspace, true)
    }
    if (n === 200) await writeFile(join(root, 'src', 'sign-in-config.ts'), 'export const SIGN_IN_ANY_PORT = true\n')
  }
}, 120_000)

afterAll(async () => {
  store.close()
  await rm(root, { recursive: true, force: true })
})

describe(`after ${String(ROUNDS)} compactions`, () => {
  it('the recursive summary alone has lost the early rules (the problem)', () => {
    const last = summaries.at(-1)
    expect(last).not.toContain(RULE_1)
    expect(last).not.toContain('53682')
    expect(last).not.toContain(DELTA_OPEN)
  })

  it('the graph still shows both rules word for word, the goal and the current decision', async () => {
    const text = await section()
    expect(text).toContain(`"${RULE_1}"`)
    expect(text).toContain(`"${RULE_2}"`)
    expect(text).not.toContain('Do not print the key')
    expect(text).toContain('Ship the desktop app with sign-in')
    expect(text).toContain('Sign-in lets the OS pick the port')
    expect(text).not.toMatch(/listens on port 53682/iu)
  })

  it('flags the file that changed after the fact about it was recorded', async () => {
    expect(await section()).toContain('src/sign-in-config.ts (changed since recorded: re-read before relying on this)')
  })

  it('kept the pinned rule the model tried to remove, and dropped finished tasks', async () => {
    const text = await section()
    expect(text).toMatch(/\(pinned\) "unoblox is all small letters/u)
    expect(text).toContain('Review step 300')
    expect(text).not.toContain('Review step 275')
  })

  it('did not pile up duplicates, and stays within its budget', async () => {
    const live = store.live(store.sessionScope('long').workspace, 'long')
    const texts = live.map((item) => item.text.toLowerCase())
    expect(new Set(texts).size).toBe(texts.length)
    // 2 rules, 1 goal, 2 port facts → 1, 30 build facts, 12 tasks.
    expect(live.length).toBeLessThan(50)
    const text = await section()
    expect(text.length).toBeLessThanOrEqual(6000)
    // Deterministic: an unchanged graph sends no new runtime-context snapshot.
    expect(await section()).toBe(text)
  })

  it('finds old facts and history through the lookup tool', async () => {
    const tool = h.tools.get(TOOL_NAME)
    const exec = { agent: { session: h.session } }
    expect((await tool.execute({ query: 'build step 30 caches' }, exec)).text).toContain('out/step-30')
    const current = store.search(store.sessionScope('long').workspace, 'long', 'OS pick', 1)[0]
    const history = (await tool.execute({ id: current.id }, exec)).text
    expect(history).toContain('Earlier versions:')
    expect(history).toMatch(/listens on port 53682/iu)
    expect((await tool.execute({ file: 'src/sign-in-config.ts' }, exec)).text).toContain('Sign-in lets the OS pick the port')
  })

  it('answers lookups quickly with thousands of items', async () => {
    const workspace = store.sessionScope('long').workspace
    store.transaction(() => {
      for (let n = 0; n < 5000; n++) store.put({ workspace, kind: 'fact', text: `Generated fact ${String(n)} about module m${String(n % 97)} and cache c${String(n % 13)}`, files: [{ path: `src/m${String(n % 97)}.ts` }], origin: 'model' })
    })
    const started = performance.now()
    for (let n = 0; n < 50; n++) store.search(workspace, 'long', `module m${String(n)} cache`, 12)
    for (let n = 0; n < 50; n++) store.aboutFile(workspace, 'long', `src/m${String(n)}.ts`, 12)
    const each = (performance.now() - started) / 100
    expect(each).toBeLessThan(20)
  })
})
