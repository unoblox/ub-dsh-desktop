import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

interface Registration {
  config: { name: string; id?: string; order?: number }
  component: (props: Record<string, unknown>) => unknown
}

describe('DSH Desktop client slot occupants', () => {
  it('registers one occupant per brand seat and keeps the official name mark-free', async () => {
    const source = await readFile(
      path.join(projectRoot, 'packages', 'dsh-desktop-client-ui', 'client.js'),
      'utf8'
    )
    let definition: {
      factory: (require: (id: string) => unknown) => {
        apply: (ctx: unknown) => void
        inject: string[]
      }
    } | undefined
    const appended: Array<{ textContent?: string }> = []
    const removeStyle = vi.fn()
    let disposeStyle: (() => void) | undefined
    const document = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => ({ id: '', dataset: {}, textContent: '', remove: removeStyle })),
      head: { appendChild: (node: { textContent?: string }) => appended.push(node) }
    }
    vm.runInNewContext(source, {
      document,
      navigator: { language: 'en-US' },
      window: {
        __ModuleLoader__: {
          load: (value: typeof definition) => {
            definition = value
          }
        }
      }
    })

    expect(definition).toBeDefined()
    const createElement = (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): { type: unknown; props: Record<string, unknown> } => ({
      type,
      props: { ...props, children }
    })
    const plugin = definition!.factory((id) => {
      if (id === 'react') {
        return {
          createElement,
          useEffect: (effect: () => void | (() => void)) => effect(),
          useState: (initial: unknown) => [initial, vi.fn()]
        }
      }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') {
        return { MenuItemButton: vi.fn() }
      }
      throw new Error(`Unexpected client dependency: ${id}`)
    })

    const registrations: Registration[] = []
    const slots = {
      inject: (_name: string, callback: () => unknown): unknown => {
        const result = callback()
        if (result && typeof result === 'object' && Symbol.iterator in result) {
          for (const _entry of result as Iterable<unknown>) void _entry
        }
        return result
      },
      register: (
        config: Registration['config'],
        component: Registration['component']
      ): (() => void) => {
        registrations.push({ config, component })
        return () => undefined
      }
    }
    plugin.apply({ slots, effect: (setup: () => (() => void) | undefined) => { disposeStyle = setup() } })

    expect(plugin.inject).toEqual(['slots', 'remote.session', 'sessions', 'uiWorkspace'])
    expect(registrations.map(({ config }) => config.name)).toEqual([
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'conversation.hero.brand.mark',
      'sidebar.right.tab.document.unpreviewable',
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.menu.item'
    ])
    // Desktop toolbar styles have an owned lifetime; branding stays in currentColor.
    expect(appended).toHaveLength(1)
    expect(appended[0]?.textContent).toContain("[data-dsh-preset-search]")
    disposeStyle?.()
    expect(removeStyle).toHaveBeenCalledOnce()

    type Node = { type: unknown; props: Record<string, unknown> }
    const render = (node: Node): Node => typeof node.type === 'function' ? render((node.type as (props: unknown) => Node)(node.props)) : node
    const children = (node: Node) => node.props.children as Array<Node | string>

    // Product wordmark: real lowercase text "unoblox works" with the gold
    // full stop, like unoblox.ai.
    const sidebarName = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.name'
    )!.component({}) as Node
    expect(sidebarName.type).toBe('span')
    const [word, works, stop] = children(sidebarName)
    expect(word).toBe('unoblox ')
    expect((works as Node).props.children).toEqual(['works'])
    expect((stop as Node).props.children).toEqual(['.'])
    expect(((stop as Node).props.style as { color: string }).color).toBe('#D9A64A')

    // unoblox glyph: "u" in currentColor (follows the theme), gold dot.
    const sidebarMark = render(registrations.find(
      ({ config }) => config.name === 'sidebar.brand.mark'
    )!.component({ size: 24 }) as Node)
    expect(sidebarMark.type).toBe('svg')
    expect(sidebarMark.props['aria-hidden']).toBe('true')
    const [stroke, dot] = children(sidebarMark) as Node[]
    expect(stroke?.props.stroke).toBe('currentColor')
    expect(dot?.props.fill).toBe('#D9A64A')

    const heroMark = render(registrations.find(
      ({ config }) => config.name === 'conversation.hero.brand.mark'
    )!.component({ size: 48, className: 'fish' }) as Node)
    expect(heroMark.type).toBe('svg')
    expect(heroMark.props.width).toBe(48)
    expect(heroMark.props.className).toBe('fish')
  })
})
