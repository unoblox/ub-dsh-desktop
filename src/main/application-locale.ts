export type HarnessLocale = 'en' | 'zh'

/**
 * The language of the native shell (menus, dialogs, recovery pages).
 *
 * Unoblox is English-only. Upstream shipped exactly two languages, English
 * and Chinese, so this always answers English whatever the stored preference
 * or system language; the Chinese strings stay in the code paths unused. The
 * client side is pinned the same way by the dsh-client-locale patch.
 */
export function resolveHarnessLocale(
  _preference: unknown,
  _preferredSystemLanguages: readonly string[]
): HarnessLocale {
  return 'en'
}
