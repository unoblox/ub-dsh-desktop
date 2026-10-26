/**
 * Spec-driven development: requirements → design → tasks → code and tests,
 * with the user approving each document and drift fixed as it appears.
 *
 * - The `spec` tool starts or opens a spec (specs/<slug>/ in the project),
 *   submits a document for approval, and reports the trace and drift.
 * - Gate (`tools/pre-execute`): until the user approved the tasks, file tools
 *   may change only the spec's own documents. The shell is not gated.
 * - Drift (`tools/post-execute`): after each write and test run the result
 *   carries what no longer matches: unknown ids in tests, criteria nobody
 *   plans or tests, failing criteria. A change to an approved document is
 *   logged in spec.json with what changed, by id.
 * - Keep going (`agent/turn-stopping`): while building, a turn that would end
 *   with tasks open or drift left is steered on, at most a few times and only
 *   while it makes progress.
 * - The runtime context carries the spec's state on every request, so it
 *   survives compaction.
 * - The panel reads one route and approves through another (client.js).
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DOC_FILES, DOCS, diffRequirements, parseRequirements, parseTasks, slugify, TEMPLATES, validate } from './parse.js'
import { ConflictError, createSessionMap, createSpecStore, phaseOf, sha256, specPath, STATE_FILE, TRACE_FILE } from './state.js'
import { buildTrace, isTestCommand, isTestPath, scanFor, scanTests, testRunFrom } from './trace.js'

export const name = 'dsh-desktop-specs'
export const inject = ['sessions', 'systemPrompt', 'tools', 'connection']
export const TOOL_NAME = 'spec'
export const ROUTE = '/api/desktop-specs'
export const APPROVE_ROUTE = '/api/desktop-specs/approve'
export const REOPEN_ROUTE = '/api/desktop-specs/reopen'
export const ACTIVATE_ROUTE = '/api/desktop-specs/activate'
const CONTEXT_NAME = 'desktop-specs'
const CONTEXT_ORDER = 46
const STEER_SOURCE = { kind: 'desktop-specs' }
const FILE_TOOLS = new Set(['write', 'edit', 'str_replace_editor'])
// bash everywhere; pwsh replaces it on Windows. Both end failures with [exit code: N].
const SHELL_TOOLS = new Set(['bash', 'pwsh'])
// How far a subagent's session is followed up to the conversation that owns the spec.
const MAX_LINEAGE = 5
const NO_STORE = { 'Cache-Control': 'no-store' }

export const Config = z.object({
  // App data folder for which spec each conversation works on.
  root: z.string().default(''),
  // How many times one turn is steered on while tasks are open or drift is left.
  maxContinues: z.natural().default(3)
})

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function argsOf(exec) {
  const value = exec?.arguments
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return {}
    }
  }
  return typeof value === 'object' && value !== null ? value : {}
}

/** tasks.md with every box unticked: ticking alone is progress, not a change. */
function untick(text) {
  return String(text ?? '').replace(/^(\s*[-*]\s+\[)[xX](\])/gmu, '$1 $2')
}

