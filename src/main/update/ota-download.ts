import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_ALLOWED_HOSTS, isAllowedUpdateUrl, type UpdateFile } from './ota-manifest'

export type UpdateFetch = (url: string, init: RequestInit) => Promise<Response>

const MANIFEST_TIMEOUT_MS = 20_000
const MAX_MANIFEST_BYTES = 256 * 1024
// A stalled download fails instead of hanging the updater for good.
const IDLE_TIMEOUT_MS = 60_000

/** Fetch the manifest text. Redirects may only land on an allowed host. */
export async function fetchManifestText(
  fetchImpl: UpdateFetch,
  url: string,
  allowedHosts: readonly string[] = DEFAULT_ALLOWED_HOSTS
): Promise<string> {
  if (!isAllowedUpdateUrl(url, allowedHosts)) throw new Error('update feed URL is not allowed')
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS)
  })
  if (!isAllowedUpdateUrl(response.url || url, allowedHosts)) throw new Error('update feed redirected to a host that is not allowed')
  // No release published yet reads as "nothing to update to".
  if (response.status === 404) return ''
  if (!response.ok) throw new Error(`update feed answered HTTP ${String(response.status)}`)
  const text = await response.text()
  if (text.length > MAX_MANIFEST_BYTES) throw new Error('update manifest is too large')
  return text
}

/**
 * Download one update file into `directory` and return its path. The file is
 * written under a temporary name and kept only when its size and SHA-256 match
 * the signed manifest. A file already there with the right hash is reused, so
 * an interrupted session does not download twice.
 */
export async function downloadUpdateFile(
  fetchImpl: UpdateFetch,
  file: UpdateFile,
  directory: string,
  onProgress: (percent: number) => void,
  allowedHosts: readonly string[] = DEFAULT_ALLOWED_HOSTS
): Promise<string> {
  await mkdir(directory, { recursive: true })
  const target = join(directory, file.name)
  if (await matches(target, file)) {
    onProgress(100)
    return target
  }

  const temporary = join(directory, `.${file.name}.${randomUUID()}.part`)
  const controller = new AbortController()
  let idle: NodeJS.Timeout | undefined
  const touch = () => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => controller.abort(new Error('update download stalled')), IDLE_TIMEOUT_MS)
  }
  touch()
  try {
    const response = await fetchImpl(file.url, { signal: controller.signal })
    if (!isAllowedUpdateUrl(response.url || file.url, allowedHosts)) throw new Error('update download redirected to a host that is not allowed')
    if (!response.ok || response.body === null) throw new Error(`update download answered HTTP ${String(response.status)}`)
    const hash = createHash('sha256')
    const out = createWriteStream(temporary, { mode: 0o600 })
    const closed = new Promise<void>((resolve, reject) => {
      out.on('error', reject)
      out.on('close', () => resolve())
    })
    let received = 0
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        touch()
        received += value.byteLength
        if (received > file.size) throw new Error('update download is larger than the manifest says')
        hash.update(value)
        if (!out.write(value)) await new Promise<void>((resolve) => out.once('drain', () => resolve()))
        onProgress((received / file.size) * 100)
      }
    } finally {
      out.end()
      await closed
    }
    if (received !== file.size) throw new Error('update download is incomplete')
    if (hash.digest('hex') !== file.sha256) throw new Error('update download does not match its checksum')
    await rename(temporary, target)
    return target
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  } finally {
    if (idle) clearTimeout(idle)
  }
}

async function matches(path: string, file: UpdateFile): Promise<boolean> {
  try {
    if ((await stat(path)).size !== file.size) return false
  } catch {
    return false
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex') === file.sha256
}
