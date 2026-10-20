// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

function load(pkg) {
  let factory
  window.__ModuleLoader__ = { load: (definition) => { factory = definition.factory } }
  vm.runInThisContext(readFileSync(path.join(import.meta.dirname, '..', 'packages', pkg, 'client.js'), 'utf8'))
  return factory((id) => (id === 'react' ? React : {}))
}
const receipts = load('dsh-desktop-receipts')
const starters = load('dsh-desktop-starters')
const t = (key, values) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`)

async function render(element) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(element) })
  const click = async (el) => { await act(async () => { el.click(); await new Promise((resolve) => setTimeout(resolve, 0)) }) }
  return { container, click }
}
afterEach(() => { document.body.innerHTML = '' })

// Event shapes as the Harness writes them (dsh-agent-loop, dsh-tool-bash, dsh-tool-fs).
let seq = 0
const call = (callId, name, args) => ({ type: 'tool/call', seq: ++seq, data: { turn: 3, step: 1, callId, name, arguments: JSON.stringify(args) } })
const result = (callId, text, isError = false) => ({ type: 'tool/result', seq: ++seq, surfaceOp: 'append', data: { turn: 3, step: 1, message: { role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text }], isError } } })
const reply = (text) => ({ type: 'assistant/message', seq: ++seq, data: { turn: 3, step: 2, message: { role: 'assistant', content: [{ type: 'text', text }] } } })

/** Fold events through the definition the way the conversation engine does. */
function fold(events) {
  const d = receipts.receiptDefinition
  let state
  for (const event of events) {
    const match = d.match(event)
    if (match === null) continue
    state = match.role === 'start' ? d.start({}, { event }) : d.update({ state }, { event })
  }
  return state
}

describe('reading a turn', () => {
  it('classifies checks and reads exit status the way the bash tool writes it', () => {
    expect(['npm test', 'pnpm run test:unit', 'npx vitest run x', 'pytest -q', 'cargo test', 'go test ./...'].map(receipts.checkKind)).toEqual(Array(6).fill('test'))
    expect(receipts.checkKind('npm run typecheck')).toBe('typecheck')
    expect(receipts.checkKind('npx eslint .')).toBe('lint')
    expect(receipts.checkKind('npm run build')).toBe('build')
    expect(receipts.checkKind('ls -la')).toBeUndefined()
    expect(receipts.shellOutcome({ content: [{ type: 'text', text: 'ok' }] })).toEqual({ status: 'passed', code: 0 })
    expect(receipts.shellOutcome({ content: [{ type: 'text', text: 'boom\n[stderr]\nfail\n[exit code: 1]' }] })).toEqual({ status: 'failed', code: 1 })
    expect(receipts.shellOutcome({ content: [{ type: 'text', text: 'x\n[timed out after 120000ms]' }] })).toEqual({ status: 'timed-out' })
    expect(receipts.shellOutcome({ isError: true, content: [] })).toEqual({ status: 'not-run' })
  })

  it('finds claims in a reply, in English and Chinese', () => {
    expect(receipts.claimsIn('Fixed it. All tests pass and the build succeeds.')).toEqual(['test', 'build'])
    expect(receipts.claimsIn('修复完成，测试全部通过。')).toEqual(['test'])
    expect(receipts.claimsIn('No type errors, lint is clean.')).toEqual(['typecheck', 'lint'])
    expect(receipts.claimsIn('I updated the README.')).toEqual([])
  })

  it('verifies a claim only by a passing check after the last change', () => {
    const state = fold([
      { type: 'turn/start', seq: ++seq, data: { turn: 3 } },
      call('a', 'bash', { command: 'npm test', description: 'tests' }), result('a', 'FAIL 1\n[exit code: 1]'),
      call('b', 'edit', { file_path: 'src/app.ts', old_string: 'x', new_string: 'y' }), result('b', 'The file src/app.ts has been updated successfully.'),
      call('c', 'bash', { command: 'npm run build', description: 'build' }), result('c', 'built'),
      call('d', 'write', { file_path: 'src/new.ts', content: '' }), result('d', 'Created file'),
      call('e', 'bash', { command: 'npx eslint .', description: 'lint' }), result('e', '3 problems\n[exit code: 1]'),
      reply('Done: all tests pass, the build succeeds and lint is clean. Types check too.'),
      { type: 'turn/end', seq: ++seq, data: { turn: 3, reason: { kind: 'stop' } } }
    ])
    const receipt = receipts.buildReceipt(state)
    expect(receipt.files).toEqual(['src/app.ts', 'src/new.ts'])
    expect(receipt.commands.map((command) => [command.command, command.outcome.status])).toEqual([['npm test', 'failed'], ['npm run build', 'passed'], ['npx eslint .', 'failed']])
    expect(receipt.claims).toEqual([
      { kind: 'test', state: 'stale', command: 'npm test' },
      // The build ran after src/app.ts but before src/new.ts was written.
      { kind: 'build', state: 'stale', command: 'npm run build' },
      { kind: 'typecheck', state: 'unverified' },
      { kind: 'lint', state: 'failed', command: 'npx eslint .' }
    ])
    expect(receipts.recheckCommands(receipt)).toEqual(['npm test', 'npm run build', 'npx eslint .'])
    expect(receipts.receiptDefinition.buildLocationData({ state }, 'turn', null)).toMatchObject({ kind: 'turn', turn: 3, key: 'desktop-receipt' })
  })

  it('ignores a result rewritten later by compaction, and waits for the turn to end', () => {
    expect(receipts.receiptDefinition.match({ type: 'tool/result', surfaceOp: { op: 'replace' }, data: { turn: 3 } })).toBeNull()
    const open = fold([{ type: 'turn/start', seq: 1, data: { turn: 4 } }, call('x', 'bash', { command: 'npm test' })])
    expect(receipts.receiptDefinition.buildLocationData({ state: open }, 'turn', null)).toBeNull()
  })
})

describe('receipt card', () => {
  it('summarises, opens itself when something is off, and asks for a re-check on click', async () => {
    const state = fold([
      { type: 'turn/start', seq: ++seq, data: { turn: 3 } },
      call('b', 'edit', { file_path: 'src/app.ts' }), result('b', 'updated'),
      call('c', 'bash', { command: 'npm test' }), result('c', 'ok'),
      reply('All tests pass and the build succeeds.'),
      { type: 'turn/end', seq: ++seq, data: { turn: 3, reason: { kind: 'stop' } } }
    ])
    const sendText = vi.fn(async () => {})
    const view = await render(React.createElement(receipts.ReceiptTail, { t, turn: { data: new Map([['desktop-receipt', state]]) }, sendText }))
    const details = view.container.querySelector('[data-receipt]')
    expect(details.open).toBe(true)
    expect(details.querySelector('summary').textContent).toBe('summarycheckspassed {"count":1} · filesChanged {"count":1} · claimsUnverified {"count":1}'.replace('checks', 'checks').replace('summarycheckspassed', 'summarychecksPassed'))
    expect([...details.querySelectorAll('.dshRcptClaim')].map((li) => li.dataset.state)).toEqual(['verified', 'unverified'])
    await view.click([...details.querySelectorAll('button')].find((b) => b.textContent === 'recheck'))
    expect(sendText).toHaveBeenCalledWith('recheckMessage {"commands":"`npm test`"}')
    expect(details.querySelector('[role=status]').textContent).toBe('recheckSent')
  })

  it('shows nothing for a turn that ran nothing and claimed nothing', async () => {
    const state = fold([{ type: 'turn/start', seq: ++seq, data: { turn: 5 } }, reply('Hello!'), { type: 'turn/end', seq: ++seq, data: { turn: 5 } }])
    const view = await render(React.createElement(receipts.ReceiptTail, { t, turn: { data: new Map([['desktop-receipt', state]]) }, sendText: vi.fn() }))
    expect(view.container.innerHTML).toBe('')
  })
})

describe('starters', () => {
  it('fills the composer of a new, empty conversation and sends nothing', async () => {
    const setDraft = vi.fn()
    const focus = vi.fn()
    const view = await render(React.createElement(starters.StarterStrip, { t, session: { blank: true, running: false }, input: { draft: '' }, inputActions: { setDraft }, focus }))
    const buttons = [...view.container.querySelectorAll('button')]
    expect(buttons.map((b) => b.textContent)).toEqual(starters.STARTERS.map((id) => `title.${id}`))
    await view.click(buttons[0])
    expect(setDraft).toHaveBeenCalledWith('prompt.report')
    expect(focus).toHaveBeenCalled()
  })

  it('stays out of the way in a started conversation or once the user typed', async () => {
    for (const props of [{ session: { blank: false } }, { session: { blank: true, running: true } }, { session: { blank: true }, input: { draft: 'my own text' } }, { session: { blank: true } }]) {
      const view = await render(React.createElement(starters.StarterStrip, { t, inputActions: props === undefined ? undefined : { setDraft: vi.fn() }, ...props, ...(props.session.blank && props.input === undefined && props.session.running === undefined ? { inputActions: undefined } : {}) }))
      expect(view.container.innerHTML).toBe('')
      document.body.innerHTML = ''
    }
  })

  it('has every starter in English and Chinese', () => {
    for (const id of starters.STARTERS) {
      for (const lang of ['en', 'zh']) {
        expect(starters.locales[lang][`title.${id}`]).toBeTruthy()
        expect(starters.locales[lang][`prompt.${id}`]).toBeTruthy()
      }
    }
    expect(Object.keys(receipts.locales.en).sort()).toEqual(Object.keys(receipts.locales.zh).sort())
  })
})
