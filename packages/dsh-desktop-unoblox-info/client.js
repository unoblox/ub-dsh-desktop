window.__ModuleLoader__.load({
  id: 'dsh-desktop-unoblox-info',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useCallback, useEffect, useId, useRef, useState } = React
    const h = React.createElement

    const NS = 'desktop-unoblox-info'
    // Served by index.js; same origin as the page, behind the Harness session cookie.
    const INFO_ROUTE = '/api/desktop-unoblox.info'
    const STYLE_ID = 'dsh-desktop-unoblox-info-style'
    const STYLE = `
      /* Take only the room the stock dock items leave (basis 0), never theirs. */
      .dshUbxInfo{position:relative;flex:1 1 0%;display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:2px 10px;min-width:0;max-width:100%;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
      .dshUbxInfoItem{display:inline-flex;align-items:baseline;gap:4px;min-width:0;white-space:nowrap}
      .dshUbxInfoValue{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
      .dshUbxInfoModel{max-width:220px;overflow:hidden;text-overflow:ellipsis}
      .dshUbxInfoButton{border:0;background:transparent;padding:0 2px;font:inherit;color:var(--dsw-alias-label-secondary);text-decoration:underline;text-underline-offset:2px;cursor:pointer;border-radius:4px;transition:color .15s ease}
      .dshUbxInfoButton:hover{color:var(--dsw-alias-label-primary)}
      .dshUbxInfoButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      /* Details float above the strip so opening them never grows the dock. */
      .dshUbxInfoDetails{position:absolute;right:0;bottom:calc(100% + 6px);z-index:20;box-sizing:border-box;width:min(440px,calc(100vw - 32px));max-height:min(320px,50vh);overflow-y:auto;margin:0;padding:10px 12px;list-style:none;display:flex;flex-direction:column;gap:4px;white-space:normal;color:var(--dsw-alias-label-secondary);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;box-shadow:var(--dsw-elevation-panel)}
      @media (prefers-reduced-motion:reduce){.dshUbxInfoButton{transition:none}}
    `

    const en = {
      label: 'Unoblox',
      loading: 'Loading Unoblox info…',
      unavailable: 'Unoblox info unavailable',
      retry: 'Retry',
      keyMissing: 'No Unoblox API key. Add it in Settings → Models.',
      searchPrice: 'Search {price} / 1,000',
      searchPriceUnavailable: 'Search price unavailable',
      balance: 'Balance {amount}',
      balancePending: 'Balance shows after the first reply',
      lastTurn: 'Last reply {amount}',
      lastTurnEstimated: 'Last reply {amount} (estimated)',
      model: 'Model {model}',
      details: 'Details',
      hideDetails: 'Hide details',
      maxPerSearch: 'At most {price} per search',
      tier: 'Tier: {tier}',
      tierStage: 'Tier: {tier} · {stage}',
      routing: 'Routing: {reason}',
      balanceAt: 'Balance as of {time}'
    }
    const zh = {
      label: 'Unoblox',
      loading: '正在加载 Unoblox 信息…',
      unavailable: '无法获取 Unoblox 信息',
      retry: '重试',
      keyMissing: '尚未设置 Unoblox API 密钥，请在“设置 → 模型”中添加。',
      searchPrice: '搜索 {price} / 1,000 次',
      searchPriceUnavailable: '无法获取搜索价格',
      balance: '余额 {amount}',
      balancePending: '首次回复后显示余额',
      lastTurn: '上次回复 {amount}',
      lastTurnEstimated: '上次回复 {amount}（估算）',
      model: '模型 {model}',
      details: '详情',
      hideDetails: '收起详情',
      maxPerSearch: '每次搜索最多 {price}',
      tier: '套餐：{tier}',
      tierStage: '套餐：{tier} · {stage}',
      routing: '路由：{reason}',
      balanceAt: '余额更新于 {time}'
    }

    // ---------- formatting (pure) ----------

    const RUPEES = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    /** Rupees as Unoblox reports them (INR), always with the ₹ sign. */
    function formatInr(amount) {
      return `₹${RUPEES.format(amount)}`
    }

    /** Integer paise (the pricing endpoint's unit) as rupees. */
    function formatPaise(paise) {
      return formatInr(paise / 100)
    }

    function formatTime(at) {
      return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
      const pricing = isRecord(body.searchPricing) && typeof body.searchPricing.paisePer1000 === 'number' ? body.searchPricing : undefined
      const billing = isRecord(body.billing) && typeof body.billing.balanceInr === 'number' ? body.billing : undefined
      const turn = isRecord(body.turn) ? body.turn : undefined
      return {
        key: body.key,
        pricing,
        pricingError: typeof body.searchPricingError === 'string' ? body.searchPricingError : undefined,
        billing,
        turnBilling: turn !== undefined && isRecord(turn.billing) && typeof turn.billing.balanceInr === 'number' ? turn.billing : undefined,
        routing: turn !== undefined && isRecord(turn.routing) ? turn.routing : undefined
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
     * (running true → false), when Unoblox has just reported a new balance.
     * A newer load aborts the older one; results after unmount are dropped.
     */
    function useUnobloxInfo(service, sessionId, running) {
      const [state, setState] = useState({ phase: 'loading', view: undefined })
      const controller = useRef(undefined)
      const reload = useCallback(() => {
        controller.current?.abort()
        const current = new AbortController()
        controller.current = current
        service.load(sessionId, current.signal).then(
          (view) => {
            if (!current.signal.aborted) setState({ phase: 'ready', view })
          },
          (error) => {
            if (current.signal.aborted) return
            setState((previous) => ({ phase: 'error', view: previous.view, error: error instanceof Error ? error.message : String(error) }))
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
      return { state, reload }
    }

    // ---------- display ----------

    function Item({ children, title, className }) {
      return h('span', { className: className === undefined ? 'dshUbxInfoItem' : `dshUbxInfoItem ${className}`, title }, children)
    }

    function Labeled({ t, keyName, params, valueName }) {
      // Keep the value styled separately without splitting translated text.
      const template = t(keyName, { ...params, [valueName]: '\u0000' })
      const [before, after = ''] = template.split('\u0000')
      return h(React.Fragment, null, before, h('span', { className: 'dshUbxInfoValue' }, params[valueName]), after)
    }

    /** Presentational strip: props in, `onRetry` out. */
    function UnobloxInfoStrip({ state, t, onRetry }) {
      const [open, setOpen] = useState(false)
      const detailsId = useId()
      const rootRef = useRef(null)
      const toggleRef = useRef(null)
      // A non-modal popover: Esc closes it and returns focus to the toggle; a
      // pointer press outside the strip closes it.
      useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          setOpen(false)
          toggleRef.current?.focus()
        }
        const onPointer = (event) => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('pointerdown', onPointer)
        return () => {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('pointerdown', onPointer)
        }
      }, [open])
      const view = state.view
      if (view === undefined) {
        if (state.phase === 'loading') return h('div', { className: 'dshUbxInfo', 'data-unoblox-info': '' }, h('span', { role: 'status' }, t('loading')))
        return h('div', { className: 'dshUbxInfo', 'data-unoblox-info': '' },
          h('span', { role: 'status' }, t('unavailable')),
          h('button', { type: 'button', className: 'dshUbxInfoButton', onClick: onRetry }, t('retry')))
      }
      const items = []
      if (view.key === 'missing') items.push(h(Item, { key: 'key' }, t('keyMissing')))
      if (view.pricing !== undefined) {
        const max = view.pricing.maxPaisePerSearch
        items.push(h(Item, { key: 'search', title: max === undefined ? undefined : t('maxPerSearch', { price: formatPaise(max) }) },
          h(Labeled, { t, keyName: 'searchPrice', params: { price: formatPaise(view.pricing.paisePer1000) }, valueName: 'price' })))
      } else {
        items.push(h(Item, { key: 'search', title: view.pricingError }, t('searchPriceUnavailable')))
      }
      if (view.billing !== undefined) {
        items.push(h(Item, { key: 'balance' }, h(Labeled, { t, keyName: 'balance', params: { amount: formatInr(view.billing.balanceInr) }, valueName: 'amount' })))
      } else if (view.key !== 'missing') {
        items.push(h(Item, { key: 'balance' }, t('balancePending')))
      }
      const charged = view.turnBilling?.chargedInr
      if (charged !== undefined) {
        items.push(h(Item, { key: 'turn' }, h(Labeled, {
          t, keyName: view.turnBilling.chargedEstimated ? 'lastTurnEstimated' : 'lastTurn', params: { amount: formatInr(charged) }, valueName: 'amount'
        })))
      }
      const model = view.routing?.servedModel ?? view.routing?.selectedModel
      if (model !== undefined) {
        items.push(h(Item, { key: 'model', className: 'dshUbxInfoModel', title: model }, h(Labeled, { t, keyName: 'model', params: { model }, valueName: 'model' })))
      }

      const details = []
      if (view.pricing?.maxPaisePerSearch !== undefined) details.push(t('maxPerSearch', { price: formatPaise(view.pricing.maxPaisePerSearch) }))
      if (view.billing?.note !== undefined) details.push(view.billing.note)
      if (view.billing?.tier !== undefined) {
        details.push(view.billing.stage === undefined ? t('tier', { tier: view.billing.tier }) : t('tierStage', { tier: view.billing.tier, stage: view.billing.stage }))
      }
      if (view.billing?.at !== undefined) details.push(t('balanceAt', { time: formatTime(view.billing.at) }))
      if (view.routing?.reason !== undefined) details.push(t('routing', { reason: view.routing.reason }))
      if (details.length > 0) {
        items.push(h('button', {
          key: 'toggle', ref: toggleRef, type: 'button', className: 'dshUbxInfoButton', 'aria-expanded': open, 'aria-controls': detailsId, onClick: () => setOpen((value) => !value)
        }, t(open ? 'hideDetails' : 'details')))
      }
      if (state.phase === 'error') {
        items.push(h('span', { key: 'error', role: 'status', className: 'dshUbxInfoItem', title: state.error }, t('unavailable')),
          h('button', { key: 'retry', type: 'button', className: 'dshUbxInfoButton', onClick: onRetry }, t('retry')))
      }
      return h('div', { ref: rootRef, className: 'dshUbxInfo', role: 'group', 'aria-label': t('label'), 'data-unoblox-info': '' },
        ...items,
        open && details.length > 0
          ? h('ul', { id: detailsId, className: 'dshUbxInfoDetails', 'aria-label': t('details') }, details.map((line, index) => h('li', { key: index }, line)))
          : null)
    }

    function UnobloxInfoDock(props) {
      const sessionId = props.session?.sessionId ?? props.sessionId
      const { state, reload } = useUnobloxInfo(props.service, sessionId, props.session?.running)
      return h(UnobloxInfoStrip, { state, t: props.t, onRetry: reload })
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
    exports.formatPaise = formatPaise
    exports.UnobloxInfoStrip = UnobloxInfoStrip
    exports.UnobloxInfoDock = UnobloxInfoDock
    exports.locales = { en, zh }
    return module.exports
  }
})
