window.__ModuleLoader__.load({
  id: 'dsh-desktop-unoblox-info',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React
    const { IconSparkleRegular, IconWarningOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    const NS = 'desktop-unoblox-info'
    // Served by index.js; same origin as the page, behind the Harness session cookie.
    const INFO_ROUTE = '/api/desktop-unoblox.info'
    const STYLE_ID = 'dsh-desktop-unoblox-info-style'
    // Same metrics as the stock stats pills beside it (dsh-client-ui-chat
    // StatsPills), so balance and model read as part of that one row.
    const STYLE = `
      /* Give up room before the stock pills do; only the model name truncates. */
      .dshUbxInfo{box-sizing:border-box;flex:0 100 auto;min-width:0;display:inline-flex;align-items:center;gap:12px;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}
      .dshUbxInfoPill{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;min-width:0;padding:1px 8px;border-radius:999px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}
      .dshUbxInfoPill svg{flex:none;width:14px;height:14px}
      .dshUbxInfoPill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dshUbxInfoLabel{min-width:0;overflow:hidden;text-overflow:ellipsis}
      .dshUbxInfoBalance{flex:none}
      .dshUbxInfoModel .dshUbxInfoLabel{max-width:180px}
      /* The missing key blocks every reply: error colour, clickable. */
      .dshUbxInfoKey{flex:none;font:inherit;border:1px solid currentColor;background:none;cursor:pointer;color:var(--dsw-alias-state-error-primary)}
      .dshUbxInfoKey:hover{background:var(--dsw-alias-interactive-bg-hover)}
    `

    const en = {
      label: 'unoblox',
      balance: 'unoblox balance {amount}',
      model: 'Model {model}',
      modelRouted: 'Model {model}. {reason}',
      keyMissing: 'Add API key',
      keyMissingHint: 'No unoblox API key yet. Click to open Settings › Models and add it.'
    }
    const zh = {
      label: 'unoblox',
      balance: 'unoblox 余额 {amount}',
      model: '模型 {model}',
      modelRouted: '模型 {model}。{reason}',
      keyMissing: '添加 API 密钥',
      keyMissingHint: '尚未设置 unoblox API 密钥。点击打开“设置 › 模型”添加。'
    }

    // ---------- formatting (pure) ----------

    const RUPEES = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    /** Rupees as unoblox reports them (INR), always with the ₹ sign. */
    function formatInr(amount) {
      return `₹${RUPEES.format(amount)}`
    }

    /** `author/model` slugs show the model part; the full slug stays in the tooltip. */
    function shortModel(slug) {
      const slash = slug.lastIndexOf('/')
      return slash < 0 ? slug : slug.slice(slash + 1)
    }

    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /**
     * The renderer-facing view of one route response, or undefined when the
     * body is not the route's shape. Display code reads only this.
     */
    function toView(body) {
      if (!isRecord(body) || typeof body.key !== 'string') return undefined
      const billing = isRecord(body.billing) && typeof body.billing.balanceInr === 'number' ? body.billing : undefined
      const turn = isRecord(body.turn) ? body.turn : undefined
      const routing = turn !== undefined && isRecord(turn.routing) ? turn.routing : undefined
      const model = typeof routing?.servedModel === 'string' ? routing.servedModel : typeof routing?.selectedModel === 'string' ? routing.selectedModel : undefined
      return {
        key: body.key,
        ...(billing === undefined ? {} : { balanceInr: billing.balanceInr, ...(typeof billing.note === 'string' ? { note: billing.note } : {}) }),
        ...(model === undefined ? {} : { model, ...(typeof routing.reason === 'string' ? { reason: routing.reason } : {}) })
      }
    }

    // ---------- network (service) ----------

    /** Route client. Network stays here, out of the display components. */
    function createInfoService(doFetch = (...args) => fetch(...args)) {
      return {
        async load(sessionId, signal) {
          const query = sessionId === undefined ? '' : `?session=${encodeURIComponent(sessionId)}`
          const response = await doFetch(`${INFO_ROUTE}${query}`, { credentials: 'same-origin', cache: 'no-store', signal })
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          const view = toView(await response.json())
          if (view === undefined) throw new Error('unexpected response shape')
          return view
        }
      }
    }

    /**
     * Load on mount and session change, then again whenever a turn ends
     * (running true → false), when unoblox has just reported a new balance.
     * A newer load aborts the older one; results after unmount are dropped.
     * A failed refresh keeps the last values rather than blanking the row.
     */
    function useUnobloxInfo(service, sessionId, running) {
      const [view, setView] = useState(undefined)
      const controller = useRef(undefined)
      const reload = useCallback(() => {
        controller.current?.abort()
        const current = new AbortController()
        controller.current = current
        service.load(sessionId, current.signal).then(
          (next) => {
            if (!current.signal.aborted) setView(next)
          },
          () => {
            // Nothing to show is the honest state for an unreachable route;
            // the next turn end retries. Values already shown stay.
          }
        )
      }, [service, sessionId])
      useEffect(() => {
        reload()
        return () => controller.current?.abort()
      }, [reload])
      const wasRunning = useRef(running)
      useEffect(() => {
        if (wasRunning.current === true && running === false) reload()
        wasRunning.current = running
      }, [running, reload])
      return view
    }

    // ---------- display ----------

    // Wallet glyph (14px grid, currentColor); the primitives set has none.
    function WalletIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M2.5 4.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7Zm0 0 7.6-2.2a.8.8 0 0 1 1 .77V4.5M10.5 8.5h1.5',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round'
        }))
    }

    /**
     * Open Settings › Models. The settings shell keeps its open state private,
     * so this does what a user would: the sidebar Settings button, then the
     * Models row. Returns false when the button is not there (the tooltip
     * still says where the key goes).
     */
    function openModelsSettings() {
      const trigger = document.querySelector('button[class*="_trigger"][aria-haspopup="dialog"]')
      if (trigger === null) return false
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
      let tries = 0
      const pick = () => {
        const row = Array.from(document.querySelectorAll('[class*="_navCell"]'))
          .find((element) => element.textContent?.trim() === 'Models')
        if (row !== undefined) row.click()
        else if (++tries < 30) requestAnimationFrame(pick)
      }
      requestAnimationFrame(pick)
      return true
    }

    function Pill({ icon, text, description, className, onActivate }) {
      if (onActivate !== undefined) {
        return h('button', {
          type: 'button',
          className: className === undefined ? 'dshUbxInfoPill' : `dshUbxInfoPill ${className}`,
          title: description,
          'aria-label': description,
          onClick: onActivate
        }, icon, h('span', { className: 'dshUbxInfoLabel' }, text))
      }
      // Focusable so keyboard users reach the same detail the tooltip shows.
      return h('span', {
        className: className === undefined ? 'dshUbxInfoPill' : `dshUbxInfoPill ${className}`,
        title: description,
        'aria-label': description,
        tabIndex: 0
      }, icon, h('span', { className: 'dshUbxInfoLabel' }, text))
    }

    /**
     * Presentational row: balance and model as icon pills, or a missing-key
     * pill. Renders nothing until unoblox has reported a value, so the row
     * never shows placeholders.
     */
    function UnobloxInfoStrip({ view, t }) {
      if (view === undefined) return null
      const pills = []
      if (view.key === 'missing') {
        pills.push(h(Pill, { key: 'key', className: 'dshUbxInfoKey', icon: h(IconWarningOutlineRegular, { size: 14 }), text: t('keyMissing'), description: t('keyMissingHint'), onActivate: openModelsSettings }))
      }
      if (view.balanceInr !== undefined) {
        const amount = formatInr(view.balanceInr)
        const label = t('balance', { amount })
        pills.push(h(Pill, { key: 'balance', className: 'dshUbxInfoBalance', icon: h(WalletIcon), text: amount, description: view.note === undefined ? label : `${label}. ${view.note}` }))
      }
      if (view.model !== undefined) {
        pills.push(h(Pill, {
          key: 'model',
          className: 'dshUbxInfoModel',
          icon: h(IconSparkleRegular, { size: 14 }),
          text: shortModel(view.model),
          description: view.reason === undefined ? t('model', { model: view.model }) : t('modelRouted', { model: view.model, reason: view.reason })
        }))
      }
      if (pills.length === 0) return null
      return h('div', { className: 'dshUbxInfo', role: 'group', 'aria-label': t('label'), 'data-unoblox-info': '' }, ...pills)
    }

    function UnobloxInfoDock(props) {
      const sessionId = props.session?.sessionId ?? props.sessionId
      const view = useUnobloxInfo(props.service, sessionId, props.session?.running)
      return h(UnobloxInfoStrip, { view, t: props.t })
    }

    function installStyles() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = STYLE
      document.head.appendChild(tag)
    }

    // ---------- composition ----------

    function apply(ctx) {
      ctx.inject(['slots', 'locale'], (scope) => {
        installStyles()
        scope.effect(() => scope.locale.register(NS, { zh, en }))
        const service = createInfoService()
        // After the stock stats pills (0) and the PPT chooser (20).
        scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-desktop-unoblox-info',
          order: 30,
          locale: NS,
          inject: () => ({ service })
        }, UnobloxInfoDock))
      })
    }

    const inject = []

    exports.apply = apply
    exports.inject = inject
    exports.createInfoService = createInfoService
    exports.toView = toView
    exports.formatInr = formatInr
    exports.shortModel = shortModel
    exports.UnobloxInfoStrip = UnobloxInfoStrip
    exports.UnobloxInfoDock = UnobloxInfoDock
    exports.locales = { en, zh }
    return module.exports
  }
})
