/**
 * unoblox has no update server yet. The inherited feed and update-policy
 * endpoints belong to upstream (dshdesktop.com): checking them would send the
 * installation ID and version there and offer upstream's builds, which lack
 * unoblox. Until an unoblox feed exists, no update path touches the network;
 * users update by installing the latest unoblox installer.
 */
export const UNOBLOX_UPDATE_FEED_CONFIGURED: boolean = false

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000
export const UPDATE_STARTUP_DELAY_MS = 15_000
export const UPDATE_STARTUP_JITTER_MS = 15_000
export const AUTO_INSTALL_ON_APP_QUIT = false

export function supportsAutoUpdates(isPackaged: boolean, platform: NodeJS.Platform): boolean {
  return isPackaged && (platform === 'darwin' || platform === 'win32')
}

export function shouldCheckAfterResume(lastCheckedAt: number, now = Date.now()): boolean {
  return now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS
}
