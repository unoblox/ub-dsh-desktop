import type { SignInConfig } from './sign-in'

/**
 * Where "Sign in with unoblox" goes. The identity service is reached through
 * unoblox.ai's same-origin proxy (it has no host of its own); the browser
 * page that signs the user in is unoblox.ai/oauth/authorize.
 *
 * The client id is set when the app is built (UNOBLOX_WORKS_SIGNIN_CLIENT_ID,
 * see electron.vite.config.ts): a build without one hides sign-in, and users
 * paste a key as before. Identity matches redirect URIs exactly, port
 * included, so these ports must all be registered with that client.
 *
 * Test hooks (environment): UNOBLOX_WORKS_SIGNIN_AUTHORIZE_URL,
 * UNOBLOX_WORKS_SIGNIN_TOKEN_URL and UNOBLOX_WORKS_SIGNIN_CLIENT_ID point a
 * build at staging. As with the update feed, release builds ignore them; a
 * development run or a build made with UNOBLOX_WORKS_SIGNIN_TEST_BUILD=1
 * honours them.
 */
export const SIGN_IN_AUTHORIZE_URL = 'https://unoblox.ai/oauth/authorize'
export const SIGN_IN_TOKEN_URL = 'https://unoblox.ai/api/identity/oauth/token'
export const SIGN_IN_PORTS: readonly number[] = [53682, 53683, 53684]
export const SIGN_IN_SCOPE = 'inference'

declare const __UNOBLOX_SIGNIN_CLIENT_ID__: string | undefined
declare const __UNOBLOX_SIGNIN_TEST_HOOKS__: boolean | undefined

export const SIGN_IN_CLIENT_ID: string = typeof __UNOBLOX_SIGNIN_CLIENT_ID__ === 'string' ? __UNOBLOX_SIGNIN_CLIENT_ID__ : ''
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
  const allowed = allowOverrides ? isTestUrl : isUnobloxUrl
  if (!CLIENT_ID_PATTERN.test(clientId) || !allowed(authorizeUrl) || !allowed(tokenUrl)) return undefined
  return { clientId, authorizeUrl, tokenUrl, ports: SIGN_IN_PORTS, scope: SIGN_IN_SCOPE }
}
