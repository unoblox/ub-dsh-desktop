/**
 * The three spec documents and what can be checked in them.
 *
 * requirements.md  `### REQ-1: Title`, a user story, then acceptance
 *                  criteria `- AC-1.1: WHEN … THE SYSTEM SHALL …` (EARS).
 * design.md        free form; it names the requirements it covers (REQ-1).
 * tasks.md         `- [ ] T-1: Title (REQ-1, AC-1.2)`; `[x]` when done.
 *
 * Parsing is lenient about heading levels and punctuation (models vary) and
 * strict about ids: every id is unique, every requirement has criteria,
 * every requirement is planned in a task, and nothing names an unknown id.
 */

export const DOCS = ['requirements', 'design', 'tasks']
export const DOC_FILES = { requirements: 'requirements.md', design: 'design.md', tasks: 'tasks.md' }

const REQ_HEADING = /^#{2,5}\s+(REQ-\d+)\b[\s:.–—-]*(.*)$/u
const AC_LINE = /\b(AC-(\d+)\.\d+)\b[\s:.)–—-]*(.*)$/u
const TASK_LINE = /^\s*[-*]\s+\[([ xX])\]\s+(T-\d+)\b[\s:.–—-]*(.*)$/u
const ANY_ID = /\b(?:REQ-\d+|AC-\d+\.\d+)\b/gu
const REQ_ID = /\bREQ-\d+\b/gu
// The angle-bracket blanks of TEMPLATES below.
const PLACEHOLDER = /<(?:short title|role|capability|benefit|trigger|observable response|task)>/gu
// EARS keeps each criterion testable: one SHALL (or MUST) per criterion.
const NORMATIVE = /\b(?:SHALL|MUST)\b/u

function clean(text) {
  return text.replace(/\*\*|__/gu, '').replace(/\s+/gu, ' ').trim()
}

/** `### REQ-n` sections with their acceptance criteria. */
export function parseRequirements(text) {
  const requirements = []
  let current
  let level = 0
  for (const raw of String(text ?? '').split('\n')) {
    const heading = REQ_HEADING.exec(raw)
    if (heading !== null) {
      level = raw.indexOf(' ')
      current = { id: heading[1], title: clean(heading[2] ?? ''), story: '', criteria: [] }
      requirements.push(current)
      continue
    }
    if (current === undefined) continue
    // A heading at the requirement's level or above ends it.
    const other = /^(#+)\s/u.exec(raw)
    if (other !== null && other[1].length <= level) {
      current = undefined
      continue
    }
    const ac = AC_LINE.exec(raw)
    if (ac !== null && /^\s*(?:[-*]|\d+[.)])\s/u.test(raw)) {
      current.criteria.push({ id: ac[1], reqNumber: ac[2], text: clean(ac[3] ?? '') })
      continue
    }
    const line = clean(raw.replace(/^\s*[-*>]\s*/u, ''))
    if (line !== '' && current.criteria.length === 0 && !/^acceptance criteria:?$/iu.test(line)) {
      current.story = current.story === '' ? line : `${current.story} ${line}`
    }
  }
  return requirements
}

/** `- [ ] T-n` lines, with the ids each one (and its indented lines) names. */
export function parseTasks(text) {
  const tasks = []
  let current
  for (const raw of String(text ?? '').split('\n')) {
    const task = TASK_LINE.exec(raw)
    if (task !== null) {
      current = { id: task[2], done: task[1] !== ' ', title: clean((task[3] ?? '').replace(/\((?:\s*(?:REQ-\d+|AC-\d+\.\d+)\s*,?)+\)\s*$/u, '')), refs: [...new Set(raw.match(ANY_ID) ?? [])] }
      tasks.push(current)
      continue
    }
    if (current !== undefined && /^\s{2,}\S/u.test(raw)) {
      for (const id of raw.match(ANY_ID) ?? []) if (!current.refs.includes(id)) current.refs.push(id)
    } else if (raw.trim() !== '') {
      current = undefined
    }
  }
  return tasks
}

/** The requirement ids the design names. */
export function parseDesign(text) {
  const body = String(text ?? '')
  return { covers: [...new Set(body.match(REQ_ID) ?? [])], length: body.trim().length }
}

function duplicates(ids) {
  const seen = new Set()
  const twice = new Set()
  for (const id of ids) (seen.has(id) ? twice : seen).add(id)
  return [...twice]
}

/** Every id the requirements define: REQ-n and AC-n.m. */
export function definedIds(requirements) {
  const ids = new Set()
  for (const requirement of requirements) {
    ids.add(requirement.id)
    for (const criterion of requirement.criteria) ids.add(criterion.id)
  }
  return ids
}

/**
 * Problems in one document, as `{ level: 'error' | 'warning', text }`.
 * Errors keep a document from being submitted for approval.
 * @param doc - 'requirements' | 'design' | 'tasks'.
 * @param texts - the documents' current text by name.
 */
