/**
 * File fingerprints, so an item about a file can say when the file changed
 * after it was recorded. Only files inside the workspace are looked at, and
 * only their size, modification time and SHA-256: never their contents
 * beyond hashing them.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Larger files are compared by size and modification time only. */
export const MAX_HASH_BYTES = 8 * 1024 * 1024

/**
 * The workspace-relative form of a path the model wrote, or undefined when
 * it points outside the workspace (or is not a plausible path at all).
 */
export function workspacePath(root, path) {
  if (typeof path !== 'string') return undefined
  const trimmed = path.trim().replace(/^`|`$/gu, '')
  if (trimmed === '' || trimmed.length > 400 || trimmed.includes('\0') || /^[a-z]+:\/\//iu.test(trimmed)) return undefined
  const absolute = isAbsolute(trimmed) ? trimmed : resolve(root, trimmed)
  const inside = relative(root, absolute)
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return undefined
  return inside.split(sep).join('/')
}

function hashFile(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    createReadStream(path).on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolvePromise(hash.digest('hex')))
  })
}

/**
 * Fingerprint one workspace file: `{ path, hash?, size, mtimeMs }`, or
 * `{ path, missing: true }`. A symlink that leads outside the workspace is
 * treated as missing rather than followed.
 */
export async function fingerprint(root, path) {
  const absolute = resolve(root, path)
  let info
  try {
    const real = await realpath(absolute)
    const realRoot = await realpath(root)
    const inside = relative(realRoot, real)
    if (inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside)) return { path, missing: true }
    info = await stat(real)
    if (!info.isFile()) return { path, missing: true }
    const hash = info.size <= MAX_HASH_BYTES ? await hashFile(real) : undefined
    return { path, size: info.size, mtimeMs: info.mtimeMs, ...(hash === undefined ? {} : { hash }) }
  } catch {
    return { path, missing: true }
  }
}

/**
 * Whether a file still matches the fingerprint recorded with an item:
 * 'same', 'changed', 'missing', or 'unknown' when nothing was recorded.
 * Size and time are checked first, so an unchanged file is not re-hashed.
 */
export async function fileState(root, recorded) {
  if (recorded.hash === undefined && recorded.size === undefined) return 'unknown'
  const absolute = resolve(root, recorded.path)
  let info
  try {
    info = await stat(absolute)
  } catch {
    return 'missing'
  }
  if (!info.isFile()) return 'missing'
  if (info.size === recorded.size && info.mtimeMs === recorded.mtimeMs) return 'same'
  if (recorded.hash === undefined || info.size > MAX_HASH_BYTES) return 'changed'
  const current = await fingerprint(root, recorded.path)
  return current.hash === recorded.hash ? 'same' : 'changed'
}
