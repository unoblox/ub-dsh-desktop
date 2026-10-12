import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

// The chart setup each widget frame runs after ECharts, against a stand-in
// ECharts that records what the setup asks of it.
type Option = Record<string, unknown>
type Chart = { name: string; opts: Option; applied: Option[]; theme?: string; setOption: (option: Option) => void; setTheme: (name: string) => void; isDisposed: () => boolean; resize: () => void }

function loadClient(): { chartTheme: (dark: boolean) => string } {
  const source = readFileSync(path.join(import.meta.dirname, '..', 'packages', 'dsh-desktop-widgets', 'client.js'), 'utf8')
  let factory: ((require: (id: string) => unknown) => { chartTheme: (dark: boolean) => string }) | undefined
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (definition: { factory: typeof factory }) => { factory = definition.factory } } } })
  if (!factory) throw new Error('client did not register')
  return factory((id) => id === 'react' ? { createElement() {}, useEffect() {}, useMemo: (f: () => unknown) => f(), useRef: () => ({}), useState: (v: unknown) => [v, () => {}] } : {})
}

function frame(dark: boolean) {
  const themes = new Map<string, Option>()
  const charts: Chart[] = []
  const listeners: Array<(event: { detail: { dark: boolean } }) => void> = []
  const echarts = {
    registerTheme: (name: string, config: Option) => { themes.set(name, config) },
    getInstanceByDom: () => undefined,
    init: (_el: unknown, name: string, opts: Option) => {
      const chart: Chart = {
        name, opts, applied: [],
        setOption(option) { this.applied.push(option) },
        setTheme(theme) { this.theme = theme },
        isDisposed: () => false,
        resize: () => {}
      }
      charts.push(chart)
      return chart
    }
  }
  const window = { echarts, addEventListener: (type: string, listener: (event: { detail: { dark: boolean } }) => void) => { if (type === 'unoblox:theme') listeners.push(listener) } }
  vm.runInNewContext(loadClient().chartTheme(dark), { window })
  const init = (opts?: Option) => (echarts.init as unknown as (el: unknown, name?: string, opts?: Option) => Chart)({}, undefined, opts)
  return { themes, charts, init, switchTo: (next: boolean) => listeners.forEach((listener) => listener({ detail: { dark: next } })) }
}

describe('widget charts', () => {
  it('register a light and a dark theme and start in the chat’s mode', () => {
    const light = frame(false)
    expect([...light.themes.keys()]).toEqual(['unoblox-light', 'unoblox-dark'])
    expect(light.init().name).toBe('unoblox-light')
    expect(frame(true).init().name).toBe('unoblox-dark')
  })

  it('draw as SVG, which stays sharp when the app is zoomed, unless the widget asks for a canvas', () => {
    const { init } = frame(false)
    expect(init().opts).toEqual({ renderer: 'svg' })
    expect(init({ renderer: 'canvas', width: 300 }).opts).toEqual({ renderer: 'canvas', width: 300 })
  })

  it('use thin marks, recessive axes and solid hairline gridlines', () => {
    const config = frame(false).themes.get('unoblox-light') as Record<string, Record<string, unknown>>
    expect(config.line).toMatchObject({ symbolSize: 8, lineStyle: { width: 2 }, itemStyle: { borderColor: '#ffffff', borderWidth: 2 } })
    expect(config.bar).toMatchObject({ itemStyle: { borderRadius: [4, 4, 0, 0] } })
    expect(config.valueAxis).toMatchObject({ axisLine: { show: false }, splitLine: { lineStyle: { type: 'solid', width: 1 } } })
    expect((config.textStyle as { fontSize: number }).fontSize).toBeGreaterThanOrEqual(12)
  })

  it('resolve theme variables, which a chart cannot read from CSS', () => {
    const chart = frame(true).init()
    chart.setOption({ legend: { textStyle: { color: 'var(--uw-fg)' } }, series: [{ type: 'pie', color: ' var(--uw-accent) ' }] })
    expect(chart.applied[0]).toMatchObject({ legend: { textStyle: { color: '#f2f2f3' } }, series: [{ color: '#D9A64A' }] })
  })

  it('add a tooltip to a chart that has none, once', () => {
    const chart = frame(false).init()
    chart.setOption({ xAxis: {}, yAxis: {}, series: [{ type: 'line', data: [1, 2] }] })
    chart.setOption({ series: [{ data: [3, 4] }] })
    expect(chart.applied[0]?.tooltip).toEqual({ trigger: 'axis', axisPointer: { type: 'line' } })
    expect(chart.applied[1]?.tooltip).toBeUndefined()
    const pie = frame(false).init()
    pie.setOption({ series: [{ type: 'pie', data: [] }] })
    expect(pie.applied[0]?.tooltip).toEqual({ trigger: 'item' })
    const own = frame(false).init()
    own.setOption({ tooltip: { show: false }, series: [{ type: 'pie' }] })
    expect(own.applied[0]?.tooltip).toEqual({ show: false })
  })

  it('round only the top of a stack and separate its segments', () => {
    const chart = frame(false).init()
    chart.setOption({ series: [{ type: 'bar', stack: 'a' }, { type: 'bar', stack: 'a' }, { type: 'bar', stack: 'a', itemStyle: { borderRadius: 2 } }, { type: 'bar' }] })
    const series = chart.applied[0]?.series as Array<{ itemStyle?: Record<string, unknown> }>
    expect(series[0]?.itemStyle).toEqual({ borderRadius: 0, borderWidth: 1, borderColor: '#ffffff' })
    expect(series[1]?.itemStyle).toEqual({ borderRadius: 0, borderWidth: 1, borderColor: '#ffffff' })
    // The widget's own styling wins.
    expect(series[2]?.itemStyle).toEqual({ borderRadius: 2, borderWidth: 1, borderColor: '#ffffff' })
    expect(series[3]?.itemStyle).toBeUndefined()
  })

  it('give a line coloured through lineStyle the same colour for its legend key', () => {
    const chart = frame(false).init()
    chart.setOption({ series: [{ type: 'line', lineStyle: { color: '#6366f1' } }, { type: 'line', color: '#111', lineStyle: { color: '#222' } }] })
    const series = chart.applied[0]?.series as Array<{ color?: string }>
    expect(series[0]?.color).toBe('#6366f1')
    expect(series[1]?.color).toBe('#111')
  })

  it('switch theme in place and re-apply the options with the new mode’s colours', () => {
    const page = frame(false)
    const chart = page.init()
    chart.setOption({ series: [{ type: 'bar', stack: 's', color: 'var(--uw-fg)' }] })
    page.switchTo(true)
    expect(chart.theme).toBe('unoblox-dark')
    expect(chart.applied.at(-1)).toMatchObject({ series: [{ color: '#f2f2f3', itemStyle: { borderColor: '#1b1b1c' } }] })
  })
})
