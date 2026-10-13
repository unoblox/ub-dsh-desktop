import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * "Sign in with unoblox": OAuth 2.0 authorization code + PKCE for a public
 * client (RFC 8252). The browser signs the user in on unoblox.ai and
 * redirects to a one-shot listener on 127.0.0.1; the code is exchanged here,
 * in the main process, for a `ub-gw-` key. The key is returned to the caller
 * (which stores it in the Harness credential store) and never reaches a page.
 *
 * Identity matches redirect URIs exactly, port included, so the listener uses
 * the first free port of a list that is registered with the client.
 */

export type SignInErrorCode =
  | 'not-configured'
  | 'busy'
  | 'ports-busy'
  | 'cancelled'
  | 'timeout'
  | 'denied'
  | 'state-mismatch'
  | 'exchange-failed'
  | 'invalid-response'
  | 'network'

export class SignInError extends Error {
  constructor(readonly code: SignInErrorCode, message: string) {
    super(message)
    this.name = 'SignInError'
  }
}

export interface SignInConfig {
  /** The unoblox.ai page that signs the user in and asks for consent. */
  readonly authorizeUrl: string
  /** Form-encoded token endpoint that returns the key. */
  readonly tokenUrl: string
  /** RFC 7009 revocation endpoint for the key this client received. */
  readonly revokeUrl: string
  readonly clientId: string
  /**
   * Loopback ports registered for this client, tried in order. `[0]` lets the
   * OS pick one, for an identity service that matches any loopback port.
   */
  readonly ports: readonly number[]
  readonly scope?: string
}

export const CALLBACK_PATH = '/callback'
/** Sign-in codes live 5 minutes on the identity side; the browser step gets the same. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000
export const TOKEN_TIMEOUT_MS = 20_000

function base64url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}

/** A PKCE verifier (43 characters of 32 random bytes) and its S256 challenge. */
export function createPkce(random: (size: number) => Buffer = randomBytes): { verifier: string; challenge: string } {
  const verifier = base64url(random(32))
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) }
}

export function createState(random: (size: number) => Buffer = randomBytes): string {
  return base64url(random(24))
}

export function redirectUriFor(port: number): string {
  return `http://127.0.0.1:${String(port)}${CALLBACK_PATH}`
}

