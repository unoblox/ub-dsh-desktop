/**
 * `WebSearchProvider` over the unoblox search endpoint (`POST {baseURL}/search`).
 *
 * unoblox runs the search on Perplexity's Search API and answers in an
 * Exa-compatible shape: `results[]` with `url`, `title`, `snippet`,
 * `highlights` and an optional `publishedDate`. There is no generated answer,
 * so results carry sources only.
 *
 * The key is resolved per search through the Harness credential seam, so a key
 * typed into the app after Harness started works without a restart.
 */
import { randomUUID } from 'node:crypto'
import { WebError } from '@deepseek-ai/dsh-web'

export const UNOBLOX_SEARCH_PROVIDER_ID = 'unoblox'
export const UNOBLOX_DEFAULT_BASE_URL = 'https://api.unoblox.ai/v1'
// The endpoint accepts 1-20 results and defaults to 8.
const MIN_RESULTS = 1
const MAX_RESULTS = 20
const DEFAULT_RESULTS = 8
// One bounded retry for the failures unoblox documents as transient and
// unbilled; anything slower is better reported than hidden behind a wait.
const MAX_RETRY_DELAY_MS = 2_000
const BACKEND_RETRY_DELAY_MS = 500
const RETRYABLE_429_CODES = new Set(['UB-GW-303', 'UB-GW-312'])
const RETRYABLE_502_CODES = new Set(['UB-GW-305'])

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isWebUrl(value) {
  if (typeof value !== 'string' || !URL.canParse(value)) return false
  const { protocol } = new URL(value)
  return protocol === 'http:' || protocol === 'https:'
}

/** Clamp the seam's optional bound into the range the endpoint accepts. */
export function resultCount(maxResults) {
  if (!Number.isInteger(maxResults)) return DEFAULT_RESULTS
  return Math.min(MAX_RESULTS, Math.max(MIN_RESULTS, maxResults))
}

/**
 * Map one unoblox result to a normalized source, or undefined when it has no
 * usable http(s) URL. The snippet prefers `snippet`, then the first highlight.
 */
export function mapUnobloxResult(result) {
  if (!isRecord(result) || !isWebUrl(result.url)) return undefined
  const highlights = Array.isArray(result.highlights) ? result.highlights : []
  const snippet = nonBlankString(result.snippet) ?? highlights.map(nonBlankString).find((value) => value !== undefined)
  const title = nonBlankString(result.title)
  const publishedAt = nonBlankString(result.publishedDate)
  return {
    url: result.url,
    ...(title === undefined ? {} : { title }),
    ...(snippet === undefined ? {} : { snippet }),
    ...(publishedAt === undefined ? {} : { publishedAt })
  }
}

/** Map a 200 response body to a normalized search result. */
export function mapUnobloxResponse(body) {
  if (!isRecord(body) || !Array.isArray(body.results)) {
    throw new WebError('unoblox search returned a response without a results list', 'WEB_PROVIDER_ERROR')
  }
  return {
    sources: body.results.map(mapUnobloxResult).filter((source) => source !== undefined),
    truncated: false
  }
}

/** Seconds from a numeric `Retry-After` header, in milliseconds. */
function retryAfterMs(response) {
  const header = response.headers.get('retry-after')
  if (header === null) return undefined
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined
}

/**
 * The wait before the single retry, or undefined when the failure is not one
 * unoblox documents as worth retrying immediately (daily caps, a switched-off
 * service, policy refusals and billing problems are reported instead).
 */
export function retryDelayMs(status, errorCode, retryAfter) {
  if (status === 429 && RETRYABLE_429_CODES.has(errorCode)) {
    const wait = retryAfter ?? 1_000
    return wait <= MAX_RETRY_DELAY_MS ? wait : undefined
  }
  if (status === 502 && RETRYABLE_502_CODES.has(errorCode)) return BACKEND_RETRY_DELAY_MS
  return undefined
}

async function readError(response) {
  try {
    const body = await response.json()
    return {
      message: isRecord(body) ? nonBlankString(body.error) ?? nonBlankString(body.message) : undefined,
      code: isRecord(body) ? nonBlankString(body.error_code) : undefined
    }
  } catch (error) {
    if (isAbortError(error)) throw error
    return { message: undefined, code: undefined }
  }
}

function failureMessage(status, detail) {
  // unoblox error text names the cause and the next step; show it verbatim.
  if (detail.message !== undefined) {
    return detail.code === undefined ? detail.message : `${detail.message} (${detail.code})`
  }
  if (status === 401) return 'unoblox rejected the API key. Update it in Settings → Models.'
  return `unoblox search failed (HTTP ${String(status)})`
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class UnobloxSearchProvider {
  id = UNOBLOX_SEARCH_PROVIDER_ID

  /**
   * @param {object} options
   * @param {string} options.baseURL - API root, e.g. https://api.unoblox.ai/v1.
   * @param {() => Promise<string | undefined>} options.resolveApiKey - per-search key lookup.
   * @param {typeof fetch} [options.fetch] - injectable for tests.
   * @param {() => string} [options.idempotencyKey] - injectable for tests.
   * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [options.sleep] - injectable for tests.
   */
  constructor(options) {
    this.options = options
  }

  available() {
    return URL.canParse(this.options.baseURL)
  }

  async search(request, signal) {
    const apiKey = await this.options.resolveApiKey()
    if (apiKey === undefined || apiKey.length === 0) {
      throw new WebError('No unoblox API key is set. Add it in Settings → Models to use web search.', 'WEB_PROVIDER_CREDENTIAL_MISSING')
    }
    const doFetch = this.options.fetch ?? fetch
    const wait = this.options.sleep ?? sleep
    // One key per logical search: a retry returns the same result, billed once.
    const idempotencyKey = (this.options.idempotencyKey ?? randomUUID)()
    const body = JSON.stringify({ query: request.query, numResults: resultCount(request.maxResults) })

    for (let attempt = 0; ; attempt += 1) {
      let response
      try {
        response = await doFetch(`${this.options.baseURL}/search`, {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json',
            'idempotency-key': idempotencyKey
          },
          body,
          ...(signal === undefined ? {} : { signal })
        })
      } catch (error) {
        if (isAbortError(error)) throw new WebError('unoblox search aborted', 'WEB_ABORTED', { cause: error })
        throw new WebError(`unoblox search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
      }

      try {
        if (response.ok) return mapUnobloxResponse(await response.json())
        const detail = await readError(response)
        const delay = attempt === 0 ? retryDelayMs(response.status, detail.code, retryAfterMs(response)) : undefined
        if (delay !== undefined) {
          await wait(delay, signal)
          continue
        }
        throw new WebError(failureMessage(response.status, detail), 'WEB_PROVIDER_ERROR', {
          ...(detail.code === undefined ? {} : { cause: { status: response.status, errorCode: detail.code } })
        })
      } catch (error) {
        if (error instanceof WebError) throw error
        if (isAbortError(error) || signal?.aborted) throw new WebError('unoblox search aborted', 'WEB_ABORTED', { cause: error })
        throw new WebError(`unoblox returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
      }
    }
  }
}
