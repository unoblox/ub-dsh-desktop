window.__ModuleLoader__.load({
  id: 'dsh-desktop-context-graph',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React
    const {
      Button,
      Modal,
      IconWorkspaceTreeOutlineRegular,
      IconPinOutlineRegular,
      IconPinFillRegular,
      IconEditOutlineRegular,
      IconTrashOutlineRegular,
      IconCheckOutlineRegular,
      IconWarningOutlineRegular,
      IconSearchOutlineRegular
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    // The Context pill under the composer and its panel: what the context
    // graph (index.js) keeps for this workspace, with pin, edit, delete and
    // add. Served by two same-origin routes behind the Harness session cookie.

    const NS = 'desktop-context-graph'
    const GRAPH_ROUTE = '/api/desktop-context-graph'
    const ITEM_ROUTE = '/api/desktop-context-graph/item'
    const STYLE_ID = 'dsh-desktop-context-graph-style'
    const KIND_ORDER = ['rule', 'goal', 'task', 'decision', 'error', 'fact']
    const ADDABLE = ['rule', 'fact', 'decision', 'task']

    const en = {
      pill: 'Context {count}',
      pillChanged: '{count} changed',
      pillHint: 'Context graph: {count} items kept across compactions for this workspace. Click to review, pin, correct or remove them.',
      pillHintChanged: '{changed} of them refer to files that changed since they were recorded.',
      panelTitle: 'Context graph',
      close: 'Close',
      panelIntro: 'What the agent keeps for this workspace across compactions and conversations. It is shown to the agent on every request; correct or remove anything wrong.',
      workspace: 'Workspace: {path}',
      search: 'Search items',
      loading: 'Loading…',
      loadFailed: 'Could not load the context graph: {message}',
      empty: 'Nothing recorded yet. Items appear when a long conversation is compacted, or add one below.',
      noMatch: 'No items match.',
      'kind.rule': 'Rules',
      'kind.goal': 'Goal',
      'kind.task': 'Tasks',
      'kind.decision': 'Decisions',
      'kind.error': 'Errors and fixes',
      'kind.fact': 'Facts',
      'add.rule': 'Rule',
      'add.fact': 'Fact',
      'add.decision': 'Decision',
      'add.task': 'Task',
      addLabel: 'Add an item',
      addKind: 'Kind',
      addPlaceholder: 'For example: Always answer in English.',
      add: 'Add',
      pin: 'Pin',
      unpin: 'Unpin',
      edit: 'Edit',
      save: 'Save',
      cancel: 'Cancel',
      remove: 'Remove',
      removeConfirm: 'Remove this item?',
      done: 'Mark done',
      doneBadge: 'done',
      pinnedBadge: 'pinned',
      yoursBadge: 'edited by you',
      sessionBadge: 'this conversation',
      quoted: 'Your words',
      paraphrased: 'paraphrased',
      fileChanged: 'changed since recorded',
      fileMissing: 'no longer exists',
      changeFailed: 'Could not save the change: {message}'
    }
    const zh = {
      pill: '上下文 {count}',
      pillChanged: '{count} 项已变更',
      pillHint: '上下文图谱：为此工作区在多次压缩之间保留的 {count} 项内容。点击可查看、固定、更正或删除。',
      pillHintChanged: '其中 {changed} 项涉及的文件在记录后已被修改。',
      panelTitle: '上下文图谱',
      close: '关闭',
      panelIntro: '智能体在多次压缩和多个对话之间为此工作区保留的内容。每次请求都会提供给智能体；如有错误，请更正或删除。',
      workspace: '工作区：{path}',
      search: '搜索条目',
      loading: '正在加载…',
      loadFailed: '无法加载上下文图谱：{message}',
      empty: '尚无记录。长对话被压缩时会自动记录，也可以在下方添加。',
      noMatch: '没有匹配的条目。',
      'kind.rule': '规则',
      'kind.goal': '目标',
      'kind.task': '任务',
      'kind.decision': '决定',
      'kind.error': '错误与修复',
      'kind.fact': '事实',
      'add.rule': '规则',
      'add.fact': '事实',
      'add.decision': '决定',
      'add.task': '任务',
      addLabel: '添加条目',
      addKind: '类型',
      addPlaceholder: '例如：始终用中文回答。',
      add: '添加',
      pin: '固定',
      unpin: '取消固定',
      edit: '编辑',
      save: '保存',
      cancel: '取消',
      remove: '删除',
      removeConfirm: '删除此条目？',
      done: '标记完成',
      doneBadge: '已完成',
      pinnedBadge: '已固定',
      yoursBadge: '由你编辑',
      sessionBadge: '此对话',
      quoted: '你的原话',
      paraphrased: '转述',
      fileChanged: '记录后已修改',
      fileMissing: '已不存在',
      changeFailed: '无法保存更改：{message}'
    }

    const STYLE = `
      .dshCtxPill{box-sizing:border-box;flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border:0;border-radius:999px;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;cursor:pointer}
      .dshCtxPill:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .dshCtxPill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dshCtxPill svg{flex:none;width:14px;height:14px}
      .dshCtxPillChanged{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary))}
      .dshCtxModal.dshCtxModal{width:min(680px,100%);max-width:none}
      .dshCtxPanel{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;width:100%;min-width:0;max-height:min(70vh,720px)}
      .dshCtxIntro,.dshCtxWorkspace{margin:0;font-size:13px;line-height:19px;color:var(--dsw-alias-label-secondary)}
      .dshCtxWorkspace{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dshCtxSearch{display:flex;align-items:center;gap:8px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
      .dshCtxSearch:focus-within{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
      .dshCtxSearch input,.dshCtxAdd input,.dshCtxAdd select,.dshCtxEdit textarea{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:none}
      .dshCtxSearch input{flex:1;min-width:0;height:32px;border:0;outline:none}
      .dshCtxList{flex:1;min-height:80px;overflow:auto;display:flex;flex-direction:column;gap:14px;padding-right:4px}
      .dshCtxGroup h3{margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary)}
      .dshCtxGroup ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
      .dshCtxItem{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
      .dshCtxItemBody{flex:1;min-width:0;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
      .dshCtxQuote{margin:0}
      .dshCtxMeta{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
      .dshCtxBadge{padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2)}
      .dshCtxFile{font-family:var(--dsh-font-mono,ui-monospace,monospace)}
      .dshCtxFile[data-state=changed],.dshCtxFile[data-state=missing]{color:var(--dsw-alias-state-error-primary)}
      .dshCtxActions{display:flex;gap:2px;flex:none}
      .dshCtxIconBtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer}
      .dshCtxIconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dshCtxIconBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dshCtxIconBtn:disabled{opacity:.5;cursor:default}
      .dshCtxIconBtn svg{width:16px;height:16px}
      .dshCtxConfirm{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .dshCtxEdit{display:flex;flex-direction:column;gap:6px}
      .dshCtxEdit textarea{width:100%;box-sizing:border-box;min-height:56px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;resize:vertical}
      .dshCtxRow{display:flex;gap:6px;justify-content:flex-end}
      .dshCtxAdd{display:flex;gap:8px;align-items:center;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2)}
      .dshCtxAdd select{height:32px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
      .dshCtxAdd input{flex:1;min-width:0;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
      .dshCtxStatus{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary)}
      .dshCtxStatus[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
      .dshCtxSr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
    `

    function installStyles() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = STYLE
      document.head.appendChild(tag)
    }

    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    function errorText(error) {
      return error instanceof Error ? error.message : String(error)
    }

    // ---------- data (pure) ----------

    /** The route body as the panel uses it; anything malformed is left out. */
    function toView(body) {
      if (!isRecord(body) || !Array.isArray(body.items)) return undefined
      const items = body.items.filter((item) => isRecord(item) && typeof item.id === 'string' && KIND_ORDER.includes(item.kind) && typeof item.text === 'string')
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          text: item.text,
          ...(typeof item.quote === 'string' ? { quote: item.quote } : {}),
          ...(typeof item.status === 'string' ? { status: item.status } : {}),
          pinned: item.pinned === true,
          mine: item.origin === 'user',
          shared: item.shared !== false,
          files: Array.isArray(item.files) ? item.files.filter((file) => isRecord(file) && typeof file.path === 'string').map((file) => ({ path: file.path, state: typeof file.state === 'string' ? file.state : 'unknown' })) : []
        }))
      return { workspace: typeof body.workspace === 'string' ? body.workspace : undefined, items }
    }

    /** Items needing a look: they refer to a file that changed or is gone. */
    function changedCount(items) {
      return items.filter((item) => item.files.some((file) => file.state === 'changed' || file.state === 'missing')).length
    }

    /** Groups in display order; finished tasks last within tasks. */
    function groupItems(items) {
      return KIND_ORDER.map((kind) => [kind, items.filter((item) => item.kind === kind)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(a.status === 'done') - Number(b.status === 'done'))])
        .filter(([, group]) => group.length > 0)
    }

    // ---------- network (service) ----------

    function createGraphService(doFetch = (...args) => fetch(...args)) {
      return {
        async list(sessionId, query, signal) {
          const params = new URLSearchParams({ session: sessionId })
          if (query !== undefined && query.trim() !== '') params.set('q', query.trim())
          const response = await doFetch(`${GRAPH_ROUTE}?${params.toString()}`, { credentials: 'same-origin', cache: 'no-store', signal })
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          const view = toView(await response.json())
          if (view === undefined) throw new Error('unexpected response shape')
          return view
        },
        async change(sessionId, change) {
          const response = await doFetch(ITEM_ROUTE, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: sessionId, ...change })
          })
          let body
          try { body = await response.json() } catch { body = undefined }
          if (!response.ok) throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${String(response.status)}`)
        }
      }
    }

    /**
     * The graph for one conversation: loaded on mount, on session change,
     * when a turn ends (compaction may have added items) and on reload().
     * A newer load cancels the older one; results after unmount are dropped.
     */
    function useGraph(service, sessionId, running, query) {
      const [state, setState] = useState({ status: 'loading' })
      const controller = useRef(undefined)
      const reload = useCallback(() => {
        if (sessionId === undefined) return
        controller.current?.abort()
        const current = new AbortController()
        controller.current = current
        service.list(sessionId, query, current.signal).then(
          (view) => { if (!current.signal.aborted) setState({ status: 'ready', view }) },
          (error) => { if (!current.signal.aborted) setState((previous) => previous.status === 'ready' ? previous : { status: 'error', message: errorText(error) }) }
        )
      }, [service, sessionId, query])
      useEffect(() => {
        reload()
        return () => controller.current?.abort()
      }, [reload])
      const wasRunning = useRef(running)
      useEffect(() => {
        if (wasRunning.current === true && running === false) reload()
        wasRunning.current = running
      }, [running, reload])
      return [state, reload]
    }

    // ---------- display ----------

    function ContextPill({ t, view, onOpen }) {
      if (view === undefined || view.items.length === 0) return null
      const count = view.items.filter((item) => item.status !== 'done').length
      const changed = changedCount(view.items)
      const hint = changed === 0 ? t('pillHint', { count }) : `${t('pillHint', { count })} ${t('pillHintChanged', { changed })}`
      return h('button', { type: 'button', className: 'dshCtxPill', title: hint, 'aria-label': hint, 'aria-haspopup': 'dialog', onClick: onOpen, 'data-context-graph': '' },
        h(IconWorkspaceTreeOutlineRegular, { size: 14 }),
        h('span', null, t('pill', { count })),
        changed > 0 ? h('span', { className: 'dshCtxPillChanged' }, h(IconWarningOutlineRegular, { size: 14 }), ` ${t('pillChanged', { count: changed })}`) : null)
    }

    function IconButton({ label, icon, onClick, disabled, pressed }) {
      return h('button', { type: 'button', className: 'dshCtxIconBtn', title: label, 'aria-label': label, onClick, disabled, ...(pressed === undefined ? {} : { 'aria-pressed': pressed }) }, icon)
    }

    function ItemRow({ t, item, busy, onChange }) {
      const [mode, setMode] = useState('view')
      const [draft, setDraft] = useState(item.quote ?? item.text)
      const editRef = useRef(null)
      useEffect(() => { if (mode === 'edit') editRef.current?.focus() }, [mode])
      const meta = []
      if (item.pinned) meta.push(h('span', { key: 'pinned', className: 'dshCtxBadge' }, t('pinnedBadge')))
      if (item.status === 'done') meta.push(h('span', { key: 'done', className: 'dshCtxBadge' }, t('doneBadge')))
      if (item.mine) meta.push(h('span', { key: 'mine', className: 'dshCtxBadge' }, t('yoursBadge')))
      if (!item.shared) meta.push(h('span', { key: 'session', className: 'dshCtxBadge' }, t('sessionBadge')))
      if (item.kind === 'rule' && item.quote === undefined) meta.push(h('span', { key: 'para', className: 'dshCtxBadge' }, t('paraphrased')))
      for (const file of item.files) {
        const note = file.state === 'changed' ? ` (${t('fileChanged')})` : file.state === 'missing' ? ` (${t('fileMissing')})` : ''
        meta.push(h('span', { key: `f:${file.path}`, className: 'dshCtxFile', 'data-state': file.state }, `${file.path}${note}`))
      }
      const body = mode === 'edit'
        ? h('div', { className: 'dshCtxEdit' },
          h('textarea', { ref: editRef, value: draft, 'aria-label': t('edit'), maxLength: 600, onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Escape') { event.stopPropagation(); setMode('view') } } }),
          h('div', { className: 'dshCtxRow' },
            h(Button, { size: 'sm', variant: 'ghost', onClick: () => setMode('view') }, t('cancel')),
            h(Button, { size: 'sm', variant: 'primary', disabled: busy || draft.trim() === '', onClick: () => onChange({ action: 'edit', id: item.id, text: draft }).then((ok) => { if (ok) setMode('view') }) }, t('save'))))
        : h(React.Fragment, null,
          item.quote === undefined
            ? h('p', { className: 'dshCtxQuote' }, item.text)
            : h('p', { className: 'dshCtxQuote' }, h('span', { className: 'dshCtxSr' }, `${t('quoted')}: `), `“${item.quote}”`),
          meta.length > 0 ? h('div', { className: 'dshCtxMeta' }, ...meta) : null)
      const actions = mode === 'confirm'
        ? h('div', { className: 'dshCtxConfirm', role: 'group', 'aria-label': t('removeConfirm') },
          h('span', null, t('removeConfirm')),
          h(Button, { size: 'sm', variant: 'ghost', onClick: () => setMode('view') }, t('cancel')),
          h(Button, { size: 'sm', variant: 'primary', disabled: busy, onClick: () => onChange({ action: 'delete', id: item.id }) }, t('remove')))
        : mode === 'view'
          ? h('div', { className: 'dshCtxActions' },
            item.kind === 'task' && item.status !== 'done' ? h(IconButton, { label: t('done'), icon: h(IconCheckOutlineRegular, { size: 16 }), disabled: busy, onClick: () => onChange({ action: 'done', id: item.id }) }) : null,
            h(IconButton, { label: item.pinned ? t('unpin') : t('pin'), pressed: item.pinned, icon: h(item.pinned ? IconPinFillRegular : IconPinOutlineRegular, { size: 16 }), disabled: busy, onClick: () => onChange({ action: item.pinned ? 'unpin' : 'pin', id: item.id }) }),
            h(IconButton, { label: t('edit'), icon: h(IconEditOutlineRegular, { size: 16 }), disabled: busy, onClick: () => { setDraft(item.quote ?? item.text); setMode('edit') } }),
            h(IconButton, { label: t('remove'), icon: h(IconTrashOutlineRegular, { size: 16 }), disabled: busy, onClick: () => setMode('confirm') }))
          : null
      return h('li', { className: 'dshCtxItem', 'data-item': item.id }, h('div', { className: 'dshCtxItemBody' }, body), actions)
    }

    function AddForm({ t, busy, onAdd }) {
      const [kind, setKind] = useState('rule')
      const [text, setText] = useState('')
      return h('form', {
        className: 'dshCtxAdd',
        'aria-label': t('addLabel'),
        onSubmit: (event) => {
          event.preventDefault()
          if (text.trim() === '') return
          onAdd({ action: 'add', kind, text }).then((ok) => { if (ok) setText('') })
        }
      },
      h('select', { value: kind, 'aria-label': t('addKind'), onChange: (event) => setKind(event.target.value) }, ...ADDABLE.map((value) => h('option', { key: value, value }, t(`add.${value}`)))),
      h('input', { value: text, maxLength: 600, placeholder: t('addPlaceholder'), 'aria-label': t('addLabel'), onChange: (event) => setText(event.target.value) }),
      h(Button, { type: 'submit', size: 'sm', variant: 'primary', disabled: busy || text.trim() === '' }, t('add')))
    }

    function ContextPanel({ t, service, sessionId, onClose, onChanged }) {
      const [query, setQuery] = useState('')
      const [debounced, setDebounced] = useState('')
      useEffect(() => {
        const timer = setTimeout(() => setDebounced(query), 200)
        return () => clearTimeout(timer)
      }, [query])
      const [state, reload] = useGraph(service, sessionId, undefined, debounced)
      const [busy, setBusy] = useState(false)
      const [failure, setFailure] = useState(undefined)
      const change = async (request) => {
        setBusy(true)
        setFailure(undefined)
        try {
          await service.change(sessionId, request)
          reload()
          onChanged()
          return true
        } catch (error) {
          setFailure(t('changeFailed', { message: errorText(error) }))
          return false
        } finally {
          setBusy(false)
        }
      }
      let list
      if (state.status === 'loading') list = h('p', { className: 'dshCtxStatus', role: 'status' }, t('loading'))
      else if (state.status === 'error') list = h('p', { className: 'dshCtxStatus', role: 'alert', 'data-tone': 'error' }, t('loadFailed', { message: state.message }))
      else if (state.view.items.length === 0) list = h('p', { className: 'dshCtxStatus', role: 'status' }, debounced.trim() === '' ? t('empty') : t('noMatch'))
      else {
        list = h('div', { className: 'dshCtxList' }, ...groupItems(state.view.items).map(([kind, group]) => h('section', { key: kind, className: 'dshCtxGroup', 'aria-label': t(`kind.${kind}`) },
          h('h3', null, t(`kind.${kind}`)),
          h('ul', null, ...group.map((item) => h(ItemRow, { key: item.id, t, item, busy, onChange: change }))))))
      }
      const workspace = state.status === 'ready' ? state.view.workspace : undefined
      return h(Modal, { open: true, onClose: () => { if (!busy) onClose() }, title: t('panelTitle'), closeLabel: t('close'), className: 'dshCtxModal' },
        h('div', { className: 'dshCtxPanel' },
          h('p', { className: 'dshCtxIntro' }, t('panelIntro')),
          workspace === undefined ? null : h('p', { className: 'dshCtxWorkspace', title: workspace }, t('workspace', { path: workspace })),
          h('label', { className: 'dshCtxSearch' },
            h(IconSearchOutlineRegular, { size: 16 }),
            h('span', { className: 'dshCtxSr' }, t('search')),
            h('input', { type: 'search', value: query, placeholder: t('search'), 'data-modal-autofocus': '', onChange: (event) => setQuery(event.target.value) })),
          list,
          failure === undefined ? null : h('p', { className: 'dshCtxStatus', role: 'alert', 'data-tone': 'error' }, failure),
          h(AddForm, { t, busy, onAdd: change })))
    }

    function ContextDock(props) {
      const sessionId = props.session?.sessionId ?? props.sessionId
      const [state, reload] = useGraph(props.service, sessionId, props.session?.running, '')
      const [open, setOpen] = useState(false)
      if (sessionId === undefined) return null
      const view = state.status === 'ready' ? state.view : undefined
      return h(React.Fragment, null,
        h(ContextPill, { t: props.t, view, onOpen: () => setOpen(true) }),
        open ? h(ContextPanel, { t: props.t, service: props.service, sessionId, onClose: () => setOpen(false), onChanged: reload }) : null)
    }

    // ---------- composition ----------

    function apply(ctx) {
      ctx.inject(['slots', 'locale'], (scope) => {
        installStyles()
        scope.effect(() => scope.locale.register(NS, { zh, en }))
        const service = createGraphService()
        // After the stock stats pills (0), the PPT chooser (20) and the unoblox strip (30).
        scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-desktop-context-graph',
          order: 35,
          locale: NS,
          inject: () => ({ service })
        }, ContextDock))
      })
    }

    const inject = []

    exports.apply = apply
    exports.inject = inject
    exports.toView = toView
    exports.changedCount = changedCount
    exports.groupItems = groupItems
    exports.createGraphService = createGraphService
    exports.ContextPill = ContextPill
    exports.ContextPanel = ContextPanel
    exports.ContextDock = ContextDock
    exports.locales = { en, zh }
    return module.exports
  }
})
