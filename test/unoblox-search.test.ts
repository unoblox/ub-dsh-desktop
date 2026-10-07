import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { patchPath, projectRoot } from './patch-path'
// @ts-expect-error Local host plugins are authored as ESM JavaScript.
import { UnobloxSearchProvider, mapUnobloxResponse, resultCount } from '../packages/dsh-desktop-unoblox-search/provider.js'
// @ts-expect-error Local host plugins are authored as ESM JavaScript.
import { apply, inject } from '../packages/dsh-desktop-unoblox-search/index.js'

interface Recorded { url: string; init: RequestInit & { headers: Record<string, string> } }

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function createProvider(responses: Array<Response | Error>, apiKey: string | undefined = 'ub-gw-user_1-secret') {
  const calls: Recorded[] = []
  const fetch = vi.fn(async (url: string, init: Recorded['init']) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (next === undefined) throw new Error('unexpected extra request')
    if (next instanceof Error) throw next
    return next
  })
  const sleep = vi.fn(async (_ms: number) => undefined)
  const provider = new UnobloxSearchProvider({
    baseURL: 'https://api.unoblox.ai/v1',
    resolveApiKey: async () => apiKey,
    fetch,
    sleep,
    idempotencyKey: () => 'search-1'
  })
  return { provider, calls, sleep }
}

const DOCS_RESULT = {
  id: 'https://docs.rs/tokio/latest/tokio/macro.select.html',
  url: 'https://docs.rs/tokio/latest/tokio/macro.select.html',
  title: 'select in tokio - Rust',
  highlights: ['Waits on multiple concurrent branches, returning when the first branch completes'],
  snippet: 'Waits on multiple concurrent branches, returning when the first branch completes',
  publishedDate: '2026-01-31'
}

