import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diffRequirements, parseRequirements, parseTasks, slugify, validate } from '../packages/dsh-desktop-specs/parse.js'
import { createSpecStore, phaseOf, sha256 } from '../packages/dsh-desktop-specs/state.js'
import { buildTrace, idsIn, isTestCommand, isTestPath, scanTests, testRunFrom } from '../packages/dsh-desktop-specs/trace.js'
import { ACTIVATE_ROUTE, APPROVE_ROUTE, apply, projectPath, ROUTE } from '../packages/dsh-desktop-specs/index.js'

const REQUIREMENTS = `# Greeter: requirements

## Context

A tiny greeting library.

## Requirements

### REQ-1: Greet by name

As a caller, I want a greeting with the person's name, so that it feels personal.

Acceptance criteria:

- AC-1.1: WHEN greet is called with a name THE SYSTEM SHALL return "Hello, <name>!".
- AC-1.2: WHEN the name is empty THE SYSTEM SHALL return "Hello!".

### REQ-2: Shout

- AC-2.1: WHEN shout is true THE SYSTEM SHALL return the greeting in upper case.
`
const DESIGN = `# Greeter: design

One function greet(name, { shout }) in greet.js. REQ-1 is the template; REQ-2 upper-cases the result.
`
const TASKS = `# Greeter: tasks

- [ ] T-1: Greeting with a name (REQ-1)
- [ ] T-2: Shouting (AC-2.1)
`

let dir = ''
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ubx-specs-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('documents', () => {
  it('parses requirements, criteria and tasks leniently', () => {
    const requirements = parseRequirements(REQUIREMENTS)
    expect(requirements.map((r) => [r.id, r.title, r.criteria.map((c) => c.id)])).toEqual([
      ['REQ-1', 'Greet by name', ['AC-1.1', 'AC-1.2']],
      ['REQ-2', 'Shout', ['AC-2.1']]
    ])
    expect(requirements[0].story).toContain('As a caller')
    expect(parseRequirements('## REQ-7 — **Bold** title\n1. AC-7.1) WHEN x THE SYSTEM SHALL y')[0]).toMatchObject({ id: 'REQ-7', title: 'Bold title', criteria: [{ id: 'AC-7.1' }] })
    expect(parseTasks(`${TASKS}- [x] T-3: Docs\n    covers AC-1.2\n`)).toEqual([
      { id: 'T-1', done: false, title: 'Greeting with a name', refs: ['REQ-1'] },
      { id: 'T-2', done: false, title: 'Shouting', refs: ['AC-2.1'] },
      { id: 'T-3', done: true, title: 'Docs', refs: ['AC-1.2'] }
    ])
  })

  it('validates each document against the others', () => {
    const texts = { requirements: REQUIREMENTS, design: DESIGN, tasks: TASKS }
    expect(validate('requirements', texts).filter((i) => i.level === 'error')).toEqual([])
    expect(validate('design', texts)).toEqual([])
    expect(validate('tasks', texts)).toEqual([])
    const broken = { requirements: '### REQ-1: A\n\n- AC-1.1: it works\n\n### REQ-1: B\n', design: 'short', tasks: '- [ ] T-1: x (REQ-9)\n' }
    const texts2 = (doc) => validate(doc, broken).map((i) => `${i.level}: ${i.text}`)
    expect(texts2('requirements')).toEqual(expect.arrayContaining([
      'error: REQ-1 is defined more than once.',
      expect.stringMatching(/^error: REQ-1 has no acceptance criteria/u),
      expect.stringMatching(/^warning: AC-1.1 has no SHALL/u)
    ]))
    expect(texts2('design')).toContain('error: The design is empty.')
    expect(texts2('tasks')).toEqual(expect.arrayContaining(['error: T-1 names REQ-9, which the requirements do not define.', 'error: No task builds REQ-1.']))
    expect(validate('requirements', { requirements: '### REQ-1: <short title>\n- AC-1.1: WHEN <trigger> THE SYSTEM SHALL x' })[0].text).toContain('placeholders')
  })

  it('diffs requirements by id', () => {
    const after = REQUIREMENTS.replace('upper case', 'capitals').replace('- AC-1.2: WHEN the name is empty THE SYSTEM SHALL return "Hello!".\n', '') + '\n### REQ-3: Wave\n- AC-3.1: WHEN asked THE SYSTEM SHALL wave.\n'
    expect(diffRequirements(REQUIREMENTS, after)).toEqual({ added: ['REQ-3', 'AC-3.1'], removed: ['AC-1.2'], changed: ['AC-2.1'] })
    expect(slugify('Checkout Flow: v2!')).toBe('checkout-flow-v2')
  })
})

