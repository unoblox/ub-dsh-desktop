window.__ModuleLoader__.load({
  id: 'dsh-desktop-unoblox-settings',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React
    const { Button, IconRightUpOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    const NS = 'desktop-unoblox-settings'
    // Served by dsh-desktop-unoblox-info; same origin, behind the Harness session cookie.
    const USAGE_ROUTE = '/api/desktop-unoblox.usage'
    const BUDGET_ROUTE = '/api/desktop-unoblox.budget'
    // The budget store's key for the default task budget (dsh-desktop-unoblox-info).
    const DEFAULT_BUDGET = '*'
    const MAX_BUDGET_INR = 100_000
    // Below this balance freemium models are charged at listed prices; unoblox
    // reports the live figure (balance_requirement_inr) with each charge.
    const DEFAULT_FREE_HOLD_INR = 1000
    const DAYS = 30
    // Pages on unoblox.ai (each checked to exist; there is no separate top-up
    // or invoices page: both live on Credits).
    const SITE = 'https://unoblox.ai'
    const LINKS = {
      usage: `${SITE}/user/usage`,
      credits: `${SITE}/user/credits`,
      pricing: `${SITE}/pricing`,
      keys: `${SITE}/user/keys`,
      account: `${SITE}/user/settings`,
      activity: `${SITE}/user/activity`
    }
    const STYLE_ID = 'dsh-desktop-unoblox-settings-style'
    // Card tokens are the stock settings sections' (ui-settings-account).
    const STYLE = `
      .dshUbxSet{display:flex;flex-direction:column;gap:16px;padding:8px 0;font-size:13px;line-height:22px;color:var(--dsw-alias-label-primary)}
      .dshUbxSetCard{display:flex;flex-direction:column;gap:8px;padding:12px 16px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl,12px);background:var(--dsw-alias-settings-card-fill)}
      .dshUbxSetTitle{margin:0;font-size:14px;font-weight:590;line-height:22px}
      .dshUbxSetRow{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:32px}
      .dshUbxSetRow>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dshUbxSetDivider{border-top:.5px solid var(--dsw-alias-border-l2)}
      .dshUbxSetMuted{color:var(--dsw-alias-label-secondary)}
      .dshUbxSetNote{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
      .dshUbxSetNote[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
      .dshUbxSetNote[data-tone=warning]{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-primary))}
      .dshUbxSetAmount{font-size:18px;font-weight:510;line-height:28px;font-variant-numeric:tabular-nums}
      .dshUbxSetNum{font-variant-numeric:tabular-nums;white-space:nowrap}
      .dshUbxSetTiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      .dshUbxSetTile{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-settings-card-fill)}
      .dshUbxSetTile span:first-child{font-size:12px;color:var(--dsw-alias-label-secondary)}
      .dshUbxSetActions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
      .dshUbxSetLink{display:inline-flex;align-items:center;gap:4px;padding:3px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-primary);text-decoration:none;white-space:nowrap}
      .dshUbxSetLink:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .dshUbxSetLink:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dshUbxSetLinkPrimary{border-color:transparent;background:#D9A64A;color:#18191c;font-weight:600}
      .dshUbxSetLinkPrimary:hover{background:#cf9a3c}
      .dshUbxSetChart{display:flex;flex-direction:column;gap:4px}
      .dshUbxSetReadout{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
      .dshUbxSetBars{position:relative;display:flex;align-items:flex-end;gap:2px;height:96px;border-bottom:1px solid var(--dsw-alias-border-l2)}
      .dshUbxSetBar{flex:1 1 0;min-width:0;height:100%;display:flex;align-items:flex-end;cursor:default}
      .dshUbxSetBar>span{display:block;width:100%;border-radius:4px 4px 0 0;background:var(--dsw-alias-brand-primary);opacity:.85}
      .dshUbxSetBar[data-active=true]>span{opacity:1}
      .dshUbxSetBar:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dshUbxSetAxis{display:flex;justify-content:space-between;font-size:11px;color:var(--dsw-alias-label-tertiary)}
      .dshUbxSetList{display:flex;flex-direction:column}
      .dshUbxSetList .dshUbxSetRow{min-height:30px}
      .dshUbxSetBudget{display:flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-secondary)}
      .dshUbxSetBudget:focus-within{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
      .dshUbxSetBudget input{width:96px;border:0;outline:none;background:none;font:inherit;font-size:14px;color:var(--dsw-alias-label-primary)}
      .dshUbxSetTable{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
      .dshUbxSetTable td,.dshUbxSetTable th{padding:2px 0;text-align:left;font-weight:400}
      .dshUbxSetTable td:last-child,.dshUbxSetTable th:last-child{text-align:right}
      .dshUbxSet details summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
    `

    const en = {
      usageNav: 'Usage',
      // Short enough for the settings nav column; the tab covers payments too.
      billingNav: 'Billing',
      accountNav: 'unoblox account',
      loading: 'Loading…',
      loadFailed: 'Could not load usage: {message}',
      today: 'Today',
      week: 'Last 7 days',
      month: 'Last 30 days',
      daily: 'Spend per day',
      dailyTotal: '{amount} over {days} days',
      dayReadout: '{day}: {amount} · {steps} steps',
      chartLabel: 'Spend per day for the last {days} days; the highest day is {amount}.',
      showTable: 'Show as table',
      day: 'Day',
      spend: 'Spend',
      byModel: 'By model',
      byConversation: 'By conversation',
      steps: '{count} steps',
      untitled: 'Conversation {id}',
      unknownModel: 'Model not reported',
      nothingYet: 'No charges recorded on this computer in the last {days} days.',
      thisComputer: 'This computer only, from the charge unoblox reports with each reply. Every device and the exact bill are on unoblox.ai.',
      estimated: 'Some charges are estimates; unoblox settles the exact amount on its side.',
      allDevices: 'All devices on unoblox.ai',
      balance: 'Balance',
      balanceAt: 'as of {time}',
      balanceUnknown: 'Shown after your first reply',
      balanceHint: 'unoblox reports the balance with each reply; there is no balance API to ask in between.',
      freeOn: 'Free models cost ₹0: your balance is at least {amount}.',
      freeOff: 'Your balance is below {amount}, so every model, free ones included, is charged at its listed price while your wallet can pay.',
      freeRule: 'Free models cost ₹0 while your balance is {amount} or more; below that every model is charged at its listed price.',
      topUp: 'Top up',
      history: 'Payment history',
      pricing: 'Pricing',
      paymentsNote: 'Payments are made on unoblox.ai; this app never sees card or bank details.',
      defaultBudget: 'Default task budget',
      defaultBudgetHint: 'Each task stops and asks before it would spend more than this. Applies to conversations that do not set their own budget.',
      defaultBudgetNone: 'None',
      budgetSave: 'Save',
      budgetRemove: 'Remove',
      budgetInvalid: 'Enter an amount between ₹0.01 and ₹{max}.',
      budgetSaved: 'Saved.',
      budgetRemoved: 'Removed.',
      budgetFailed: 'Could not save the budget: {message}',
      key: 'API key',
      keySet: 'Stored on this computer',
      keyMissing: 'No key yet',
      keyUnknown: 'Not known',
      keyHint: 'The key stays in this computer\'s credential store. It is never shown to the page or sent anywhere but api.unoblox.ai.',
      signIn: 'Sign in with unoblox',
      signInAgain: 'Sign in again',
      signingIn: 'Waiting for the browser…',
      signedIn: 'Signed in. A key for this computer is stored.',
      signInFailed: 'Sign-in did not finish: {message}',
      signOut: 'Sign out',
      signedOut: 'Signed out. The key was removed from this computer.',
      signOutFailed: 'Could not sign out: {message}',
      noBridge: 'Sign in from the unoblox works desktop app, or add a key in Settings › Models.',
      manageKeys: 'API keys',
      accountSettings: 'Account settings',
      activity: 'Sign-in activity',
      refresh: 'Refresh'
    }
    const zh = {
      usageNav: '用量',
      billingNav: '账单',
      accountNav: 'unoblox 账户',
      loading: '正在加载…',
      loadFailed: '无法加载用量：{message}',
      today: '今天',
      week: '最近 7 天',
      month: '最近 30 天',
      daily: '每日花费',
      dailyTotal: '{days} 天共 {amount}',
      dayReadout: '{day}：{amount} · {steps} 步',
      chartLabel: '最近 {days} 天的每日花费；最高一天为 {amount}。',
      showTable: '以表格显示',
      day: '日期',
      spend: '花费',
      byModel: '按模型',
      byConversation: '按对话',
      steps: '{count} 步',
      untitled: '对话 {id}',
      unknownModel: '未报告模型',
      nothingYet: '最近 {days} 天这台电脑没有记录到扣费。',
      thisComputer: '仅统计这台电脑，依据 unoblox 每次回复报告的扣费。所有设备和准确账单请在 unoblox.ai 查看。',
      estimated: '部分扣费为估算值，准确金额以 unoblox 结算为准。',
      allDevices: '在 unoblox.ai 查看所有设备',
      balance: '余额',
      balanceAt: '截至 {time}',
      balanceUnknown: '首次回复后显示',
      balanceHint: 'unoblox 随每次回复报告余额，没有可单独查询余额的接口。',
      freeOn: '免费模型不收费：你的余额不低于 {amount}。',
      freeOff: '你的余额低于 {amount}，所有模型（包括免费模型）都按标价收费，只要钱包余额足够即可继续使用。',
      freeRule: '余额不低于 {amount} 时免费模型不收费；低于此金额时所有模型按标价收费。',
      topUp: '充值',
      history: '付款记录',
      pricing: '价格',
      paymentsNote: '付款在 unoblox.ai 完成，本应用不会接触银行卡或银行信息。',
      defaultBudget: '默认任务预算',
      defaultBudgetHint: '每个任务在花费将超过此金额前停止并询问你。适用于没有单独设置预算的对话。',
      defaultBudgetNone: '无',
      budgetSave: '保存',
      budgetRemove: '移除',
      budgetInvalid: '请输入 ₹0.01 到 ₹{max} 之间的金额。',
      budgetSaved: '已保存。',
      budgetRemoved: '已移除。',
      budgetFailed: '无法保存预算：{message}',
      key: 'API 密钥',
      keySet: '已保存在这台电脑',
      keyMissing: '尚未添加密钥',
      keyUnknown: '未知',
      keyHint: '密钥保存在这台电脑的凭据存储中，不会显示给页面，也只发送到 api.unoblox.ai。',
      signIn: '使用 unoblox 登录',
      signInAgain: '重新登录',
      signingIn: '正在等待浏览器…',
      signedIn: '已登录，这台电脑的密钥已保存。',
      signInFailed: '登录未完成：{message}',
      signOut: '退出登录',
      signedOut: '已退出登录，密钥已从这台电脑移除。',
      signOutFailed: '无法退出登录：{message}',
      noBridge: '请在 unoblox works 桌面应用中登录，或在 设置 › 模型 中添加密钥。',
      manageKeys: 'API 密钥',
      accountSettings: '账户设置',
      activity: '登录记录',
      refresh: '刷新'
    }

    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }
    function finite(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined
    }
    function errorText(error) {
      return error instanceof Error ? error.message : String(error)
    }

    const RUPEES = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    function formatInr(amount) {
      return `₹${RUPEES.format(amount)}`
    }

    /** `YYYY-MM-DD` as a short local date ("21 Oct"). */
    function formatDay(day) {
      const [year, month, date] = day.split('-').map(Number)
      return new Date(year, month - 1, date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    }

    /** The usage route's body, checked; undefined when it is not one. */
    function toUsage(body) {
      if (!isRecord(body) || !Array.isArray(body.days)) return undefined
      const rows = (list, keyName) => (Array.isArray(list) ? list : []).filter((row) => isRecord(row) && typeof row[keyName] === 'string' && finite(row.inr) !== undefined)
      const billing = isRecord(body.billing) && finite(body.billing.balanceInr) !== undefined ? body.billing : undefined
      const last = isRecord(body.lastBalance) && finite(body.lastBalance.inr) !== undefined ? body.lastBalance : undefined
      return {
        todayInr: finite(body.todayInr) ?? 0,
        weekInr: finite(body.weekInr) ?? 0,
        monthInr: finite(body.monthInr) ?? 0,
        estimated: body.estimated === true,
        days: body.days.filter((row) => isRecord(row) && typeof row.day === 'string' && finite(row.inr) !== undefined),
        byModel: rows(body.byModel, 'model'),
        byConversation: rows(body.byConversation, 'session'),
        key: body.key === 'set' || body.key === 'missing' ? body.key : 'unknown',
        // This run's latest report, else the last one recorded on this computer.
        balanceInr: billing?.balanceInr ?? last?.inr,
        balanceAt: billing === undefined ? finite(last?.at) : undefined,
        requirementInr: finite(billing?.balanceRequirementInr) ?? DEFAULT_FREE_HOLD_INR,
        defaultBudgetInr: finite(body.defaultBudgetInr)
      }
    }

    function createSettingsService(doFetch = (...args) => fetch(...args)) {
      return {
        async load(signal) {
          const offset = new Date().getTimezoneOffset()
          const response = await doFetch(`${USAGE_ROUTE}?days=${String(DAYS)}&offset=${String(offset)}`, { credentials: 'same-origin', cache: 'no-store', signal })
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          const usage = toUsage(await response.json())
          if (usage === undefined) throw new Error('unexpected response shape')
          return usage
        },
        async setDefaultBudget(budgetInr) {
          const response = await doFetch(BUDGET_ROUTE, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: DEFAULT_BUDGET, budgetInr })
          })
          let body
          try { body = await response.json() } catch { body = undefined }
          if (!response.ok) throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${String(response.status)}`)
        }
      }
    }

    /** Load on mount; a newer load aborts the older one, and a failed one keeps the last view. */
    function useUsage(service) {
      const [state, setState] = useState({ usage: undefined, error: undefined })
      const controller = useRef(undefined)
      const reload = useCallback(() => {
        controller.current?.abort()
        const current = new AbortController()
        controller.current = current
        service.load(current.signal).then(
          (usage) => { if (!current.signal.aborted) setState({ usage, error: undefined }) },
          (error) => { if (!current.signal.aborted) setState((previous) => ({ usage: previous.usage, error: errorText(error) })) }
        )
      }, [service])
      useEffect(() => {
        reload()
        return () => controller.current?.abort()
      }, [reload])
      return [state, reload]
    }

    function ExternalLink({ href, label, primary }) {
      return h('a', { className: primary ? 'dshUbxSetLink dshUbxSetLinkPrimary' : 'dshUbxSetLink', href, target: '_blank', rel: 'noopener noreferrer' },
        label, primary ? null : h(IconRightUpOutlineRegular, { size: 12 }))
    }

    function Status({ t, state }) {
      if (state.usage !== undefined && state.error === undefined) return null
      return h('p', { className: 'dshUbxSetNote', role: 'status', 'data-tone': state.error === undefined ? undefined : 'error' },
        state.error === undefined ? t('loading') : t('loadFailed', { message: state.error }))
    }

    // ---------- Usage ----------

    /** One bar per day; hovering or focusing a bar shows its figures in the readout above. */
    function DailyChart({ t, days }) {
      const [active, setActive] = useState(undefined)
      const max = days.reduce((top, row) => Math.max(top, row.inr), 0)
      const total = days.reduce((sum, row) => sum + row.inr, 0)
      const shown = active === undefined ? undefined : days[active]
      return h('div', { className: 'dshUbxSetChart' },
        h('div', { className: 'dshUbxSetReadout', 'aria-live': 'polite' },
          h('span', null, shown === undefined
            ? t('dailyTotal', { amount: formatInr(total), days: String(days.length) })
            : t('dayReadout', { day: formatDay(shown.day), amount: formatInr(shown.inr), steps: String(shown.steps ?? 0) })),
          h('span', null, max > 0 ? formatInr(max) : '')),
        h('div', { className: 'dshUbxSetBars', role: 'img', 'aria-label': t('chartLabel', { days: String(days.length), amount: formatInr(max) }), onMouseLeave: () => setActive(undefined) },
          days.map((row, index) => h('div', {
            key: row.day,
            className: 'dshUbxSetBar',
            'data-active': active === index,
            tabIndex: 0,
            'aria-label': t('dayReadout', { day: formatDay(row.day), amount: formatInr(row.inr), steps: String(row.steps ?? 0) }),
            onMouseEnter: () => setActive(index),
            onFocus: () => setActive(index),
            onBlur: () => setActive(undefined)
          }, h('span', { style: { height: max > 0 && row.inr > 0 ? `${String(Math.max(3, (row.inr / max) * 100))}%` : '0' } })))),
        days.length === 0 ? null : h('div', { className: 'dshUbxSetAxis', 'aria-hidden': true },
          h('span', null, formatDay(days[0].day)), h('span', null, formatDay(days[days.length - 1].day))),
        h('details', null,
          h('summary', null, t('showTable')),
          h('table', { className: 'dshUbxSetTable' },
            h('thead', null, h('tr', null, h('th', null, t('day')), h('th', null, t('spend')))),
            h('tbody', null, days.filter((row) => row.steps > 0).map((row) => h('tr', { key: row.day }, h('td', null, formatDay(row.day)), h('td', null, formatInr(row.inr))))))))
    }

    function BreakdownList({ t, title, rows, label }) {
      if (rows.length === 0) return null
      return h('div', { className: 'dshUbxSetCard' },
        h('h3', { className: 'dshUbxSetTitle' }, title),
        h('div', { className: 'dshUbxSetList' }, rows.map((row, index) => h(React.Fragment, { key: index },
          index === 0 ? null : h('div', { className: 'dshUbxSetDivider' }),
          h('div', { className: 'dshUbxSetRow' },
            h('span', { title: label(row) }, label(row)),
            h('span', { className: 'dshUbxSetNum' },
              h('span', { className: 'dshUbxSetMuted' }, `${t('steps', { count: String(row.steps ?? 0) })} · `),
              formatInr(row.inr)))))))
    }

    function UsageSection(props) {
      const { t, service } = props
      const [state] = useUsage(service)
      const usage = state.usage
      return h('section', { className: 'dshUbxSet', 'aria-label': t('usageNav') },
        h(Status, { t, state }),
        usage === undefined ? null : h(React.Fragment, null,
          h('div', { className: 'dshUbxSetTiles' },
            [['today', usage.todayInr], ['week', usage.weekInr], ['month', usage.monthInr]].map(([key, amount]) => h('div', { key, className: 'dshUbxSetTile' },
              h('span', null, t(key)), h('span', { className: 'dshUbxSetAmount' }, formatInr(amount))))),
          h('div', { className: 'dshUbxSetCard' },
            h('h3', { className: 'dshUbxSetTitle' }, t('daily')),
            usage.days.some((row) => row.steps > 0)
              ? h(DailyChart, { t, days: usage.days })
              : h('p', { className: 'dshUbxSetNote' }, t('nothingYet', { days: String(DAYS) }))),
          h(BreakdownList, { t, title: t('byModel'), rows: usage.byModel, label: (row) => row.model === 'unknown' ? t('unknownModel') : row.model }),
          h(BreakdownList, { t, title: t('byConversation'), rows: usage.byConversation, label: (row) => row.title ?? t('untitled', { id: row.session.slice(0, 8) }) }),
          h('p', { className: 'dshUbxSetNote' }, t('thisComputer')),
          usage.estimated ? h('p', { className: 'dshUbxSetNote' }, t('estimated')) : null,
          h('div', { className: 'dshUbxSetActions' }, h(ExternalLink, { href: LINKS.usage, label: t('allDevices') }))))
    }

    // ---------- Billing & payments ----------

    function DefaultBudget({ t, service, current, onSaved }) {
      const [text, setText] = useState(current === undefined ? '' : String(current))
      const [status, setStatus] = useState(undefined)
      const [busy, setBusy] = useState(false)
      useEffect(() => { setText(current === undefined ? '' : String(current)) }, [current])
      const amount = Number(text.replace(/,/gu, ''))
      const valid = text.trim() !== '' && Number.isFinite(amount) && amount >= 0.01 && amount <= MAX_BUDGET_INR
      const save = async (budgetInr) => {
        setBusy(true)
        try {
          await service.setDefaultBudget(budgetInr)
          setStatus({ text: t(budgetInr === null ? 'budgetRemoved' : 'budgetSaved') })
          onSaved()
        } catch (error) {
          setStatus({ tone: 'error', text: t('budgetFailed', { message: errorText(error) }) })
        } finally {
          setBusy(false)
        }
      }
      return h('div', { className: 'dshUbxSetCard' },
        h('h3', { className: 'dshUbxSetTitle' }, t('defaultBudget')),
        h('p', { className: 'dshUbxSetNote' }, t('defaultBudgetHint')),
        h('form', {
          className: 'dshUbxSetActions',
          onSubmit: (event) => {
            event.preventDefault()
            if (valid) save(Math.round(amount * 100) / 100)
            else setStatus({ tone: 'error', text: t('budgetInvalid', { max: RUPEES.format(MAX_BUDGET_INR) }) })
          }
        },
        h('label', { className: 'dshUbxSetBudget' }, '₹', h('input', {
          inputMode: 'decimal',
          value: text,
          placeholder: current === undefined ? t('defaultBudgetNone') : '',
          'aria-label': t('defaultBudget'),
          'aria-invalid': text.trim() !== '' && !valid,
          onChange: (event) => { setText(event.target.value); setStatus(undefined) }
        })),
        h(Button, { type: 'submit', variant: 'primary', disabled: busy }, t('budgetSave')),
        current === undefined ? null : h(Button, { type: 'button', variant: 'outline', disabled: busy, onClick: () => save(null) }, t('budgetRemove'))),
        status === undefined ? null : h('p', { className: 'dshUbxSetNote', role: 'status', 'data-tone': status.tone }, status.text))
    }

    function BillingSection(props) {
      const { t, service } = props
      const [state, reload] = useUsage(service)
      const usage = state.usage
      const requirement = usage?.requirementInr ?? DEFAULT_FREE_HOLD_INR
      const balance = usage?.balanceInr
      const free = balance === undefined ? undefined : balance >= requirement
      return h('section', { className: 'dshUbxSet', 'aria-label': t('billingNav') },
        h(Status, { t, state }),
        h('div', { className: 'dshUbxSetCard' },
          h('div', { className: 'dshUbxSetRow' },
            h('span', null, t('balance')),
            balance === undefined
              ? h('span', { className: 'dshUbxSetMuted' }, usage === undefined ? t('loading') : t('balanceUnknown'))
              : h('span', { className: 'dshUbxSetAmount' }, formatInr(balance))),
          usage?.balanceAt === undefined ? null : h('p', { className: 'dshUbxSetNote' }, t('balanceAt', { time: new Date(usage.balanceAt).toLocaleString() })),
          h('p', { className: 'dshUbxSetNote', 'data-tone': free === false ? 'warning' : undefined },
            free === undefined ? t('freeRule', { amount: formatInr(requirement) }) : t(free ? 'freeOn' : 'freeOff', { amount: formatInr(requirement) })),
          balance === undefined ? h('p', { className: 'dshUbxSetNote' }, t('balanceHint')) : null,
          h('div', { className: 'dshUbxSetActions' },
            h(ExternalLink, { href: LINKS.credits, label: t('topUp'), primary: true }),
            h(ExternalLink, { href: LINKS.credits, label: t('history') }),
            h(ExternalLink, { href: LINKS.pricing, label: t('pricing') })),
          h('p', { className: 'dshUbxSetNote' }, t('paymentsNote'))),
        usage === undefined ? null : h(DefaultBudget, { t, service, current: usage.defaultBudgetInr, onSaved: reload }))
    }

    // ---------- unoblox account ----------

    function desktopBridge() {
      const bridge = typeof window === 'undefined' ? undefined : window.dshDesktop
      return typeof bridge?.unobloxSignIn === 'function' && typeof bridge.unobloxSignOut === 'function' ? bridge : undefined
    }

    function AccountSection(props) {
      const { t, service } = props
      const [state, reload] = useUsage(service)
      const [working, setWorking] = useState(undefined)
      const [status, setStatus] = useState(undefined)
      const bridge = desktopBridge()
      const key = state.usage?.key
      const run = (name, action) => {
        setWorking(name)
        setStatus(undefined)
        Promise.resolve().then(action).then(
          (next) => setStatus(next),
          (error) => setStatus({ tone: 'error', text: t(name === 'sign-in' ? 'signInFailed' : 'signOutFailed', { message: errorText(error) }) })
        ).finally(() => {
          setWorking(undefined)
          reload()
        })
      }
      const signIn = () => run('sign-in', async () => {
        const result = await bridge.unobloxSignIn()
        if (result?.ok === true) return { text: t('signedIn') }
        // Closing the browser or pressing Cancel is not an error to report.
        if (result?.code === 'cancelled') return undefined
        return { tone: 'error', text: t('signInFailed', { message: typeof result?.message === 'string' ? result.message : '' }) }
      })
      // The main process asks the user to confirm; cancelling changes nothing.
      const signOut = () => run('sign-out', async () => {
        const result = await bridge.unobloxSignOut()
        return result?.signedOut === true ? { text: t('signedOut') } : undefined
      })
      return h('section', { className: 'dshUbxSet', 'aria-label': t('accountNav') },
        h(Status, { t, state }),
        h('div', { className: 'dshUbxSetCard' },
          h('div', { className: 'dshUbxSetRow' },
            h('span', null, t('key')),
            h('span', { className: 'dshUbxSetMuted', role: 'status' }, key === undefined ? t('loading') : t(key === 'set' ? 'keySet' : key === 'missing' ? 'keyMissing' : 'keyUnknown'))),
          h('p', { className: 'dshUbxSetNote' }, t('keyHint')),
          bridge === undefined
            ? h('p', { className: 'dshUbxSetNote' }, t('noBridge'))
            : h('div', { className: 'dshUbxSetActions' },
              h(Button, { type: 'button', variant: key === 'set' ? 'outline' : 'primary', disabled: working !== undefined, onClick: signIn },
                working === 'sign-in' ? t('signingIn') : t(key === 'set' ? 'signInAgain' : 'signIn')),
              key === 'set' ? h(Button, { type: 'button', variant: 'outline', disabled: working !== undefined, onClick: signOut }, t('signOut')) : null),
          status === undefined ? null : h('p', { className: 'dshUbxSetNote', role: 'status', 'data-tone': status.tone }, status.text)),
        h('div', { className: 'dshUbxSetActions' },
          h(ExternalLink, { href: LINKS.keys, label: t('manageKeys') }),
          h(ExternalLink, { href: LINKS.account, label: t('accountSettings') }),
          h(ExternalLink, { href: LINKS.activity, label: t('activity') })))
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

    // After the stock General (0), Models (10), Plugins (15) and Agent presets (20).
    const SECTIONS = [
      { id: 'unoblox-usage', order: 30, label: 'usageNav', component: UsageSection },
      { id: 'unoblox-billing', order: 31, label: 'billingNav', component: BillingSection },
      { id: 'unoblox-account', order: 32, label: 'accountNav', component: AccountSection }
    ]

    function apply(ctx) {
      const service = createSettingsService()
      ctx.inject(['slots', 'locale'], (scope) => {
        installStyles()
        scope.effect(() => scope.locale.register(NS, { zh, en }))
        const t = scope.locale.bind(NS)
        for (const section of SECTIONS) {
          scope.slots.inject('settings.section', () => scope.slots.register({
            name: 'settings.section',
            id: section.id,
            order: section.order,
            label: () => t(section.label),
            locale: NS,
            inject: () => ({ service })
          }, section.component))
        }
      })
    }

    const inject = []

    exports.apply = apply
    exports.inject = inject
    exports.createSettingsService = createSettingsService
    exports.toUsage = toUsage
    exports.formatDay = formatDay
    exports.UsageSection = UsageSection
    exports.BillingSection = BillingSection
    exports.AccountSection = AccountSection
    exports.DailyChart = DailyChart
    exports.SECTIONS = SECTIONS
    exports.LINKS = LINKS
    exports.locales = { en, zh }
    return module.exports
  }
})