describe('Unoblox search provider', () => {
  it('sends the query with the stored key, an idempotency key, and a clamped result count', async () => {
    const { provider, calls } = createProvider([json(200, { requestId: 'srch_1', results: [DOCS_RESULT] })])
    const result = await provider.search({ query: 'tokio select macro', maxResults: 50 })

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe('https://api.unoblox.ai/v1/search')
    expect(call?.init.method).toBe('POST')
    expect(call?.init.headers.authorization).toBe('Bearer ub-gw-user_1-secret')
    expect(call?.init.headers['idempotency-key']).toBe('search-1')
    expect(JSON.parse(String(call?.init.body))).toEqual({ query: 'tokio select macro', numResults: 20 })
    expect(result).toEqual({
      sources: [{
        url: DOCS_RESULT.url,
        title: DOCS_RESULT.title,
        snippet: DOCS_RESULT.snippet,
        publishedAt: '2026-01-31'
      }],
      truncated: false
    })
  })

  it('clamps the result count into the 1-20 range and defaults to 8', () => {
    expect(resultCount(undefined)).toBe(8)
    expect(resultCount(0)).toBe(1)
    expect(resultCount(5)).toBe(5)
    expect(resultCount(21)).toBe(20)
  })

  it('falls back to the first highlight and drops non-web URLs', () => {
    expect(mapUnobloxResponse({
      results: [
        { url: 'https://example.com/a', highlights: ['  ', 'second highlight'] },
        { url: 'javascript:alert(1)', snippet: 'x' },
        { url: 'ftp://example.com/file', snippet: 'x' },
        'not an object'
      ]
    })).toEqual({ sources: [{ url: 'https://example.com/a', snippet: 'second highlight' }], truncated: false })
  })

  it('refuses a response without a results list', () => {
    expect(() => mapUnobloxResponse({ requestId: 'x' })).toThrow('without a results list')
  })

  it('asks for a key before sending anything when none is stored', async () => {
    const { provider, calls } = createProvider([], '')
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    expect(calls).toHaveLength(0)
  })

  it('shows Unoblox error text verbatim with its code and does not retry billing or policy refusals', async () => {
    for (const [status, code, error] of [
      [402, 'UB-GW-306', 'Your balance cannot cover one search. Top up on the Credits page.'],
      [400, 'UB-GW-311', 'Your workspace guardrail forbids sending queries outside India.'],
      [429, 'UB-GW-304', 'Daily search cap reached; resets at 00:00 UTC.'],
      [503, 'UB-GW-301', 'Search is switched off by unoblox.']
    ] as const) {
      const { provider, calls } = createProvider([json(status, { error, error_code: code }, { 'retry-after': '3600' })])
      await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
        code: 'WEB_PROVIDER_ERROR',
        message: `${error} (${code})`
      })
      expect(calls).toHaveLength(1)
    }
  })

  it('explains a rejected key when the 401 has no body', async () => {
    const { provider } = createProvider([new Response('', { status: 401 })])
    await expect(provider.search({ query: 'q' })).rejects.toThrow('Unoblox rejected the API key')
  })

  it('retries a per-key rate limit once after Retry-After, reusing the idempotency key', async () => {
    const { provider, calls, sleep } = createProvider([
      json(429, { error: 'Per-key limit of 5/s reached.', error_code: 'UB-GW-303' }, { 'retry-after': '1' }),
      json(200, { results: [DOCS_RESULT] })
    ])
    const result = await provider.search({ query: 'q' })
    expect(result.sources).toHaveLength(1)
    expect(sleep).toHaveBeenCalledWith(1000, undefined)
    expect(calls.map((call) => call.init.headers['idempotency-key'])).toEqual(['search-1', 'search-1'])
  })

  it('does not wait out a long Retry-After', async () => {
    const { provider, calls, sleep } = createProvider([
      json(429, { error: 'Per-key limit of 5/s reached.', error_code: 'UB-GW-303' }, { 'retry-after': '30' })
    ])
    await expect(provider.search({ query: 'q' })).rejects.toThrow('Per-key limit of 5/s reached. (UB-GW-303)')
    expect(sleep).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
  })

  it('retries an unbilled backend failure once, then reports it', async () => {
    const failure = { error: 'Search backend failed; retry shortly.', error_code: 'UB-GW-305' }
    const { provider, calls } = createProvider([json(502, failure), json(502, failure)])
    await expect(provider.search({ query: 'q' })).rejects.toThrow('Search backend failed; retry shortly. (UB-GW-305)')
    expect(calls).toHaveLength(2)
  })

  it('reports cancellation as WEB_ABORTED', async () => {
    const { provider } = createProvider([new DOMException('aborted', 'AbortError')])
    await expect(provider.search({ query: 'q' }, new AbortController().signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('reports transport failures as WEB_PROVIDER_ERROR', async () => {
    const { provider } = createProvider([new TypeError('fetch failed')])
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })
})

describe('Unoblox search plugin', () => {
  it('registers with the web seam and reads the key from the credential store on every search', async () => {
    let stored: string | undefined
    const resolve = vi.fn(async (ref: string) => (stored === undefined ? undefined : { value: stored, source: 'file', ref }))
    let registered: { id: string; available: () => boolean; search: (request: { query: string }) => Promise<unknown> } | undefined
    const dispose = vi.fn()
    const ctx = {
      get: (name: string) => (name === 'credentials' ? { resolve } : undefined),
      effect: (fn: () => () => void) => fn(),
      web: {
        registerSearchProvider: (provider: NonNullable<typeof registered>) => {
          registered = provider
          return dispose
        }
      }
    }
    apply(ctx, { baseURL: 'https://api.unoblox.ai/v1', apiKeyEnv: 'UNOBLOX_API_KEY' })

    expect(inject).toEqual(['web'])
    expect(registered?.id).toBe('unoblox')
    expect(registered?.available()).toBe(true)
    // No key yet: the first search fails before any request.
    await expect(registered?.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    // A key stored later is picked up without re-registering.
    stored = 'ub-gw-later'
    const originalFetch = globalThis.fetch
    const fetchSpy = vi.fn(async () => json(200, { results: [] }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    try {
      await expect(registered?.search({ query: 'q' })).resolves.toEqual({ sources: [], truncated: false })
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(String(resolve.mock.calls[0]?.[0])).toBe('UNOBLOX_API_KEY')
  })
})

describe('Unoblox search packaging', () => {
  it('is declared, locked, and reachable from the Harness dependency closure', async () => {
    const [manifest, lock, dshPatch] = await Promise.all([
      readFile(path.join(projectRoot, 'package.json'), 'utf8'),
      readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'),
      readFile(patchPath('@deepseek-ai/dsh'), 'utf8')
    ])
    const dependencies = (JSON.parse(manifest) as { dependencies: Record<string, string> }).dependencies
    expect(dependencies['dsh-desktop-unoblox-search']).toBe('file:packages/dsh-desktop-unoblox-search')
    const packages = (JSON.parse(lock) as { packages: Record<string, { resolved?: string; link?: boolean }> }).packages
    expect(packages['node_modules/dsh-desktop-unoblox-search']).toEqual({ resolved: 'packages/dsh-desktop-unoblox-search', link: true })
    expect(packages['packages/dsh-desktop-unoblox-search']).toBeDefined()
    expect(dshPatch).toContain('+    "dsh-desktop-unoblox-search": "0.1.0"')
  })
})
