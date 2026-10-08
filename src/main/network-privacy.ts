import type { Session } from 'electron'

/**
 * Unoblox makes no silent network calls: the only host the app contacts on
 * its own is the Unoblox API. Everything else must be something the user
 * asked for in the moment (a web page an agent fetches, a plugin they
 * install, phone pairing they start).
 */

/**
 * Chromium's spellchecker downloads Hunspell dictionaries from Google
 * (redirector.gvt1.com) on Linux and Windows as soon as a session starts,
 * even with spellchecking switched off and no window open. Only an empty
 * language list stops that download, and it has to be set when the session
 * is created (`app.on('session-created')`), before the first download is
 * scheduled. macOS uses the system spellchecker, which stays on the machine,
 * so only there is spellchecking kept.
 * @param session - a newly created session.
 * @param platform - the running platform.
 */
export function disableSpellcheckDownloads(
  session: Pick<Session, 'setSpellCheckerEnabled' | 'setSpellCheckerLanguages'>,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform === 'darwin') return
  session.setSpellCheckerLanguages([])
  session.setSpellCheckerEnabled(false)
}

/**
 * Stand-in for the plugin-recovery registry lookup. When a plugin breaks
 * startup, upstream asked registry.npmmirror.com / registry.npmjs.org for a
 * newer version on its own. Unoblox does not: recovery offers its local
 * actions (Safe Mode, removing the plugin) and the check reports itself as
 * not run.
 */
export function noAutomaticRegistryLookup(): Promise<Response> {
  return Promise.reject(new Error('Unoblox does not look up plugin versions online on its own'))
}
