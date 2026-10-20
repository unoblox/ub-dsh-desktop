import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  UNOBLOX_AUTO_ROW,
  UNOBLOX_FREE_MODELS_ENV,
  UNOBLOX_LOW_COST_MODELS_ENV,
  UNOBLOX_MODELS_ENV,
  UNOBLOX_MODELS_URL,
  catalogEnvironment,
  catalogForLaunch,
  catalogFromListing,
  isFreeModel,
  lowCostModelIds,
  parseCachedLowCost,
  modelRow,
  parseCachedCatalog,
  refreshUnobloxCatalog
} from '../src/main/unoblox/model-catalog'

// Entries as GET https://api.unoblox.ai/v1/models returned them on 2026-10-07
// (public listing; pricing and descriptive fields trimmed).
const FABLE = {
  id: 'anthropic/claude-fable-5-1', name: 'Claude Fable 5.1', object: 'model', context_length: 1000000,
  max_completion_tokens: null, input_modalities: ['text', 'image'], output_modalities: ['text'],
  capabilities: { reasoning: true, tools: true }, top_provider: { context_length: 1000000, max_completion_tokens: null },
  pricing: { prompt: '0.00101582', completion: '0.00507909', currency: 'INR' }
}
const GEMINI = {
  id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', object: 'model', context_length: 1048576,
  max_completion_tokens: 65536, input_modalities: ['text', 'image'], output_modalities: ['text'],
  capabilities: { reasoning: true, tools: true }, top_provider: { context_length: 1048576, max_completion_tokens: 65536 }
}
const OCR = {
  id: 'deepseek-ai/deepseek-ocr', name: 'DeepSeek-OCR', object: 'model', context_length: 8192,
  max_completion_tokens: null, input_modalities: ['text', 'image'], output_modalities: ['text'],
  capabilities: { cache_isolation: false, image_input_profile: { max_tokens_per_image: 1300 } }
}
const LLAMA = {
  id: 'meta-llama/llama-3.3-70b-instruct-turbo', name: 'Llama 3.3 70B Instruct Turbo', object: 'model', context_length: 131072,
  max_completion_tokens: null, input_modalities: ['text'], output_modalities: ['text'], capabilities: { tools: true }
}
// Listed at ₹0 on 2026-10-09 (prompt and completion "0").
const QWEN = {
  id: 'qwen/qwen3.8-27b', name: 'Qwen3.8-27B', object: 'model', context_length: 262144,
  max_completion_tokens: null, input_modalities: ['text'], output_modalities: ['text'], capabilities: { tools: true },
  pricing: { prompt: '0', completion: '0', request: '0', currency: 'INR' }
}
const GEMMA = {
  id: 'google/gemma-4-26b-a4b-it', name: 'Gemma 4 26B A4B Instruct', object: 'model', context_length: 262144,
  max_completion_tokens: null, input_modalities: ['text', 'image'], output_modalities: ['text'], capabilities: { tools: true },
  pricing: { prompt: '0', completion: '0', currency: 'INR' }
}
const LISTING = { object: 'list', data: [LLAMA, FABLE, OCR, GEMINI] }

const homes: string[] = []
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})
async function cachePath(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'unoblox-catalog-'))
  homes.push(home)
  return join(home, 'harness', 'unoblox-models.json')
}

