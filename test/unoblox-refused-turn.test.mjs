// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The actions under a turn unoblox refused, with real React. The turn and
// its turn/end event have the shapes the chat passes to the turnTail slot.
function loadPlugin() {
  let factory
  window.__ModuleLoader__ = { load: (definition) => { factory = definition.factory } }
  vm.runInThisContext(readFileSync(path.join(import.meta.dirname, '..', 'packages', 'dsh-desktop-unoblox-info', 'client.js'), 'utf8'))
  return factory((id) => (id === 'react' ? React : id === '@deepseek-ai/dsh-client-ui-primitives' ? { IconSparkleRegular: () => null, IconWarningOutlineRegular: () => null } : {}))
}

const plugin = loadPlugin()
const t = (key, values) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`)

function failedTurn(error, request = 'Reply with exactly the word: pong') {
  return {
    turn: 1,
    end: { type: 'turn/end', seq: 17, data: { turn: 1, reason: { kind: 'error', error } } },
    data: new Map(request === null ? [] : [['desktop-unoblox-request', { turn: 1, first: true, text: request }]])
  }
}

// A balance that meets the free-model hold, as the info route reports it.
const HELD = async () => ({ key: 'set', balanceInr: 1500, balanceRequirementInr: 1000, freeModels: [] })
const BALANCE = { message: 'Your unoblox balance (₹0.00) is below the ₹1.20 this request needs. (UB-GW-003)', code: 'UNOBLOX_BALANCE', status: 402 }
const REVOKED = { message: 'Please sign in with a valid API key. (UB-GW-007)', code: 'AUTH', status: 401 }

async function render(props) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(React.createElement(plugin.RefusedTurnActions, { t, ...props })) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const button = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)
  const click = async (element) => { await act(async () => { element.click(); await new Promise((resolve) => setTimeout(resolve, 0)) }) }
  return { container, button, click }
}

afterEach(() => {
  delete window.dshDesktop
  document.body.innerHTML = ''
})

describe('refused unoblox turns', () => {
  it('offers a free model and a top-up after a balance refusal, and switches only on click', async () => {
    const selectFreeModel = vi.fn(async () => 'qwen/qwen3.8-27b')
    const sendText = vi.fn(async () => {})
    const view = await render({ loadBilling: HELD, turn: failedTurn(BALANCE), selectFreeModel, sendText })
    expect(view.container.querySelector('[data-unoblox-refusal]')?.getAttribute('data-unoblox-refusal')).toBe('balance')
    const topUp = view.container.querySelector('a')
    expect(topUp?.getAttribute('href')).toBe('https://unoblox.ai/user/credits/topup')
    expect(topUp?.getAttribute('target')).toBe('_blank')
    expect(topUp?.getAttribute('rel')).toContain('noopener')
    expect(selectFreeModel).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()

    await view.click(view.button('failUseFree'))
    expect(selectFreeModel).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledWith('Reply with exactly the word: pong')
    expect(view.container.querySelector('[role=status]')?.textContent).toBe('failSwitchedSent {"model":"qwen3.8-27b"}')
    // Done: no second retry from the same row.
    expect(view.button('failUseFree')).toBeUndefined()
  })

  it('switches without resending when the message cannot be repeated', async () => {
    const sendText = vi.fn(async () => {})
    const view = await render({ loadBilling: HELD, turn: failedTurn(BALANCE, null), selectFreeModel: async () => 'google/gemma-4-26b-a4b-it', sendText })
    await view.click(view.button('failUseFree'))
    expect(sendText).not.toHaveBeenCalled()
    expect(view.container.querySelector('[role=status]')?.textContent).toBe('failSwitched {"model":"gemma-4-26b-a4b-it"}')
  })

  it('reports a failed switch and keeps the buttons', async () => {
    const sendText = vi.fn(async () => {})
    const view = await render({ loadBilling: HELD, turn: failedTurn(BALANCE), selectFreeModel: async () => { throw new Error('session in use') }, sendText })
    await view.click(view.button('failUseFree'))
    expect(sendText).not.toHaveBeenCalled()
    const status = view.container.querySelector('[role=status]')
    expect(status?.dataset.tone).toBe('error')
    expect(status?.textContent).toBe('failSwitchFailed {"message":"session in use"}')
    expect(view.button('failUseFree')?.disabled).toBe(false)
  })

  it('offers sign-in after a revoked key, then sending again', async () => {
    window.dshDesktop = { unobloxSignInAvailable: vi.fn(async () => true), unobloxSignIn: vi.fn(async () => ({ ok: true })) }
    const sendText = vi.fn(async () => {})
    const view = await render({ turn: failedTurn(REVOKED), selectFreeModel: vi.fn(), sendText })
    await view.click(view.button('failSignIn'))
    expect(window.dshDesktop.unobloxSignIn).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('[role=status]')?.textContent).toBe('failSignedIn')
    await view.click(view.button('failRetry'))
    expect(sendText).toHaveBeenCalledWith('Reply with exactly the word: pong')
  })

  it('says nothing about a cancelled sign-in', async () => {
    window.dshDesktop = { unobloxSignInAvailable: async () => true, unobloxSignIn: async () => ({ ok: false, code: 'cancelled', message: 'Sign-in was cancelled.' }) }
    const view = await render({ turn: failedTurn(REVOKED), selectFreeModel: vi.fn(), sendText: vi.fn() })
    await view.click(view.button('failSignIn'))
    expect(view.container.querySelector('[role=status]')).toBeNull()
    expect(view.button('failSignIn')?.disabled).toBe(false)
  })

  it('adds nothing when sign-in is not available or the failure is not from unoblox', async () => {
    window.dshDesktop = { unobloxSignInAvailable: async () => false, unobloxSignIn: vi.fn() }
    expect((await render({ turn: failedTurn(REVOKED) })).container.innerHTML).toBe('')
    document.body.innerHTML = ''
    expect((await render({ turn: failedTurn({ message: '', code: 'AUTH' }) })).container.innerHTML).toBe('')
    document.body.innerHTML = ''
    expect((await render({ turn: failedTurn({ message: 'socket hang up', code: 'TRANSPORT' }) })).container.innerHTML).toBe('')
    document.body.innerHTML = ''
    const finished = { turn: 1, end: { data: { reason: { kind: 'stop' } } }, data: new Map() }
    expect((await render({ turn: finished })).container.innerHTML).toBe('')
  })

  it('offers sending again when unoblox was busy', async () => {
    const sendText = vi.fn(async () => {})
    const view = await render({ turn: failedTurn({ message: 'Slow down. (UB-GW-303)', code: 'RATE_LIMIT', status: 429 }), sendText })
    expect(view.container.textContent).toContain('failBusyHint')
    await view.click(view.button('failRetry'))
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(view.button('failRetry')).toBeUndefined()
  })
})

describe('free models need a held balance', () => {
  // As served on 2026-10-17.
  const HOLD_REFUSAL = { message: "This freemium model needs a ₹1000.00 balance held (never spent) to serve free; your balance ₹0.26 is below it, and it's also too low to cover this request at standard rates. Add ₹999.74 to restore free access, or add funds to continue at standard rates. (UB-GW-068)", code: 'UNOBLOX_BALANCE', status: 402 }

  it('reads the balance and the hold from the refusal, else from the last reported balance', () => {
    expect(plugin.freeAllowance(HOLD_REFUSAL.message)).toEqual({ canUseFree: false, requirement: 1000, balance: 0.26 })
    expect(plugin.freeAllowance(BALANCE.message, { balanceInr: 1200 })).toEqual({ canUseFree: true, requirement: 1000, balance: 1200 })
    expect(plugin.freeAllowance(BALANCE.message, { balanceInr: 1200, balanceRequirementInr: 2000 })).toMatchObject({ canUseFree: false, requirement: 2000 })
    expect(plugin.freeAllowance('your balance ₹1,250.00 is fine; needs a ₹1,000.00 balance held')).toMatchObject({ canUseFree: true, balance: 1250, requirement: 1000 })
    // Nothing known about the balance: no offer.
    expect(plugin.freeAllowance(BALANCE.message)).toEqual({ canUseFree: false, requirement: 1000 })
  })

  it('offers only Top up below the hold, and says why', async () => {
    const selectFreeModel = vi.fn()
    const view = await render({ turn: failedTurn(HOLD_REFUSAL), selectFreeModel, sendText: vi.fn(), loadBilling: HELD })
    expect(view.button('failUseFree')).toBeUndefined()
    expect(view.container.textContent).toContain('failFreeNeedsHold {"amount":"₹1,000.00"}')
    expect(view.container.querySelector('a')?.getAttribute('href')).toBe('https://unoblox.ai/user/credits/topup')
  })

  it('uses the last reported balance when the refusal does not say', async () => {
    const low = await render({ turn: failedTurn(BALANCE), selectFreeModel: vi.fn(), sendText: vi.fn(), loadBilling: async () => ({ key: 'set', balanceInr: 250.5 }) })
    expect(low.button('failUseFree')).toBeUndefined()
    document.body.innerHTML = ''
    const unknown = await render({ turn: failedTurn(BALANCE), selectFreeModel: vi.fn(), sendText: vi.fn(), loadBilling: async () => undefined })
    expect(unknown.button('failUseFree')).toBeUndefined()
    document.body.innerHTML = ''
    const held = await render({ turn: failedTurn(BALANCE), selectFreeModel: vi.fn(), sendText: vi.fn(), loadBilling: HELD })
    expect(held.button('failUseFree')).toBeDefined()
  })
})

describe('the request a turn answers', () => {
  const definition = plugin.requestDefinition
  const userMessage = (id, content, extra = {}) => ({
    type: 'user/message', seq: 8, surfaceOp: 'append',
    data: { id, role: 'user', source: { kind: 'user', rpcId: 'r' }, content }, ...extra
  })
  const at = (turn) => ({ kind: 'step', turn: { turn }, step: { step: 1 } })

  it('matches only appended messages the user typed', () => {
    expect(definition.match(userMessage('a', []))).toEqual({ id: 'a', role: 'start' })
    expect(definition.match({ ...userMessage('b', []), data: { id: 'b', source: { kind: 'runtime-context' }, content: [] } })).toBeNull()
    expect(definition.match({ ...userMessage('c', []), surfaceOp: 'replace' })).toBeNull()
    expect(definition.match({ type: 'turn/start', seq: 4, data: { turn: 1 } })).toBeNull()
  })

  it('publishes the first user message of each turn as that turn\'s request', () => {
    const first = definition.start({}, { event: userMessage('a', [{ type: 'text', text: 'hello' }]), location: at(3) }, { previous: () => undefined })
    expect(first).toEqual({ turn: 3, first: true, text: 'hello' })
    expect(definition.buildLocationData({ state: first }, 'turn', null)).toEqual({ kind: 'turn', turn: 3, key: 'desktop-unoblox-request', value: first })
    expect(definition.buildLocationData({ state: first }, 'step', null)).toBeNull()
    // A steering message later in the same turn does not compete for the slot.
    const steer = definition.start({}, { event: userMessage('b', [{ type: 'text', text: 'also' }]), location: at(3) }, { previous: () => ({ state: first }) })
    expect(steer.first).toBe(false)
    expect(definition.buildLocationData({ state: steer }, 'turn', null)).toBeNull()
    // The next turn's message is that turn's request.
    const next = definition.start({}, { event: userMessage('c', [{ type: 'text', text: 'next' }]), location: at(4) }, { previous: () => ({ state: steer }) })
    expect(next).toEqual({ turn: 4, first: true, text: 'next' })
  })

  it('keeps no text for a message with files or images', () => {
    expect(plugin.requestText([{ type: 'text', text: 'see this' }, { type: 'image', attachment: {} }])).toBeUndefined()
    expect(plugin.requestText([{ type: 'text', text: '  ' }])).toBeUndefined()
    expect(plugin.requestText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb')
  })
})
