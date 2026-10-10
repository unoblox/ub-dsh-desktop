import { shell, type BrowserWindow } from 'electron'
import {
  canGrantWindowPermission,
  isAllowedWidgetNavigation,
  isInsideWidgetFrame,
  isTrustedAppUrl,
  WIDGET_FRAME_NAME
} from './security-policy'

/**
 * @param appOrigins - the loopback origins this window serves, read at each
 *   navigation because the Harness gets a new port on every launch.
 */
export function secureWindow(window: Pick<BrowserWindow, 'webContents'>, appOrigins: () => readonly string[]): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedAppUrl(url, appOrigins())) return { action: 'allow' }
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // A window the app page opens gets the same rules, or it could go anywhere.
  window.webContents.on('did-create-window', (child) => secureWindow(child, appOrigins))

  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedAppUrl(url, appOrigins())) return
    event.preventDefault()
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
  })

  // Chat widgets run in sandboxed frames whose CSP stops every request but
  // not a navigation of the frame itself. Record each widget frame when it is
  // created (before its script runs) and refuse any navigation of it, or of a
  // frame inside it, away from its own document.
  const widgetFrames = new Set<number>()
  window.webContents.on('frame-created', (_event, { frame }) => {
    if (frame?.name === WIDGET_FRAME_NAME) widgetFrames.add(frame.frameTreeNodeId)
  })
  window.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame || isAllowedWidgetNavigation(event.url, event.isSameDocument)) return
    if (isInsideWidgetFrame(event.frame, widgetFrames)) event.preventDefault()
  })

  // Nothing in the app uses WebRTC, and its STUN/TURN traffic is outside any
  // page's CSP: keep it from opening UDP sockets of its own.
  window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')

  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.session.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) =>
      canGrantWindowPermission(
        permission,
        details.requestingUrl ?? requestingOrigin,
        details.isMainFrame
      )
  )
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      callback(
        canGrantWindowPermission(permission, details.requestingUrl, details.isMainFrame)
      )
    }
  )
}
