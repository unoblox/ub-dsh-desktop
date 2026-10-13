import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeRequestUrl, createPkce, listenForCallback, signInWithUnoblox, SignInError, type SignInConfig } from '../src/main/unoblox/sign-in'
import { SIGN_IN_AUTHORIZE_URL, SIGN_IN_PORTS, SIGN_IN_TOKEN_URL, signInConfig } from '../src/main/unoblox/sign-in-config'
import { callHarnessRemote } from '../src/main/unoblox/harness-credentials'
import { UnobloxSignIn } from '../src/main/unoblox/sign-in-service'

const CLIENT = 'ubc_6b9e6e71d4025a50c64a26490151706f'
const KEY = 'ub-gw-testKey_0123456789abcdef'
const base64url = (bytes: Buffer) => bytes.toString('base64').replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function freePorts(count: number): Promise<number[]> {
  const ports: number[] = []
  for (let i = 0; i < count; i++) {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    ports.push((server.address() as AddressInfo).port)
    await new Promise((resolve) => server.close(resolve))
  }
  return ports
}

async function occupy(port: number): Promise<void> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  servers.push(server)
}

/**
 * A stand-in for the identity service: the authorize step is the "browser",
 * which redirects to the app with a code; the token endpoint checks PKCE and
 * the redirect URI as the real one does (exact match, single use).
 */
function fakeIdentity(options: { tokenStatus?: number; tokenBody?: unknown; redirect?: (url: URL, params: URLSearchParams) => string } = {}) {
  const issued = new Map<string, { challenge: string; redirectUri: string; used: boolean }>()
  const seen: { authorize?: URL; token?: URLSearchParams } = {}
  const browser = async (authorizeUrl: string) => {
    const url = new URL(authorizeUrl)
    seen.authorize = url
    const code = `code-${String(issued.size + 1)}`
    issued.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', redirectUri: url.searchParams.get('redirect_uri') ?? '', used: false })
    const back = new URL(url.searchParams.get('redirect_uri') ?? '')
    back.searchParams.set('code', code)
    back.searchParams.set('state', url.searchParams.get('state') ?? '')
    const target = options.redirect ? options.redirect(back, url.searchParams) : back.toString()
    // The browser follows the redirect; the app's page answers it.
    void fetch(target).then((response) => response.text()).catch(() => {})
  }
  const token = async (_url: string, init: RequestInit) => {
    const params = new URLSearchParams(String(init.body))
    seen.token = params
    if (options.tokenStatus !== undefined) return new Response(JSON.stringify(options.tokenBody ?? {}), { status: options.tokenStatus })
    const entry = issued.get(params.get('code') ?? '')
    const challenge = base64url(createHash('sha256').update(params.get('code_verifier') ?? '').digest())
    if (!entry || entry.used || entry.challenge !== challenge || entry.redirectUri !== params.get('redirect_uri') || params.get('client_id') !== CLIENT) {
      return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'bad code (UB-IDN-172)' }), { status: 400 })
    }
    entry.used = true
    return new Response(JSON.stringify(options.tokenBody ?? { access_token: KEY, key: KEY, scope: 'inference', token_type: 'Bearer', unoblox_user_id: 'user_1' }), { status: 200 })
  }
  return { browser, token, seen }
}

async function config(count = 3): Promise<SignInConfig> {
  return { authorizeUrl: 'https://unoblox.ai/oauth/authorize', tokenUrl: 'https://unoblox.ai/api/identity/oauth/token', clientId: CLIENT, ports: await freePorts(count), scope: 'inference' }
}