function textOf(result) {
  return (Array.isArray(result?.content) ? result.content : []).map((part) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
}

/** The project-relative path of a tool's target, or undefined outside the project. */
export function projectPath(root, path) {
  if (typeof path !== 'string' || path.trim() === '') return undefined
  const absolute = isAbsolute(path) ? path : resolve(root, path)
  const inside = relative(root, absolute)
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return undefined
  return inside.split(sep).join('/')
}

/** Same check as the other desktop routes: the app's own page only. */
export function fromSameOrigin(request) {
  const site = request.headers.get('sec-fetch-site')
  if (site === 'same-origin') return true
  if (site !== null && site !== 'none') return false
  const origin = request.headers.get('origin')
  if (origin === null) return true
  try {
    return new URL(origin).host === (request.headers.get('host') ?? new URL(request.url).host)
  } catch {
    return false
  }
}

const WORKFLOW = [
  'Spec-driven development: when the user asks to build or change something "with a spec" (or to spec it), call the spec tool with action "start". Then:',
  '1. requirements.md: one "### REQ-n: Title" per requirement with a user story and acceptance criteria "- AC-n.m: WHEN … THE SYSTEM SHALL …". Ask the user what is unclear before writing. Then spec submit requirements.',
  '2. design.md: architecture, data, interfaces and how each REQ-n is met. Then spec submit design.',
  '3. tasks.md: small ordered tasks "- [ ] T-n: Title (REQ-n, AC-n.m)" covering every criterion. Then spec submit tasks.',
  'After each submit, stop and ask the user to review it in the Spec panel; do not start the next document until it is approved. Code changes are blocked until the tasks are approved.',
  '4. Build task by task: write the code and tests, name each test after the criterion it checks (AC-1.2, or ac_1_2 where names cannot hold "-" or "."), run the tests, and tick the task ([x]) only when they pass.',
  'Drift: when code, tests and an approved document disagree, fix whichever side is wrong: code that breaks a criterion is fixed; a document the user\'s newer instructions or the facts have overtaken is updated (and the change is logged). Say which you changed and why.',
  'Run spec verify before saying the work is done.',
  'Before tasks.md is approved only the user can stop or switch the spec (from the Spec panel).'
].join('\n')

/**
 * @param {object} ctx - Cordis context.
 * @param {object} config - plugin config.
 * @param {{ now?: () => number }} [deps]
 */
export function apply(ctx, config, deps = {}) {
  const now = deps.now ?? Date.now
  const store = createSpecStore({ now })
  const sessions = createSessionMap(typeof config?.root === 'string' && config.root !== '' ? join(config.root, 'sessions.json') : undefined)
  const maxContinues = Number.isInteger(config?.maxContinues) ? config.maxContinues : 3
  // Approved texts by SHA-256, in the app's data folder, so a later change
  // can be summarised by id without keeping copies in the project.
  const textsDir = typeof config?.root === 'string' && config.root !== '' ? join(config.root, 'texts') : undefined
  const keepText = async (text) => {
    if (textsDir === undefined) return
    await mkdir(textsDir, { recursive: true })
    await writeFile(join(textsDir, `${sha256(text)}.md`), text, { encoding: 'utf8', flag: 'w' })
  }
  const keptText = async (hash) => {
    if (textsDir === undefined || !/^[0-9a-f]{64}$/u.test(hash)) return undefined
    return readFile(join(textsDir, `${hash}.md`), 'utf8').catch(() => undefined)
  }
  // Per spec (root + slug), this process only: test runs, the last change,
  // files changed since a task was last ticked, and a cached test scan.
  const live = new Map()
  const liveOf = (root, slug) => {
    const key = `${root}\0${slug}`
    let entry = live.get(key)
    if (entry === undefined) {
      entry = { run: undefined, lastChangeAt: 0, pending: new Set(), scan: undefined, reported: new Set(), done: undefined }
      live.set(key, entry)
    }
    return entry
  }
  const steers = new Map()
  // Conversations whose current turn changed code or tests or ran the tests:
  // only those are steered on, so a question or "pause" is not overridden.
  const worked = new Set()

  const sessionIdOf = (session) => {
    const id = session?.header?.id ?? session?.id
    return id === undefined ? undefined : String(id)
  }
  const rootOf = (session) => (typeof session?.header?.cwd === 'string' && session.header.cwd !== '' ? session.header.cwd : undefined)

  const activeOfId = async (sessionId) => {
    const entry = await sessions.get(sessionId)
    if (entry === undefined) return undefined
    const state = await store.load(entry.root, entry.slug)
    return state === undefined ? undefined : { sessionId, root: entry.root, slug: entry.slug, state }
  }
  /**
   * The conversation's active spec: { sessionId, root, slug, state } or
   * undefined. A subagent works under the spec of the conversation that
   * started it (its session's parentSession), gate included.
   */
  const activeOf = async (session) => {
    let sessionId = sessionIdOf(session)
    let parent = session?.header?.parentSession
    for (let depth = 0; sessionId !== undefined && depth < MAX_LINEAGE; depth++) {
      const active = await activeOfId(sessionId)
      if (active !== undefined) return active
      if (typeof parent !== 'string' || parent === '') return undefined
      sessionId = parent
      parent = ctx.sessions.get(parent)?.header?.parentSession
    }
    return undefined
  }

  /**
   * The documents, with approved ones edited outside the app logged first,
   * then the trace (test scan cached until a test file changes).
   */
  const snapshot = async (active, { rescan = false, record = 'outside the app' } = {}) => {
    const texts = await store.readDocs(active.root, active.slug)
    let state = active.state
    if (record !== null) state = await followChanges(active, texts, record)
    const entry = liveOf(active.root, active.slug)
    // The tasks already done when this process first saw the spec.
    entry.done ??= new Set(parseTasks(texts.tasks).filter((t) => t.done).map((t) => t.id))
    if (rescan || entry.scan === undefined) {
      entry.scan = await scanTests(active.root)
      entry.specCount = (await store.list(active.root)).length
    }
    const scan = scanFor(entry.scan, active.slug, entry.specCount ?? 1)
    const trace = buildTrace({ texts, scan, run: entry.run, lastChangeAt: entry.lastChangeAt, taskFiles: state.taskFiles })
    return { texts, state, phase: phaseOf(state), trace, entry }
  }

  /** Approved documents whose text moved on: follow ticks, log the rest. */
  const followChanges = async (active, texts, by) => {
    let state = active.state
    const notes = []
    for (const doc of DOCS) {
      const approval = state.approvals[doc]
      if (approval === undefined || approval.sha256 === sha256(texts[doc])) continue
      const approvedText = await keptText(approval.base ?? approval.sha256)
      if (doc === 'tasks' && approvedText !== undefined && untick(approvedText) === untick(texts[doc])) {
        state = await store.followTicks(active.root, active.slug, doc, texts[doc])
        continue
      }
      const summary = await changeSummary(doc, approval.base ?? approval.sha256, texts[doc])
      state = await store.recordChange(active.root, active.slug, doc, texts[doc], summary, by)
      await keepText(texts[doc]).catch(() => {})
      notes.push(`Logged a change to the approved ${DOC_FILES[doc]}: ${summary} Make the code, tests and the other documents agree with it, and tell the user what changed and why.`)
    }
    active.notes = notes
    return state
  }

  const describe = (active, view) => {
    const { state, phase, trace } = view
    const lines = [`Active spec: "${state.title}" in ${specPath(state.slug, '')} — phase: ${phase}.`]
    lines.push(`Approved: ${DOCS.filter((d) => state.approvals[d] !== undefined).map((d) => DOC_FILES[d]).join(', ') || 'nothing yet'}.`)
    if (state.awaiting !== null) lines.push(`Waiting for the user to approve ${DOC_FILES[state.awaiting.doc]}: do not continue to the next document.`)
    else if (phase !== 'build') {
      lines.push(`Next: write ${specPath(state.slug, DOC_FILES[phase])}, then spec submit ${phase}. Code changes are blocked until tasks.md is approved.`)
      if (view.texts[phase].trim() === '') lines.push(`Its shape:\n${TEMPLATES[phase](state.title)}`)
    }
    if (phase === 'build') {
      const open = trace.tasks.filter((t) => !t.done)
      lines.push(`Tasks: ${String(trace.tasks.length - open.length)}/${String(trace.tasks.length)} done.${open.length > 0 ? ` Next: ${open.slice(0, 3).map((t) => `${t.id} ${t.title}`).join('; ')}.` : ''}`)
      const c = trace.counts
      lines.push(`Criteria: ${String(c.passing)} passing, ${String(c.failing)} failing, ${String(c.stale)} stale, ${String(c['not-run'])} not run, ${String(c.untested)} untested (of ${String(c.total)}).`)
    }
    if (trace.drift.length > 0) {
      lines.push('Drift to fix:')
      for (const item of trace.drift.slice(0, 12)) lines.push(`- ${item.text} ${item.fix}`)
    }
    if ((view.entry?.specCount ?? 1) > 1) lines.push(`This project has ${String(view.entry.specCount)} specs and their ids overlap: put "spec: ${state.slug}" in a comment in each test file for this spec, or its tests do not count here.`)
    const recent = state.changes.slice(-3)
    if (recent.length > 0) lines.push(`Recent spec changes: ${recent.map((c) => `${DOC_FILES[c.doc]} (${c.by}): ${c.summary}`).join(' | ')}`)
    return lines.join('\n')
  }

  // ---------- runtime context ----------

  ctx.effect(() => ctx.systemPrompt.context({ name: CONTEXT_NAME, order: CONTEXT_ORDER, text: WORKFLOW }), 'desktop-specs: runtime context')
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next()
    if (!result.contexts.some((entry) => entry.name === CONTEXT_NAME)) return result
    let text = WORKFLOW
    try {
      const active = await activeOf(context?.agent?.session)
      if (active !== undefined) text = `${WORKFLOW}\n\n${describe(active, await snapshot(active))}`
    } catch (error) {
      ctx.logger.warn('desktop-specs: spec state not shown this step: %s', errorText(error))
    }
    return { ...result, contexts: result.contexts.map((entry) => (entry.name === CONTEXT_NAME ? { ...entry, text } : entry)) }
  })

  // ---------- gate ----------

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!FILE_TOOLS.has(exec?.name)) return next()
    let active
    try {
      active = await activeOf(exec.agent?.session)
    } catch (error) {
      ctx.logger.warn('desktop-specs: gate skipped: %s', errorText(error))
      return next()
    }
    if (active === undefined) return next()
    const args = argsOf(exec)
    const path = projectPath(active.root, args.file_path ?? args.path)
    const own = specPath(active.slug, '')
    // Case-insensitive: SPEC.JSON is the same file on macOS and Windows.
    const lower = path?.toLowerCase()
    if (lower === specPath(active.slug, STATE_FILE).toLowerCase() || lower === specPath(active.slug, TRACE_FILE).toLowerCase()) {
      return { kind: 'deny', reason: `${path} is kept by the app. Use the spec tool (submit, verify) instead of editing it.` }
    }
    const phase = phaseOf(active.state)
    if (phase === 'build' || (lower !== undefined && lower.startsWith(own.toLowerCase()))) return next()
    if (exec.name === 'str_replace_editor' && args.command === 'view') return next()
    return {
      kind: 'deny',
      reason: `The spec "${active.state.title}" is in the ${phase} phase: code changes wait until the user approves tasks.md. Write ${specPath(active.slug, DOC_FILES[phase])} and call spec submit ${phase}${active.state.awaiting === null ? '' : ` (now waiting for approval of ${DOC_FILES[active.state.awaiting.doc]})`}.`
    }
  })

  // ---------- drift after writes and test runs ----------

  const withContext = async (downstream, text) => {
    const decision = await downstream
    if (text === undefined) return decision
    const message = createUserMessage({ content: [{ type: 'text', text }], source: STEER_SOURCE })
    return { ...decision, additionalContexts: [message, ...(decision.additionalContexts ?? [])] }
  }

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const tool = exec?.name
    if ((!FILE_TOOLS.has(tool) && !SHELL_TOOLS.has(tool)) || result?.isError) return next()
    let note
    try {
      const active = await activeOf(exec.agent?.session)
      if (active !== undefined) note = await afterTool(active, tool, argsOf(exec), result)
    } catch (error) {
      ctx.logger.warn('desktop-specs: drift check skipped: %s', errorText(error))
    }
    return withContext(next(), note)
  })

  /** What the agent should know after one tool call, or undefined. */
  const afterTool = async (active, tool, args, result) => {
    const entry = liveOf(active.root, active.slug)
    const notes = []
    let rescan = false
    if (SHELL_TOOLS.has(tool)) {
      // A shell command may have edited the spec's documents too.
      const texts = await store.readDocs(active.root, active.slug)
      active.state = await followChanges(active, texts, 'agent (shell)')
      notes.push(...active.notes)
      const command = typeof args.command === 'string' ? args.command : ''
      if (!isTestCommand(command)) return notes.length === 0 ? undefined : notes.join('\n')
      // Started in the background, still running or stopped: no outcome yet.
      const run = args.run_in_background === true ? undefined : testRunFrom(command, textOf(result), now())
      if (run === undefined) return notes.length === 0 ? undefined : notes.join('\n')
      entry.run = run
      worked.add(active.sessionId)
      // Tests may have been written or checked out by the shell.
      rescan = true
    } else {
      const path = projectPath(active.root, args.file_path ?? args.path)
      if (path === undefined || (tool === 'str_replace_editor' && args.command === 'view')) return undefined
      const own = specPath(active.slug, '')
      if (path.startsWith(own)) {
        const doc = DOCS.find((d) => path === specPath(active.slug, DOC_FILES[d]))
        if (doc === undefined) return undefined
        const texts = await store.readDocs(active.root, active.slug)
        const approval = active.state.approvals[doc]
        if (doc === 'tasks') {
          // Files changed since the last tick belong to the tasks ticked now.
          const ticked = parseTasks(texts.tasks).filter((t) => t.done).map((t) => t.id)
          const known = entry.done ?? new Set()
          const newly = ticked.filter((id) => !known.has(id))
          entry.done = new Set(ticked)
          if (newly.length > 0 && entry.pending.size > 0) {
            await store.linkFiles(active.root, active.slug, newly, [...entry.pending])
            entry.pending.clear()
          }
        }
        if (approval !== undefined) {
          active.state = await followChanges(active, texts, 'agent')
          notes.push(...active.notes)
        }
        const issues = validate(doc, texts).filter((issue) => issue.level === 'error')
        if (issues.length > 0 && approval !== undefined) notes.push(`${DOC_FILES[doc]} now has problems: ${issues.map((i) => i.text).join(' ')}`)
      } else {
        entry.pending.add(path)
        entry.lastChangeAt = now()
        worked.add(active.sessionId)
        rescan = isTestPath(path)
      }
    }
    if (phaseOf(active.state) !== 'build') return notes.length === 0 ? undefined : notes.join('\n')
    const view = await snapshot(active, { rescan })
    if (SHELL_TOOLS.has(tool) && entry.run !== undefined) {
      const failing = view.trace.criteria.filter((c) => c.status === 'failing').map((c) => c.id)
      notes.push(entry.run.ok
        ? `Spec: tests passed (${String(view.trace.counts.passing)} of ${String(view.trace.counts.total)} criteria passing, ${String(view.trace.counts.untested)} untested).`
        : `Spec: the test run failed${failing.length > 0 ? ` for ${failing.join(', ')}` : ''}. Fix the code, or the test or spec if it is the one that is wrong, and run the tests again.`)
    }
    // New drift only: what was reported once is not repeated on every write.
    const fresh = view.trace.drift.filter((item) => !entry.reported.has(item.text))
    for (const item of fresh) entry.reported.add(item.text)
    if (fresh.length > 0) notes.push(`Spec drift:\n${fresh.slice(0, 8).map((item) => `- ${item.text} ${item.fix}`).join('\n')}`)
    return notes.length === 0 ? undefined : notes.join('\n')
  }

  const changeSummary = async (doc, approvedHash, text) => {
    const approvedText = await keptText(approvedHash)
    if (doc === 'requirements' && approvedText !== undefined) {
      const diff = diffRequirements(approvedText, text)
      const parts = [
        diff.added.length > 0 ? `added ${diff.added.join(', ')}` : '',
        diff.removed.length > 0 ? `removed ${diff.removed.join(', ')}` : '',
        diff.changed.length > 0 ? `reworded ${diff.changed.join(', ')}` : ''
      ].filter(Boolean)
      return parts.length > 0 ? `${parts.join('; ')}.` : 'formatting only.'
    }
    if (doc === 'requirements') {
      const requirements = parseRequirements(text)
      return `now ${String(requirements.length)} requirements, ${String(requirements.reduce((n, r) => n + r.criteria.length, 0))} criteria.`
    }
    if (doc === 'tasks') {
      const tasks = parseTasks(text)
      return `${String(tasks.filter((t) => t.done).length)}/${String(tasks.length)} tasks done.`
    }
    return 'edited.'
  }

  // ---------- keep going while building ----------

  ctx.on('session/event', (session, event) => {
    if (event?.type === 'turn/start') {
      const id = sessionIdOf(session)
      if (id !== undefined) worked.delete(id)
    }
  })

  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
    if (maxContinues === 0 || signal?.aborted) return
    let active
    try {
      active = await activeOf(agent?.session)
    } catch {
      return
    }
    if (active === undefined || active.state.awaiting !== null || phaseOf(active.state) !== 'build' || !worked.has(active.sessionId)) return
    const view = await snapshot(active)
    const open = view.trace.tasks.filter((t) => !t.done)
    if (open.length === 0 && view.trace.drift.length === 0) return
    const key = `${active.sessionId}\0${String(turn)}`
    const signature = `${String(open.length)}|${view.trace.drift.map((d) => d.text).join('|')}|${String(view.trace.counts.passing)}`
    const seen = steers.get(key) ?? { count: 0, signature: '' }
    // Stop steering when nothing moved since the last time: the agent is
    // stuck or waiting on the user, and the user decides.
    if (seen.count >= maxContinues || seen.signature === signature) return
    steers.set(key, { count: seen.count + 1, signature })
    while (steers.size > 200) steers.delete(steers.keys().next().value)
    const lines = [`Spec "${active.state.title}" is not finished.`]
    if (open.length > 0) lines.push(`Open tasks: ${open.slice(0, 5).map((t) => `${t.id} ${t.title}`).join('; ')}.`)
    for (const item of view.trace.drift.slice(0, 6)) lines.push(`- ${item.text} ${item.fix}`)
    lines.push('Continue with the next step. If you need the user (a decision, access, or something unclear), ask in one short message and stop.')
    agent.steer(createUserMessage({ content: [{ type: 'text', text: lines.join('\n') }], source: STEER_SOURCE }))
    ctx.logger.info('desktop-specs: continued %s (%d open tasks, %d drift)', active.slug, open.length, view.trace.drift.length)
  })

  // ---------- the tool ----------

  ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: [
      'Spec-driven development in this project (specs/<slug>/: requirements.md, design.md, tasks.md).',
      'Actions: "start" (title) creates a spec and makes it this conversation\'s active spec; "open" (slug) makes an existing one active; "list"; "status" shows the phase, what is approved, problems and drift;',
      '"submit" (doc: requirements | design | tasks) checks a document and puts it up for the user\'s approval, after which you stop and wait; "verify" maps criteria to tests and the last test run, writes trace.json and lists drift; "close" ends spec mode for this conversation.'
    ].join(' '),
    parameters: {
      action: { type: 'string', enum: ['start', 'open', 'list', 'status', 'submit', 'verify', 'close'], description: 'What to do.' },
      title: { type: 'string', description: 'start: the feature\'s name.' },
      slug: { type: 'string', description: 'open: the spec folder name under specs/.' },
      doc: { type: 'string', enum: DOCS, description: 'submit: which document.' }
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, result) => [{ type: 'text', text: result.text }]
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const session = exec?.agent?.session
      const sessionId = sessionIdOf(session)
      const root = rootOf(session)
      if (sessionId === undefined || root === undefined) throw new Error('specs need a conversation with a workspace folder')
      const action = args.action
      const current = await activeOf(session)
      // Before the tasks are approved the agent may not leave the spec (that
      // would lift the gate); the user can, from the panel.
      const locked = current !== undefined && phaseOf(current.state) !== 'build'
      const refuseSwitch = (slug) => {
        if (locked && slug !== current.slug) throw new Error(`the spec "${current.state.title}" is in the ${phaseOf(current.state)} phase: only the user can stop or switch it, from the Spec panel`)
      }
      if (action === 'start') {
        const title = typeof args.title === 'string' ? args.title.trim().slice(0, 80) : ''
        if (title === '') throw new Error('give the feature a title')
        refuseSwitch(slugify(title))
        const { state, created } = await store.create(root, title)
        await sessions.set(sessionId, { root, slug: state.slug })
        const phase = phaseOf(state)
        const texts = await store.readDocs(root, state.slug)
        const next = phase === 'build' ? '' : texts[phase].trim() === ''
          ? `Ask the user anything unclear, then write ${specPath(state.slug, DOC_FILES[phase])} in this shape (replace every <…>) and call spec submit ${phase}:\n\n${TEMPLATES[phase](state.title)}`
          : `${specPath(state.slug, DOC_FILES[phase])} exists: read it, finish it, and call spec submit ${phase}.`
        return { text: `${created ? 'Created' : 'Opened the existing'} spec "${state.title}" in ${specPath(state.slug, '')} (phase: ${phase}). ${next}` }
      }
      if (action === 'open') {
        const slug = typeof args.slug === 'string' ? args.slug.trim() : ''
        if (slug === '' || slugify(slug) !== slug) throw new Error(`"${slug}" is not a spec folder name; spec list shows them`)
        refuseSwitch(slug)
        const state = await store.load(root, slug)
        if (state === undefined) throw new Error(`no spec "${slug}" in specs/; spec list shows them`)
        await sessions.set(sessionId, { root, slug })
        return { text: describe({ sessionId, root, slug, state }, await snapshot({ sessionId, root, slug, state })) }
      }
      if (action === 'list') {
        const specs = await store.list(root)
        return { text: specs.length === 0 ? 'No specs in this project yet.' : specs.map((s) => `${s.slug}: "${s.title}" (${phaseOf(s)})`).join('\n') }
      }
      const active = current
      if (active === undefined) throw new Error('no active spec in this conversation: spec start (or spec open) first')
      if (action === 'close') {
        refuseSwitch(null)
        await sessions.set(sessionId, null)
        return { text: `Spec mode ended for this conversation. ${specPath(active.slug, '')} stays in the project.` }
      }
      if (action === 'status') return { text: describe(active, await snapshot(active)) }
      if (action === 'submit') {
        const doc = args.doc
        if (!DOCS.includes(doc)) throw new Error('doc must be requirements, design or tasks')
        const phase = phaseOf(active.state)
        if (phase !== doc && active.state.approvals[doc] === undefined) throw new Error(`${DOC_FILES[phase]} comes first: it is not approved yet`)
        if (active.state.approvals[doc] !== undefined) return { text: `${DOC_FILES[doc]} is already approved. Changes to it are logged; carry on.` }
        const texts = await store.readDocs(active.root, active.slug)
        const issues = validate(doc, texts)
        const errors = issues.filter((issue) => issue.level === 'error')
        if (errors.length > 0) return { text: `Not submitted. Fix these in ${specPath(active.slug, DOC_FILES[doc])} and submit again:\n${errors.map((i) => `- ${i.text}`).join('\n')}` }
        await store.submit(active.root, active.slug, doc, texts[doc])
        const warnings = issues.filter((issue) => issue.level === 'warning')
        return { text: `${DOC_FILES[doc]} is up for the user's approval${warnings.length > 0 ? ` (worth mentioning: ${warnings.map((w) => w.text).join(' ')})` : ''}. Now stop: summarise it in a few lines and ask the user to review it in the Spec panel and approve it or ask for changes. Do not write the next document until it is approved.` }
      }
      if (action === 'verify') {
        const view = await snapshot(active, { rescan: true })
        const trace = { generatedAt: new Date(now()).toISOString(), spec: active.slug, ...view.trace }
        await store.writeTrace(active.root, active.slug, trace)
        const lines = [describe(active, view), '', 'Criteria:']
        for (const criterion of view.trace.criteria) lines.push(`- ${criterion.id} ${criterion.status}${criterion.tests.length > 0 ? ` (${criterion.tests.map((t) => `${t.file}:${String(t.line)}`).join(', ')})` : ''}`)
        if (view.trace.run === null) lines.push('', 'No test run seen in this session: run the tests, then verify again.')
        lines.push('', `Wrote ${specPath(active.slug, TRACE_FILE)}.`)
        return { text: lines.join('\n') }
      }
      throw new Error('unknown action')
    }
  }))

  // ---------- panel routes ----------

  const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE })
  const readBody = async (request) => {
    if (!(request.headers.get('content-type') ?? '').includes('application/json') || !fromSameOrigin(request)) return { refused: json({ error: 'refused' }, 403) }
    try {
      return { body: await request.json() }
    } catch {
      return { refused: json({ error: 'not JSON' }, 400) }
    }
  }

  ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const sessionId = new URL(request.url).searchParams.get('session') ?? ''
      const session = sessionId === '' ? undefined : ctx.sessions.get(sessionId)
      const root = rootOf(session)
      try {
        const active = sessionId === '' ? undefined : await activeOfId(sessionId)
        const specs = root === undefined ? [] : (await store.list(root)).map((s) => ({ slug: s.slug, title: s.title, phase: phaseOf(s) }))
        if (active === undefined) return json({ active: null, specs })
        // Read-only: the agent's turn and its tools record changes, not the panel.
        const view = await snapshot(active, { record: null })
        const docs = {}
        for (const doc of DOCS) docs[doc] = { file: specPath(active.slug, DOC_FILES[doc]), text: view.texts[doc], sha256: sha256(view.texts[doc]), issues: validate(doc, view.texts) }
        return json({
          active: {
            slug: active.slug,
            title: view.state.title,
            phase: view.phase,
            awaiting: view.state.awaiting === null ? null : { doc: view.state.awaiting.doc, current: view.state.awaiting.sha256 === sha256(view.texts[view.state.awaiting.doc]) },
            approvals: Object.fromEntries(DOCS.map((doc) => [doc, view.state.approvals[doc] === undefined ? null : { at: view.state.approvals[doc].at, changedAt: view.state.approvals[doc].changedAt ?? null }])),
            docs,
            trace: view.trace,
            changes: view.state.changes.slice(-50)
          },
          specs
        })
      } catch (error) {
        ctx.logger.warn('desktop-specs: panel state unreadable: %s', errorText(error))
        return json({ error: 'spec unreadable' }, 500)
      }
    }
  })

  const postRoute = (path, handle) => ctx.connection.fetch.register({
    path,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const { body, refused } = await readBody(request)
      if (refused !== undefined) return refused
      if (typeof body?.session !== 'string' || body.session === '') return json({ error: 'session is required' }, 400)
      try {
        return await handle(body)
      } catch (error) {
        return json({ error: errorText(error) }, error instanceof ConflictError ? 409 : 500)
      }
    }
  })

  postRoute(APPROVE_ROUTE, async (body) => {
    if (!DOCS.includes(body.doc) || typeof body.sha256 !== 'string') return json({ error: 'doc and sha256 are required' }, 400)
    const active = await activeOfId(body.session)
    if (active === undefined) return json({ error: 'no active spec' }, 404)
    const texts = await store.readDocs(active.root, active.slug)
    const errors = validate(body.doc, texts).filter((issue) => issue.level === 'error')
    if (errors.length > 0) return json({ error: `${DOC_FILES[body.doc]} still has problems: ${errors[0].text}` }, 409)
    const state = await store.approve(active.root, active.slug, body.doc, body.sha256)
    await keepText(texts[body.doc]).catch((error) => ctx.logger.warn('desktop-specs: approved text not kept: %s', errorText(error)))
    ctx.logger.info('desktop-specs: %s approved in %s', DOC_FILES[body.doc], active.slug)
    return json({ ok: true, phase: phaseOf(state) })
  })

  postRoute(REOPEN_ROUTE, async (body) => {
    if (!DOCS.includes(body.doc)) return json({ error: 'doc is required' }, 400)
    const active = await activeOfId(body.session)
    if (active === undefined) return json({ error: 'no active spec' }, 404)
    await store.reopen(active.root, active.slug, body.doc)
    return json({ ok: true })
  })

  postRoute(ACTIVATE_ROUTE, async (body) => {
    const root = rootOf(ctx.sessions.get(body.session))
    if (root === undefined) return json({ error: 'the conversation has no workspace folder' }, 409)
    if (body.slug === null) {
      await sessions.set(body.session, null)
      return json({ ok: true })
    }
    if (typeof body.slug !== 'string' || slugify(body.slug) !== body.slug || (await store.load(root, body.slug)) === undefined) return json({ error: 'no such spec' }, 404)
    await sessions.set(body.session, { root, slug: body.slug })
    return json({ ok: true })
  })
}
