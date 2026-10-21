// @vitest-environment jsdom
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path, { join } from 'node:path'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUsageLedger, localDay } from '../packages/dsh-desktop-unoblox-info/usage.js'
import { createBudgetStore, MAX_TRACKED } from '../packages/dsh-desktop-unoblox-info/spend.js'
import { apply as applyInfo, BUDGET_CODE, BUDGET_ROUTE, DEFAULT_BUDGET, INFO_ROUTE, USAGE_ROUTE } from '../packages/dsh-desktop-unoblox-info/index.js'

const DAY = 86_400_000
// 2026-10-21 12:00 UTC; tests use offset 0 (UTC days) unless they say otherwise.
const NOON = Date.UTC(2026, 9, 21, 12)

let dir = ''
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ubx-settings-')) })
afterEach(async () => {
  document.body.innerHTML = ''
  delete window.dshDesktop
  vi.unstubAllGlobals()
  // Usage records are written in the background; let them land first.
  await new Promise((resolve) => setTimeout(resolve, 30))
  await rm(dir, { recursive: true, force: true, maxRetries: 3 })
})

describe('usage ledger', () => {
  it('uses the local calendar day', () => {
    expect(localDay(Date.UTC(2026, 9, 21, 20), 0)).toBe('2026-10-21')
    // India (UTC+5:30, offset -330): 20:00 UTC is already the next day.
    expect(localDay(Date.UTC(2026, 9, 21, 20), -330)).toBe('2026-10-22')
  })

  it('totals today, 7 and 30 days, by day, model and conversation', async () => {
    let time = NOON - 40 * DAY
    const ledger = createUsageLedger(join(dir, 'usage.jsonl'), { now: () => time })
    await ledger.record({ session: 'old', model: 'a/x', chargedInr: 9 })
    time = NOON - 10 * DAY
    await ledger.record({ session: 's1', title: 'First', model: 'a/x', chargedInr: 1, balanceInr: 900 })
    time = NOON - 2 * DAY
    await ledger.record({ session: 's2', model: 'b/y', chargedInr: 0.5, estimated: true })
    time = NOON
    await ledger.record({ session: 's1', model: 'b/y', chargedInr: 0.25, balanceInr: 898.25 })
    await ledger.record({ session: 's1', model: 'b/y', chargedInr: 0 })
    await ledger.record({ session: 's1', chargedInr: -1 })
    await ledger.record({ session: 's1', chargedInr: 'x' })

    const summary = await ledger.summary({ days: 30, offsetMinutes: 0, titles: new Map([['s2', 'Second']]) })
    expect(summary).toMatchObject({ todayInr: 0.25, weekInr: 0.75, monthInr: 1.75, estimated: true, recorded: 5, lastBalance: { inr: 898.25, at: NOON } })
    expect(summary.days).toHaveLength(30)
    expect(summary.days.at(-1)).toEqual({ day: '2026-10-21', inr: 0.25, steps: 2 })
    expect(summary.days.find((row) => row.day === '2026-10-11')).toEqual({ day: '2026-10-11', inr: 1, steps: 1 })
    expect(summary.byModel).toEqual([{ model: 'a/x', inr: 1, steps: 1 }, { model: 'b/y', inr: 0.75, steps: 3 }])
    expect(summary.byConversation.map(({ session, title, inr, steps }) => ({ session, title, inr, steps }))).toEqual([
      { session: 's1', title: 'First', inr: 1.25, steps: 3 },
      { session: 's2', title: 'Second', inr: 0.5, steps: 1 }
    ])
  })

  it('reads its file back, skips bad lines and drops records past the keep window', async () => {
    const file = join(dir, 'usage.jsonl')
    await writeFile(file, [
      JSON.stringify({ at: NOON - 500 * DAY, inr: 3 }),
      'not json',
      JSON.stringify({ at: NOON - DAY, inr: -2 }),
      JSON.stringify({ at: NOON - DAY, inr: 2, session: 's', model: 'm', balance: 10 }),
      ''
    ].join('\n'))
    const ledger = createUsageLedger(file, { now: () => NOON })
    const summary = await ledger.summary({ days: 7, offsetMinutes: 0 })
    expect(summary).toMatchObject({ recorded: 1, weekInr: 2, lastBalance: { inr: 10 } })
    await ledger.record({ session: 's', chargedInr: 1 })
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    expect(JSON.parse(lines.at(-1))).toEqual({ at: NOON, inr: 1, session: 's' })
    expect((await createUsageLedger(file, { now: () => NOON }).summary({ days: 7, offsetMinutes: 0 })).weekInr).toBe(3)
  })
})