describe('Sign in with unoblox', () => {
  it('signs in with PKCE on a loopback redirect and returns the key', async () => {
    const identity = fakeIdentity()
    const settings = await config()
    const key = await signInWithUnoblox({ config: settings, openBrowser: identity.browser, fetch: identity.token, signal: new AbortController().signal })
    expect(key).toBe(KEY)
    const sent = identity.seen.authorize
    expect(sent?.origin + (sent?.pathname ?? '')).toBe('https://unoblox.ai/oauth/authorize')
    expect(sent?.searchParams.get('response_type')).toBe('code')
    expect(sent?.searchParams.get('client_id')).toBe(CLIENT)
    expect(sent?.searchParams.get('code_challenge_method')).toBe('S256')
    expect(sent?.searchParams.get('scope')).toBe('inference')
    expect(sent?.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${String(settings.ports[0])}/callback`)
    expect(sent?.searchParams.get('state')?.length).toBeGreaterThanOrEqual(32)
    // No secret: a public client proves itself with the verifier alone.
    expect(identity.seen.token?.has('client_secret')).toBe(false)
    expect(identity.seen.token?.get('grant_type')).toBe('authorization_code')
  })

  it('uses the next registered port when one is taken, and says so when all are', async () => {
    const identity = fakeIdentity()
    const settings = await config(2)
    await occupy(settings.ports[0] as number)
    await signInWithUnoblox({ config: settings, openBrowser: identity.browser, fetch: identity.token, signal: new AbortController().signal })
    expect(identity.seen.authorize?.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${String(settings.ports[1])}/callback`)
    await occupy(settings.ports[1] as number)
    await expect(signInWithUnoblox({ config: settings, openBrowser: identity.browser, fetch: identity.token, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'ports-busy' })
  })

  it('ignores a redirect with another state and finishes with the real one', async () => {
    const settings = await config()
    const listener = await listenForCallback(settings.ports, 'the-state', new AbortController().signal)
    const forged = await fetch(`${listener.redirectUri}?code=evil&state=other`)
    expect(forged.status).toBe(400)
    const other = await fetch(listener.redirectUri.replace('/callback', '/elsewhere'))
    expect(other.status).toBe(404)
    const page = await fetch(`${listener.redirectUri}?code=good&state=the-state`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(page.headers.get('cache-control')).toBe('no-store')
    await expect(listener.code).resolves.toBe('good')
  })

  it('reports a declined sign-in', async () => {
    const identity = fakeIdentity({ redirect: (back) => { back.searchParams.delete('code'); back.searchParams.set('error', 'access_denied'); return back.toString() } })
    await expect(signInWithUnoblox({ config: await config(), openBrowser: identity.browser, fetch: identity.token, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'denied' })
  })

  it('stops waiting when the user cancels, and frees the port', async () => {
    const settings = await config(1)
    const controller = new AbortController()
    const pending = signInWithUnoblox({ config: settings, openBrowser: async () => { setTimeout(() => controller.abort(), 20) }, fetch: fakeIdentity().token, signal: controller.signal })
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    await occupy(settings.ports[0] as number)
  })

  it('times out when the browser never comes back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const settings = await config(1)
      const listener = await listenForCallback(settings.ports, 's', new AbortController().signal)
      vi.advanceTimersByTime(5 * 60_000 + 1)
      await expect(listener.code).rejects.toMatchObject({ code: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('explains a refused exchange and rejects a response without a key', async () => {
    const refused = fakeIdentity({ tokenStatus: 400, tokenBody: { error: 'invalid_grant', error_description: 'code expired (UB-IDN-172)' } })
    await expect(signInWithUnoblox({ config: await config(), openBrowser: refused.browser, fetch: refused.token, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'exchange-failed', message: expect.stringContaining('code expired') })
    const keyless = fakeIdentity({ tokenBody: { access_token: 'not-a-key', token_type: 'Bearer' } })
    await expect(signInWithUnoblox({ config: await config(), openBrowser: keyless.browser, fetch: keyless.token, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('reports an unreachable token endpoint', async () => {
    const identity = fakeIdentity()
    const offline = async () => { throw new TypeError('fetch failed') }
    await expect(signInWithUnoblox({ config: await config(), openBrowser: identity.browser, fetch: offline, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'network' })
  })

  it('makes a fresh S256 challenge each time', () => {
    const a = createPkce(), b = createPkce()
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.challenge).toBe(base64url(createHash('sha256').update(a.verifier).digest()))
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    const url = new URL(authorizeRequestUrl({ authorizeUrl: SIGN_IN_AUTHORIZE_URL, tokenUrl: SIGN_IN_TOKEN_URL, clientId: CLIENT, ports: [1] }, 'http://127.0.0.1:1/callback', a.challenge, 'st'))
    expect(url.searchParams.get('code_challenge')).toBe(a.challenge)
    expect(url.searchParams.has('scope')).toBe(false)
  })
})

describe('sign-in settings', () => {
  it('is off without a valid client id, so the build falls back to pasting a key', () => {
    expect(signInConfig({}, false, '')).toBeUndefined()
    expect(signInConfig({}, false, 'not-a-client')).toBeUndefined()
    expect(signInConfig({}, false, CLIENT)).toEqual({ clientId: CLIENT, authorizeUrl: SIGN_IN_AUTHORIZE_URL, tokenUrl: SIGN_IN_TOKEN_URL, ports: SIGN_IN_PORTS, scope: 'inference' })
  })

  it('ignores the test hooks in release builds and accepts only unoblox.ai or this machine in test builds', () => {
    const hooks = { UNOBLOX_WORKS_SIGNIN_CLIENT_ID: CLIENT, UNOBLOX_WORKS_SIGNIN_AUTHORIZE_URL: 'http://localhost:13300/oauth/authorize', UNOBLOX_WORKS_SIGNIN_TOKEN_URL: 'http://localhost:13300/api/identity/oauth/token' }
    expect(signInConfig(hooks, false, '')).toBeUndefined()
    expect(signInConfig(hooks, true, '')).toMatchObject({ clientId: CLIENT, authorizeUrl: hooks.UNOBLOX_WORKS_SIGNIN_AUTHORIZE_URL })
    expect(signInConfig({ ...hooks, UNOBLOX_WORKS_SIGNIN_TOKEN_URL: 'https://evil.example/token' }, true, '')).toBeUndefined()
    expect(signInConfig({ ...hooks, UNOBLOX_WORKS_SIGNIN_AUTHORIZE_URL: 'http://unoblox.ai/oauth/authorize' }, false, CLIENT)).toMatchObject({ authorizeUrl: SIGN_IN_AUTHORIZE_URL })
  })

  it('registers the loopback ports identity must allow for the client', () => {
    expect(SIGN_IN_PORTS).toEqual([53682, 53683, 53684])
    expect(SIGN_IN_AUTHORIZE_URL).toBe('https://unoblox.ai/oauth/authorize')
    expect(SIGN_IN_TOKEN_URL).toBe('https://unoblox.ai/api/identity/oauth/token')
  })
})

describe('the sign-in service', () => {
  function service(overrides: Partial<ConstructorParameters<typeof UnobloxSignIn>[0]> = {}) {
    const stored: unknown[] = []
    const harnessFetch = vi.fn(async (url: URL, init: RequestInit) => {
      if (init.method === 'GET') return new Response(null, { status: 302, headers: { 'set-cookie': 'dsh=session; HttpOnly' } })
      const body = JSON.parse(String(init.body)) as { rpcId: string; method: string; payload: { args: unknown } }
      stored.push({ path: url.pathname, method: body.method, args: body.payload.args, cookie: (init.headers as Record<string, string>).cookie })
      return new Response(JSON.stringify({ rpcId: body.rpcId, result: { ok: true } }))
    })
    const sign = new UnobloxSignIn({
      config: () => ({ authorizeUrl: 'https://unoblox.ai/oauth/authorize', tokenUrl: 'https://unoblox.ai/x', clientId: CLIENT, ports: [] }),
      harness: () => ({ url: 'http://127.0.0.1:4000/', authToken: 'launch' }),
      openBrowser: async () => {},
      tokenFetch: async () => new Response('{}'),
      harnessFetch,
      log: () => {},
      ...overrides
    })
    return { sign, stored }
  }

  it('stores the key in the Harness credential store and tells the page only that it worked', async () => {
    const settings = await config()
    const identity = fakeIdentity()
    const { sign, stored } = service({ config: () => settings, openBrowser: identity.browser, tokenFetch: identity.token })
    const result = await sign.signIn()
    expect(result).toEqual({ ok: true })
    expect(JSON.stringify(result)).not.toContain('ub-gw-')
    expect(stored).toEqual([{ path: '/api/credentials/set', method: 'credentials/set', args: { ref: 'UNOBLOX_API_KEY', value: KEY }, cookie: 'dsh=session' }])
  })

  it('runs one sign-in at a time', async () => {
    const settings = await config()
    let release: () => void = () => {}
    const identity = fakeIdentity()
    const { sign } = service({ config: () => settings, openBrowser: (url) => new Promise((resolve) => { release = () => { void identity.browser(url); resolve() } }), tokenFetch: identity.token })
    const first = sign.signIn()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(sign.signIn()).resolves.toMatchObject({ ok: false, code: 'busy' })
    release()
    await expect(first).resolves.toEqual({ ok: true })
  })

  it('reports a key it could not store, and when sign-in is not available', async () => {
    const settings = await config()
    const identity = fakeIdentity()
    const failing = vi.fn(async (_url: URL, init: RequestInit) => init.method === 'GET'
      ? new Response(null, { status: 302, headers: { 'set-cookie': 'dsh=s' } })
      : new Response(JSON.stringify({ rpcId: (JSON.parse(String(init.body)) as { rpcId: string }).rpcId, result: { ok: false, error: { message: 'UNOBLOX_API_KEY is supplied read-only by the launching environment' } } })))
    const { sign } = service({ config: () => settings, openBrowser: identity.browser, tokenFetch: identity.token, harnessFetch: failing })
    await expect(sign.signIn()).resolves.toMatchObject({ ok: false, code: 'store-failed', message: expect.stringContaining('read-only') })
    const off = service({ config: () => undefined }).sign
    expect(off.available()).toBe(false)
    await expect(off.signIn()).resolves.toMatchObject({ ok: false, code: 'not-configured' })
  })

  it('signs out by removing the key from the credential store', async () => {
    const { sign, stored } = service()
    await expect(sign.signOut()).resolves.toEqual({ ok: true })
    expect(stored).toEqual([{ path: '/api/credentials/unset', method: 'credentials/unset', args: { ref: 'UNOBLOX_API_KEY' }, cookie: 'dsh=session' }])
  })

  it('refuses an answer that belongs to another request', async () => {
    const mismatched = async (_url: URL, init: RequestInit) => init.method === 'GET'
      ? new Response(null, { status: 302, headers: { 'set-cookie': 'dsh=s' } })
      : new Response(JSON.stringify({ rpcId: 'someone-else', result: { ok: true } }))
    await expect(callHarnessRemote(mismatched, { url: 'http://127.0.0.1:1/', authToken: 't' }, 'credentials/set', {})).rejects.toThrow('another request')
    await expect(callHarnessRemote(mismatched, { url: undefined, authToken: undefined }, 'credentials/set', {})).rejects.toThrow('not running')
  })
})

describe('SignInError', () => {
  it('carries a code the page can act on', () => {
    expect(new SignInError('cancelled', 'x')).toMatchObject({ code: 'cancelled', name: 'SignInError' })
  })
})
