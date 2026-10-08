import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PiAiAdapter, type PiAiAdapterOptions, type PiAiResponseObservation } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { projectRoot } from './patch-path'
// @ts-expect-error Local host plugins are authored as ESM JavaScript.
import { apply as applyInfo, INFO_ROUTE } from '../packages/dsh-desktop-unoblox-info/index.js'
// @ts-expect-error Local host plugins are authored as ESM JavaScript.
import { createTurnStore, parseBilling, turnFromHeaders, utf8HeaderValue } from '../packages/dsh-desktop-unoblox-info/info.js'

afterEach(() => vi.unstubAllGlobals())

// Shapes recorded from the live gateway on 2026-10-07 (docs/unoblox-provider.md).
// Account values and ids are replaced.
const FREEMIUM_STREAMING = {
  balance_inr: 250.5, balance_requirement_inr: 1000.0, base_inr: 0.0, charged_estimated: true, charged_inr: 0.0, gst_inr: 0.0, gst_rate_bps: 0,
  note: 'Charged ₹0.00 at standard rates — this freemium model needs a ₹1000.00 balance held (never spent), and your balance ₹250.50 is below it. Add funds to restore free access, or turn on paid access for this key in Settings for unlimited access at standard rates.',
  stage: 'paid', tier: 'freemium'
}
const CHAT_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream',
  'x-generation-id': '00000000-0000-4000-8000-000000000001',
  'x-unoblox-cache': 'BYPASS',
  'x-unoblox-cache-reason': 'non_zero_temperature',
  // As fetch exposes it: the UTF-8 bytes read one per character.
  'x-unoblox-freemium': Buffer.from(JSON.stringify(FREEMIUM_STREAMING), 'utf8').toString('latin1'),
  'x-unoblox-selected-model': 'google/gemma-4-26b-a4b-it',
  'x-unoblox-selection-reason': 'unoblox/auto -> google/gemma-4-26b-a4b-it (best value: quality-per-price over capable models)',
  'x-unoblox-selector': 'unoblox/auto',
  'x-unoblox-served-model': 'google/gemma-4-26b-a4b-it'
}
const SSE = [
  { choices: [{ delta: { content: '', role: 'assistant' }, finish_reason: null, index: 0 }], id: 'c1', model: 'google/gemma-4-26b-a4b-it', object: 'chat.completion.chunk' },
  { choices: [{ delta: { content: 'pong' }, finish_reason: null, index: 0 }], id: 'c1', model: 'google/gemma-4-26b-a4b-it', object: 'chat.completion.chunk' },
  { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }], id: 'c1', model: 'google/gemma-4-26b-a4b-it', object: 'chat.completion.chunk' },
  { choices: [], id: 'c1', model: 'google/gemma-4-26b-a4b-it', object: 'chat.completion.chunk', usage: { completion_tokens: 2, prompt_tokens: 20, prompt_tokens_details: { cached_tokens: 19 }, total_tokens: 22 } }
].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'

describe('Unoblox response parsing', () => {
  it('reads billing and routing from a streamed chat response', () => {
    expect(turnFromHeaders(CHAT_HEADERS)).toEqual({
      billing: {
        balanceInr: 250.5, balanceRequirementInr: 1000, chargedInr: 0, baseInr: 0, gstInr: 0, chargedEstimated: true,
        tier: 'freemium', stage: 'paid', note: FREEMIUM_STREAMING.note
      },
      routing: {
        selector: 'unoblox/auto', selectedModel: 'google/gemma-4-26b-a4b-it', servedModel: 'google/gemma-4-26b-a4b-it',
        reason: CHAT_HEADERS['x-unoblox-selection-reason']
      }
    })
  })

  it('reads the non-streaming `unoblox` body block, which has no estimate flag', () => {
    const { charged_estimated: _estimated, ...block } = FREEMIUM_STREAMING
    expect(parseBilling(block)).not.toHaveProperty('chargedEstimated')
    expect(parseBilling({ ...block, balance_inr: 'lots' })).toBeUndefined()
  })

  it('keeps routing when the billing header is malformed, and ignores responses without Unoblox headers', () => {
    expect(turnFromHeaders({ ...CHAT_HEADERS, 'x-unoblox-freemium': '{not json' })).toEqual({ routing: expect.objectContaining({ servedModel: 'google/gemma-4-26b-a4b-it' }) })
    expect(turnFromHeaders({ 'content-type': 'text/event-stream', 'x-generation-id': 'g' })).toBeUndefined()
  })

  it('decodes the UTF-8 note fetch exposes as Latin-1, and leaves decoded text alone', () => {
    expect(CHAT_HEADERS['x-unoblox-freemium']).toContain('â\u0082¹')
    expect(turnFromHeaders(CHAT_HEADERS).billing.note).toContain('Charged ₹0.00 at standard rates — this freemium model')
    expect(utf8HeaderValue('₹ already')).toBe('₹ already')
    expect(utf8HeaderValue('caf\u00e9')).toBe('caf\u00e9')
  })

  it('bounds gateway text', () => {
    const turn = turnFromHeaders({ 'x-unoblox-selection-reason': 'x'.repeat(5000) })
    expect(turn.routing.reason).toHaveLength(500)
  })
})

