/**
 * The context graph's local store: one SQLite file (Node's built-in
 * `node:sqlite`, with FTS5) holding every workspace's items, the files and
 * symbols they mention, and the links between them.
 *
 * An item is never rewritten into a vaguer version of itself: the model or
 * the user replaces it by id, and a replaced or deleted item stays in the
 * table (superseded_by / deleted_at) so its history can be shown.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const KINDS = ['rule', 'goal', 'decision', 'fact', 'task', 'error']
export const RELATIONS = ['about', 'depends-on', 'fixes', 'relates-to']
/** Kinds that belong to one conversation; the others are shared by the workspace. */
export const SESSION_KINDS = new Set(['goal', 'task'])
export const MAX_TEXT = 600
export const MAX_QUOTE = 600
export const MAX_FILES = 8
export const MAX_SYMBOLS = 8
export const MAX_PATH = 400

const SCHEMA_VERSION = 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  session_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  quote TEXT,
  status TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  confirmed_at INTEGER NOT NULL,
  source_compaction TEXT,
  superseded_by TEXT,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS nodes_live ON nodes (workspace, kind) WHERE superseded_by IS NULL AND deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS node_files (
  node_id TEXT NOT NULL,
  path TEXT NOT NULL,
  hash TEXT,
  size INTEGER,
  mtime_ms REAL,
  PRIMARY KEY (node_id, path)
);
CREATE INDEX IF NOT EXISTS node_files_path ON node_files (path);
CREATE TABLE IF NOT EXISTS node_symbols (node_id TEXT NOT NULL, symbol TEXT NOT NULL, PRIMARY KEY (node_id, symbol));
CREATE TABLE IF NOT EXISTS edges (src TEXT NOT NULL, dst TEXT NOT NULL, rel TEXT NOT NULL, PRIMARY KEY (src, dst, rel));
CREATE INDEX IF NOT EXISTS edges_dst ON edges (dst);
CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, workspace TEXT NOT NULL, root TEXT NOT NULL, seen_at INTEGER NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(node_id UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2');
`

/** A stable key for a workspace folder; the path itself is kept too, for display. */
export function workspaceKey(root) {
  return createHash('sha256').update(String(root)).digest('hex').slice(0, 24)
}

export function newNodeId(kind) {
  const prefix = { rule: 'r', goal: 'g', decision: 'd', fact: 'f', task: 't', error: 'e' }[kind] ?? 'n'
  return `${prefix}-${randomBytes(4).toString('hex')}`
}

/** FTS5 query from free text: each word as a quoted prefix term, any order. */
export function ftsQuery(text) {
  const words = String(text).toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []
  return words.slice(0, 12).map((word) => `"${word}"*`).join(' OR ')
}

function searchBody(node, files, symbols) {
  return [node.text, node.quote ?? '', files.join(' '), symbols.join(' '), files.map((path) => path.split('/').pop()).join(' ')].join('\n')
}

export class GraphStore {
  /** @param {string} path - database file, or ':memory:' in tests. */
  constructor(path, { now = Date.now } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.now = now
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = OFF;')
    this.db.exec(SCHEMA)
    const version = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('schema')?.value
    if (version === undefined) this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema', String(SCHEMA_VERSION))
    else if (Number(version) > SCHEMA_VERSION) throw new Error(`context graph store is from a newer app (schema ${version})`)
  }

  close() {
    this.db.close()
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Remember which workspace folder a conversation works in, for when it is not loaded. */
  rememberSession(sessionId, workspace, root) {
    this.db.prepare(`INSERT INTO sessions (session_id, workspace, root, seen_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET workspace = excluded.workspace, root = excluded.root, seen_at = excluded.seen_at`)
      .run(sessionId, workspace, root, this.now())
  }

  /** `{ workspace, root }` last seen for a conversation, or undefined. */
  sessionScope(sessionId) {
    const row = this.db.prepare('SELECT workspace, root FROM sessions WHERE session_id = ?').get(sessionId)
    return row === undefined ? undefined : { workspace: row.workspace, root: row.root }
  }

  /** One live item with its files, symbols and links, or undefined. */
  get(id) {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id)
    return row === undefined ? undefined : this.hydrate(row)
  }

  hydrate(row) {
    return this.hydrateMany([row])[0]
  }

  /** Rows to items, loading files, symbols and links for all of them in three queries. */
  hydrateMany(rows) {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const files = new Map()
    const symbols = new Map()
    const links = new Map()
    // SQLite allows at most 32766 bound values; chunk well below that.
    for (let start = 0; start < ids.length; start += 500) {
      const chunk = ids.slice(start, start + 500)
      const inChunk = new Set(chunk)
      const marks = chunk.map(() => '?').join(',')
      for (const file of this.db.prepare(`SELECT node_id, path, hash, size, mtime_ms FROM node_files WHERE node_id IN (${marks}) ORDER BY path`).all(...chunk)) {
        files.set(file.node_id, [...(files.get(file.node_id) ?? []), { path: file.path, ...(file.hash === null ? {} : { hash: file.hash }), ...(file.size === null ? {} : { size: file.size }), ...(file.mtime_ms === null ? {} : { mtimeMs: file.mtime_ms }) }])
      }
      for (const symbol of this.db.prepare(`SELECT node_id, symbol FROM node_symbols WHERE node_id IN (${marks}) ORDER BY symbol`).all(...chunk)) {
        symbols.set(symbol.node_id, [...(symbols.get(symbol.node_id) ?? []), symbol.symbol])
      }
      for (const edge of this.db.prepare(`SELECT src, dst, rel FROM edges WHERE src IN (${marks}) OR dst IN (${marks})`).all(...chunk, ...chunk)) {
        if (inChunk.has(edge.src)) links.set(edge.src, [...(links.get(edge.src) ?? []), { id: edge.dst, rel: edge.rel }])
        if (inChunk.has(edge.dst)) links.set(edge.dst, [...(links.get(edge.dst) ?? []), { id: edge.src, rel: edge.rel }])
      }
    }
    return rows.map((row) => ({
      id: row.id,
      workspace: row.workspace,
      ...(row.session_id === null ? {} : { sessionId: row.session_id }),
      kind: row.kind,
      text: row.text,
      ...(row.quote === null ? {} : { quote: row.quote }),
      ...(row.status === null ? {} : { status: row.status }),
      pinned: row.pinned === 1,
      origin: row.origin,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      confirmedAt: row.confirmed_at,
      ...(row.source_compaction === null ? {} : { sourceCompaction: row.source_compaction }),
      ...(row.superseded_by === null ? {} : { supersededBy: row.superseded_by }),
      ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at }),
      files: files.get(row.id) ?? [],
      symbols: symbols.get(row.id) ?? [],
      links: links.get(row.id) ?? []
    }))
  }

  /**
   * Live items of a workspace that a conversation can see: the workspace's
   * shared items plus that conversation's own goals and tasks.
   */
  live(workspace, sessionId, { kinds } = {}) {
    const rows = this.db.prepare(`SELECT * FROM nodes WHERE workspace = ? AND superseded_by IS NULL AND deleted_at IS NULL
      AND (session_id IS NULL OR session_id = ? OR kind NOT IN ('goal', 'task'))
      ORDER BY pinned DESC, updated_at DESC`).all(workspace, sessionId ?? '')
    return this.hydrateMany(rows.filter((row) => kinds === undefined || kinds.includes(row.kind)))
  }

  /**
   * What the per-request slice can show: every pinned item, rule and this
   * conversation's goal, plus the newest `limit` other open items. A big
   * graph is not loaded whole on every request.
   */
  forSection(workspace, sessionId, limit = 200) {
    const visible = `workspace = ? AND superseded_by IS NULL AND deleted_at IS NULL AND (session_id IS NULL OR session_id = ? OR kind NOT IN ('goal', 'task'))`
    const essential = this.db.prepare(`SELECT * FROM nodes WHERE ${visible} AND (pinned = 1 OR kind = 'rule' OR (kind = 'goal' AND session_id = ?))`).all(workspace, sessionId ?? '', sessionId ?? '')
    const rest = this.db.prepare(`SELECT * FROM nodes WHERE ${visible} AND pinned = 0 AND kind NOT IN ('rule', 'goal') AND NOT (kind = 'task' AND status = 'done') ORDER BY updated_at DESC LIMIT ?`).all(workspace, sessionId ?? '', limit)
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM nodes WHERE ${visible} AND pinned = 0 AND kind NOT IN ('rule', 'goal') AND NOT (kind = 'task' AND status = 'done')`).get(workspace, sessionId ?? '').n
    return { items: this.hydrateMany([...essential, ...rest]), unloaded: total - rest.length }
  }

  counts(workspace, sessionId) {
    const rows = this.db.prepare(`SELECT kind, COUNT(*) AS n FROM nodes WHERE workspace = ? AND superseded_by IS NULL AND deleted_at IS NULL
      AND (session_id IS NULL OR session_id = ? OR kind NOT IN ('goal', 'task')) GROUP BY kind`).all(workspace, sessionId ?? '')
    return Object.fromEntries(rows.map((row) => [row.kind, row.n]))
  }

  /**
   * Add or replace one item. `replaces` names an item this one supersedes
   * (the old row stays, marked). Files carry the fingerprint taken now.
   */
  put(item) {
    const now = this.now()
    const id = item.id ?? newNodeId(item.kind)
    const existing = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id)
    if (existing !== undefined && existing.workspace !== item.workspace) throw new Error(`item ${id} belongs to another workspace`)
    const sessionId = SESSION_KINDS.has(item.kind) ? item.sessionId ?? existing?.session_id ?? null : null
    if (existing === undefined) {
      this.db.prepare(`INSERT INTO nodes (id, workspace, session_id, kind, text, quote, status, pinned, origin, created_at, updated_at, confirmed_at, source_compaction)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, item.workspace, sessionId, item.kind, item.text, item.quote ?? null, item.status ?? null, item.pinned ? 1 : 0, item.origin, now, now, now, item.sourceCompaction ?? null)
    } else {
      this.db.prepare(`UPDATE nodes SET kind = ?, text = ?, quote = ?, status = ?, pinned = ?, origin = ?, updated_at = ?, confirmed_at = ?,
        source_compaction = COALESCE(?, source_compaction), session_id = ?, superseded_by = NULL, deleted_at = NULL WHERE id = ?`)
        .run(item.kind, item.text, item.quote ?? null, item.status ?? null, (item.pinned ?? existing.pinned === 1) ? 1 : 0, item.origin, now, now, item.sourceCompaction ?? null, sessionId, id)
    }
    if (item.files !== undefined) {
      this.db.prepare('DELETE FROM node_files WHERE node_id = ?').run(id)
      const insert = this.db.prepare('INSERT OR REPLACE INTO node_files (node_id, path, hash, size, mtime_ms) VALUES (?, ?, ?, ?, ?)')
      for (const file of item.files) insert.run(id, file.path, file.hash ?? null, file.size ?? null, file.mtimeMs ?? null)
    }
    if (item.symbols !== undefined) {
      this.db.prepare('DELETE FROM node_symbols WHERE node_id = ?').run(id)
      const insert = this.db.prepare('INSERT OR IGNORE INTO node_symbols (node_id, symbol) VALUES (?, ?)')
      for (const symbol of item.symbols) insert.run(id, symbol)
    }
    for (const link of item.links ?? []) {
      if (link.id === id) continue
      this.db.prepare('INSERT OR IGNORE INTO edges (src, dst, rel) VALUES (?, ?, ?)').run(id, link.id, link.rel)
    }
    for (const old of item.replaces ?? []) {
      if (old === id) continue
      this.db.prepare('UPDATE nodes SET superseded_by = ?, updated_at = ? WHERE id = ? AND workspace = ? AND superseded_by IS NULL').run(id, now, old, item.workspace)
      this.db.prepare('DELETE FROM nodes_fts WHERE node_id = ?').run(old)
    }
    this.reindex(id)
    return id
  }

  reindex(id) {
    this.db.prepare('DELETE FROM nodes_fts WHERE node_id = ?').run(id)
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id)
    if (row === undefined || row.superseded_by !== null || row.deleted_at !== null) return
    const files = this.db.prepare('SELECT path FROM node_files WHERE node_id = ?').all(id).map((file) => file.path)
    const symbols = this.db.prepare('SELECT symbol FROM node_symbols WHERE node_id = ?').all(id).map((symbol) => symbol.symbol)
    this.db.prepare('INSERT INTO nodes_fts (node_id, body) VALUES (?, ?)').run(id, searchBody(row, files, symbols))
  }

  link(src, dst, rel) {
    if (src === dst) return
    this.db.prepare('INSERT OR IGNORE INTO edges (src, dst, rel) VALUES (?, ?, ?)').run(src, dst, rel)
  }

  /** Whether the workspace has a replaced item of this kind with this text (case and spacing aside). */
  wasReplaced(workspace, kind, text) {
    const normal = text.toLowerCase().replace(/\s+/gu, ' ').trim()
    return this.db.prepare('SELECT text FROM nodes WHERE workspace = ? AND kind = ? AND superseded_by IS NOT NULL').all(workspace, kind)
      .some((row) => row.text.toLowerCase().replace(/\s+/gu, ' ').trim() === normal)
  }

  /** Mark an item as still true without changing it. */
  confirm(id) {
    this.db.prepare('UPDATE nodes SET confirmed_at = ? WHERE id = ?').run(this.now(), id)
  }

  remove(id, workspace) {
    const result = this.db.prepare('UPDATE nodes SET deleted_at = ?, updated_at = ? WHERE id = ? AND workspace = ? AND deleted_at IS NULL').run(this.now(), this.now(), id, workspace)
    this.db.prepare('DELETE FROM nodes_fts WHERE node_id = ?').run(id)
    return result.changes > 0
  }

  setPinned(id, workspace, pinned) {
    const result = this.db.prepare('UPDATE nodes SET pinned = ?, updated_at = ? WHERE id = ? AND workspace = ? AND deleted_at IS NULL AND superseded_by IS NULL')
      .run(pinned ? 1 : 0, this.now(), id, workspace)
    return result.changes > 0
  }

  /** Full-text search over live items visible to the conversation. */
  search(workspace, sessionId, text, limit = 20) {
    const query = ftsQuery(text)
    if (query === '') return []
    const ids = this.db.prepare('SELECT node_id FROM nodes_fts WHERE nodes_fts MATCH ? ORDER BY rank LIMIT ?').all(query, limit * 4).map((row) => row.node_id)
    return this.visible(ids, workspace, sessionId).slice(0, limit)
  }

  /** Live items that mention a file (exact path, or any path ending with it). */
  aboutFile(workspace, sessionId, path, limit = 20) {
    const ids = this.db.prepare("SELECT DISTINCT node_id FROM node_files WHERE path = ? OR path LIKE ? ESCAPE '\\' LIMIT ?")
      .all(path, `%/${path.replace(/[\\%_]/gu, (char) => `\\${char}`)}`, limit * 4).map((row) => row.node_id)
    return this.visible(ids, workspace, sessionId).slice(0, limit)
  }

  /** Live items linked to an item, or sharing one of its files or symbols. */
  neighbours(id, workspace, sessionId, limit = 20) {
    const ids = this.db.prepare(`SELECT dst AS id FROM edges WHERE src = ? UNION SELECT src FROM edges WHERE dst = ?
      UNION SELECT b.node_id FROM node_files a JOIN node_files b ON a.path = b.path WHERE a.node_id = ? AND b.node_id != ?
      UNION SELECT b.node_id FROM node_symbols a JOIN node_symbols b ON a.symbol = b.symbol WHERE a.node_id = ? AND b.node_id != ?`)
      .all(id, id, id, id, id, id).map((row) => row.id)
    return this.visible(ids, workspace, sessionId).slice(0, limit)
  }

  /** An item's history: the items it replaced, newest first. */
  history(id) {
    const chain = []
    let current = id
    for (let depth = 0; depth < 50; depth++) {
      const row = this.db.prepare('SELECT * FROM nodes WHERE superseded_by = ? ORDER BY updated_at DESC LIMIT 1').get(current)
      if (row === undefined) break
      chain.push(this.hydrate(row))
      current = row.id
    }
    return chain
  }

  /** The live, visible items among `ids`, in the order given. */
  visible(ids, workspace, sessionId) {
    const unique = [...new Set(ids)].slice(0, 2000)
    if (unique.length === 0) return []
    const rows = new Map()
    for (let start = 0; start < unique.length; start += 500) {
      const chunk = unique.slice(start, start + 500)
      for (const row of this.db.prepare(`SELECT * FROM nodes WHERE id IN (${chunk.map(() => '?').join(',')}) AND workspace = ? AND superseded_by IS NULL AND deleted_at IS NULL
        AND (session_id IS NULL OR session_id = ? OR kind NOT IN ('goal', 'task'))`).all(...chunk, workspace, sessionId ?? '')) rows.set(row.id, row)
    }
    return this.hydrateMany(unique.filter((id) => rows.has(id)).map((id) => rows.get(id)))
  }
}
