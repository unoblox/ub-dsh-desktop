import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { disableSpellcheckDownloads, noAutomaticRegistryLookup } from '../src/main/network-privacy'
import { buildHarnessSpawnOptions } from '../src/main/runtime/harness-runtime'
import { projectRoot } from './patch-path'
// @ts-expect-error Local host plugins are authored as ESM JavaScript.
import { createCatalogReader } from '../packages/dsh-desktop-workbenches/catalog.mjs'

type Entry = ReturnType<typeof composeEntries>[number]

function compose(desktopPatch: string): Entry[] {
  const layers = [
    loadOverlayPatches('dsh', path.join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml')),
    loadOverlayPatches('dsh', path.join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'cordis.patch.yml')),
    loadOverlayPatches('dsh', path.join(projectRoot, 'build', desktopPatch))
  ]
  return composeEntries(layers, () => {})
}

// Rows that send data off the machine to anyone but Unoblox (see the privacy
// block in build/dsh-desktop.patch.yml).
const SILENCED = [
  'session-telemetry-otel', 'otel', 'product-analytics', 'desktop-product-telemetry',
  'deepseek-account', 'account-controller', 'deepseek-llm-api-extensions',
  'session-log-deepseek', 'plugin-package-inventory-deepseek',
  'message-feedback', 'ui-message-feedback', 'command-feedback'
]

describe.each(['dsh-desktop.patch.yml', 'dsh-desktop-safe.patch.yml'])('no telemetry or analytics in %s', (patch) => {
  it('disables every row that would send data to DeepSeek', () => {
    const entries = compose(patch)
    for (const id of SILENCED) {
      const entry = entries.find((candidate) => candidate.id === id)
      expect(entry, id).toBeDefined()
      expect(entry!.disabled, id).toBe(true)
    }
  })

  it('stops the plugin manager pinging npm registries', () => {
    const entry = compose(patch).find((candidate) => candidate.id === 'ui-plugin-manager')
    expect(entry?.config).toEqual({ registryProbeEnabled: false })
  })
})

describe('Harness launch environment', () => {
  it('opts the Harness process out of session telemetry', () => {
    const options = buildHarnessSpawnOptions('/tmp/launch', '/tmp/home', 'linux', { PATH: '/usr/bin' })
    expect(options.env?.DSH_TELEMETRY_DISABLED).toBe('1')
  })
})

describe('main-process network guards', () => {
  it('keeps spellchecking only where it needs no download (macOS)', () => {
    for (const platform of ['linux', 'win32'] as const) {
      const session = { setSpellCheckerEnabled: vi.fn(), setSpellCheckerLanguages: vi.fn() }
      disableSpellcheckDownloads(session, platform)
      // Disabling alone still downloads the dictionary; the empty list stops it.
      expect(session.setSpellCheckerLanguages).toHaveBeenCalledWith([])
      expect(session.setSpellCheckerEnabled).toHaveBeenCalledWith(false)
    }
    const mac = { setSpellCheckerEnabled: vi.fn(), setSpellCheckerLanguages: vi.fn() }
    disableSpellcheckDownloads(mac, 'darwin')
    expect(mac.setSpellCheckerLanguages).not.toHaveBeenCalled()
    expect(mac.setSpellCheckerEnabled).not.toHaveBeenCalled()
  })

  it('never looks up plugin versions online during recovery', async () => {
    await expect(noAutomaticRegistryLookup()).rejects.toThrow('does not look up plugin versions online')
  })
})

describe('workbench market catalog without silent fetches', () => {
  const homes: string[] = []
  afterEach(async () => { await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))) })
  const catalog = () => ({ schemaVersion: 2, kind: 'catalog', categories: [], workbenches: [] })

  it('serves an empty offline catalog at startup and fetches only when forced', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'wb-catalog-'))
    homes.push(home)
    const cachePath = path.join(home, 'market-catalog.json')
    const fetch = vi.fn(async () => Response.json(catalog()))
    const read = createCatalogReader({ fetch, cachePath, fetchOnlyWhenForced: true })
    await expect(read()).resolves.toMatchObject({ offline: true, stale: true, catalog: { workbenches: [] } })
    expect(fetch).not.toHaveBeenCalled()
    await expect(read({ force: true })).resolves.toMatchObject({ stale: false })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toMatchObject({ kind: 'catalog' })
    // The next launch serves the saved copy without touching the network.
    const nextLaunchFetch = vi.fn()
    const nextLaunch = createCatalogReader({ fetch: nextLaunchFetch, cachePath, fetchOnlyWhenForced: true })
    await expect(nextLaunch()).resolves.toMatchObject({ catalog: { kind: 'catalog' } })
    expect(nextLaunchFetch).not.toHaveBeenCalled()
  })
})
