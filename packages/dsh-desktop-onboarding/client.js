window.__ModuleLoader__.load({
  id: 'dsh-desktop-onboarding',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React
    // Harness 0.2 renamed the 14px globe icon to IconGlobeOutlineRegular (sized
    // by prop). Rendering an undefined component threw and took the whole
    // first-run dialog down, so an icon missing from a later build is skipped.
    const { Button, Modal, IconGlobeOutlineRegular, IconLinkOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'desktop-onboarding'
    // Loader entry id of the host half in build/dsh-desktop.patch.yml; Harness
    // names each plugin's settings namespace after it.
    const SETTINGS_ENTRY_ID = 'dsh-desktop-onboarding'
    // Retained as the acknowledgement payload for settings compatibility.
    // Eligibility is install-scoped; changing this value never re-prompts.
    const WIZARD_VERSION = '2026-09-21.1'
    // Settings section the "configure a model" action opens.
    // Credential reference the `unoblox` llm-pi-ai route in
    // build/dsh-desktop.patch.yml names as its apiKeyEnv. The key itself only
    // ever goes to the Harness credential store, never into configuration.
    const UNOBLOX_KEY_REF = 'UNOBLOX_API_KEY'
    const UNOBLOX_KEYS_URL = 'https://unoblox.ai/docs/quickstart'

    // Settings owned by the notice. The host half (index.js) registered the
    // schema; the value object the mirror hands back has exactly this shape.
    const WIZARD_ACK_FIELD = 'wizardVersion'

    // Unoblox mark without its tile (build/brand/unoblox-mark.svg): the "u"
    // in currentColor so it follows the header text colour in both themes,
    // and the brand's gold dot.
    const BRAND_GOLD = '#D9A64A'
    const U_PATH = 'M288 360V563A124.5 124.5 0 0 0 537 563V360M537 360V736'
    const GLYPH_VIEWBOX = { x: 240, y: 360, width: 570, height: 402 }

    const STYLE_ID = 'dsh-desktop-onboarding-style'
    // Same dialog chrome as the stock welcome notice it replaces: a bounded
    // card whose body scrolls while the brand row and actions stay put.
    const STYLE = `
      .dshDeskOnbDialog{width:min(600px,100%);padding:0}
      .dshDeskOnbContent{box-sizing:border-box;display:flex;flex-direction:column;max-height:calc(100vh - 48px);padding:24px 28px}
      .dshDeskOnbHeader{flex:none;display:flex;align-items:center;gap:10px}
      .dshDeskOnbBrandMark{display:inline-flex;align-items:center;color:var(--dsw-alias-label-primary)}
      .dshDeskOnbBrandName{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);line-height:22px}
      .dshDeskOnbBrandBy{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:18px}
      .dshDeskOnbHeading{flex:none;color:var(--dsw-alias-label-primary);outline:none;margin:16px 0 0;font-size:20px;font-weight:500;line-height:28px}
      .dshDeskOnbBody{flex:1;min-height:0;margin-top:12px;overflow-y:auto}
      .dshDeskOnbParagraph{margin:0 0 10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
      .dshDeskOnbSubheading{margin:14px 0 6px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);line-height:20px}
      .dshDeskOnbLinkList{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 12px}
      .dshDeskOnbLinkChip{display:inline-flex;align-items:center;gap:6px;padding:5px 12px 5px 10px;border:1px solid var(--dsw-alias-border-secondary);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;text-decoration:none;transition:background .15s ease,border-color .15s ease}
      .dshDeskOnbLinkChip:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-primary,var(--dsw-alias-border-secondary))}
      .dshDeskOnbLinkChip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .dshDeskOnbLinkIcon{flex:none;display:inline-flex;color:var(--dsw-alias-label-secondary)}
      @media (prefers-reduced-motion:reduce){.dshDeskOnbLinkChip{transition:none}}
      .dshDeskOnbHint{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px}
      .dshDeskOnbActions{flex:none;display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
      .dshDeskOnbKey{flex:none;display:flex;flex-direction:column;gap:6px;margin-top:16px}
      .dshDeskOnbKeyLabel{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);line-height:20px}
      .dshDeskOnbKeyInput{box-sizing:border-box;width:100%;height:36px;padding:0 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
      .dshDeskOnbKeyInput:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
      .dshDeskOnbKeyInput:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dshDeskOnbKeyInput::placeholder{color:var(--dsw-alias-label-dimmed)}
      .dshDeskOnbKeyInput:disabled{opacity:.6}
      .dshDeskOnbKeyHint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
      .dshDeskOnbKeyHint a{color:var(--dsw-alias-brand-primary)}
      .dshDeskOnbKeyError{margin:0;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-state-error-primary)}
      @media (width<=560px){.dshDeskOnbContent{padding:20px}}
    `

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = 'dsh-desktop-onboarding'
      style.textContent = STYLE
      document.head.appendChild(style)
    }

    // ---------- locale dictionaries ----------

    const en = {
      // Product name: always lowercase (src/shared/brand.ts).
      brandName: 'unoblox works',
      brandBy: 'Beta',
      step0Title: 'Welcome to unoblox works',
      declarationBody: 'unoblox works runs AI agents on your computer. In the workspace folders you choose, they can read and write files, run commands, search the web, and create documents, spreadsheets and slides. You stay in control: risky actions ask for your approval first.\n\nModels are served through the Unoblox gateway. Pick Unoblox Auto to let the router choose the best-value model for each request, or choose a specific model per conversation. Usage is billed to your prepaid ₹ balance.',
      desktopIntroTitle: 'About unoblox works',
      desktopIntroBody: 'unoblox works is built on the open-source DeepSeek Harness and runs locally on Windows, macOS and Linux.',
      officialSite: 'unoblox.ai',
      officialSiteUrl: 'https://unoblox.ai/',
      docs: 'Docs',
      docsUrl: 'https://unoblox.ai/docs',
      desktopIntroFeedback: 'Questions or feedback? See the docs or reach us through unoblox.ai.',
      later: 'Not now',
      unobloxKeyLater: 'You can add the key later in Settings › Models. Until then, unoblox works asks again each time it starts.',
      unobloxKeyLabel: 'Connect Unoblox',
      unobloxKeyPlaceholder: 'ub-gw-…',
      unobloxKeyHint: 'Paste a workspace API key from the Unoblox developer portal (API Keys). Requests draw from your prepaid ₹ balance.',
      unobloxSearchPrivacy: 'Web search sends only the search query text to Unoblox, which runs it on Perplexity (United States). Nothing else from the session is sent, and Unoblox does not store queries. Each successful search is billed to your ₹ balance.',
      unobloxKeyLink: 'Get an API key',
      unobloxConnect: 'Connect and continue',
      unobloxConnecting: 'Connecting…',
      unobloxKeyRequired: 'Enter your Unoblox API key to continue, or choose Not now.',
      unobloxKeyFailed: 'The API key could not be saved: {message}'
    }

    const zh = {
      brandName: 'unoblox works',
      brandBy: '测试版',
      step0Title: '欢迎使用 unoblox works',
      declarationBody: 'unoblox works 在你的电脑上运行 AI 智能体。在你选择的工作区文件夹中，智能体可以读写文件、运行命令、搜索网页，并制作文档、表格和演示文稿。一切由你掌控：有风险的操作会先征求你的同意。\n\n模型通过 Unoblox 网关提供。选择 Unoblox Auto 可让路由为每个请求挑选性价比最高的模型，也可以为每个对话指定模型。用量从你的预付 ₹ 余额中扣费。',
      desktopIntroTitle: '关于 unoblox works',
      desktopIntroBody: 'unoblox works 基于开源的 DeepSeek Harness 构建，可在 Windows、macOS 和 Linux 上本地运行。',
      officialSite: 'unoblox.ai',
      officialSiteUrl: 'https://unoblox.ai/',
      docs: '文档',
      docsUrl: 'https://unoblox.ai/docs',
      desktopIntroFeedback: '有问题或建议？请查看文档，或通过 unoblox.ai 联系我们。',
      later: '暂不',
      unobloxKeyLater: '也可以稍后在“设置 › 模型”中添加。在此之前，unoblox works 每次启动都会再次询问。',
      unobloxKeyLabel: '接入 Unoblox',
      unobloxKeyPlaceholder: 'ub-gw-…',
      unobloxKeyHint: '粘贴在 Unoblox 开发者门户（API Keys）创建的工作区 API Key。请求按 token 从预付 ₹ 余额中扣费。',
      unobloxSearchPrivacy: '网页搜索仅将搜索词发送给 Unoblox，并由其交给 Perplexity（美国）执行。会话中的其他内容不会被发送，Unoblox 不保存搜索词。每次成功的搜索从 ₹ 余额中扣费。',
      unobloxKeyLink: '获取 API Key',
      unobloxConnect: '接入并继续',
      unobloxConnecting: '接入中…',
      unobloxKeyRequired: '请输入 Unoblox API Key 后继续，或选择“暂不”。',
      unobloxKeyFailed: 'API Key 保存失败：{message}'
    }

    // ---------- components ----------

    function BrandHeader({ t }) {
      const height = 16
      return React.createElement(
        'div',
        { className: 'dshDeskOnbHeader' },
        React.createElement(
          'span',
          { className: 'dshDeskOnbBrandMark', 'aria-hidden': 'true' },
          React.createElement(
            'svg',
            {
              width: height * GLYPH_VIEWBOX.width / GLYPH_VIEWBOX.height,
              height,
              viewBox: GLYPH_VIEWBOX.x + ' ' + GLYPH_VIEWBOX.y + ' ' + GLYPH_VIEWBOX.width + ' ' + GLYPH_VIEWBOX.height,
              fill: 'none'
            },
            React.createElement('path', { d: U_PATH, stroke: 'currentColor', strokeWidth: 96 }),
            React.createElement('circle', { cx: 720, cy: 672, r: 90, fill: BRAND_GOLD })
          )
        ),
        React.createElement('span', { className: 'dshDeskOnbBrandName' }, t('brandName')),
        React.createElement('span', { className: 'dshDeskOnbBrandBy' }, t('brandBy'))
      )
    }

    // What Unoblox does and how it bills, the attribution to DeepSeek Harness,
    // and the public links. External links open in the system browser via the
    // main process's window-open handler.
    function NoticeBody({ t }) {
      const paragraphs = t('declarationBody').split('\n\n')
      const links = [
        { label: t('officialSite'), href: t('officialSiteUrl'), icon: IconGlobeOutlineRegular },
        { label: t('docs'), href: t('docsUrl'), icon: IconLinkOutlineRegular }
      ]
      return React.createElement(
        'div',
        { className: 'dshDeskOnbBody' },
        paragraphs.map((paragraph, idx) =>
          React.createElement('p', { key: idx, className: 'dshDeskOnbParagraph' }, paragraph)
        ),
        React.createElement('h3', { className: 'dshDeskOnbSubheading' }, t('desktopIntroTitle')),
        React.createElement('p', { className: 'dshDeskOnbParagraph' }, t('desktopIntroBody')),
        React.createElement(
          'div',
          { className: 'dshDeskOnbLinkList' },
          links.map((link) =>
            React.createElement(
              'a',
              { key: link.href, className: 'dshDeskOnbLinkChip', href: link.href, target: '_blank', rel: 'noreferrer' },
              React.createElement(
                'span',
                { className: 'dshDeskOnbLinkIcon', 'aria-hidden': 'true' },
                typeof link.icon === 'function' || typeof link.icon === 'object' ? React.createElement(link.icon, { size: 14 }) : null
              ),
              React.createElement('span', null, link.label)
            )
          )
        ),
        React.createElement('p', { className: 'dshDeskOnbHint' }, t('desktopIntroFeedback'))
      )
    }

    // Unoblox API-key entry. Presentational: the parent owns the draft, busy
    // state, and the failure message.
    function UnobloxKeyField({ t, value, busy, failure, onChange, onSubmit, inputRef }) {
      return React.createElement(
        'div',
        { className: 'dshDeskOnbKey' },
        React.createElement('label', { className: 'dshDeskOnbKeyLabel', htmlFor: 'dshDeskOnbUnobloxKey' }, t('unobloxKeyLabel')),
        React.createElement('input', {
          id: 'dshDeskOnbUnobloxKey',
          ref: inputRef,
          className: 'dshDeskOnbKeyInput',
          type: 'password',
          autoComplete: 'off',
          spellCheck: false,
          value,
          disabled: busy,
          placeholder: t('unobloxKeyPlaceholder'),
          'aria-invalid': failure !== undefined,
          'aria-describedby': 'dshDeskOnbUnobloxKeyHint',
          onChange: (event) => onChange(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') onSubmit()
          }
        }),
        React.createElement(
          'p',
          { id: 'dshDeskOnbUnobloxKeyHint', className: 'dshDeskOnbKeyHint' },
          t('unobloxKeyHint') + ' ',
          React.createElement('a', { href: UNOBLOX_KEYS_URL, target: '_blank', rel: 'noreferrer' }, t('unobloxKeyLink'))
        ),
        React.createElement('p', { className: 'dshDeskOnbKeyHint' }, t('unobloxKeyLater')),
        React.createElement('p', { className: 'dshDeskOnbKeyHint' }, t('unobloxSearchPrivacy')),
        React.createElement('p', { className: 'dshDeskOnbKeyError', role: 'alert', 'aria-live': 'polite' }, failure ?? '')
      )
    }

    // Store the key under the reference the Unoblox route resolves per request.
    // Returns a failure message, or undefined once the key is stored.
    async function storeUnobloxKey(credentials, t, draft) {
      const key = draft.trim()
      if (key.length === 0) return t('unobloxKeyRequired')
      if (credentials === undefined || typeof credentials.set !== 'function') {
        return t('unobloxKeyFailed').replace('{message}', 'credential store unavailable')
      }
      try {
        const response = await credentials.set(UNOBLOX_KEY_REF, key)
        if (response?.ok === true) return undefined
        return t('unobloxKeyFailed').replace('{message}', response?.error?.message ?? 'unknown error')
      } catch (error) {
        return t('unobloxKeyFailed').replace('{message}', error instanceof Error ? error.message : String(error))
      }
    }

    // The notice is blocking: implicit dismissal (Escape, backdrop) is ignored
    // so the user leaves through one of the two explicit actions.
    const ignoreImplicitDismiss = () => {}

    /**
     * Show the notice to a new, unacknowledged install, and to any install
     * without a stored Unoblox key: Unoblox is the only model provider, so
     * without a key nothing works. That also covers installs classified as
     * existing (development builds, upgrades from DSH Desktop) and a key
     * removed later. Dismissing it is per launch; it returns until a key is set.
     * @param value - the wizard settings section.
     * @param keyState - 'configured' | 'missing' | 'unknown' (default).
     */
    function onboardingDecision(value, keyState = 'unknown') {
      if (keyState === 'missing') return 'show'
      const acknowledged = typeof value?.wizardVersion === 'string' && value.wizardVersion.length > 0
      return value?.eligible === true && !acknowledged ? 'show' : 'complete'
    }

    // Long enough for a slow Host, short enough not to hold boot hostage.
    const KEY_STATE_TIMEOUT_MS = 5000

    /**
     * Whether the credential store holds the Unoblox key. Never reads the
     * value; any failure is 'unknown', which defers to install eligibility.
     */
    async function unobloxKeyState(credentials) {
      if (credentials === undefined || typeof credentials.describe !== 'function') return 'unknown'
      try {
        const response = await Promise.race([
          credentials.describe([UNOBLOX_KEY_REF]),
          new Promise((resolve) => setTimeout(() => resolve(undefined), KEY_STATE_TIMEOUT_MS))
        ])
        const entry = response?.ok === true ? response.value?.[UNOBLOX_KEY_REF] : undefined
        if (entry?.configured === true) return 'configured'
        if (entry?.configured === false || (response?.ok === true && entry === undefined)) return 'missing'
        return 'unknown'
      } catch {
        // A failing describe must not block boot; eligibility still decides.
        return 'unknown'
      }
    }

    // Harness can still be starting (plugins loading, a profile restart) when
    // the shell first asks, and one timed-out or failed describe then read as
    // "unknown" and showed the notice to a user whose key was stored. Ask again
    // until the store gives a definite answer; ~30 s covers a cold start.
    const KEY_STATE_ATTEMPTS = 12
    const KEY_STATE_RETRY_MS = 2500

    /**
     * {@link unobloxKeyState}, retried while the answer is 'unknown'.
     * @param options - attempts and the pause between them (tests shorten these).
     */
    async function settledUnobloxKeyState(credentials, options = {}) {
      const attempts = options.attempts ?? KEY_STATE_ATTEMPTS
      const retryMs = options.retryMs ?? KEY_STATE_RETRY_MS
      let state = 'unknown'
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, retryMs))
        state = await unobloxKeyState(credentials)
        if (state !== 'unknown' || credentials === undefined) return state
      }
      return state
    }

    // ---------- the first-run notice ----------

    function DesktopOnboardingNotice(props) {
      const { complete, t } = props
      const wizardScope = props.controller.scope
      const credentials = props.controller.credentials
      const [decision, setDecision] = useState('loading')
      const [keyDraft, setKeyDraft] = useState('')
      const [keyBusy, setKeyBusy] = useState(false)
      const [keyFailure, setKeyFailure] = useState(undefined)
      const titleRef = useRef(null)
      const keyInputRef = useRef(null)
      const finishedRef = useRef(false)

      // Persist the acknowledgement, then hand the onboarding slot back. The
      // optional follow-up runs after the slot is released (e.g. opening the
      // models settings section).
      const finish = useCallback((followUp) => {
        if (finishedRef.current) return
        finishedRef.current = true
        const scope = wizardScope.getSnapshot()
        const persist = scope.mode === 'memory'
          ? Promise.resolve()
          : wizardScope.set(WIZARD_ACK_FIELD, WIZARD_VERSION).catch(() => undefined)
        Promise.resolve(persist).finally(() => {
          complete()
          if (followUp) followUp()
        })
      }, [complete, wizardScope])

      const [keyState, setKeyState] = useState('pending')
      useEffect(() => {
        let current = true
        settledUnobloxKeyState(credentials).then((state) => {
          if (current) setKeyState(state)
        })
        return () => { current = false }
      }, [credentials])

      useEffect(() => {
        // Decide once both the Host section and the key state are known, so a
        // configured user never sees a flash of the dialog.
        if (keyState === 'pending') return undefined
        const read = () => {
          const snap = wizardScope.getSnapshot()
          // Wait for the Host section so returning users never see a flash.
          if (snap.mode !== 'memory' && snap.status === 'loading') return
          const value = snap.value ?? {}
          setDecision(onboardingDecision(value, keyState))
        }
        let unsubscribe
        try {
          unsubscribe = wizardScope.subscribe(read)
          read()
        } catch {
          // Scope errors are non-fatal: a failing scope must not block boot.
        }
        return () => { if (unsubscribe) unsubscribe() }
      }, [wizardScope, keyState])

      // Ineligible installs and every prior acknowledgement skip straight on.
      useEffect(() => {
        if (decision === 'complete' && !finishedRef.current) {
          finishedRef.current = true
          complete()
        }
      }, [decision, complete])

      const visible = decision === 'show'

      // Keep the application behind the dialog inert, like the stock notice.
      useEffect(() => {
        if (!visible) return
        const appRoot = document.getElementById('root')
        if (appRoot === null) return
        const previous = appRoot.inert
        appRoot.inert = true
        return () => { appRoot.inert = previous }
      }, [visible])

      useEffect(() => {
        if (visible) titleRef.current?.focus()
      }, [visible])

      if (!visible) return null

      const connect = () => {
        if (keyBusy) return
        // An empty field is answered at once, without the busy state that
        // disables the input and would drop keyboard focus.
        if (keyDraft.trim().length === 0) {
          setKeyFailure(t('unobloxKeyRequired'))
          keyInputRef.current?.focus()
          return
        }
        setKeyBusy(true)
        setKeyFailure(undefined)
        storeUnobloxKey(credentials, t, keyDraft).then((failure) => {
          if (failure === undefined) {
            finish()
            return
          }
          setKeyFailure(failure)
          setKeyBusy(false)
          // The input was disabled while saving; give focus back to it.
          setTimeout(() => keyInputRef.current?.focus(), 0)
        })
      }

      return React.createElement(
        Modal,
        {
          open: true,
          title: t('step0Title'),
          onClose: ignoreImplicitDismiss,
          headless: true,
          className: 'dshDeskOnbDialog'
        },
        React.createElement(
          'div',
          { className: 'dshDeskOnbContent' },
          React.createElement(BrandHeader, { t }),
          React.createElement(
            'h2',
            { ref: titleRef, className: 'dshDeskOnbHeading', tabIndex: -1 },
            t('step0Title')
          ),
          React.createElement(NoticeBody, { t }),
          React.createElement(UnobloxKeyField, {
            t,
            value: keyDraft,
            busy: keyBusy,
            failure: keyFailure,
            onChange: setKeyDraft,
            onSubmit: connect,
            inputRef: keyInputRef
          }),
          React.createElement(
            'div',
            { className: 'dshDeskOnbActions' },
            React.createElement(
              Button,
              { variant: 'outline', disabled: keyBusy, onClick: () => finish() },
              t('later')
            ),
            React.createElement(
              Button,
              { variant: 'primary', disabled: keyBusy, onClick: connect },
              t(keyBusy ? 'unobloxConnecting' : 'unobloxConnect')
            )
          )
        )
      )
    }

    // ---------- composition ----------

    function apply(ctx) {
      ctx.inject(['slots', 'locale', 'configForms'], (scope) => {
        installStyles()
        const t = scope.locale.bind(NS)

        // Harness 0.2 removed `settingsScope`; per-entry settings now come from
        // `configForms.get(<loader entry id>)` with the same snapshot/subscribe/
        // set face. Waiting on the removed service left the notice unmounted.
        const wizardScope = scope.configForms.get(SETTINGS_ENTRY_ID)

        scope.locale.register(NS, { zh, en })

        // Remote namespaces are provisioned from the module-level `inject`
        // declaration below (as dsh-client-ui-settings-models does); a runtime
        // ctx.inject(['remote.credentials']) never resolves, which left this
        // whole notice unmounted.
        const controller = { scope: wizardScope, credentials: ctx.remote?.credentials }

        // The stock welcome-notice / official-DeepSeek onboarding entries are
        // removed upstream by the settings-models patch (the desktop notice owns
        // first-run), so this notice registers under its own id — no shadowing.
        scope.slots.inject('settings.onboarding', () => scope.slots.register({
          name: 'settings.onboarding',
          id: 'dsh-desktop-onboarding',
          order: 0,
          inject: () => ({ controller, t })
        }, DesktopOnboardingNotice))
      })
    }

    const inject = ['remote', 'remote.credentials']

    exports.apply = apply
    exports.inject = inject
    exports.onboardingDecision = onboardingDecision
    exports.unobloxKeyState = unobloxKeyState
    exports.settledUnobloxKeyState = settledUnobloxKeyState
    exports.storeUnobloxKey = storeUnobloxKey
    return module.exports
  }
})
