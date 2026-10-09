import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { apply as applyHost, CHART_LIBRARY_ROUTE, MAX_WIDGET_HTML, TOOL_DESCRIPTION, TOOL_NAME } from '../packages/dsh-desktop-widgets/index.js'

const projectRoot = path.resolve(import.meta.dirname, '..')

type Widget = { title: string; html: string; height: number }
type Definition = {
  kind: string
  match: (event: unknown) => { id: string; role: string } | null
  start: (context: unknown, match: { event: unknown }) => State
  update: (context: { state: State }, match: { event: unknown }) => State
  buildLocationData: (context: { state: State | undefined }, scope: string, previous?: unknown) => unknown
}
type State = { turn: number; widgets: Array<{ callId: string; seq: number; argsRaw: string }> }
type Client = {
  parseWidgetArgs: (raw: unknown) => Widget | undefined
  buildWidgetDocument: (html: string, options: { dark: boolean; token: string; library?: string }) => string
  formatSubmission: (title: string, data: unknown) => string
  inlineScript: (source: string) => string
  usesCharts: (html: string) => boolean
  clampHeight: (value: number) => number
  widgetsDefinition: Definition
  inject: string[]
  apply: (ctx: unknown) => void
}

function loadClient(): Client {
  const source = readFileSync(path.join(projectRoot, 'packages', 'dsh-desktop-widgets', 'client.js'), 'utf8')
  let factory: ((require: (id: string) => unknown) => Client) | undefined
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (definition: { factory: typeof factory }) => { factory = definition.factory } } }
  })
  const react = { createElement: () => null, useEffect: () => {}, useMemo: (fn: () => unknown) => fn(), useRef: () => ({}), useState: (v: unknown) => [v, () => {}], Fragment: 'f' }
  return factory!((id) => id === 'react' ? react : {})
}

const client = loadClient()
const args = (value: Record<string, unknown>) => JSON.stringify(value)

describe('widget arguments', () => {
  it('reads complete arguments and waits while they stream', () => {
    expect(client.parseWidgetArgs(args({ title: ' Loan ', html: '<p>x</p>', height: 5000 }))).toEqual({ title: 'Loan', html: '<p>x</p>', height: 1200 })
    expect(client.parseWidgetArgs(args({ title: 'Loan', html: '<p>x</p>' }))?.height).toBe(240)
    expect(client.parseWidgetArgs('{"title":"Loan","html":"<p>')).toBeUndefined()
    expect(client.parseWidgetArgs(args({ title: '', html: '<p>x</p>' }))).toBeUndefined()
    expect(client.parseWidgetArgs(args({ title: 'x', html: '   ' }))).toBeUndefined()
    expect(client.parseWidgetArgs(undefined)).toBeUndefined()
    expect(client.clampHeight(10)).toBe(80)
  })
})

describe('widget sandbox document', () => {
  const doc = client.buildWidgetDocument('<form><input name="a"></form>', { dark: true, token: 'tok123' })

  it('carries a CSP that allows inline code but no network, frames or navigation', () => {
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/u.exec(doc)?.[1] ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain("script-src 'unsafe-inline'")
    expect(csp).not.toMatch(/https?:|\*/u)
    // The policy comes before any script so it governs all of them.
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<script>'))
  })

  it('sets the theme, the bridge token, then the agent HTML', () => {
    expect(doc).toContain('color-scheme:dark')
    expect(doc).toContain('--uw-accent:#D9A64A')
    expect(doc).toContain('"tok123"')
    expect(doc.endsWith('<form><input name="a"></form></body></html>')).toBe(true)
    expect(client.buildWidgetDocument('<p/>', { dark: false, token: 't' })).toContain('color-scheme:light')
  })

  it('inlines the chart library only when given, without letting it close its script tag', () => {
    expect(doc).not.toContain('echarts')
    const withLibrary = client.buildWidgetDocument('<div></div>', { dark: false, token: 't', library: 'var s="</script><img src=x>";<!--' })
    expect(withLibrary).toContain('var s="<\\/script><img src=x>";<\\!--')
    expect(client.inlineScript('a</SCRIPT>b')).toBe('a<\\/SCRIPT>b')
    expect(client.usesCharts('echarts.init(el)')).toBe(true)
    expect(client.usesCharts('<p>charts</p>')).toBe(false)
  })
})

describe('widget submissions', () => {
  it('reads as a short message from the user', () => {
    expect(client.formatSubmission('Loan', { amount: '500000', tags: ['a', 'b'], nested: { x: 1 } }))
      .toBe('Submitted from the "Loan" widget:\n- amount: 500000\n- tags: a, b\n- nested: {"x":1}')
    expect(client.formatSubmission('Loan', {})).toBe('Submitted from the "Loan" widget:\n(no fields)')
    expect(client.formatSubmission('Loan', 'yes')).toBe('Submitted from the "Loan" widget:\nyes')
    expect(client.formatSubmission('Loan', { big: 'x'.repeat(5000) }).length).toBeLessThan(2100)
  })
})

