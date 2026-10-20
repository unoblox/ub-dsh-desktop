import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GraphStore } from '../packages/dsh-desktop-context-graph/store.js'
import { scopeOf, renderSection } from '../packages/dsh-desktop-context-graph/graph.js'
import { decisionLog, importTeamFile, scanFacts, scanId, scanProject, TEAM_FILE, writeTeamFile } from '../packages/dsh-desktop-context-graph/project.js'
import { apply as applyPlugin, CONTEXT_NAME, EXPORT_ROUTE, ITEM_ROUTE } from '../packages/dsh-desktop-context-graph/index.js'

let root = ''
let store
let clock = 1_000
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ctx-project-'))
  clock = 1_000
  store = new GraphStore(':memory:', { now: () => ++clock })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo-app', scripts: { test: 'vitest run', build: 'vite build', typecheck: 'tsc --noEmit', lint: 'eslint .', other: 'x' } }))
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  await writeFile(join(root, 'Makefile'), 'release:\n\tnpm run build\nCC := gcc\nclean:\n\trm -rf out\n')
  await writeFile(join(root, 'README.md'), '# Demo App\n\n![badge](x)\n\nA small app that shows how sign-in works.\n')
  await writeFile(join(root, 'AGENTS.md'), '# rules\n')
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'node_modules'))
  await mkdir(join(root, '.git'))
})
afterEach(async () => {
  store.close()
  await rm(root, { recursive: true, force: true })
})

describe('project scan', () => {
  it('reads how the project is built and tested from its own files', async () => {
    const texts = (await scanFacts(root)).map((fact) => fact.text)
    expect(texts).toContain('JavaScript/TypeScript project "demo-app"; packages are managed with pnpm (pnpm-lock.yaml).')
    expect(texts).toContain('Run the tests: `pnpm test` (runs `vitest run`).')
    expect(texts).toContain('Type-check: `pnpm typecheck` (runs `tsc --noEmit`).')
    expect(texts).toContain('Makefile targets: `make release`, `make clean`.')
    expect(texts).toContain('Project instructions are in AGENTS.md (the agent reads it automatically).')
    expect(texts).toContain('Project "Demo App": A small app that shows how sign-in works.')
    expect(texts).toContain('Top-level folders: src.')
    expect(texts.join('\n')).not.toContain('other')
  })

  it('updates the same items on a re-scan, removes what no longer applies, and respects the user', async () => {
    const scope = scopeOf(root, 's1')
    expect(await scanProject(store, scope)).toMatchObject({ added: 9, updated: 0, removed: 0 })
    expect(await scanProject(store, scope)).toMatchObject({ added: 0, updated: 0, removed: 0 })
    const testId = scanId(scope.workspace, 'node:script:test')
    expect(store.get(testId).files[0]).toMatchObject({ path: 'package.json' })

    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo-app', scripts: { test: 'vitest run --coverage', build: 'vite build' } }))
    expect(await scanProject(store, scope)).toMatchObject({ added: 0, updated: 1, removed: 2 })
    expect(store.get(testId).text).toBe('Run the tests: `pnpm test` (runs `vitest run --coverage`).')

    // The user's correction survives later scans.
    store.put({ ...store.get(testId), workspace: scope.workspace, text: 'Run the tests with `pnpm test -- --run`', origin: 'user' })
    await scanProject(store, scope)
    expect(store.get(testId).text).toBe('Run the tests with `pnpm test -- --run`')

    // A scanned fact the user removed is not scanned back in.
    const buildId = scanId(scope.workspace, 'node:script:build')
    store.remove(buildId, scope.workspace)
    store.setMeta(`scan-dismissed:${buildId}`, '1')
    await scanProject(store, scope)
    expect(store.get(buildId).deletedAt).toBeDefined()
  })

  it('exports the decision log as Markdown', async () => {
    const scope = scopeOf(root, 's1')
    store.put({ workspace: scope.workspace, kind: 'rule', text: 'Lowercase brand', quote: 'unoblox is all small letters', origin: 'user' })
    store.put({ workspace: scope.workspace, kind: 'decision', text: 'Use an OS-picked port', files: [{ path: 'src/config.ts' }], origin: 'model' })
    const log = decisionLog(store, scope, { now: new Date('2026-10-20T00:00:00Z') })
    expect(log).toContain('# Project context')
    expect(log).toContain('## Rules\n\n- “unoblox is all small letters”')
    expect(log).toContain('## Decisions\n\n- Use an OS-picked port (`src/config.ts`)')
  })
})

