import { isAbsolute, join, resolve } from 'node:path'

/**
 * The Documents folder handed to the Harness for the first-use workspace
 * (`workspace-controller.documentsDirectory` in build/dsh-desktop.patch.yml).
 *
 * Upstream looks it up itself, on Linux by running `xdg-user-dir`, which many
 * installs lack (minimal and server images, some distributions): first launch
 * then failed with "Unable to create default workspace". Electron resolves the
 * same XDG setting without that command and falls back to ~/Documents.
 */
export const DOCUMENTS_DIRECTORY_ENV = 'DSH_DESKTOP_DOCUMENTS_DIR'

/**
 * @param documents - Electron's `app.getPath('documents')`, or undefined when it threw.
 * @param home - the user's home folder.
 * @returns an absolute folder, or undefined to leave the lookup to the Harness.
 */
export function documentsDirectory(documents: string | undefined, home: string): string | undefined {
  if (documents === undefined || documents.trim() === '' || !isAbsolute(documents)) return undefined
  // An XDG setup that maps Documents to the home folder itself would put the
  // workspace folder loose in home; upstream refuses that, so use ~/Documents.
  // resolve() also drops a trailing separator, so "/home/asha/" counts as home.
  if (resolve(documents) === resolve(home)) return join(resolve(home), 'Documents')
  return resolve(documents)
}

export function documentsEnvironment(documents: string | undefined, home: string): Record<string, string> {
  const directory = documentsDirectory(documents, home)
  return directory === undefined ? {} : { [DOCUMENTS_DIRECTORY_ENV]: directory }
}
