import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow, ipcMain, net, powerMonitor } from 'electron'
import type { UpdateStatus } from '../../shared/contracts'
import { DEV_PRODUCT_NAME, PRODUCT_NAME } from '../../shared/brand'
import { downloadUpdateFile, fetchManifestText, type UpdateFetch } from './ota-download'
import {
  installDeb,
  launchMacSwap,
  launchWindowsInstaller,
  linuxInstallKind,
  macBundleIsUpdatable,
  macBundlePath,
  pruneUpdateDirs,
  replaceAppImage,
  stageMacUpdate,
  type RunCommand
} from './ota-install'
import { offeredUpdate, parseSignedManifest, updatePlatformKey, type UpdatePlatformKey } from './ota-manifest'
import {
  readAutomaticChecks,
  shouldCheckAfterResume,
  supportsAutoUpdates,
  UNOBLOX_UPDATE_FEED_CONFIGURED,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_STARTUP_DELAY_MS,
  UPDATE_STARTUP_JITTER_MS,
  UPDATE_TEST_HOOKS_BUILT,
  updateFeed,
  writeAutomaticChecks
} from './update-policy'
import { initialUpdateStatus, reduceUpdateStatus, type UpdateStateEvent } from './update-state'
import { readSkippedVersion, shouldOfferUpdate, skippedVersionPath, writeSkippedVersion } from './skipped-version'

const TRANSIENT_STATUS_MS = 8_000
const execFileAsync = promisify(execFile)
const runCommand: RunCommand = async (file, args) => {
  const { stdout } = await execFileAsync(file, [...args], { maxBuffer: 1024 * 1024 })
  return { stdout: String(stdout) }
}
// Chromium's network stack honours the system proxy and certificate store.
const updateFetch: UpdateFetch = (url, init) => net.fetch(url, init)

/** A downloaded update, ready for "Restart to install". */
interface ReadyUpdate {
  readonly version: string
  readonly key: UpdatePlatformKey
  /** The downloaded file, or on macOS the staged `.app`. */
  readonly path: string
  readonly sha256: string
  readonly workDir: string
}

/**
 * What the app does around an install. Steps that can fail (a cancelled
 * password prompt, a full disk, an installer that will not start) run with
 * the Harness still up where the platform allows it; when one fails after
 * `prepareToInstall`, `resumeAfterFailedInstall` brings the Harness back so
 * the user is not left with a window and nothing behind it.
 */
export interface InstallHooks {
  /** Stop the Harness and anything that runs from the installed files. */
  readonly prepareToInstall: () => Promise<void>
  /** Undo `prepareToInstall` after an install that did not happen. */
  readonly resumeAfterFailedInstall?: () => Promise<void>
  /** The install is under way: the app is about to quit on purpose. */
  readonly commitToInstall?: () => void
}

let status = initialUpdateStatus(app.getVersion())
let hooks: InstallHooks | undefined
let startupTimer: NodeJS.Timeout | undefined
let intervalTimer: NodeJS.Timeout | undefined
let resetTimer: NodeJS.Timeout | undefined
let checkPromise: Promise<void> | undefined
let lastCheckedAt = 0
let installing = false
let started = false
let handlersRegistered = false
let skippedVersion: string | undefined
let skipLoaded = false
let automatic: boolean | undefined
let ready: ReadyUpdate | undefined

export function getUpdateStatus(): UpdateStatus {
  return { ...status }
}

export function registerUpdateHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true
  ipcMain.handle('updates:status', () => getUpdateStatus())
  ipcMain.handle('updates:check', () => checkForUpdates(true))
  ipcMain.handle('updates:install', () => installDownloadedUpdate())
  ipcMain.handle('updates:skip', (_event, version: unknown) => skipUpdate(version))
  // Downloads start on their own; the banner's download button has nothing
  // left to start.
  ipcMain.handle('updates:download', () => getUpdateStatus())
  // The releases feed carries only the latest build: no version picker.
  ipcMain.handle('updates:list-versions', () => [])
  ipcMain.handle('updates:install-version', () => getUpdateStatus())
}

/** Whether scheduled checks run (Harness › Check for Updates Automatically). */
export function automaticUpdateChecks(): boolean {
  automatic ??= readAutomaticChecks(app.getPath('userData'))
  return automatic
}

/** Turn scheduled checks on or off; returns whether the choice was saved. */
export function setAutomaticUpdateChecks(value: boolean): boolean {
  automatic = value
  const saved = writeAutomaticChecks(app.getPath('userData'), value)
  if (value && started && supportsUpdates() && lastCheckedAt === 0) void checkForUpdates()
  return saved
}

function skipFile(): string {
  return skippedVersionPath(app.getPath('userData'))
}

function currentSkippedVersion(): string | undefined {
  if (!skipLoaded) {
    skippedVersion = readSkippedVersion(skipFile())
    skipLoaded = true
  }
  return skippedVersion
}

/**
 * Stop offering one version. A later release is a new question, and a manual
 * check offers the skipped version again.
 */
