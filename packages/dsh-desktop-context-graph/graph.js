/**
 * The context graph's behaviour over the store: applying the changes a
 * compaction recorded, the slice shown to the model on every request, and
 * lookups for the `context_lookup` tool and the Context panel.
 */
import { fileState, fingerprint, workspacePath } from './freshness.js'
import { quoteIsVerbatim, SECTION_HEADING } from './capture.js'
import { workspaceKey } from './store.js'

/** Characters of graph shown on every request (about 1,500 tokens). */
export const DEFAULT_BUDGET = 6000
/** Items listed for the compaction call to update by id. */
export const MAX_CURRENT_ITEMS = 150

const KIND_ORDER = ['rule', 'goal', 'task', 'decision', 'error', 'fact']
const HEADINGS = { rule: 'Rules (the user\'s words)', goal: 'Goal', task: 'Open tasks', decision: 'Decisions', error: 'Errors and fixes', fact: 'Facts' }

function sameText(a, b) {
  return a.toLowerCase().replace(/\s+/gu, ' ').trim() === b.toLowerCase().replace(/\s+/gu, ' ').trim()
}

export function scopeOf(root, sessionId) {
  return { root, workspace: workspaceKey(root), sessionId }
}

/** `[id] kind: text` lines for the compaction call, newest first. */
export function currentItems(store, scope) {
  const items = store.live(scope.workspace, scope.sessionId)
  const shown = items.slice(0, MAX_CURRENT_ITEMS).map((item) => `[${item.id}] ${item.kind}${item.status === 'done' ? ' (done)' : ''}: ${item.quote === undefined ? item.text : `"${item.quote}"`}`)
  if (items.length > MAX_CURRENT_ITEMS) shown.push(`(${String(items.length - MAX_CURRENT_ITEMS)} older items are kept too; they are not listed here.)`)
  return shown.join('\n')
}

/**
 * Apply one compaction's changes. The user's own edits win: the model can
 * confirm them or mark a task done, but not reword or remove them, and it
 * cannot remove a pinned item.
 * @param words - the user's own message text in the compacted span, for quote checks.
 */
export async function applyDelta(store, scope, delta, { words, compactionId } = {}) {
  const stats = { added: 0, updated: 0, confirmed: 0, removed: 0, quotesRejected: 0, staleRejected: 0 }
  if (delta === undefined) return stats
  const live = store.live(scope.workspace, scope.sessionId)
  const prepared = []
  for (const item of delta.items) {
    let existing = item.id === undefined ? undefined : store.get(item.id)
    if (existing !== undefined && (existing.workspace !== scope.workspace || existing.deletedAt !== undefined)) existing = undefined
    // A restated item updates the one already there instead of duplicating it.
    existing ??= live.find((candidate) => candidate.kind === item.kind && sameText(candidate.text, item.text))
    // Something already replaced does not come back as new: a stale summary
    // repeating it is the drift this graph exists to stop. To make it true
    // again, the model updates the current item by id.
    if (existing === undefined && store.wasReplaced(scope.workspace, item.kind, item.text)) { stats.staleRejected++; continue }
    let quote
    if (item.kind === 'rule' && item.quote !== undefined) {
      if (quoteIsVerbatim(item.quote, words ?? [])) quote = item.quote
      else stats.quotesRejected++
    }
    quote ??= existing?.kind === 'rule' ? existing.quote : undefined
    const files = []
    for (const path of item.files) {
      const relative = workspacePath(scope.root, path)
      if (relative === undefined) continue
      const print = await fingerprint(scope.root, relative)
      files.push(print.missing ? { path: relative } : print)
    }
    prepared.push({ item, existing, quote, files })
  }
  const ids = store.transaction(() => {
    const created = []
    for (const { item, existing, quote, files } of prepared) {
      if (existing?.origin === 'user') {
        store.confirm(existing.id)
        if (item.kind === 'task' && existing.kind === 'task' && item.status !== existing.status) store.put({ ...existing, workspace: scope.workspace, status: item.status, origin: 'user' })
        created.push(existing.id)
        stats.confirmed++
        continue
      }
      const id = store.put({
        ...(existing === undefined ? {} : { id: existing.id }),
        workspace: scope.workspace,
        sessionId: scope.sessionId,
        kind: item.kind,
        text: item.text,
        ...(quote === undefined ? {} : { quote }),
        ...(item.status === undefined ? {} : { status: item.status }),
        files,
        symbols: item.symbols,
        replaces: item.replaces.filter((old) => old !== existing?.id && store.get(old)?.origin !== 'user'),
        origin: 'model',
        ...(compactionId === undefined ? {} : { sourceCompaction: compactionId })
      })
      created.push(id)
      if (existing === undefined) stats.added++
      else stats.updated++
    }
    // Links can point at items added in the same block (#N).
    prepared.forEach(({ item }, position) => {
      for (const link of item.links) {
        const target = link.to.startsWith('#') ? created[Number(link.to.slice(1))] : link.to
        const known = target === undefined ? undefined : store.get(target)
        if (known !== undefined && known.workspace === scope.workspace) store.link(created[position], known.id, link.rel)
      }
    })
    for (const id of delta.confirm) {
      const item = store.get(id)
      if (item !== undefined && item.workspace === scope.workspace) { store.confirm(id); stats.confirmed++ }
    }
    for (const id of delta.remove) {
      const item = store.get(id)
      if (item === undefined || item.origin === 'user' || item.pinned) continue
      if (store.remove(id, scope.workspace)) stats.removed++
    }
    return created
  })
  return { ...stats, ids }
}

