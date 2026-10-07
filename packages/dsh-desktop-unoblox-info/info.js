/**
 * Pure parsing and state for the Unoblox info strip.
 *
 * Every value shown comes from what Unoblox itself returns; nothing here is a
 * copied price or a guessed balance:
 * - search price: `GET https://unoblox.ai/api/webapi/public/search-pricing`
 *   (public, no key) — `{ price_inr_paise_per_1000_searches,
 *   price_inr_micro_paise_per_search, max_inr_paise_per_search }`;
 * - balance and charge: the `x-unoblox-freemium` header on each chat
 *   completion (`balance_inr`, `charged_inr`, `charged_estimated` when
 *   streaming, `tier`, `stage`, `note`). Unoblox has no balance endpoint, so
 *   the strip only knows the balance after a chat call this process made;
 * - routing: `x-unoblox-selector`, `x-unoblox-selected-model`,
 *   `x-unoblox-served-model` and `x-unoblox-selection-reason`.
 */

export const UNOBLOX_SEARCH_PRICING_URL = 'https://unoblox.ai/api/webapi/public/search-pricing'
// Long enough to avoid a request per turn, short enough that a price change
// reaches the strip within minutes.
export const PRICING_TTL_MS = 5 * 60_000
const PRICING_TIMEOUT_MS = 10_000
// One entry per conversation that talked to Unoblox; old ones fall off first.
export const MAX_TRACKED_SESSIONS = 200
// Gateway text is shown as text, never markup; a bound keeps one odd header
// from flooding the composer.
const MAX_TEXT_LENGTH = 500

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function text(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed.slice(0, MAX_TEXT_LENGTH)
}

function defined(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined))
}

/**
 * Normalize the public search-pricing body. Prices stay in integer paise (and
 * micro-paise) as Unoblox sends them; the client formats them as rupees.
 * @param {unknown} body - parsed JSON.
 * @returns {{ paisePer1000: number, microPaisePerSearch?: number, maxPaisePerSearch?: number } | undefined}
 */
export function parseSearchPricing(body) {
  if (!isRecord(body)) return undefined
  const paisePer1000 = nonNegativeInteger(body.price_inr_paise_per_1000_searches)
  if (paisePer1000 === undefined) return undefined
  return defined({
    paisePer1000,
    microPaisePerSearch: nonNegativeInteger(body.price_inr_micro_paise_per_search),
    maxPaisePerSearch: nonNegativeInteger(body.max_inr_paise_per_search)
  })
}

/**
 * Normalize the billing block Unoblox reports per chat call, from the
 * `x-unoblox-freemium` header (a JSON object) or the identical `unoblox` body
 * block of a non-streaming response.
 * @param {unknown} block - parsed object.
 * @returns {object | undefined} billing fields, or undefined without a balance.
 */
export function parseBilling(block) {
  if (!isRecord(block)) return undefined
  const balanceInr = finiteNumber(block.balance_inr)
  if (balanceInr === undefined) return undefined
  return defined({
    balanceInr,
    balanceRequirementInr: finiteNumber(block.balance_requirement_inr),
    chargedInr: finiteNumber(block.charged_inr),
    baseInr: finiteNumber(block.base_inr),
    gstInr: finiteNumber(block.gst_inr),
    chargedEstimated: block.charged_estimated === true ? true : undefined,
    tier: text(block.tier),
    stage: text(block.stage),
    note: text(block.note)
  })
}

/**
 * Undo fetch's Latin-1 view of a header value. Header values are bytes, and
 * Unoblox sends UTF-8 (the note contains ₹ and —), which `Headers` exposes one
 * byte per character. A value that already has a character above U+00FF was
 * decoded by someone else and is returned as is.
 */
export function utf8HeaderValue(value) {
  const bytes = new Uint8Array(value.length)
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code > 0xff) return value
    bytes[index] = code
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Not UTF-8 after all; Latin-1 is then the faithful reading.
    return value
  }
}

/**
 * Read what one chat response says about billing and routing.
 * @param {Readonly<Record<string, string>>} headers - lowercase response headers.
 * @returns {{ billing?: object, routing?: object } | undefined} undefined when no Unoblox header is present.
 */
export function turnFromHeaders(headers) {
  if (!isRecord(headers)) return undefined
  let billing
  const raw = headers['x-unoblox-freemium']
  if (typeof raw === 'string') {
    try {
      billing = parseBilling(JSON.parse(utf8HeaderValue(raw)))
    } catch {
      // A malformed header only means this call reports no billing; routing
      // headers on the same response are still worth showing.
      billing = undefined
    }
  }
  const routing = defined({
    selector: text(headers['x-unoblox-selector']),
    selectedModel: text(headers['x-unoblox-selected-model']),
    servedModel: text(headers['x-unoblox-served-model']),
    reason: typeof headers['x-unoblox-selection-reason'] === 'string' ? text(utf8HeaderValue(headers['x-unoblox-selection-reason'])) : undefined
  })
  const hasRouting = Object.keys(routing).length > 0
  if (billing === undefined && !hasRouting) return undefined
  return defined({ billing, routing: hasRouting ? routing : undefined })
}

/**
 * Per-session record of the latest Unoblox chat response, plus the latest
 * billing block from any session (the balance is per account, not per chat).
 */
export function createTurnStore({ maxSessions = MAX_TRACKED_SESSIONS, now = Date.now } = {}) {
  const bySession = new Map()
  let latestBilling
  return {
    record(sessionId, turn) {
      const entry = { ...turn, at: now() }
      if (turn.billing !== undefined) latestBilling = { ...turn.billing, at: entry.at }
      if (typeof sessionId !== 'string' || sessionId.length === 0) return
      bySession.delete(sessionId)
      bySession.set(sessionId, entry)
      while (bySession.size > maxSessions) bySession.delete(bySession.keys().next().value)
    },
    session(sessionId) {
      return typeof sessionId === 'string' ? bySession.get(sessionId) : undefined
    },
    latestBilling() {
      return latestBilling
    }
  }
}

/**
 * Cached reader of the public search-pricing endpoint. A success is reused for
 * `ttlMs`; concurrent reads share one request; a failure is reported (not
 * replaced by an older price) and retried on the next read.
 */
export function createPricingSource({ url = UNOBLOX_SEARCH_PRICING_URL, fetch: doFetch = fetch, ttlMs = PRICING_TTL_MS, now = Date.now } = {}) {
  let cached
  let inflight
  const load = async () => {
    let response
    try {
      response = await doFetch(url, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(PRICING_TIMEOUT_MS)
      })
    } catch (error) {
      return { error: `search pricing request failed: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (!response.ok) return { error: `search pricing returned HTTP ${String(response.status)}` }
    let pricing
    try {
      pricing = parseSearchPricing(await response.json())
    } catch (error) {
      return { error: `search pricing body is not JSON: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (pricing === undefined) return { error: 'search pricing body has no price_inr_paise_per_1000_searches' }
    cached = { pricing, fetchedAt: now() }
    return cached
  }
  return {
    read() {
      if (cached !== undefined && now() - cached.fetchedAt < ttlMs) return Promise.resolve(cached)
      inflight ??= load().finally(() => {
        inflight = undefined
      })
      return inflight
    }
  }
}
