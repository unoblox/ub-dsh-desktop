// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The first-run dialog's "Sign in with unoblox", with real React. The design
// system's Button and Modal are replaced by plain elements.
const primitives = {
  Button: ({ variant, disabled, onClick, children }) => React.createElement('button', { 'data-variant': variant, disabled, onClick }, children),
  Modal: ({ open, children }) => (open ? React.createElement('div', { role: 'dialog' }, children) : null),
  IconGlobeOutlineRegular: () => null,
  IconLinkOutlineRegular: () => null
}

function notice() {
  let factory
  window.__ModuleLoader__ = { load: (definition) => { factory = definition.factory } }
  vm.runInThisContext(readFileSync(path.join(import.meta.dirname, '..', 'packages', 'dsh-desktop-onboarding', 'client.js'), 'utf8'))
  const module = factory((id) => (id === 'react' ? React : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : {}))
  let component, injected
  const locale = { bind: () => (key) => key, register: () => {} }
  module.apply({
    remote: { credentials: { describe: async () => ({ ok: true, value: { UNOBLOX_API_KEY: { configured: false } } }), set: async () => ({ ok: true }) } },
    inject: (_names, callback) => callback({
      locale,
      configForms: { get: () => ({ getSnapshot: () => ({ mode: 'memory', value: {} }), subscribe: () => () => {}, set: async () => {} }) },
      slots: { inject: (_name, register) => register(), register: (definition, Component) => { component = Component; injected = definition.inject() } }
    })
  })
  return { Component: component, props: injected }
}

async function render(bridge) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.dshDesktop = bridge
  const { Component, props } = notice()
  const complete = vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(React.createElement(Component, { ...props, complete })) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const button = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)
  return { container, root, complete, button }
}

afterEach(() => {
  delete window.dshDesktop
  document.body.innerHTML = ''
})

describe('first-run sign-in', () => {
  it('offers Sign in with unoblox first when the app supports it, and closes once signed in', async () => {
    let finishSignIn
    const bridge = {
      unobloxSignInAvailable: vi.fn(async () => true),
      unobloxSignIn: vi.fn(() => new Promise((resolve) => { finishSignIn = resolve })),
      unobloxSignInCancel: vi.fn(async () => {})
    }
    const view = await render(bridge)
    const signIn = view.button('signInButton')
    expect(signIn?.dataset.variant).toBe('primary')
    // The paste path stays, as the secondary action.
    expect(view.button('unobloxConnect')?.dataset.variant).toBe('outline')
    await act(async () => { signIn.click() })
    expect(bridge.unobloxSignIn).toHaveBeenCalledTimes(1)
    expect(view.button('signInWaiting')?.disabled).toBe(true)
    expect(view.container.querySelector('#dshDeskOnbUnobloxKey').disabled).toBe(true)
    await act(async () => { finishSignIn({ ok: true }) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(view.complete).toHaveBeenCalled()
    await act(async () => { view.root.unmount() })
  })

  it('lets the user cancel, without calling it a failure, and shows a real failure', async () => {
    const results = [{ ok: false, code: 'cancelled', message: 'Sign-in was cancelled.' }, { ok: false, code: 'exchange-failed', message: 'code expired' }]
    const bridge = {
      unobloxSignInAvailable: async () => true,
      unobloxSignIn: vi.fn(async () => results.shift()),
      unobloxSignInCancel: vi.fn(async () => {})
    }
    const view = await render(bridge)
    await act(async () => { view.button('signInButton').click() })
    expect(view.container.querySelector('[role=alert]')?.textContent ?? '').not.toContain('signInFailed')
    await act(async () => { view.button('signInButton').click() })
    expect([...view.container.querySelectorAll('[role=alert]')].map((node) => node.textContent).join(' ')).toContain('signInFailed')
    expect(view.complete).not.toHaveBeenCalled()
    await act(async () => { view.root.unmount() })
  })

  it('shows only the paste field when sign-in is not available', async () => {
    const view = await render({ unobloxSignInAvailable: async () => false, unobloxSignIn: vi.fn(), unobloxSignInCancel: vi.fn() })
    expect(view.button('signInButton')).toBeUndefined()
    expect(view.button('unobloxConnect')?.dataset.variant).toBe('primary')
    await act(async () => { view.root.unmount() })
    delete window.dshDesktop
    const plain = await render(undefined)
    expect(plain.button('signInButton')).toBeUndefined()
    await act(async () => { plain.root.unmount() })
  })
})
