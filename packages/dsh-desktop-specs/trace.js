/**
 * Requirements ↔ code ↔ tests, and the drift between them.
 *
 * - Tests name the criteria they check: `AC-1.1` in a test name or comment
 *   (or `ac_1_1`, for languages whose test names cannot hold "-" or ".").
 * - Code is linked through tasks: files changed while a task was open are
 *   recorded against it when it is ticked done, so code needs no id comments.
 * - Test runs are the agent's own commands (`npm test`, `pytest`, …) and
 *   their exit codes, read from the tool results; nothing here runs anything.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { definedIds, parseRequirements, parseTasks } from './parse.js'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.venv', 'venv', '__pycache__', 'target', 'vendor', '.unoblox', 'specs', '.idea', '.vscode'])
const MAX_FILES = 4000
// Directory entries read in one scan, so a large repository with few tests stays cheap.
const MAX_ENTRIES = 40000
const MAX_FILE_BYTES = 512 * 1024
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|spec|e2e)\/|[._-](?:test|spec)\.[a-z0-9]+$|(?:^|\/)test_[^/]+\.py$|_test\.(?:go|py|rb|exs?)$|Tests?\.(?:java|kt|cs|swift)$/iu
const CODE_EXT = /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|cs|swift|php|exs?|scala|c|cc|cpp|h|hpp|vue|svelte)$/iu
// AC-1.1, ac_1_1, AC_1_1; REQ-1, req_1.
// Not \b: test_ac_1_1_greets has no word boundary around the id. A
// sentence's full stop after an id is fine (AC-1.1.), a further number is not.
const AC_ANY = /(?<![A-Za-z0-9])[Aa][Cc][-_](\d+)[._](\d+)(?!\d|\.\d)/gu
// Requirements only as REQ-1 or REQ_1: lower-case req_1 is a common variable name.
const REQ_ANY = /(?<![A-Za-z0-9])REQ[-_](\d+)(?!\d|\.\d)/gu
// A test file says which spec it belongs to when a project has several.
const OWNER = /\bspec:\s*([a-z0-9][a-z0-9-]{0,47})\b/gu

export function isTestPath(path) {
  return TEST_PATH.test(path) && CODE_EXT.test(path)
}

/** The spec ids a piece of text names, in their canonical form. */
export function idsIn(text) {
  const ids = new Set()
  for (const match of String(text ?? '').matchAll(AC_ANY)) ids.add(`AC-${match[1]}.${match[2]}`)
  for (const match of String(text ?? '').matchAll(REQ_ANY)) ids.add(`REQ-${match[1]}`)
  return [...ids]
}

async function walk(root, dir, out, budget) {
  if (out.length >= MAX_FILES || budget.left <= 0) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  budget.left -= entries.length
  for (const entry of entries) {
    if (out.length >= MAX_FILES || budget.left <= 0) return
    if (entry.name.startsWith('.') && entry.name !== '.github') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(root, path, out, budget)
    } else if (entry.isFile()) {
      const rel = relative(root, path).split(sep).join('/')
      if (isTestPath(rel)) out.push(rel)
    }
  }
}

/**
 * Every spec id the project's test files name, with where, and which spec
 * each file says it belongs to (`spec: <slug>` in a comment).
 */
export async function scanTests(root) {
  const files = []
  const budget = { left: MAX_ENTRIES }
  await walk(root, root, files, budget)
  const refs = new Map()
  const owners = new Map()
  for (const file of files) {
    let text
    try {
      if ((await stat(join(root, file))).size > MAX_FILE_BYTES) continue
      text = await readFile(join(root, file), 'utf8')
    } catch {
      continue
    }
    const owned = [...text.matchAll(OWNER)].map((match) => match[1])
    if (owned.length > 0) owners.set(file, new Set(owned))
    const lines = text.split('\n')
    for (let index = 0; index < lines.length; index++) {
      for (const id of idsIn(lines[index])) {
        const list = refs.get(id) ?? []
        if (list.length < 20) list.push({ file, line: index + 1 })
        refs.set(id, list)
      }
    }
  }
  return { files: files.length, refs, owners, truncated: budget.left <= 0 || files.length >= MAX_FILES }
}

