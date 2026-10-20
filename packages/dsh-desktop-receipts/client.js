window.__ModuleLoader__.load({
  id: 'dsh-desktop-receipts',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useState } = React
    const h = React.createElement

    // Proof of work: under each finished turn, a receipt of what the agent
    // actually did, read from the turn's own session events (tool calls and
    // their results), set against what its final reply claims. A claim such
    // as "tests pass" with no passing test run after the last file change is
    // marked as not verified. Nothing here runs anything: "Re-check" asks the
    // agent, as the user's next message, to run the checks and report.

    const NS = 'desktop-receipts'
    const KEY = 'desktop-receipt'
    const STYLE_ID = 'dsh-desktop-receipts-style'
    const MAX_COMMANDS = 40
    const MAX_FILES = 60

    const en = {
      summary: 'Receipt',
      checksPassed: 'checks passed: {count}',
      checksFailed: 'checks failed: {count}',
      noChecks: 'no checks run',
      filesChanged: 'files changed: {count}',
      claimsUnverified: 'not verified: {count}',
      allVerified: 'claims verified',
      commands: 'Commands run',
      files: 'Files changed',
      claims: 'What the reply claims',
      exit: 'exit {code}',
      timedOut: 'timed out',
      killed: 'stopped ({signal})',
      notRun: 'could not run',
      running: 'no result',
      'kind.test': 'test',
      'kind.build': 'build',
      'kind.typecheck': 'type check',
      'kind.lint': 'lint',
      'claim.test': 'Tests pass',
      'claim.build': 'The build works',
      'claim.typecheck': 'Types check',
      'claim.lint': 'Lint is clean',
      'state.verified': 'verified: {command} passed after the last change',
      'state.failed': 'contradicted: {command} failed',
      'state.stale': 'not re-run since the last change ({command} ran before it)',
      'state.unverified': 'not verified: no such check was run',
      recheck: 'Re-check',
      recheckHint: 'Ask the agent to run these checks again and report the exact results.',
      recheckSent: 'Asked the agent to re-run the checks.',
      recheckFailed: 'Could not send: {message}',
      recheckMessage: 'Re-run these checks now and report the exact results, including any failures: {commands}',
      recheckMessageNone: 'Run the checks that back up your last answer ({claims}) and report the exact results, including any failures.'
    }
    const zh = {
      summary: '工作凭证',
      checksPassed: '{count} 项通过',
      checksFailed: '{count} 项失败',
      noChecks: '未运行检查',
      filesChanged: '修改了 {count} 个文件',
      claimsUnverified: '{count} 项声明未经验证',
      allVerified: '声明已验证',
      commands: '运行的命令',
      files: '修改的文件',
      claims: '回复中的声明',
      exit: '退出码 {code}',
      timedOut: '超时',
      killed: '已终止（{signal}）',
      notRun: '无法运行',
      running: '无结果',
      'kind.test': '测试',
      'kind.build': '构建',
      'kind.typecheck': '类型检查',
      'kind.lint': '代码检查',
      'claim.test': '测试通过',
      'claim.build': '构建成功',
      'claim.typecheck': '类型检查通过',
      'claim.lint': '代码检查通过',
      'state.verified': '已验证：最后一次修改后 {command} 通过',
      'state.failed': '与结果不符：{command} 失败',
      'state.stale': '修改后未重新运行（{command} 在修改之前运行）',
      'state.unverified': '未验证：没有运行相应的检查',
      recheck: '重新检查',
      recheckHint: '请智能体重新运行这些检查并报告确切结果。',
      recheckSent: '已请智能体重新运行检查。',
      recheckFailed: '发送失败：{message}',
      recheckMessage: '现在重新运行这些检查，并报告确切结果（包括任何失败）：{commands}',
      recheckMessageNone: '运行能支持你上一个回答的检查（{claims}），并报告确切结果（包括任何失败）。'
    }

    // ---------- reading the turn (pure) ----------

    const CHECK_PATTERNS = [
      ['test', /\b(?:vitest|jest|mocha|pytest|unittest|rspec|phpunit|ctest)\b|\bcargo\s+test\b|\bgo\s+test\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::\S+)?\b|\bmake\s+(?:test|check)\b|\bdotnet\s+test\b|\bgradle\w*\s+test\b|\bmvn\s+test\b/u],
      ['typecheck', /\btsc\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:typecheck|type-check|types)\b|\bmypy\b|\bpyright\b/u],
      ['lint', /\beslint\b|\bruff\b|\bflake8\b|\bpylint\b|\bclippy\b|\bgolangci-lint\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?lint\b/u],
      ['build', /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\bcargo\s+build\b|\bgo\s+build\b|\bmake(?:\s+(?:all|build))?\s*$|\bvite\s+build\b|\bwebpack\b|\bgradle\w*\s+build\b|\bmvn\s+(?:package|install)\b|\bdotnet\s+build\b/u]
    ]

    /** What kind of check a shell command is, or undefined for anything else. */
    function checkKind(command) {
      const text = String(command).trim()
      for (const [kind, pattern] of CHECK_PATTERNS) if (pattern.test(text)) return kind
      return undefined
    }

    /**
     * The outcome of a bash result from its text: the tool appends
     * `[exit code: N]`, `[timed out after …]` or `[killed by signal: …]`, and
     * nothing for exit 0.
     */
    function shellOutcome(message) {
      if (message?.isError === true) return { status: 'not-run' }
      const text = (Array.isArray(message?.content) ? message.content : []).filter((block) => block?.type === 'text').map((block) => block.text).join('\n').trimEnd()
      const timed = /\[timed out after [^\]]*\]\s*$/u.exec(text)
      if (timed) return { status: 'timed-out' }
      const signal = /\[killed by signal: ([^\]]+)\]\s*$/u.exec(text)
      if (signal) return { status: 'killed', signal: signal[1] }
      const exit = /\[exit code: (\d+)\]\s*$/u.exec(text)
      return exit ? { status: Number(exit[1]) === 0 ? 'passed' : 'failed', code: Number(exit[1]) } : { status: 'passed', code: 0 }
    }

    function parseArgs(raw) {
      try {
        const value = JSON.parse(raw)
        return typeof value === 'object' && value !== null ? value : {}
      } catch {
        return {}
      }
    }

    const FILE_TOOLS = {
      write: (args) => args.file_path,
      edit: (args) => args.file_path,
      str_replace_editor: (args) => (['create', 'str_replace', 'insert'].includes(args.command) ? args.path : undefined)
    }

    const CLAIM_PATTERNS = [
      ['test', /\b(?:all\s+(?:the\s+)?)?(?:unit\s+|integration\s+|e2e\s+)?tests?\s+(?:now\s+|all\s+|still\s+)?(?:pass(?:es|ed|ing)?|are\s+(?:passing|green)|succeed(?:s|ed)?)\b|\btest suite (?:passes|is green)\b|测试(?:全部|均|都)?(?:已)?通过/iu],
      ['build', /\bbuild(?:s)?\s+(?:now\s+)?(?:succeed(?:s|ed)?|pass(?:es|ed)?|works|is\s+green|is\s+clean)\b|\b(?:it|the\s+project|everything)\s+(?:now\s+)?(?:builds|compiles)\b|构建成功|编译通过/iu],
      ['typecheck', /\btype[-\s]?check(?:s|ing)?\s+(?:now\s+)?(?:pass(?:es|ed)?|is\s+clean|succeeds)\b|\btypes\s+(?:now\s+)?check(?:\s+(?:out|cleanly))?\b(?!\s+(?:fail|failed|failing))|\bno\s+type\s+errors\b|类型检查通过/iu],
      ['lint', /\blint(?:ing|er)?\s+(?:now\s+)?(?:pass(?:es|ed)?|is\s+clean)\b|\bno\s+lint(?:ing)?\s+(?:errors|warnings|issues)\b/iu]
    ]

    /** Which checks a reply says passed. */
    function claimsIn(text) {
      const found = []
      for (const [kind, pattern] of CLAIM_PATTERNS) if (pattern.test(String(text))) found.push(kind)
      return found
    }

    /**
     * A receipt for one turn from its events, in order: `{ commands, files,
     * claims }`. A claim is verified by a passing check of its kind after the
     * last file change, contradicted by a failing one, stale when the check
     * only ran before the last change, unverified when none ran.
     */
    function buildReceipt(state) {
      const calls = state?.calls ?? []
      const commands = []
      const files = []
      let lastChange = -1
      for (const call of calls) {
        if (call.name === 'bash' && typeof call.args?.command === 'string') {
          commands.push({ seq: call.seq, command: call.args.command, kind: checkKind(call.args.command), outcome: call.result === undefined ? { status: 'no-result' } : shellOutcome(call.result) })
        }
        const pick = FILE_TOOLS[call.name]
        const path = pick === undefined ? undefined : pick(call.args ?? {})
        if (typeof path === 'string' && path !== '' && call.result !== undefined && call.result.isError !== true) {
          lastChange = Math.max(lastChange, call.seq)
          if (!files.includes(path)) files.push(path)
        }
      }
      const claims = claimsIn(state?.finalText ?? '').map((kind) => {
        const ofKind = commands.filter((command) => command.kind === kind)
        const after = ofKind.filter((command) => command.seq > lastChange)
        const last = after.at(-1)
        if (last !== undefined) return { kind, state: last.outcome.status === 'passed' ? 'verified' : 'failed', command: last.command }
        if (ofKind.length > 0) return { kind, state: 'stale', command: ofKind.at(-1).command }
        return { kind, state: 'unverified' }
      })
      return { commands: commands.slice(-MAX_COMMANDS), files: files.slice(0, MAX_FILES), claims }
    }

    /** The receipt is worth showing when the turn ran a check, changed a file or claimed a check. */
    function hasContent(receipt) {
      return receipt.commands.some((command) => command.kind !== undefined) || receipt.files.length > 0 || receipt.claims.length > 0
    }

    /** The checks to re-run: each kind's last command, else nothing. */
    function recheckCommands(receipt) {
      const byKind = new Map()
      for (const command of receipt.commands) if (command.kind !== undefined) byKind.set(command.kind, command.command)
      return [...byKind.values()]
    }

    function finalText(message) {
      const blocks = Array.isArray(message?.content) ? message.content : []
      if (blocks.some((block) => block?.type === 'tool-call')) return undefined
      return blocks.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n')
    }

    /** Collects one turn's tool calls, results and final reply from its events. */
    const receiptDefinition = {
      kind: KEY,
      match: (event) => {
        const turn = event.data?.turn
        if (turn === undefined) return null
        if (event.type === 'turn/start') return { id: String(turn), role: 'start' }
        if (event.type === 'tool/call' || event.type === 'assistant/message' || event.type === 'turn/end') return { id: String(turn), role: 'update' }
        // Compaction can rewrite a result's content later; the receipt keeps the original.
        if (event.type === 'tool/result' && (event.surfaceOp === undefined || event.surfaceOp === 'append')) return { id: String(turn), role: 'update' }
        return null
      },
      start: (_context, match) => ({ turn: match.event.data.turn, calls: [], ended: false }),
      update: (context, match) => {
        const state = context.state ?? { turn: match.event.data.turn, calls: [], ended: false }
        const event = match.event
        if (event.type === 'tool/call') {
          const callId = String(event.data.callId)
          const call = { callId, seq: event.seq, name: event.data.name, args: parseArgs(event.data.arguments) }
          const known = state.calls.findIndex((entry) => entry.callId === callId)
          return { ...state, calls: known < 0 ? [...state.calls, call] : state.calls.map((entry, index) => index === known ? { ...call, ...(entry.result === undefined ? {} : { result: entry.result }) } : entry) }
        }
        if (event.type === 'tool/result') {
          const callId = String(event.data.message?.source?.callId ?? event.data.message?.toolCallId ?? '')
          return { ...state, calls: state.calls.map((entry) => entry.callId === callId ? { ...entry, result: event.data.message } : entry) }
        }
        if (event.type === 'assistant/message') {
          const text = finalText(event.data.message)
          return text === undefined ? state : { ...state, finalText: text }
        }
        if (event.type === 'turn/end') return { ...state, ended: true }
        return state
      },
      buildLocationData: (context, scope, previous) => {
        const state = context.state
        if (scope !== 'turn' || state === undefined || !state.ended) return null
        if (previous?.kind === 'turn' && previous.turn === state.turn && previous.value === state) return previous
        return { kind: 'turn', turn: state.turn, key: KEY, value: state }
      }
    }

    // ---------- display ----------

    const STYLE = `
      .dshRcpt{margin:2px 0 8px;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;color:var(--dsw-alias-label-secondary)}
      .dshRcpt>summary{display:inline-flex;align-items:center;gap:8px;cursor:pointer;list-style:none;border-radius:6px;padding:0 4px}
      .dshRcpt>summary::-webkit-details-marker{display:none}
      .dshRcpt>summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dshRcptTitle{font-weight:600;color:var(--dsw-alias-label-primary)}
      .dshRcptWarn{color:var(--dsw-alias-state-error-primary)}
      .dshRcptBody{margin:6px 0 0 4px;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:8px}
      .dshRcptBody h4{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
      .dshRcptBody ul{margin:2px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px}
      .dshRcptCmd{display:flex;gap:8px;align-items:baseline;min-width:0}
      .dshRcptCmd code{font-family:var(--dsh-font-mono,ui-monospace,monospace);font-size:12px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
      .dshRcptTag{flex:none;font-size:11px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2)}
      .dshRcptTag[data-status=passed]{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-secondary))}
      .dshRcptTag[data-status=failed],.dshRcptTag[data-status=timed-out],.dshRcptTag[data-status=killed],.dshRcptTag[data-status=not-run]{color:var(--dsw-alias-state-error-primary)}
      .dshRcptClaim[data-state=failed],.dshRcptClaim[data-state=unverified],.dshRcptClaim[data-state=stale]{color:var(--dsw-alias-state-error-primary)}
      .dshRcptFile{font-family:var(--dsh-font-mono,ui-monospace,monospace);font-size:12px}
      .dshRcptActions{display:flex;align-items:center;gap:8px}
      .dshRcptBtn{padding:2px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
      .dshRcptBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .dshRcptBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dshRcptBtn:disabled{opacity:.55;cursor:default}
    `

    function installStyles() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = STYLE
      document.head.appendChild(tag)
    }

    function errorText(error) {
      return error instanceof Error ? error.message : String(error)
    }

    function outcomeLabel(outcome, t) {
      if (outcome.status === 'passed' || outcome.status === 'failed') return t('exit', { code: outcome.code })
      if (outcome.status === 'timed-out') return t('timedOut')
      if (outcome.status === 'killed') return t('killed', { signal: outcome.signal })
      if (outcome.status === 'not-run') return t('notRun')
      return t('running')
    }

    function ReceiptView({ receipt, t, sendText }) {
      const [status, setStatus] = useState(undefined)
      const [busy, setBusy] = useState(false)
      const checks = receipt.commands.filter((command) => command.kind !== undefined)
      const passed = checks.filter((command) => command.outcome.status === 'passed').length
      const failed = checks.length - passed
      const doubtful = receipt.claims.filter((claim) => claim.state !== 'verified')
      const parts = []
      parts.push(checks.length === 0 ? t('noChecks') : [passed > 0 ? t('checksPassed', { count: passed }) : undefined, failed > 0 ? t('checksFailed', { count: failed }) : undefined].filter(Boolean).join(', '))
      if (receipt.files.length > 0) parts.push(t('filesChanged', { count: receipt.files.length }))
      if (receipt.claims.length > 0) parts.push(doubtful.length > 0 ? t('claimsUnverified', { count: doubtful.length }) : t('allVerified'))
      const rerun = recheckCommands(receipt)
      const recheck = async () => {
        setBusy(true)
        try {
          await sendText(rerun.length > 0
            ? t('recheckMessage', { commands: rerun.map((command) => `\`${command}\``).join(', ') })
            : t('recheckMessageNone', { claims: receipt.claims.map((claim) => t(`claim.${claim.kind}`)).join(', ') }))
          setStatus({ tone: 'ok', text: t('recheckSent') })
        } catch (error) {
          setStatus({ tone: 'error', text: t('recheckFailed', { message: errorText(error) }) })
        } finally {
          setBusy(false)
        }
      }
      return h('details', { className: 'dshRcpt', 'data-receipt': '', open: doubtful.length > 0 || failed > 0 ? true : undefined },
        h('summary', null,
          h('span', { className: 'dshRcptTitle' }, t('summary')),
          h('span', { className: doubtful.length > 0 || failed > 0 ? 'dshRcptWarn' : undefined }, parts.join(' · '))),
        h('div', { className: 'dshRcptBody' },
          receipt.claims.length === 0 ? null : h('section', null,
            h('h4', null, t('claims')),
            h('ul', null, ...receipt.claims.map((claim) => h('li', { key: claim.kind, className: 'dshRcptClaim', 'data-state': claim.state },
              `${t(`claim.${claim.kind}`)}: ${t(`state.${claim.state}`, claim.command === undefined ? undefined : { command: claim.command })}`)))),
          receipt.commands.length === 0 ? null : h('section', null,
            h('h4', null, t('commands')),
            h('ul', null, ...receipt.commands.map((command, index) => h('li', { key: `${String(command.seq)}:${String(index)}`, className: 'dshRcptCmd' },
              h('span', { className: 'dshRcptTag', 'data-status': command.outcome.status }, outcomeLabel(command.outcome, t)),
              command.kind === undefined ? null : h('span', { className: 'dshRcptTag' }, t(`kind.${command.kind}`)),
              h('code', { title: command.command }, command.command))))),
          receipt.files.length === 0 ? null : h('section', null,
            h('h4', null, t('files')),
            h('ul', null, ...receipt.files.map((file) => h('li', { key: file, className: 'dshRcptFile' }, file)))),
          rerun.length === 0 && doubtful.length === 0 ? null : h('div', { className: 'dshRcptActions' },
            h('button', { type: 'button', className: 'dshRcptBtn', title: t('recheckHint'), disabled: busy || status?.tone === 'ok', onClick: recheck }, t('recheck')),
            status === undefined ? null : h('span', { role: 'status', className: status.tone === 'error' ? 'dshRcptWarn' : undefined }, status.text))))
    }

    function ReceiptTail(props) {
      const state = props.turn?.data?.get(KEY)
      if (state === undefined) return null
      const receipt = buildReceipt(state)
      if (!hasContent(receipt)) return null
      return h(ReceiptView, { receipt, t: props.t, sendText: props.sendText })
    }

    // ---------- composition ----------

    const inject = ['slots', 'locale', 'uiConversation']
    function apply(ctx) {
      installStyles()
      ctx.effect(() => ctx.locale.register(NS, { zh, en }))
      ctx.uiConversation.events.register(receiptDefinition)
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        id: NS,
        locale: NS,
        inject: (sessionId) => ({
          // As the user's next message in this conversation.
          sendText: (text) => {
            const conversation = ctx.get('sessions')?.scope(sessionId)?.get('conversation')
            if (!conversation || typeof conversation.send !== 'function') throw new Error('the conversation is not available')
            return conversation.send(text)
          }
        })
      }, ReceiptTail))
    }

    exports.apply = apply
    exports.inject = inject
    exports.checkKind = checkKind
    exports.shellOutcome = shellOutcome
    exports.claimsIn = claimsIn
    exports.buildReceipt = buildReceipt
    exports.recheckCommands = recheckCommands
    exports.receiptDefinition = receiptDefinition
    exports.ReceiptView = ReceiptView
    exports.ReceiptTail = ReceiptTail
    exports.locales = { en, zh }
    return module.exports
  }
})
