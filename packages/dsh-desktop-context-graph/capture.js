/**
 * Capture at compaction: the instruction added to the Harness's own
 * compaction call, reading the model's graph changes out of its answer, and
 * removing them again before the summary is stored.
 *
 * The compaction call already reads the original messages it is about to
 * replace, so asking it for graph changes costs no extra model call. The
 * summary that gets stored is exactly what it would have been without the
 * graph block.
 */
import { KINDS, MAX_FILES, MAX_QUOTE, MAX_SYMBOLS, MAX_TEXT, RELATIONS } from './store.js'

export const DELTA_OPEN = '<context-graph-delta>'
export const DELTA_CLOSE = '</context-graph-delta>'
export const MAX_DELTA_ITEMS = 40
/** The heading that starts the graph's runtime-context section. */
export const SECTION_HEADING = '## Context graph'

/**
 * The text added after the Harness's compaction instruction.
 * @param {string} current - the current items as `[id] kind: text` lines, or ''.
 */
export function captureInstruction(current) {
  return [
    '',
    'ADDITIONALLY, after the checkpoint, record durable knowledge in the workspace context graph. It is kept outside the checkpoint and shown again after every compaction, so items there survive word for word.',
    `Append exactly one block: ${DELTA_OPEN} followed by one JSON object, then ${DELTA_CLOSE}. JSON shape:`,
    '{"items":[{"id":"existing id, only to update that item","kind":"rule|goal|decision|fact|task|error","text":"one self-contained sentence","quote":"rules only: the user\'s exact words, copied character for character from a user message","status":"open|done (tasks only)","files":["workspace-relative paths the item is about"],"symbols":["functions, classes, settings it is about"],"replaces":["ids this item makes obsolete"],"links":[{"to":"id, or #N for the Nth new item in this block","rel":"about|depends-on|fixes|relates-to"}]}],"confirm":["ids still true"],"remove":["ids now wrong"]}',
    'What to record: rule = a standing instruction or preference from the user (always with quote); goal = what this conversation is trying to achieve; decision = a choice made and why; fact = a verified fact about the code, environment or project that will matter later; task = work still to do (status done when finished); error = an error and its fix.',
    'Only record what will still matter many steps later. Do not record what is already in the graph unchanged; use "confirm" for that. Update by id instead of adding a near-duplicate. When something changed, update the item or add the new one with "replaces". Never invent quotes. Keep each text under 300 characters. At most 40 items.',
    current === '' ? 'The graph is empty so far.' : `Current graph items:\n${current}`,
    `The checkpoint itself need not repeat rules, decisions or facts that are in the graph; reference them by id when useful. Output the checkpoint first, then the ${DELTA_OPEN} block, nothing after it.`
  ].join('\n')
}

/**
 * Split the model's answer into the checkpoint text and the graph block.
 * @returns {{ summary: string, raw?: string }}: `raw` is the JSON text, when present.
 */
export function splitDelta(text) {
  const open = text.lastIndexOf(DELTA_OPEN)
  if (open < 0) return { summary: text }
  const close = text.indexOf(DELTA_CLOSE, open)
  const raw = text.slice(open + DELTA_OPEN.length, close < 0 ? undefined : close)
  const after = close < 0 ? '' : text.slice(close + DELTA_CLOSE.length)
  return { summary: `${text.slice(0, open).trimEnd()}${after.trim() === '' ? '' : `\n${after.trim()}`}`, raw: raw.trim() }
}

function clean(value, max) {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '').trim()
  return text === '' ? undefined : text.slice(0, max)
}

function strings(value, max, each) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => clean(item, each)).filter((item) => item !== undefined))].slice(0, max)
}

const ID = /^[a-z]-[0-9a-f]{8}$/u

/**
 * Validate the graph block. Malformed parts are dropped, never guessed.
 * @returns {{ items: object[], confirm: string[], remove: string[] } | undefined}
 */
