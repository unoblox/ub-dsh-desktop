// @vitest-environment jsdom
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path, { join } from 'node:path'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBudgetStore, createSpendTracker } from '../packages/dsh-desktop-unoblox-info/spend.js'
import { apply as applyInfo, BUDGET_CODE, BUDGET_ROUTE, INFO_ROUTE } from '../packages/dsh-desktop-unoblox-info/index.js'

let dir = ''
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ubx-budget-')) })
afterEach(async () => {
  document.body.innerHTML = ''
  // Usage records are written in the background; let them land first.
  await new Promise((resolve) => setTimeout(resolve, 30))
  await rm(dir, { recursive: true, force: true, maxRetries: 3 })
})

/** The x-unoblox-freemium header of one charged response. */
const charged = (inr) => ({ 'x-unoblox-freemium': JSON.stringify({ balance_inr: 50, balance_requirement_inr: 1000, charged_inr: inr, charged_estimated: true, tier: 'freemium', stage: 'paid' }) })

describe('spend tracker', () => {
  it('adds up each task and the conversation, and averages recent steps', () => {
    const spend = createSpendTracker()
    spend.turnStarted('s1', 1)
    spend.charge('s1', { chargedInr: 0.1 })
    spend.charge('s1', { chargedInr: 0.25, chargedEstimated: true })
    expect(spend.view('s1')).toEqual({ taskInr: 0.35, sessionInr: 0.35, estimated: true, stepInr: 0.18, stepsCounted: 2 })
    spend.turnStarted('s1', 2)
    spend.charge('s1', { chargedInr: 1 })
    expect(spend.view('s1')).toMatchObject({ taskInr: 1, sessionInr: 1.35, estimated: false })
    spend.charge('s1', { chargedInr: -1 })
    spend.charge('s1', { chargedInr: 'x' })
    expect(spend.taskSpent('s1')).toBe(1)
    expect(spend.view('other')).toBeUndefined()
  })

  it('keeps budgets per conversation in a file, and refuses nonsense', async () => {
    const file = join(dir, 'budgets.json')
    const budgets = createBudgetStore(file)
    await budgets.set('s1', 20)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, budgets: { s1: 20 } })
    expect(await createBudgetStore(file).get('s1')).toBe(20)
    await expect(budgets.set('s1', 0)).rejects.toThrow(RangeError)
    await expect(budgets.set('s1', Number.NaN)).rejects.toThrow(RangeError)
    await budgets.set('s1', null)
    expect(await createBudgetStore(file).get('s1')).toBeUndefined()
  })
})

function host() {
  const listeners = new Map()
  const routes = new Map()
  const logs = []
  const ctx = {
    on: (name, listener, options) => listeners.set(name, [...(options?.prepend ? [listener] : []), ...(listeners.get(name) ?? []), ...(options?.prepend ? [] : [listener])]),
    get: () => undefined,
    logger: { warn: (...args) => logs.push(args), info: (...args) => logs.push(args) },
    connection: { fetch: { register: (route) => routes.set(route.path, route.fetch) } }
  }
  applyInfo(ctx, { root: dir }, { isAgentCall: (options) => options.agentLoop === true })
  const emit = (name, ...args) => listeners.get(name)?.forEach((listener) => listener(...args))
  const waterfall = (name, ...args) => {
    const chain = [...(listeners.get(name) ?? [])]
    const inner = args.pop()
    const next = () => (chain.shift() ?? inner)(...args)
    args.push(next)
    return next()
  }
  const call = async (options) => {
    const chunks = []
    for await (const chunk of waterfall('llm/stream', options, () => (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })())) chunks.push(chunk)
    return chunks
  }
  const post = (body, headers = { 'content-type': 'application/json' }) => routes.get(BUDGET_ROUTE)(new Request(`http://harness.internal${BUDGET_ROUTE}`, { method: 'POST', headers, body: JSON.stringify(body) }))
  const info = async (session) => (await routes.get(INFO_ROUTE)(new Request(`http://127.0.0.1${INFO_ROUTE}?session=${session}`))).json()
  return { emit, waterfall, call, post, info, logs }
}