describe('turn store', () => {
  it('keeps the latest turn per session and the latest balance across sessions', () => {
    let clock = 1
    const store = createTurnStore({ maxSessions: 2, now: () => clock++ })
    const turn = turnFromHeaders(CHAT_HEADERS)
    store.record('a', turn)
    store.record('b', { routing: { servedModel: 'm' } })
    expect(store.latestBilling()).toMatchObject({ balanceInr: 250.5, at: 1 })
    store.record('c', turnFromHeaders({ ...CHAT_HEADERS, 'x-unoblox-freemium': JSON.stringify({ ...FREEMIUM_STREAMING, balance_inr: 249, note: 'already decoded ₹' }) }))
    expect(store.session('a')).toBeUndefined()
    expect(store.session('b')).toMatchObject({ routing: { servedModel: 'm' } })
    expect(store.latestBilling()).toMatchObject({ balanceInr: 249, at: 3 })
    store.record(undefined, turn)
    expect(store.latestBilling()).toMatchObject({ balanceInr: 250.5 })
  })
})

function host(credential: { value?: string, throws?: boolean } | undefined) {
  const listeners = new Map<string, (payload: unknown) => void>()
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  const warnings: unknown[] = []
  const ctx = {
    on: (name: string, listener: (payload: unknown) => void) => listeners.set(name, listener),
    get: (name: string) => name !== 'credentials' || credential === undefined ? undefined : {
      resolve: async (ref: string) => {
        expect(String(ref)).toBe('UNOBLOX_API_KEY')
        if (credential.throws) throw new Error('store locked')
        return credential.value === undefined ? undefined : { value: credential.value }
      }
    },
    logger: { warn: (...args: unknown[]) => warnings.push(args) },
    connection: { fetch: { register: (route: { path: string, methods: string[], fetch: (request: Request) => Promise<Response> }) => {
      expect(route.methods).toEqual(['GET'])
      routes.set(route.path, route.fetch)
    } } }
  }
  applyInfo(ctx, {}, { now: () => 5 })
  const emit = (payload: unknown) => listeners.get('llm-pi-ai/response')!(payload)
  const read = async (session?: string) => {
    const response = await routes.get(INFO_ROUTE)!(new Request(`http://127.0.0.1${INFO_ROUTE}${session === undefined ? '' : `?session=${session}`}`))
    expect(response.headers.get('cache-control')).toBe('no-store')
    return response.json()
  }
  return { emit, read, warnings }
}

describe('info route', () => {
  it('serves the latest balance and this session\'s routed model, never the key', async () => {
    const { emit, read } = host({ value: 'ub-gw-secret-test-value' })
    emit({ provider: 'unoblox', model: 'unoblox/auto', sessionId: 's1', status: 200, headers: CHAT_HEADERS })
    emit({ provider: 'openai', model: 'x', sessionId: 's1', status: 200, headers: { 'x-unoblox-served-model': 'spoofed' } })
    const body = await read('s1')
    expect(JSON.stringify(body)).not.toContain('ub-gw-secret-test-value')
    expect(body).toEqual({
      key: 'set',
      billing: { ...turnFromHeaders(CHAT_HEADERS).billing, at: 5 },
      turn: { ...turnFromHeaders(CHAT_HEADERS), at: 5 }
    })
    // Another conversation sees the account balance but not this routing.
    expect(await read('s2')).toMatchObject({ billing: { balanceInr: 250.5 }, turn: null })
  })

  it('reports a missing or unreadable key and an empty state before any reply', async () => {
    expect(await host({}).read('s1')).toMatchObject({ key: 'missing', billing: null, turn: null })
    expect(await host(undefined).read()).toMatchObject({ key: 'unknown' })
    const locked = host({ throws: true })
    expect(await locked.read()).toMatchObject({ key: 'unknown' })
    expect(locked.warnings).toHaveLength(1)
  })

  it('ignores malformed events', async () => {
    const { emit, read } = host({ value: 'k' })
    emit(null)
    emit({ provider: 'unoblox', headers: 'nope' })
    expect(await read()).toMatchObject({ billing: null })
  })
})

