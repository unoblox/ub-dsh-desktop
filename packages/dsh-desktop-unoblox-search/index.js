/**
 * Registers unoblox web search with `ctx.web`.
 *
 * Desktop users enter their unoblox key in the app, which stores it in the
 * Harness credential store under `UNOBLOX_API_KEY`. Upstream search plugins
 * (Exa, Perplexity) read a key once from config or a fixed environment
 * variable and cannot see that store, so this provider resolves the key on
 * every search instead. The local credential provider also answers from the
 * process environment, so `UNOBLOX_API_KEY` set there keeps working.
 *
 * Privacy: only the query text leaves the machine — to unoblox, which runs
 * the search on Perplexity (United States). unoblox does not store queries.
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { UNOBLOX_DEFAULT_BASE_URL, UnobloxSearchProvider } from './provider.js'

export const name = 'dsh-desktop-unoblox-search'
export const inject = ['web']

const DEFAULT_KEY_REF = 'UNOBLOX_API_KEY'

export const Config = z.object({
  baseURL: z.string().default(UNOBLOX_DEFAULT_BASE_URL),
  apiKeyEnv: z.string().default(DEFAULT_KEY_REF)
})

export function apply(ctx, config) {
  const ref = credentialRef(config.apiKeyEnv ?? DEFAULT_KEY_REF)
  const provider = new UnobloxSearchProvider({
    baseURL: config.baseURL ?? UNOBLOX_DEFAULT_BASE_URL,
    resolveApiKey: async () => (await ctx.get('credentials')?.resolve(ref))?.value
  })
  ctx.effect(() => ctx.web.registerSearchProvider(provider))
}
