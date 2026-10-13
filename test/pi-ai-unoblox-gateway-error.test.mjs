import { readFileSync } from 'node:fs'
import { APIError } from 'openai'
import { isQuotaExceededError, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { formatProviderError, normalizeProviderError } from '../node_modules/@earendil-works/pi-ai/dist/utils/error-body.js'

// The patched provider's own helpers, taken from the installed (patched) file.
const source = readFileSync('node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', 'utf8')
const helper = name => {
  const start = source.indexOf(`function ${name}(`)
  expect(start).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('\n}', start) + 2)
}
const unobloxGatewayFailure = new Function(
  'isQuotaExceededError',
  'QUOTA_EXCEEDED_CODE',
  `${helper('classifyPiAiError')}\n${helper('unobloxGatewayFailure')}\nreturn unobloxGatewayFailure`
)(isQuotaExceededError, QUOTA_EXCEEDED_CODE)

/** The text pi-ai puts in `errorMessage` for an OpenAI-compatible HTTP error. */
function piAiErrorText(status, body) {
  const error = APIError.generate(status, body, undefined, new Headers())
  return formatProviderError(normalizeProviderError(error))
}

describe('unoblox gateway failures in the pi-ai provider', () => {
  it('turns any 402 into a balance failure with the gateway sentence and code', () => {
    // Body shape as served by api.unoblox.ai/v1/chat/completions (2026-10-13).
    const text = piAiErrorText(402, {
      error: { message: 'Your balance of ₹0.00 is below ₹1.20 for this request.', type: 'payment', code: 402, request_id: 'r-1', error_code: 'UB-GW-003' }
    })
    expect(text.startsWith('402: {')).toBe(true)
    expect(unobloxGatewayFailure(text)).toEqual({
      message: 'Your balance of ₹0.00 is below ₹1.20 for this request. (UB-GW-003)',
      code: 'UNOBLOX_BALANCE',
      status: 402
    })
    const limit = piAiErrorText(402, { error: { message: 'Daily spending limit reached.', error_code: 'UB-GW-306' } })
    expect(unobloxGatewayFailure(limit)?.code).toBe('UNOBLOX_BALANCE')
  })

  it('keeps the stock classification for other gateway refusals', () => {
    const revoked = piAiErrorText(401, {
      error: { message: 'Please sign in with a valid API key.', type: 'authentication', code: 401, error_code: 'UB-GW-007' }
    })
    expect(unobloxGatewayFailure(revoked)).toEqual({
      message: 'Please sign in with a valid API key. (UB-GW-007)',
      code: 'AUTH',
      status: 401
    })
    const busy = piAiErrorText(429, { error: { message: 'Slow down.', error_code: 'UB-GW-303' } })
    expect(unobloxGatewayFailure(busy)?.code).toBe('RATE_LIMIT')
    const down = piAiErrorText(503, { error: { message: '', error_code: 'UB-GW-009' } })
    expect(unobloxGatewayFailure(down)).toEqual({ message: 'unoblox refused the request (HTTP 503) (UB-GW-009)', code: 'SERVER', status: 503 })
  })

  it('leaves other providers and plain text to the stock path', () => {
    expect(unobloxGatewayFailure(piAiErrorText(402, { error: { message: 'Insufficient credits', code: 'insufficient_quota' } }))).toBeUndefined()
    expect(unobloxGatewayFailure('402 Payment Required')).toBeUndefined()
    expect(unobloxGatewayFailure('402: {not json')).toBeUndefined()
    expect(unobloxGatewayFailure('fetch failed')).toBeUndefined()
  })

  it('reports the gateway failure from the terminal error event', () => {
    const mapStopReason = new Function(
      'isQuotaExceededError', 'QUOTA_EXCEEDED_CODE', 'isContextOverflow', 'isContextWindowExceededError', 'CONTEXT_WINDOW_EXCEEDED_CODE', 'EMPTY_RESPONSE_CODE',
      `${helper('classifyPiAiError')}\n${helper('unobloxGatewayFailure')}\n${helper('mapStopReason')}\nreturn mapStopReason`
    )(isQuotaExceededError, QUOTA_EXCEEDED_CODE, () => false, () => false, 'CONTEXT_WINDOW_EXCEEDED', 'EMPTY_RESPONSE')
    const errorMessage = piAiErrorText(402, { error: { message: 'Top up to continue.', error_code: 'UB-GW-295' } })
    expect(mapStopReason({ stopReason: 'error', errorMessage, model: 'm', content: [] }, 128000)).toEqual({
      kind: 'error',
      failure: { message: 'Top up to continue. (UB-GW-295)', code: 'UNOBLOX_BALANCE', status: 402 }
    })
    expect(mapStopReason({ stopReason: 'error', errorMessage: 'socket hang up ECONNRESET', model: 'm', content: [] }, 128000)).toEqual({
      kind: 'error',
      failure: { message: 'socket hang up ECONNRESET', code: 'TRANSPORT' }
    })
  })
})
