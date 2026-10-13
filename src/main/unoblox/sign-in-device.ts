import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * What the app remembers about "Sign in with unoblox" on this computer, in
 * `<userData>/unoblox-device.json`:
 * - `deviceId`: a random install id sent with each sign-in, so identity keeps
 *   one active key per user, app and device. It lives in the app's data folder,
 *   so restarts and updates keep it; deleting that folder makes a new one.
 * - `revocable`: the signed-in key, encrypted with the operating system's
 *   protected storage, kept only to revoke it on sign-out (the Harness
 *   credential store has no read path). Absent when that storage is not
 *   available, or after a key the user pasted replaced it.
 */
export const DEVICE_FILE = 'unoblox-device.json'
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u

export interface DeviceRecord {
  readonly deviceId: string
  /** base64 of the OS-encrypted key from the last sign-in. */
  readonly revocable?: string
}

/** OS-backed encryption (Electron safeStorage); undefined when it is not available. */
export interface KeyVault {
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}

export function newDeviceId(random: (size: number) => Buffer = randomBytes): string {
  return base64url(random(32))
}

async function read(path: string): Promise<DeviceRecord | undefined> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.deviceId !== 'string' || !DEVICE_ID_PATTERN.test(record.deviceId)) return undefined
  return { deviceId: record.deviceId, ...(typeof record.revocable === 'string' ? { revocable: record.revocable } : {}) }
}

/** Replace the file in one step, readable only by the user. */
async function write(path: string, record: DeviceRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${base64url(randomBytes(6))}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export class SignInDevice {
  /**
   * @param userData - the app's data folder, read when needed: the app sets
   *   that path during startup, after this object exists.
   * @param vault - OS-backed encryption, when available.
   */
  constructor(private readonly userData: () => string, private readonly vault: () => KeyVault | undefined) {}

  private get path(): string {
    return join(this.userData(), DEVICE_FILE)
  }

  /** The install id, created and saved the first time it is needed. */
  async deviceId(): Promise<string> {
    const existing = await read(this.path)
    if (existing) return existing.deviceId
    const record = { deviceId: newDeviceId() }
    await write(this.path, record)
    return record.deviceId
  }

  /** Keep the signed-in key for revocation, if the OS can encrypt it. */
  async rememberKey(key: string): Promise<void> {
    const deviceId = await this.deviceId()
    const vault = this.vault()
    const revocable = vault ? vault.encrypt(key).toString('base64') : undefined
    await write(this.path, { deviceId, ...(revocable === undefined ? {} : { revocable }) })
  }

  /** The key to revoke, or undefined when none is kept or it cannot be read. */
  async revocableKey(): Promise<string | undefined> {
    const record = await read(this.path)
    const vault = this.vault()
    if (!record?.revocable || !vault) return undefined
    try {
      return vault.decrypt(Buffer.from(record.revocable, 'base64'))
    } catch {
      return undefined
    }
  }

  /** Drop the kept key; the install id stays. */
  async forgetKey(): Promise<void> {
    const record = await read(this.path)
    if (record?.revocable === undefined) return
    await write(this.path, { deviceId: record.deviceId })
  }
}

/** "Pawan's MacBook" from the host name, or a plain description of the computer. */
export function deviceName(hostname: string, platform: NodeJS.Platform): string {
  // Printable characters only, single spaces, at most 64.
  const cleaned = hostname.replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '').replace(/\s+/gu, ' ').trim().replace(/\.local$/iu, '').slice(0, 64).trim()
  if (cleaned !== '') return cleaned
  return platform === 'darwin' ? 'macOS computer' : platform === 'win32' ? 'Windows computer' : 'Linux computer'
}
