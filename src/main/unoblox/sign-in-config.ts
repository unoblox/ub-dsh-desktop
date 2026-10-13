import type { SignInConfig } from './sign-in'

/**
 * Where "Sign in with unoblox" goes. The identity service is reached through
 * unoblox.ai's same-origin proxy (it has no host of its own); the browser
 * page that signs the user in is unoblox.ai/oauth/authorize.
 *
 * Builds sign in with the production client below; UNOBLOX_WORKS_SIGNIN_CLIENT_ID
 * at build time (electron.vite.config.ts) names another one. Its registered
 * redirect is http://127.0.0.1:53682/callback, and identity matches any port
 * on 127.0.0.1 against it (RFC 8252), so the OS picks a free port.
 *
 * Test hooks (environment): UNOBLOX_WORKS_SIGNIN_AUTHORIZE_URL,
 * UNOBLOX_WORKS_SIGNIN_TOKEN_URL, UNOBLOX_WORKS_SIGNIN_REVOKE_URL,
 * UNOBLOX_WORKS_SIGNIN_CLIENT_ID and UNOBLOX_WORKS_SIGNIN_ANY_PORT (1/0) point a
 * build at staging. As with the update feed, release builds ignore them; a
 * development run or a build made with UNOBLOX_WORKS_SIGNIN_TEST_BUILD=1
 * honours them.
 */
export const SIGN_IN_AUTHORIZE_URL = 'https://unoblox.ai/oauth/authorize'
export const SIGN_IN_TOKEN_URL = 'https://unoblox.ai/api/identity/oauth/token'
export const SIGN_IN_REVOKE_URL = 'https://unoblox.ai/api/identity/oauth/revoke'
/** The registered redirect's port, used when any-port matching is switched off. */
export const SIGN_IN_PORTS: readonly number[] = [53682]
/**
 * Identity matches any port on a registered 127.0.0.1 redirect (live in
 * production since 2026-10-13), so the OS picks one: sign-in never fails
 * because another program holds 53682.
 */
export const SIGN_IN_ANY_PORT = true
/** The production "unoblox works" OAuth client (public; PKCE, no secret). */
export const SIGN_IN_PRODUCTION_CLIENT_ID = 'ubc_caba2302ca6e89dd9f0cdda7f6097624'
export const SIGN_IN_SCOPE = 'inference'

declare const __UNOBLOX_SIGNIN_CLIENT_ID__: string | undefined
declare const __UNOBLOX_SIGNIN_TEST_HOOKS__: boolean | undefined

export const SIGN_IN_CLIENT_ID: string =
  typeof __UNOBLOX_SIGNIN_CLIENT_ID__ === 'string' && __UNOBLOX_SIGNIN_CLIENT_ID__ !== '' ? __UNOBLOX_SIGNIN_CLIENT_ID__ : SIGN_IN_PRODUCTION_CLIENT_ID
export const SIGN_IN_TEST_HOOKS_BUILT: boolean =
  typeof __UNOBLOX_SIGNIN_TEST_HOOKS__ !== 'undefined' && __UNOBLOX_SIGNIN_TEST_HOOKS__ === true

const CLIENT_ID_PATTERN = /^ubc_[0-9a-f]{32}$/u

/** A production endpoint: https on unoblox.ai itself. */
function isUnobloxUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'unoblox.ai' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

/** A test endpoint: also plain http on this machine (staging through an SSH tunnel). */
function isTestUrl(value: string): boolean {
  if (isUnobloxUrl(value)) return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

/**
 * The sign-in settings for this run, or undefined when sign-in is not
 * available (no valid client id, or an override that is not allowed).
 * @param allowOverrides - true for development runs and test builds.
 */
export function signInConfig(env: NodeJS.ProcessEnv, allowOverrides: boolean, builtClientId: string = SIGN_IN_CLIENT_ID): SignInConfig | undefined {
  const pick = (name: string, fallback: string) => (allowOverrides && env[name] ? String(env[name]) : fallback)
  const clientId = pick('UNOBLOX_WORKS_SIGNIN_CLIENT_ID', builtClientId)
  const authorizeUrl = pick('UNOBLOX_WORKS_SIGNIN_AUTHORIZE_URL', SIGN_IN_AUTHORIZE_URL)
  const tokenUrl = pick('UNOBLOX_WORKS_SIGNIN_TOKEN_URL', SIGN_IN_TOKEN_URL)
  const revokeUrl = pick('UNOBLOX_WORKS_SIGNIN_REVOKE_URL', SIGN_IN_REVOKE_URL)
  const anyPort = allowOverrides && env.UNOBLOX_WORKS_SIGNIN_ANY_PORT !== undefined ? env.UNOBLOX_WORKS_SIGNIN_ANY_PORT === '1' : SIGN_IN_ANY_PORT
  const allowed = allowOverrides ? isTestUrl : isUnobloxUrl
  if (!CLIENT_ID_PATTERN.test(clientId) || !allowed(authorizeUrl) || !allowed(tokenUrl) || !allowed(revokeUrl)) return undefined
  return { clientId, authorizeUrl, tokenUrl, revokeUrl, ports: anyPort ? [0] : SIGN_IN_PORTS, scope: SIGN_IN_SCOPE }
}