/** File states for an item: `[{ path, state }]`. */
export async function fileStates(root, item) {
  const states = []
  for (const file of item.files) states.push({ path: file.path, state: await fileState(root, file) })
  return states
}

function fileNote(states) {
  if (states.length === 0) return ''
  const parts = states.map(({ path, state }) => state === 'changed'
    ? `${path} (changed since recorded: re-read before relying on this)`
    : state === 'missing' ? `${path} (no longer exists)` : path)
  return ` — files: ${parts.join(', ')}`
}

function itemLine(item, states) {
  const body = item.kind === 'rule'
    ? item.quote === undefined ? `${item.text} (paraphrased)` : `"${item.quote}"${sameText(item.quote, item.text) ? '' : ` (${item.text})`}`
    : item.text
  return `- [${item.id}]${item.pinned ? ' (pinned)' : ''} ${body}${fileNote(states)}`
}

/**
 * The section shown to the model on every request, or '' when the graph has
 * nothing for this conversation. Deterministic for an unchanged graph and
 * unchanged files, so the runtime context is not re-sent every step.
 */
export async function renderSection(store, scope, { budget = DEFAULT_BUDGET } = {}) {
  const { items, unloaded } = store.forSection(scope.workspace, scope.sessionId)
  if (items.length === 0) return ''
  const rank = (item) => item.pinned ? -1 : KIND_ORDER.indexOf(item.kind)
  // Within a kind: newest first for choosing what fits, then shown oldest first.
  const ordered = [...items].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
  const header = [
    SECTION_HEADING,
    'Durable knowledge for this workspace, kept across compactions and conversations. [ids] identify items.',
    'A file marked "changed since recorded" was edited after the item was written: re-read it before relying on the item.',
    'Search all items (by words, file path or id, with their links) with the context_lookup tool before re-reading files or asking the user about something already settled.'
  ].join('\n')
  // Room for the closing "more items" line.
  let used = header.length + 80
  const chosen = []
  let hidden = unloaded
  let full = false
  for (const item of ordered) {
    // Pinned items, rules and the goal always show, up to twice the budget.
    const essential = item.pinned || item.kind === 'rule' || item.kind === 'goal'
    // Once the budget is spent, the rest are only counted: no file checks.
    if (full && !essential) { hidden++; continue }
    const states = await fileStates(scope.root, item)
    const line = itemLine(item, states)
    if (used + line.length + 1 > (essential ? budget * 2 : budget)) {
      hidden++
      if (!essential) full = true
      continue
    }
    used += line.length + 1
    chosen.push({ item, line })
  }
  const groups = []
  const pinned = chosen.filter(({ item }) => item.pinned)
  if (pinned.length > 0) groups.push(['Pinned', pinned])
  for (const kind of KIND_ORDER) {
    const group = chosen.filter(({ item }) => !item.pinned && item.kind === kind)
    if (group.length > 0) groups.push([HEADINGS[kind], group.sort((a, b) => a.item.createdAt - b.item.createdAt || a.item.id.localeCompare(b.item.id))])
  }
  const body = groups.map(([title, group]) => `${title}:\n${group.map(({ line }) => line).join('\n')}`).join('\n')
  const more = hidden > 0 ? `\n(${String(hidden)} more items are not shown here; use context_lookup.)` : ''
  return `${header}\n${body}${more}`
}

/**
 * Answer a lookup: by id (the item, its history and neighbours), by file, or
 * by words. Returns plain text for the model.
 */
export async function lookup(store, scope, { query, file, id, limit = 12 }) {
  const lines = []
  const describe = async (item) => itemLine(item, await fileStates(scope.root, item)).replace(/^- /u, '')
  if (id !== undefined) {
    const item = store.get(id)
    if (item === undefined || item.workspace !== scope.workspace) return `No item ${id} in this workspace.`
    if (item.supersededBy !== undefined) lines.push(`${id} was replaced by ${item.supersededBy}.`)
    if (item.deletedAt !== undefined) lines.push(`${id} was removed.`)
    lines.push(`${item.kind}: ${await describe(item)}`)
    if (item.symbols.length > 0) lines.push(`symbols: ${item.symbols.join(', ')}`)
    const earlier = store.history(id)
    if (earlier.length > 0) lines.push('Earlier versions:', ...earlier.map((old) => `- [${old.id}] ${old.quote ?? old.text}`))
    const near = store.neighbours(id, scope.workspace, scope.sessionId, limit)
    if (near.length > 0) lines.push('Linked or about the same files:', ...await Promise.all(near.map(async (other) => `- ${other.kind}: ${await describe(other)}`)))
    return lines.join('\n')
  }
  const found = []
  if (file !== undefined) found.push(...store.aboutFile(scope.workspace, scope.sessionId, workspacePath(scope.root, file) ?? file, limit))
  if (query !== undefined) found.push(...store.search(scope.workspace, scope.sessionId, query, limit))
  const unique = [...new Map(found.map((item) => [item.id, item])).values()].slice(0, limit)
  if (unique.length === 0) return 'Nothing in the context graph matches.'
  for (const item of unique) lines.push(`- ${item.kind}: ${await describe(item)}`)
  return lines.join('\n')
}