export function authorizeRequestUrl(config: SignInConfig, redirectUri: string, challenge: string, state: string): string {
  const url = new URL(config.authorizeUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  if (config.scope) url.searchParams.set('scope', config.scope)
  return url.toString()
}

const PAGE_STYLE = 'body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0c0c0c;color:#f1e9dc}main{max-width:420px;padding:32px;text-align:center}h1{font-size:20px;margin:0 0 8px;color:#d9a64a}'

/** The page the browser shows after redirecting; nothing loads from anywhere. */
function resultPage(title: string, body: string): string {
  const escape = (text: string) => text.replace(/[&<>"]/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${PAGE_STYLE}</style></head><body><main><h1>${escape(title)}</h1><p>${escape(body)}</p></main></body></html>`
}

function respond(response: ServerResponse, status: number, title: string, body: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff'
  })
  response.end(resultPage(title, body))
}

export interface CallbackListener {
  readonly redirectUri: string
  /** Resolves with the authorization code once the browser comes back with the right state. */
  readonly code: Promise<string>
  close(): void
}

/**
 * Listen once on the first free registered port. Only GET /callback with the
 * expected state settles the result; anything else is answered and ignored,
 * so a stray request cannot end the sign-in.
 */
export async function listenForCallback(ports: readonly number[], state: string, signal: AbortSignal): Promise<CallbackListener> {
  let server: Server | undefined
  for (const port of ports) {
    server = await new Promise<Server | undefined>((resolve, reject) => {
      const candidate = createServer()
      candidate.once('error', (error: NodeJS.ErrnoException) => {
        candidate.close()
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(undefined)
        else reject(error)
      })
      candidate.listen(port, '127.0.0.1', () => resolve(candidate))
    })
    if (server) break
  }
  if (!server) {
    throw new SignInError('ports-busy', `Sign-in needs port ${ports.join(', ')} on this computer, and another program is using it. Close that program and try again, or paste an API key.`)
  }
  const listening = server
  const port = (listening.address() as AddressInfo).port

  let settle: { resolve: (code: string) => void; reject: (error: Error) => void } | undefined
  const code = new Promise<string>((resolve, reject) => { settle = { resolve, reject } })
  // A rejection nobody awaits yet (the caller is still opening the browser) must not crash the process.
  code.catch(() => {})
  let done = false
  const finish = (outcome: { code: string } | { error: SignInError }) => {
    if (done) return
    done = true
    if ('code' in outcome) settle?.resolve(outcome.code)
    else settle?.reject(outcome.error)
  }

  listening.on('request', (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(port)}`)
    if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
      respond(response, 404, 'Not found', 'This address is only used to finish signing in to unoblox works.')
      return
    }
    if (done) {
      respond(response, 410, 'Already finished', 'You can close this tab and return to unoblox works.')
      return
    }
    if (url.searchParams.get('state') !== state) {
      // Not this sign-in: leave it running for the real redirect.
      respond(response, 400, 'Sign-in link not recognised', 'Start signing in again from unoblox works.')
      return
    }
    const error = url.searchParams.get('error')
    const received = url.searchParams.get('code')
    if (error !== null) {
      respond(response, 200, 'Sign-in cancelled', 'You can close this tab and return to unoblox works.')
      finish({ error: new SignInError('denied', error === 'access_denied' ? 'Sign-in was declined.' : `Sign-in failed (${error.slice(0, 80)}).`) })
      return
    }
    if (!received) {
      respond(response, 400, 'Sign-in failed', 'unoblox.ai did not return a sign-in code. Try again from unoblox works.')
      finish({ error: new SignInError('invalid-response', 'unoblox.ai returned no sign-in code.') })
      return
    }
    respond(response, 200, 'You are signed in', 'You can close this tab and return to unoblox works.')
    finish({ code: received })
  })

  const timer = setTimeout(() => finish({ error: new SignInError('timeout', 'Sign-in timed out. Try again.') }), SIGN_IN_TIMEOUT_MS)
  const onAbort = () => finish({ error: new SignInError('cancelled', 'Sign-in was cancelled.') })
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    listening.close()
    listening.closeAllConnections()
  }
  code.then(close, close)
  return { redirectUri: redirectUriFor(port), code, close }
}

export type TokenFetch = (url: string, init: RequestInit) => Promise<Response>

/** Exchange the code for the key; the response is the identity service's JSON. */
/**
 * This computer, for identity: one active key per user, app and device,
 * named "<client name> on <device name>".
 */
export interface SignInDeviceInfo {
  readonly id: string
  readonly name: string
}

export async function exchangeCode(
  fetchImpl: TokenFetch,
  config: SignInConfig,
  request: { code: string; verifier: string; redirectUri: string; device?: SignInDeviceInfo },
  signal: AbortSignal
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: request.code,
    code_verifier: request.verifier,
    client_id: config.clientId,
    redirect_uri: request.redirectUri,
    ...(request.device === undefined ? {} : { device_id: request.device.id, device_name: request.device.name })
  })
  let response: Response
  try {
    response = await fetchImpl(config.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(TOKEN_TIMEOUT_MS)])
    })
  } catch (error) {
    if (signal.aborted) throw new SignInError('cancelled', 'Sign-in was cancelled.')
    throw new SignInError('network', `Could not reach unoblox.ai (${error instanceof Error ? error.message : String(error)}).`)
  }
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new SignInError('invalid-response', `unoblox.ai answered HTTP ${String(response.status)} without a readable body.`)
  }
  const data = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  if (!response.ok) {
    const described = typeof data.error_description === 'string' ? data.error_description : typeof data.error === 'string' ? data.error : `HTTP ${String(response.status)}`
    throw new SignInError('exchange-failed', `unoblox.ai refused the sign-in: ${described.slice(0, 200)}`)
  }
  const key = typeof data.key === 'string' ? data.key : typeof data.access_token === 'string' ? data.access_token : undefined
  if (key === undefined || !/^ub-gw-[A-Za-z0-9._~-]{8,256}$/u.test(key)) {
    throw new SignInError('invalid-response', 'unoblox.ai did not return an API key.')
  }
  return key
}

export const REVOKE_TIMEOUT_MS = 10_000

/**
 * Revoke the key this client received (RFC 7009; identity answers 200 for any
 * token). Returns false when unoblox.ai could not be reached or refused.
 */
export async function revokeKey(fetchImpl: TokenFetch, config: SignInConfig, key: string): Promise<boolean> {
  try {
    const response = await fetchImpl(config.revokeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: key, client_id: config.clientId }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS)
    })
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  }
}

export interface SignInDependencies {
  readonly config: SignInConfig
  /** Sent with the token request when known. */
  readonly device?: SignInDeviceInfo
  readonly openBrowser: (url: string) => Promise<void>
  readonly fetch: TokenFetch
  readonly signal: AbortSignal
}

/** The whole flow: returns the new key, or throws a SignInError. */
export async function signInWithUnoblox(dependencies: SignInDependencies): Promise<string> {
  const { config, signal } = dependencies
  if (!config.clientId || config.ports.length === 0) throw new SignInError('not-configured', 'Sign-in is not available in this build.')
  const { verifier, challenge } = createPkce()
  const state = createState()
  const listener = await listenForCallback(config.ports, state, signal)
  try {
    try {
      await dependencies.openBrowser(authorizeRequestUrl(config, listener.redirectUri, challenge, state))
    } catch (error) {
      throw new SignInError('network', `Could not open the browser (${error instanceof Error ? error.message : String(error)}).`)
    }
    const code = await listener.code
    return await exchangeCode(dependencies.fetch, config, { code, verifier, redirectUri: listener.redirectUri, ...(dependencies.device === undefined ? {} : { device: dependencies.device }) }, signal)
  } finally {
    listener.close()
  }
}
