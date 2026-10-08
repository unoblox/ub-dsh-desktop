import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * The live Unoblox model catalog for the model picker.
 *
 * The Unoblox route is declared in build/dsh-desktop*.patch.yml, which reads
 * its `models` from DSH_DESKTOP_UNOBLOX_MODELS. This module fills that
 * variable from `GET https://api.unoblox.ai/v1/models` (public, no key), so
 * the picker always offers what Unoblox serves instead of a copied list.
 *
 * Harness reads configuration once at launch, so the catalog is resolved per
 * launch: a fresh listing when it arrives in time, otherwise the last good
 * listing cached on disk, otherwise Auto alone. `unoblox/auto` is always the
 * first row (and the overlay's default model).
 */

export const UNOBLOX_MODELS_URL = 'https://api.unoblox.ai/v1/models'
export const UNOBLOX_MODELS_ENV = 'DSH_DESKTOP_UNOBLOX_MODELS'

export interface UnobloxModelRow {
  readonly id: string
  readonly name: string
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly input?: readonly ('text' | 'image')[]
}

export const UNOBLOX_AUTO_ROW: UnobloxModelRow = { id: 'unoblox/auto', name: 'Unoblox Auto' }

// A listing far beyond today's 65 models is not a catalog a picker can use.
const MAX_MODELS = 300
const MAX_TEXT = 200
const FETCH_TIMEOUT_MS = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed.slice(0, MAX_TEXT)
}

/**
 * Map one `/v1/models` entry to a model row, or undefined when the entry is
 * unusable here: no id, not a text model, or (the agent needs tools) no tool
 * support.
 */
export function modelRow(entry: unknown): UnobloxModelRow | undefined {
  if (!isRecord(entry)) return undefined
  const id = text(entry.id)
  if (id === undefined || id === UNOBLOX_AUTO_ROW.id) return undefined
  const outputs = Array.isArray(entry.output_modalities) ? entry.output_modalities : []
  if (!outputs.includes('text')) return undefined
  if (!isRecord(entry.capabilities) || entry.capabilities.tools !== true) return undefined
  const inputs = Array.isArray(entry.input_modalities) ? entry.input_modalities : []
  const input = (['text', 'image'] as const).filter((modality) => inputs.includes(modality))
  const contextWindow = positiveInteger(entry.context_length)
  const maxTokens = positiveInteger(entry.max_completion_tokens)
    ?? (isRecord(entry.top_provider) ? positiveInteger(entry.top_provider.max_completion_tokens) : undefined)
  return {
    id,
    name: text(entry.name) ?? id,
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(input.includes('text') ? { input } : {})
  }
}

/**
 * Turn a `/v1/models` body into picker rows: Auto first, then the usable
 * models by name. Undefined when the body is not a listing.
 */
export function catalogFromListing(body: unknown): UnobloxModelRow[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.data)) return undefined
  const seen = new Set<string>()
  const rows: UnobloxModelRow[] = []
  for (const entry of body.data.slice(0, MAX_MODELS)) {
    const row = modelRow(entry)
    if (row === undefined || seen.has(row.id)) continue
    seen.add(row.id)
    rows.push(row)
  }
  rows.sort((left, right) => left.name.localeCompare(right.name, 'en'))
  return [UNOBLOX_AUTO_ROW, ...rows]
}

/** Validate rows read back from the cache file; anything off is no cache. */
export function parseCachedCatalog(raw: string): UnobloxModelRow[] | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.models)) return undefined
  const rows = catalogFromListing({
    data: value.models.map((row: unknown) => isRecord(row) ? {
      id: row.id,
      name: row.name,
      context_length: row.contextWindow,
      max_completion_tokens: row.maxTokens,
      input_modalities: Array.isArray(row.input) ? row.input : ['text'],
      output_modalities: ['text'],
      capabilities: { tools: true }
    } : row)
  })
  return rows !== undefined && rows.length > 1 ? rows : undefined
}

export type CatalogSource = 'live' | 'cache' | 'fallback'

export interface ResolvedCatalog {
  readonly rows: readonly UnobloxModelRow[]
  readonly source: CatalogSource
  readonly detail?: string
}

export interface CatalogDependencies {
  readonly cachePath: string
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
}

async function fetchListing(deps: CatalogDependencies): Promise<UnobloxModelRow[]> {
  const response = await deps.fetch(UNOBLOX_MODELS_URL, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const rows = catalogFromListing(await response.json())
  if (rows === undefined || rows.length < 2) throw new Error('listing has no usable models')
  return rows
}

async function writeCache(cachePath: string, rows: readonly UnobloxModelRow[]): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true })
  const temporary = `${cachePath}.${String(process.pid)}.tmp`
  await writeFile(temporary, `${JSON.stringify({ version: 1, fetchedAt: new Date().toISOString(), models: rows.slice(1) })}\n`, 'utf8')
  await rename(temporary, cachePath)
}

async function readCache(cachePath: string): Promise<UnobloxModelRow[] | undefined> {
  try {
    return parseCachedCatalog(await readFile(cachePath, 'utf8'))
  } catch {
    // No cache yet (first launch offline) is the expected case here.
    return undefined
  }
}

/**
 * Start fetching the live catalog. The returned promise always settles with
 * a usable catalog: live (and then cached for the next launch), cached, or
 * Auto alone. It never rejects.
 */
export function refreshUnobloxCatalog(deps: CatalogDependencies): Promise<ResolvedCatalog> {
  return fetchListing(deps).then(
    async (rows) => {
      try {
        await writeCache(deps.cachePath, rows)
      } catch (error) {
        // The live list still serves this launch; only the next offline
        // launch loses it.
        return { rows, source: 'live' as const, detail: `cache not written: ${error instanceof Error ? error.message : String(error)}` }
      }
      return { rows, source: 'live' as const }
    },
    async (error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      const cached = await readCache(deps.cachePath)
      return cached === undefined
        ? { rows: [UNOBLOX_AUTO_ROW], source: 'fallback' as const, detail }
        : { rows: cached, source: 'cache' as const, detail }
    }
  )
}

/**
 * The catalog to launch with: the live one if it arrives within `waitMs`,
 * otherwise the cached one (the live fetch keeps running and refreshes the
 * cache for the next launch), otherwise Auto alone.
 */
export async function catalogForLaunch(
  pending: Promise<ResolvedCatalog>,
  cachePath: string,
  waitMs: number
): Promise<ResolvedCatalog> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), waitMs)
  })
  const settled = await Promise.race([pending, late])
  clearTimeout(timer)
  if (settled !== undefined) return settled
  const cached = await readCache(cachePath)
  return cached === undefined
    ? { rows: [UNOBLOX_AUTO_ROW], source: 'fallback', detail: `listing not ready within ${String(waitMs)} ms` }
    : { rows: cached, source: 'cache', detail: `listing not ready within ${String(waitMs)} ms` }
}

/** The environment entry the patch files read. */
export function catalogEnvironment(catalog: ResolvedCatalog): Record<string, string> {
  return { [UNOBLOX_MODELS_ENV]: JSON.stringify(catalog.rows) }
}
