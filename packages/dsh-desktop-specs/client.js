window.__ModuleLoader__.load({
  id: 'dsh-desktop-specs',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React
    const {
      Button,
      Modal,
      IconChecklistOutlineRegular,
      IconCheckCircleFillRegular,
      IconWarningOutlineRegular
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    // The spec of this conversation (index.js): a pill under the composer, a
    // review banner above it while a document waits for approval, and a
    // panel with the documents, the trace, drift and the change log.

    const NS = 'desktop-specs'
    const ROUTE = '/api/desktop-specs'
    const APPROVE_ROUTE = '/api/desktop-specs/approve'
    const REOPEN_ROUTE = '/api/desktop-specs/reopen'
    const ACTIVATE_ROUTE = '/api/desktop-specs/activate'
    const DOCS = ['requirements', 'design', 'tasks']
    const LIVE_REFRESH_MS = 4000
    const STYLE_ID = 'dsh-desktop-specs-style'

    const en = {
      pill: 'Spec: {title}',
      pillSpecs: 'Specs ({count})',
      pillHint: 'Spec "{title}": {phase}. Click for the documents, trace and drift.',
      pillSpecsHint: 'This project has specs. Click to pick one for this conversation.',
      reviewShort: 'Review',
      tasksDone: '{done}/{total} tasks',
      drift: '{count} drift',
      'phase.requirements': 'writing requirements',
      'phase.design': 'designing',
      'phase.tasks': 'planning tasks',
      'phase.build': 'building',
      'step.requirements': 'Requirements',
      'step.design': 'Design',
      'step.tasks': 'Tasks',
      'step.build': 'Build & verify',
      'tab.trace': 'Trace',
      'tab.changes': 'Changes',
      bannerTitle: '{file} is ready for your review',
      'bannerSummary.requirements': '{requirements} requirements, {criteria} acceptance criteria.',
      'bannerSummary.design': 'Covers {covered} of {requirements} requirements.',
      'bannerSummary.tasks': '{tasks} tasks covering {criteria} acceptance criteria.',
      bannerStale: 'It changed after it was submitted; open it to see the latest text.',
      open: 'Review',
      approve: 'Approve',
      askChanges: 'Ask for changes',
      approving: 'Approving…',
      approveFailed: 'Could not approve: {message}',
      approvedMessage: 'Approved {file}. Continue with the next step.',
      approvedTasksMessage: 'Approved tasks.md. Start building, task by task, with tests for each acceptance criterion.',
      changesDraft: 'Changes to {file}: ',
      panelTitle: 'Spec: {title}',
      folder: 'In {folder}',
      approved: 'Approved',
      approvedChanged: 'Approved; changed since ({by})',
      waiting: 'Waiting for your approval',
      notYet: 'Not started',
      draft: 'Draft',
      issues: 'Problems to fix before approval',
      warnings: 'Worth checking',
      empty: 'Nothing written yet.',
      criterion: 'Criterion',
      status: 'Status',
      tests: 'Tests',
      tasks: 'Tasks',
      'status.passing': 'Passing',
      'status.failing': 'Failing',
      'status.stale': 'Stale',
      'status.untested': 'No test',
      'status.not-run': 'Not run',
      counts: '{passing} of {total} criteria passing · {failing} failing · {untested} without a test',
      lastRun: 'Last test run: {command} — {result}',
      runPassed: 'passed',
      runFailed: 'failed',
      noRun: 'No test run yet in this session.',
      driftTitle: 'Drift',
      noDrift: 'No drift: code, tests and the spec agree.',
      noChanges: 'No changes to approved documents.',
      changeBy: '{doc} · {by} · {time}',
      'by.agent': 'by the agent',
      'by.outside the app': 'edited outside the app',
      pickTitle: 'Specs in this project',
      pickIntro: 'Pick the spec this conversation works on. Its state and documents follow the project.',
      use: 'Work on this',
      stop: 'Stop using this spec',
      close: 'Close',
      loadFailed: 'Could not load the spec: {message}'
    }
    const zh = {
      pill: '规格：{title}',
      pillSpecs: '规格（{count}）',
      pillHint: '规格“{title}”：{phase}。点击查看文档、追踪和偏差。',
      pillSpecsHint: '此项目有规格。点击为此对话选择一个。',
      reviewShort: '待审阅',
      tasksDone: '{done}/{total} 个任务',
      drift: '{count} 处偏差',
      'phase.requirements': '编写需求',
      'phase.design': '设计中',
      'phase.tasks': '规划任务',
      'phase.build': '构建中',
      'step.requirements': '需求',
      'step.design': '设计',
      'step.tasks': '任务',
      'step.build': '构建与验证',
      'tab.trace': '追踪',
      'tab.changes': '变更',
      bannerTitle: '{file} 已可审阅',
      'bannerSummary.requirements': '{requirements} 条需求，{criteria} 条验收标准。',
      'bannerSummary.design': '覆盖 {requirements} 条需求中的 {covered} 条。',
      'bannerSummary.tasks': '{tasks} 个任务，覆盖 {criteria} 条验收标准。',
      bannerStale: '提交后又有改动，请打开查看最新内容。',
      open: '审阅',
      approve: '批准',
      askChanges: '要求修改',
      approving: '正在批准…',
      approveFailed: '无法批准：{message}',
      approvedMessage: '已批准 {file}。继续下一步。',
      approvedTasksMessage: '已批准 tasks.md。开始逐个任务构建，并为每条验收标准编写测试。',
      changesDraft: '{file} 需要修改：',
      panelTitle: '规格：{title}',
      folder: '位于 {folder}',
      approved: '已批准',
      approvedChanged: '已批准；之后有改动（{by}）',
      waiting: '等待你批准',
      notYet: '尚未开始',
      draft: '草稿',
      issues: '批准前需修正的问题',
      warnings: '值得检查',
      empty: '尚无内容。',
      criterion: '验收标准',
      status: '状态',
      tests: '测试',
      tasks: '任务',
      'status.passing': '通过',
      'status.failing': '失败',
      'status.stale': '已过期',
      'status.untested': '无测试',
      'status.not-run': '未运行',
      counts: '{total} 条标准中 {passing} 条通过 · {failing} 条失败 · {untested} 条无测试',
      lastRun: '最近一次测试：{command} — {result}',
      runPassed: '通过',
      runFailed: '失败',
      noRun: '本次会话尚未运行测试。',
      driftTitle: '偏差',
      noDrift: '没有偏差：代码、测试与规格一致。',
      noChanges: '已批准的文档没有变更。',
      changeBy: '{doc} · {by} · {time}',
      'by.agent': '由智能体修改',
      'by.outside the app': '在应用外编辑',
      pickTitle: '此项目中的规格',
      pickIntro: '选择此对话要处理的规格。它的状态和文档保存在项目中。',
      use: '处理此规格',
      stop: '停止使用此规格',
      close: '关闭',
      loadFailed: '无法加载规格：{message}'
    }

    const STYLE = `
      /* Its title truncates when the row is tight; the state (Review, 2/5) stays. */
      .dshSpecPill{box-sizing:border-box;flex:0 10 auto;min-width:118px;overflow:hidden;display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border:0;border-radius:999px;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;cursor:pointer}
      .dshSpecPill:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .dshSpecPill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dshSpecPill svg{flex:none;width:14px;height:14px}
      .dshSpecPillTitle{min-width:24px;max-width:160px;overflow:hidden;text-overflow:ellipsis}
      .dshSpecPillState{flex:none}
      .dshSpecPill[data-attention=true]{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,#D9A64A 22%,transparent)}
      .dshSpecPillWarn{display:inline-flex;align-items:center;gap:3px;color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary))}
      /* As wide as the composer it sits on. */
      .dshSpecBanner{box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;width:100%;max-width:var(--dsh-composer-card-max-width,712px);margin:2px auto 10px;padding:10px 12px;border:1px solid color-mix(in srgb,#D9A64A 55%,transparent);border-radius:12px;background:color-mix(in srgb,#D9A64A 10%,var(--dsw-alias-settings-card-fill,transparent));font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}
      .dshSpecBannerText{display:flex;flex-direction:column;flex:1 1 260px;min-width:0}
      .dshSpecBannerText strong{font-weight:600}
      .dshSpecBannerText span{color:var(--dsw-alias-label-secondary)}
      .dshSpecActions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
      .dshSpecBtn{box-sizing:border-box;display:inline-flex;align-items:center;padding:3px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:none;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
      .dshSpecBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .dshSpecBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dshSpecBtn:disabled{opacity:.55;cursor:default}
      .dshSpecBtnPrimary{border-color:transparent;background:#D9A64A;color:#18191c;font-weight:600}
      .dshSpecBtnPrimary:hover{background:#cf9a3c}
      .dshSpecStatus{flex:1 1 100%;margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .dshSpecStatus[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
      .dshSpecModal.dshSpecModal{width:min(880px,100%);max-width:none}
      .dshSpecPanel{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;width:100%;min-width:0;max-height:min(74vh,780px);font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
      .dshSpecMuted{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}
      .dshSpecSteps{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
      .dshSpecStep{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
      .dshSpecStep svg{width:14px;height:14px}
      .dshSpecStep[data-state=approved]{color:var(--dsw-alias-label-primary)}
      .dshSpecStep[data-state=approved] svg{color:var(--dsw-alias-state-success-primary,#2e9e5b)}
      .dshSpecStep[data-state=waiting]{border-color:#D9A64A;color:var(--dsw-alias-label-primary)}
      .dshSpecStep[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
      .dshSpecStep:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dshSpecBody{flex:1 1 auto;min-height:0;overflow:auto;padding-right:4px}
      .dshSpecDoc h1,.dshSpecDoc h2,.dshSpecDoc h3,.dshSpecDoc h4{margin:14px 0 6px;line-height:1.3}
      .dshSpecDoc h1{font-size:18px}.dshSpecDoc h2{font-size:15px}.dshSpecDoc h3{font-size:14px}.dshSpecDoc h4{font-size:13px}
      .dshSpecDoc p{margin:6px 0}
      .dshSpecDoc ul,.dshSpecDoc ol{margin:6px 0;padding-left:20px}
      .dshSpecDoc li{margin:2px 0}
      .dshSpecDoc li[data-task]{list-style:none;margin-left:-18px}
      .dshSpecDoc code{padding:0 4px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);font-size:12px}
      .dshSpecDoc pre{margin:8px 0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);overflow:auto;font-size:12px;line-height:18px}
      .dshSpecId{display:inline-block;padding:0 5px;border-radius:4px;background:color-mix(in srgb,#D9A64A 18%,transparent);font-variant-numeric:tabular-nums;font-size:12px;font-weight:600}
      .dshSpecIssues{margin:0 0 8px;padding:8px 10px 8px 26px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2)}
      .dshSpecIssues[data-level=error]{border-color:var(--dsw-alias-state-error-primary)}
      .dshSpecIssues strong{display:block;margin-left:-16px}
      .dshSpecTable{width:100%;border-collapse:collapse;font-size:12px}
      .dshSpecTable th,.dshSpecTable td{padding:5px 6px;border-bottom:.5px solid var(--dsw-alias-border-l2);text-align:left;vertical-align:top}
      .dshSpecTable th{font-weight:600;color:var(--dsw-alias-label-secondary)}
      .dshSpecBadge{display:inline-block;padding:0 7px;border-radius:999px;border:1px solid currentColor;font-size:11px;white-space:nowrap}
      .dshSpecBadge[data-status=passing]{color:var(--dsw-alias-state-success-primary,#2e9e5b)}
      .dshSpecBadge[data-status=failing]{color:var(--dsw-alias-state-error-primary)}
      .dshSpecBadge[data-status=stale],.dshSpecBadge[data-status=untested]{color:var(--dsw-alias-state-warning-primary,#b7791f)}
      .dshSpecBadge[data-status=not-run]{color:var(--dsw-alias-label-tertiary)}
      .dshSpecList{margin:6px 0;padding-left:18px}
      .dshSpecList li{margin:3px 0}
      .dshSpecFoot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end}
      .dshSpecPick{display:flex;flex-direction:column;gap:8px}
      .dshSpecPickRow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
    `

    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }
    function errorText(error) {
      return error instanceof Error ? error.message : String(error)
    }
    const FILES = { requirements: 'requirements.md', design: 'design.md', tasks: 'tasks.md' }

    function createSpecService(doFetch = (...args) => fetch(...args)) {
      const post = async (path, body) => {
        const response = await doFetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        let json
        try { json = await response.json() } catch { json = undefined }
        if (!response.ok) throw new Error(isRecord(json) && typeof json.error === 'string' ? json.error : `HTTP ${String(response.status)}`)
        return json
      }
      return {
        async load(sessionId, signal) {
          const response = await doFetch(`${ROUTE}?session=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin', cache: 'no-store', signal })
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          const body = await response.json()
          if (!isRecord(body)) throw new Error('unexpected response')
          return { active: isRecord(body.active) ? body.active : null, specs: Array.isArray(body.specs) ? body.specs : [] }
        },
        approve: (sessionId, doc, sha256) => post(APPROVE_ROUTE, { session: sessionId, doc, sha256 }),
        reopen: (sessionId, doc) => post(REOPEN_ROUTE, { session: sessionId, doc }),
        activate: (sessionId, slug) => post(ACTIVATE_ROUTE, { session: sessionId, slug })
      }
    }

    /**
     * Load on mount, every few seconds while the agent works (it writes the
     * documents), and once more when it stops. A failed refresh keeps the view.
     */
    function useSpec(service, sessionId, running) {
      const [state, setState] = useState({ status: 'loading' })
      const controller = useRef(undefined)
      const reload = useCallback(() => {
        if (sessionId === undefined) return
        controller.current?.abort()
        const current = new AbortController()
        controller.current = current
        service.load(sessionId, current.signal).then(
          (view) => { if (!current.signal.aborted) setState({ status: 'ready', view }) },
          (error) => { if (!current.signal.aborted) setState((previous) => (previous.status === 'ready' ? previous : { status: 'error', message: errorText(error) })) }
        )
      }, [service, sessionId])
      useEffect(() => {
        reload()
        return () => controller.current?.abort()
      }, [reload])
      useEffect(() => {
        if (running !== true) {
          reload()
          return undefined
        }
        const timer = setInterval(reload, LIVE_REFRESH_MS)
        return () => clearInterval(timer)
      }, [running, reload])
      return [state, reload]
    }

    // ---------- Markdown, small and safe (React text nodes only) ----------

    const ID_PATTERN = /\b(REQ-\d+|AC-\d+\.\d+|T-\d+)\b/gu

    function inline(text, key) {
      const parts = []
      let index = 0
      const tokens = /(`[^`]+`)|(\*\*[^*]+\*\*)|\b(REQ-\d+|AC-\d+\.\d+|T-\d+)\b/gu
      let match
      while ((match = tokens.exec(text)) !== null) {
        if (match.index > index) parts.push(text.slice(index, match.index))
        if (match[1] !== undefined) parts.push(h('code', { key: `${key}-${String(match.index)}` }, match[1].slice(1, -1)))
        else if (match[2] !== undefined) parts.push(h('strong', { key: `${key}-${String(match.index)}` }, match[2].slice(2, -2)))
        else parts.push(h('span', { key: `${key}-${String(match.index)}`, className: 'dshSpecId' }, match[3]))
        index = match.index + match[0].length
      }
      if (index < text.length) parts.push(text.slice(index))
      return parts
    }

    /** Headings, lists, task boxes, fences and paragraphs. */
    function renderMarkdown(text) {
      const blocks = []
      const lines = String(text ?? '').split('\n')
      let list
      let paragraph = []
      const flushParagraph = () => {
        if (paragraph.length > 0) blocks.push(h('p', { key: `p${String(blocks.length)}` }, inline(paragraph.join(' '), `p${String(blocks.length)}`)))
        paragraph = []
      }
      const flushList = () => {
        if (list !== undefined) blocks.push(h(list.ordered ? 'ol' : 'ul', { key: `l${String(blocks.length)}` }, list.items))
        list = undefined
      }
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]
        if (/^```/u.test(line)) {
          flushParagraph(); flushList()
          const code = []
          index++
          while (index < lines.length && !/^```/u.test(lines[index])) code.push(lines[index++])
          blocks.push(h('pre', { key: `c${String(blocks.length)}` }, code.join('\n')))
          continue
        }
        const heading = /^(#{1,4})\s+(.*)$/u.exec(line)
        if (heading !== null) {
          flushParagraph(); flushList()
          blocks.push(h(`h${String(heading[1].length)}`, { key: `h${String(blocks.length)}` }, inline(heading[2], `h${String(blocks.length)}`)))
          continue
        }
        const item = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/u.exec(line)
        if (item !== null) {
          flushParagraph()
          const ordered = item[2] !== undefined
          if (list === undefined || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } }
          const box = /^\[([ xX])\]\s+(.*)$/u.exec(item[3])
          const key = `i${String(index)}`
          list.items.push(box === null
            ? h('li', { key }, inline(item[3], key))
            : h('li', { key, 'data-task': '' }, box[1] === ' ' ? '☐ ' : '☑ ', inline(box[2], key)))
          continue
        }
        if (line.trim() === '') { flushParagraph(); flushList(); continue }
        flushList()
        paragraph.push(line.trim())
      }
      flushParagraph(); flushList()
      return blocks
    }

    // ---------- pieces ----------

    function counts(active) {
      const trace = active.trace ?? {}
      const tasks = Array.isArray(trace.tasks) ? trace.tasks : []
      return { done: tasks.filter((t) => t.done).length, total: tasks.length, drift: Array.isArray(trace.drift) ? trace.drift.length : 0 }
    }

    function SpecPill({ t, view, onOpen }) {
      if (view === undefined) return null
      const active = view.active
      if (active === null) {
        if (view.specs.length === 0) return null
        return h('button', { type: 'button', className: 'dshSpecPill', title: t('pillSpecsHint'), onClick: onOpen, 'data-specs': '' },
          h(IconChecklistOutlineRegular, { size: 14 }), h('span', null, t('pillSpecs', { count: view.specs.length })))
      }
      const c = counts(active)
      const waiting = active.awaiting !== null
      const hint = t('pillHint', { title: active.title, phase: t(`phase.${active.phase}`) })
      return h('button', { type: 'button', className: 'dshSpecPill', title: hint, 'aria-label': hint, 'aria-haspopup': 'dialog', onClick: onOpen, 'data-spec': active.slug, 'data-attention': waiting },
        h(IconChecklistOutlineRegular, { size: 14 }),
        h('span', { className: 'dshSpecPillTitle' }, t('pill', { title: active.title })),
        h('span', { className: 'dshSpecPillState' }, waiting ? `· ${t('reviewShort')}` : active.phase === 'build' ? `· ${t('tasksDone', { done: c.done, total: c.total })}` : `· ${t(`step.${active.phase}`)}`),
        c.drift > 0 && active.phase === 'build' ? h('span', { className: 'dshSpecPillWarn' }, h(IconWarningOutlineRegular, { size: 14 }), t('drift', { count: c.drift })) : null)
    }

    function summaryOf(t, active, doc) {
      const trace = active.trace ?? {}
      const requirements = Array.isArray(trace.requirements) ? trace.requirements : []
      const criteria = requirements.reduce((n, r) => n + (r.criteria ?? 0), 0)
      if (doc === 'requirements') return t('bannerSummary.requirements', { requirements: requirements.length, criteria })
      if (doc === 'design') {
        const text = active.docs?.design?.text ?? ''
        return t('bannerSummary.design', { covered: requirements.filter((r) => text.includes(r.id)).length, requirements: requirements.length })
      }
      return t('bannerSummary.tasks', { tasks: (trace.tasks ?? []).length, criteria })
    }

    /** Approve exactly the text shown, then tell the agent to go on. */
    function useApproval({ t, service, sessionId, active, sendText, onChanged }) {
      const [working, setWorking] = useState(false)
      const [status, setStatus] = useState(undefined)
      const approve = async (doc) => {
        setWorking(true)
        setStatus(undefined)
        try {
          await service.approve(sessionId, doc, active.docs[doc].sha256)
          onChanged()
          await sendText(doc === 'tasks' ? t('approvedTasksMessage') : t('approvedMessage', { file: FILES[doc] }))
          return true
        } catch (error) {
          setStatus({ tone: 'error', text: t('approveFailed', { message: errorText(error) }) })
          onChanged()
          return false
        } finally {
          setWorking(false)
        }
      }
      return { working, status, approve }
    }

    function ReviewBanner(props) {
      const { t, service, sessionId, view, setDraft, sendText, onOpen, onChanged } = props
      const active = view?.active
      const approval = useApproval({ t, service, sessionId, active, sendText, onChanged })
      if (active === undefined || active === null || active.awaiting === null) return null
      const doc = active.awaiting.doc
      const askChanges = async () => {
        try {
          await service.reopen(sessionId, doc)
        } catch {
          // The draft is still useful; the agent sees the request either way.
        }
        onChanged()
        setDraft?.(t('changesDraft', { file: FILES[doc] }))
      }
      return h('div', { className: 'dshSpecBanner', role: 'region', 'aria-label': t('bannerTitle', { file: FILES[doc] }), 'data-spec-review': doc },
        h('div', { className: 'dshSpecBannerText' },
          h('strong', null, t('bannerTitle', { file: FILES[doc] })),
          h('span', null, active.awaiting.current ? summaryOf(t, active, doc) : t('bannerStale'))),
        h('div', { className: 'dshSpecActions' },
          h('button', { type: 'button', className: 'dshSpecBtn', onClick: () => onOpen(doc) }, t('open')),
          h('button', { type: 'button', className: 'dshSpecBtn', disabled: approval.working, onClick: askChanges }, t('askChanges')),
          h('button', { type: 'button', className: 'dshSpecBtn dshSpecBtnPrimary', disabled: approval.working || !active.awaiting.current || (active.docs[doc]?.issues ?? []).some((i) => i.level === 'error'), onClick: () => approval.approve(doc) },
            approval.working ? t('approving') : t('approve'))),
        approval.status === undefined ? null : h('p', { className: 'dshSpecStatus', role: 'status', 'data-tone': approval.status.tone }, approval.status.text))
    }

    function stepState(active, step) {
      if (step === 'build') return active.phase === 'build' ? 'current' : 'later'
      if (active.approvals?.[step] != null) return 'approved'
      if (active.awaiting?.doc === step) return 'waiting'
      return active.phase === step ? 'current' : 'later'
    }

    function DocView({ t, active, doc, sessionId, service, sendText, onChanged }) {
      const entry = active.docs?.[doc]
      const approval = useApproval({ t, service, sessionId, active, sendText, onChanged })
      const issues = entry?.issues ?? []
      const errors = issues.filter((i) => i.level === 'error')
      const warnings = issues.filter((i) => i.level === 'warning')
      const record = active.approvals?.[doc]
      const lastChange = [...(active.changes ?? [])].reverse().find((c) => c.doc === doc)
      const label = record != null ? (record.changedAt != null ? t('approvedChanged', { by: t(`by.${lastChange?.by ?? 'agent'}`) }) : t('approved')) : active.awaiting?.doc === doc ? t('waiting') : entry?.text?.trim() ? t('draft') : t('notYet')
      return h('div', null,
        h('p', { className: 'dshSpecMuted' }, `${entry?.file ?? ''} · ${label}`),
        record == null && errors.length > 0 ? h('ul', { className: 'dshSpecIssues', 'data-level': 'error' }, h('strong', null, t('issues')), errors.map((issue, index) => h('li', { key: index }, issue.text))) : null,
        warnings.length > 0 ? h('ul', { className: 'dshSpecIssues', 'data-level': 'warning' }, h('strong', null, t('warnings')), warnings.map((issue, index) => h('li', { key: index }, issue.text))) : null,
        h('div', { className: 'dshSpecDoc' }, entry?.text?.trim() ? renderMarkdown(entry.text) : h('p', { className: 'dshSpecMuted' }, t('empty'))),
        active.awaiting?.doc === doc
          ? h('div', { className: 'dshSpecFoot' },
            approval.status === undefined ? null : h('p', { className: 'dshSpecStatus', role: 'status', 'data-tone': approval.status.tone }, approval.status.text),
            h('button', { type: 'button', className: 'dshSpecBtn dshSpecBtnPrimary', disabled: approval.working || errors.length > 0, onClick: () => approval.approve(doc) }, approval.working ? t('approving') : t('approve')))
          : null)
    }

    function TraceView({ t, active }) {
      const trace = active.trace ?? {}
      const criteria = Array.isArray(trace.criteria) ? trace.criteria : []
      const c = trace.counts ?? {}
      return h('div', null,
        h('p', { className: 'dshSpecMuted' }, t('counts', { passing: c.passing ?? 0, total: c.total ?? 0, failing: c.failing ?? 0, untested: c.untested ?? 0 })),
        h('p', { className: 'dshSpecMuted' }, trace.run == null ? t('noRun') : t('lastRun', { command: trace.run.command, result: t(trace.run.ok ? 'runPassed' : 'runFailed') })),
        h('h4', null, t('driftTitle')),
        (trace.drift ?? []).length === 0
          ? h('p', { className: 'dshSpecMuted' }, t('noDrift'))
          : h('ul', { className: 'dshSpecList', 'data-drift': '' }, trace.drift.map((item, index) => h('li', { key: index }, inline(item.text, `d${String(index)}`)))),
        h('table', { className: 'dshSpecTable' },
          h('thead', null, h('tr', null, h('th', null, t('criterion')), h('th', null, t('status')), h('th', null, t('tests')), h('th', null, t('tasks')))),
          h('tbody', null, criteria.map((criterion) => h('tr', { key: criterion.id, 'data-criterion': criterion.id },
            h('td', null, h('span', { className: 'dshSpecId' }, criterion.id), ' ', criterion.text),
            h('td', null, h('span', { className: 'dshSpecBadge', 'data-status': criterion.status }, t(`status.${criterion.status}`))),
            h('td', null, (criterion.tests ?? []).map((test) => `${test.file}:${String(test.line)}`).join(', ') || '—'),
            h('td', null, (criterion.tasks ?? []).join(', ') || '—'))))))
    }

    function ChangesView({ t, active }) {
      const changes = [...(active.changes ?? [])].reverse()
      if (changes.length === 0) return h('p', { className: 'dshSpecMuted' }, t('noChanges'))
      return h('ul', { className: 'dshSpecList' }, changes.map((change, index) => h('li', { key: index },
        h('p', { className: 'dshSpecMuted' }, t('changeBy', { doc: FILES[change.doc], by: t(`by.${change.by}`), time: new Date(change.at).toLocaleString() })),
        inline(change.summary, `c${String(index)}`))))
    }

    function PickView({ t, view, sessionId, service, onChanged }) {
      const [status, setStatus] = useState(undefined)
      const use = async (slug) => {
        try {
          await service.activate(sessionId, slug)
          onChanged()
        } catch (error) {
          setStatus(errorText(error))
        }
      }
      return h('div', { className: 'dshSpecPick' },
        h('p', { className: 'dshSpecMuted' }, t('pickIntro')),
        view.specs.map((spec) => h('div', { key: spec.slug, className: 'dshSpecPickRow' },
          h('span', null, h('strong', null, spec.title), ` · ${t(`phase.${spec.phase}`)}`),
          h('button', { type: 'button', className: 'dshSpecBtn', onClick: () => use(spec.slug) }, t('use')))),
        status === undefined ? null : h('p', { className: 'dshSpecStatus', role: 'status', 'data-tone': 'error' }, status))
    }

    function SpecPanel(props) {
      const { t, view, initialTab, onClose, sessionId, service, onChanged } = props
      const active = view.active
      const [tab, setTab] = useState(initialTab ?? (active === null ? 'pick' : active.awaiting?.doc ?? (active.phase === 'build' ? 'trace' : active.phase)))
      if (active === null) {
        return h(Modal, { open: true, onClose, title: t('pickTitle'), closeLabel: t('close'), className: 'dshSpecModal' },
          h('div', { className: 'dshSpecPanel' }, h(PickView, { t, view, sessionId, service, onChanged })))
      }
      const steps = [...DOCS, 'trace', 'changes']
      const stepLabel = (step) => (step === 'trace' ? t('tab.trace') : step === 'changes' ? t('tab.changes') : t(`step.${step}`))
      const stop = async () => {
        await service.activate(sessionId, null).catch(() => {})
        onChanged()
        onClose()
      }
      return h(Modal, { open: true, onClose, title: t('panelTitle', { title: active.title }), closeLabel: t('close'), className: 'dshSpecModal' },
        h('div', { className: 'dshSpecPanel', 'data-spec-panel': active.slug },
          h('p', { className: 'dshSpecMuted' }, t('folder', { folder: `specs/${active.slug}/` })),
          h('ul', { className: 'dshSpecSteps', role: 'tablist' }, steps.map((step) => {
            const state = DOCS.includes(step) ? stepState(active, step) : 'later'
            return h('li', { key: step }, h('button', { type: 'button', role: 'tab', className: 'dshSpecStep', 'data-state': state, 'aria-pressed': tab === step, onClick: () => setTab(step) },
              state === 'approved' ? h(IconCheckCircleFillRegular, { size: 14 }) : step === 'trace' && counts(active).drift > 0 ? h(IconWarningOutlineRegular, { size: 14 }) : null,
              stepLabel(step)))
          })),
          h('div', { className: 'dshSpecBody', role: 'tabpanel' },
            DOCS.includes(tab) ? h(DocView, { key: tab, ...props, active, doc: tab })
              : tab === 'trace' ? h(TraceView, { t, active })
                : h(ChangesView, { t, active })),
          h('div', { className: 'dshSpecFoot' },
            h(Button, { size: 'sm', variant: 'ghost', onClick: stop }, t('stop')))))
    }

    function SpecDock(props) {
      const sessionId = props.session?.sessionId ?? props.sessionId
      const [state, reload] = useSpec(props.service, sessionId, props.session?.running)
      const [open, setOpen] = useState(undefined)
      if (sessionId === undefined) return null
      const view = state.status === 'ready' ? state.view : undefined
      const sendText = props.sendText ?? props.sendTextFor?.(sessionId)
      return h(React.Fragment, null,
        h(SpecPill, { t: props.t, view, onOpen: () => setOpen({}) }),
        open !== undefined && view !== undefined ? h(SpecPanel, { ...props, sendText, sessionId, view, initialTab: open.tab, onClose: () => setOpen(undefined), onChanged: reload }) : null)
    }

    // The banner shares the dock's data through the service's cache-free
    // route; it keeps its own copy so each slot stays independent.
    function SpecReview(props) {
      const sessionId = props.session?.sessionId ?? props.sessionId
      const [state, reload] = useSpec(props.service, sessionId, props.session?.running)
      const [open, setOpen] = useState(undefined)
      if (sessionId === undefined || state.status !== 'ready') return null
      const sendText = props.sendText ?? props.sendTextFor?.(sessionId)
      return h(React.Fragment, null,
        h(ReviewBanner, { ...props, sendText, sessionId, view: state.view, setDraft: props.inputActions?.setDraft, onOpen: (doc) => setOpen(doc), onChanged: reload }),
        open !== undefined ? h(SpecPanel, { ...props, sendText, sessionId, view: state.view, initialTab: open, onClose: () => setOpen(undefined), onChanged: reload }) : null)
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
      const service = createSpecService()
      const sendTextFor = (sessionId) => (text) => {
        const conversation = ctx.get('sessions')?.scope(sessionId)?.get('conversation')
        if (!conversation || typeof conversation.send !== 'function') throw new Error('the conversation is not available')
        return conversation.send(text)
      }
      ctx.inject(['slots', 'locale'], (scope) => {
        installStyles()
        scope.effect(() => scope.locale.register(NS, { zh, en }))
        // After the context pill (35).
        scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-desktop-specs',
          order: 36,
          locale: NS,
          inject: () => ({ service, sendTextFor })
        }, SpecDock))
        // Above the composer, before the starters (90).
        scope.slots.inject('conversation.input.dock', () => scope.slots.register({
          name: 'conversation.input.dock',
          id: 'dsh-desktop-specs-review',
          order: 80,
          locale: NS,
          inject: () => ({ service, sendTextFor })
        }, SpecReview))
      })
    }

    const inject = []

    exports.apply = apply
    exports.inject = inject
    exports.createSpecService = createSpecService
    exports.renderMarkdown = renderMarkdown
    exports.SpecPill = SpecPill
    exports.SpecPanel = SpecPanel
    exports.ReviewBanner = ReviewBanner
    exports.SpecDock = SpecDock
    exports.SpecReview = SpecReview
    exports.ID_PATTERN = ID_PATTERN
    exports.locales = { en, zh }
    return module.exports
  }
})
