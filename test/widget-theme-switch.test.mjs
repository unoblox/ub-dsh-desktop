// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The chat side of a theme switch, with real React: the widget frame keeps
// its document (and so what the user entered) and is restyled by message.
function widgetsTail() {
  const source = readFileSync(path.join(import.meta.dirname, '..', 'packages', 'dsh-desktop-widgets', 'client.js'), 'utf8')
  let factory
  window.__ModuleLoader__ = { load: (definition) => { factory = definition.factory } }
  vm.runInThisContext(source)
  if (!factory) throw new Error('client did not register')
  const components = new Map()
  factory((id) => id === 'react' ? React : {}).apply({
    effect: () => {},
    locale: { register: () => {} },
    uiConversation: { events: { register: () => {} } },
    get: () => undefined,
    slots: {
      inject: (_name, register) => register(),
      register: (definition, component) => { components.set(definition.name, component) }
    }
  })
  const tail = components.get('conversation.chat.turnTail')
  if (!tail) throw new Error('no turn tail')
  return tail
}

afterEach(() => {
  document.body.removeAttribute('data-ds-dark-theme')
  document.body.innerHTML = ''
})

describe('a chat theme switch', () => {
  it('restyles open widgets in place instead of reloading them', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const Tail = widgetsTail()
    const turn = { data: new Map([['unoblox-widgets', { widgets: [{ callId: 'c1', argsRaw: JSON.stringify({ title: 'Loan', html: '<input id=a value=1>' }) }] }]]) }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(React.createElement(Tail, { turn, t: (key) => key, sendText: async () => {} })) })
    const frame = container.querySelector('iframe')
    expect(frame).not.toBeNull()
    const built = frame?.getAttribute('srcdoc')
    expect(built).toContain('color-scheme:light')
    const post = vi.fn()
    Object.defineProperty(frame?.contentWindow, 'postMessage', { value: post, configurable: true })
    await act(async () => { frame?.dispatchEvent(new Event('load')) })

    await act(async () => { document.body.setAttribute('data-ds-dark-theme', '') })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    // Same document: the frame does not reload, so the user's input stays.
    expect(container.querySelector('iframe')).toBe(frame)
    expect(frame?.getAttribute('srcdoc')).toBe(built)
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ __unobloxTheme: true, dark: true, page: '#1b1b1c', vars: expect.objectContaining({ '--uw-fg': '#f2f2f3' }) }), '*')
    // No token leaves the bridge in this direction.
    expect(JSON.stringify(post.mock.calls)).not.toMatch(/[0-9a-f]{32}/u)
    await act(async () => { root.unmount() })
  })
})