describe('team file', () => {
  it('shares workspace items through the folder, and keeps a newer local edit', async () => {
    const mine = scopeOf(root, 's1')
    const rule = store.put({ workspace: mine.workspace, kind: 'rule', text: 'Lowercase brand', quote: 'unoblox is all small letters', origin: 'user', pinned: true })
    const decision = store.put({ workspace: mine.workspace, kind: 'decision', text: 'Use an OS-picked port', files: [{ path: 'package.json' }], links: [{ id: rule, rel: 'relates-to' }], origin: 'model' })
    store.put({ workspace: mine.workspace, sessionId: 's1', kind: 'goal', text: 'My private goal', origin: 'model' })
    await scanProject(store, mine)
    expect(await writeTeamFile(store, mine)).toEqual({ path: TEAM_FILE, count: 2 })
    const file = JSON.parse(await readFile(join(root, TEAM_FILE), 'utf8'))
    // Goals, tasks and scanned facts stay out: scans are redone on each machine.
    expect(file.items.map((item) => item.kind).sort()).toEqual(['decision', 'rule'])
    // Writing it does not re-import it here.
    expect(await importTeamFile(store, mine)).toBeUndefined()

    // A teammate opens the same folder (their own store).
    let theirClock = 50_000
    const theirs = new GraphStore(':memory:', { now: () => ++theirClock })
    try {
      const scope = scopeOf(root, 'their-session')
      expect(await importTeamFile(theirs, scope)).toEqual({ imported: 2 })
      expect(theirs.get(rule)).toMatchObject({ quote: 'unoblox is all small letters', pinned: true, origin: 'team' })
      expect(theirs.get(decision).links).toEqual([{ id: rule, rel: 'relates-to' }])
      expect(theirs.get(decision).files[0].hash).toBeDefined()
      expect(await renderSection(theirs, scope)).toContain('"unoblox is all small letters"')
      // Unchanged file: not imported again.
      expect(await importTeamFile(theirs, scope)).toBeUndefined()

      // They edit the decision; an older version in a new file does not overwrite it.
      theirs.put({ ...theirs.get(decision), workspace: scope.workspace, text: 'Use port 0 (OS-picked)', origin: 'user' })
      store.put({ ...store.get(rule), workspace: mine.workspace, text: 'Brand is lowercase everywhere', origin: 'user' })
      await writeTeamFile(store, mine)
      expect(await importTeamFile(theirs, scope)).toEqual({ imported: 1 })
      expect(theirs.get(decision).text).toBe('Use port 0 (OS-picked)')
      expect(theirs.get(rule).text).toBe('Brand is lowercase everywhere')
    } finally {
      theirs.close()
    }
  })

  it('ignores a malformed or hostile team file', async () => {
    await mkdir(join(root, '.unoblox'))
    await writeFile(join(root, TEAM_FILE), JSON.stringify({ version: 1, items: [
      { id: 'not-an-id', kind: 'rule', text: 'x' },
      { id: 'g-00000001', kind: 'goal', text: 'goals are per conversation' },
      { id: 'f-00000002', kind: 'fact', text: 'outside paths are dropped', files: ['../../etc/passwd', 'package.json'] }
    ] }))
    const scope = scopeOf(root, 's1')
    expect(await importTeamFile(store, scope)).toEqual({ imported: 1 })
    expect(store.get('f-00000002').files.map((file) => file.path)).toEqual(['package.json'])
    await writeFile(join(root, TEAM_FILE), '{not json')
    expect(await importTeamFile(store, scope)).toEqual({ imported: 0 })
  })
})

describe('plugin', () => {
  it('scans on the first request in a workspace, and serves export and share', async () => {
    const listeners = new Map()
    const routes = new Map()
    const session = { header: { id: 's1', cwd: root } }
    const ctx = {
      on: (name, listener) => listeners.set(name, [...(listeners.get(name) ?? []), listener]),
      effect: (setup) => setup(),
      logger: { info: () => {}, warn: () => {} },
      sessions: { get: (id) => id === 's1' ? session : undefined },
      systemPrompt: { context: () => () => {} },
      tools: { register: () => {} },
      connection: { fetch: { register: (route) => routes.set(`${route.methods[0]} ${route.path}`, route.fetch) } }
    }
    applyPlugin(ctx, { root: '' }, { store })
    const assemble = listeners.get('system-prompt/assemble')[0]
    const result = await assemble({ contexts: [{ name: CONTEXT_NAME, text: '' }] }, { agent: { session } }, async () => ({ contexts: [{ name: CONTEXT_NAME, text: '' }] }))
    expect(result.contexts[0].text).toContain('Run the tests: `pnpm test`')

    const exported = await routes.get(`GET ${EXPORT_ROUTE}`)(new Request(`http://127.0.0.1${EXPORT_ROUTE}?session=s1`))
    expect(exported.headers.get('content-type')).toContain('text/markdown')
    expect(await exported.text()).toContain('## Facts')

    const shared = await routes.get(`POST ${ITEM_ROUTE}`)(new Request(`http://127.0.0.1${ITEM_ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: 's1', action: 'share' }) }))
    expect(await shared.json()).toEqual({ ok: true, path: TEAM_FILE, count: 0 })
  })
})
