import type { SignInConfig, TokenFetch } from './sign-in'
import { SignInError, signInWithUnoblox } from './sign-in'
import { removeUnobloxKey, storeUnobloxKey, type HarnessFetch, type HarnessTarget } from './harness-credentials'

/** What the page learns: never the key, only whether it is stored. */
export type SignInResult = { ok: true } | { ok: false; code: string; message: string }

export interface SignInServiceOptions {
  /** Current settings; undefined when this build cannot sign in. */
  readonly config: () => SignInConfig | undefined
  readonly harness: () => HarnessTarget
  readonly openBrowser: (url: string) => Promise<void>
  readonly tokenFetch: TokenFetch
  readonly harnessFetch: HarnessFetch
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
      const key = await signInWithUnoblox({ config, openBrowser: this.options.openBrowser, fetch: this.options.tokenFetch, signal: controller.signal })
      try {
        await storeUnobloxKey(this.options.harnessFetch, this.options.harness(), key)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.options.log(`[desktop] unoblox sign-in: could not store the key: ${message}`)
        return { ok: false, code: 'store-failed', message: `Signed in, but the key could not be saved: ${message}` }
      }
      this.options.log('[desktop] unoblox sign-in: key stored')
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

  /** Forget the key on this computer. Identity has no endpoint to revoke it yet. */
  async signOut(): Promise<SignInResult> {
    this.cancel()
    try {
      await removeUnobloxKey(this.options.harnessFetch, this.options.harness())
      this.options.log('[desktop] unoblox sign-out: key removed')
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, code: 'remove-failed', message }
    }
  }
}
