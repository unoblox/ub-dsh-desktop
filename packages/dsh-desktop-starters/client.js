window.__ModuleLoader__.load({
  id: 'dsh-desktop-starters',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // Starters: plain-language examples above the composer of a new, empty
    // conversation, for people who do not write code. A click puts the
    // example in the composer for the user to adjust and send; nothing is
    // sent by itself. [Brackets] mark the parts to fill in.

    const NS = 'desktop-starters'
    const STYLE_ID = 'dsh-desktop-starters-style'
    const STARTERS = ['report', 'slides', 'notes', 'calculator', 'cleanup', 'summary', 'email', 'bug', 'spec']

    const en = {
      label: 'Start from an example',
      'title.report': 'Report from a spreadsheet',
      'prompt.report': 'Read the spreadsheet [file name] in this folder and make a short report as a Word document: the key numbers, one chart, and three takeaways in plain language.',
      'title.slides': 'Slide deck',
      'prompt.slides': 'Make a 6-slide presentation about [topic] for [audience]. Keep the language simple, one idea per slide, and add speaker notes.',
      'title.notes': 'Notes into a document',
      'prompt.notes': 'Turn my notes in [file or folder] into a tidy document: clear headings, a short summary at the top and action items at the end.',
      'title.calculator': 'Calculator',
      'prompt.calculator': 'Make an interactive calculator for [what to calculate], with inputs I can change, the result updating as I type, and a chart.',
      'title.cleanup': 'Clean up a spreadsheet',
      'prompt.cleanup': 'Clean up the spreadsheet [file name]: fix dates and number formats, remove duplicate rows, and add a summary sheet. Save it as a new file and keep the original unchanged.',
      'title.summary': 'Summarise documents',
      'prompt.summary': 'Read the documents in [folder] and give me a one-page summary: the main points, open questions, and anything that needs my decision.',
      'title.email': 'Draft an email',
      'prompt.email': 'Draft a clear, polite email to [who] about [what]. Keep it under 150 words and end with one clear request.',
      'title.bug': 'Fix a problem in code',
      'prompt.bug': 'Something is wrong in this project: [describe what happens and what you expected]. Find the cause, fix it, and run the tests to show it works.',
      'title.spec': 'Build a feature with a spec',
      'prompt.spec': 'Use a spec to build [the feature] for [who it is for]. Start with the requirements and ask me what is unclear; I will approve the requirements, design and tasks before you code.'
    }
    const zh = {
      label: '从示例开始',
      'title.report': '用表格生成报告',
      'prompt.report': '读取此文件夹中的表格 [文件名]，生成一份 Word 简报：关键数字、一张图表，以及三条通俗易懂的结论。',
      'title.slides': '幻灯片',
      'prompt.slides': '为 [受众] 制作一份关于 [主题] 的 6 页演示文稿。语言简单，每页一个要点，并附上演讲备注。',
      'title.notes': '笔记整理成文档',
      'prompt.notes': '把 [文件或文件夹] 中的笔记整理成一份规整的文档：清晰的标题，开头一段简短摘要，结尾列出待办事项。',
      'title.calculator': '计算器',
      'prompt.calculator': '做一个用于 [要计算的内容] 的交互式计算器：输入可调整，结果随输入实时更新，并配一张图表。',
      'title.cleanup': '整理表格',
      'prompt.cleanup': '整理表格 [文件名]：修正日期和数字格式，删除重复行，并添加一个汇总表。另存为新文件，保持原文件不变。',
      'title.summary': '总结文档',
      'prompt.summary': '阅读 [文件夹] 中的文档，给我一页摘要：主要内容、未解决的问题，以及需要我决定的事项。',
      'title.email': '起草邮件',
      'prompt.email': '给 [收件人] 起草一封关于 [事项] 的邮件，清晰礼貌，不超过 150 字，结尾提出一个明确的请求。',
      'title.bug': '修复代码问题',
      'prompt.bug': '这个项目出了问题：[描述发生了什么、你期望的结果]。找出原因并修复，然后运行测试证明问题已解决。',
      'title.spec': '按规格构建功能',
      'prompt.spec': '用规格为 [使用者] 构建 [功能]。先写需求，有不清楚的地方先问我；需求、设计和任务都由我批准后再开始编码。'
    }

    const STYLE = `
      .dshStarters{display:flex;flex-direction:column;gap:8px;margin:2px 0 12px;width:100%}
      .dshStartersLabel{font-size:12px;color:var(--dsw-alias-label-tertiary)}
      .dshStartersList{display:flex;flex-wrap:wrap;gap:8px}
      .dshStarter{display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:18px;cursor:pointer}
      .dshStarter:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dshStarter:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
    `

    function installStyles() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = STYLE
      document.head.appendChild(tag)
    }

    /** Shown only above the composer of a new conversation the user has not typed into. */
    function StarterStrip(props) {
      const { t, session, inputActions, input } = props
      if (session?.blank !== true || session.running === true || typeof inputActions?.setDraft !== 'function') return null
      if (typeof input?.draft === 'string' && input.draft.trim() !== '') return null
      const choose = (id) => {
        inputActions.setDraft(t(`prompt.${id}`))
        props.focus?.()
      }
      return h('div', { className: 'dshStarters', 'data-starters': '' },
        h('span', { className: 'dshStartersLabel', id: 'dsh-starters-label' }, t('label')),
        h('div', { className: 'dshStartersList', role: 'group', 'aria-labelledby': 'dsh-starters-label' },
          ...STARTERS.map((id) => h('button', { key: id, type: 'button', className: 'dshStarter', title: t(`prompt.${id}`), onClick: () => choose(id) }, t(`title.${id}`)))))
    }

    const inject = []
    function apply(ctx) {
      ctx.inject(['slots', 'locale'], (scope) => {
        installStyles()
        scope.effect(() => scope.locale.register(NS, { zh, en }))
        // Above the composer card, which has the full width; the dock below
        // it is one row of small pills.
        scope.slots.inject('conversation.input.dock', () => scope.slots.register({
          name: 'conversation.input.dock',
          id: 'dsh-desktop-starters',
          order: 90,
          locale: NS,
          inject: (sessionId) => ({
            focus: () => {
              try {
                const sessionScope = ctx.get('sessions')?.scope(sessionId)
                if (sessionScope !== undefined) ctx.get('conversation')?.input?.for(sessionScope)?.focus()
              } catch {
                // Focus is a convenience; the draft is already in place.
              }
            }
          })
        }, StarterStrip))
      })
    }

    exports.apply = apply
    exports.inject = inject
    exports.STARTERS = STARTERS
    exports.StarterStrip = StarterStrip
    exports.locales = { en, zh }
    return module.exports
  }
})
