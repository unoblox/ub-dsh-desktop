window.__ModuleLoader__.load({
  id: 'dsh-desktop-client-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { MenuItemButton } = require('@deepseek-ai/dsh-client-ui-primitives')

    // unoblox mark (build/brand/unoblox-mark.svg without its tile): a "u" in
    // currentColor, so it follows the text colour in both themes, and the gold
    // dot. The gold is the brand asset's own colour, not a theme colour.
    const BRAND_GOLD = '#D9A64A'
    const U_PATH = 'M288 360V563A124.5 124.5 0 0 0 537 563V360M537 360V736'
    // Tight bounds of the glyph in the mark's 1024 space: x 240..810, y 360..762.
    const GLYPH_VIEWBOX = { x: 240, y: 360, width: 570, height: 402 }

    function UnobloxGlyph({ width, className }) {
      return React.createElement(
        'svg',
        {
          width,
          height: width * GLYPH_VIEWBOX.height / GLYPH_VIEWBOX.width,
          className,
          viewBox: `${GLYPH_VIEWBOX.x} ${GLYPH_VIEWBOX.y} ${GLYPH_VIEWBOX.width} ${GLYPH_VIEWBOX.height}`,
          fill: 'none',
          'aria-hidden': 'true'
        },
        React.createElement('path', { d: U_PATH, stroke: 'currentColor', strokeWidth: 96 }),
        React.createElement('circle', { cx: 720, cy: 672, r: 90, fill: BRAND_GOLD })
      )
    }

    function DesktopBrandMark() {
      return React.createElement(UnobloxGlyph, { width: 22 })
    }

    // The product wordmark "unoblox works", always lowercase (see
    // src/shared/brand.ts): "unoblox" in the unoblox.ai header style
    // (semibold, tight tracking), "works" lighter, then the gold full stop.
    // Real text, so it is read out as "unoblox works".
    function DesktopBrandName() {
      return React.createElement(
        'span',
        {
          'data-unoblox-wordmark': '',
          style: { fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, whiteSpace: 'nowrap', color: 'currentColor' }
        },
        'unoblox ',
        React.createElement('span', { style: { fontWeight: 400 } }, 'works'),
        React.createElement('span', { style: { color: BRAND_GOLD }, 'aria-hidden': 'true' }, '.')
      )
    }

    // The hero slot passes the fish's props (`size` is the width in px).
    function ConversationBrandMark({ size = 34, className }) {
      return React.createElement(UnobloxGlyph, { width: size, className })
    }

    function OpenUnpreviewableFile({ absolutePath, openWorkspacePath }) {
      const [error, setError] = React.useState('')
      const label = document.documentElement.lang?.toLowerCase().startsWith('zh')
        ? '用本地应用打开'
        : 'Open with local app'
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('button', {
          type: 'button',
          'data-textpreview-open-local': true,
          onClick: () => {
            setError('')
            void openWorkspacePath(absolutePath).catch((reason) => {
              setError(reason instanceof Error ? reason.message : String(reason))
            })
          }
        }, label),
        error && React.createElement('span', { role: 'alert' }, error)
      )
    }

    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, deleteSession }) {
      const [, setMenuOpen] = useMenuOpenState()
      const chinese = document.documentElement.lang?.toLowerCase().startsWith('zh')
      const label = chinese ? '永久删除会话' : 'Delete session permanently'
      const warning = chinese
        ? `确定删除“${displayTitle || sessionId}”？工作区文件会保留。此操作无法撤销。`
        : `Delete “${displayTitle || sessionId}”? Workspace files are kept. This can’t be undone.`
      return React.createElement(MenuItemButton, {
        danger: true,
        onSelect: () => {
          setMenuOpen(false)
          if (!window.confirm(warning)) return
          void Promise.resolve().then(() => deleteSession(sessionId)).catch((reason) => {
            window.alert(reason instanceof Error ? reason.message : String(reason))
          })
        }
      }, label)
    }

    function OpenSessionFolderMenuItem({ sessionId, useMenuOpenState, openInFinder }) {
      const [, setMenuOpen] = useMenuOpenState()
      if (typeof window.dshDesktop?.openInFinder !== 'function') return null
      const chinese = document.documentElement.lang?.toLowerCase().startsWith('zh')
      const label = chinese ? '在文件管理器中打开' : 'Open in file manager'
      return React.createElement(MenuItemButton, {
        onSelect: () => {
          setMenuOpen(false)
          void Promise.resolve().then(() => openInFinder(sessionId)).catch((reason) => {
            window.alert(reason instanceof Error ? reason.message : String(reason))
          })
        }
      }, label)
    }

    function UnreadSessionMenuItem({ sessionId, unread, onUnreadChange, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState()
      const chinese = document.documentElement.lang?.toLowerCase().startsWith('zh')
      return React.createElement(MenuItemButton, {
        onSelect: () => {
          setMenuOpen(false)
          onUnreadChange(sessionId, !unread)
        }
      }, unread ? (chinese ? '标为已读' : 'Mark as read') : (chinese ? '标为未读' : 'Mark as unread'))
    }

    const inject = ['slots', 'remote.session', 'sessions', 'uiWorkspace']
    function apply(ctx) {
      ctx.effect(() => {
        const id = 'dsh-desktop-preset-toolbar-style'
        if (document.getElementById(id)) return
        const style = document.createElement('style')
        style.id = id
        style.textContent = `
          [data-dsh-preset-heading] { display:flex; align-items:center; flex-wrap:wrap; gap:12px 16px; }
          [data-dsh-preset-heading] h2 { margin:0; }
          [data-dsh-preset-actions] { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-left:auto; }
          [data-dsh-preset-actions] button { white-space:nowrap; }
          [data-dsh-preset-search] { margin-bottom:16px; }
          [data-dsh-preset-search] input[type=search] {
            box-sizing:border-box; width:100%; min-width:0; height:36px;
            border:1px solid var(--dsw-alias-border-l2); border-radius:10px;
            background:var(--dsw-alias-bg-module-platform); color:var(--dsw-alias-label-primary);
            padding:0 12px; font:inherit; font-size:13px;
          }
          [data-dsh-preset-search] input[type=search]::placeholder { color:var(--dsw-alias-label-caption); }
          [data-dsh-preset-search] input[type=search]:focus-visible {
            outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px;
            background:var(--dsw-alias-bg-base);
          }
          /* Readability. Upstream's light theme draws tertiary and caption
             text at 3.7:1 and 2.1:1 against white, below WCAG AA (4.5:1), and
             dark captions fall to 3.3:1 on raised surfaces. Settings
             descriptions, section labels, placeholders and icon buttons all
             use them. These keep the same order (primary, secondary,
             tertiary, caption) at 4.7:1 or more on every surface. */
          body:not([data-ds-dark-theme]) {
            --dsw-alias-label-secondary:#50555c;
            --dsw-alias-label-tertiary:#5a5f66;
            --dsw-alias-label-caption:#646970;
          }
          body[data-ds-dark-theme] {
            --dsw-alias-label-caption:#a3a8b0;
          }
          /* Links and the blue accent were 4.2:1 on white and 3.6:1 on tinted
             badges; one step deeper reads at 4.8:1 or more. */
          body:not([data-ds-dark-theme]) { --dsw-alias-state-business-primary:#2f62d0; --dsw-alias-link:#2f62d0; }
          /* Session times and status tags were 10px. */
          [class*="_sessionRow"] [class*="_time"], [class*="_statusTag"] { font-size:11px; }
          /* The latest reply keeps its actions (copy, branch, usage) in view;
             upstream shows them only on hover, so they went unnoticed. Older
             turns still reveal theirs on hover. */
          [data-chat-flow-kind]:not(:has(~ [data-chat-flow-kind])) [class*="_actions"] { opacity:1; }
          /* Menus were 58% (light) and 45% (dark) see-through, relying on a
             backdrop blur many Linux and remote setups do not render, so the
             page showed through the options. Keep a hint of the material. */
          body:not([data-ds-dark-theme]) { --dsw-menu-surface-fill:#f8f9faf5; }
          body[data-ds-dark-theme] { --dsw-menu-surface-fill:#2e2f33f7; }
          /* Font size: the only way to change it was two 9px arrows shown on
             hover. Show them always, at a size that can be hit. Marker from
             the dsh-client-ui-theme patch. */
          [data-dsh-font-stepper] { min-width:96px; padding-right:28px; box-sizing:border-box; }
          [data-dsh-font-stepper] > span:last-child { opacity:1; right:6px; gap:3px; }
          [data-dsh-font-stepper] > span:last-child > button { width:22px; height:15px; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l2); }
          [data-dsh-font-stepper] > span:last-child > button svg { width:11px; height:11px; }
          /* Model picker search. Upstream draws it with no border or icon,
             so it read as a caption and people missed it. Marker from the
             dsh-client-ui-model-selection patch; the field is an <input>
             inside the primitive's wrapper span. */
          [data-menu-material] span:has(> input[data-dsh-model-search]) {
            position:relative; box-sizing:border-box; min-height:34px; align-items:center;
            border:1px solid var(--dsw-alias-border-l2); border-radius:9px;
            background:var(--dsw-alias-bg-module-platform);
            padding:6px 10px 6px 32px;
          }
          [data-menu-material] span:has(> input[data-dsh-model-search])::before {
            content:''; position:absolute; left:11px; top:50%; width:14px; height:14px; transform:translateY(-50%);
            background:var(--dsw-alias-label-secondary);
            -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='7' cy='7' r='5' fill='none' stroke='black' stroke-width='1.6'/%3E%3Cpath d='M11 11l3.5 3.5' stroke='black' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;
            mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='7' cy='7' r='5' fill='none' stroke='black' stroke-width='1.6'/%3E%3Cpath d='M11 11l3.5 3.5' stroke='black' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;
          }
          [data-menu-material] span:has(> input[data-dsh-model-search]):focus-within {
            border-color:#D9A64A; box-shadow:0 0 0 3px rgba(217,166,74,.22); background:var(--dsw-alias-bg-base);
          }
          [data-menu-material] span > input[data-dsh-model-search] { font-size:13px; color:var(--dsw-alias-label-primary); }
          [data-menu-material] span > input[data-dsh-model-search]::placeholder { color:var(--dsw-alias-label-secondary); }
          /* macOS dark: upstream draws the sidebar half-transparent over the
             window's sidebar vibrancy, which reads as a flat grey wash. Use
             the sidebar fill other platforms get, one step lighter than the
             conversation background. Hashed class names change per build,
             hence the suffix match. */
          html[data-platform=darwin] [data-ds-dark-theme] [class*="_sidebarCol"] {
            background:var(--dsw-specific-sidebar-fill);
          }
          /* The expanded sidebar header shows the "unoblox works." wordmark alone:
             the glyph beside it repeated the same "u.". The collapsed rail
             keeps the glyph (same slot, outside the identity row). */
          [class*="_brandIdentity"] > [class*="_brandMark"] { display:none; }
        `
        document.head.appendChild(style)
        return () => style.remove()
      })
      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.inject('sidebar.brand.name', () =>
          ctx.slots.inject('conversation.hero.brand.mark', function* () {
            yield ctx.slots.register({ name: 'sidebar.brand.mark' }, DesktopBrandMark)
            yield ctx.slots.register({ name: 'sidebar.brand.name' }, DesktopBrandName)
            yield ctx.slots.register(
              { name: 'conversation.hero.brand.mark' },
              ConversationBrandMark
            )
          })
        )
      )
      ctx.slots.inject('sidebar.right.tab.document.unpreviewable', () =>
        ctx.slots.register({
          name: 'sidebar.right.tab.document.unpreviewable',
          id: 'desktop-open-local',
          inject: () => ({
            openWorkspacePath: (path) => ctx.remote.session.openWorkspacePath({ path })
          })
        }, OpenUnpreviewableFile)
      )
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'desktop-delete-session',
          order: 900,
          inject: () => ({
            deleteSession: (sessionId) => {
              const workspace = ctx.get('uiWorkspace')
              if (!workspace) throw new Error('Workspace navigation is unavailable')
              return workspace.deleteSession(sessionId)
            }
          })
        }, DeleteSessionMenuItem)
      )
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'desktop-open-session-folder',
          order: 800,
          inject: () => ({
            openInFinder: (sessionId) => {
              const cwd = ctx.get('sessions').list.getSnapshot().byId[sessionId]?.cwd
              if (!cwd) throw new Error('Session workspace directory is unavailable')
              return window.dshDesktop.openInFinder(cwd)
            }
          })
        }, OpenSessionFolderMenuItem)
      )
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'desktop-unread-session',
          order: 350
        }, UnreadSessionMenuItem)
      )
    }

    exports.UnobloxGlyph = UnobloxGlyph
    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
