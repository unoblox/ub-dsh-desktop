import { randomUUID } from 'node:crypto'
import { cookiePair } from '../mobile/lan-mobile-bridge'

/**
 * Store or remove the unoblox key in the Harness credential store from the
 * main process, through the same `credentials` remote the first-run dialog
 * uses. A key from "Sign in with unoblox" goes this way so it never reaches
 * the renderer (docs/privacy.md); the providers and plugins read the same
 * reference on every request, so no restart is needed.
 */
export const UNOBLOX_KEY_REF = 'UNOBLOX_API_KEY'

export interface HarnessTarget {
  /** The running Harness's loopback URL, or undefined while it is not up. */
  readonly url: string | undefined
  /** The launch token that opens a Harness session. */
  readonly authToken: string | undefined
}

export type HarnessFetch = (url: URL, init: RequestInit) => Promise<Response>

const RPC_TIMEOUT_MS = 15_000

async function sessionCookie(fetchImpl: HarnessFetch, base: string, token: string): Promise<string> {
  const url = new URL('/', base)
  url.searchParams.set('token', token)
  const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(RPC_TIMEOUT_MS) })
  const cookie = cookiePair(response.headers.getSetCookie())
  if (cookie === undefined) throw new Error(`the Harness did not open a session (HTTP ${String(response.status)})`)
  return cookie
}

/** Call one Harness remote method; resolves on `ok`, throws with its message otherwise. */
export async function callHarnessRemote(
  fetchImpl: HarnessFetch,
  target: HarnessTarget,
  endpoint: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (target.url === undefined || target.authToken === undefined) throw new Error('the Harness is not running')
  const cookie = await sessionCookie(fetchImpl, target.url, target.authToken)
  const rpcId = randomUUID()
  const response = await fetchImpl(new URL(`/api/${endpoint}`, target.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`${endpoint} failed with HTTP ${String(response.status)}`)
  const envelope = (await response.json()) as { rpcId?: unknown; result?: { ok?: unknown; value?: unknown; error?: { message?: unknown } } }
  if (envelope.rpcId !== rpcId) throw new Error(`${endpoint} answered another request`)
  if (envelope.result?.ok !== true) {
    const message = envelope.result?.error?.message
    throw new Error(typeof message === 'string' && message !== '' ? message : `${endpoint} was refused`)
  }
  return envelope.result.value
}

export async function storeUnobloxKey(fetchImpl: HarnessFetch, target: HarnessTarget, key: string): Promise<void> {
  await callHarnessRemote(fetchImpl, target, 'credentials/set', { ref: UNOBLOX_KEY_REF, value: key })
}

export async function removeUnobloxKey(fetchImpl: HarnessFetch, target: HarnessTarget): Promise<void> {
  await callHarnessRemote(fetchImpl, target, 'credentials/unset', { ref: UNOBLOX_KEY_REF })
}