describe('trace', () => {
  it('recognises tests, test commands, ids and run outcomes', () => {
    expect(['test/greet.test.js', 'tests/test_greet.py', 'pkg/greet_test.go', 'src/GreetTest.java'].map(isTestPath)).toEqual([true, true, true, true])
    expect(['src/greet.js', 'README.md', 'test/fixtures/data.json'].map(isTestPath)).toEqual([false, false, false])
    expect(['npm test', 'cd app && npx vitest run', 'python -m pytest -q', 'go test ./...', 'ls test'].map(isTestCommand)).toEqual([true, true, true, true, false])
    expect(idsIn('it("AC-1.1 greets", …) def test_ac_2_1_shouts(): REQ_3 AC-10.2.5 xAC-1.1')).toEqual(['AC-1.1', 'AC-2.1', 'REQ-3'])
    expect(testRunFrom('npm test', 'ok\n', 5)).toMatchObject({ ok: true, exitCode: 0, failingIds: [] })
    expect(testRunFrom('npm test', ' ✓ AC-1.1 greets\n × AC-1.2 empty name\nFAILED tests/test_x.py::test_ac_2_1\n[exit code: 1]', 5)).toMatchObject({ ok: false, exitCode: 1, failingIds: ['AC-1.2', 'AC-2.1'] })
  })

  it('maps criteria to tests and reports drift', async () => {
    await mkdir(join(dir, 'test'), { recursive: true })
    await writeFile(join(dir, 'test', 'greet.test.js'), "test('AC-1.1 greets by name', () => {})\ntest('AC-9.9 old behaviour', () => {})\n")
    const scan = await scanTests(dir)
    const done = TASKS.replace('- [ ] T-1', '- [x] T-1')
    const texts = { requirements: REQUIREMENTS, design: DESIGN, tasks: done }
    const passed = buildTrace({ texts, scan, run: { at: 10, ok: true, failingIds: [], command: 'npm test' }, lastChangeAt: 5 })
    expect(Object.fromEntries(passed.criteria.map((c) => [c.id, c.status]))).toEqual({ 'AC-1.1': 'passing', 'AC-1.2': 'untested', 'AC-2.1': 'untested' })
    expect(passed.drift.map((d) => d.kind)).toEqual(['unknown-id', 'untested'])
    expect(passed.drift[1].text).toBe('T-1 is ticked done, but no test checks AC-1.2.')
    const stale = buildTrace({ texts, scan, run: { at: 10, ok: true, failingIds: [], command: 'npm test' }, lastChangeAt: 20 })
    expect(stale.criteria[0].status).toBe('stale')
    const failed = buildTrace({ texts, scan, run: { at: 30, ok: false, failingIds: ['AC-1.1'], command: 'npm test' }, lastChangeAt: 20 })
    expect(failed.drift.map((d) => d.kind)).toContain('failing')
    // A criterion no task plans is drift too.
    const unplanned = buildTrace({ texts: { ...texts, tasks: '- [ ] T-1: Greeting (REQ-1)\n' }, scan, run: undefined })
    expect(unplanned.drift.find((d) => d.kind === 'plan')?.text).toBe('AC-2.1 is in the requirements but no task builds it.')
  })
})