describe('default budget store', () => {
  it('keeps the default budget however many conversations set one', async () => {
    const file = join(dir, 'budgets.json')
    const budgets = createBudgetStore(file)
    await budgets.set(DEFAULT_BUDGET, 5)
    for (let index = 0; index <= MAX_TRACKED; index++) await budgets.set(`s${String(index)}`, 1)
    expect(await createBudgetStore(file).get(DEFAULT_BUDGET)).toBe(5)
  })
})

function host({ now = () => NOON } = {}) {
  const listeners = new Map()
  const routes = new Map()
  const ctx = {
    on: (name, listener, options) => listeners.set(name, [...(options?.prepend ? [listener] : []), ...(listeners.get(name) ?? []), ...(options?.prepend ? [] : [listener])]),
    get: () => undefined,
    logger: { warn: () => {}, info: () => {} },
    connection: { fetch: { register: (route) => routes.set(route.path, route.fetch) } }
  }
  applyInfo(ctx, { root: dir }, { now, isAgentCall: (options) => options.agentLoop === true })
  const emit = (name, ...args) => listeners.get(name)?.forEach((listener) => listener(...args))
  const call = async (options) => {
    const chain = [...(listeners.get('llm/stream') ?? [])]
    const inner = () => (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })()
    const next = () => (chain.shift() ?? inner)(options, next)
    const chunks = []
    for await (const chunk of next()) chunks.push(chunk)
    return chunks
  }
  const respond = (sessionId, inr, model = 'qwen/qwen3.8-27b') => emit('llm-pi-ai/response', {
    provider: 'unoblox',
    sessionId,
    headers: {
      'x-unoblox-freemium': JSON.stringify({ balance_inr: 120, balance_requirement_inr: 1000, charged_inr: inr, tier: 'freemium', stage: 'paid' }),
      'x-unoblox-served-model': model
    }
  })
  const usage = async (query = '?days=30&offset=0') => routes.get(USAGE_ROUTE)(new Request(`http://harness.internal${USAGE_ROUTE}${query}`))
  const post = (body) => routes.get(BUDGET_ROUTE)(new Request(`http://harness.internal${BUDGET_ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  const info = async (session) => (await routes.get(INFO_ROUTE)(new Request(`http://harness.internal${INFO_ROUTE}?session=${session}`))).json()
  return { emit, call, respond, usage, post, info }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('usage route and default budget', () => {
  it('records each charged response with its model and the conversation title', async () => {
    const { emit, respond, usage } = host()
    emit('session/event', { header: { id: 's1' } }, { type: 'session/title', data: { title: 'Fix the login page' } })
    respond('s1', 0.4)
    respond('s1', 0.1, 'openai/gpt-oss-20b')
    emit('llm-pi-ai/response', { provider: 'other', sessionId: 's1', headers: {} })
    await settle()
    const response = await usage()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body).toMatchObject({ todayInr: 0.5, recorded: 2, billing: { balanceInr: 120 }, key: 'unknown' })
    expect(body.byConversation[0]).toMatchObject({ session: 's1', title: 'Fix the login page', inr: 0.5, steps: 2 })
    expect(body.byModel.map((row) => row.model)).toEqual(['qwen/qwen3.8-27b', 'openai/gpt-oss-20b'])
    // On disk, for the next launch; never the key.
    const text = await readFile(join(dir, 'usage.jsonl'), 'utf8')
    expect(text.trim().split('\n')).toHaveLength(2)
    expect(text).not.toMatch(/key|authorization/iu)
    expect((await usage('?days=0')).status).toBe(400)
    expect((await usage('?days=30&offset=abc')).status).toBe(400)
  })

  it('stops a task at the default budget when the conversation sets none, and its own budget wins', async () => {
    const { emit, call, respond, post, info } = host()
    expect((await post({ session: DEFAULT_BUDGET, budgetInr: 0.5 })).status).toBe(200)
    emit('session/event', { header: { id: 's1' } }, { type: 'turn/start', data: { turn: 1 } })
    respond('s1', 0.6)
    const stopped = await call({ sessionId: 's1', agentLoop: true })
    expect(stopped[0].reason.failure.code).toBe(BUDGET_CODE)
    expect(await info('s1')).toMatchObject({ budgetInr: 0.5, budgetIsDefault: true, defaultBudgetInr: 0.5 })

    await post({ session: 's1', budgetInr: 5 })
    expect((await call({ sessionId: 's1', agentLoop: true }))[0].reason.kind).toBe('stop')
    expect(await info('s1')).toMatchObject({ budgetInr: 5, budgetIsDefault: false })

    await post({ session: DEFAULT_BUDGET, budgetInr: null })
    expect(await info('s2')).toMatchObject({ budgetInr: null, defaultBudgetInr: null })
  })
})

// ---------- client ----------

function load() {
  let factory
  window.__ModuleLoader__ = { load: (definition) => { factory = definition.factory } }
  vm.runInThisContext(readFileSync(path.join(import.meta.dirname, '..', 'packages', 'dsh-desktop-unoblox-settings', 'client.js'), 'utf8'))
  const Button = ({ variant, ...props }) => React.createElement('button', { 'data-variant': variant, ...props })
  return factory((id) => (id === 'react' ? React : id === '@deepseek-ai/dsh-client-ui-primitives' ? { Button, IconRightUpOutlineRegular: () => null } : {}))
}
const client = load()
const t = (key, values) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`)

async function render(element) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(element); await new Promise((resolve) => setTimeout(resolve, 0)) })
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const click = async (el) => { await act(async () => { el.click(); await new Promise((resolve) => setTimeout(resolve, 0)) }) }
  return { container, flush, click }
}

const days = Array.from({ length: 30 }, (_, index) => ({ day: localDay(NOON - (29 - index) * DAY, 0), inr: index === 29 ? 0.25 : index === 19 ? 1 : 0, steps: index === 29 ? 2 : index === 19 ? 1 : 0 }))
const body = (extra = {}) => ({
  todayInr: 0.25,
  weekInr: 0.75,
  monthInr: 1.25,
  estimated: true,
  days,
  byModel: [{ model: 'a/x', inr: 1, steps: 1 }, { model: 'unknown', inr: 0.25, steps: 2 }],
  byConversation: [{ session: 'abcdef123456', inr: 1.25, steps: 3, last: NOON }],
  recorded: 3,
  lastBalance: { inr: 1500, at: NOON },
  billing: null,
  key: 'set',
  ...extra
})

function service(response, posted = []) {
  return client.createSettingsService(async (url, init) => {
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(init.body), headers: init.headers })
      return Response.json({ ok: true })
    }
    return Response.json(typeof response === 'function' ? response(url) : response)
  })
}

describe('settings sections', () => {
  it('registers Usage, Billing and unoblox account after the stock sections', () => {
    const registered = []
    const scope = {
      effect: (fn) => fn(),
      locale: { register: () => {}, bind: () => (key) => client.locales.en[key] },
      slots: { inject: (_name, fn) => fn(), register: (options, component) => registered.push({ ...options, component }) }
    }
    client.apply({ inject: (_deps, fn) => fn(scope) })
    expect(registered.map((row) => [row.name, row.id, row.order, row.label()])).toEqual([
      ['settings.section', 'unoblox-usage', 30, 'Usage'],
      ['settings.section', 'unoblox-billing', 31, 'Billing'],
      ['settings.section', 'unoblox-account', 32, 'unoblox account']
    ])
    expect(Object.keys(client.locales.zh).sort()).toEqual(Object.keys(client.locales.en).sort())
  })

  it('Usage shows totals, a bar per day with a hover readout, the breakdowns and the all-devices link', async () => {
    let asked = ''
    const { container } = await render(React.createElement(client.UsageSection, { t, service: service((url) => { asked = url; return body() }) }))
    expect(asked).toMatch(/^\/api\/desktop-unoblox\.usage\?days=30&offset=-?\d+$/u)
    const tiles = [...container.querySelectorAll('.dshUbxSetTile')].map((tile) => tile.textContent)
    expect(tiles).toEqual(['today₹0.25', 'week₹0.75', 'month₹1.25'])
    const bars = container.querySelectorAll('.dshUbxSetBar')
    expect(bars).toHaveLength(30)
    expect(bars[19].firstChild.style.height).toBe('100%')
    expect(bars[29].firstChild.style.height).toBe('25%')
    expect(bars[0].firstChild.style.height).toBe('0px')
    await act(async () => { bars[29].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
    expect(container.querySelector('.dshUbxSetReadout').textContent).toContain('"amount":"₹0.25","steps":"2"')
    expect(container.textContent).toContain('a/x')
    expect(container.textContent).toContain('unknownModel')
    expect(container.textContent).toContain('untitled {"id":"abcdef12"}')
    expect(container.textContent).toContain('estimated')
    expect([...container.querySelectorAll('a')].map((a) => a.href)).toEqual(['https://unoblox.ai/user/usage'])
    // The table view lists only the days with charges.
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
  })

  it('Usage says when nothing is recorded, and reports a failed load', async () => {
    const empty = await render(React.createElement(client.UsageSection, { t, service: service(body({ days: days.map((row) => ({ ...row, inr: 0, steps: 0 })), byModel: [], byConversation: [] })) }))
    expect(empty.container.querySelector('.dshUbxSetBars')).toBeNull()
    expect(empty.container.textContent).toContain('nothingYet')
    const failing = client.createSettingsService(async () => new Response('no', { status: 500 }))
    const failed = await render(React.createElement(client.UsageSection, { t, service: failing }))
    expect(failed.container.querySelector('[role=status]').textContent).toBe('loadFailed {"message":"HTTP 500"}')
  })

  it('Billing shows the free-tier status from the balance and links to unoblox.ai for payments', async () => {
    const above = await render(React.createElement(client.BillingSection, { t, service: service(body()) }))
    expect(above.container.querySelector('.dshUbxSetAmount').textContent).toBe('₹1,500.00')
    expect(above.container.textContent).toContain('freeOn {"amount":"₹1,000.00"}')
    expect(above.container.textContent).toContain('balanceAt')
    expect([...above.container.querySelectorAll('a')].map((a) => [a.textContent, a.href])).toEqual([
      ['topUp', 'https://unoblox.ai/user/credits'],
      ['history', 'https://unoblox.ai/user/credits'],
      ['pricing', 'https://unoblox.ai/pricing']
    ])
    const below = await render(React.createElement(client.BillingSection, { t, service: service(body({ billing: { balanceInr: 120, balanceRequirementInr: 1000 } })) }))
    expect(below.container.textContent).toContain('freeOff {"amount":"₹1,000.00"}')
    expect(below.container.textContent).not.toContain('balanceAt')
    const unknown = await render(React.createElement(client.BillingSection, { t, service: service(body({ lastBalance: null })) }))
    expect(unknown.container.textContent).toContain('balanceUnknown')
    expect(unknown.container.textContent).toContain('freeRule')
  })

  it('Billing saves and removes the default task budget', async () => {
    const posted = []
    let current = null
    const svc = service(() => body({ defaultBudgetInr: current }), posted)
    const { container, click, flush } = await render(React.createElement(client.BillingSection, { t, service: svc }))
    const input = container.querySelector('.dshUbxSetBudget input')
    const type = async (value) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await type('0')
    await click(container.querySelector('button[type=submit]'))
    expect(posted).toHaveLength(0)
    expect(container.textContent).toContain('budgetInvalid')
    await type('25.555')
    current = 25.56
    await click(container.querySelector('button[type=submit]'))
    await flush()
    expect(posted).toEqual([{ url: '/api/desktop-unoblox.budget', body: { session: '*', budgetInr: 25.56 }, headers: { 'content-type': 'application/json' } }])
    expect(container.textContent).toContain('budgetSaved')
    const remove = [...container.querySelectorAll('button')].find((button) => button.textContent === 'budgetRemove')
    current = null
    await click(remove)
    await flush()
    expect(posted.at(-1).body).toEqual({ session: '*', budgetInr: null })
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'budgetRemove')).toBe(false)
  })

  it('Account shows the key status and signs in and out through the Desktop bridge', async () => {
    let key = 'missing'
    const signIn = vi.fn(async () => { key = 'set'; return { ok: true } })
    const signOut = vi.fn(async () => { key = 'missing'; return { signedOut: true } })
    window.dshDesktop = { unobloxSignIn: signIn, unobloxSignOut: signOut }
    const { container, click, flush } = await render(React.createElement(client.AccountSection, { t, service: service(() => body({ key })) }))
    expect(container.textContent).toContain('keyMissing')
    expect(container.textContent).not.toContain('signOut')
    await click([...container.querySelectorAll('button')].find((button) => button.textContent === 'signIn'))
    await flush()
    expect(signIn).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('keySet')
    expect(container.textContent).toContain('signedIn')
    await click([...container.querySelectorAll('button')].find((button) => button.textContent === 'signOut'))
    await flush()
    expect(signOut).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('keyMissing')
    expect(container.textContent).toContain('signedOut')
    expect([...container.querySelectorAll('a')].map((a) => a.href)).toEqual([
      'https://unoblox.ai/user/keys',
      'https://unoblox.ai/user/settings',
      'https://unoblox.ai/user/activity'
    ])
  })

  it('Account reports a failed sign-in, stays quiet on cancel, and has no buttons without the bridge', async () => {
    window.dshDesktop = { unobloxSignIn: async () => ({ ok: false, code: 'timeout', message: 'took too long' }), unobloxSignOut: async () => ({ signedOut: false }) }
    const failed = await render(React.createElement(client.AccountSection, { t, service: service(body({ key: 'missing' })) }))
    await failed.click([...failed.container.querySelectorAll('button')].find((button) => button.textContent === 'signIn'))
    await failed.flush()
    expect(failed.container.textContent).toContain('signInFailed {"message":"took too long"}')

    window.dshDesktop.unobloxSignIn = async () => ({ ok: false, code: 'cancelled', message: '' })
    const cancelled = await render(React.createElement(client.AccountSection, { t, service: service(body({ key: 'missing' })) }))
    await cancelled.click([...cancelled.container.querySelectorAll('button')].find((button) => button.textContent === 'signIn'))
    await cancelled.flush()
    expect(cancelled.container.textContent).not.toContain('signInFailed')

    delete window.dshDesktop
    const web = await render(React.createElement(client.AccountSection, { t, service: service(body()) }))
    expect(web.container.querySelectorAll('button')).toHaveLength(0)
    expect(web.container.textContent).toContain('noBridge')
  })
})