export function skipUpdate(version: unknown): UpdateStatus {
  // Too late once the restart has begun: the install no longer waits on the banner.
  if (typeof version !== 'string' || !version || installing) return getUpdateStatus()
  skippedVersion = version
  skipLoaded = true
  writeSkippedVersion(skipFile(), version)
  ready = undefined
  transition({ type: 'reset' })
  return getUpdateStatus()
}

export function startUpdateManager(options: InstallHooks): void {
  hooks = options
  if (started) return
  started = true

  const unsupported = unsupportedReason()
  if (unsupported !== undefined) {
    transition({ type: 'unsupported', message: unsupported })
    return
  }

  // The folder of the version now running holds the log of the install that
  // brought it here; older ones are only disk space.
  void pruneUpdateDirs(updatesRoot(), new Set([app.getVersion()])).catch((error: unknown) => {
    console.warn('[updater] could not remove old downloads:', errorMessage(error))
  })

  const scheduled = () => {
    if (automaticUpdateChecks()) void checkForUpdates()
  }
  startupTimer = setTimeout(scheduled, UPDATE_STARTUP_DELAY_MS + Math.random() * UPDATE_STARTUP_JITTER_MS)
  intervalTimer = setInterval(scheduled, UPDATE_CHECK_INTERVAL_MS)
  powerMonitor.on('resume', checkAfterResume)
}

/**
 * Check the feed and, when a newer build exists, download it right away.
 * The user is asked only once it is ready to install.
 */
export async function checkForUpdates(manual = false): Promise<UpdateStatus> {
  const unsupported = unsupportedReason()
  if (unsupported !== undefined) {
    transition({ type: 'unsupported', message: unsupported }, manual)
    if (manual) scheduleReset()
    return getUpdateStatus()
  }
  if (checkPromise || ['downloading', 'downloaded'].includes(status.phase)) {
    if (manual && status.phase === 'downloaded') transition({ type: 'downloaded', version: status.availableVersion ?? '' }, true)
    return getUpdateStatus()
  }

  transition({ type: 'check', manual })
  lastCheckedAt = Date.now()
  checkPromise = runCheck(manual)
  try {
    await checkPromise
  } catch (error) {
    console.warn('[updater] check failed:', errorMessage(error))
    transition({ type: 'error', message: errorMessage(error) })
    // A scheduled check that fails (offline, feed down) stays quiet.
    if (manual) scheduleReset()
    else transition({ type: 'reset' })
  } finally {
    checkPromise = undefined
  }
  return getUpdateStatus()
}

async function runCheck(manual: boolean): Promise<void> {
  const feed = updateFeed(process.env, !app.isPackaged || UPDATE_TEST_HOOKS_BUILT)
  const key = platformKey()
  if (key === undefined) throw new Error('this install cannot update itself')
  const text = await fetchManifestText(updateFetch, feed.url, feed.allowedHosts)
  const offer = text === '' ? undefined : offeredUpdate(parseSignedManifest(text, feed.publicKey, feed.allowedHosts), app.getVersion(), key)
  if (offer === undefined) {
    transition({ type: 'not-available' })
    scheduleReset()
    return
  }
  const skippedBefore = currentSkippedVersion()
  if (!shouldOfferUpdate(offer.version, skippedBefore, manual)) {
    console.info('[updater] skipping', offer.version, 'at the user’s request')
    transition({ type: 'reset' })
    return
  }

  if (!(await installLocationWritable())) {
    throw new Error(`${PRODUCT_NAME} cannot replace itself in the folder it runs from. Install the new version from the download page.`)
  }
  transition({ type: 'available', version: offer.version })
  let shown = -1
  const skippedNow = () => currentSkippedVersion() === offer.version && skippedBefore !== offer.version
  await pruneUpdateDirs(updatesRoot(), new Set([offer.version])).catch((error: unknown) => {
    console.warn('[updater] could not remove old downloads:', errorMessage(error))
  })
  const workDir = join(updatesRoot(), offer.version)
  const downloaded = await downloadUpdateFile(updateFetch, offer.file, workDir, (percent) => {
    // One status message per whole percent, not one per network chunk, and
    // none once the user skipped this version: the banner stays closed.
    if (Math.floor(percent) === shown || skippedNow()) return
    shown = Math.floor(percent)
    transition({ type: 'progress', percent, version: offer.version })
  }, feed.allowedHosts)
  const path = key === 'darwin-arm64' ? await stageMacUpdate(downloaded, runCommand) : downloaded
  // Skipped while it downloaded: keep the file, offer nothing.
  if (skippedNow()) {
    transition({ type: 'reset' })
    return
  }
  ready = { version: offer.version, key, path, sha256: offer.file.sha256, workDir }
  transition({ type: 'downloaded', version: offer.version })
}