describe('spec state', () => {
  it('creates a spec, approves by hash in order, and logs later changes', async () => {
    let time = 100
    const store = createSpecStore({ now: () => time })
    const { state, created } = await store.create(dir, 'Greeter')
    expect(created).toBe(true)
    expect(phaseOf(state)).toBe('requirements')
    // The agent writes the documents itself (the Harness lets it overwrite only files it read).
    await expect(readFile(join(dir, 'specs', 'greeter', 'requirements.md'), 'utf8')).rejects.toThrow()
    expect((await store.create(dir, 'Greeter')).created).toBe(false)
    await writeFile(join(dir, 'specs', 'greeter', 'requirements.md'), REQUIREMENTS)
    // Only a submitted document, exactly as submitted and shown, in order.
    await expect(store.approve(dir, 'greeter', 'requirements', sha256(REQUIREMENTS))).rejects.toThrow('has not been submitted')
    await store.submit(dir, 'greeter', 'requirements', REQUIREMENTS)
    await expect(store.approve(dir, 'greeter', 'requirements', sha256('something else'))).rejects.toThrow('changed since it was submitted or shown')
    await writeFile(join(dir, 'specs', 'greeter', 'requirements.md'), `${REQUIREMENTS}- AC-2.2: WHEN x THE SYSTEM SHALL delete everything.\n`)
    await expect(store.approve(dir, 'greeter', 'requirements', sha256(`${REQUIREMENTS}- AC-2.2: WHEN x THE SYSTEM SHALL delete everything.\n`))).rejects.toThrow('changed since it was submitted')
    await writeFile(join(dir, 'specs', 'greeter', 'requirements.md'), REQUIREMENTS)
    const approved = await store.approve(dir, 'greeter', 'requirements', sha256(REQUIREMENTS))
    expect(phaseOf(approved)).toBe('design')
    time = 200
    const changed = await store.recordChange(dir, 'greeter', 'requirements', `${REQUIREMENTS}\n`, 'formatting only.', 'agent')
    expect(changed.changes).toEqual([expect.objectContaining({ doc: 'requirements', by: 'agent', at: 200 })])
    expect(changed.approvals.requirements.sha256).toBe(sha256(`${REQUIREMENTS}\n`))
    expect(JSON.parse(await readFile(join(dir, 'specs', 'greeter', 'spec.json'), 'utf8')).changes).toHaveLength(1)
  })
})

// ---------- the plugin, through a stand-in Harness ----------

