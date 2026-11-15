// Duck Box 桌面版 —— 设置：主题配色 + 加密构建
// 在 <head> 里同步加载，页面渲染前就套用上次选择的主题，避免闪一下原色。
(function () {
  'use strict';

  var KEY = 'duckbox.theme.v1';
  var KEY_JSC = 'duckbox.jsc.v1';

  // 颜色只描述「界面外壳」：积木分类色、手环屏幕预览不参与主题。
  var THEMES = [
    { id: 'default', name: '默认',     sub: '当前配色',   accent: '#e6b422', bg: '#ffffff' },
    { id: 'mono',    name: '黑白',     sub: '黑 · 白 · 灰', accent: '#1a1a1a', bg: '#ffffff' },
    { id: 'blue',    name: '蓝白',     sub: '淡蓝 · 白',   accent: '#4c97ff', bg: '#f4f8fe' },
    { id: 'gray',    name: '灰白',     sub: '灰 · 白',     accent: '#808080', bg: '#f7f7f7' },
    { id: 'pink',    name: '粉白',     sub: '淡粉 · 白',   accent: '#d97aa0', bg: '#fff8fa' },
    { id: 'green',   name: '绿白',     sub: '淡绿 · 白',   accent: '#5eb287', bg: '#f6fbf7' }
  ];

  var GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="3"></circle>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 ' +
    '1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 ' +
    '1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 ' +
    '1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>' +
    '</svg>';

  function isKnown(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return true;
    return false;
  }

  function read() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function save(id) {
    try { localStorage.setItem(KEY, id); } catch (e) { /* 隐私模式下忽略 */ }
  }

  var saved = read();
  var current = isKnown(saved) ? saved : 'default';

  // 加密构建：官方 aiot build --enable-jsc（把 js 编译为 jsc 文件）。默认关闭。
  var jscOn = false;
  try { jscOn = localStorage.getItem(KEY_JSC) === '1'; } catch (e) { /* 隐私模式下忽略 */ }

  function jscEnabled() { return jscOn; }

  function setJsc(on) {
    jscOn = !!on;
    try { localStorage.setItem(KEY_JSC, jscOn ? '1' : '0'); } catch (e) { /* 隐私模式下忽略 */ }
    syncDialog();
    try {
      window.dispatchEvent(new CustomEvent('dbx-jsc-change', { detail: { enabled: jscOn } }));
    } catch (e) { /* ignore */ }
  }

  function apply(id, persist) {
    if (!isKnown(id)) id = 'default';
    current = id;
    document.documentElement.setAttribute('data-theme', id);
    if (persist !== false) save(id);
    syncDialog();
    // 让需要重新测量的组件（Blockly 等）知道窗口外观变了
    try { window.dispatchEvent(new CustomEvent('dbx-theme-change', { detail: { id: id } })); } catch (e) { /* ignore */ }
  }

  // 首屏立即套用（此时 body 还没解析，只改 <html> 属性即可）
  apply(current, false);

  // ---------------- 设置弹窗 ----------------
  var mask = null;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildDialog() {
    if (document.getElementById('dbx-set-mask')) return;

    var items = THEMES.map(function (t) {
      return '<button type="button" class="dbx-theme-item" data-theme-id="' + t.id + '" ' +
        'role="radio" aria-checked="false">' +
        '<span class="dbx-theme-swatch"><i style="background:' + t.accent + '"></i>' +
        '<i style="background:' + t.bg + '"></i></span>' +
        '<span class="dbx-theme-name">' + esc(t.name) +
        '<br><span class="dbx-theme-sub">' + esc(t.sub) + '</span></span>' +
        '<span class="dbx-theme-tick" aria-hidden="true">&#10003;</span>' +
        '</button>';
    }).join('');

    mask = document.createElement('div');
    mask.id = 'dbx-set-mask';
    mask.className = 'dbx-set-mask';
    mask.hidden = true;
    mask.innerHTML =
      '<div class="dbx-set-dlg" role="dialog" aria-modal="true" aria-labelledby="dbx-set-title">' +
        '<div class="dbx-set-head">' +
          '<span class="dbx-set-title" id="dbx-set-title">设置</span>' +
          '<button type="button" class="dbx-set-x" data-act="close" aria-label="关闭">&times;</button>' +
        '</div>' +
        '<div class="dbx-set-body">' +
          '<div class="dbx-set-label">主题颜色</div>' +
          '<div class="dbx-theme-grid" role="radiogroup" aria-label="主题颜色">' + items + '</div>' +
          '<p class="dbx-set-note">选择后立即生效，并保存到本机；下次打开程序会沿用该配色。</p>' +
          '<div class="dbx-set-label dbx-set-label-2">构建</div>' +
          '<label class="dbx-opt" for="dbx-jsc">' +
            '<input type="checkbox" id="dbx-jsc" class="dbx-check">' +
            '<span class="dbx-opt-name">加密构建（JSC）</span>' +
          '</label>' +
          '<p class="dbx-set-note dbx-opt-note">开启后使用官方 ' +
            '<code>aiot build --enable-jsc</code> 把 JS 编译为 jsc，' +
            '仅影响「构建」按钮生成的 RPK。首次开启需联网安装官方 jsc 组件（约 5 MB）。默认关闭。</p>' +
        '</div>' +
        '<div class="dbx-set-foot">' +
          '<button type="button" class="dbx-btn" data-act="reset">恢复默认</button>' +
          '<button type="button" class="dbx-btn dbx-btn-primary" data-act="close">完成</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(mask);
    syncDialog();
  }

  function syncDialog() {
    if (!mask) return;
    var nodes = mask.querySelectorAll('.dbx-theme-item');
    for (var i = 0; i < nodes.length; i++) {
      var on = nodes[i].getAttribute('data-theme-id') === current;
      if (on) nodes[i].classList.add('is-on');
      else nodes[i].classList.remove('is-on');
      nodes[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    var jscBox = mask.querySelector('#dbx-jsc');
    if (jscBox) jscBox.checked = jscOn;
  }

  function open() {
    if (!mask) buildDialog();
    if (!mask) return;
    syncDialog();
    mask.hidden = false;
    var first = mask.querySelector('.dbx-theme-item.is-on') || mask.querySelector('.dbx-theme-item');
    if (first) first.focus();
  }

  function close() {
    if (mask) mask.hidden = true;
  }

  function closest(el, cls) {
    while (el && el !== document) {
      if (el.classList && el.classList.contains(cls)) return el;
      el = el.parentNode;
    }
    return null;
  }

  // 事件委托：按钮可能在首页，也可能在编辑器顶栏；弹窗由脚本动态创建
  document.addEventListener('click', function (e) {
    var t = e.target;

    if (closest(t, 'dbx-set-btn')) { open(); return; }

    if (!mask || mask.hidden) return;
    if (t === mask) { close(); return; }

    var item = closest(t, 'dbx-theme-item');
    if (item) { apply(item.getAttribute('data-theme-id')); return; }

    var actBtn = closest(t, 'dbx-set-x') || closest(t, 'dbx-btn');
    if (actBtn) {
      var a = actBtn.getAttribute('data-act');
      if (a === 'close') close();
      else if (a === 'reset') { apply('default'); setJsc(false); }
    }
  });

  // 原生 checkbox 用 change 事件保存，点文字标签也能切换
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'dbx-jsc') setJsc(e.target.checked);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && mask && !mask.hidden) close();
  });

  // 多个标签页之间同步
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) apply(isKnown(e.newValue) ? e.newValue : 'default', false);
    else if (e.key === KEY_JSC) { jscOn = e.newValue === '1'; syncDialog(); }
  });

  // 弹窗按需创建：脚本在 <head> 里同步执行，此时 body 尚未解析，
  // 不在加载阶段动 DOM，首次点设置按钮时再插入（open() 会自动 buildDialog）。

  // 供编辑器 / 其它脚本读取（主题色、构建开关）
  var api = {
    list: function () { return THEMES.slice(); },
    current: function () { return current; },
    apply: function (id) { apply(id); },
    open: open,
    close: close,
    jscEnabled: jscEnabled,
    setJsc: setJsc,
    css: function (name, fallback) {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--t-' + name).trim();
      return v || fallback || '';
    },
    gearIcon: function () { return GEAR; }
  };
  window.DBX_SETTINGS = api;
  window.DBX_THEME = api;   // 兼容既有引用（编辑器读取主题色仍用这个名字）
})();
