import { createPublicKey, verify } from 'node:crypto'
import { PRODUCT_NAME } from '../../shared/brand'
import { isVersion } from '../desktop-service/service'
import { compareVersions } from './version-catalog'

/**
 * The signed update manifest (`latest.json`) published beside each beta
 * release.
 *
 * The beta is not signed with paid Apple or Microsoft certificates, so the
 * operating system cannot vouch for an update. The manifest is: CI signs its
 * payload with an Ed25519 key only the publish step holds, the app verifies it
 * with the public key it ships with, and every file the manifest names is then
 * checked against its SHA-256. A manifest that fails any check is ignored, so
 * a tampered host or a man in the middle can at worst withhold an update.
 *
 * Envelope: `{ "format": 1, "payload": "<JSON text>", "signature": "<base64>" }`.
 * The signature covers the payload's exact UTF-8 bytes, so nothing depends on
 * how JSON is re-serialised.
 */

export const MANIFEST_FORMAT = 1
export const UPDATE_CHANNEL = 'beta'

/** Where a platform's installer comes from, by what this machine runs. */
export type UpdatePlatformKey = 'darwin-arm64' | 'win32-x64' | 'linux-x64-appimage' | 'linux-x64-deb'

export interface UpdateFile {
  readonly name: string
  readonly url: string
  readonly sha256: string
  readonly size: number
}

export interface UpdateManifest {
  readonly version: string
  readonly publishedAt: string
  readonly notes?: string
  readonly files: Partial<Record<UpdatePlatformKey, UpdateFile>>
}

const PLATFORM_KEYS: readonly UpdatePlatformKey[] = ['darwin-arm64', 'win32-x64', 'linux-x64-appimage', 'linux-x64-deb']
// GitHub serves release assets from github.com and redirects the download to
// its asset host. Nothing else may be named in a manifest.
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']
const MAX_UPDATE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_NOTES = 2_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a URL may be fetched for updates: https on an allowed host. */
export function isAllowedUpdateUrl(value: string, allowedHosts: readonly string[] = DEFAULT_ALLOWED_HOSTS): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  // Plain http only for a loopback test feed that a test explicitly allows.
  const loopback = url.hostname === '127.0.0.1' && allowedHosts.includes('127.0.0.1')
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) return false
  if (url.username !== '' || url.password !== '') return false
  return allowedHosts.includes(url.hostname)
}

function updateFile(value: unknown, allowedHosts: readonly string[]): UpdateFile | undefined {
  if (!isRecord(value)) return undefined
  const { name, url, sha256, size } = value
  if (typeof name !== 'string' || !/^[A-Za-z0-9._ -]{1,200}$/u.test(name) || name.startsWith('.')) return undefined
  if (typeof url !== 'string' || !isAllowedUpdateUrl(url, allowedHosts)) return undefined
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(sha256)) return undefined
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_UPDATE_BYTES) return undefined
  return { name, url, sha256, size }
}

/**
 * Verify and read a manifest envelope. Throws with a short reason when the
 * signature, product, channel or any field is not what this app accepts.
 * @param text - the downloaded `latest.json`.
 * @param publicKeyPem - the Ed25519 public key the app ships with.
 */
export function parseSignedManifest(
  text: string,
  publicKeyPem: string,
  allowedHosts: readonly string[] = DEFAULT_ALLOWED_HOSTS
): UpdateManifest {
  let envelope: unknown
  try {
    envelope = JSON.parse(text)
  } catch {
    throw new Error('update manifest is not JSON')
  }
  if (!isRecord(envelope) || envelope.format !== MANIFEST_FORMAT) throw new Error('update manifest format is not supported')
  const { payload, signature } = envelope
  if (typeof payload !== 'string' || typeof signature !== 'string') throw new Error('update manifest is incomplete')
  const valid = verify(null, Buffer.from(payload, 'utf8'), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'))
  if (!valid) throw new Error('update manifest signature is not valid')

  const body: unknown = JSON.parse(payload)
  if (!isRecord(body)) throw new Error('update manifest payload is not an object')
  if (body.product !== PRODUCT_NAME) throw new Error('update manifest is for another product')
  if (body.channel !== UPDATE_CHANNEL) throw new Error('update manifest is for another channel')
  if (!isVersion(body.version)) throw new Error('update manifest version is not valid')
  if (typeof body.publishedAt !== 'string' || !Number.isFinite(Date.parse(body.publishedAt))) throw new Error('update manifest date is not valid')
  if (!isRecord(body.files)) throw new Error('update manifest lists no files')
  const files: Partial<Record<UpdatePlatformKey, UpdateFile>> = {}
  for (const key of PLATFORM_KEYS) {
    if (body.files[key] === undefined) continue
    const file = updateFile(body.files[key], allowedHosts)
    if (file === undefined) throw new Error(`update manifest entry ${key} is not valid`)
    files[key] = file
  }
  return {
    version: body.version,
    publishedAt: body.publishedAt,
    ...(typeof body.notes === 'string' && body.notes.trim() !== '' ? { notes: body.notes.trim().slice(0, MAX_NOTES) } : {}),
    files
  }
}

/**
 * Which manifest entry this running app updates from, or undefined when this
 * install cannot update itself (another platform, or a Linux build run from
 * an unpacked folder).
 * @param linuxInstall - 'appimage' when $APPIMAGE is set, 'deb' when running from /opt.
 */
export function updatePlatformKey(
  platform: NodeJS.Platform,
  arch: string,
  linuxInstall?: 'appimage' | 'deb'
): UpdatePlatformKey | undefined {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'win32' && arch === 'x64') return 'win32-x64'
  if (platform === 'linux' && arch === 'x64' && linuxInstall !== undefined) return linuxInstall === 'appimage' ? 'linux-x64-appimage' : 'linux-x64-deb'
  return undefined
}

/** The update this app should take from a manifest, if any. */
export function offeredUpdate(
  manifest: UpdateManifest,
  currentVersion: string,
  key: UpdatePlatformKey
): { version: string; file: UpdateFile; notes?: string } | undefined {
  const file = manifest.files[key]
  if (file === undefined || compareVersions(manifest.version, currentVersion) <= 0) return undefined
  return { version: manifest.version, file, ...(manifest.notes === undefined ? {} : { notes: manifest.notes }) }
}