export function parseDelta(raw) {
  if (raw === undefined) return undefined
  let value
  try {
    // Models sometimes fence the JSON.
    value = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gu, ''))
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const items = []
  for (const entry of Array.isArray(value.items) ? value.items.slice(0, MAX_DELTA_ITEMS) : []) {
    if (typeof entry !== 'object' || entry === null) continue
    const kind = KINDS.includes(entry.kind) ? entry.kind : undefined
    const text = clean(entry.text, MAX_TEXT)
    if (kind === undefined || text === undefined) continue
    const links = Array.isArray(entry.links) ? entry.links.filter((link) => typeof link === 'object' && link !== null && typeof link.to === 'string'
      && (ID.test(link.to) || /^#\d{1,2}$/u.test(link.to)) && RELATIONS.includes(link.rel)).slice(0, 12).map((link) => ({ to: link.to, rel: link.rel })) : []
    items.push({
      ...(typeof entry.id === 'string' && ID.test(entry.id) ? { id: entry.id } : {}),
      kind,
      text,
      ...(kind === 'rule' && clean(entry.quote, MAX_QUOTE) !== undefined ? { quote: clean(entry.quote, MAX_QUOTE) } : {}),
      ...(kind === 'task' ? { status: entry.status === 'done' ? 'done' : 'open' } : {}),
      files: strings(entry.files, MAX_FILES, 400),
      symbols: strings(entry.symbols, MAX_SYMBOLS, 120),
      replaces: strings(entry.replaces, 8, 20).filter((id) => ID.test(id)),
      links
    })
  }
  return {
    items,
    confirm: strings(value.confirm, 200, 20).filter((id) => ID.test(id)),
    remove: strings(value.remove, 100, 20).filter((id) => ID.test(id))
  }
}

/** Straight quotes and single spaces, so a quote matches across formatting. */
export function normalizeQuote(text) {
  return String(text).replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/[–—]/gu, '-').replace(/\s+/gu, ' ').trim()
}

/**
 * The text of the user's own messages in a model request: injected context
 * (runtime context, skill list, project instructions, checkpoints) does not
 * count, so a quote is only accepted when the user really wrote it.
 */
export function userWords(messages) {
  const texts = []
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role !== 'user' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      const text = block.text
      if (text.startsWith('Current runtime context.') || text.startsWith('<system-reminder>') || text.includes('<compacted-summary>') || text.includes(SECTION_HEADING)) continue
      texts.push(normalizeQuote(text))
    }
  }
  return texts
}

/**
 * Everything the user typed in a conversation, from its full event log
 * (compaction replaces messages on the model's view, never in the log), so
 * a rule can be quoted exactly even after its message was summarized away.
 */
export function sessionUserWords(session) {
  let events
  try {
    events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : []
  } catch {
    return []
  }
  return userWords(events
    .filter((event) => event?.type === 'user/message' && event.data?.source?.kind === 'user')
    .map((event) => ({ role: 'user', content: event.data.content })))
}

export function quoteIsVerbatim(quote, words) {
  const needle = normalizeQuote(quote)
  return needle.length >= 3 && words.some((text) => text.includes(needle))
}

/**
 * Pass a compaction stream through, but hold it until it ends so the graph
 * block can be cut out of the text before the Harness assembles the summary.
 * Text blocks are re-emitted as one delta each; everything else unchanged.
 * @param stream - the adapter's chunk stream.
 * @param onText - receives the full answer text; returns the text to keep.
 */
export async function* rewriteText(stream, onText) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  const textByIndex = new Map()
  const order = []
  for (const chunk of chunks) {
    if (chunk.type === 'text-delta') {
      if (!textByIndex.has(chunk.index)) { textByIndex.set(chunk.index, ''); order.push(chunk.index) }
      textByIndex.set(chunk.index, textByIndex.get(chunk.index) + chunk.text)
    } else if (chunk.type === 'block-end' && chunk.block?.type === 'text') {
      if (!textByIndex.has(chunk.index)) order.push(chunk.index)
      textByIndex.set(chunk.index, chunk.block.text)
    }
  }
  const full = order.map((index) => textByIndex.get(index)).join('')
  const kept = await onText(full)
  if (kept === full || order.length === 0) {
    yield* chunks
    return
  }
  // All kept text goes to the first text block; any other text blocks end empty.
  const replacement = new Map(order.map((index, position) => [index, position === 0 ? kept : '']))
  const emitted = new Set()
  // A text block that never ended still delivers its kept text, before the finish.
  function* unended() {
    for (const index of order) {
      if (emitted.has(index)) continue
      emitted.add(index)
      if (replacement.get(index) !== '') yield { type: 'text-delta', index, text: replacement.get(index) }
    }
  }
  for (const chunk of chunks) {
    if (chunk.type === 'text-delta') continue
    if (chunk.type === 'block-end' && replacement.has(chunk.index)) {
      const text = replacement.get(chunk.index)
      if (!emitted.has(chunk.index) && text !== '') yield { type: 'text-delta', index: chunk.index, text }
      emitted.add(chunk.index)
      yield { ...chunk, block: { ...chunk.block, text } }
      continue
    }
    if (chunk.type === 'finish') yield* unended()
    yield chunk
  }
  yield* unended()
}