function harness() {
  const handlers = new Map()
  const routes = new Map()
  const tools = new Map()
  const contexts = []
  const logs = []
  const session = { header: { id: 's1', cwd: dir } }
  const ctx = {
    on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    effect: (fn) => fn(),
    logger: { warn: (...args) => logs.push(args), info: (...args) => logs.push(args) },
    sessions: { get: (id) => (id === 's1' ? session : undefined) },
    systemPrompt: { context: (entry) => contexts.push(entry) },
    tools: { register: (tool) => tools.set(tool.name, tool) },
    connection: { fetch: { register: (route) => routes.set(route.path, route.fetch) } }
  }
  apply(ctx, { root: join(dir, '.appdata'), maxContinues: 2 })
  const agent = { session, steered: [], steer(message) { this.steered.push(message) } }
  const tool = (args, as = agent) => tools.get('spec').execute(args, { agent: as })
  const pre = (name, args, as = agent) => handlers.get('tools/pre-execute')[0]({ name, arguments: args, agent: as }, async () => ({ kind: 'allow' }))
  const post = (name, args, text = '', as = agent) => handlers.get('tools/post-execute')[0]({ name, arguments: args, agent: as }, { content: [{ type: 'text', text }], isError: false }, async () => ({ kind: 'accept' }))
  const stopping = (turn) => handlers.get('agent/turn-stopping')[0]({ agent, turn })
  const turnStart = (turn) => handlers.get('session/event').forEach((fn) => fn(session, { type: 'turn/start', data: { turn } }))
  const assemble = async () => (await handlers.get('system-prompt/assemble')[0]({}, { agent }, async () => ({ contexts: [{ name: 'desktop-specs', text: '' }] }))).contexts[0].text
  const get = async () => (await routes.get(ROUTE)(new Request(`http://harness.internal${ROUTE}?session=s1`))).json()
  const postJson = (path, body) => routes.get(path)(new Request(`http://harness.internal${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  const write = async (rel, text) => { await mkdir(join(dir, rel, '..'), { recursive: true }); await writeFile(join(dir, rel), text) }
  return { tool, pre, post, stopping, turnStart, assemble, get, postJson, write, agent, logs }
}

describe('spec plugin', () => {
  it('walks a feature from requirements to verified code, gating code until the tasks are approved', async () => {
    const h = harness()
    expect(await h.assemble()).toContain('Spec-driven development')
    const started = (await h.tool({ action: 'start', title: 'Greeter' })).text
    expect(started).toContain('specs/greeter/')
    expect(started).toContain('### REQ-1: <short title>')
    // Code is blocked; the spec's own documents are not; spec.json never is.
    expect(await h.pre('write', { file_path: 'greet.js' })).toMatchObject({ kind: 'deny', reason: expect.stringContaining('requirements phase') })
    expect(await h.pre('write', { file_path: 'specs/greeter/requirements.md' })).toEqual({ kind: 'allow' })
    expect(await h.pre('edit', { file_path: join(dir, 'specs/greeter/spec.json') })).toMatchObject({ kind: 'deny' })
    // Submitting nothing, or the untouched template, is refused.
    expect((await h.tool({ action: 'submit', doc: 'requirements' })).text).toContain('Not submitted')
    await h.write('specs/greeter/requirements.md', '### REQ-1: <short title>\n- AC-1.1: WHEN <trigger> THE SYSTEM SHALL x\n')
    expect((await h.tool({ action: 'submit', doc: 'requirements' })).text).toContain('placeholders')
    await h.write('specs/greeter/requirements.md', REQUIREMENTS)
    await expect(h.tool({ action: 'submit', doc: 'design' })).rejects.toThrow('requirements.md comes first')
    expect((await h.tool({ action: 'submit', doc: 'requirements' })).text).toContain('up for the user\'s approval')
    let view = await h.get()
    expect(view.active).toMatchObject({ slug: 'greeter', phase: 'requirements', awaiting: { doc: 'requirements', current: true } })
    expect(await h.assemble()).toContain('Waiting for the user to approve requirements.md')
    // The user approves what the panel showed.
    expect((await h.postJson(APPROVE_ROUTE, { session: 's1', doc: 'requirements', sha256: 'stale' })).status).toBe(409)
    expect((await h.postJson(APPROVE_ROUTE, { session: 's1', doc: 'requirements', sha256: view.active.docs.requirements.sha256 })).status).toBe(200)
    await h.write('specs/greeter/design.md', DESIGN)
    await h.tool({ action: 'submit', doc: 'design' })
    view = await h.get()
    await h.postJson(APPROVE_ROUTE, { session: 's1', doc: 'design', sha256: view.active.docs.design.sha256 })
    await h.write('specs/greeter/tasks.md', TASKS)
    await h.tool({ action: 'submit', doc: 'tasks' })
    expect(await h.pre('write', { file_path: 'greet.js' })).toMatchObject({ kind: 'deny', reason: expect.stringContaining('waiting for approval of tasks.md') })
    view = await h.get()
    await h.postJson(APPROVE_ROUTE, { session: 's1', doc: 'tasks', sha256: view.active.docs.tasks.sha256 })
    expect((await h.get()).active.phase).toBe('build')
    expect(await h.pre('write', { file_path: 'greet.js' })).toEqual({ kind: 'allow' })

    // Building: a write, a tagged test, a failing then passing run.
    await h.write('greet.js', 'module.exports = (n) => `Hello, ${n}!`\n')
    await h.post('write', { file_path: 'greet.js' })
    await h.write('test/greet.test.js', "test('AC-1.1 greets', () => {})\ntest('AC-1.2 empty', () => {})\ntest('AC-7.1 stray', () => {})\n")
    const afterTest = await h.post('write', { file_path: 'test/greet.test.js' })
    expect(afterTest.additionalContexts[0].content[0].text).toContain('test/greet.test.js:3 names AC-7.1')
    const failed = await h.post('bash', { command: 'npm test' }, ' × AC-1.2 empty\n[exit code: 1]')
    expect(failed.additionalContexts[0].content[0].text).toContain('the test run failed for AC-1.2')
    await h.post('bash', { command: 'npm test' }, 'all good\n')
    // Ticking T-1 links the files changed for it.
    await h.write('specs/greeter/tasks.md', TASKS.replace('- [ ] T-1', '- [x] T-1'))
    await h.post('edit', { file_path: 'specs/greeter/tasks.md' })
    view = await h.get()
    expect(view.active.trace.tasks[0]).toMatchObject({ id: 'T-1', done: true, files: ['greet.js', 'test/greet.test.js'] })
    expect(Object.fromEntries(view.active.trace.criteria.map((c) => [c.id, c.status]))).toEqual({ 'AC-1.1': 'passing', 'AC-1.2': 'passing', 'AC-2.1': 'untested' })
    // Ticking a task is progress, not a change to the approved plan.
    expect(view.active.changes).toEqual([])
    expect(view.active.approvals.tasks.changedAt).toBeNull()

    // The turn would end with T-2 open: it is steered on, but not forever.
    await h.stopping(1)
    expect(h.agent.steered).toHaveLength(1)
    expect(h.agent.steered[0].content[0].text).toContain('Open tasks: T-2 Shouting')
    await h.stopping(1)
    expect(h.agent.steered).toHaveLength(1)

    const verify = await h.tool({ action: 'verify' })
    expect(verify.text).toContain('AC-1.1 passing (test/greet.test.js:1)')
    expect(JSON.parse(await readFile(join(dir, 'specs/greeter/trace.json'), 'utf8'))).toMatchObject({ spec: 'greeter', counts: { total: 3, passing: 2, untested: 1 } })
  })

  it('logs requirement changes by id, including edits made outside the app', async () => {
    const h = harness()
    await h.tool({ action: 'start', title: 'Greeter' })
    await h.write('specs/greeter/requirements.md', REQUIREMENTS)
    await h.tool({ action: 'submit', doc: 'requirements' })
    await h.postJson(APPROVE_ROUTE, { session: 's1', doc: 'requirements', sha256: (await h.get()).active.docs.requirements.sha256 })
    // The agent fixes drift on the spec side.
    await h.write('specs/greeter/requirements.md', `${REQUIREMENTS}\n### REQ-3: Wave\n- AC-3.1: WHEN asked THE SYSTEM SHALL wave.\n`)
    const note = await h.post('edit', { file_path: 'specs/greeter/requirements.md' })
    expect(note.additionalContexts[0].content[0].text).toContain('added REQ-3, AC-3.1')
    // The user edits the file in their editor: the panel only reads; the
    // agent's next request records it.
    await h.write('specs/greeter/requirements.md', REQUIREMENTS.replace('upper case', 'capitals'))
    expect((await h.get()).active.changes).toHaveLength(1)
    await h.assemble()
    const changes = (await h.get()).active.changes
    expect(changes.map((c) => [c.by, c.summary])).toEqual([
      ['agent', 'added REQ-3, AC-3.1.'],
      ['outside the app', 'removed REQ-3, AC-3.1; reworded AC-2.1.']
    ])
  })

  it('leaves conversations without a spec alone, and refuses cross-site posts', async () => {
    const h = harness()
    expect(await h.pre('write', { file_path: 'anything.js' })).toEqual({ kind: 'allow' })
    expect(await h.post('write', { file_path: 'anything.js' })).toEqual({ kind: 'accept' })
    await h.stopping(1)
    expect(h.agent.steered).toHaveLength(0)
    expect(await h.get()).toEqual({ active: null, specs: [] })
    await expect(h.tool({ action: 'status' })).rejects.toThrow('no active spec')
    const routes = harness()
    void routes
    expect(projectPath(dir, '../outside.js')).toBeUndefined()
    expect(projectPath(dir, join(dir, 'a', 'b.js'))).toBe('a/b.js')
  })
})