describe('the turn\'s widgets', () => {
  const definition = client.widgetsDefinition
  const call = (callId: string, seq: number, title = 'Loan') => ({ type: 'tool/call', seq, data: { turn: 3, callId, name: 'show_widget', arguments: args({ title, html: '<p>x</p>' }) } })

  it('follows show_widget calls only', () => {
    expect(definition.match({ type: 'turn/start', data: { turn: 3 } })).toEqual({ id: '3', role: 'start' })
    expect(definition.match(call('a', 1))).toEqual({ id: '3', role: 'update' })
    expect(definition.match({ type: 'tool/call', data: { turn: 3, name: 'bash' } })).toBeNull()
  })

  it('keeps one entry per call, drops failed calls, and publishes turn data', () => {
    let state = definition.start({}, { event: { type: 'turn/start', data: { turn: 3 } } })
    state = definition.update({ state }, { event: call('a', 1) })
    state = definition.update({ state }, { event: call('a', 2, 'Loan v2') })
    state = definition.update({ state }, { event: call('b', 3) })
    expect(state.widgets.map((widget) => [widget.callId, widget.seq])).toEqual([['a', 2], ['b', 3]])
    state = definition.update({ state }, { event: { type: 'tool/result', seq: 4, data: { turn: 3, message: { isError: true, source: { callId: 'b' } } } } })
    expect(state.widgets.map((widget) => widget.callId)).toEqual(['a'])
    const same = definition.update({ state }, { event: { type: 'tool/result', seq: 5, data: { turn: 3, message: { isError: false, source: { callId: 'a' } } } } })
    expect(same).toBe(state)
    const data = definition.buildLocationData({ state }, 'turn') as { key: string; value: { widgets: unknown[] } }
    expect(data).toMatchObject({ kind: 'turn', turn: 3, key: 'unoblox-widgets' })
    expect(definition.buildLocationData({ state }, 'turn', data)).toBe(data)
    expect(definition.buildLocationData({ state: { turn: 3, widgets: [] } }, 'turn')).toBeNull()
  })
})

describe('widgets host plugin', () => {
  function host() {
    const tools: Array<{ name: string; description: string; execute: (args: unknown, exec: unknown) => Promise<unknown>; output: { render: (args: unknown, value: unknown) => Array<{ text: string }> } }> = []
    const routes: Array<{ path: string; fetch: (request: Request) => Promise<Response> }> = []
    applyHost({
      tools: { register: (tool: (typeof tools)[number]) => tools.push(tool) },
      connection: { fetch: { register: (route: (typeof routes)[number]) => routes.push(route) } },
      logger: { warn: vi.fn() }
    })
    return { tool: tools[0]!, route: routes[0]! }
  }

  it('registers show_widget and checks what the agent sends', async () => {
    const { tool } = host()
    expect(tool.name).toBe(TOOL_NAME)
    expect(TOOL_DESCRIPTION).toContain('no network')
    expect(TOOL_DESCRIPTION).toContain('--uw-accent')
    await expect(tool.execute({ title: 'Loan', html: '<p>x</p>' }, {})).resolves.toEqual({ shown: true })
    await expect(tool.execute({ title: 'Loan', html: 'x'.repeat(MAX_WIDGET_HTML + 1) }, {})).rejects.toThrow()
    await expect(tool.execute({ title: 'Loan', html: '<p>x</p>', height: 5 }, {})).rejects.toThrow()
    await expect(tool.execute({ title: ' ', html: '<p>x</p>' }, {})).rejects.toThrow()
    expect(tool.output.render({ title: 'Loan' }, { shown: true })[0]!.text).toContain('"Loan" is shown to the user')
  })

  it('serves the bundled chart library from its own route', async () => {
    const { route } = host()
    expect(route.path).toBe(CHART_LIBRARY_ROUTE)
    const response = await route.fetch(new Request(`http://127.0.0.1${CHART_LIBRARY_ROUTE}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('javascript')
    expect(await response.text()).toContain('echarts')
  })
})

describe('widgets packaging', () => {
  it('is declared, locked, in the Harness closure and loaded only outside Safe Mode', async () => {
    const [manifest, lock, dshPatch, normal, safe] = await Promise.all([
      readFile(path.join(projectRoot, 'package.json'), 'utf8'),
      readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'),
      readFile(path.join(projectRoot, 'patches', '@deepseek-ai+dsh+0.2.0-rc.2.patch'), 'utf8'),
      readFile(path.join(projectRoot, 'build', 'dsh-desktop.patch.yml'), 'utf8'),
      readFile(path.join(projectRoot, 'build', 'dsh-desktop-safe.patch.yml'), 'utf8')
    ])
    const dependencies = (JSON.parse(manifest) as { dependencies: Record<string, string> }).dependencies
    expect(dependencies['dsh-desktop-widgets']).toBe('file:packages/dsh-desktop-widgets')
    expect(dependencies.echarts).toBe('6.1.0')
    const packages = (JSON.parse(lock) as { packages: Record<string, unknown> }).packages
    expect(packages['node_modules/dsh-desktop-widgets']).toEqual({ resolved: 'packages/dsh-desktop-widgets', link: true })
    expect(dshPatch).toContain('+    "dsh-desktop-widgets": "0.1.0"')
    expect(normal).toMatch(/- id: dsh-desktop-widgets\n\s+name: dsh-desktop-widgets/u)
    expect(safe).not.toContain('dsh-desktop-widgets')
    expect(client.inject).toContain('uiConversation')
  })
})
