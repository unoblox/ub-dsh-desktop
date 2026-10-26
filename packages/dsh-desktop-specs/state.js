/**
 * Where specs live and what has been approved.
 *
 * A spec is a folder in the user's project, `specs/<slug>/`, holding the
 * three documents (parse.js) and `spec.json`, the app's record of it: which
 * documents the user approved (with the SHA-256 of the exact text approved),
 * which one waits for approval, and a log of changes made after approval.
 * It is versioned with the code, so a team shares it.
 *
 * Which spec a conversation works on is per computer, kept in the app's data
 * folder (`sessions.json`), not in the project.
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DOC_FILES, DOCS, slugify } from './parse.js'

export const SPECS_DIR = 'specs'
export const STATE_FILE = 'spec.json'
export const TRACE_FILE = 'trace.json'
export const PHASES = ['requirements', 'design', 'tasks', 'build']
const MAX_CHANGES = 200
const MAX_SESSIONS = 500
const MAX_TASK_FILES = 50

export function sha256(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex')
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, text, 'utf8')
  await rename(temporary, path)
}

/** One write at a time per file, in order. */
function createQueue() {
  const tails = new Map()
  return (key, task) => {
    const run = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(task)
    tails.set(key, run)
    return run
  }
}

export function specDir(root, slug) {
  return join(root, SPECS_DIR, slug)
}

/** The project-relative path of one of a spec's files. */
export function specPath(slug, file) {
  return `${SPECS_DIR}/${slug}/${file}`
}

function emptyState(slug, title, now) {
  return { version: 1, slug, title, createdAt: now, approvals: {}, awaiting: null, changes: [], taskFiles: {} }
}

function readState(value, slug) {
  if (!isRecord(value) || value.version !== 1) return undefined
  const approvals = {}
  for (const doc of DOCS) {
    const entry = value.approvals?.[doc]
    if (isRecord(entry) && typeof entry.sha256 === 'string' && typeof entry.at === 'number') {
      approvals[doc] = {
        at: entry.at,
        sha256: entry.sha256,
        ...(typeof entry.base === 'string' ? { base: entry.base } : {}),
        ...(typeof entry.changedAt === 'number' ? { changedAt: entry.changedAt } : {})
      }
    }
  }
  const awaiting = isRecord(value.awaiting) && DOCS.includes(value.awaiting.doc) && typeof value.awaiting.sha256 === 'string' ? { doc: value.awaiting.doc, sha256: value.awaiting.sha256, at: Number(value.awaiting.at) || 0 } : null
  const changes = Array.isArray(value.changes) ? value.changes.filter((c) => isRecord(c) && DOCS.includes(c.doc) && typeof c.summary === 'string').slice(-MAX_CHANGES) : []
  const taskFiles = {}
  for (const [task, files] of Object.entries(isRecord(value.taskFiles) ? value.taskFiles : {})) {
    if (/^T-\d+$/u.test(task) && Array.isArray(files)) taskFiles[task] = files.filter((file) => typeof file === 'string').slice(0, MAX_TASK_FILES)
  }
  return { version: 1, slug, title: typeof value.title === 'string' ? value.title : slug, createdAt: Number(value.createdAt) || 0, approvals, awaiting, changes, taskFiles }
}

/**
 * The phase a spec is in: the first document not approved, else build.
 * A document edited after approval stays approved; the change is logged and
 * shown (the drift policy fixes whichever side is wrong).
 */
export function phaseOf(state) {
  for (const doc of DOCS) if (state.approvals[doc] === undefined) return doc
  return 'build'
}

