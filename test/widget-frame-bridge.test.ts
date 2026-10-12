import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
// @ts-expect-error -- jsdom ships no type declarations and @types/jsdom is not a dependency
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

// The frame document's bridge, run in jsdom. Sending to the chat needs a
// trusted click, which jsdom cannot make; that path is checked in Chromium
// with real input. These cover what the bridge does to the widget's own events.
function loadClient(): { buildWidgetDocument: (html: string, options: { dark: boolean; token: string; title?: string }) => string } {
  const source = readFileSync(path.join(import.meta.dirname, '..', 'packages', 'dsh-desktop-widgets', 'client.js'), 'utf8')
  let factory: ((require: (id: string) => unknown) => ReturnType<typeof loadClient>) | undefined
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (definition: { factory: typeof factory }) => { factory = definition.factory } } } })
  if (!factory) throw new Error('client did not register')
  return factory((id) => id === 'react' ? { createElement() {}, useEffect() {}, useMemo: (f: () => unknown) => f(), useRef: () => ({}), useState: (v: unknown) => [v, () => {}] } : {})
}

function open(html: string, dark = false) {
  const errors: unknown[] = []
  const dom = new JSDOM(loadClient().buildWidgetDocument(html, { dark, token: 'secret-token', title: 'Test' }), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    // Browser APIs the bridge reads that jsdom does not implement.
    beforeParse(window: Window & typeof globalThis) {
      window.addEventListener('error', (event: ErrorEvent) => errors.push(event.message))
      if (!Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'isContentEditable')) {
        Object.defineProperty(window.HTMLElement.prototype, 'isContentEditable', { get() { return false }, configurable: true })
      }
    }
  })
  return { dom, window: dom.window as unknown as Window & typeof globalThis & Record<string, unknown>, errors }
}

describe('widget bridge and the widget’s own forms', () => {
  it('lets a form the widget handles itself work as written', () => {
    const { window, errors } = open(`<form id=f><input id=task name=task value="Pay rent"><button>Add</button></form><ul id=list></ul>
      <script>window.seen = [];
      document.getElementById('f').addEventListener('submit', function (event) {
        window.seen.push(event.defaultPrevented);
        event.preventDefault();
        var li = document.createElement('li'); li.textContent = document.getElementById('task').value;
        document.getElementById('list').appendChild(li);
      });</script>`)
    const form = window.document.getElementById('f') as HTMLFormElement
    expect(window.unoblox).toBeDefined()
    form.requestSubmit()
    // The widget's handler sees the submit untouched (the bridge used to
    // cancel it first and send the form to the chat) and does its own work.
    expect(window.seen).toEqual([false])
    expect(window.document.getElementById('list')?.textContent).toBe('Pay rent')
    expect(errors).toEqual([])
  })

  it('still keeps a form the widget leaves alone from navigating the frame', () => {
    const { window } = open('<form id=f><input name=q value=x><button>Send</button></form>')
    let prevented: boolean | undefined
    window.addEventListener('submit', (event) => { prevented = event.defaultPrevented })
    ;(window.document.getElementById('f') as HTMLFormElement).requestSubmit()
    expect(prevented).toBe(true)
  })
})

describe('switching the chat theme', () => {
  it('restyles the widget in place, keeping what the user entered', () => {
    const { window, errors } = open('<input id=amount value=5000><p id=out style="color:#18191c">Result</p>')
    const input = window.document.getElementById('amount') as HTMLInputElement
    input.value = '7500'
    const seen: unknown[] = []
    window.addEventListener('message', (event) => seen.push(event.data))
    // As the chat sends it: from the parent window (in a top-level jsdom
    // window, the window is its own parent).
    const data = { __unobloxTheme: true, dark: true, page: '#1b1b1c', vars: { '--uw-fg': '#f2f2f3', '--uw-surface': '#202023', '--uw-bad name': 'x' } }
    window.dispatchEvent(new window.MessageEvent('message', { data, source: window.parent }))
    const root = window.document.documentElement.style
    expect(root.getPropertyValue('--uw-fg')).toBe('#f2f2f3')
    expect(root.getPropertyValue('color-scheme')).toBe('dark')
    // Only --uw-* variables are taken.
    expect(root.getPropertyValue('--uw-bad name')).toBe('')
    expect(input.value).toBe('7500')
    expect(errors).toEqual([])
    // The theme message carries no token for the widget's own listeners to read.
    expect(JSON.stringify(seen)).not.toContain('secret-token')
  })

  it('ignores theme messages that do not come from the chat', () => {
    const { window } = open('<p>x</p>')
    const other = new JSDOM('').window
    window.dispatchEvent(new window.MessageEvent('message', { data: { __unobloxTheme: true, dark: true, vars: { '--uw-fg': '#000000' } }, source: other as unknown as Window }))
    expect(window.document.documentElement.style.getPropertyValue('--uw-fg')).toBe('')
  })
})
