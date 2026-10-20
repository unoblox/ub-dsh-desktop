/**
 * Project memory around the context graph:
 *
 * - scanProject: when a workspace is opened, record how the project is built
 *   and tested, read from its own files (package.json, lockfiles, Makefile,
 *   pyproject, Cargo.toml, go.mod, README, top-level folders). No model call.
 *   The facts carry file fingerprints and stable ids, so a later scan updates
 *   them in place instead of piling up, and an edited file flags them.
 * - decisionLog: the graph as Markdown, for a PR description or onboarding.
 * - team file: `.unoblox/context.json` in the workspace, written only when
 *   the user asks, read back by everyone who opens the folder: sharing goes
 *   through the project's own version control, not a server.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fingerprint, workspacePath } from './freshness.js'
import { KINDS, MAX_TEXT, RELATIONS, SESSION_KINDS } from './store.js'

export const TEAM_FILE = '.unoblox/context.json'
const TEAM_VERSION = 1
const MAX_TEAM_ITEMS = 2000
const MAX_READ = 512 * 1024

/** A stable id for a scanned fact, so each scan updates the same item. */
export function scanId(workspace, key) {
  return `f-${createHash('sha256').update(`${workspace}\0scan\0${key}`).digest('hex').slice(0, 8)}`
}

async function readSmall(root, path) {
  try {
    const text = await readFile(join(root, path), 'utf8')
    return text.length > MAX_READ ? text.slice(0, MAX_READ) : text
  } catch {
    return undefined
  }
}

async function exists(root, path) {
  return (await readSmall(root, path)) !== undefined
}