describe('budget', () => {
  it('stops the agent\'s next model call once a task spent its budget, and never retries the stop', async () => {
    const h = host()
    expect((await h.post({ session: 's1', budgetInr: 0.7 })).status).toBe(200)
    h.emit('session/event', { header: { id: 's1' } }, { type: 'turn/start', data: { turn: 1 } })
    expect((await h.call({ sessionId: 's1', agentLoop: true }))[0].reason.kind).toBe('stop')
    h.emit('llm-pi-ai/response', { provider: 'unoblox', sessionId: 's1', headers: charged(0.3) })
    // ₹0.30 spent, next step about ₹0.30: ₹0.60 stays within ₹0.70.
    expect((await h.call({ sessionId: 's1', agentLoop: true }))[0].reason.kind).toBe('stop')
    h.emit('llm-pi-ai/response', { provider: 'unoblox', sessionId: 's1', headers: charged(0.3) })
    // ₹0.60 spent: another ₹0.30 step would go over, so it is not made.
    const stopped = await h.call({ sessionId: 's1', agentLoop: true })
    expect(stopped).toEqual([{ type: 'finish', reason: { kind: 'error', failure: { message: 'This task stopped at its budget: ₹0.60 spent of ₹0.70, and the next step would cost about ₹0.30.', code: BUDGET_CODE } } }])
    // Compaction and title calls in the same task still go through.
    expect((await h.call({ sessionId: 's1', purpose: 'compaction' }))[0].reason.kind).toBe('stop')
    // Not retried, even ahead of an "always retry" listener.
    const retried = vi.fn(() => ({ kind: 'retry' }))
    expect(await h.waterfall('agent/request-error', { failure: { code: BUDGET_CODE } }, retried)).toBeUndefined()
    expect(retried).not.toHaveBeenCalled()
    expect(await h.waterfall('agent/request-error', { failure: { code: 'RATE_LIMIT' } }, retried)).toEqual({ kind: 'retry' })
    // The next message is a new task.
    h.emit('session/event', { header: { id: 's1' } }, { type: 'turn/start', data: { turn: 2 } })
    expect((await h.call({ sessionId: 's1', agentLoop: true }))[0].reason.kind).toBe('stop')
    expect(await h.info('s1')).toMatchObject({ budgetInr: 0.7, spend: { taskInr: 0, sessionInr: 0.6, stepsCounted: 2 } })
  })

  it('accepts the app page\'s own POST although the route sees another URL (as in the packaged app)', async () => {
    const h = host()
    // The Harness hands the route a request URL that is not the page's origin.
    const routed = (headers) => h.post({ session: 's1', budgetInr: 2 }, { 'content-type': 'application/json', ...headers })
    expect((await routed({ origin: 'http://127.0.0.1:43129', 'sec-fetch-site': 'same-origin' })).status).toBe(200)
    expect((await routed({ origin: 'http://127.0.0.1:43129', host: '127.0.0.1:43129' })).status).toBe(200)
    expect((await routed({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await routed({ origin: 'http://127.0.0.1:9999', host: '127.0.0.1:43129' })).status).toBe(403)
  })

  it('sets budgets only from same-origin JSON', async () => {
    const h = host()
    expect((await h.post({ session: 's1', budgetInr: 5 }, { 'content-type': 'text/plain' })).status).toBe(403)
    expect((await h.post({ session: 's1', budgetInr: 5 }, { 'content-type': 'application/json', origin: 'https://evil.example' })).status).toBe(403)
    expect((await h.post({ session: 's1', budgetInr: -1 })).status).toBe(400)
    expect((await h.post({ session: 's1', budgetInr: '5' })).status).toBe(400)
    expect((await h.info('s1')).budgetInr).toBeNull()
  })
})

// ---------- client ----------

const primitives = new Proxy({
  Button: ({ disabled, onClick, type, children }) => React.createElement('button', { disabled, onClick, type: type ?? 'button' }, children),
  Modal: ({ open, title, children }) => (open ? React.createElement('div', { role: 'dialog', 'aria-label': title }, children) : null)
}, { get: (target, name) => target[name] ?? (() => null) })

function loadClient() {
  let factory
  window.__ModuleLoader__ = { load: (definition) => { factory = definition.factory } }
  vm.runInThisContext(readFileSync(path.join(import.meta.dirname, '..', 'packages', 'dsh-desktop-unoblox-info', 'client.js'), 'utf8'))
  return factory((id) => (id === 'react' ? React : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : {}))
}
const client = loadClient()
const t = (key, values) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`)

async function render(element) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(element) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const click = async (el) => { await act(async () => { el.click(); await new Promise((resolve) => setTimeout(resolve, 0)) }) }
  const button = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent === text || b.getAttribute('aria-label')?.startsWith(text))
  return { container, click, button }
}

describe('budget UI', () => {
  it('shows the task spend against the budget and edits the budget', async () => {
    const view = client.toView({ key: 'set', billing: null, turn: null, spend: { taskInr: 4.5, sessionInr: 12.25, estimated: true, stepInr: 0.45, stepsCounted: 10 }, budgetInr: 5, freeModels: [], lowCostModels: [] })
    expect(view).toMatchObject({ spend: { taskInr: 4.5, sessionInr: 12.25, stepInr: 0.45 }, budgetInr: 5 })
    const service = { load: vi.fn(async () => view), setBudget: vi.fn(async () => {}) }
    const ui = await render(React.createElement(client.UnobloxInfoDock, { t, service, session: { sessionId: 's1', running: false } }))
    const pill = [...ui.container.querySelectorAll('button')].find((b) => b.textContent.includes('taskSpendBudget'))
    expect(pill.textContent).toBe('taskSpendBudget {"amount":"₹4.50","budget":"₹5.00"}')
    expect(pill.className).toContain('dshUbxInfoSpendNear')
    expect(pill.getAttribute('aria-label')).toContain('stepHint {"amount":"₹0.45","count":10}')
    await ui.click(pill)
    const input = ui.container.querySelector('[role=dialog] input')
    expect(input.value).toBe('5')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '12.5')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await ui.click(ui.button('budgetSave'))
    expect(service.setBudget).toHaveBeenCalledWith('s1', 12.5)
    expect(ui.container.querySelector('[role=dialog]')).toBeNull()
  })

  it('says when the budget is the default one, and offers no Remove for it', async () => {
    const view = client.toView({ key: 'set', billing: null, turn: null, spend: null, budgetInr: 3, budgetIsDefault: true, freeModels: [], lowCostModels: [] })
    expect(view).toMatchObject({ budgetInr: 3, budgetIsDefault: true })
    const ui = await render(React.createElement(client.BudgetDialog, { t, view, onSave: async () => {}, onClose: () => {} }))
    expect(ui.container.textContent).toContain('budgetDefault')
    expect(ui.button('budgetRemove')).toBeUndefined()
    const own = await render(React.createElement(client.BudgetDialog, { t, view: client.toView({ key: 'set', billing: null, turn: null, spend: null, budgetInr: 3, budgetIsDefault: false, freeModels: [], lowCostModels: [] }), onSave: async () => {}, onClose: () => {} }))
    expect(own.container.textContent).not.toContain('budgetDefault')
    expect(own.button('budgetRemove')).toBeDefined()
  })

  it('after a budget stop, continues or raises the budget and continues, only on click', async () => {
    const turn = {
      turn: 3,
      end: { data: { turn: 3, reason: { kind: 'error', error: { message: 'This task stopped at its budget: ₹4.60 spent of ₹5.00, and the next step would cost about ₹0.45.', code: 'UNOBLOX_BUDGET' } } } },
      data: new Map()
    }
    const sendText = vi.fn(async () => {})
    const setBudget = vi.fn(async () => {})
    const ui = await render(React.createElement(client.RefusedTurnActions, { t, turn, sendText, setBudget }))
    expect(ui.container.querySelector('[data-unoblox-refusal]').getAttribute('data-unoblox-refusal')).toBe('budget')
    expect(sendText).not.toHaveBeenCalled()
    await ui.click(ui.button('failBudgetRaise {"amount":"₹10.00"}'))
    expect(setBudget).toHaveBeenCalledWith(10)
    expect(sendText).toHaveBeenCalledWith('failBudgetMessage')
    expect(ui.container.querySelector('[role=status]').textContent).toBe('failBudgetRaised {"amount":"₹10.00"}')
  })
})
