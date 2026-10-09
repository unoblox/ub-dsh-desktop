import { spawn } from 'node:child_process'
import { chmod, copyFile, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * Apply a downloaded, checksum-verified update on each platform.
 *
 * - macOS: the beta is ad-hoc signed, so Squirrel.Mac (which requires a
 *   Developer ID) cannot install it. The zip is unpacked and checked before
 *   asking; on restart a small detached script waits for the app to exit,
 *   swaps the bundle in place, clears any quarantine mark and reopens it.
 *   Files the app writes itself carry no quarantine, so Gatekeeper does not
 *   prompt again.
 * - Windows: the NSIS installer runs silently for the current user and
 *   reopens the app (`--force-run`), as electron-updater does.
 * - Linux AppImage: the file replaces itself, then the app relaunches.
 * - Linux .deb: dpkg installs it through pkexec (the system password dialog),
 *   then the app relaunches.
 */

export type RunCommand = (file: string, args: readonly string[]) => Promise<{ stdout: string }>

export type LinuxInstall = 'appimage' | 'deb'

/** The installed product's bundle id; an update must carry the same one. */
export const MAC_BUNDLE_ID = 'ai.unoblox.works'
/** Where the .deb installs the app. */
export const DEB_INSTALL_DIR = '/opt/unoblox works/'

/** How this Linux build was installed, if it can update itself at all. */
export function linuxInstallKind(env: NodeJS.ProcessEnv, execPath: string): LinuxInstall | undefined {
  if (typeof env.APPIMAGE === 'string' && env.APPIMAGE.endsWith('.AppImage')) return 'appimage'
  if (execPath.startsWith(DEB_INSTALL_DIR)) return 'deb'
  return undefined
}

/** `/Applications/x.app/Contents/MacOS/x` → `/Applications/x.app`. */
export function macBundlePath(execPath: string): string | undefined {
  const match = /^(.+\.app)\/Contents\/MacOS\/[^/]+$/u.exec(execPath)
  return match?.[1]
}

/**
 * Whether macOS lets the app replace itself where it runs. A copy run straight
 * from the disk image or from a translocated (quarantined, read-only) path
 * cannot be swapped; the user has to move it to Applications first.
 */
export function macBundleIsUpdatable(bundle: string): boolean {
  return !bundle.includes('/AppTranslocation/') && !bundle.startsWith('/Volumes/')
}

/** Quote one argument for /bin/sh. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`
}

/**
 * The script that swaps the bundle once the app has exited. The new bundle is
 * copied next to the old one first (same directory, so the swap is two
 * renames), and the old one is put back if the second rename fails.
 */
export function macSwapScript(options: {
  pid: number
  staged: string
  target: string
  log: string
  /** Tool paths; tests run the script on Linux with stand-ins. */
  tools?: { ditto: string; xattr: string; open: string }
}): string {
  const tools = options.tools ?? { ditto: '/usr/bin/ditto', xattr: '/usr/bin/xattr', open: '/usr/bin/open' }
  const open = shellQuote(tools.open)
  const target = shellQuote(options.target)
  const incoming = shellQuote(`${options.target}.updating`)
  const outgoing = shellQuote(`${options.target}.previous`)
  return [
    '#!/bin/sh',
    `exec >>${shellQuote(options.log)} 2>&1`,
    `echo "unoblox works update: waiting for ${String(options.pid)}"`,
    'i=0',
    `while kill -0 ${String(options.pid)} 2>/dev/null; do i=$((i+1)); [ "$i" -gt 600 ] && { echo "app did not exit"; exit 1; }; sleep 0.1; done`,
    `rm -rf ${incoming} ${outgoing}`,
    `${shellQuote(tools.ditto)} ${shellQuote(options.staged)} ${incoming} || { echo "copy failed"; rm -rf ${incoming}; ${open} ${target}; exit 1; }`,
    `mv ${target} ${outgoing} || { echo "move old failed"; rm -rf ${incoming}; ${open} ${target}; exit 1; }`,
    `if ! mv ${incoming} ${target}; then echo "move new failed, restoring"; mv ${outgoing} ${target}; ${open} ${target}; exit 1; fi`,
    `${shellQuote(tools.xattr)} -dr com.apple.quarantine ${target} 2>/dev/null`,
    `rm -rf ${outgoing}`,
    'echo "update installed"',
    `${open} ${target}`,
    ''
  ].join('\n')
}

/**
 * Unpack the downloaded zip and check the bundle before offering a restart:
 * one `.app`, a valid signature seal, and this product's bundle id.
 * @returns the staged `.app` path.
 */
export async function stageMacUpdate(zipPath: string, run: RunCommand): Promise<string> {
  const staging = join(dirname(zipPath), 'staged')
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  await run('/usr/bin/ditto', ['-x', '-k', zipPath, staging])
  const apps = (await readdir(staging)).filter((name) => name.endsWith('.app'))
  if (apps.length !== 1 || apps[0] === undefined) throw new Error('update archive does not hold exactly one app')
  const app = join(staging, apps[0])
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  const { stdout } = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(app, 'Contents', 'Info.plist')])
  if (stdout.trim() !== MAC_BUNDLE_ID) throw new Error(`update is for another app (${stdout.trim()})`)
  return app
}

/** Start the detached swap script; the caller quits the app right after. */
export async function launchMacSwap(options: { pid: number; staged: string; target: string; workDir: string }): Promise<void> {
  const script = join(options.workDir, 'apply-update.sh')
  await writeFile(script, macSwapScript({ ...options, log: join(options.workDir, 'apply-update.log') }), { mode: 0o700 })
  spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref()
}

/** Start the silent NSIS install; it waits for the app and reopens it. */
export function launchWindowsInstaller(setupPath: string): void {
  spawn(setupPath, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
}

/**
 * Replace the running AppImage file. The new file is copied beside it first,
 * so the replacement is one rename on the same filesystem.
 */
export async function replaceAppImage(appImagePath: string, downloaded: string): Promise<void> {
  const incoming = join(dirname(appImagePath), `.${basename(appImagePath)}.updating`)
  await copyFile(downloaded, incoming)
  await chmod(incoming, 0o755)
  await rename(incoming, appImagePath)
}

/** Install a .deb through the system password dialog. */
export async function installDeb(debPath: string, run: RunCommand): Promise<void> {
  try {
    await run('pkexec', ['dpkg', '-i', debPath])
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 'ENOENT') throw new Error(`pkexec is not available; install the update with: sudo apt install ${debPath}`)
    if (code === 126 || code === 127) throw new Error('the update was not authorised')
    throw error
  }
}
