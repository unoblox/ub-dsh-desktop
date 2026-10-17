// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The Context pill and panel with real React. The design system's Modal and
// Button are plain elements here.
const primitives = new Proxy({
  Button: ({ variant, size, disabled, onClick, type, children }) => React.createElement('button', { 'data-variant': variant, disabled, onClick, type: type ?? 'button' }, children),
  Modal: ({ open, title, children }) => (open ? React.createElement('div', { role: 'dialog', 'aria-label': title }, children) : null)
}, { get: (target, name) => target[name] ?? (() => null) })

function loadPlugin() {
  let factory
  window.__ModuleLoader__ = { load: (definition) => { factory = definition.factory } }
  vm.runInThisContext(readFileSync(path.join(import.meta.dirname, '..', 'packages', 'dsh-desktop-context-graph', 'client.js'), 'utf8'))
  return factory((id) => (id === 'react' ? React : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : {}))
}
const plugin = loadPlugin()
const t = (key, values) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`)

const ITEMS = [
  { id: 'r-00000001', kind: 'rule', text: 'Lowercase brand', quote: 'unoblox is all small letters', pinned: true, origin: 'model', shared: true, files: [] },
  { id: 'f-00000002', kind: 'fact', text: 'Port is chosen by the OS', pinned: false, origin: 'model', shared: true, files: [{ path: 'src/sign-in-config.ts', state: 'changed' }] },
  { id: 't-00000003', kind: 'task', text: 'Write docs', status: 'open', pinned: false, origin: 'user', shared: false, files: [] },
  { id: 'x-bad', kind: 'nonsense', text: 'dropped' }
]

function fakeService(items = ITEMS) {
  const calls = []
  return {
    calls,
    list: vi.fn(async () => plugin.toView({ workspace: '/home/me/project', items })),
    change: vi.fn(async (sessionId, change) => { calls.push([sessionId, change]) })
  }
}

async function render(element) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(element) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)) })
  const click = async (element) => { await act(async () => { element.click() }); await settle() }
  const button = (label) => [...container.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label)
  return { container, root, click, button, settle }
}

afterEach(() => { document.body.innerHTML = '' })

describe('data', () => {
  it('keeps only well-formed items and counts the ones about changed files', () => {
    const view = plugin.toView({ workspace: '/w', items: ITEMS })
    expect(view.items.map((item) => item.id)).toEqual(['r-00000001', 'f-00000002', 't-00000003'])
    expect(plugin.changedCount(view.items)).toBe(1)
    expect(plugin.groupItems(view.items).map(([kind]) => kind)).toEqual(['rule', 'task', 'fact'])
    expect(plugin.toView({ nope: true })).toBeUndefined()
  })

  it('sends changes as JSON to the same-origin route', async () => {
    const doFetch = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    await plugin.createGraphService(doFetch).change('s1', { action: 'pin', id: 'r-00000001' })
    const [url, init] = doFetch.mock.calls[0]
    expect(url).toBe('/api/desktop-context-graph/item')
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ session: 's1', action: 'pin', id: 'r-00000001' })
    await expect(plugin.createGraphService(async () => new Response('{"error":"unknown item"}', { status: 404 })).change('s1', {})).rejects.toThrow('unknown item')
  })
})

describe('Context pill and panel', () => {
  it('shows the count and changed files, and opens the panel grouped by kind', async () => {
    const service = fakeService()
    const view = await render(React.createElement(plugin.ContextDock, { t, service, session: { sessionId: 's1', running: false } }))
    const pill = view.container.querySelector('[data-context-graph]')
    expect(pill.textContent).toContain('pill {"count":3}')
    expect(pill.textContent).toContain('pillChanged {"count":1}')
    await view.click(pill)
    const dialog = view.container.querySelector('[role=dialog]')
    expect(dialog.getAttribute('aria-label')).toBe('panelTitle')
    expect([...dialog.querySelectorAll('h3')].map((h3) => h3.textContent)).toEqual(['kind.rule', 'kind.task', 'kind.fact'])
    expect(dialog.textContent).toContain('“unoblox is all small letters”')
    expect(dialog.querySelector('[data-state=changed]').textContent).toBe('src/sign-in-config.ts (fileChanged)')
    expect(dialog.textContent).toContain('workspace {"path":"/home/me/project"}')
  })

  it('pins, completes and edits items, and asks before removing', async () => {
    const service = fakeService()
    const view = await render(React.createElement(plugin.ContextPanel, { t, service, sessionId: 's1', onClose: () => {}, onChanged: () => {} }))
    await view.settle()
    const row = (id) => view.container.querySelector(`[data-item="${id}"]`)
    await view.click(row('f-00000002').querySelector('[aria-label=pin]'))
    await view.click(row('t-00000003').querySelector('[aria-label=done]'))
    await view.click(row('f-00000002').querySelector('[aria-label=remove]'))
    expect(service.calls.map(([, change]) => change.action)).toEqual(['pin', 'done'])
    expect(row('f-00000002').textContent).toContain('removeConfirm')
    await view.click([...row('f-00000002').querySelectorAll('button')].find((b) => b.textContent === 'remove'))
    expect(service.calls.at(-1)[1]).toEqual({ action: 'delete', id: 'f-00000002' })

    await view.click(row('r-00000001').querySelector('[aria-label=edit]'))
    const textarea = row('r-00000001').querySelector('textarea')
    expect(textarea.value).toBe('unoblox is all small letters')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(textarea, 'unoblox is always lowercase')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await view.click([...row('r-00000001').querySelectorAll('button')].find((b) => b.textContent === 'save'))
    expect(service.calls.at(-1)[1]).toEqual({ action: 'edit', id: 'r-00000001', text: 'unoblox is always lowercase' })
  })

  it('adds an item and reports a failed change', async () => {
    const service = fakeService([])
    const view = await render(React.createElement(plugin.ContextPanel, { t, service, sessionId: 's1', onClose: () => {}, onChanged: () => {} }))
    await view.settle()
    expect(view.container.textContent).toContain('empty')
    const input = view.container.querySelector('.dshCtxAdd input')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Always answer in English')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await view.click(view.button('add'))
    expect(service.calls.at(-1)[1]).toEqual({ action: 'add', kind: 'rule', text: 'Always answer in English' })
    service.change.mockRejectedValueOnce(new Error('store locked'))
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Another')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await view.click(view.button('add'))
    expect(view.container.querySelector('[role=alert]').textContent).toBe('changeFailed {"message":"store locked"}')
  })

  it('renders nothing when the graph is empty, and says so when it cannot load', async () => {
    const view = await render(React.createElement(plugin.ContextDock, { t, service: fakeService([]), session: { sessionId: 's1' } }))
    expect(view.container.innerHTML).toBe('')
    document.body.innerHTML = ''
    const failing = { list: async () => { throw new Error('HTTP 500') }, change: async () => {} }
    const panel = await render(React.createElement(plugin.ContextPanel, { t, service: failing, sessionId: 's1', onClose: () => {}, onChanged: () => {} }))
    await panel.settle()
    expect(panel.container.querySelector('[role=alert]').textContent).toBe('loadFailed {"message":"HTTP 500"}')
  })
})