export function validate(doc, texts) {
  const issues = []
  const error = (text) => issues.push({ level: 'error', text })
  const warn = (text) => issues.push({ level: 'warning', text })
  const requirements = parseRequirements(texts.requirements)
  const defined = definedIds(requirements)
  const left = [...new Set(String(texts[doc] ?? '').match(PLACEHOLDER) ?? [])]
  if (left.length > 0) error(`Template placeholders are still in ${DOC_FILES[doc]}: ${left.join(', ')}.`)
  if (doc === 'requirements') {
    if (requirements.length === 0) error('No requirements found. Write each as a heading "### REQ-1: Title".')
    for (const id of duplicates(requirements.map((r) => r.id))) error(`${id} is defined more than once.`)
    for (const id of duplicates(requirements.flatMap((r) => r.criteria.map((c) => c.id)))) error(`${id} is defined more than once.`)
    for (const requirement of requirements) {
      if (requirement.criteria.length === 0) error(`${requirement.id} has no acceptance criteria ("- AC-${requirement.id.slice(4)}.1: WHEN … THE SYSTEM SHALL …").`)
      if (requirement.title === '') warn(`${requirement.id} has no title.`)
      for (const criterion of requirement.criteria) {
        if (`REQ-${criterion.reqNumber}` !== requirement.id) warn(`${criterion.id} is listed under ${requirement.id}; number it AC-${requirement.id.slice(4)}.n.`)
        if (!NORMATIVE.test(criterion.text)) warn(`${criterion.id} has no SHALL: write it as "WHEN … THE SYSTEM SHALL …" so it can be tested.`)
      }
    }
  } else if (doc === 'design') {
    const design = parseDesign(texts.design)
    if (design.length < 40) error('The design is empty.')
    for (const id of design.covers) if (!defined.has(id)) error(`The design names ${id}, which the requirements do not define.`)
    for (const requirement of requirements) if (!design.covers.includes(requirement.id)) warn(`The design does not say how it meets ${requirement.id}.`)
  } else if (doc === 'tasks') {
    const tasks = parseTasks(texts.tasks)
    if (tasks.length === 0) error('No tasks found. Write each as "- [ ] T-1: Title (REQ-1)".')
    for (const id of duplicates(tasks.map((t) => t.id))) error(`${id} is defined more than once.`)
    const planned = new Set()
    for (const task of tasks) {
      if (task.refs.length === 0) warn(`${task.id} names no requirement.`)
      for (const ref of task.refs) {
        if (!defined.has(ref)) error(`${task.id} names ${ref}, which the requirements do not define.`)
        planned.add(ref.startsWith('AC-') ? `REQ-${ref.slice(3).split('.')[0]}` : ref)
      }
    }
    for (const requirement of requirements) if (!planned.has(requirement.id)) error(`No task builds ${requirement.id}.`)
  }
  return issues
}

/**
 * What changed between two versions of the requirements, by id: added,
 * removed, and requirements or criteria whose wording changed.
 */
export function diffRequirements(before, after) {
  const index = (requirements) => {
    const map = new Map()
    for (const requirement of requirements) {
      map.set(requirement.id, `${requirement.title}\n${requirement.story}`)
      for (const criterion of requirement.criteria) map.set(criterion.id, criterion.text)
    }
    return map
  }
  const a = index(parseRequirements(before))
  const b = index(parseRequirements(after))
  return {
    added: [...b.keys()].filter((id) => !a.has(id)),
    removed: [...a.keys()].filter((id) => !b.has(id)),
    changed: [...b.keys()].filter((id) => a.has(id) && a.get(id) !== b.get(id))
  }
}

/** A short, safe folder name for a spec. */
export function slugify(text) {
  const slug = String(text ?? '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/gu, '').trim().replace(/[\s_]+/gu, '-').replace(/-+/gu, '-').slice(0, 48).replace(/^-|-$/gu, '')
  return slug === '' ? 'feature' : slug
}

export const TEMPLATES = {
  requirements: (title) => `# ${title}: requirements

## Context

Who this is for, the problem it solves, and what is out of scope.

## Requirements

### REQ-1: <short title>

As a <role>, I want <capability>, so that <benefit>.

Acceptance criteria:

- AC-1.1: WHEN <trigger> THE SYSTEM SHALL <observable response>.
`,
  design: (title) => `# ${title}: design

## Overview

## Architecture

## Data and interfaces

## How each requirement is met

- REQ-1: …

## Decisions and trade-offs

## Testing approach
`,
  tasks: (title) => `# ${title}: tasks

Each task names the requirements and acceptance criteria it builds. Tick a task
([x]) when its code and tests are done and the tests pass.

- [ ] T-1: <task> (REQ-1, AC-1.1)
`
}
