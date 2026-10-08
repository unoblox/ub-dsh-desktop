import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

/**
 * When the phone bridge listens on the local network.
 *
 * Unoblox opens no port and talks to nothing unless the user asks for it
 * (docs/privacy.md). The bridge therefore starts when the user opens
 * Connect Phone, keeps running after that only while a phone is paired, and
 * starts with the app only when the user turned on "Keep Phone Connected".
 */

export function mobileBridgePreferencePath(userDataPath: string): string {
  return join(userDataPath, 'mobile-bridge.json')
}

export function readKeepPhoneConnected(path: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && (parsed as { keepConnected?: unknown }).keepConnected === true
  } catch {
    // No preference file yet (the default) or an unreadable one: off.
    return false
  }
}

export function writeKeepPhoneConnected(path: string, keepConnected: boolean): boolean {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(temporary, `${JSON.stringify({ keepConnected }, undefined, 2)}\n`)
    if (existsSync(path)) unlinkSync(path)
    renameSync(temporary, path)
    return true
  } catch {
    try {
      if (existsSync(temporary)) unlinkSync(temporary)
    } catch {
      // The caller already treats a false return as a failed write.
    }
    return false
  }
}

export class MobileBridgeDemand {
  #keepConnected: boolean
  #pairing = false

  constructor(keepConnected: boolean) {
    this.#keepConnected = keepConnected
  }

  get keepConnected(): boolean {
    return this.#keepConnected
  }

  /** Whether the bridge should be running (after launch or a Harness restart). */
  wanted(): boolean {
    return this.#keepConnected || this.#pairing
  }

  /** The user opened Connect Phone. */
  pairingOpened(): void {
    this.#pairing = true
  }

  /**
   * The pairing window closed.
   * @param phoneConnected - whether a phone is attached right now.
   * @returns whether the bridge should stop.
   */
  pairingClosed(phoneConnected: boolean): boolean {
    if (!phoneConnected) this.#pairing = false
    return !this.wanted()
  }

  /**
   * The user toggled "Keep Phone Connected". Turning it off never drops a
   * phone that is attached or a pairing in progress.
   * @returns whether the bridge should now run.
   */
  setKeepConnected(keepConnected: boolean, state: { pairingWindowOpen: boolean; phoneConnected: boolean }): boolean {
    this.#keepConnected = keepConnected
    if (!keepConnected && !state.pairingWindowOpen && !state.phoneConnected) this.#pairing = false
    return this.wanted()
  }
}
