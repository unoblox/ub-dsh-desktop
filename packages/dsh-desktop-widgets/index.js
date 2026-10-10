/**
 * Host half of in-chat widgets.
 *
 * Registers the `show_widget` tool. The agent passes a title and one
 * self-contained HTML document; the call's arguments stay in the session
 * history, and the client half (client.js) renders them in the conversation
 * inside a sandboxed frame with no network access. Nothing here runs the
 * HTML.
 *
 * Also serves the bundled ECharts build on one same-origin route, so widgets
 * can draw charts without the network: the client inlines it into a widget
 * that uses it.
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-desktop-widgets'
export const inject = ['tools', 'connection']

export const TOOL_NAME = 'show_widget'
export const CHART_LIBRARY_ROUTE = '/api/desktop-widgets/echarts.js'
/** Upper bound on the agent's HTML; a widget is a focused page, not an app. */
export const MAX_WIDGET_HTML = 200_000
export const MIN_HEIGHT = 80
export const MAX_HEIGHT = 1200

export const TOOL_DESCRIPTION = [
  'Show an interactive widget directly in the chat: a chart, a form, a calculator, a sortable or filterable table, a small visualisation or simulation.',
  'Use it when interaction or a visual makes the answer clearly better; answer in plain text or Markdown otherwise.',
  'Pass one self-contained HTML fragment or document with inline <style> and <script>. It runs in a sandbox with no network:',
  'no external scripts, stylesheets, fonts, images or fetch/XHR; use inline SVG or data: URLs.',
  'Charts: the ECharts 6 library is preloaded as window.echarts when the HTML mentions "echarts"; put each chart in <div class="uw-chart" id="c"></div> and call echarts.init(document.getElementById("c")); the default chart theme already matches the app.',
  'Design: compact, clean and sharp. The chat already draws a frame with the title above the widget, so do not repeat the title, and do not wrap the widget in an outer card, padding, border, background or shadow; no gradients or emoji.',
  'Form controls, buttons and tables are already styled (one 32px control height, 13px text): do not restyle them. Lay out with the built-in classes instead of your own spacing:',
  'uw-split (inputs beside results, stacks when narrow), uw-field (a <label> above its input), uw-grid, uw-row, uw-stack, uw-stats with uw-stat (<div class="uw-stat"><span>label</span><strong>value</strong></div>) for key numbers, uw-card (a subtle panel), uw-actions (buttons, right-aligned), uw-chart (a 220px chart container), uw-muted, and num on numeric table cells.',
  'Prefer side-by-side layouts to tall stacks; keep charts 180–260px tall; at most one primary button.',
  'Colours, when you need them: CSS variables --uw-fg, --uw-muted, --uw-surface, --uw-border, --uw-accent (accent text, highlights), --uw-accent-fill (fills) and --uw-on-accent (text on the fill). They follow light and dark mode. Do not use font sizes below 12px.',
  'Forms: when a <form> is submitted, its fields are sent back to you as the user\'s next message; give every input a name attribute. From a button\'s click handler you can also call unoblox.submit({ ...values }); it only works in response to the user\'s click.',
  'The widget resizes to its content. Keep it focused and accessible: label inputs and use buttons for actions.',
  'The user sees the widget, not its code: do not repeat the HTML or any code in your text reply; at most add one short sentence.'
].join(' ')

const require = createRequire(import.meta.url)

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'Short title shown above the widget, such as "Loan calculator".'
      },
      html: {
        type: 'string',
        required: true,
        description: `The widget as self-contained HTML with inline CSS and JavaScript, at most ${String(MAX_WIDGET_HTML)} characters. No network access.`
      },
      height: {
        type: 'integer',
        description: `Initial height in pixels (${String(MIN_HEIGHT)}–${String(MAX_HEIGHT)}) before the widget sizes itself. Optional.`
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { shown: { type: 'boolean', const: true, required: true } }
      },
      render: (args) => [{
        type: 'text',
        text: `The widget "${String(args.title)}" is now shown to the user in the chat; do not show it again unless it changes. If it has a form, what the user submits arrives as their next message.`
      }]
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const title = String(args.title).trim()
      if (title.length === 0 || title.length > 120) throw new Error('title must be 1–120 characters')
      if (args.html.trim().length === 0) throw new Error('html is empty')
      if (args.html.length > MAX_WIDGET_HTML) throw new Error(`html is longer than ${String(MAX_WIDGET_HTML)} characters; simplify the widget`)
      if (args.height !== undefined && (args.height < MIN_HEIGHT || args.height > MAX_HEIGHT)) {
        throw new Error(`height must be between ${String(MIN_HEIGHT)} and ${String(MAX_HEIGHT)}`)
      }
      return { shown: true }
    }
  }))

  let library
  ctx.connection.fetch.register({
    path: CHART_LIBRARY_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        library ??= await readFile(require.resolve('echarts/dist/echarts.min.js'), 'utf8')
      } catch (error) {
        ctx.logger.warn('widgets: chart library unavailable: %s', error instanceof Error ? error.message : String(error))
        return new Response('chart library unavailable', { status: 503 })
      }
      return new Response(library, {
        headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'private, max-age=86400' }
      })
    }
  })
}
