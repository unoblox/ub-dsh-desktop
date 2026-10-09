function isHarnessUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    )
  } catch {
    return false
  }
}

export function isTrustedAppUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol === 'file:' || parsed.protocol === 'dsh-recovery:' || parsed.protocol === 'dsh-desktop:') return true
  } catch {
    return false
  }
  return isHarnessUrl(rawUrl)
}

export function canGrantWindowPermission(
  permission: string,
  requestingUrl: string | undefined,
  isMainFrame: boolean
): boolean {
  return (
    (permission === 'clipboard-sanitized-write' || permission === 'notifications') &&
    isMainFrame &&
    requestingUrl !== undefined &&
    isHarnessUrl(requestingUrl)
  )
}

/**
 * Name the chat-widget plugin gives each widget frame
 * (packages/dsh-desktop-widgets/client.js). The main process records a frame
 * by this name when it is created; the widget's own script can rename itself
 * afterwards, so later checks use the recorded frame, not the name.
 */
export const WIDGET_FRAME_NAME = 'unoblox-widget'

/**
 * Where a widget frame, or a frame inside one, may navigate. Its CSP blocks
 * every request a document makes, but not the frame navigating itself
 * (`location.href`, a meta refresh, a link), which would send a request to
 * any server. Only its own srcdoc document (which the chat sets) and in-page
 * fragments are allowed.
 */
export function isAllowedWidgetNavigation(url: string, isSameDocument: boolean): boolean {
  return isSameDocument || url === 'about:srcdoc'
}

interface FrameNode {
  readonly frameTreeNodeId: number
  readonly parent: FrameNode | null
}

/** Whether a frame is a recorded widget frame or nested inside one. */
export function isInsideWidgetFrame(frame: FrameNode | null | undefined, widgetFrames: ReadonlySet<number>): boolean {
  for (let node = frame ?? null; node !== null; node = node.parent) {
    if (widgetFrames.has(node.frameTreeNodeId)) return true
  }
  return false
}