describe('llm-pi-ai response seam (patch)', () => {
  function adapter(onResponse?: (observation: PiAiResponseObservation) => void) {
    vi.stubGlobal('fetch', async () => new Response(SSE, { status: 200, headers: { ...CHAT_HEADERS, 'set-cookie': 'session=secret' } }))
    const profiles: ReturnType<PiAiAdapterOptions['profiles']> = new Map([
      ['opencode-go', {
        provider: 'opencode-go', displayName: 'OpenCode Go', headers: {},
        piProvider: opencodeGoProvider(), streamIdleTimeoutMs: 5000,
        configuredMaxTokens: new Map(), maxRequestImageBytes: 1024,
        requestImagePixelBudget: 1024, requestImageMaxBytes: 1024,
        retryPolicy: resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'test'),
        modelErrors: new Map()
      }]
    ])
    return new PiAiAdapter({
      profiles: () => profiles,
      resolveApiKey: async () => 'test-key',
      auth: {} as PiAiAdapterOptions['auth'],
      ...(onResponse === undefined ? {} : { onResponse })
    })
  }
  async function run(target: PiAiAdapter, sessionId?: string) {
    const chunks: unknown[] = []
    for await (const chunk of target.stream({
      provider: 'opencode-go', model: 'deepseek-v4-flash', ...(sessionId === undefined ? {} : { sessionId }),
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }], maxTokens: 8
    } as Parameters<PiAiAdapter['stream']>[0])) chunks.push(chunk)
    return chunks
  }

  it('reports status and headers of each response without cookies, and the stream is unchanged', async () => {
    const seen: PiAiResponseObservation[] = []
    const chunks = await run(adapter((observation) => seen.push(observation)), 'session-7')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ provider: 'opencode-go', model: 'deepseek-v4-flash', sessionId: 'session-7', status: 200 })
    expect(seen[0]!.headers).not.toHaveProperty('set-cookie')
    expect(Object.isFrozen(seen[0]!.headers)).toBe(true)
    expect(turnFromHeaders(seen[0]!.headers)).toEqual(turnFromHeaders(CHAT_HEADERS))
    expect(JSON.stringify(chunks)).toContain('pong')
    expect(JSON.stringify(await run(adapter()))).toEqual(JSON.stringify(chunks))
  })

  it('publishes through apply as llm-pi-ai/response and contains observer failures', () => {
    const source = readFileSync(path.join(projectRoot, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), 'utf8')
    expect(source).toMatch(/ctx\.emit\("llm-pi-ai\/response", response\);\n\t\t\t\} catch \(error\) \{\n\t\t\t\tctx\.logger\.warn/u)
  })
})

