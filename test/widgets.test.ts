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
  neutraliseShadowRoots: (html: string) => string
  uniqueWidgets: (entries: Array<{ callId: string; widget: Widget }>) => Array<{ callId: string; widget: Widget }>
  chartTheme: (theme: Record<string, string>, dark: boolean) => string
  isWebLink: (value: string) => boolean
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
    window: { __ModuleLoader__: { load: (definition: { factory: typeof factory }) => { factory = definition.factory } } },
    URL
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

describe('what a widget cannot reach', () => {
  it('turns off declarative shadow roots in the agent markup', () => {
    expect(client.neutraliseShadowRoots('<template shadowrootmode="closed"><b></b></template>')).toBe('<template data-shadowrootmode="closed"><b></b></template>')
    expect(client.neutraliseShadowRoots('<template SHADOWROOTMODE = open>')).toBe('<template data-shadowrootMODE = open>')
    expect(client.neutraliseShadowRoots('<p>shadowrootmode is a word</p>')).toBe('<p>shadowrootmode is a word</p>')
    expect(client.buildWidgetDocument('<template shadowrootmode="open"></template>', { dark: false, token: 't' })).not.toMatch(/<template shadowrootmode/u)
  })

  it('builds bootstrap code that parses', () => {
    const doc = client.buildWidgetDocument('<p>x</p>', { dark: false, token: 't' })
    const scripts = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/gu)].map((match) => match[1] ?? '')
    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) expect(() => new vm.Script(script)).not.toThrow()
  })

  it('parses with the chart library and its theme', () => {
    const doc = client.buildWidgetDocument('<div>echarts</div>', { dark: true, token: 't', library: 'window.echarts = {}' })
    const scripts = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/gu)].map((match) => match[1] ?? '')
    expect(scripts).toHaveLength(3)
    for (const script of scripts) expect(() => new vm.Script(script)).not.toThrow()
  })

  it('resolves theme variables in chart options, which a canvas cannot read', () => {
    let registered: unknown
    let applied: unknown
    const echarts = {
      registerTheme: (_name: string, theme: unknown) => { registered = theme },
      init: (_el: unknown, name: unknown) => ({ name, setOption: (option: unknown) => { applied = option } })
    }
    vm.runInNewContext(client.chartTheme({ fg: '#f2f2f3', muted: '#aaa', surface: '#222', border: '#333', accent: '#D9A64A', onAccent: '#18191c' }, true), { window: { echarts } })
    const chart = (echarts.init as unknown as (el: unknown) => { name: string; setOption: (option: unknown) => void })({})
    expect(chart.name).toBe('unoblox')
    chart.setOption({ legend: { textStyle: { color: 'var(--uw-fg)' } }, series: [{ color: ' var(--uw-accent) ' }] })
    expect(applied).toEqual({ legend: { textStyle: { color: '#f2f2f3' } }, series: [{ color: '#D9A64A' }] })
    expect(registered).toMatchObject({ legend: { textStyle: { color: '#f2f2f3' } } })
  })

  it('opens only plain web links', () => {
    expect(client.isWebLink('https://example.com/a')).toBe(true)
    expect(client.isWebLink('javascript:alert(1)')).toBe(false)
    expect(client.isWebLink('https://user:pw@example.com/')).toBe(false)
    expect(client.isWebLink('file:///etc/passwd')).toBe(false)
  })

  it('runs its guards before any widget code', () => {
    const doc = client.buildWidgetDocument('<script>widget()</script>', { dark: false, token: 't' })
    const bootstrap = doc.indexOf('RTCPeerConnection')
    expect(bootstrap).toBeGreaterThan(-1)
    expect(doc.indexOf('new MutationObserver')).toBeGreaterThan(-1)
    expect(bootstrap).toBeLessThan(doc.indexOf('widget()'))
  })
})

describe('repeated widgets', () => {
  it('shows a widget the model repeated once, at its latest call', () => {
    const w = (title: string, html = '<p>x</p>') => ({ title, html, height: 240 })
    const shown = client.uniqueWidgets([{ callId: 'a', widget: w('Loan') }, { callId: 'b', widget: w('Chart') }, { callId: 'c', widget: w('Loan') }, { callId: 'd', widget: w('Loan', '<p>y</p>') }])
    expect(shown.map((entry) => entry.callId)).toEqual(['b', 'c', 'd'])
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
    expect(tool.output.render({ title: 'Loan' }, { shown: true })[0]!.text).toContain('"Loan" is now shown to the user')
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
    expect(normal).toMatch(/- id: dsh-desktop-widgets\r?\n\s+name: dsh-desktop-widgets/u)
    expect(safe).not.toContain('dsh-desktop-widgets')
    expect(client.inject).toContain('uiConversation')
  })
})
