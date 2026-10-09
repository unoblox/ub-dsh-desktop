import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')
const read = (...parts: string[]) => readFile(path.join(projectRoot, ...parts), 'utf8')

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value.slice(0, 6)
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** The value a CSS block in the desktop UI plugin gives a custom property. */
function override(css: string, selector: string, property: string): string {
  const block = new RegExp(`${selector.replace(/[[\]()]/gu, '\\$&')}\\s*\\{([^}]*)\\}`, 'gu')
  for (const match of css.matchAll(block)) {
    const value = new RegExp(`${property}:(#[0-9a-fA-F]{3,8})`, 'u').exec(match[1] ?? '')?.[1]
    if (value) return value
  }
  throw new Error(`${selector} sets no ${property}`)
}

describe('readability overrides', () => {
  it('keep secondary text, captions and links at WCAG AA on every light surface', async () => {
    const [css, theme] = await Promise.all([
      read('packages', 'dsh-desktop-client-ui', 'client.js'),
      read('node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js')
    ])
    // The light surfaces text sits on: page, sidebar, hover and selection fills.
    const surfaces = ['00', '50', '60', '75', '100'].flatMap((step) =>
      [...theme.matchAll(new RegExp(`--dsw-static-neutral-bluish-${step}:(#[0-9a-f]{3,6})`, 'gu'))].map((m) => m[1] ?? ''))
    expect(surfaces.length).toBeGreaterThanOrEqual(5)
    for (const property of ['--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-caption', '--dsw-alias-link']) {
      const color = override(css, 'body:not([data-ds-dark-theme])', property)
      for (const surface of surfaces) expect(contrast(color, surface), `${property} ${color} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keep dark captions at WCAG AA on raised dark surfaces', async () => {
    const css = await read('packages', 'dsh-desktop-client-ui', 'client.js')
    const caption = override(css, 'body[data-ds-dark-theme]', '--dsw-alias-label-caption')
    for (const surface of ['#0f1115', '#1b1b1c', '#2c2c2e', '#353638']) expect(contrast(caption, surface)).toBeGreaterThanOrEqual(4.5)
  })

  it('make menus nearly opaque so the page does not show through options', async () => {
    const css = await read('packages', 'dsh-desktop-client-ui', 'client.js')
    for (const selector of ['body:not([data-ds-dark-theme])', 'body[data-ds-dark-theme]']) {
      const fill = override(css, selector, '--dsw-menu-surface-fill')
      expect(fill).toHaveLength(9)
      expect(parseInt(fill.slice(7), 16) / 255).toBeGreaterThanOrEqual(0.95)
    }
  })

  it('rely on the markers the upstream patches add', async () => {
    const [css, modelSelection, theme] = await Promise.all([
      read('packages', 'dsh-desktop-client-ui', 'client.js'),
      read('node_modules', '@deepseek-ai', 'dsh-client-ui-model-selection', 'lib', 'client.js'),
      read('node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js')
    ])
    expect(css).toContain('input[data-dsh-model-search]')
    expect(modelSelection).toContain('"data-dsh-model-search": ""')
    // With no effort choice, the picker opens on the model list and its search.
    expect(modelSelection).toMatch(/const modelsFirst = state\.current === null \|\| reasoning === void 0;\s+if \(modelsFirst\) paneFocus\.current = "drill";\s+setPane\(modelsFirst \? "model" : "root"\);/u)
    expect(css).toContain('[data-dsh-font-stepper]')
    expect(theme).toContain('"data-dsh-font-stepper": ""')
  })
})
