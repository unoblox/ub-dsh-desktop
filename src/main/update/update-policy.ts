import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_ALLOWED_HOSTS } from './ota-manifest'

/**
 * Over-the-air updates for the unoblox works beta.
 *
 * Each beta release is published to a public GitHub releases repository with
 * a signed `latest.json` (src/main/update/ota-manifest.ts). The app checks it
 * at startup and every few hours, downloads a newer build in the background,
 * and asks the user to restart to install it. A check sends only an ordinary
 * HTTPS request for that file: no installation id, key or usage data. Users
 * can turn automatic checks off (Harness › Check for Updates Automatically);
 * "Check for Updates…" still works then.
 *
 * Test hooks (environment): UNOBLOX_WORKS_UPDATE_FEED,
 * UNOBLOX_WORKS_UPDATE_PUBLIC_KEY and UNOBLOX_WORKS_UPDATE_HOSTS point a build
 * at a local feed signed with a test key. Anyone able to set them can already
 * replace the app on disk, so they open nothing new.
 */

/** The releases repository the beta updates from. */
export const UPDATE_RELEASES_REPOSITORY = 'unoblox/unoblox-works-releases'
export const UPDATE_FEED_URL = `https://github.com/${UPDATE_RELEASES_REPOSITORY}/releases/latest/download/latest.json`

/** Ed25519 key that verifies `latest.json`; CI signs with its private half. */
export const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAo0yXT5NT8JDz3tn8v4hS2ZiqZR/i7seWMKVKyMe447U=
-----END PUBLIC KEY-----
`

/** Whether this build has an update feed (menus offer update checks). */
export const UNOBLOX_UPDATE_FEED_CONFIGURED: boolean = true

export interface UpdateFeed {
  readonly url: string
  readonly publicKey: string
  readonly allowedHosts: readonly string[]
}

export function updateFeed(env: NodeJS.ProcessEnv = process.env): UpdateFeed {
  const hosts = env.UNOBLOX_WORKS_UPDATE_HOSTS?.split(',').map((host) => host.trim()).filter((host) => host !== '')
  return {
    url: env.UNOBLOX_WORKS_UPDATE_FEED || UPDATE_FEED_URL,
    publicKey: env.UNOBLOX_WORKS_UPDATE_PUBLIC_KEY || UPDATE_PUBLIC_KEY,
    allowedHosts: hosts !== undefined && hosts.length > 0 ? hosts : DEFAULT_ALLOWED_HOSTS
  }
}

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000
export const UPDATE_STARTUP_DELAY_MS = 15_000
export const UPDATE_STARTUP_JITTER_MS = 15_000

export function supportsAutoUpdates(isPackaged: boolean, platform: NodeJS.Platform): boolean {
  return isPackaged && (platform === 'darwin' || platform === 'win32' || platform === 'linux')
}

export function shouldCheckAfterResume(lastCheckedAt: number, now = Date.now()): boolean {
  return now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS
}

const PREFERENCES_FILE = 'updates.json'

/** Whether scheduled update checks run. On unless the user turned them off. */
export function readAutomaticChecks(userData: string): boolean {
  try {
    const value: unknown = JSON.parse(readFileSync(join(userData, PREFERENCES_FILE), 'utf8'))
    return !(typeof value === 'object' && value !== null && (value as { automatic?: unknown }).automatic === false)
  } catch {
    return true
  }
}

/** Remember the choice; false when it could not be saved (it still applies now). */
export function writeAutomaticChecks(userData: string, automatic: boolean): boolean {
  const path = join(userData, PREFERENCES_FILE)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ automatic })}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}