/** A spec through approval of all three documents, ready to build. */
async function approvedSpec(h) {
  await h.tool({ action: 'start', title: 'Greeter' })
  for (const [doc, text] of [['requirements', REQUIREMENTS], ['design', DESIGN], ['tasks', TASKS]]) {
    await h.write(`specs/greeter/${doc}.md`, text)
    await h.tool({ action: 'submit', doc })
    await h.postJson(APPROVE_ROUTE, { session: 's1', doc, sha256: (await h.get()).active.docs[doc].sha256 })
  }
  expect((await h.get()).active.phase).toBe('build')
}

describe('review fixes', () => {
  it('reads ids and outcomes carefully', () => {
    expect(idsIn('// covers AC-1.1.')).toEqual(['AC-1.1'])
    expect(idsIn('const req_1 = await request(app); AC-1.10.2')).toEqual([])
    expect(testRunFrom('npm test', ' ✓ AC-2.1 rejects failed logins\n ✓ AC-3.1 shows Error: banner\n × AC-1.2 empty\n[exit code: 1]', 1).failingIds).toEqual(['AC-1.2'])
    // No outcome yet: not a pass.
    expect(testRunFrom('npm test', 'partial\n[still running after 120000ms; moved to background job j1]', 1)).toBeUndefined()
    expect(testRunFrom('npm test', '[stopped: user]', 1)).toBeUndefined()
    expect(['.\\mvnw test', '.\\gradlew.bat test', './mvnw -q test'].map(isTestCommand)).toEqual([true, true, true])
  })

  it('records test runs from pwsh, skips background runs, and rescans tests the shell wrote', async () => {
    const h = harness()
    await approvedSpec(h)
    await h.post('bash', { command: 'npm test', run_in_background: true }, 'Started job j1')
    expect((await h.get()).active.trace.run).toBeNull()
    // Tests written by the shell (cat >, git checkout) count after the run.
    await h.write('test/greet.test.js', "test('AC-1.1 greets', () => {})\n")
    await h.post('pwsh', { command: 'npm test' }, 'ok\n')
    const view = (await h.get()).active.trace
    expect(view.run).toMatchObject({ ok: true, command: 'npm test' })
    expect(view.criteria.find((c) => c.id === 'AC-1.1').status).toBe('passing')
  })

  it('gates a subagent of the conversation like the conversation', async () => {
    const h = harness()
    await h.tool({ action: 'start', title: 'Greeter' })
    const sub = { session: { header: { id: 'sub-1', cwd: dir, parentSession: 's1' } } }
    expect(await h.pre('write', { file_path: 'greet.js' }, sub)).toMatchObject({ kind: 'deny' })
    expect(await h.pre('write', { file_path: 'specs/greeter/design.md' }, sub)).toEqual({ kind: 'allow' })
  })

  it('does not let the agent leave or switch the spec before the tasks are approved', async () => {
    const h = harness()
    await h.tool({ action: 'start', title: 'Greeter' })
    await expect(h.tool({ action: 'close' })).rejects.toThrow('only the user can stop or switch it')
    await expect(h.tool({ action: 'start', title: 'Other' })).rejects.toThrow('only the user')
    await expect(h.tool({ action: 'open', slug: '..' })).rejects.toThrow('not a spec folder name')
    expect((await h.postJson(ACTIVATE_ROUTE, { session: 's1', slug: '..' })).status).toBe(404)
    expect(await h.pre('write', { file_path: 'greet.js' })).toMatchObject({ kind: 'deny' })
    // The user can, from the panel.
    expect((await h.postJson(ACTIVATE_ROUTE, { session: 's1', slug: null })).status).toBe(200)
    expect(await h.pre('write', { file_path: 'greet.js' })).toEqual({ kind: 'allow' })
  })

  it('protects spec.json whatever its case', async () => {
    const h = harness()
    await h.tool({ action: 'start', title: 'Greeter' })
    expect(await h.pre('write', { file_path: 'specs/greeter/SPEC.JSON' })).toMatchObject({ kind: 'deny' })
    expect(await h.pre('write', { file_path: 'specs/Greeter/Trace.json' })).toMatchObject({ kind: 'deny' })
  })

  it('logs a shell edit of an approved document as the agent\'s', async () => {
    const h = harness()
    await approvedSpec(h)
    await h.write('specs/greeter/requirements.md', REQUIREMENTS.replace('upper case', 'capitals'))
    const note = await h.post('bash', { command: "sed -i 's/upper case/capitals/' specs/greeter/requirements.md" })
    expect(note.additionalContexts[0].content[0].text).toContain('reworded AC-2.1')
    expect((await h.get()).active.changes.map((c) => [c.by, c.summary])).toEqual([['agent (shell)', 'reworded AC-2.1.']])
  })

  it('steers on only after the turn did spec work, so a question or a pause is not overridden', async () => {
    const h = harness()
    await approvedSpec(h)
    h.turnStart(5)
    await h.stopping(5)
    expect(h.agent.steered).toHaveLength(0)
    await h.write('greet.js', 'x\n')
    await h.post('write', { file_path: 'greet.js' })
    await h.stopping(5)
    expect(h.agent.steered).toHaveLength(1)
    h.turnStart(6)
    await h.stopping(6)
    expect(h.agent.steered).toHaveLength(1)
  })

  it('keeps the specs of one project apart: only tests marked for this spec count', async () => {
    const h = harness()
    await approvedSpec(h)
    await mkdir(join(dir, 'specs', 'billing'), { recursive: true })
    await writeFile(join(dir, 'specs', 'billing', 'spec.json'), JSON.stringify({ version: 1, slug: 'billing', title: 'Billing', approvals: {}, awaiting: null, changes: [] }))
    await h.write('test/billing.test.js', "// spec: billing\ntest('AC-1.1 charges', () => {})\ntest('AC-5.1 refunds', () => {})\n")
    await h.write('test/greet.test.js', "// spec: greeter\ntest('AC-1.2 empty', () => {})\n")
    await h.post('write', { file_path: 'test/greet.test.js' })
    const trace = (await h.get()).active.trace
    expect(Object.fromEntries(trace.criteria.map((c) => [c.id, c.status]))).toEqual({ 'AC-1.1': 'untested', 'AC-1.2': 'not-run', 'AC-2.1': 'untested' })
    expect(trace.drift.filter((d) => d.kind === 'unknown-id')).toEqual([])
    expect(await h.assemble()).toContain('put "spec: greeter" in a comment')
  })
})
