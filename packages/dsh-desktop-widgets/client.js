window.__ModuleLoader__.load({
  id: 'dsh-desktop-widgets',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useRef, useState } = React

    // In-chat widgets: renders `show_widget` calls (index.js) as a sandboxed
    // frame. The frame gets scripts and forms but no same-origin access, no
    // network (its own CSP) and no way to reach the app except the messages
    // handled below: resize, submit and error.

    const NS = 'dsh-desktop-widgets'
    const TOOL_NAME = 'show_widget'
    const CHART_LIBRARY_ROUTE = '/api/desktop-widgets/echarts.js'
    const MIN_HEIGHT = 80
    const MAX_HEIGHT = 1200
    const DEFAULT_HEIGHT = 240
    const SUBMIT_INTERVAL_MS = 1500
    const MAX_FIELD = 2000
    const MAX_SUBMISSION = 8000
    const STYLE_ID = 'dsh-desktop-widgets-style'

    const en = {
      label: 'Widget',
      building: 'Building widget…',
      unreadable: 'This widget could not be shown.',
      failed: 'The widget was not shown: {message}',
      shownBelow: '"{title}" is shown below.',
      frameTitle: 'Interactive widget: {title}',
      sent: 'Sent to the agent.',
      sendFailed: 'Could not send: {message}',
      scriptError: 'The widget hit an error: {message}',
      chartsUnavailable: 'Charts are unavailable, so the widget may be incomplete.'
    }
    const zh = {
      label: '小组件',
      building: '正在生成小组件…',
      unreadable: '无法显示此小组件。',
      failed: '小组件未显示：{message}',
      shownBelow: '"{title}" 显示在下方。',
      frameTitle: '交互式小组件：{title}',
      sent: '已发送给智能体。',
      sendFailed: '发送失败：{message}',
      scriptError: '小组件出错：{message}',
      chartsUnavailable: '图表库不可用，小组件可能显示不完整。'
    }

    // Light and dark palettes the widget sees as CSS variables. The accent is
    // the unoblox gold: for text and highlights it is a richer gold in light
    // mode (4.9:1 on white); fills such as buttons keep the bright brand gold
    // in both modes, with dark text on it (8:1). `page` is the chat behind
    // the frame, for the contrast check below.
    const THEMES = {
      light: { fg: '#18191c', muted: '#5f636a', bg: 'transparent', surface: '#f6f6f4', border: '#dcdcd7', accent: '#b8801f', accentFill: '#D9A64A', onAccent: '#18191c', page: '#ffffff' },
      dark: { fg: '#f2f2f3', muted: '#a3a6ad', bg: 'transparent', surface: '#202023', border: '#3a3a40', accent: '#D9A64A', accentFill: '#D9A64A', onAccent: '#18191c', page: '#1b1b1c' }
    }

    // ---------- pure helpers (exported for tests) ----------

    /** Read the tool call's arguments; undefined while they are still streaming or invalid. */
    function parseWidgetArgs(raw) {
      if (typeof raw !== 'string' || raw.trim() === '') return undefined
      let value
      try {
        value = JSON.parse(raw)
      } catch {
        return undefined
      }
      if (typeof value !== 'object' || value === null) return undefined
      const title = typeof value.title === 'string' ? value.title.trim().slice(0, 120) : ''
      const html = typeof value.html === 'string' ? value.html : ''
      if (title === '' || html.trim() === '') return undefined
      const height = Number.isInteger(value.height) ? clampHeight(value.height) : DEFAULT_HEIGHT
      return { title, html, height }
    }

    function clampHeight(value) {
      if (!Number.isFinite(value)) return DEFAULT_HEIGHT
      return Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value)))
    }

    function usesCharts(html) {
      return /\becharts\b/u.test(html)
    }

    // A script body inlined into the frame must not close its <script> tag.
    function inlineScript(source) {
      return source.replace(/<\/(script)/giu, '<\\/$1').replace(/<!--/gu, '<\\!--')
    }

    // Runs first inside the frame: the only channel to the app.
    function bootstrap(token, page, title) {
      return `(function () {
  var widgetTitle = ${JSON.stringify(typeof title === 'string' ? title.trim().toLowerCase() : '')};
  // The token proves a message comes from this bridge, so the widget must
  // never see it: it is only in this closure, each message sets it in an
  // object literal (no setter a widget adds to Object.prototype runs), the
  // parent window is captured before the widget could replace window.parent,
  // and this script removes itself from the page when it is done.
  var token = ${JSON.stringify(token)};
  var pageColor = ${JSON.stringify(page ?? '#ffffff')};
  var parentWindow = window.parent;
  var bootstrapScript = document.currentScript;
  function post(message) { parentWindow.postMessage(message, '*'); }
  function measure() {
    var d = document.documentElement, b = document.body;
    post({ __unobloxWidget: token, kind: 'resize', height: Math.max(d.scrollHeight, b ? b.scrollHeight : 0) });
  }
  function plain(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return String(value); }
  }
  // WebRTC talks to STUN/TURN servers outside the CSP; a widget has no use
  // for it. The main process also blocks its UDP (src/main/security.ts).
  ['RTCPeerConnection', 'webkitRTCPeerConnection'].forEach(function (name) {
    try { Object.defineProperty(window, name, { value: undefined, writable: false, configurable: false }); } catch (e) {}
  });
  // No nested frames: one would start with a fresh window that the lines
  // above do not reach. Each frame element is removed as soon as it is added,
  // before its document can load. This script runs before the widget's, so
  // it keeps its own copies of what it relies on, and shadow roots, which the
  // observer cannot see into from the document, are watched as they are made.
  var call = Function.prototype.call;
  function method(proto, name) { return call.bind(proto[name]); }
  function getter(proto, name) { return call.bind(Object.getOwnPropertyDescriptor(proto, name).get); }
  function seal(proto, name, value) { Object.defineProperty(proto, name, { value: value, writable: false, configurable: false }); }
  var FRAMES = 'iframe,frame,frameset,object,embed,fencedframe,portal';
  var nodeType = getter(Node.prototype, 'nodeType');
  var matches = method(Element.prototype, 'matches');
  var queryAll = method(Element.prototype, 'querySelectorAll');
  var removeNode = method(Element.prototype, 'remove');
  var listLength = getter(NodeList.prototype, 'length');
  var addedNodes = getter(MutationRecord.prototype, 'addedNodes');
  var observe = method(MutationObserver.prototype, 'observe');
  var attach = method(Element.prototype, 'attachShadow');
  var toText = String;
  var lower = method(String.prototype, 'toLowerCase');
  var indexOf = method(String.prototype, 'indexOf');
  function sweep(node) {
    if (nodeType(node) !== 1) return;
    if (matches(node, FRAMES)) { removeNode(node); return; }
    var found = queryAll(node, FRAMES);
    for (var i = listLength(found) - 1; i >= 0; i--) removeNode(found[i]);
  }
  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var nodes = addedNodes(records[i]);
      for (var j = 0, n = listLength(nodes); j < n; j++) sweep(nodes[j]);
    }
  });
  function watch(root) { observe(observer, root, { childList: true, subtree: true }); }
  watch(document);
  seal(Element.prototype, 'attachShadow', function (init) {
    var options = init == null ? init : { mode: init.mode, delegatesFocus: init.delegatesFocus, slotAssignment: init.slotAssignment, clonable: false, serializable: false };
    var root = attach(this, options);
    watch(root);
    return root;
  });
  // Declarative shadow roots come from the parser, not attachShadow; refuse
  // markup that asks for one on the paths that would make it.
  function refuseShadowRoots(args) {
    var text = '';
    for (var i = 0; i < args.length; i++) text += toText(args[i]);
    if (indexOf(lower(text), 'shadowroot') !== -1) throw new TypeError('declarative shadow roots are not available in widgets');
    return text;
  }
  var write = method(Document.prototype, 'write'), writeln = method(Document.prototype, 'writeln');
  seal(Document.prototype, 'write', function () { return write(this, refuseShadowRoots(arguments)); });
  seal(Document.prototype, 'writeln', function () { return writeln(this, refuseShadowRoots(arguments)); });
  if (Element.prototype.setHTMLUnsafe) {
    var setElement = method(Element.prototype, 'setHTMLUnsafe'), setShadow = method(ShadowRoot.prototype, 'setHTMLUnsafe');
    seal(Element.prototype, 'setHTMLUnsafe', function (html) { return setElement(this, refuseShadowRoots([html])); });
    seal(ShadowRoot.prototype, 'setHTMLUnsafe', function (html) { return setShadow(this, refuseShadowRoots([html])); });
  }
  if (Document.parseHTMLUnsafe) {
    var parseUnsafe = Document.parseHTMLUnsafe;
    seal(Document, 'parseHTMLUnsafe', function (html) { return call.call(parseUnsafe, Document, refuseShadowRoots([html])); });
  }
  var parseFromString = method(DOMParser.prototype, 'parseFromString');
  seal(DOMParser.prototype, 'parseFromString', function (html, type) { return parseFromString(this, refuseShadowRoots([html]), type); });
  // Acting for the user (sending text as their message, opening a link)
  // needs a real click in this widget: a trusted event, which no script can
  // create, not on a text field, one action per click and within 2 seconds;
  // Enter pressed in a form counts too. The widget's own script can still
  // compute what is sent, but cannot send it unprompted or repeatedly.
  var now = Date.now;
  var eventTarget = getter(Event.prototype, 'target');
  var preventDefault = method(Event.prototype, 'preventDefault');
  var keyOf = getter(KeyboardEvent.prototype, 'key');
  var localName = getter(Element.prototype, 'localName');
  var inputType = getter(HTMLInputElement.prototype, 'type');
  var editable = getter(HTMLElement.prototype, 'isContentEditable');
  var closest = method(Element.prototype, 'closest');
  var getAttr = method(Element.prototype, 'getAttribute');
  var CONTROLS = { button: 1, submit: 1, reset: 1, image: 1, checkbox: 1, radio: 1 };
  var gestureAt = 0, gestureFresh = false;
  function isTextEntry(element) {
    var name = localName(element);
    if (name === 'textarea' || name === 'select') return true;
    if (name === 'input') return !CONTROLS[inputType(element)];
    return editable(element) === true;
  }
  function takeGesture() {
    if (!gestureFresh || now() - gestureAt > 2000) return false;
    gestureFresh = false;
    return true;
  }
  function elementOf(event) {
    var target = eventTarget(event);
    return target && nodeType(target) === 1 ? target : null;
  }
  window.addEventListener('keydown', function (event) {
    if (event.isTrusted && keyOf(event) === 'Enter') { gestureAt = now(); gestureFresh = true; }
  }, true);
  window.unoblox = { submit: function (values) {
    if (!takeGesture()) return;
    var data = values == null ? null : plain(values);
    if (data === null || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0)) data = pageFields();
    post({ __unobloxWidget: token, kind: 'submit', data: data });
  } };
  function add(data, key, text) {
    if (Object.prototype.hasOwnProperty.call(data, key)) data[key] = [].concat(data[key], text); else data[key] = text;
  }
  // A field without a name is still sent, keyed by its label, id or placeholder.
  function fieldKey(field) {
    var label = field.id && document.querySelector('label[for="' + field.id.replace(/"/g, '') + '"]');
    if (!label && field.closest) label = field.closest('label');
    var text = label ? label.textContent.trim() : '';
    return text || field.getAttribute('aria-label') || field.id || field.getAttribute('placeholder') || field.type || 'field';
  }
  var FIELDS = 'input, select, textarea';
  var SKIP = { submit: 1, button: 1, reset: 1, image: 1 };
  function readField(data, field, key) {
    if (field.disabled || SKIP[field.type]) return;
    if (field.type === 'file') { add(data, key, '[file]'); return; }
    if ((field.type === 'checkbox' || field.type === 'radio') && !field.checked) return;
    if (field.tagName === 'SELECT' && field.multiple) {
      Array.prototype.forEach.call(field.selectedOptions, function (option) { add(data, key, option.value); });
      return;
    }
    add(data, key, field.value);
  }
  function isField(field) { return /^(INPUT|SELECT|TEXTAREA)$/.test(field.tagName) && !SKIP[field.type]; }
  // Every field on the page: for a form with no fields of its own (inputs
  // laid out beside it) and for unoblox.submit() called without values.
  function pageFields() {
    var data = {};
    Array.prototype.forEach.call(document.querySelectorAll(FIELDS), function (field) { readField(data, field, field.name || fieldKey(field)); });
    return data;
  }
  function formFields(form, submitter) {
    if (!Array.prototype.some.call(form.elements, isField)) return pageFields();
    var data = {};
    new FormData(form, submitter || undefined).forEach(function (value, key) {
      add(data, key, typeof value === 'string' ? value : '[file]');
    });
    Array.prototype.forEach.call(form.elements, function (field) {
      if (isField(field) && !field.name) readField(data, field, fieldKey(field));
    });
    return data;
  }
  function sendForm(form, submitter) {
    post({ __unobloxWidget: token, kind: 'submit', data: formFields(form, submitter), form: getAttr(form, 'aria-label') || getAttr(form, 'name') || '' });
  }
  // A submit event is trusted even when a script called requestSubmit(), so
  // it needs the click or Enter that should have caused it.
  document.addEventListener('submit', function (event) {
    preventDefault(event);
    if (takeGesture()) sendForm(eventTarget(event), event.submitter);
  }, true);
  // form.submit() skips the submit event and would try to navigate.
  seal(HTMLFormElement.prototype, 'submit', function () { if (takeGesture()) sendForm(this, null); });
  // Links. A srcdoc document resolves "#part" against the chat's address,
  // so following it would load the chat into the frame: in-page links scroll
  // here instead. A web link the user clicks opens in their browser (the
  // chat checks the click was real); nothing else navigates.
  window.addEventListener('click', function (event) {
    var element = elementOf(event);
    if (event.isTrusted && element && !isTextEntry(element)) { gestureAt = now(); gestureFresh = true; }
    var link = element ? closest(element, 'a[href]') : null;
    if (!link) return;
    var href = getAttr(link, 'href') || '';
    preventDefault(event);
    if (href.charAt(0) === '#') {
      var id = href.slice(1);
      try { id = decodeURIComponent(id); } catch (e) {}
      var target = id === '' ? document.body : document.getElementById(id) || document.getElementsByName(id)[0];
      if (target) target.scrollIntoView();
      return;
    }
    var scheme = href.slice(0, 8).toLowerCase();
    if ((scheme === 'https://' || scheme.slice(0, 7) === 'http://') && takeGesture()) post({ __unobloxWidget: token, kind: 'open', url: href });
  }, true);
  window.addEventListener('error', function (event) { post({ __unobloxWidget: token, kind: 'error', message: toText(event.message || 'error') }); });
  window.addEventListener('unhandledrejection', function (event) { post({ __unobloxWidget: token, kind: 'error', message: toText(event.reason && event.reason.message || event.reason) }); });
  // Readability: models pick their own colours (white on a gold button,
  // black text on the dark theme). Any text below WCAG AA against what is
  // actually behind it is switched to the dark or light ink that reads best.
  function rgb(value) {
    if (typeof value !== 'string' || value.slice(0, 3) !== 'rgb') return null;
    var parts = value.slice(value.indexOf('(') + 1, value.indexOf(')')).split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  function hexColor(value) { return { r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(5, 7), 16), a: 1 }; }
  function blend(top, under) { return { r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 }; }
  function lum(c) {
    function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  var INKS = [hexColor('#18191c'), hexColor('#ffffff')];
  function behind(el) {
    var layers = [];
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var style = getComputedStyle(n);
      if (style.backgroundImage && style.backgroundImage !== 'none') return null;
      var c = rgb(style.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    var color = hexColor(pageColor);
    for (var i = layers.length - 1; i >= 0; i--) color = blend(layers[i], color);
    return color;
  }
  function ownText(el) {
    if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName)) return true;
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim() !== '') return true;
    return false;
  }
  var fixing = false;
  function fixContrast() {
    if (fixing || !document.body) return;
    fixing = true;
    try {
      var all = document.body.getElementsByTagName('*');
      for (var i = 0; i < all.length && i < 3000; i++) {
        var el = all[i];
        if (!ownText(el) || /^(SCRIPT|STYLE|SVG|CANVAS)$/i.test(el.tagName)) continue;
        var style = getComputedStyle(el);
        var fg = rgb(style.color);
        var bg = fg && behind(el);
        if (!bg) continue;
        var size = parseFloat(style.fontSize), bold = Number(style.fontWeight) >= 600;
        var need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
        if (ratio(blend(fg, bg), bg) >= need) continue;
        var ink = ratio(INKS[0], bg) >= ratio(INKS[1], bg) ? '#18191c' : '#ffffff';
        el.style.setProperty('color', ink, 'important');
      }
    } finally { fixing = false; }
  }
  var pendingFix = 0;
  function scheduleFix() { if (!pendingFix) pendingFix = setTimeout(function () { pendingFix = 0; fixContrast(); }, 60); }
  // The chat shows the title above the widget; a heading repeating it as
  // the widget's first element only takes space.
  function dropRepeatedTitle() {
    var first = document.body && document.body.firstElementChild;
    while (first && !/^H[1-4]$/.test(first.tagName) && first.children.length > 0 && first.textContent.trim().toLowerCase().indexOf(widgetTitle) === 0) first = first.firstElementChild;
    if (widgetTitle && first && /^H[1-4]$/.test(first.tagName) && first.textContent.trim().toLowerCase() === widgetTitle) first.style.display = 'none';
  }
  // The chat already frames the widget. Models often wrap everything in one
  // narrow, centred card of their own, which wastes the width: an outer
  // wrapper holding the whole widget loses its width limit and card styling.
  function flattenOuterCard() {
    var body = document.body;
    if (!body) return;
    var children = Array.prototype.filter.call(body.children, function (el) { return !/^(SCRIPT|STYLE|TEMPLATE|LINK|META)$/.test(el.tagName); });
    if (children.length !== 1 || !/^(DIV|MAIN|SECTION|ARTICLE|FORM)$/.test(children[0].tagName)) return;
    var outer = children[0].style;
    ['max-width', 'margin', 'padding', 'background', 'border', 'border-radius', 'box-shadow'].forEach(function (name) {
      outer.setProperty(name, name === 'max-width' ? 'none' : name === 'margin' || name === 'padding' ? '0' : name === 'border' ? '0' : name === 'border-radius' ? '0' : name === 'box-shadow' ? 'none' : 'transparent', 'important');
    });
    outer.setProperty('width', 'auto', 'important');
  }
  window.addEventListener('load', function () {
    flattenOuterCard();
    dropRepeatedTitle();
    fixContrast();
    new MutationObserver(scheduleFix).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });
    measure();
    if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(document.documentElement);
  });
  if (bootstrapScript) removeNode(bootstrapScript);
})();`
    }

    const CHART_COLORS = {
      light: ['#c8922f', '#2f62d0', '#1f8a70', '#c2410c', '#7c3aed', '#5f6b7a'],
      dark: ['#D9A64A', '#7aaaff', '#4fd1a5', '#fb923c', '#a78bfa', '#94a3b8']
    }

    /**
     * Charts draw on a canvas, which cannot read CSS variables: a chart that
     * asks for "var(--uw-fg)" would draw black on the dark theme. Give
     * ECharts a matching default theme, and resolve --uw-* variables in the
     * options a widget passes.
     */
    function chartTheme(theme, dark) {
      const vars = { '--uw-fg': theme.fg, '--uw-muted': theme.muted, '--uw-bg': 'transparent', '--uw-surface': theme.surface, '--uw-border': theme.border, '--uw-accent': theme.accent, '--uw-accent-fill': theme.accentFill, '--uw-on-accent': theme.onAccent }
      const axis = { axisLine: { lineStyle: { color: theme.border } }, axisTick: { lineStyle: { color: theme.border } }, axisLabel: { color: theme.muted }, splitLine: { lineStyle: { color: theme.border } }, nameTextStyle: { color: theme.muted } }
      const config = {
        color: CHART_COLORS[dark ? 'dark' : 'light'],
        backgroundColor: 'transparent',
        textStyle: { color: theme.fg },
        title: { textStyle: { color: theme.fg }, subtextStyle: { color: theme.muted } },
        legend: { textStyle: { color: theme.fg, fontSize: 12 } },
        tooltip: { backgroundColor: theme.surface, borderColor: theme.border, textStyle: { color: theme.fg } },
        categoryAxis: axis, valueAxis: axis, logAxis: axis, timeAxis: axis,
        pie: { label: { color: theme.fg } }
      }
      return `(function () {
  var e = window.echarts;
  if (!e || typeof e.registerTheme !== 'function') return;
  var vars = ${JSON.stringify(vars)};
  e.registerTheme('unoblox', ${JSON.stringify(config)});
  function resolve(value, depth) {
    if (depth > 12) return value;
    if (typeof value === 'string') {
      var m = /^\\s*var\\((--uw-[a-z-]+)[^)]*\\)\\s*$/.exec(value);
      return m && vars[m[1]] ? vars[m[1]] : value;
    }
    if (Array.isArray(value)) return value.map(function (item) { return resolve(item, depth + 1); });
    var proto = value && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
    if (proto !== undefined && (proto === null || Object.getPrototypeOf(proto) === null)) {
      var out = {};
      for (var key in value) if (Object.prototype.hasOwnProperty.call(value, key)) out[key] = resolve(value[key], depth + 1);
      return out;
    }
    return value;
  }
  var init = e.init;
  e.init = function (el, name, opts) {
    var chart = init.call(e, el, name == null ? 'unoblox' : name, opts);
    var setOption = chart.setOption;
    chart.setOption = function (option) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = resolve(option, 0);
      return setOption.apply(chart, args);
    };
    return chart;
  };
})();`
    }

    /**
     * The frame document: a strict CSP (scripts and styles inline only, no
     * network, no navigation), the theme variables, the bridge, the chart
     * library when the widget uses it, then the agent's HTML.
     */
    // The agent's markup must not open declarative shadow roots: the frame's
    // bootstrap cannot see inside one created by the parser.
    function neutraliseShadowRoots(html) {
      return html.replace(/shadowroot(mode)?(\s*=)/giu, 'data-shadowroot$1$2')
    }

    function buildWidgetDocument(html, options) {
      const theme = THEMES[options.dark ? 'dark' : 'light']
      const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'"
      // A compact base: one control height, tight type, tabular numbers, and
      // a small layout kit (uw-*) so models do not hand-roll padding and cards.
      const style = `:root{color-scheme:${options.dark ? 'dark' : 'light'};--uw-fg:${theme.fg};--uw-muted:${theme.muted};--uw-bg:${theme.bg};--uw-surface:${theme.surface};--uw-border:${theme.border};--uw-accent:${theme.accent};--uw-accent-fill:${theme.accentFill};--uw-on-accent:${theme.onAccent};--uw-radius:6px;--uw-gap:12px}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;background:transparent}
body{padding:12px 14px;color:var(--uw-fg);font:13px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;overflow-wrap:anywhere}
h1,h2,h3,h4{margin:0 0 8px;font-weight:600;line-height:1.3}h1{font-size:17px}h2{font-size:15px}h3,h4{font-size:13px}
p{margin:0 0 8px}
label{font-size:12px;font-weight:500;color:var(--uw-muted)}
input,select,textarea,button{font:inherit;color:inherit}
input,select,textarea{min-height:32px;min-width:0;background:var(--uw-surface);border:1px solid var(--uw-border);border-radius:var(--uw-radius);padding:0 10px}
textarea{min-height:64px;padding:6px 10px}
input[type=checkbox],input[type=radio]{min-height:0;accent-color:var(--uw-accent)}
input[type=range]{min-height:0;padding:0;border:0;background:none;accent-color:var(--uw-accent)}
button{min-height:32px;background:var(--uw-accent-fill);color:var(--uw-on-accent);border:0;border-radius:var(--uw-radius);padding:0 14px;font-weight:600;cursor:pointer}
button:hover{filter:brightness(1.05)}
:focus-visible{outline:2px solid var(--uw-accent);outline-offset:1px}
table{border-collapse:collapse;width:100%}th{font-size:12px;font-weight:600;color:var(--uw-muted)}th,td{border-bottom:1px solid var(--uw-border);padding:5px 8px;text-align:left}.num{text-align:right}
.uw-stack{display:flex;flex-direction:column;gap:var(--uw-gap)}
.uw-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--uw-gap)}
.uw-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--uw-gap)}
.uw-split{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;align-items:start}
.uw-field{display:flex;flex-direction:column;gap:4px;min-width:0}.uw-field>input,.uw-field>select,.uw-field>textarea{width:100%}
.uw-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.uw-stat{background:var(--uw-surface);border-radius:var(--uw-radius);padding:8px 10px}.uw-stat>span{display:block;font-size:12px;color:var(--uw-muted)}.uw-stat>strong{display:block;font-size:19px;font-weight:700;line-height:1.25;color:var(--uw-accent)}
.uw-card{background:var(--uw-surface);border-radius:var(--uw-radius);padding:10px 12px}
.uw-actions{display:flex;justify-content:flex-end;gap:8px}
.uw-chart{width:100%;height:220px}
.uw-muted{color:var(--uw-muted)}`
      return [
        '<!doctype html><html><head><meta charset="utf-8">',
        `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        `<style>${style}</style>`,
        `<script>${inlineScript(bootstrap(options.token, theme.page, options.title))}</script>`,
        typeof options.library === 'string' ? `<script>${inlineScript(options.library)}</script><script>${inlineScript(chartTheme(theme, options.dark))}</script>` : '',
        '</head><body>',
        neutraliseShadowRoots(html),
        '</body></html>'
      ].join('')
    }

    function clip(text, limit) {
      return text.length > limit ? `${text.slice(0, limit)}…` : text
    }

    /** What the agent receives when the user submits a widget. */
    function formatSubmission(title, data) {
      const lines = [`Submitted from the "${title}" widget:`]
      if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
        const entries = Object.entries(data)
        if (entries.length === 0) lines.push('(no fields)')
        for (const [key, value] of entries.slice(0, 100)) {
          const shown = Array.isArray(value) ? value.map((item) => String(item)).join(', ') : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
          lines.push(`- ${clip(key.replace(/\s+/gu, ' '), 100)}: ${clip(shown, MAX_FIELD)}`)
        }
      } else {
        lines.push(clip(typeof data === 'string' ? data : JSON.stringify(data), MAX_FIELD))
      }
      return clip(lines.join('\n'), MAX_SUBMISSION)
    }

    /**
     * Whether the user has just acted inside this widget. The widget's own
     * script can post any message, so opening a link or sending text as the
     * user needs a recent user activation (a click or key press) and the focus
     * in this widget's frame. Activation alone is not enough: a key press in
     * the chat composer activates the page too.
     */
    function userActedInWidget(frame, doc = document, nav = navigator) {
      return nav.userActivation?.isActive === true && doc.activeElement === frame
    }

    function isWebLink(value) {
      try {
        const url = new URL(value)
        return (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === ''
      } catch {
        return false
      }
    }

    // ---------- chart library ----------

    let libraryPromise
    function loadChartLibrary() {
      libraryPromise ??= fetch(CHART_LIBRARY_ROUTE, { credentials: 'same-origin' }).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
        return response.text()
      })
      // A failed load is retried by the next widget that needs it.
      libraryPromise.catch(() => { libraryPromise = undefined })
      return libraryPromise
    }

    function useDarkTheme() {
      const read = () => typeof document !== 'undefined' && document.body?.hasAttribute('data-ds-dark-theme') === true
      const [dark, setDark] = useState(read)
      useEffect(() => {
        if (typeof MutationObserver !== 'function' || !document.body) return undefined
        const observer = new MutationObserver(() => setDark(read()))
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
        return () => observer.disconnect()
      }, [])
      return dark
    }

    function randomToken() {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    }

    // ---------- components ----------

    function WidgetFrame({ widget, t, sendText }) {
      const dark = useDarkTheme()
      const frameRef = useRef(null)
      const lastSubmit = useRef(0)
      const [height, setHeight] = useState(widget.height)
      const [notice, setNotice] = useState(undefined)
      const charts = usesCharts(widget.html)
      const [library, setLibrary] = useState(charts ? undefined : null)
      const token = useMemo(randomToken, [widget.html, dark])

      useEffect(() => {
        if (!charts) return undefined
        let live = true
        loadChartLibrary().then(
          (source) => { if (live) setLibrary(source) },
          () => { if (live) { setLibrary(null); setNotice({ kind: 'error', text: t('chartsUnavailable') }) } }
        )
        return () => { live = false }
      }, [charts, t])

      useEffect(() => {
        const onMessage = (event) => {
          const frame = frameRef.current
          if (!frame || event.source !== frame.contentWindow) return
          const data = event.data
          if (typeof data !== 'object' || data === null || data.__unobloxWidget !== token) return
          if (data.kind === 'resize' && typeof data.height === 'number') {
            setHeight(clampHeight(data.height + 2))
          } else if (data.kind === 'error') {
            setNotice({ kind: 'error', text: t('scriptError', { message: String(data.message).slice(0, 200) }) })
          } else if (data.kind === 'open' && typeof data.url === 'string') {
            if (!userActedInWidget(frame) || !isWebLink(data.url)) return
            window.open(data.url, '_blank', 'noopener,noreferrer')
          } else if (data.kind === 'submit') {
            if (!userActedInWidget(frame)) return
            const now = Date.now()
            if (now - lastSubmit.current < SUBMIT_INTERVAL_MS) return
            lastSubmit.current = now
            Promise.resolve()
              .then(() => sendText(formatSubmission(widget.title, data.data)))
              .then(
                () => setNotice({ kind: 'ok', text: t('sent') }),
                (error) => setNotice({ kind: 'error', text: t('sendFailed', { message: error instanceof Error ? error.message : String(error) }) })
              )
          }
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [token, widget.title, sendText, t])

      if (library === undefined) return h('div', { className: 'dshWidgetStatus' }, t('building'))
      const srcDoc = buildWidgetDocument(widget.html, { dark, token, title: widget.title, library: library ?? undefined })
      return h(React.Fragment, null,
        h('iframe', {
          ref: frameRef,
          // The main process recognises widget frames by this name and keeps
          // them from navigating anywhere (src/main/security.ts).
          name: 'unoblox-widget',
          className: 'dshWidgetFrame',
          title: t('frameTitle', { title: widget.title }),
          sandbox: 'allow-scripts allow-forms',
          referrerPolicy: 'no-referrer',
          srcDoc,
          style: { height: `${String(height)}px` }
        }),
        notice ? h('div', { className: `dshWidgetNotice dshWidgetNotice-${notice.kind}`, role: notice.kind === 'error' ? 'alert' : 'status' }, notice.text) : null
      )
    }

    function WidgetCard({ widget, t, sendText }) {
      return h('section', { className: 'dshWidget', 'data-tool': TOOL_NAME, 'aria-label': widget.title },
        h('header', { className: 'dshWidgetHeader' },
          h('span', { className: 'dshWidgetLabel' }, t('label')),
          h('span', { className: 'dshWidgetTitle' }, widget.title)),
        h(WidgetFrame, { widget, t, sendText }))
    }

    /**
     * The tool call's row among the turn's steps, which the chat folds away
     * once the turn completes. The widget itself is in the turn's tail
     * (WidgetsTail), where it stays visible.
     */
    function WidgetToolView(props) {
      const { block, t } = props
      const settled = block !== undefined && 'kind' in block
      const raw = settled ? block.call?.argsRaw : block?.argsRaw
      const widget = useMemo(() => parseWidgetArgs(raw), [raw])
      let text
      if (settled && block.isError) {
        const message = block.content?.map((item) => item.type === 'text' ? item.text : '').join(' ').trim() || block.error?.code || 'error'
        text = t('failed', { message: message.slice(0, 300) })
      } else if (widget === undefined) {
        text = settled ? t('unreadable') : t('building')
      } else {
        text = t('shownBelow', { title: widget.title })
      }
      return h('div', { className: 'dshWidgetRow', 'data-tool-row': TOOL_NAME, role: settled && block.isError ? 'alert' : undefined },
        h('span', { className: 'dshWidgetLabel' }, t('label')), ' ', text)
    }

    // ---------- the turn's widgets ----------

    const DATA_KEY = 'unoblox-widgets'

    /**
     * Collect each turn's show_widget calls from the session events, so the
     * turn's tail can show them after the reply. A call whose result is an
     * error is dropped.
     */
    const widgetsDefinition = {
      kind: DATA_KEY,
      match: (event) => {
        if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
        if (event.type === 'tool/call' && event.data?.name === TOOL_NAME) return { id: String(event.data.turn), role: 'update' }
        if (event.type === 'tool/result') return { id: String(event.data.turn), role: 'update' }
        return null
      },
      start: (_context, match) => ({ turn: match.event.data.turn, widgets: [] }),
      update: (context, match) => {
        const state = context.state
        if (match.event.type === 'tool/call') {
          // A call can be announced more than once; the latest arguments win.
          const callId = String(match.event.data.callId)
          const entry = { callId, seq: match.event.seq, argsRaw: match.event.data.arguments }
          const known = state.widgets.some((widget) => widget.callId === callId)
          return { ...state, widgets: known ? state.widgets.map((widget) => widget.callId === callId ? entry : widget) : [...state.widgets, entry] }
        }
        if (match.event.type === 'tool/result' && match.event.data?.message?.isError === true) {
          const callId = String(match.event.data.message.source?.callId)
          if (!state.widgets.some((widget) => widget.callId === callId)) return state
          return { ...state, widgets: state.widgets.filter((widget) => widget.callId !== callId) }
        }
        return state
      },
      buildLocationData: (context, scope, previous) => {
        if (scope !== 'turn' || context.state === undefined || context.state.widgets.length === 0) return null
        if (previous?.kind === 'turn' && previous.turn === context.state.turn && previous.key === DATA_KEY && previous.value.widgets === context.state.widgets) return previous
        return { kind: 'turn', turn: context.state.turn, key: DATA_KEY, value: { widgets: context.state.widgets } }
      }
    }

    /**
     * Models sometimes show a widget again in the same turn, unchanged or
     * revised. A later widget with the same title replaces the earlier one,
     * in the place of the latest call.
     */
    function uniqueWidgets(entries) {
      const last = new Map()
      entries.forEach((entry, index) => last.set(entry.widget.title.toLowerCase(), index))
      return entries.filter((entry, index) => last.get(entry.widget.title.toLowerCase()) === index)
    }

    /** The turn's widgets, after its reply. */
    function WidgetsTail(props) {
      const { turn, t, sendText } = props
      const recorded = turn?.data?.get(DATA_KEY)?.widgets
      const widgets = useMemo(() => uniqueWidgets((recorded ?? [])
        .map((entry) => ({ callId: entry.callId, widget: parseWidgetArgs(entry.argsRaw) }))
        .filter((entry) => entry.widget !== undefined)), [recorded])
      if (widgets.length === 0) return null
      return h('div', { className: 'dshWidgets' }, ...widgets.map((entry) => h(WidgetCard, { key: entry.callId, widget: entry.widget, t, sendText })))
    }

    const STYLE = `
      .dshWidgets{display:flex;flex-direction:column;gap:10px;margin:4px 0 8px}
      .dshWidgetRow{font-size:13px;padding:2px 0;color:var(--dsw-alias-label-secondary, inherit)}
      .dshWidget{margin:0;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25));border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base, transparent)}
      .dshWidgetHeader{display:flex;align-items:baseline;gap:8px;padding:7px 14px;border-bottom:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2));font-size:12.5px;line-height:18px}
      .dshWidgetLabel{color:#a16207;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:lowercase}
      [data-ds-dark-theme] .dshWidgetLabel{color:#D9A64A}
      .dshWidgetTitle{font-weight:600;color:var(--dsw-alias-label-primary, inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dshWidgetFrame{display:block;width:100%;border:0;background:transparent;color-scheme:normal}
      .dshWidgetStatus{padding:12px 14px;font-size:13px;color:var(--dsw-alias-label-secondary, inherit)}
      .dshWidgetNotice{padding:0 14px 10px;font-size:12px;color:var(--dsw-alias-label-secondary, inherit)}
      .dshWidgetNotice-error{color:var(--dsw-alias-state-error-primary, #d93025)}
    `

    function installStyles() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.textContent = STYLE
      document.head.appendChild(tag)
    }

    // ---------- composition ----------

    const inject = ['slots', 'locale', 'uiConversation']
    function apply(ctx) {
      installStyles()
      ctx.effect(() => ctx.locale.register(NS, { zh, en }))
      ctx.uiConversation.events.register(widgetsDefinition)
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: TOOL_NAME,
        locale: NS
      }, WidgetToolView))
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        id: NS,
        locale: NS,
        // A submission goes to the session the widget belongs to, as the
        // user's next message.
        inject: (sessionId) => ({
          sendText: (text) => {
            const conversation = ctx.get('sessions')?.scope(sessionId)?.get('conversation')
            if (!conversation || typeof conversation.send !== 'function') throw new Error('the conversation is not available')
            return conversation.send(text)
          }
        })
      }, WidgetsTail))
    }

    exports.apply = apply
    exports.inject = inject
    exports.parseWidgetArgs = parseWidgetArgs
    exports.buildWidgetDocument = buildWidgetDocument
    exports.formatSubmission = formatSubmission
    exports.inlineScript = inlineScript
    exports.neutraliseShadowRoots = neutraliseShadowRoots
    exports.usesCharts = usesCharts
    exports.clampHeight = clampHeight
    exports.isWebLink = isWebLink
    exports.userActedInWidget = userActedInWidget
    exports.chartTheme = chartTheme
    exports.uniqueWidgets = uniqueWidgets
    exports.WidgetToolView = WidgetToolView
    exports.WidgetsTail = WidgetsTail
    exports.widgetsDefinition = widgetsDefinition
    return module.exports
  }
})