describe('unoblox model listing', () => {
  it('maps entries to picker rows', () => {
    expect(modelRow(FABLE)).toEqual({ id: 'anthropic/claude-fable-5-1', name: 'Claude Fable 5.1', contextWindow: 1000000, input: ['text', 'image'] })
    expect(modelRow(GEMINI)).toEqual({ id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', contextWindow: 1048576, maxTokens: 65536, input: ['text', 'image'] })
  })

  it('leaves out models an agent cannot drive, and Auto itself', () => {
    expect(modelRow(OCR)).toBeUndefined()
    expect(modelRow({ ...LLAMA, output_modalities: ['image'] })).toBeUndefined()
    expect(modelRow({ ...LLAMA, id: '' })).toBeUndefined()
    expect(modelRow({ ...LLAMA, id: 'unoblox/auto' })).toBeUndefined()
  })

  it('puts Auto first, then models by name, without duplicates', () => {
    const rows = catalogFromListing({ ...LISTING, data: [...LISTING.data, FABLE] })
    expect(rows?.map((row) => row.id)).toEqual([
      'unoblox/auto', 'anthropic/claude-fable-5-1', 'google/gemini-3.8-flash', 'meta-llama/llama-3.3-70b-instruct-turbo'
    ])
    expect(catalogFromListing({ error: 'x' })).toBeUndefined()
  })

  it('lists free models right after Auto, labelled as free', () => {
    const rows = catalogFromListing({ object: 'list', data: [LLAMA, QWEN, FABLE, GEMMA, GEMINI] })
    expect(rows?.map((row) => row.name)).toEqual([
      'unoblox Auto · best value',
      'Gemma 4 26B A4B Instruct · free',
      'Qwen3.8-27B · free',
      'Claude Fable 5.1',
      'Gemini 3.8 Flash',
      'Llama 3.3 70B Instruct Turbo'
    ])
    // Rows stay plain model config: no extra field reaches Harness.
    expect(Object.keys(rows?.[1] ?? {}).sort()).toEqual(['contextWindow', 'id', 'input', 'name'])
  })

  it('counts a model as free only when prompt, completion and request cost nothing', () => {
    expect(isFreeModel(QWEN)).toBe(true)
    expect(isFreeModel(GEMMA)).toBe(true)
    expect(isFreeModel(FABLE)).toBe(false)
    expect(isFreeModel(GEMINI)).toBe(false)
    expect(isFreeModel({ ...QWEN, pricing: { prompt: '0', completion: '0.000001' } })).toBe(false)
    expect(isFreeModel({ ...QWEN, pricing: { prompt: '0', completion: '0', request: '0.5' } })).toBe(false)
    expect(isFreeModel({ ...QWEN, pricing: { prompt: '', completion: '0' } })).toBe(false)
    expect(isFreeModel({ ...QWEN, pricing: { prompt: 0, completion: 0 } })).toBe(true)
  })

  it('follows the freemium flag once the listing carries it, whatever the price', () => {
    // As listed on 2026-10-13: standard prices, charged ₹0 on the free tier.
    const priced = { pricing: { prompt: '0.00000362', completion: '0.00012217', request: '0' } }
    expect(isFreeModel({ ...QWEN, ...priced, freemium: true })).toBe(true)
    expect(isFreeModel({ ...QWEN, freemium: false })).toBe(false)
    expect(isFreeModel({ ...FABLE, freemium: false })).toBe(false)
    expect(isFreeModel({ ...QWEN, ...priced, freemium: 'yes' })).toBe(false)
    const rows = catalogFromListing({ data: [{ ...FABLE, freemium: false }, { ...QWEN, ...priced, freemium: true }, { ...OCR, freemium: true }] })
    expect(rows?.map((row) => row.name)).toEqual([UNOBLOX_AUTO_ROW.name, `${QWEN.name} · free`, FABLE.name])
    // A cached free row stays free when read back.
    const cached = parseCachedCatalog(JSON.stringify({ version: 1, models: rows?.slice(1) }))
    expect(cached).toEqual(rows)
  })
})

describe('catalog resolution', () => {
  const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('uses the live listing and caches it for the next launch', async () => {
    const path = await cachePath()
    const seen: string[] = []
    const live = await refreshUnobloxCatalog({ cachePath: path, fetch: async (url, init) => { seen.push(url); return reply(LISTING)() } })
    expect(seen).toEqual([UNOBLOX_MODELS_URL])
    expect(live.source).toBe('live')
    expect(live.rows).toHaveLength(4)
    expect(parseCachedCatalog(await readFile(path, 'utf8'))).toEqual(live.rows)
  })

  it('keeps free models first and labelled once when read back from the cache', async () => {
    const path = await cachePath()
    const live = await refreshUnobloxCatalog({ cachePath: path, fetch: reply({ object: 'list', data: [LLAMA, QWEN, FABLE] }) })
    expect(live.rows.map((row) => row.name)).toEqual(['unoblox Auto · best value', 'Qwen3.8-27B · free', 'Claude Fable 5.1', 'Llama 3.3 70B Instruct Turbo'])
    expect(parseCachedCatalog(await readFile(path, 'utf8'))).toEqual(live.rows)
  })

  it('falls back to the cache, then to Auto alone, when the listing fails', async () => {
    const path = await cachePath()
    await refreshUnobloxCatalog({ cachePath: path, fetch: reply(LISTING) })
    const cached = await refreshUnobloxCatalog({ cachePath: path, fetch: reply({ error: 'down' }, 503) })
    expect(cached).toMatchObject({ source: 'cache', detail: 'HTTP 503' })
    expect(cached.rows).toHaveLength(4)
    const empty = await cachePath()
    expect(await refreshUnobloxCatalog({ cachePath: empty, fetch: async () => { throw new Error('offline') } }))
      .toEqual({ rows: [UNOBLOX_AUTO_ROW], source: 'fallback', detail: 'offline' })
    expect(await refreshUnobloxCatalog({ cachePath: empty, fetch: reply({ object: 'list', data: [OCR] }) }))
      .toMatchObject({ source: 'fallback', detail: 'listing has no usable models' })
  })

  it('survives overlapping refreshes (a Harness restart during a fetch)', async () => {
    const path = await cachePath()
    const results = await Promise.all(Array.from({ length: 6 }, () => refreshUnobloxCatalog({ cachePath: path, fetch: reply(LISTING) })))
    for (const result of results) expect(result).toEqual({ rows: expect.any(Array), lowCost: expect.any(Array), source: 'live' })
    expect(parseCachedCatalog(await readFile(path, 'utf8'))).toHaveLength(4)
  })

  it('ignores a corrupt cache', async () => {
    const path = await cachePath()
    await refreshUnobloxCatalog({ cachePath: path, fetch: reply(LISTING) })
    await writeFile(path, '{"version":1,"models":"nope"}')
    expect(await refreshUnobloxCatalog({ cachePath: path, fetch: reply({}, 500) })).toMatchObject({ source: 'fallback' })
    expect(parseCachedCatalog('not json')).toBeUndefined()
  })

  it('launches with the cache when the live listing is late, without waiting for it', async () => {
    const path = await cachePath()
    await refreshUnobloxCatalog({ cachePath: path, fetch: reply(LISTING) })
    const never = new Promise<never>(() => {})
    const started = Date.now()
    const catalog = await catalogForLaunch(never, path, 50)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(catalog).toMatchObject({ source: 'cache', detail: 'listing not ready within 50 ms' })
    expect(await catalogForLaunch(never, await cachePath(), 10)).toMatchObject({ rows: [UNOBLOX_AUTO_ROW], source: 'fallback' })
    const ready = await catalogForLaunch(Promise.resolve({ rows: [UNOBLOX_AUTO_ROW], source: 'live' as const }), path, 1000)
    expect(ready.source).toBe('live')
  })

  it('hands the rows to the patch files as JSON', () => {
    expect(catalogEnvironment({ rows: [UNOBLOX_AUTO_ROW], source: 'fallback' })).toEqual({ [UNOBLOX_MODELS_ENV]: '[{"id":"unoblox/auto","name":"unoblox Auto · best value"}]', [UNOBLOX_FREE_MODELS_ENV]: '[]', [UNOBLOX_LOW_COST_MODELS_ENV]: '[]' })
    const rows = [UNOBLOX_AUTO_ROW, { id: 'google/gemma-4-26b-a4b-it', name: 'Gemma 4 26B A4B Instruct · free' }, { id: 'qwen/qwen3.8-27b', name: 'Qwen3.8-27B · free' }, { id: 'anthropic/claude-fable-5-1', name: 'Claude Fable 5.1' }]
    expect(JSON.parse(catalogEnvironment({ rows, source: 'live' })[UNOBLOX_FREE_MODELS_ENV]!)).toEqual(['google/gemma-4-26b-a4b-it', 'qwen/qwen3.8-27b'])
    expect(JSON.parse(catalogEnvironment({ rows, lowCost: ['openai/gpt-oss-20b'], source: 'live' })[UNOBLOX_LOW_COST_MODELS_ENV]!)).toEqual(['openai/gpt-oss-20b'])
  })

  it('ranks the cheapest usable models by listed price, prompt-weighted', () => {
    // Prices as listed on 2026-10-20 (INR per token).
    const priced = (entry: object, prompt: string, completion: string, extra: object = {}) => ({ ...entry, pricing: { prompt, completion, ...extra } })
    const listing = { data: [
      priced(FABLE, '0.00101582', '0.00507909'),
      priced(QWEN, '0.00000362', '0.00012217'),
      priced(GEMMA, '0.00000378', '0.00001984'),
      priced({ ...LLAMA, id: 'openai/gpt-oss-20b' }, '0.000003', '0.00001397'),
      // Cheap but unusable here: no tools, a per-request price, or no price.
      priced(OCR, '0.000001', '0.000001'),
      priced({ ...LLAMA, id: 'per/request' }, '0', '0', { request: '0.5' }),
      { ...LLAMA, id: 'no/price' }
    ] }
    expect(lowCostModelIds(listing)).toEqual(['openai/gpt-oss-20b', 'google/gemma-4-26b-a4b-it', 'qwen/qwen3.8-27b'])
    expect(lowCostModelIds(listing, 1)).toEqual(['openai/gpt-oss-20b'])
    expect(lowCostModelIds({ nope: true })).toEqual([])
    expect(parseCachedLowCost(JSON.stringify({ version: 1, models: [], lowCost: ['a/b', 7, ''] }))).toEqual(['a/b'])
    // A cache from before this field has none.
    expect(parseCachedLowCost(JSON.stringify({ version: 1, models: [] }))).toEqual([])
  })
})
