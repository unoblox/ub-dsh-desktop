// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

function load() {
  let factory
  window.__ModuleLoader__ = { load: (definition) => { factory = definition.factory } }
  vm.runInThisContext(readFileSync(path.join(import.meta.dirname, '..', 'packages', 'dsh-desktop-specs', 'client.js'), 'utf8'))
  const primitives = new Proxy({
    Button: ({ variant, size, ...props }) => React.createElement('button', { type: 'button', ...props }),
    Modal: ({ open, title, children }) => (open ? React.createElement('div', { role: 'dialog', 'aria-label': title }, children) : null)
  }, { get: (target, name) => target[name] ?? (() => null) })
  return factory((id) => (id === 'react' ? React : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : {}))
}
const client = load()
const t = (key, values) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`)

async function render(element) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(element); await new Promise((resolve) => setTimeout(resolve, 0)) })
  const click = async (el) => { await act(async () => { el.click(); await new Promise((resolve) => setTimeout(resolve, 0)) }) }
  const button = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)
  return { container, click, button }
}
afterEach(() => { document.body.innerHTML = '' })

const active = (extra = {}) => ({
  slug: 'greeter',
  title: 'Greeter',
  phase: 'requirements',
  awaiting: { doc: 'requirements', current: true },
  approvals: { requirements: null, design: null, tasks: null },
  docs: {
    requirements: { file: 'specs/greeter/requirements.md', text: '# Greeter\n\n### REQ-1: Greet\n\n- AC-1.1: WHEN x THE SYSTEM SHALL y <img src=x onerror=alert(1)>\n', sha256: 'abc', issues: [] },
    design: { file: 'specs/greeter/design.md', text: '', sha256: 'e3b0', issues: [{ level: 'error', text: 'The design is empty.' }] },
    tasks: { file: 'specs/greeter/tasks.md', text: '- [x] T-1: Greet (REQ-1)\n- [ ] T-2: Shout\n', sha256: 't1', issues: [] }
  },
  trace: {
    requirements: [{ id: 'REQ-1', title: 'Greet', criteria: 1 }],
    tasks: [{ id: 'T-1', title: 'Greet', done: true, refs: ['REQ-1'], files: [] }, { id: 'T-2', title: 'Shout', done: false, refs: [], files: [] }],
    criteria: [{ id: 'AC-1.1', requirement: 'REQ-1', text: 'WHEN x THE SYSTEM SHALL y', status: 'failing', tests: [{ file: 'test/a.test.js', line: 3 }], tasks: ['T-1'] }],
    counts: { total: 1, passing: 0, failing: 1, stale: 0, untested: 0, 'not-run': 0 },
    drift: [{ kind: 'failing', ids: ['T-1', 'AC-1.1'], text: 'T-1 is ticked done, but the last test run failed for AC-1.1.', fix: '' }],
    run: { at: 1, command: 'npm test', ok: false, failingIds: ['AC-1.1'] }
  },
  changes: [],
  ...extra
})

function service(views, calls = []) {
  let index = 0
  return {
    calls,
    load: vi.fn(async () => views[Math.min(index, views.length - 1)]),
    approve: vi.fn(async (...args) => { calls.push(['approve', ...args]); index++; return { ok: true } }),
    reopen: vi.fn(async (...args) => { calls.push(['reopen', ...args]); index++; return { ok: true } }),
    activate: vi.fn(async (...args) => { calls.push(['activate', ...args]); index++; return { ok: true } })
  }
}

describe('spec pill', () => {
  it('asks for review while a document waits, and shows progress and drift while building', async () => {
    const waiting = await render(React.createElement(client.SpecPill, { t, view: { active: active(), specs: [] }, onOpen: () => {} }))
    const pill = waiting.container.querySelector('[data-spec]')
    expect(pill.getAttribute('data-attention')).toBe('true')
    expect(pill.textContent).toContain('reviewShort')
    const building = await render(React.createElement(client.SpecPill, { t, view: { active: active({ phase: 'build', awaiting: null }), specs: [] }, onOpen: () => {} }))
    expect(building.container.textContent).toContain('tasksDone {"done":1,"total":2}')
    expect(building.container.textContent).toContain('drift {"count":1}')
    const none = await render(React.createElement(client.SpecPill, { t, view: { active: null, specs: [] }, onOpen: () => {} }))
    expect(none.container.innerHTML).toBe('')
    const pick = await render(React.createElement(client.SpecPill, { t, view: { active: null, specs: [{ slug: 'a', title: 'A', phase: 'build' }] }, onOpen: () => {} }))
    expect(pick.container.textContent).toContain('pillSpecs {"count":1}')
  })
})

describe('review banner', () => {
  it('approves the exact text shown and tells the agent to continue', async () => {
    const svc = service([{ active: active(), specs: [] }, { active: active({ awaiting: null, phase: 'design' }), specs: [] }])
    const sendText = vi.fn(async () => {})
    const ui = await render(React.createElement(client.SpecReview, { t, service: svc, sendText, session: { sessionId: 's1', running: false }, inputActions: { setDraft: vi.fn() } }))
    expect(ui.container.textContent).toContain('bannerTitle {"file":"requirements.md"}')
    expect(ui.container.textContent).toContain('bannerSummary.requirements {"requirements":1,"criteria":1}')
    await ui.click(ui.button('approve'))
    expect(svc.calls[0]).toEqual(['approve', 's1', 'requirements', 'abc'])
    expect(sendText).toHaveBeenCalledWith('approvedMessage {"file":"requirements.md"}')
    expect(ui.container.querySelector('[data-spec-review]')).toBeNull()
  })

  it('reopens the document and fills the composer when the user asks for changes', async () => {
    const svc = service([{ active: active(), specs: [] }])
    const setDraft = vi.fn()
    const ui = await render(React.createElement(client.SpecReview, { t, service: svc, sendText: vi.fn(), session: { sessionId: 's1', running: false }, inputActions: { setDraft } }))
    await ui.click(ui.button('askChanges'))
    expect(svc.calls[0]).toEqual(['reopen', 's1', 'requirements'])
    expect(setDraft).toHaveBeenCalledWith('changesDraft {"file":"requirements.md"}')
  })

  it('will not approve a document that changed after it was submitted, or one with errors', async () => {
    const stale = await render(React.createElement(client.SpecReview, { t, service: service([{ active: active({ awaiting: { doc: 'requirements', current: false } }), specs: [] }]), sendText: vi.fn(), session: { sessionId: 's1' } }))
    expect(stale.button('approve').disabled).toBe(true)
    expect(stale.container.textContent).toContain('bannerStale')
    const broken = await render(React.createElement(client.SpecReview, { t, service: service([{ active: active({ awaiting: { doc: 'design', current: true } }), specs: [] }]), sendText: vi.fn(), session: { sessionId: 's1' } }))
    expect(broken.button('approve').disabled).toBe(true)
  })
})

describe('spec panel', () => {
  it('shows the documents as text only, the trace with statuses, and drift', async () => {
    const view = { active: active({ phase: 'build', awaiting: null, approvals: { requirements: { at: 1, changedAt: 2 }, design: { at: 1, changedAt: null }, tasks: { at: 1, changedAt: null } }, changes: [{ at: 2, doc: 'requirements', by: 'agent', summary: 'added REQ-2.' }] }), specs: [] }
    const ui = await render(React.createElement(client.SpecPanel, { t, view, sessionId: 's1', service: service([view]), sendText: vi.fn(), onClose: () => {}, onChanged: () => {} }))
    // Opens on the trace while building.
    expect(ui.container.querySelector('[data-criterion="AC-1.1"]').textContent).toContain('status.failing')
    expect(ui.container.querySelector('[data-drift]').textContent).toContain('T-1 is ticked done')
    await ui.click([...ui.container.querySelectorAll('[role=tab]')].find((b) => b.textContent.includes('step.requirements')))
    expect(ui.container.querySelector('img')).toBeNull()
    expect(ui.container.textContent).toContain('<img src=x onerror=alert(1)>')
    expect([...ui.container.querySelectorAll('.dshSpecId')].map((el) => el.textContent)).toEqual(expect.arrayContaining(['REQ-1', 'AC-1.1']))
    expect(ui.container.textContent).toContain('approvedChanged {"by":"by.agent"}')
    await ui.click([...ui.container.querySelectorAll('[role=tab]')].find((b) => b.textContent.includes('tab.changes')))
    expect(ui.container.textContent).toContain('added')
  })

  it('lets the user pick a spec of the project for this conversation', async () => {
    const svc = service([{ active: null, specs: [{ slug: 'greeter', title: 'Greeter', phase: 'tasks' }] }])
    const onChanged = vi.fn()
    const ui = await render(React.createElement(client.SpecPanel, { t, view: { active: null, specs: [{ slug: 'greeter', title: 'Greeter', phase: 'tasks' }] }, sessionId: 's1', service: svc, onClose: () => {}, onChanged }))
    await ui.click(ui.button('use'))
    expect(svc.calls[0]).toEqual(['activate', 's1', 'greeter'])
    expect(onChanged).toHaveBeenCalled()
  })

  it('has every string in both languages', () => {
    expect(Object.keys(client.locales.zh).sort()).toEqual(Object.keys(client.locales.en).sort())
  })
})

describe('review fixes (client)', () => {
  it('says when the approval worked but the agent could not be told', async () => {
    const svc = service([{ active: active(), specs: [] }, { active: active({ awaiting: null }), specs: [] }])
    const sendText = vi.fn(async () => { throw new Error('the conversation is not available') })
    const view = { active: active(), specs: [] }
    const ui = await render(React.createElement(client.SpecPanel, { t, view, sessionId: 's1', service: svc, sendText, onClose: () => {}, onChanged: () => {} }))
    await ui.click(ui.button('approve'))
    expect(svc.calls[0][0]).toBe('approve')
    expect(ui.container.textContent).toContain('approvedNotSent')
    expect(ui.container.textContent).not.toContain('approveFailed')
  })

  it('keeps the panel\'s Approve off while the document differs from what was submitted', async () => {
    const view = { active: active({ awaiting: { doc: 'requirements', current: false } }), specs: [] }
    const ui = await render(React.createElement(client.SpecPanel, { t, view, sessionId: 's1', service: service([view]), sendText: vi.fn(), onClose: () => {}, onChanged: () => {} }))
    expect(ui.button('approve').disabled).toBe(true)
  })

  it('opens the picked spec on its own first tab', async () => {
    const svc = service([])
    const picked = active({ phase: 'build', awaiting: null })
    const Host = () => {
      const [view, setView] = React.useState({ active: null, specs: [{ slug: 'greeter', title: 'Greeter', phase: 'build' }] })
      return React.createElement(client.SpecPanel, { t, view, sessionId: 's1', service: svc, onClose: () => {}, onChanged: () => setView({ active: picked, specs: [] }) })
    }
    const ui = await render(React.createElement(Host))
    await ui.click(ui.button('use'))
    expect(ui.container.querySelector('[data-criterion="AC-1.1"]')).not.toBeNull()
  })

  it('shares one request between the pill and the banner', async () => {
    let calls = 0
    const svc = client.createSpecService(async () => { calls++; return Response.json({ active: null, specs: [] }) })
    await Promise.all([svc.load('s1'), svc.load('s1')])
    expect(calls).toBe(1)
    await svc.load('s1', { fresh: true })
    expect(calls).toBe(2)
  })
})

describe('end of a turn', () => {
  it('shows a document the agent submitted just before its turn ended', async () => {
    let submitted = false
    const svc = client.createSpecService(async () => Response.json({ active: submitted ? active() : active({ awaiting: null }), specs: [] }))
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const props = (running) => ({ t, service: svc, sendText: vi.fn(), session: { sessionId: 's1', running }, inputActions: { setDraft: vi.fn() } })
    await act(async () => { root.render(React.createElement(client.SpecReview, props(true))); await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(container.querySelector('[data-spec-review]')).toBeNull()
    // Submitted within the sharing window, then the turn ends.
    submitted = true
    await act(async () => { root.render(React.createElement(client.SpecReview, props(false))); await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(container.querySelector('[data-spec-review="requirements"]')).not.toBeNull()
  })
})
