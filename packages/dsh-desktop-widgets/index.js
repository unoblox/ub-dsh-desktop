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
  'Charts: the ECharts 6 library is preloaded as window.echarts when the HTML mentions "echarts"; give each chart a sized container, e.g. <div id="c" style="height:320px"></div> and echarts.init(document.getElementById("c")).',
  'Match the app theme with CSS variables: --uw-fg (text), --uw-muted (secondary text), --uw-bg (page), --uw-surface (cards, inputs), --uw-border, --uw-accent (highlights). They follow light and dark mode.',
  'Forms: when a <form> is submitted, its fields are sent back to you as the user\'s next message; give every input a name attribute. From script you can also call unoblox.submit({ ...values }).',
  'The widget resizes to its content. Keep it focused and accessible: label inputs, use buttons for actions, and keep text readable.'
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
        text: `The widget "${String(args.title)}" is shown to the user in the chat. If it has a form, what the user submits arrives as their next message.`
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
