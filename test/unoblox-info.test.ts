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
import { createPricingSource, createTurnStore, parseBilling, parseSearchPricing, turnFromHeaders, utf8HeaderValue } from '../packages/dsh-desktop-unoblox-info/info.js'

afterEach(() => vi.unstubAllGlobals())

// Shapes recorded from the live gateway on 2026-10-07 (docs/unoblox-provider.md).
// The public search price is verbatim; account values and ids are replaced.
const SEARCH_PRICING = { price_inr_paise_per_1000_searches: 10162, price_inr_micro_paise_per_search: 10161795, max_inr_paise_per_search: 11 }
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
  it('reads the public search price in paise', () => {
    expect(parseSearchPricing(SEARCH_PRICING)).toEqual({ paisePer1000: 10162, microPaisePerSearch: 10161795, maxPaisePerSearch: 11 })
    expect(parseSearchPricing({ price_inr_paise_per_1000_searches: '10162' })).toBeUndefined()
    expect(parseSearchPricing({ price_inr_paise_per_1000_searches: 1.5 })).toBeUndefined()
    expect(parseSearchPricing(null)).toBeUndefined()
  })

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

describe('search pricing source', () => {
  it('caches a success, shares concurrent reads, and refreshes after the TTL', async () => {
    let clock = 0
    const fetch = vi.fn(async () => Response.json(SEARCH_PRICING))
    const source = createPricingSource({ fetch, ttlMs: 1000, now: () => clock })
    const [first, second] = await Promise.all([source.read(), source.read()])
    expect(first).toEqual({ pricing: parseSearchPricing(SEARCH_PRICING), fetchedAt: 0 })
    expect(second).toBe(first)
    clock = 999
    await source.read()
    expect(fetch).toHaveBeenCalledTimes(1)
    clock = 1000
    await source.read()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('reports failures without a stale price and retries on the next read', async () => {
    const replies = [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve(new Response('busy', { status: 503 })),
      () => Promise.resolve(new Response('<html>', { status: 200 })),
      () => Promise.resolve(Response.json({ price: 1 })),
      () => Promise.resolve(Response.json(SEARCH_PRICING))
    ]
    const source = createPricingSource({ fetch: () => replies.shift()!() })
    expect(await source.read()).toEqual({ error: 'search pricing request failed: offline' })
    expect(await source.read()).toEqual({ error: 'search pricing returned HTTP 503' })
    expect((await source.read()).error).toMatch(/^search pricing body is not JSON/u)
    expect(await source.read()).toEqual({ error: 'search pricing body has no price_inr_paise_per_1000_searches' })
    expect(await source.read()).toMatchObject({ pricing: { paisePer1000: 10162 } })
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
  const fetch = vi.fn(async () => Response.json(SEARCH_PRICING))
  applyInfo(ctx, {}, { fetch, now: () => 5 })
  const emit = (payload: unknown) => listeners.get('llm-pi-ai/response')!(payload)
  const read = async (session?: string) => {
    const response = await routes.get(INFO_ROUTE)!(new Request(`http://127.0.0.1${INFO_ROUTE}${session === undefined ? '' : `?session=${session}`}`))
    expect(response.headers.get('cache-control')).toBe('no-store')
    return response.json()
  }
  return { emit, read, warnings, fetch }
}

describe('info route', () => {
  it('serves the search price, the latest balance and this session\'s routed model, never the key', async () => {
    const { emit, read } = host({ value: 'ub-gw-secret-test-value' })
    emit({ provider: 'unoblox', model: 'unoblox/auto', sessionId: 's1', status: 200, headers: CHAT_HEADERS })
    emit({ provider: 'openai', model: 'x', sessionId: 's1', status: 200, headers: { 'x-unoblox-served-model': 'spoofed' } })
    const body = await read('s1')
    expect(JSON.stringify(body)).not.toContain('ub-gw-secret-test-value')
    expect(body).toEqual({
      key: 'set',
      searchPricing: { paisePer1000: 10162, microPaisePerSearch: 10161795, maxPaisePerSearch: 11, fetchedAt: 5 },
      searchPricingError: null,
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
    let exported: Record<string, any> = {}
    const source = readFileSync(path.join(projectRoot, 'packages/dsh-desktop-unoblox-info/client.js'), 'utf8')
    vm.runInNewContext(source, {
      window: { __ModuleLoader__: { load: ({ factory }: { factory: (require: (id: string) => unknown) => Record<string, unknown> }) => { exported = factory((id) => id === 'react' ? React : {}) } } },
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
    searchPricing: { paisePer1000: 10162, maxPaisePerSearch: 11, fetchedAt: 5 },
    searchPricingError: null,
    billing: { ...turnFromHeaders(CHAT_HEADERS).billing, at: 5 },
    turn: { ...turnFromHeaders(CHAT_HEADERS), at: 5 }
  }

  it('keeps zh and en keys in step', () => {
    expect(Object.keys(client.locales.zh).sort()).toEqual(Object.keys(client.locales.en).sort())
  })

  it('formats rupees only', () => {
    expect(client.formatPaise(10162)).toBe('₹101.62')
    expect(client.formatPaise(11)).toBe('₹0.11')
    expect(client.formatInr(123456.5)).toBe('₹1,23,456.50')
  })

  it('shows price, balance, estimated charge and routed model from the route', () => {
    const rendered = text(client.UnobloxInfoStrip({ state: { phase: 'ready', view: view(routeBody) }, t, onRetry: () => {} }))
    expect(rendered).toContain('Search ₹101.62 / 1,000')
    expect(rendered).toContain('Balance ₹250.50')
    expect(rendered).toContain('Last reply ₹0.00 (estimated)')
    expect(rendered).toContain('Model google/gemma-4-26b-a4b-it')
    expect(rendered).not.toContain('$')
  })

  it('covers missing key, pending balance, pricing failure, loading and error', () => {
    const missing = text(client.UnobloxInfoStrip({ state: { phase: 'ready', view: view({ ...routeBody, key: 'missing', billing: null, turn: null }) }, t }))
    expect(missing).toContain('No Unoblox API key')
    expect(missing).not.toContain('Balance')
    const pending = text(client.UnobloxInfoStrip({ state: { phase: 'ready', view: view({ ...routeBody, billing: null, turn: null, searchPricing: null, searchPricingError: 'search pricing returned HTTP 503' }) }, t }))
    expect(pending).toContain('Balance shows after the first reply')
    expect(pending).toContain('Search price unavailable')
    expect(text(client.UnobloxInfoStrip({ state: { phase: 'loading' }, t }))).toBe('Loading Unoblox info…')
    expect(text(client.UnobloxInfoStrip({ state: { phase: 'error', error: 'HTTP 500' }, t }))).toBe('Unoblox info unavailableRetry')
    const stale = text(client.UnobloxInfoStrip({ state: { phase: 'error', view: view(routeBody), error: 'HTTP 500' }, t }))
    expect(stale).toContain('Balance ₹250.50')
    expect(stale).toContain('Unoblox info unavailable')
  })

  it('requests the route same-origin without caching and rejects unexpected shapes', async () => {
    const calls: [string, RequestInit][] = []
    const service = client.createInfoService(async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return Response.json(calls.length === 1 ? routeBody : { nope: true })
    })
    const signal = new AbortController().signal
    expect(await service.load('s 1', signal)).toMatchObject({ key: 'set', pricing: { paisePer1000: 10162 } })
    expect(calls[0]).toEqual([`${INFO_ROUTE}?session=s%201`, { credentials: 'same-origin', cache: 'no-store', signal }])
    await expect(service.load(undefined, signal)).rejects.toThrow('unexpected response shape')
    expect(calls[1]![0]).toBe(INFO_ROUTE)
  })
})
