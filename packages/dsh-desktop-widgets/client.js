window.__ModuleLoader__.load({
  id: 'dsh-desktop-widgets',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useRef, useState } = React

    // In-chat widgets: renders `show_widget` calls (index.js) as a sandboxed
    // frame. The frame gets scripts and forms but no same-origin access, no
    // network (its own CSP) and no way to reach the app except the messages
    // handled below: resize, submit and error.

    const NS = 'dsh-desktop-widgets'
    const TOOL_NAME = 'show_widget'
    const CHART_LIBRARY_ROUTE = '/api/desktop-widgets/echarts.js'
    const MIN_HEIGHT = 80
    const MAX_HEIGHT = 1200
    const DEFAULT_HEIGHT = 240
    const SUBMIT_INTERVAL_MS = 1500
    const MAX_FIELD = 2000
    const MAX_SUBMISSION = 8000
    const STYLE_ID = 'dsh-desktop-widgets-style'

    const en = {
      label: 'Widget',
      building: 'Building widget…',
      unreadable: 'This widget could not be shown.',
      failed: 'The widget was not shown: {message}',
      shownBelow: '"{title}" is shown below.',
      frameTitle: 'Interactive widget: {title}',
      sent: 'Sent to the agent.',
      sendFailed: 'Could not send: {message}',
      scriptError: 'The widget hit an error: {message}',
      chartsUnavailable: 'Charts are unavailable, so the widget may be incomplete.'
    }
    const zh = {
      label: '小组件',
      building: '正在生成小组件…',
      unreadable: '无法显示此小组件。',
      failed: '小组件未显示：{message}',
      shownBelow: '"{title}" 显示在下方。',
      frameTitle: '交互式小组件：{title}',
      sent: '已发送给智能体。',
      sendFailed: '发送失败：{message}',
      scriptError: '小组件出错：{message}',
      chartsUnavailable: '图表库不可用，小组件可能显示不完整。'
    }

    // Light and dark palettes the widget sees as CSS variables; the accent is
    // the unoblox gold.
    const THEMES = {
      light: { fg: '#18191c', muted: '#6b6f76', bg: 'transparent', surface: '#f6f6f4', border: '#e3e3df', accent: '#b9832b' },
      dark: { fg: '#f2f2f3', muted: '#9a9ca2', bg: 'transparent', surface: '#202023', border: '#34343a', accent: '#D9A64A' }
    }

    // ---------- pure helpers (exported for tests) ----------

    /** Read the tool call's arguments; undefined while they are still streaming or invalid. */
    function parseWidgetArgs(raw) {
      if (typeof raw !== 'string' || raw.trim() === '') return undefined
      let value
      try {
        value = JSON.parse(raw)
      } catch {
        return undefined
      }
      if (typeof value !== 'object' || value === null) return undefined
      const title = typeof value.title === 'string' ? value.title.trim().slice(0, 120) : ''
      const html = typeof value.html === 'string' ? value.html : ''
      if (title === '' || html.trim() === '') return undefined
      const height = Number.isInteger(value.height) ? clampHeight(value.height) : DEFAULT_HEIGHT
      return { title, html, height }
    }

    function clampHeight(value) {
      if (!Number.isFinite(value)) return DEFAULT_HEIGHT
      return Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value)))
    }

    function usesCharts(html) {
      return /\becharts\b/u.test(html)
    }

    // A script body inlined into the frame must not close its <script> tag.
    function inlineScript(source) {
      return source.replace(/<\/(script)/giu, '<\\/$1').replace(/<!--/gu, '<\\!--')
    }

    // Runs first inside the frame: the only channel to the app.
    function bootstrap(token) {
      return `(function () {
  var token = ${JSON.stringify(token)};
  function post(message) { message.__unobloxWidget = token; parent.postMessage(message, '*'); }
  function measure() {
    var d = document.documentElement, b = document.body;
    post({ kind: 'resize', height: Math.max(d.scrollHeight, b ? b.scrollHeight : 0) });
  }
  function plain(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return String(value); }
  }
  window.unoblox = { submit: function (values) { post({ kind: 'submit', data: plain(values == null ? {} : values) }); } };
  function add(data, key, text) {
    if (Object.prototype.hasOwnProperty.call(data, key)) data[key] = [].concat(data[key], text); else data[key] = text;
  }
  // A field without a name is still sent, keyed by its label, id or placeholder.
  function fieldKey(field) {
    var label = field.id && document.querySelector('label[for="' + field.id.replace(/"/g, '') + '"]');
    if (!label && field.closest) label = field.closest('label');
    var text = label ? label.textContent.trim() : '';
    return text || field.getAttribute('aria-label') || field.id || field.getAttribute('placeholder') || field.type || 'field';
  }
  document.addEventListener('submit', function (event) {
    event.preventDefault();
    var form = event.target, data = {};
    new FormData(form, event.submitter || undefined).forEach(function (value, key) {
      add(data, key, typeof value === 'string' ? value : '[file]');
    });
    Array.prototype.forEach.call(form.querySelectorAll('input:not([name]), select:not([name]), textarea:not([name])'), function (field) {
      if (field.disabled || field.type === 'submit' || field.type === 'button' || field.type === 'reset' || field.type === 'file') return;
      if ((field.type === 'checkbox' || field.type === 'radio') && !field.checked) return;
      add(data, fieldKey(field), field.value);
    });
    post({ kind: 'submit', data: data, form: form.getAttribute('aria-label') || form.getAttribute('name') || '' });
  }, true);
  window.addEventListener('error', function (event) { post({ kind: 'error', message: String(event.message || 'error') }); });
  window.addEventListener('unhandledrejection', function (event) { post({ kind: 'error', message: String(event.reason && event.reason.message || event.reason) }); });
  window.addEventListener('load', function () {
    measure();
    if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(document.documentElement);
  });
})();`
    }

    /**
     * The frame document: a strict CSP (scripts and styles inline only, no
     * network, no navigation), the theme variables, the bridge, the chart
     * library when the widget uses it, then the agent's HTML.
     */
    function buildWidgetDocument(html, options) {
      const theme = THEMES[options.dark ? 'dark' : 'light']
      const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'"
      const style = `:root{color-scheme:${options.dark ? 'dark' : 'light'};--uw-fg:${theme.fg};--uw-muted:${theme.muted};--uw-bg:${theme.bg};--uw-surface:${theme.surface};--uw-border:${theme.border};--uw-accent:${theme.accent}}
html,body{margin:0;background:transparent}
body{padding:4px;color:var(--uw-fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;overflow-wrap:anywhere}
input,select,textarea,button{font:inherit;color:inherit}
input,select,textarea{background:var(--uw-surface);border:1px solid var(--uw-border);border-radius:8px;padding:6px 10px}
button{background:var(--uw-accent);color:#fff;border:0;border-radius:8px;padding:7px 14px;cursor:pointer}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--uw-accent);outline-offset:2px}
table{border-collapse:collapse}th,td{border-bottom:1px solid var(--uw-border);padding:6px 8px;text-align:left}`
      return [
        '<!doctype html><html><head><meta charset="utf-8">',
        `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        `<style>${style}</style>`,
        `<script>${inlineScript(bootstrap(options.token))}</script>`,
        typeof options.library === 'string' ? `<script>${inlineScript(options.library)}</script>` : '',
        '</head><body>',
        html,
        '</body></html>'
      ].join('')
    }

    function clip(text, limit) {
      return text.length > limit ? `${text.slice(0, limit)}…` : text
    }

    /** What the agent receives when the user submits a widget. */
    function formatSubmission(title, data) {
      const lines = [`Submitted from the "${title}" widget:`]
      if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
        const entries = Object.entries(data)
        if (entries.length === 0) lines.push('(no fields)')
        for (const [key, value] of entries.slice(0, 100)) {
          const shown = Array.isArray(value) ? value.map((item) => String(item)).join(', ') : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
          lines.push(`- ${clip(key.replace(/\s+/gu, ' '), 100)}: ${clip(shown, MAX_FIELD)}`)
        }
      } else {
        lines.push(clip(typeof data === 'string' ? data : JSON.stringify(data), MAX_FIELD))
      }
      return clip(lines.join('\n'), MAX_SUBMISSION)
    }

    // ---------- chart library ----------

    let libraryPromise
    function loadChartLibrary() {
      libraryPromise ??= fetch(CHART_LIBRARY_ROUTE, { credentials: 'same-origin' }).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
        return response.text()
      })
      // A failed load is retried by the next widget that needs it.
      libraryPromise.catch(() => { libraryPromise = undefined })
      return libraryPromise
    }

    function useDarkTheme() {
      const read = () => typeof document !== 'undefined' && document.body?.hasAttribute('data-ds-dark-theme') === true
      const [dark, setDark] = useState(read)
      useEffect(() => {
        if (typeof MutationObserver !== 'function' || !document.body) return undefined
        const observer = new MutationObserver(() => setDark(read()))
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
        return () => observer.disconnect()
      }, [])
      return dark
    }

    function randomToken() {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    }

    // ---------- components ----------

    function WidgetFrame({ widget, t, sendText }) {
      const dark = useDarkTheme()
      const frameRef = useRef(null)
      const lastSubmit = useRef(0)
      const [height, setHeight] = useState(widget.height)
      const [notice, setNotice] = useState(undefined)
      const charts = usesCharts(widget.html)
      const [library, setLibrary] = useState(charts ? undefined : null)
      const token = useMemo(randomToken, [widget.html, dark])

      useEffect(() => {
        if (!charts) return undefined
        let live = true
        loadChartLibrary().then(
          (source) => { if (live) setLibrary(source) },
          () => { if (live) { setLibrary(null); setNotice({ kind: 'error', text: t('chartsUnavailable') }) } }
        )
        return () => { live = false }
      }, [charts, t])

      useEffect(() => {
        const onMessage = (event) => {
          const frame = frameRef.current
          if (!frame || event.source !== frame.contentWindow) return
          const data = event.data
          if (typeof data !== 'object' || data === null || data.__unobloxWidget !== token) return
          if (data.kind === 'resize' && typeof data.height === 'number') {
            setHeight(clampHeight(data.height + 2))
          } else if (data.kind === 'error') {
            setNotice({ kind: 'error', text: t('scriptError', { message: String(data.message).slice(0, 200) }) })
          } else if (data.kind === 'submit') {
            const now = Date.now()
            if (now - lastSubmit.current < SUBMIT_INTERVAL_MS) return
            lastSubmit.current = now
            Promise.resolve()
              .then(() => sendText(formatSubmission(widget.title, data.data)))
              .then(
                () => setNotice({ kind: 'ok', text: t('sent') }),
                (error) => setNotice({ kind: 'error', text: t('sendFailed', { message: error instanceof Error ? error.message : String(error) }) })
              )
          }
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [token, widget.title, sendText, t])

      if (library === undefined) return h('div', { className: 'dshWidgetStatus' }, t('building'))
      const srcDoc = buildWidgetDocument(widget.html, { dark, token, library: library ?? undefined })
      return h(React.Fragment, null,
        h('iframe', {
          ref: frameRef,
          className: 'dshWidgetFrame',
          title: t('frameTitle', { title: widget.title }),
          sandbox: 'allow-scripts allow-forms',
          referrerPolicy: 'no-referrer',
          srcDoc,
          style: { height: `${String(height)}px` }
        }),
        notice ? h('div', { className: `dshWidgetNotice dshWidgetNotice-${notice.kind}`, role: notice.kind === 'error' ? 'alert' : 'status' }, notice.text) : null
      )
    }

    function WidgetCard({ widget, t, sendText }) {
      return h('section', { className: 'dshWidget', 'data-tool': TOOL_NAME, 'aria-label': widget.title },
        h('header', { className: 'dshWidgetHeader' },
          h('span', { className: 'dshWidgetLabel' }, t('label')),
          h('span', { className: 'dshWidgetTitle' }, widget.title)),
        h(WidgetFrame, { widget, t, sendText }))
    }

    /**
     * The tool call's row among the turn's steps, which the chat folds away
     * once the turn completes. The widget itself is in the turn's tail
     * (WidgetsTail), where it stays visible.
     */
    function WidgetToolView(props) {
      const { block, t } = props
      const settled = block !== undefined && 'kind' in block
      const raw = settled ? block.call?.argsRaw : block?.argsRaw
      const widget = useMemo(() => parseWidgetArgs(raw), [raw])
      let text
      if (settled && block.isError) {
        const message = block.content?.map((item) => item.type === 'text' ? item.text : '').join(' ').trim() || block.error?.code || 'error'
        text = t('failed', { message: message.slice(0, 300) })
      } else if (widget === undefined) {
        text = settled ? t('unreadable') : t('building')
      } else {
        text = t('shownBelow', { title: widget.title })
      }
      return h('div', { className: 'dshWidgetRow', 'data-tool-row': TOOL_NAME, role: settled && block.isError ? 'alert' : undefined },
        h('span', { className: 'dshWidgetLabel' }, t('label')), ' ', text)
    }

    // ---------- the turn's widgets ----------

    const DATA_KEY = 'unoblox-widgets'

    /**
     * Collect each turn's show_widget calls from the session events, so the
     * turn's tail can show them after the reply. A call whose result is an
     * error is dropped.
     */
    const widgetsDefinition = {
      kind: DATA_KEY,
      match: (event) => {
        if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
        if (event.type === 'tool/call' && event.data?.name === TOOL_NAME) return { id: String(event.data.turn), role: 'update' }
        if (event.type === 'tool/result') return { id: String(event.data.turn), role: 'update' }
        return null
      },
      start: (_context, match) => ({ turn: match.event.data.turn, widgets: [] }),
      update: (context, match) => {
        const state = context.state
        if (match.event.type === 'tool/call') {
          // A call can be announced more than once; the latest arguments win.
          const callId = String(match.event.data.callId)
          const entry = { callId, seq: match.event.seq, argsRaw: match.event.data.arguments }
          const known = state.widgets.some((widget) => widget.callId === callId)
          return { ...state, widgets: known ? state.widgets.map((widget) => widget.callId === callId ? entry : widget) : [...state.widgets, entry] }
        }
        if (match.event.type === 'tool/result' && match.event.data?.message?.isError === true) {
          const callId = String(match.event.data.message.source?.callId)
          if (!state.widgets.some((widget) => widget.callId === callId)) return state
          return { ...state, widgets: state.widgets.filter((widget) => widget.callId !== callId) }
        }
        return state
      },
      buildLocationData: (context, scope, previous) => {
        if (scope !== 'turn' || context.state === undefined || context.state.widgets.length === 0) return null
        if (previous?.kind === 'turn' && previous.turn === context.state.turn && previous.key === DATA_KEY && previous.value.widgets === context.state.widgets) return previous
        return { kind: 'turn', turn: context.state.turn, key: DATA_KEY, value: { widgets: context.state.widgets } }
      }
    }

    /** The turn's widgets, after its reply. */
    function WidgetsTail(props) {
      const { turn, t, sendText } = props
      const recorded = turn?.data?.get(DATA_KEY)?.widgets
      const widgets = useMemo(() => (recorded ?? [])
        .map((entry) => ({ callId: entry.callId, widget: parseWidgetArgs(entry.argsRaw) }))
        .filter((entry) => entry.widget !== undefined), [recorded])
      if (widgets.length === 0) return null
      return h('div', { className: 'dshWidgets' }, ...widgets.map((entry) => h(WidgetCard, { key: entry.callId, widget: entry.widget, t, sendText })))
    }

    const STYLE = `
      .dshWidgets{display:flex;flex-direction:column;gap:12px;margin:4px 0 8px}
      .dshWidgetRow{font-size:13px;padding:2px 0;color:var(--dsw-alias-label-secondary, inherit)}
      .dshWidget{margin:0;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25));border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-base, transparent)}
      .dshWidgetHeader{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2));font-size:13px}
      .dshWidgetLabel{color:#D9A64A;font-weight:600;text-transform:lowercase}
      .dshWidgetTitle{font-weight:600;color:var(--dsw-alias-label-primary, inherit)}
      .dshWidgetFrame{display:block;width:100%;border:0;background:transparent;color-scheme:normal}
      .dshWidgetStatus{padding:12px;font-size:13px;color:var(--dsw-alias-label-secondary, inherit)}
      .dshWidgetNotice{padding:6px 12px 10px;font-size:12px;color:var(--dsw-alias-label-secondary, inherit)}
      .dshWidgetNotice-error{color:var(--dsw-alias-state-error-primary, #d93025)}
    `

    function installStyles() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.textContent = STYLE
      document.head.appendChild(tag)
    }

    // ---------- composition ----------

    const inject = ['slots', 'locale', 'uiConversation']
    function apply(ctx) {
      installStyles()
      ctx.effect(() => ctx.locale.register(NS, { zh, en }))
      ctx.uiConversation.events.register(widgetsDefinition)
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: TOOL_NAME,
        locale: NS
      }, WidgetToolView))
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        id: NS,
        locale: NS,
        // A submission goes to the session the widget belongs to, as the
        // user's next message.
        inject: (sessionId) => ({
          sendText: (text) => {
            const conversation = ctx.get('sessions')?.scope(sessionId)?.get('conversation')
            if (!conversation || typeof conversation.send !== 'function') throw new Error('the conversation is not available')
            return conversation.send(text)
          }
        })
      }, WidgetsTail))
    }

    exports.apply = apply
    exports.inject = inject
    exports.parseWidgetArgs = parseWidgetArgs
    exports.buildWidgetDocument = buildWidgetDocument
    exports.formatSubmission = formatSubmission
    exports.inlineScript = inlineScript
    exports.usesCharts = usesCharts
    exports.clampHeight = clampHeight
    exports.WidgetToolView = WidgetToolView
    exports.WidgetsTail = WidgetsTail
    exports.widgetsDefinition = widgetsDefinition
    return module.exports
  }
})
