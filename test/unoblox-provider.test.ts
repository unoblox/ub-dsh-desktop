import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { patchPath, projectRoot } from './patch-path'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

type PatchRow = Parameters<typeof composeEntries>[0][number][number]
type Entry = ReturnType<typeof composeEntries>[number]

const UNOBLOX_ROUTE = {
  displayName: 'Unoblox',
  apiKeyEnv: 'UNOBLOX_API_KEY',
  api: 'openai-completions',
  baseURL: 'https://api.unoblox.ai/v1'
}
const AUTO_ONLY = [{ id: 'unoblox/auto', name: 'Unoblox Auto · best value' }]

/** Evaluate a `!!js` node the way cordis-plugin-loader does, against a given environment. */
function evaluateJs(node: unknown, env: Record<string, string | undefined>): unknown {
  const expr = (node as { __jsExpr?: unknown }).__jsExpr
  if (typeof expr !== 'string') throw new Error('expected a !!js expression')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- mirrors the loader's own evaluation
  return new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')({ process: { env } }, expr)
}

// A profile that had configured other providers and picked one as the default,
// as an existing install's Models page would have written it.
const USER_PROFILE_LAYER: PatchRow[] = [
  {
    id: 'llm-pi-ai',
    config: {
      providers: {
        openai: { apiKeyEnv: 'OPENAI_API_KEY' },
        'acme-gateway': {
          apiKeyEnv: 'ACME_GATEWAY_API_KEY',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [{ id: 'acme-think' }]
        }
      }
    }
  },
  { id: 'agent-default-model', config: { provider: 'openai', model: 'gpt-5' } }
]

const DESKTOP_PATCHES = ['dsh-desktop.patch.yml', 'dsh-desktop-safe.patch.yml'] as const

function compose(desktopPatch: string): { entries: Entry[]; warnings: string[] } {
  const bundle = loadOverlayPatches(
    'dsh',
    path.join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml')
  )
  const overlay = loadOverlayPatches('dsh', path.join(projectRoot, 'build', desktopPatch))
  const warnings: string[] = []
  const entries = composeEntries([bundle, USER_PROFILE_LAYER, overlay], (message: string) => {
    warnings.push(message)
  })
  return { entries, warnings }
}

function entry(entries: Entry[], id: string): Entry {
  const found = entries.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`composition has no ${id} entry`)
  return found
}

describe.each(DESKTOP_PATCHES)('Unoblox provider lock in %s', (desktopPatch) => {
  it('leaves Unoblox as the only llm-pi-ai route, hiding routes the profile declared', () => {
    const { entries } = compose(desktopPatch)
    const config = entry(entries, 'llm-pi-ai').config as { providers: Record<string, Record<string, unknown>> }
    expect(Object.keys(config.providers)).toEqual(['unoblox'])
    const { models, ...route } = config.providers.unoblox!
    expect(route).toEqual(UNOBLOX_ROUTE)
    // The catalog comes from the launch environment; Auto alone without it.
    expect(evaluateJs(models, {})).toEqual(AUTO_ONLY)
    expect(evaluateJs(models, { DSH_DESKTOP_UNOBLOX_MODELS: '{not json' })).toEqual(AUTO_ONLY)
    expect(evaluateJs(models, { DSH_DESKTOP_UNOBLOX_MODELS: '[]' })).toEqual(AUTO_ONLY)
    const live = [...AUTO_ONLY, { id: 'google/gemma-4-31b-it', name: 'Gemma 4 31B', contextWindow: 262144, input: ['text'] }]
    expect(evaluateJs(models, { DSH_DESKTOP_UNOBLOX_MODELS: JSON.stringify(live) })).toEqual(live)
  })

  it('disables the DeepSeek API-key and account adapters', () => {
    const { entries } = compose(desktopPatch)
    expect(entry(entries, 'llm-deepseek').disabled).toBe(true)
    expect(entry(entries, 'llm-deepseek-account').disabled).toBe(true)
  })

  it('starts new agents on Unoblox even when the profile chose another provider', () => {
    const { entries } = compose(desktopPatch)
    expect(entry(entries, 'agent-default-model').config).toEqual({ provider: 'unoblox', model: 'unoblox/auto' })
  })

  it('never routes web search to DeepSeek', () => {
    const { entries } = compose(desktopPatch)
    expect(entry(entries, 'web-search-deepseek').disabled).toBe(true)
  })

  it('targets only rows the base bundle defines', () => {
    // Other overlay rows target UI bundles this composition does not load.
    const ids = ['llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account', 'agent-default-model', 'web-search-deepseek', 'web', 'tool-web']
    const { warnings } = compose(desktopPatch)
    expect(warnings.filter((warning) => ids.some((id) => warning.includes(JSON.stringify(id))))).toEqual([])
  })

  it('keeps the API key out of configuration', async () => {
    const text = await readFile(path.join(projectRoot, 'build', desktopPatch), 'utf8')
    expect(text).not.toMatch(/ub-gw-/u)
  })
})

describe('Unoblox web search wiring', () => {
  it('searches through Unoblox in the normal profile', () => {
    const { entries } = compose('dsh-desktop.patch.yml')
    expect(entry(entries, 'dsh-desktop-unoblox-search').name).toBe('dsh-desktop-unoblox-search')
    expect(entry(entries, 'web').config).toEqual({ searchProvider: 'unoblox', fetchProvider: 'http' })
    expect(entry(entries, 'tool-web').config).toEqual({ search: true, fetch: true, searchTimeoutMs: 30000 })
  })

  it('keeps search off in Safe Mode, which must not load optional product plugins', () => {
    const { entries } = compose('dsh-desktop-safe.patch.yml')
    expect(entries.some((candidate) => candidate.id === 'dsh-desktop-unoblox-search')).toBe(false)
    expect(entry(entries, 'web').config).toEqual({ fetchProvider: 'http' })
    expect(entry(entries, 'tool-web').config).toEqual({ search: false, fetch: true })
  })
})

describe('Unoblox-only Models settings', () => {
  it('does not offer adding another provider', async () => {
    const [patch, installed] = await Promise.all([
      readFile(patchPath('@deepseek-ai/dsh-client-ui-settings-models'), 'utf8'),
      readFile(
        path.join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-models', 'lib', 'client.js'),
        'utf8'
      )
    ])
    const guard = '}) : !DESKTOP_PROVIDER_SET_LOCKED && (catalogOffered || customOffered) ? '
    expect(patch).toContain('+\t\tconst DESKTOP_PROVIDER_SET_LOCKED = true;')
    expect(installed).toContain(guard)
  })
})
