import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  UNOBLOX_AUTO_ROW,
  UNOBLOX_MODELS_ENV,
  UNOBLOX_MODELS_URL,
  catalogEnvironment,
  catalogForLaunch,
  catalogFromListing,
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

describe('Unoblox model listing', () => {
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
    expect(catalogEnvironment({ rows: [UNOBLOX_AUTO_ROW], source: 'fallback' })).toEqual({ [UNOBLOX_MODELS_ENV]: '[{"id":"unoblox/auto","name":"Unoblox Auto"}]' })
  })
})