/** Install the downloaded update and restart into it. */
export async function installDownloadedUpdate(): Promise<void> {
  const update = ready
  if (status.phase !== 'downloaded' || update === undefined || installing) return
  installing = true
  let prepared = false
  const prepare = async () => {
    prepared = true
    await hooks?.prepareToInstall()
  }
  try {
    switch (update.key) {
      case 'darwin-arm64': {
        const target = macBundlePath(process.execPath)
        if (target === undefined) throw new Error('could not find the installed app')
        // Background services must be stopped before the swap can start.
        await prepare()
        await launchMacSwap({ pid: process.pid, staged: update.path, target, workDir: update.workDir })
        commit()
        app.quit()
        return
      }
      case 'win32-x64':
        // The installer closes the app, and may kill it, as soon as it runs.
        await prepare()
        await launchWindowsInstaller(update.path)
        commit()
        app.quit()
        return
      case 'linux-x64-appimage': {
        const appImage = process.env.APPIMAGE
        if (appImage === undefined) throw new Error('could not find the AppImage file')
        // Replacing the file does not disturb the running copy, so the
        // Harness stops only once the new version is in place.
        await replaceAppImage(appImage, update.path)
        await stopAfterInstall()
        app.relaunch({ execPath: appImage, args: process.argv.slice(1) })
        app.exit(0)
        return
      }
      case 'linux-x64-deb':
        await installDeb(update.path, update.sha256, runCommand)
        await stopAfterInstall()
        app.relaunch()
        app.exit(0)
        return
    }
  } catch (error) {
    installing = false
    console.warn('[updater] install failed:', errorMessage(error))
    if (prepared) {
      await hooks?.resumeAfterFailedInstall?.().catch((resumeError: unknown) => {
        console.warn('[updater] could not restart the Harness after the failed install:', errorMessage(resumeError))
      })
    }
    transition({ type: 'error', message: errorMessage(error) }, true)
    scheduleReset()
  }
}

/** The new version is installed: stop cleanly, but restart into it regardless. */
async function stopAfterInstall(): Promise<void> {
  try {
    await hooks?.prepareToInstall()
  } catch (error) {
    console.warn('[updater] could not stop cleanly before restarting:', errorMessage(error))
  }
  commit()
}

function commit(): void {
  hooks?.commitToInstall?.()
  stopUpdateManager()
}

function updatesRoot(): string {
  return join(app.getPath('userData'), 'updates')
}

export function stopUpdateManager(): void {
  if (startupTimer) clearTimeout(startupTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  if (resetTimer) clearTimeout(resetTimer)
  startupTimer = undefined
  intervalTimer = undefined
  resetTimer = undefined
  if (started && app.isReady()) powerMonitor.removeListener('resume', checkAfterResume)
}

function platformKey(): UpdatePlatformKey | undefined {
  return updatePlatformKey(process.platform, process.arch, process.platform === 'linux' ? linuxInstallKind(process.env, process.execPath) : undefined)
}

/** Why this run cannot update itself, in words for the update card; undefined when it can. */
function unsupportedReason(): string | undefined {
  // Development builds have their own identity and must never update into a beta.
  if (!UNOBLOX_UPDATE_FEED_CONFIGURED || !supportsAutoUpdates(app.isPackaged, process.platform) || app.getName() === DEV_PRODUCT_NAME) {
    return 'Updates are available in installed builds only.'
  }
  if (platformKey() === undefined) {
    return process.platform === 'linux'
      ? `This copy cannot update itself. Install the ${PRODUCT_NAME} .deb or AppImage to get updates.`
      : 'Updates are not available for this system.'
  }
  if (process.platform === 'darwin') {
    const bundle = macBundlePath(process.execPath)
    if (bundle === undefined || !macBundleIsUpdatable(bundle)) {
      return `Move ${PRODUCT_NAME} to the Applications folder to get updates.`
    }
  }
  return undefined
}

function supportsUpdates(): boolean {
  return unsupportedReason() === undefined
}

/** Whether the app can replace itself where it is installed (macOS, AppImage). */
async function installLocationWritable(): Promise<boolean> {
  const bundle = process.platform === 'darwin' ? macBundlePath(process.execPath) : process.env.APPIMAGE
  if (bundle === undefined) return true
  try {
    await access(dirname(bundle), constants.W_OK)
    return true
  } catch {
    return false
  }
}

function transition(event: UpdateStateEvent, manualOverride?: boolean): void {
  if (event.type !== 'reset' && resetTimer) {
    clearTimeout(resetTimer)
    resetTimer = undefined
  }
  status = reduceUpdateStatus(status, event)
  if (manualOverride !== undefined) status.manual = manualOverride
  if (event.type !== 'progress') console.info('[updater] status', status.phase, status.availableVersion ?? '')
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('updates:status-changed', getUpdateStatus())
  }
}

function scheduleReset(): void {
  if (!status.manual) return
  if (resetTimer) clearTimeout(resetTimer)
  resetTimer = setTimeout(() => transition({ type: 'reset' }), TRANSIENT_STATUS_MS)
}

function checkAfterResume(): void {
  if (automaticUpdateChecks() && shouldCheckAfterResume(lastCheckedAt)) void checkForUpdates()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