describe('info strip client', () => {
  type Element = { type: unknown, props: Record<string, unknown> & { children?: unknown } }
  function load() {
    const React = {
      createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: { ...props, children } }),
      Fragment: 'fragment',
      useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
      useCallback: (fn: unknown) => fn, useEffect: () => {}, useRef: (value: unknown) => ({ current: value }), useId: () => 'details-id'
    }
    const primitives = { IconSparkleRegular: () => null, IconWarningOutlineRegular: () => null }
    let exported: Record<string, any> = {}
    const source = readFileSync(path.join(projectRoot, 'packages/dsh-desktop-unoblox-info/client.js'), 'utf8')
    vm.runInNewContext(source, {
      window: { __ModuleLoader__: { load: ({ factory }: { factory: (require: (id: string) => unknown) => Record<string, unknown> }) => { exported = factory((id) => id === 'react' ? React : primitives) } } },
      Intl, Date
    })
    return exported
  }
  const client = load()
  const t = (key: string, params?: Record<string, string>) =>
    (client.locales.en[key] as string).replace(/\{(\w+)\}/gu, (match, name: string) => params?.[name] ?? match)
  // Render the element tree to text, expanding function components.
  function text(node: unknown): string {
    if (node === null || node === undefined || node === false) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(text).join('')
    const element = node as Element
    if (typeof element.type === 'function') return text((element.type as (props: unknown) => unknown)(element.props))
    return text(element.props.children)
  }
  const view = (body: unknown) => client.toView(body)
  const routeBody = {
    key: 'set',
    billing: { ...turnFromHeaders(CHAT_HEADERS).billing, at: 5 },
    turn: { ...turnFromHeaders(CHAT_HEADERS), at: 5 }
  }
  // Pills by their visible text and their accessible description.
  function pills(node: unknown): { text: string, description: unknown }[] {
    const found: { text: string, description: unknown }[] = []
    const walk = (current: unknown): void => {
      if (current === null || current === undefined || typeof current !== 'object') return
      if (Array.isArray(current)) return current.forEach(walk)
      const element = current as Element
      if (typeof element.type === 'function') return walk((element.type as (props: unknown) => unknown)(element.props))
      if (typeof element.props.className === 'string' && element.props.className.startsWith('dshUbxInfoPill')) {
        found.push({ text: text(element.props.children), description: element.props['aria-label'] })
      }
      walk(element.props.children)
    }
    walk(node)
    return found
  }

  it('only uses primitives the installed Harness exports', () => {
    const source = readFileSync(path.join(projectRoot, 'packages/dsh-desktop-unoblox-info/client.js'), 'utf8')
    const match = /const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u.exec(source)
    const bundle = readFileSync(path.join(projectRoot, 'node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js'), 'utf8')
    const exported = new Set([...bundle.matchAll(/export \{([^}]*)\}/gu)].flatMap((block) => block[1]!.split(',').map((part) => part.trim().split(/\s+as\s+/u).pop()!)))
    for (const name of match![1]!.split(',').map((part) => part.trim())) expect(exported.has(name), name).toBe(true)
  })

  it('keeps zh and en keys in step', () => {
    expect(Object.keys(client.locales.zh).sort()).toEqual(Object.keys(client.locales.en).sort())
  })

  it('formats rupees only and shortens model slugs', () => {
    expect(client.formatInr(123456.5)).toBe('₹1,23,456.50')
    expect(client.shortModel('google/gemma-4-26b-a4b-it')).toBe('gemma-4-26b-a4b-it')
    expect(client.shortModel('solo')).toBe('solo')
  })

  it('shows only balance and model, as icon pills in one row', () => {
    const row = client.UnobloxInfoStrip({ view: view(routeBody), t })
    expect(row.props.className).toBe('dshUbxInfo')
    expect(pills(row).map((pill) => pill.text)).toEqual(['₹250.50', 'gemma-4-26b-a4b-it'])
    const [balance, model] = pills(row)
    expect(balance!.description).toContain('Unoblox balance ₹250.50. Charged ₹0.00 at standard rates')
    expect(model!.description).toBe('Model google/gemma-4-26b-a4b-it. unoblox/auto -> google/gemma-4-26b-a4b-it (best value: quality-per-price over capable models)')
    expect(text(row)).not.toMatch(/\$|Search|Last reply|Details/u)
  })

  it('renders nothing before Unoblox has reported anything, and flags a missing key', () => {
    expect(client.UnobloxInfoStrip({ view: undefined, t })).toBeNull()
    expect(client.UnobloxInfoStrip({ view: view({ key: 'set', billing: null, turn: null }), t })).toBeNull()
    const missing = client.UnobloxInfoStrip({ view: view({ key: 'missing', billing: null, turn: null }), t })
    expect(pills(missing)).toEqual([{ text: 'No API key', description: 'Add your Unoblox API key in Settings → Models.' }])
    // Balance known from another conversation, no reply here yet: balance only.
    expect(pills(client.UnobloxInfoStrip({ view: view({ ...routeBody, turn: null }), t })).map((pill) => pill.text)).toEqual(['₹250.50'])
  })

  it('requests the route same-origin without caching and rejects unexpected shapes', async () => {
    const calls: [string, RequestInit][] = []
    const service = client.createInfoService(async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return Response.json(calls.length === 1 ? routeBody : { nope: true })
    })
    const signal = new AbortController().signal
    expect(await service.load('s 1', signal)).toMatchObject({ key: 'set', balanceInr: 250.5, model: 'google/gemma-4-26b-a4b-it' })
    expect(calls[0]).toEqual([`${INFO_ROUTE}?session=s%201`, { credentials: 'same-origin', cache: 'no-store', signal }])
    await expect(service.load(undefined, signal)).rejects.toThrow('unexpected response shape')
    expect(calls[1]![0]).toBe(INFO_ROUTE)
  })
})