function json(text) {
  try {
    const value = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

const SCRIPT_ROLES = [
  ['test', 'Run the tests'],
  ['typecheck', 'Type-check'],
  ['lint', 'Lint'],
  ['build', 'Build'],
  ['dev', 'Start the development build'],
  ['start', 'Start the app']
]

/**
 * What the project's own files say about building and testing it, as
 * `{ key, text, files }` facts. Pure reading; nothing is run.
 */
export async function scanFacts(root) {
  const facts = []
  const pkgText = await readSmall(root, 'package.json')
  const pkg = pkgText === undefined ? undefined : json(pkgText)
  if (pkg !== undefined) {
    const manager = await exists(root, 'pnpm-lock.yaml') ? 'pnpm' : await exists(root, 'yarn.lock') ? 'yarn' : await exists(root, 'bun.lockb') || await exists(root, 'bun.lock') ? 'bun' : 'npm'
    const lock = { pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock', bun: 'bun.lock', npm: 'package-lock.json' }[manager]
    facts.push({ key: 'node:manager', text: `JavaScript/TypeScript project${typeof pkg.name === 'string' ? ` "${pkg.name.slice(0, 80)}"` : ''}; packages are managed with ${manager}${await exists(root, lock) ? ` (${lock})` : ''}.`, files: ['package.json'] })
    const scripts = typeof pkg.scripts === 'object' && pkg.scripts !== null ? pkg.scripts : {}
    const run = (name) => manager === 'npm' ? (name === 'test' || name === 'start' ? `npm ${name}` : `npm run ${name}`) : `${manager} ${name}`
    for (const [name, role] of SCRIPT_ROLES) {
      if (typeof scripts[name] !== 'string') continue
      facts.push({ key: `node:script:${name}`, text: `${role}: \`${run(name)}\` (runs \`${scripts[name].slice(0, 120)}\`).`, files: ['package.json'], symbols: [name] })
    }
  }
  const pyproject = await readSmall(root, 'pyproject.toml')
  if (pyproject !== undefined || await exists(root, 'requirements.txt') || await exists(root, 'setup.py')) {
    const pytest = (pyproject?.includes('[tool.pytest') ?? false) || await exists(root, 'pytest.ini') || await exists(root, 'conftest.py')
    facts.push({ key: 'python', text: `Python project${pytest ? '; tests run with `pytest`' : ''}.`, files: [pyproject !== undefined ? 'pyproject.toml' : await exists(root, 'requirements.txt') ? 'requirements.txt' : 'setup.py'] })
  }
  if (await exists(root, 'Cargo.toml')) facts.push({ key: 'rust', text: 'Rust project: build with `cargo build`, test with `cargo test`.', files: ['Cargo.toml'] })
  if (await exists(root, 'go.mod')) facts.push({ key: 'go', text: 'Go module: build with `go build ./...`, test with `go test ./...`.', files: ['go.mod'] })
  const makefile = await readSmall(root, 'Makefile')
  if (makefile !== undefined) {
    const targets = [...new Set([...makefile.matchAll(/^([A-Za-z][\w-]*):(?!=)/gmu)].map((match) => match[1]))].slice(0, 12)
    if (targets.length > 0) facts.push({ key: 'make', text: `Makefile targets: ${targets.map((target) => `\`make ${target}\``).join(', ')}.`, files: ['Makefile'] })
  }
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    if (await exists(root, name)) facts.push({ key: `instructions:${name}`, text: `Project instructions are in ${name} (the agent reads it automatically).`, files: [name] })
  }
  const readmeName = (await exists(root, 'README.md')) ? 'README.md' : (await exists(root, 'readme.md')) ? 'readme.md' : undefined
  if (readmeName !== undefined) {
    const readme = await readSmall(root, readmeName)
    const title = /^#\s+(.+)$/mu.exec(readme)?.[1]?.trim()
    const first = readme.split(/\n\s*\n/u).map((part) => part.trim()).find((part) => part !== '' && !part.startsWith('#') && !part.startsWith('<') && !part.startsWith('[!') && !part.startsWith('!['))
    if (title !== undefined || first !== undefined) {
      facts.push({ key: 'readme', text: `${title === undefined ? 'Project' : `Project "${title.slice(0, 100)}"`}${first === undefined ? '' : `: ${first.replace(/\s+/gu, ' ').slice(0, 300)}`}`, files: [readmeName] })
    }
  }
  try {
    const entries = await readdir(root, { withFileTypes: true })
    const folders = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', 'dist', 'build', 'out', 'target', '__pycache__', 'venv'].includes(entry.name)).map((entry) => entry.name).sort().slice(0, 15)
    if (folders.length > 0) facts.push({ key: 'layout', text: `Top-level folders: ${folders.join(', ')}.` })
  } catch {
    // An unreadable folder has no layout to record.
  }
  return facts.map((fact) => ({ ...fact, text: fact.text.slice(0, MAX_TEXT) }))
}

/**
 * Record the scan in the graph. Items the user edited are left alone;
 * scanned facts that no longer apply (a script removed) are removed.
 * @returns {{ added: number, updated: number, removed: number }}
 */
export async function scanProject(store, scope) {
  const facts = await scanFacts(scope.root)
  const stats = { added: 0, updated: 0, removed: 0 }
  const prints = new Map()
  for (const fact of facts) {
    for (const path of fact.files ?? []) {
      if (!prints.has(path)) {
        const print = await fingerprint(scope.root, path)
        prints.set(path, print.missing ? { path } : print)
      }
    }
  }
  store.transaction(() => {
    const ids = new Set()
    for (const fact of facts) {
      const id = scanId(scope.workspace, fact.key)
      ids.add(id)
      const existing = store.get(id)
      if (existing?.origin === 'user' && existing.deletedAt === undefined) continue
      // A scanned fact the user removed stays removed.
      if (existing?.deletedAt !== undefined && store.getMeta(`scan-dismissed:${id}`) === '1') continue
      if (existing !== undefined && existing.deletedAt === undefined && existing.text === fact.text) {
        store.put({ ...existing, workspace: scope.workspace, files: (fact.files ?? []).map((path) => prints.get(path)), origin: 'scan' })
        continue
      }
      store.put({ id, workspace: scope.workspace, kind: 'fact', text: fact.text, files: (fact.files ?? []).map((path) => prints.get(path)), symbols: fact.symbols ?? [], origin: 'scan' })
      if (existing === undefined || existing.deletedAt !== undefined) stats.added++
      else stats.updated++
    }
    for (const item of store.live(scope.workspace, undefined, { kinds: ['fact'] })) {
      if (item.origin === 'scan' && !ids.has(item.id) && store.remove(item.id, scope.workspace)) stats.removed++
    }
    store.setMeta(`scanned:${scope.workspace}`, String(Date.now()))
  })
  return stats
}

const KIND_TITLES = { rule: 'Rules', goal: 'Goals', decision: 'Decisions', task: 'Open tasks', error: 'Errors and fixes', fact: 'Facts' }

/** The workspace's graph as Markdown: a decision log for PRs and onboarding. */
export function decisionLog(store, scope, { now = new Date() } = {}) {
  const items = store.live(scope.workspace, scope.sessionId).filter((item) => !(item.kind === 'task' && item.status === 'done'))
  const lines = [`# Project context`, '', `Exported from unoblox works on ${now.toISOString().slice(0, 10)}. Workspace: \`${scope.root}\`.`]
  for (const kind of ['rule', 'decision', 'goal', 'task', 'error', 'fact']) {
    const group = items.filter((item) => item.kind === kind).sort((a, b) => a.createdAt - b.createdAt)
    if (group.length === 0) continue
    lines.push('', `## ${KIND_TITLES[kind]}`, '')
    for (const item of group) {
      const body = item.quote === undefined ? item.text : `“${item.quote}”`
      const files = item.files.length === 0 ? '' : ` (${item.files.map((file) => `\`${file.path}\``).join(', ')})`
      lines.push(`- ${body}${files} — ${new Date(item.updatedAt).toISOString().slice(0, 10)}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** Write the workspace-shared items to `.unoblox/context.json`. */
export async function writeTeamFile(store, scope) {
  const items = store.live(scope.workspace, undefined)
    .filter((item) => !SESSION_KINDS.has(item.kind) && item.origin !== 'scan')
    .slice(0, MAX_TEAM_ITEMS)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      text: item.text,
      ...(item.quote === undefined ? {} : { quote: item.quote }),
      pinned: item.pinned,
      files: item.files.map((file) => file.path),
      symbols: item.symbols,
      links: store.outgoing(item.id).filter((link) => RELATIONS.includes(link.rel)),
      updatedAt: item.updatedAt
    }))
  const body = `${JSON.stringify({ version: TEAM_VERSION, items }, null, 2)}\n`
  const target = join(scope.root, TEAM_FILE)
  await mkdir(join(scope.root, '.unoblox'), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, body, 'utf8')
  await rename(temporary, target)
  store.setMeta(`team-imported:${scope.workspace}`, createHash('sha256').update(body).digest('hex'))
  return { path: TEAM_FILE, count: items.length }
}

const ID = /^[a-z]-[0-9a-f]{8}$/u

/**
 * Bring in teammates' items from `.unoblox/context.json` when the file
 * changed since the last import. An item edited here after the file's
 * version of it is kept.
 * @returns {{ imported: number } | undefined} undefined when there is no new file.
 */
export async function importTeamFile(store, scope) {
  const raw = await readSmall(scope.root, TEAM_FILE)
  if (raw === undefined) return undefined
  const hash = createHash('sha256').update(raw).digest('hex')
  if (store.getMeta(`team-imported:${scope.workspace}`) === hash) return undefined
  const body = json(raw)
  if (body === undefined || body.version !== TEAM_VERSION || !Array.isArray(body.items)) return { imported: 0 }
  const prepared = []
  for (const entry of body.items.slice(0, MAX_TEAM_ITEMS)) {
    if (typeof entry !== 'object' || entry === null || !ID.test(entry.id) || !KINDS.includes(entry.kind) || SESSION_KINDS.has(entry.kind) || typeof entry.text !== 'string' || entry.text.trim() === '') continue
    const files = []
    for (const path of Array.isArray(entry.files) ? entry.files.slice(0, 8) : []) {
      const relative = workspacePath(scope.root, path)
      if (relative === undefined) continue
      const print = await fingerprint(scope.root, relative)
      files.push(print.missing ? { path: relative } : print)
    }
    prepared.push({ entry, files })
  }
  let imported = 0
  store.transaction(() => {
    for (const { entry, files } of prepared) {
      const existing = store.get(entry.id)
      if (existing !== undefined && existing.workspace !== scope.workspace) continue
      if (existing !== undefined && existing.origin === 'user' && existing.updatedAt > (Number(entry.updatedAt) || 0)) continue
      store.put({
        id: entry.id,
        workspace: scope.workspace,
        kind: entry.kind,
        text: entry.text.slice(0, MAX_TEXT),
        ...(typeof entry.quote === 'string' ? { quote: entry.quote.slice(0, MAX_TEXT) } : {}),
        pinned: entry.pinned === true,
        files,
        symbols: Array.isArray(entry.symbols) ? entry.symbols.filter((symbol) => typeof symbol === 'string').slice(0, 8) : [],
        origin: 'team'
      })
      imported++
    }
    for (const { entry } of prepared) {
      for (const link of Array.isArray(entry.links) ? entry.links : []) {
        if (ID.test(link?.id) && RELATIONS.includes(link.rel) && store.get(link.id)?.workspace === scope.workspace) store.link(entry.id, link.id, link.rel)
      }
    }
    store.setMeta(`team-imported:${scope.workspace}`, hash)
  })
  return { imported }
}
