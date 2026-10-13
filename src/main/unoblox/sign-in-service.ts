import type { SignInConfig, TokenFetch } from './sign-in'
import { revokeKey, SignInError, signInWithUnoblox } from './sign-in'
import { removeUnobloxKey, storeUnobloxKey, type HarnessFetch, type HarnessTarget } from './harness-credentials'
import type { SignInDevice } from './sign-in-device'

/** What the page learns: never the key, only whether it is stored. */
export type SignInResult = { ok: true } | { ok: false; code: string; message: string }

/**
 * After sign-out the key is gone from this computer. `revoked` says whether
 * unoblox.ai revoked it too: 'yes', 'unreachable' (offline or refused), or
 * 'not-kept' (no signed-in key was kept to revoke, e.g. a pasted key).
 */
export type SignOutResult = { ok: true; revoked: 'yes' | 'unreachable' | 'not-kept' } | { ok: false; code: string; message: string }

export interface SignInServiceOptions {
  /** Current settings; undefined when this build cannot sign in. */
  readonly config: () => SignInConfig | undefined
  readonly harness: () => HarnessTarget
  readonly openBrowser: (url: string) => Promise<void>
  readonly tokenFetch: TokenFetch
  readonly harnessFetch: HarnessFetch
  /** This install's id and the kept key; see sign-in-device.ts. */
  readonly device: SignInDevice
  /** The name identity shows for this computer's key. */
  readonly deviceName: () => string
  readonly log: (message: string) => void
}

/**
 * One sign-in at a time, cancellable from the page. The key goes from the
 * token response straight into the Harness credential store.
 */
export class UnobloxSignIn {
  private running: AbortController | undefined

  constructor(private readonly options: SignInServiceOptions) {}

  available(): boolean {
    return this.options.config() !== undefined
  }

  async signIn(): Promise<SignInResult> {
    const config = this.options.config()
    if (config === undefined) return { ok: false, code: 'not-configured', message: 'Sign-in is not available in this build.' }
    // A second click while the browser is open must not start a second flow.
    if (this.running !== undefined) return { ok: false, code: 'busy', message: 'Sign-in is already waiting for the browser.' }
    const controller = new AbortController()
    this.running = controller
    try {
      this.options.log('[desktop] unoblox sign-in: started')
      const device = await this.options.device.deviceId().then(
        (id) => ({ id, name: this.options.deviceName() }),
        (error: unknown) => {
          // Signing in still works without it; identity then mints an unnamed key.
          this.options.log(`[desktop] unoblox sign-in: no device id (${error instanceof Error ? error.message : String(error)})`)
          return undefined
        }
      )
      const key = await signInWithUnoblox({ config, openBrowser: this.options.openBrowser, fetch: this.options.tokenFetch, signal: controller.signal, ...(device === undefined ? {} : { device }) })
      try {
        await storeUnobloxKey(this.options.harnessFetch, this.options.harness(), key)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.options.log(`[desktop] unoblox sign-in: could not store the key: ${message}`)
        return { ok: false, code: 'store-failed', message: `Signed in, but the key could not be saved: ${message}` }
      }
      this.options.log('[desktop] unoblox sign-in: key stored')
      await this.options.device.rememberKey(key).catch((error: unknown) => {
        this.options.log(`[desktop] unoblox sign-in: key not kept for sign-out (${error instanceof Error ? error.message : String(error)})`)
      })
      return { ok: true }
    } catch (error) {
      const code = error instanceof SignInError ? error.code : 'failed'
      const message = error instanceof Error ? error.message : String(error)
      this.options.log(`[desktop] unoblox sign-in: ${code}`)
      return { ok: false, code, message }
    } finally {
      if (this.running === controller) this.running = undefined
    }
  }

  cancel(): void {
    this.running?.abort()
  }

  /**
   * Revoke the signed-in key on unoblox.ai, then remove the key from this
   * computer whether or not that worked: an offline machine must still be
   * able to sign out.
   */
  async signOut(): Promise<SignOutResult> {
    this.cancel()
    const config = this.options.config()
    const kept = await this.options.device.revocableKey().catch(() => undefined)
    let revoked: 'yes' | 'unreachable' | 'not-kept' = 'not-kept'
    if (kept !== undefined && config !== undefined) {
      revoked = (await revokeKey(this.options.tokenFetch, config, kept)) ? 'yes' : 'unreachable'
    }
    try {
      await removeUnobloxKey(this.options.harnessFetch, this.options.harness())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, code: 'remove-failed', message }
    }
    await this.options.device.forgetKey().catch(() => {})
    this.options.log(`[desktop] unoblox sign-out: key removed, revoked: ${revoked}`)
    return { ok: true, revoked }
  }
}