export function createSpecStore({ now = Date.now } = {}) {
  const queue = createQueue()

  const readDocs = async (root, slug) => {
    const texts = {}
    for (const doc of DOCS) {
      try {
        texts[doc] = await readFile(join(specDir(root, slug), DOC_FILES[doc]), 'utf8')
      } catch {
        texts[doc] = ''
      }
    }
    return texts
  }

  const load = async (root, slug) => {
    let raw
    try {
      raw = JSON.parse(await readFile(join(specDir(root, slug), STATE_FILE), 'utf8'))
    } catch {
      return undefined
    }
    return readState(raw, slug)
  }

  const save = (root, state) => writeAtomic(join(specDir(root, state.slug), STATE_FILE), `${JSON.stringify(state, null, 2)}\n`)

  /** Change a spec's state under the per-spec queue. */
  const update = (root, slug, change) => queue(join(root, slug), async () => {
    const state = await load(root, slug)
    if (state === undefined) throw new Error(`no spec "${slug}" in ${SPECS_DIR}/`)
    const next = await change(state)
    await save(root, next ?? state)
    return next ?? state
  })

  return {
    readDocs,
    load,

    /** Specs in a project, newest first. */
    async list(root) {
      let names = []
      try {
        names = (await readdir(join(root, SPECS_DIR), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      } catch {
        return []
      }
      const specs = []
      for (const name of names) {
        const state = await load(root, name)
        if (state !== undefined) specs.push(state)
      }
      return specs.sort((a, b) => b.createdAt - a.createdAt)
    },

    /**
     * Create `specs/<slug>/` with a fresh state. The documents are left for
     * the agent to create (the Harness only lets it overwrite files it has
     * read, so pre-filled templates would cost a read each). An existing spec
     * of that name is opened instead, never overwritten.
     */
    create: (root, title) => {
      const slug = slugify(title)
      return queue(join(root, slug), async () => {
        const existing = await load(root, slug)
        if (existing !== undefined) return { state: existing, created: false }
        await mkdir(specDir(root, slug), { recursive: true })
        const state = emptyState(slug, title, now())
        await save(root, state)
        return { state, created: true }
      })
    },

    /** Mark a document as waiting for the user's approval of this exact text. */
    submit: (root, slug, doc, text) => update(root, slug, (state) => ({ ...state, awaiting: { doc, sha256: sha256(text), at: now() } })),

    /**
     * Approve a submitted document, only if its text is what was submitted
     * and what the user saw (`seen` is the SHA-256 the panel showed).
     * Earlier documents must be approved first.
     */
    approve: (root, slug, doc, seen) => update(root, slug, async (state) => {
      const texts = await readDocs(root, slug)
      const current = sha256(texts[doc])
      if (state.awaiting?.doc !== doc) throw new ConflictError(`${DOC_FILES[doc]} has not been submitted for approval`)
      if (seen !== current || seen !== state.awaiting.sha256) throw new ConflictError(`${DOC_FILES[doc]} changed since it was submitted or shown; review it again`)
      const before = DOCS.slice(0, DOCS.indexOf(doc)).find((d) => state.approvals[d] === undefined)
      if (before !== undefined) throw new ConflictError(`approve ${DOC_FILES[before]} first`)
      return { ...state, approvals: { ...state.approvals, [doc]: { at: now(), sha256: current } }, awaiting: state.awaiting?.doc === doc ? null : state.awaiting }
    }),

    /** The user asked for changes: nothing waits for approval any more. */
    reopen: (root, slug, doc) => update(root, slug, (state) => ({ ...state, awaiting: state.awaiting?.doc === doc ? null : state.awaiting })),

    /** Log a change to an approved document and approve the new text in its place. */
    recordChange: (root, slug, doc, text, summary, by) => update(root, slug, (state) => {
      const approval = state.approvals[doc]
      if (approval === undefined) return state
      const hash = sha256(text)
      if (hash === approval.sha256) return state
      const change = { at: now(), doc, summary, by, from: approval.sha256.slice(0, 12), to: hash.slice(0, 12) }
      return { ...state, approvals: { ...state.approvals, [doc]: { at: approval.at, sha256: hash, changedAt: change.at } }, changes: [...state.changes, change].slice(-MAX_CHANGES) }
    }),

    /**
     * Follow an approved document whose only change is ticked task boxes: no
     * change entry; `base` keeps pointing at the text the user approved.
     */
    followTicks: (root, slug, doc, text) => update(root, slug, (state) => {
      const approval = state.approvals[doc]
      if (approval === undefined) return state
      return { ...state, approvals: { ...state.approvals, [doc]: { ...approval, sha256: sha256(text), base: approval.base ?? approval.sha256 } } }
    }),

    /** Record the files changed for tasks just ticked done. */
    linkFiles: (root, slug, taskIds, files) => update(root, slug, (state) => {
      if (taskIds.length === 0 || files.length === 0) return state
      const taskFiles = { ...state.taskFiles }
      for (const task of taskIds) taskFiles[task] = [...new Set([...(taskFiles[task] ?? []), ...files])].slice(0, MAX_TASK_FILES)
      return { ...state, taskFiles }
    }),

    writeTrace: (root, slug, trace) => queue(join(root, slug, TRACE_FILE), () => writeAtomic(join(specDir(root, slug), TRACE_FILE), `${JSON.stringify(trace, null, 2)}\n`))
  }
}

export class ConflictError extends Error {}

/** Which spec each conversation works on, in the app's data folder. */
export function createSessionMap(path) {
  let map
  let loading
  let writing = Promise.resolve()
  const load = () => {
    loading ??= (async () => {
      map = new Map()
      if (path === undefined) return
      try {
        const value = JSON.parse(await readFile(path, 'utf8'))
        for (const [sessionId, entry] of Object.entries(value?.sessions ?? {})) {
          if (isRecord(entry) && typeof entry.root === 'string' && typeof entry.slug === 'string') map.set(sessionId, { root: entry.root, slug: entry.slug })
        }
      } catch {
        // No file yet: no active specs.
      }
    })()
    return loading
  }
  return {
    async get(sessionId) {
      await load()
      return map.get(sessionId)
    },
    async set(sessionId, entry) {
      await load()
      map.delete(sessionId)
      if (entry !== null) map.set(sessionId, entry)
      while (map.size > MAX_SESSIONS) map.delete(map.keys().next().value)
      if (path === undefined) return
      const body = `${JSON.stringify({ version: 1, sessions: Object.fromEntries(map) })}\n`
      writing = writing.catch(() => {}).then(() => writeAtomic(path, body))
      await writing
    }
  }
}
