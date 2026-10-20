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
      /* Actions under a turn unoblox refused (balance, key, busy). */
      .dshUbxFail{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:2px 0 8px;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;color:var(--dsw-alias-label-secondary)}
      .dshUbxFailHint{flex:1 1 100%}
      .dshUbxFailBtn{box-sizing:border-box;display:inline-flex;align-items:center;padding:3px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:none;color:var(--dsw-alias-label-primary);font:inherit;text-decoration:none;cursor:pointer}
      .dshUbxFailBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .dshUbxFailBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dshUbxFailBtn:disabled{opacity:.55;cursor:default}
      .dshUbxFailPrimary{border-color:transparent;background:#D9A64A;color:#18191c;font-weight:600}
      .dshUbxFailPrimary:hover{background:#cf9a3c}
      .dshUbxFailStatus{flex:1 1 100%}
      .dshUbxFailStatus[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
    `

    const en = {
      label: 'unoblox',
      balance: 'unoblox balance {amount}',
      model: 'Model {model}',
      modelRouted: 'Model {model}. {reason}',
      keyMissing: 'Add API key',
      keyMissingHint: 'No unoblox API key yet. Click to open Settings › Models and add it.',
      failBalanceHint: 'Free models cost ₹0 while your balance stays at {amount} or more.',
      failFreeNeedsHold: 'Free models are free while your balance is {amount} or more; below that they are charged at listed prices. Top up to continue.',
      failLowCostHint: 'Below {amount}, every model is charged at its listed price. A lower-cost model may still fit your balance of {balance}.',
      failUseLowCost: 'Retry with a lower-cost model',
      failSwitchedLowCost: 'Switched to {model}, charged at its listed price. Send your message again to continue.',
      failSwitchedLowCostSent: 'Switched to {model}, charged at its listed price, and sent your message again. You can change models in the model picker.',
      failTopUp: 'Top up',
      failUseFree: 'Retry with a free model',
      failSwitching: 'Switching…',
      failSwitchedSent: 'Switched to {model} (free) and sent your message again. You can change models in the model picker.',
      failSwitched: 'Switched to {model} (free). Send your message again to continue.',
      failSwitchFailed: 'Could not switch models: {message}',
      failSignIn: 'Sign in again',
      failSigningIn: 'Waiting for the browser…',
      failSignedIn: 'Signed in.',
      failSignInFailed: 'Sign-in did not finish: {message}',
      failRetry: 'Send again',
      failSent: 'Sent again.',
      failSendFailed: 'Could not send: {message}',
      failBusyHint: 'unoblox is busy right now. Wait a moment, then send again.',
      failServerHint: 'unoblox could not finish this request. Your key is fine; try again.'
    }
    const zh = {
      label: 'unoblox',
      balance: 'unoblox 余额 {amount}',
      model: '模型 {model}',
      modelRouted: '模型 {model}。{reason}',
      keyMissing: '添加 API 密钥',
      keyMissingHint: '尚未设置 unoblox API 密钥。点击打开“设置 › 模型”添加。',
      failBalanceHint: '余额保持在 {amount} 或以上时，免费模型不收费（₹0）。',
      failFreeNeedsHold: '余额在 {amount} 或以上时免费模型不收费；低于该金额时按标价收费。请充值后继续。',
      failLowCostHint: '余额低于 {amount} 时，所有模型均按标价收费。更低价的模型可能仍在你的余额 {balance} 范围内。',
      failUseLowCost: '改用更低价的模型重试',
      failSwitchedLowCost: '已切换到 {model}，按标价收费。请重新发送消息以继续。',
      failSwitchedLowCostSent: '已切换到 {model}，按标价收费，并重新发送了你的消息。可随时在模型选择器中更换模型。',
      failTopUp: '充值',
      failUseFree: '改用免费模型重试',
      failSwitching: '正在切换…',
      failSwitchedSent: '已切换到 {model}（免费）并重新发送了你的消息。可随时在模型选择器中更换模型。',
      failSwitched: '已切换到 {model}（免费）。请重新发送消息以继续。',
      failSwitchFailed: '无法切换模型：{message}',
      failSignIn: '重新登录',
      failSigningIn: '正在等待浏览器…',
      failSignedIn: '已登录。',
      failSignInFailed: '登录未完成：{message}',
      failRetry: '重新发送',
      failSent: '已重新发送。',
      failSendFailed: '发送失败：{message}',
      failBusyHint: 'unoblox 当前繁忙。请稍候再重新发送。',
      failServerHint: 'unoblox 未能完成此请求。你的密钥没有问题，请重试。'
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
        ...(billing === undefined ? {} : {
          balanceInr: billing.balanceInr,
          ...(typeof billing.note === 'string' ? { note: billing.note } : {}),
          ...(typeof billing.balanceRequirementInr === 'number' ? { balanceRequirementInr: billing.balanceRequirementInr } : {})
        }),
        ...(model === undefined ? {} : { model, ...(typeof routing.reason === 'string' ? { reason: routing.reason } : {}) }),
        freeModels: Array.isArray(body.freeModels) ? body.freeModels.filter((id) => typeof id === 'string' && id !== '') : [],
        lowCostModels: Array.isArray(body.lowCostModels) ? body.lowCostModels.filter((id) => typeof id === 'string' && id !== '') : []
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

    // ---------- refused turns ----------

    // When unoblox refuses a turn, the stock error row shows its sentence.
    // These actions sit under it: top up or retry on a free model after a
    // balance or spending-limit refusal (every 402), sign in again after a
    // revoked key, send again when unoblox was busy. Nothing switches models
    // or resends without a click.
    const UNOBLOX_PROVIDER = 'unoblox'
    const TOP_UP_URL = 'https://unoblox.ai/user/credits/topup'
    // The free models come from /v1/models (`freemium`) through the info
    // route; the first one the picker accepts is used. These stand in when
    // the route has none (an offline first launch). `unoblox/auto` and
    // `unoblox/free` are left out: they can be refused at ₹0.
    const FREE_MODELS = ['qwen/qwen3.8-27b', 'google/gemma-4-26b-a4b-it']
    // The cheapest models by listed price come the same way (lowCostModels);
    // these stand in without a catalog (cheapest on 2026-10-20).
    const LOW_COST_MODELS = ['openai/gpt-oss-20b', 'google/gemma-4-26b-a4b-it']
    const REQUEST_KEY = 'desktop-unoblox-request'

    function turnNumber(location) {
      return location?.kind === 'turn' || location?.kind === 'step' ? location.turn?.turn : undefined
    }

    /** The words the user sent, or undefined when the message also carried files or images. */
    function requestText(content) {
      if (!Array.isArray(content) || content.length === 0) return undefined
      if (!content.every((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string')) return undefined
      const text = content.map((block) => block.text).join('\n')
      return text.trim() === '' ? undefined : text
    }

    /**
     * The user's message that opened each turn, kept as turn data so "Send
     * again" can repeat it. Only the first user message of a turn publishes,
     * since turn data has one owner; later ones (steering) are ignored.
     */
    const requestDefinition = {
      kind: REQUEST_KEY,
      match: (event) => event.type === 'user/message' && event.surfaceOp === 'append' && event.data?.source?.kind === 'user'
        ? { id: String(event.data.id), role: 'start' }
        : null,
      start: (_context, match, reader) => {
        const turn = turnNumber(match.location)
        const earlier = reader?.previous(REQUEST_KEY)?.state
        return { turn, first: turn !== undefined && earlier?.turn !== turn, text: requestText(match.event.data.content) }
      },
      update: (context) => context.state,
      buildLocationData: (context, scope, previous) => {
        const state = context.state
        if (scope !== 'turn' || state === undefined || !state.first || state.turn === undefined) return null
        if (previous?.kind === 'turn' && previous.turn === state.turn && previous.value === state) return previous
        return { kind: 'turn', turn: state.turn, key: REQUEST_KEY, value: state }
      }
    }

    /**
     * Which refusal ended the turn: 'balance' for any 402 (see the
     * dsh-llm-pi-ai patch), or 'auth' / 'busy' / 'server' when the message
     * carries an unoblox code. Other failures keep only the stock row.
     */
    function refusalOf(reason) {
      if (!isRecord(reason) || reason.kind !== 'error' || !isRecord(reason.error)) return undefined
      const { code, message } = reason.error
      if (code === 'UNOBLOX_BALANCE') return 'balance'
      if (typeof message !== 'string' || !/\(UB-[A-Z]+-\d+\)$/u.test(message)) return undefined
      if (code === 'AUTH') return 'auth'
      if (code === 'RATE_LIMIT') return 'busy'
      if (code === 'SERVER') return 'server'
      return undefined
    }

    function errorText(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /** Whether this build can sign in with unoblox (the desktop bridge says so). */
    function useSignInAvailable(wanted) {
      const [available, setAvailable] = useState(false)
      useEffect(() => {
        const bridge = typeof window === 'undefined' ? undefined : window.dshDesktop
        if (!wanted || typeof bridge?.unobloxSignIn !== 'function' || typeof bridge.unobloxSignInAvailable !== 'function') return undefined
        let live = true
        bridge.unobloxSignInAvailable().then((value) => { if (live) setAvailable(value === true) }, () => {})
        return () => { live = false }
      }, [wanted])
      return available
    }

    /**
     * unoblox's freemium models are charged ₹0 while the balance is at least
     * a threshold (₹1000); below it they are charged at listed prices, like
     * any model. So the free-model retry is offered only at or above it;
     * below it, with some balance left, a retry on one of the cheapest models
     * (charged at its listed price) may still fit. Reads the figures from the
     * refusal itself, else from the balance unoblox last reported. Unknown
     * balance: neither is offered.
     */
    const DEFAULT_FREE_HOLD_INR = 1000
    function parseRupees(text) {
      const value = Number(String(text).replace(/,/gu, ''))
      return Number.isFinite(value) ? value : undefined
    }
    function freeAllowance(message, billing) {
      const said = typeof message === 'string' ? message : ''
      const balance = parseRupees(/your balance ₹\s?([\d,]+(?:\.\d+)?)/iu.exec(said)?.[1] ?? NaN) ?? billing?.balanceInr
      const requirement = parseRupees(/needs a ₹\s?([\d,]+(?:\.\d+)?) balance held/iu.exec(said)?.[1] ?? NaN) ?? billing?.balanceRequirementInr ?? DEFAULT_FREE_HOLD_INR
      return {
        canUseFree: balance !== undefined && balance >= requirement,
        canUseLowCost: balance !== undefined && balance > 0 && balance < requirement,
        requirement,
        ...(balance === undefined ? {} : { balance })
      }
    }
    function useFreeAllowance(message, loadBilling) {
      const fromMessage = freeAllowance(message, undefined)
      const needsBilling = message !== undefined && /your balance ₹/iu.test(message) === false
      const [billing, setBilling] = useState(undefined)
      useEffect(() => {
        if (!needsBilling || typeof loadBilling !== 'function') return undefined
        let live = true
        loadBilling().then((view) => { if (live && view?.balanceInr !== undefined) setBilling(view) })
        return () => { live = false }
      }, [needsBilling, loadBilling])
      return needsBilling ? freeAllowance(message, billing) : fromMessage
    }

    function RefusedTurnActions(props) {
      const { turn, t, sendText, selectFreeModel, selectLowCostModel, loadBilling } = props
      const refusal = refusalOf(turn?.end?.data?.reason)
      const allowance = useFreeAllowance(refusal === 'balance' ? turn?.end?.data?.reason?.error?.message : undefined, loadBilling)
      const request = turn?.data?.get(REQUEST_KEY)?.text
      const [working, setWorking] = useState(undefined)
      const [status, setStatus] = useState(undefined)
      const [signedIn, setSignedIn] = useState(false)
      // Once the message went out again, only the outcome stays.
      const [resent, setResent] = useState(false)
      const canSignIn = useSignInAvailable(refusal === 'auth')
      if (refusal === undefined || (refusal === 'auth' && !canSignIn)) return null

      const run = (name, task) => {
        if (working !== undefined) return
        setWorking(name)
        setStatus(undefined)
        task().then(
          (next) => { setStatus(next) },
          (error) => { setStatus({ tone: 'error', text: errorText(error) }) }
        ).finally(() => { setWorking(undefined) })
      }
      const sendAgain = () => run('send', async () => {
        try {
          await sendText(request)
        } catch (error) {
          return { tone: 'error', text: t('failSendFailed', { message: errorText(error) }) }
        }
        setResent(true)
        return { tone: 'ok', text: t('failSent') }
      })
      // Switch (free or lower-cost), then send the message again.
      const switchAndResend = (name, select, switched, switchedSent) => run(name, async () => {
        let model
        try {
          model = await select()
        } catch (error) {
          return { tone: 'error', text: t('failSwitchFailed', { message: errorText(error) }) }
        }
        if (request === undefined) return { tone: 'ok', text: t(switched, { model: shortModel(model) }) }
        try {
          await sendText(request)
        } catch (error) {
          return { tone: 'error', text: t('failSendFailed', { message: errorText(error) }) }
        }
        setResent(true)
        return { tone: 'ok', text: t(switchedSent, { model: shortModel(model) }) }
      })
      const useFree = () => switchAndResend('free', selectFreeModel, 'failSwitched', 'failSwitchedSent')
      const useLowCost = () => switchAndResend('low-cost', selectLowCostModel, 'failSwitchedLowCost', 'failSwitchedLowCostSent')
      const signIn = () => run('sign-in', async () => {
        const result = await window.dshDesktop.unobloxSignIn()
        if (result?.ok === true) {
          setSignedIn(true)
          return { tone: 'ok', text: t('failSignedIn') }
        }
        // Closing the browser or pressing Cancel is not an error to report.
        if (result?.code === 'cancelled') return undefined
        return { tone: 'error', text: t('failSignInFailed', { message: typeof result?.message === 'string' ? result.message : '' }) }
      })

      const button = (key, label, onClick, primary) => h('button', {
        key,
        type: 'button',
        className: primary ? 'dshUbxFailBtn dshUbxFailPrimary' : 'dshUbxFailBtn',
        disabled: working !== undefined,
        onClick
      }, label)
      const children = []
      if (resent) {
        // Nothing left to do here.
      } else if (refusal === 'balance') {
        if (allowance.canUseFree) {
          children.push(h('span', { key: 'hint', className: 'dshUbxFailHint' }, t('failBalanceHint', { amount: formatInr(allowance.requirement) })))
          children.push(button('free', working === 'free' ? t('failSwitching') : t('failUseFree'), useFree, true))
        } else if (allowance.canUseLowCost && typeof selectLowCostModel === 'function') {
          children.push(h('span', { key: 'hint', className: 'dshUbxFailHint' }, t('failLowCostHint', { amount: formatInr(allowance.requirement), balance: formatInr(allowance.balance) })))
          children.push(button('low-cost', working === 'low-cost' ? t('failSwitching') : t('failUseLowCost'), useLowCost, true))
        } else {
          children.push(h('span', { key: 'hint', className: 'dshUbxFailHint' }, t('failFreeNeedsHold', { amount: formatInr(allowance.requirement) })))
        }
        // Opens in the system browser through the window-open handler.
        children.push(h('a', { key: 'top-up', className: 'dshUbxFailBtn', href: TOP_UP_URL, target: '_blank', rel: 'noopener noreferrer' }, t('failTopUp')))
      } else if (refusal === 'auth') {
        if (!signedIn) children.push(button('sign-in', working === 'sign-in' ? t('failSigningIn') : t('failSignIn'), signIn, true))
        else if (request !== undefined) children.push(button('send', t('failRetry'), sendAgain, true))
      } else {
        children.push(h('span', { key: 'hint', className: 'dshUbxFailHint' }, t(refusal === 'busy' ? 'failBusyHint' : 'failServerHint')))
        if (request !== undefined) children.push(button('send', t('failRetry'), sendAgain, false))
      }
      if (status !== undefined) {
        children.push(h('span', { key: 'status', className: 'dshUbxFailStatus', role: 'status', 'data-tone': status.tone }, status.text))
      }
      return h('div', { className: 'dshUbxFail', 'data-unoblox-refusal': refusal }, ...children)
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
      const service = createInfoService()
      ctx.inject(['slots', 'locale'], (scope) => {
        installStyles()
        scope.effect(() => scope.locale.register(NS, { zh, en }))
        // After the stock stats pills (0) and the PPT chooser (20).
        scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-desktop-unoblox-info',
          order: 30,
          locale: NS,
          inject: () => ({ service })
        }, UnobloxInfoDock))
      })
      /**
       * Select the first model of a launch list (from the info route, else
       * the stand-in list) that the picker accepts, skipping the model the
       * conversation already uses: retrying on it would be refused again.
       */
      const selectFirst = async (sessionId, listKey, fallback, none) => {
        const directories = ctx.get('modelDirectories')
        if (!directories) throw new Error('model selection is not available')
        const directory = directories.directoryFor(sessionId)
        const listed = await service.load(sessionId).then((view) => view[listKey], () => [])
        let current
        try {
          current = directory.store?.getSnapshot?.().current?.model
        } catch {
          current = undefined
        }
        let refused
        for (const model of (listed.length > 0 ? listed : fallback).filter((id) => id !== current)) {
          const result = await directory.select({ provider: UNOBLOX_PROVIDER, model })
          if (result?.ok === true) return model
          refused = result?.error
        }
        throw new Error(typeof refused?.message === 'string' ? refused.message : none)
      }
      ctx.inject(['slots', 'locale', 'uiConversation'], (scope) => {
        scope.uiConversation.events.register(requestDefinition)
        scope.slots.inject('conversation.chat.turnTail', () => scope.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'dsh-desktop-unoblox-refusal',
          locale: NS,
          inject: (sessionId) => ({
            // As the user's next message in this conversation.
            sendText: (text) => {
              const conversation = ctx.get('sessions')?.scope(sessionId)?.get('conversation')
              if (!conversation || typeof conversation.send !== 'function') throw new Error('the conversation is not available')
              return conversation.send(text)
            },
            // The balance unoblox last reported, for which retry can serve.
            loadBilling: () => service.load(sessionId).then((view) => view, () => undefined),
            // Through the picker's own directory, so the composer shows the change.
            selectFreeModel: () => selectFirst(sessionId, 'freeModels', FREE_MODELS, 'no free model is available'),
            selectLowCostModel: () => selectFirst(sessionId, 'lowCostModels', LOW_COST_MODELS, 'no lower-cost model than the current one is available')
          })
        }, RefusedTurnActions))
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
    exports.RefusedTurnActions = RefusedTurnActions
    exports.requestDefinition = requestDefinition
    exports.refusalOf = refusalOf
    exports.requestText = requestText
    exports.FREE_MODELS = FREE_MODELS
    exports.LOW_COST_MODELS = LOW_COST_MODELS
    exports.freeAllowance = freeAllowance
    exports.locales = { en, zh }
    return module.exports
  }
})