/**
 * The part of a scan that counts for one spec. With one spec in the project
 * every test file counts; with several, only files marked `spec: <slug>`
 * (the ids of different specs overlap: each starts at REQ-1).
 */
export function scanFor(scan, slug, specCount) {
  if (specCount <= 1) return scan
  const refs = new Map()
  for (const [id, places] of scan.refs) {
    const mine = places.filter((place) => scan.owners.get(place.file)?.has(slug) === true)
    if (mine.length > 0) refs.set(id, mine)
  }
  return { ...scan, refs }
}

// The usual test runners; a project script named test counts too.
const TEST_COMMAND = /(?:^|[\s;&|(])(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|npx\s+(?:vitest|jest|mocha|playwright\s+test)\b|vitest\b|jest\b|mocha\b|pytest\b|python3?\s+-m\s+(?:pytest|unittest)\b|go\s+test\b|cargo\s+test\b|(?:mvn|\.[\\/]mvnw(?:\.cmd)?)\s+(?:\S+\s+)*test\b|(?:gradle|\.[\\/]gradlew(?:\.bat)?)\s+(?:\S+\s+)*test\b|dotnet\s+test\b|rspec\b|bundle\s+exec\s+rspec\b|mix\s+test\b|phpunit\b|swift\s+test\b|deno\s+test\b|node\s+--test\b|make\s+test\b)/u

export function isTestCommand(command) {
  return typeof command === 'string' && TEST_COMMAND.test(command)
}

// Lines that report one failing test, in the common runners' formats.
const FAIL_LINE = /(?:^|\s)(?:✕|✖|×|✗|✘|FAIL(?:ED)?\b|not ok\b|--- FAIL|[Ff]ailed\b|Error:|AssertionError|panicked)/u
// A passing test's line ("✓ AC-2.1 rejects failed logins") is never a failure.
const PASS_LINE = /^\s*(?:✓|✔|√|ok\s+\d|PASS\b|--- PASS|\[\s*OK\s*\])/u
// A command still running, moved to the background or stopped has no outcome yet.
const UNFINISHED = /\[still running after|moved to background job|\[stopped:/u

/**
 * One test run from the shell tool's result text, or undefined while the
 * command has no outcome (still running, in the background, stopped). The shell result ends
 * with `[exit code: N]` unless the command succeeded; timeouts and signals
 * are failures.
 */
export function testRunFrom(command, output, at) {
  const text = String(output ?? '')
  if (UNFINISHED.test(text)) return undefined
  const code = /\[exit code: (-?\d+)\]/u.exec(text)
  const killed = /\[(?:timed out|timeout|killed|signal)[^\]]*\]/iu.test(text)
  const ok = code === null && !killed
  const failingIds = new Set()
  if (!ok) {
    for (const line of text.split('\n')) if (FAIL_LINE.test(line) && !PASS_LINE.test(line)) for (const id of idsIn(line)) failingIds.add(id)
  }
  const tail = text.trim().split('\n').slice(-12).join('\n').slice(-1500)
  return { at, command: command.slice(0, 300), ok, exitCode: code === null ? (killed ? null : 0) : Number(code[1]), failingIds: [...failingIds], tail }
}

/**
 * Each criterion's standing:
 *   untested  no test names it
 *   not-run   tests name it, no test run since this conversation started
 *   failing   the last run failed and named it (or failed without naming any)
 *   stale     the last run passed, but code changed after it
 *   passing   the last run passed after the last change
 */
export function criterionStatus(id, { refs, run, lastChangeAt }) {
  const tests = refs.get(id) ?? refs.get(`REQ-${id.slice(3).split('.')[0]}`) ?? []
  if (tests.length === 0) return 'untested'
  if (run === undefined) return 'not-run'
  if (!run.ok) return run.failingIds.length === 0 || run.failingIds.includes(id) || run.failingIds.includes(`REQ-${id.slice(3).split('.')[0]}`) ? 'failing' : (run.at >= lastChangeAt ? 'passing' : 'stale')
  return run.at >= lastChangeAt ? 'passing' : 'stale'
}

/** The criteria a task builds: those it names, or all of a requirement it names. */
export function criteriaOfTask(task, requirements) {
  const ids = new Set()
  for (const ref of task.refs) {
    if (ref.startsWith('AC-')) ids.add(ref)
    else for (const criterion of requirements.find((r) => r.id === ref)?.criteria ?? []) ids.add(criterion.id)
  }
  return [...ids]
}

/**
 * The trace and the drift findings for a spec.
 * @param texts - the three documents.
 * @param scan - scanTests() result.
 * @param run - the last test run, if any.
 * @param lastChangeAt - when code or tests last changed.
 * @param taskFiles - task id → files changed for it.
 * @param otherIds - ids other specs of the project define (not unknown here).
 */
export function buildTrace({ texts, scan, run, lastChangeAt = 0, taskFiles = {}, otherIds = new Set() }) {
  const requirements = parseRequirements(texts.requirements)
  const tasks = parseTasks(texts.tasks)
  const defined = definedIds(requirements)
  const status = new Map()
  const criteria = []
  for (const requirement of requirements) {
    for (const criterion of requirement.criteria) {
      const value = criterionStatus(criterion.id, { refs: scan.refs, run, lastChangeAt })
      status.set(criterion.id, value)
      criteria.push({
        id: criterion.id,
        requirement: requirement.id,
        text: criterion.text,
        status: value,
        tests: (scan.refs.get(criterion.id) ?? []).slice(0, 5),
        tasks: tasks.filter((task) => criteriaOfTask(task, requirements).includes(criterion.id)).map((task) => task.id)
      })
    }
  }
  const drift = []
  const add = (kind, ids, text, fix) => drift.push({ kind, ids, text, fix })
  for (const [id, places] of scan.refs) {
    if (!defined.has(id) && !otherIds.has(id)) add('unknown-id', [id], `${places[0].file}:${String(places[0].line)} names ${id}, which the requirements do not define.`, 'Retag the test with the criterion it checks, or add the requirement if the behaviour is wanted.')
  }
  for (const task of tasks) {
    for (const ref of task.refs) if (!defined.has(ref)) add('plan', [task.id, ref], `${task.id} names ${ref}, which the requirements no longer define.`, 'Update tasks.md to the current requirements.')
  }
  const planned = new Set(tasks.flatMap((task) => criteriaOfTask(task, requirements)))
  for (const requirement of requirements) {
    for (const criterion of requirement.criteria) if (!planned.has(criterion.id)) add('plan', [criterion.id], `${criterion.id} is in the requirements but no task builds it.`, 'Add it to a task in tasks.md.')
  }
  for (const task of tasks.filter((t) => t.done)) {
    const ids = criteriaOfTask(task, requirements)
    const untested = ids.filter((id) => status.get(id) === 'untested')
    const failing = ids.filter((id) => status.get(id) === 'failing')
    if (untested.length > 0) add('untested', [task.id, ...untested], `${task.id} is ticked done, but no test checks ${untested.join(', ')}.`, `Write tests named for ${untested.join(', ')} and run them.`)
    if (failing.length > 0) add('failing', [task.id, ...failing], `${task.id} is ticked done, but the last test run failed for ${failing.join(', ')}.`, 'Fix the code (or the test, if the test is wrong) until it passes, then run the tests again.')
    // Done means tested: a tick with no passing run since the last change is unverified.
    const unverified = ids.filter((id) => status.get(id) === 'not-run' || status.get(id) === 'stale')
    if (unverified.length > 0) add('unverified', [task.id, ...unverified], `${task.id} is ticked done, but ${unverified.join(', ')} ${unverified.length === 1 ? 'has' : 'have'} no passing test run since the last change.`, 'Run the tests. If they cannot run here, say so to the user instead of ticking the task.')
  }
  if (run !== undefined && !run.ok && run.failingIds.length === 0 && tasks.some((t) => t.done)) {
    add('failing', [], `The last test run (${run.command}) failed.`, 'Fix the failures and run the tests again.')
  }
  const counts = { total: criteria.length, passing: 0, failing: 0, stale: 0, untested: 0, 'not-run': 0 }
  for (const criterion of criteria) counts[criterion.status]++
  return {
    requirements: requirements.map((r) => ({ id: r.id, title: r.title, criteria: r.criteria.length })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, done: t.done, refs: t.refs, files: taskFiles[t.id] ?? [] })),
    criteria,
    counts,
    drift,
    run: run === undefined ? null : { at: run.at, command: run.command, ok: run.ok, failingIds: run.failingIds }
  }
}
