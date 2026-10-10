import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }))
vi.mock('electron', () => ({ shell: { openExternal } }))

import { secureWindow } from '../src/main/security'
import { isAllowedWidgetNavigation, isInsideWidgetFrame, WIDGET_FRAME_NAME } from '../src/main/security-policy'

interface FakeFrame {
  name: string
  frameTreeNodeId: number
  parent: FakeFrame | null
}

type Listener = (...args: unknown[]) => void

function fakeWindow(origins: readonly string[] = ['http://127.0.0.1:4310']) {
  const listeners = new Map<string, Listener[]>()
  const webContents = {
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return webContents
    },
    setWindowOpenHandler: vi.fn(),
    setWebRTCIPHandlingPolicy: vi.fn(),
    session: { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() }
  }
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }
  // The structural parameter type is narrower than BrowserWindow; the fake
  // implements only what secureWindow calls.
  secureWindow({ webContents } as unknown as Parameters<typeof secureWindow>[0], () => origins)
  let nextId = 10
  const frame = (name: string, parent: FakeFrame | null): FakeFrame => ({ name, frameTreeNodeId: nextId++, parent })
  const created = (child: FakeFrame) => emit('frame-created', {}, { frame: child })
  const navigate = (target: FakeFrame | null, url: string, options: { isMainFrame?: boolean; isSameDocument?: boolean } = {}) => {
    const event = { url, isMainFrame: options.isMainFrame ?? false, isSameDocument: options.isSameDocument ?? false, frame: target, preventDefault: vi.fn() }
    emit('will-frame-navigate', event)
    return event.preventDefault.mock.calls.length > 0
  }
  const opened = (url: string) => (webContents.setWindowOpenHandler.mock.calls[0]?.[0] as (details: { url: string }) => { action: string })({ url })
  return { webContents, frame, created, navigate, emit, opened }
}

describe('widget frame navigation guard', () => {
  it('keeps a widget frame, and frames inside it, on its own document', () => {
    const win = fakeWindow()
    const app = win.frame('', null)
    const widget = win.frame(WIDGET_FRAME_NAME, app)
    win.created(widget)
    expect(win.navigate(widget, 'https://example.com/?d=secret')).toBe(true)
    expect(win.navigate(widget, 'data:text/html,<p>x</p>')).toBe(true)
    expect(win.navigate(widget, 'about:blank')).toBe(true)
    expect(win.navigate(widget, 'about:srcdoc')).toBe(false)
    expect(win.navigate(widget, 'about:srcdoc#part', { isSameDocument: true })).toBe(false)

    // The widget renames itself: the frame it was created as still counts.
    widget.name = 'innocent'
    expect(win.navigate(widget, 'https://example.com/')).toBe(true)

    const nested = win.frame('', widget)
    win.created(nested)
    expect(win.navigate(nested, 'https://example.com/')).toBe(true)
  })

  it('leaves other frames and the window itself alone', () => {
    const win = fakeWindow()
    const app = win.frame('', null)
    const preview = win.frame('dsh-sidebar-html-1', app)
    win.created(preview)
    expect(win.navigate(preview, 'https://example.com/')).toBe(false)
    expect(win.navigate(app, 'http://127.0.0.1:4310/', { isMainFrame: true })).toBe(false)
    expect(win.navigate(null, 'https://example.com/')).toBe(false)
  })

  it('stops WebRTC from opening its own UDP sockets', () => {
    expect(fakeWindow().webContents.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('disable_non_proxied_udp')
  })

  it('matches the name the widget client gives its frames', () => {
    const client = readFileSync(path.join(import.meta.dirname, '..', 'packages', 'dsh-desktop-widgets', 'client.js'), 'utf8')
    expect(client).toContain(`name: '${WIDGET_FRAME_NAME}'`)
  })

  it('has pure rules for the allowed targets and the frame chain', () => {
    expect(isAllowedWidgetNavigation('about:srcdoc', false)).toBe(true)
    expect(isAllowedWidgetNavigation('https://x/#a', true)).toBe(true)
    expect(isAllowedWidgetNavigation('blob:null/1', false)).toBe(false)
    const root = { frameTreeNodeId: 1, parent: null }
    const child = { frameTreeNodeId: 2, parent: root }
    expect(isInsideWidgetFrame({ frameTreeNodeId: 3, parent: child }, new Set([2]))).toBe(true)
    expect(isInsideWidgetFrame(child, new Set([3]))).toBe(false)
    expect(isInsideWidgetFrame(undefined, new Set([1]))).toBe(false)
  })
})

describe('app window trust', () => {
  it('opens only its own origin inside the app, everything else in the browser', () => {
    const win = fakeWindow()
    openExternal.mockClear()
    expect(win.opened('http://127.0.0.1:4310/session/2')).toEqual({ action: 'allow' })
    expect(win.opened('http://127.0.0.1:3000/')).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('http://127.0.0.1:3000/')
  })

  it('applies the same rules to a window the page opens', () => {
    const win = fakeWindow()
    const childListeners = new Map<string, Listener[]>()
    const child = {
      webContents: {
        on(event: string, listener: Listener) {
          childListeners.set(event, [...(childListeners.get(event) ?? []), listener])
          return child.webContents
        },
        setWindowOpenHandler: vi.fn(),
        setWebRTCIPHandlingPolicy: vi.fn(),
        session: { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() }
      }
    }
    win.emit('did-create-window', child)
    expect(child.webContents.setWindowOpenHandler).toHaveBeenCalled()
    const preventDefault = vi.fn()
    for (const listener of childListeners.get('will-navigate') ?? []) listener({ preventDefault }, 'http://127.0.0.1:3000/')
    expect(preventDefault).toHaveBeenCalled()
  })
})
