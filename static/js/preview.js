// Duck Box —— 手环屏幕模拟预览器
// 把积木生成的页面结构渲染到一个仿手环屏幕里，可点击、可交互、可看数据变化
window.DBX_PREVIEW = (function () {
  'use strict';

  var state = {
    root: null,
    deviceType: 'band10',
    designWidth: 0,    // 项目 designWidth（0 = 与设备宽度一致）
    assetBase: '',      // 用户图片的访问前缀，如 /api/projects/xxx/assets
    pages: [],
    current: null,      // 当前页面名
    history: [],        // 页面历史栈（用于返回）
    stores: {},         // 每页数据 { pageName: {var: value} }
    compiled: {},       // 编译后的方法 { pageName: {methodName: fn} }
    bcastHandlers: {},  // 广播接收 { pageName: {事件名: [fn]} }
    timers: [],
    logLines: [],
    running: false,
    zoom: 100          // 预览缩放百分比：100% = 自适应后的原始大小
  };

  // 屏幕尺寸（设计单位）：1px = 1 设计单位，随设备型号变化；
  // designWidth 与设备宽不一致时按宽高比等比换算，与生成的 .ux 坐标完全一致
  function screenSize() {
    var scr = (window.DBX && DBX.deviceScreen)
      ? DBX.deviceScreen(state.deviceType)
      : { w: 212, h: 520 };
    var dw = state.designWidth || scr.w;
    return { w: dw, h: Math.round(dw * (scr.h / scr.w)) };
  }

  // ------------------------------------------------------------------ //
  // 工具
  // ------------------------------------------------------------------ //
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function log(msg, kind) {
    state.logLines.push({ msg: msg, kind: kind || 'info' });
    if (state.logLines.length > 60) state.logLines.shift();
    renderLog();
  }

  function clearTimers() {
    state.timers.forEach(function (t) {
      clearTimeout(t);
      clearInterval(t);
    });
    state.timers = [];
  }

  // ------------------------------------------------------------------ //
  // 数据求值：{{表达式}} → 值
  // ------------------------------------------------------------------ //
  function evalExpr(expr, store) {
    expr = expr.trim();
    try {
      // 布尔/空值字面量（data 初始值常为 "true"/"false"）
      if (expr === 'true') return true;
      if (expr === 'false') return false;
      if (expr === 'null' || expr === 'undefined') return null;
      // 纯标识符（含中文变量名）直接查表
      if (/^[_$A-Za-z\u4e00-\u9fa5][_$A-Za-z0-9\u4e00-\u9fa5]*$/.test(expr)) {
        return store[expr];
      }
      var keys = Object.keys(store || {});
      // eslint-disable-next-line no-new-func
      var fn = Function.apply(null, keys.concat(['return (' + expr + ');']));
      return fn.apply(null, keys.map(function (k) { return (store || {})[k]; }));
    } catch (e) {
      // 纯数字四则运算不依赖变量
      if (/^[0-9+\-*/().\s]+$/.test(expr)) {
        try {
          // eslint-disable-next-line no-new-func
          return Function('return (' + expr + ')')();
        } catch (e2) { /* 放弃 */ }
      }
      return undefined;
    }
  }

  function interpolate(text, store) {
    return String(text == null ? '' : text).replace(/\{\{([^}]*)\}\}/g, function (_, expr) {
      var v = evalExpr(expr, store);
      return v === undefined ? '' : v;
    });
  }

  // ------------------------------------------------------------------ //
  // 系统接口模拟层
  // ------------------------------------------------------------------ //
  function makeShims(store, pageName) {
    var shims = {
      app: {
        terminate: function () {
          log('🚪 退出快应用（预览模拟，真机上会直接退出）');
          showToast('退出快应用', 1500);
        }
      },
      prompt: {
        showToast: function (opt) {
          showToast(interpolate(opt && opt.message, store), (opt && opt.duration) || 1500);
          log('💬 Toast：' + interpolate((opt && opt.message) || '', store));
        },
        showDialog: function (opt) {
          showToast(interpolate((opt && opt.message) || '', store), 2000);
          if (opt && typeof opt.success === 'function') opt.success();
        }
      },
      router: {
        push: function (opt) {
          var uri = (opt && opt.uri) || '';
          var name = uri.split('/').pop();
          log('➡️ 跳转到页面：' + name);
          navigate(name);
        },
        back: function () {
          log('↩️ 返回上一页');
          goBack();
        }
      },
      vibrator: {
        vibrate: function (opt) {
          shake((opt && opt.mode) === 'short' ? 120 : 400);
          log('📳 震动（' + ((opt && opt.mode) || 'long') + '）');
        }
      },
      battery: {
        getStatus: function (opt) {
          setTimeout(function () {
            if (opt && opt.success) opt.success({ charging: false, level: 0.66 });
          }, 120);
        }
      },
      storage: {
        _data: {},
        set: function (opt) { this._data[opt.key] = String(opt.value); log('💾 已保存 ' + opt.key); },
        get: function (opt) {
          var v = this._data[opt.key];
          setTimeout(function () {
            if (opt && opt.success) opt.success(v !== undefined ? v : '');
          }, 80);
        },
        clear: function () { this._data = {}; },
        delete: function (opt) { delete this._data[opt.key]; }
      },
      console: {
        log: function () {
          log('🖨️ ' + Array.prototype.slice.call(arguments).map(function (a) {
            return typeof a === 'object' ? JSON.stringify(a) : String(a);
          }).join(' '));
        },
        warn: function () { this.log.apply(this, arguments); },
        error: function () { this.log.apply(this, arguments); }
      }
    };
    return shims;
  }

  // 把方法体编译成可执行函数
  function compileMethod(page, methodName, body, store, pageName) {
    try {
      var shims = makeShims(store, pageName);
      // 带参方法：key 形如 onKey(val)，把参数名并入函数作用域
      var paramName = null;
      var pm = /^[A-Za-z_$][\w$]*\s*\(([^)]*)\)$/.exec(methodName);
      if (pm && pm[1].trim()) paramName = pm[1].trim();
      // 方法体里的 this.xxx 通过 fn.apply(数据代理) 注入
      // （'this' 是保留字不能当参数名）；末位 e 供开关/滑块事件使用
      var names = Object.keys(shims)
        .concat(['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'])
        .concat(paramName ? [paramName] : [])
        .concat(['e']);
      var vals = Object.keys(shims).map(function (k) { return shims[k]; })
        .concat([
          function (fn, ms) { var id = setTimeout(function () { try { fn(); } catch (e) { logErr(e); } }, ms); state.timers.push(id); return id; },
          function (fn, ms) { var id = setInterval(function () { try { fn(); } catch (e) { logErr(e); } }, ms); state.timers.push(id); return id; },
          function (id) { clearTimeout(id); clearInterval(id); },
          function (id) { clearTimeout(id); }
        ])
        .concat(paramName ? [undefined] : [])
        .concat([undefined]);
      var fn = Function.apply(null, names.concat([body]));
      return function (paramVal, ev) {
        try {
          var args = vals.slice();
          if (paramName) args[args.length - 2] = paramVal;
          args[args.length - 1] = ev;
          return fn.apply(makeThisProxy(store, pageName), args);
        } catch (e) {
          logErr(e);
        }
      };
    } catch (e) {
      logErr(e);
      return function () {};
    }
  }

  function makeThisProxy(store, pageName) {
    return new Proxy(store, {
      get: function (o, k) {
        if (k === '$broadcast') {
          return function (ev) { fireBroadcast(pageName, ev); };
        }
        if (k === '$on') {
          return function (ev, fn) { registerBroadcast(pageName, ev, fn); };
        }
        if (k in o) return o[k];
        var m = (state.compiled[pageName] || {})[k];
        if (typeof m === 'function') return m;
        return undefined;
      },
      set: function (o, k, v) {
        o[k] = v;
        scheduleRefresh();
        return true;
      }
    });
  }

  function registerBroadcast(pageName, ev, fn) {
    if (typeof fn !== 'function') return;
    if (!state.bcastHandlers[pageName]) state.bcastHandlers[pageName] = {};
    var arr = state.bcastHandlers[pageName][ev] || [];
    if (arr.indexOf(fn) < 0) arr.push(fn);
    state.bcastHandlers[pageName][ev] = arr;
  }

  function fireBroadcast(pageName, ev) {
    var arr = (state.bcastHandlers[pageName] || {})[ev] || [];
    log('📢 广播「' + ev + '」（' + arr.length + ' 个接收者）');
    arr.forEach(function (fn) {
      try { fn(); } catch (e) { logErr(e); }
    });
  }

  function logErr(e) {
    log('❌ 运行出错：' + (e && e.message ? e.message : e), 'error');
  }

  // ------------------------------------------------------------------ //
  // 渲染
  // ------------------------------------------------------------------ //
  function mount(root, opts) {
    state.root = root;
    state.deviceType = opts.deviceType || 'band10';
    state.designWidth = opts.designWidth || 0;
    state.assetBase = opts.assetBase || '';
    state.pages = opts.pages || [];
    state.stores = {};
    state.compiled = {};
    state.bcastHandlers = {};
    state.history = [];
    state.logLines = [];
    clearTimers();

    root.innerHTML = '';
    root.className = 'pv-root pv-' + state.deviceType;

    // 顶部提示：预览与实机的差异说明
    root.appendChild(el('div', 'pv-note',
      '该预览和实机可能有差异，不代表最终品质，后面需进一步测试'));

    // 舞台：stagebox 撑起缩放后的实际高度，
    // 避免 transform 缩放导致布局溢出、预览被截断
    var stagebox = el('div', 'pv-stagebox');
    var stage = el('div', 'pv-stage');
    var screen = el('div', 'pv-screen');
    stage.appendChild(screen);
    stagebox.appendChild(stage);
    root.appendChild(stagebox);

    state.screenEl = screen;
    state.stageEl = stage;
    state.stageBoxEl = stagebox;
    state.logBoxEl = null;

    bindEditEvents();

    var first = state.pages.length ? findPage(state.pages[0].name).name : null;
    showPage(first);
    resize();

    log('👀 预览就绪（编辑模式）：可拖动组件排版；点下方「▶ 启动」后才能互动快应用');
  }

  function findPage(name) {
    for (var i = 0; i < state.pages.length; i++) {
      if (state.pages[i].name === name) return state.pages[i];
    }
    return null;
  }

  function ensureStore(page) {
    if (!state.stores[page.name]) {
      var store = {};
      Object.keys(page.data || {}).forEach(function (k) {
        store[k] = evalDataValue(page.data[k], store);
      });
      state.stores[page.name] = store;

      // 编译本页所有方法
      state.compiled[page.name] = {};
      var methods = page.methods || {};
      Object.keys(methods).forEach(function (m) {
        state.compiled[page.name][m] = compileMethod(page, m, methods[m], store, page.name);
      });

      // 生命周期自动触发：onInit 注册广播，onReady 初始化界面；
      // onShow 由 showPage 每次进入页面时触发（手环没有开始按钮）
      [['onInit', 10], ['onReady', 40]].forEach(function (pair) {
        if (methods[pair[0]]) {
          setTimeout(function () { callMethod(page.name, pair[0]); }, pair[1]);
        }
      });
    }
    return state.stores[page.name];
  }

  // data 初始值是 JS 表达式字符串（如 0、''、"/assets/a.png"、Date.now()），
  // 直接按表达式求值；若不是合法表达式（如裸文本），再退化为去掉外层引号/花括号的纯字符串。
  function evalDataValue(raw, store) {
    var s = String(raw == null ? '' : raw).trim();
    var v = evalExpr(s, store);
    if (v !== undefined) return v;
    return s.replace(/^\{\{|\}\}$/g, '').replace(/^['"]|['"]$/g, '');
  }

  function showPage(name) {
    var page = findPage(name);
    if (!page) {
      state.screenEl.innerHTML = '<div class="pv-empty">还没有页面<br>点顶部的「＋ 页面」新建一个开始创作吧</div>';
      return;
    }
    state.current = name;
    var store = ensureStore(page);
    renderScreen(page, store);
    // 「当进入页面」= onShow：每次进入页面都执行（首次进入、从其他页返回都会触发）
    if (state.running && page.methods && page.methods.onShow) {
      setTimeout(function () {
        if (state.current === page.name) callMethod(page.name, 'onShow');
      }, 70);
    }
  }

  function navigate(name) {
    if (findPage(name)) {
      if (state.current) state.history.push(state.current);
      showPage(name);
    } else {
      showToast('页面不存在：' + name, 1800);
    }
  }

  function goBack() {
    if (state.history.length) {
      showPage(state.history.pop());
    } else {
      showToast('已经是第一页啦', 1200);
    }
  }

  function callMethod(pageName, method, arg) {
    // 编辑模式下快应用不运行：所有事件 / 生命周期一律不执行
    if (!state.running) return;
    var c = state.compiled[pageName] || {};
    var fn = null, args = [];
    if (method.indexOf('(') >= 0) {
      // 带参调用：onKey('7') → 匹配编译后的 onKey(val)，并解析出实参
      var m = /^([A-Za-z_$][\w$]*)\s*\((.*)\)$/.exec(method.trim());
      if (m) {
        var base = m[1];
        var argStr = m[2].trim();
        if (argStr) {
          try { args = Function('return [' + argStr + ']')(); } catch (e) { args = [argStr]; }
        }
        var keys = Object.keys(c);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (k === base || k.indexOf(base + '(') === 0) { fn = c[k]; break; }
        }
        if (!fn) fn = c[base] || c[base + '()'];
      }
    } else {
      fn = c[method];
      // 无参绑定（如 onclick="onTap"）对应的方法在生成时带参数名（onTap(参数)），
      // 直接查表落空，这里退化为前缀匹配，保证无参点击也能命中
      if (!fn) {
        var plainKeys = Object.keys(c);
        for (var p = 0; p < plainKeys.length; p++) {
          if (plainKeys[p].indexOf(method + '(') === 0) { fn = c[plainKeys[p]]; break; }
        }
      }
      // 事件回调（开关 onchange / 滑块 onchange / 输入框）：把事件参数同时塞进
      // 「声明参数」和末位 e 两个位置，保证 e.checked / e.progress 都能取到值
      if (fn && arg !== undefined) args = [arg, arg];
    }
    if (fn) {
      fn.apply(null, args);
      scheduleRefresh();
    } else {
      showToast('方法不存在：' + method, 1600);
      log('⚠️ 方法「' + method + '」没有定义（检查事件积木的事件名）', 'warn');
    }
  }

  // 直接带真实事件对象调用已编译方法（触摸 / 滑动等需要事件参数）
  function callMethodWithEvent(pageName, method, ev) {
    if (!state.running) return;
    var c = state.compiled[pageName] || {};
    var fn = c[method];
    if (!fn) {
      var keys = Object.keys(c);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(method + '(') === 0) { fn = c[keys[i]]; break; }
      }
    }
    if (!fn) return;
    try { fn(undefined, ev); } catch (e) { logErr(e); }
    scheduleRefresh();
  }

  // 浏览器坐标 → 设备设计坐标（与生成代码里 clientX 的语义一致，原点：屏幕左上角）
  function toDesignPoint(e) {
    var wrap = state.pageEl || state.screenEl;
    if (!wrap || !e) return { clientX: 0, clientY: 0 };
    var r = wrap.getBoundingClientRect();
    var s = screenSize();
    return {
      clientX: Math.round((e.clientX - r.left) / Math.max(1, r.width) * s.w),
      clientY: Math.round((e.clientY - r.top) / Math.max(1, r.height) * s.h)
    };
  }

  // 页面级交互：根节点的 ontouchstart / onclick / onswipe
  // （生成的 .ux 把这些挂在根节点上，预览里也要绑到 .pv-page 上才能生效）
  function wirePageEvents(wrap, page) {
    var c = state.compiled[page.name] || {};
    var has = function (name) {
      var keys = Object.keys(c);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] === name || keys[i].indexOf(name + '(') === 0) return true;
      }
      return false;
    };
    var hasTouch = has('dbx_on_touchstart');
    var hasSwipe = has('dbx_on_swipe');
    if (hasTouch || hasSwipe) wrap.classList.add('pv-gesture');
    if (hasTouch || hasSwipe) {
      var startPt = null, lastPt = null;
      wrap.addEventListener('pointerdown', function (e) {
        var p = toDesignPoint(e);
        startPt = p;
        lastPt = p;
        if (hasTouch) {
          callMethodWithEvent(page.name, 'dbx_on_touchstart',
            { touches: [{ clientX: p.clientX, clientY: p.clientY }] });
        }
      });
      wrap.addEventListener('pointermove', function (e) {
        if (!startPt) return;
        var p = toDesignPoint(e);
        lastPt = p;
        if (hasTouch) {
          callMethodWithEvent(page.name, 'dbx_on_touchmove',
            { touches: [{ clientX: p.clientX, clientY: p.clientY }] });
        }
      });
      wrap.addEventListener('pointerup', function () {
        if (hasTouch) callMethodWithEvent(page.name, 'dbx_on_touchend', {});
        if (hasSwipe && startPt && lastPt) {
          var dx = lastPt.clientX - startPt.clientX;
          var dy = lastPt.clientY - startPt.clientY;
          var dir = '';
          if (Math.abs(dx) > 24 && Math.abs(dx) >= Math.abs(dy)) dir = dx > 0 ? 'right' : 'left';
          else if (Math.abs(dy) > 24) dir = dy > 0 ? 'down' : 'up';
          if (dir) callMethodWithEvent(page.name, 'dbx_on_swipe', { direction: dir });
        }
        startPt = null;
        lastPt = null;
      });
    }
    if (has('dbx_on_tap')) {
      wrap.addEventListener('click', function () {
        callMethodWithEvent(page.name, 'dbx_on_tap', {});
      });
    }
  }

  function renderScreen(page, store) {
    var screen = state.screenEl;
    clearEditSel();
    screen.innerHTML = '';

    // 样式
    var styleText = buildCss(page);
    var styleEl = document.createElement('style');
    styleEl.textContent = styleText;
    screen.appendChild(styleEl);

    // 真机屏幕不会显示时间/电量状态栏，预览里也不画
    var wrap = el('div', 'pv-page');
    screen.appendChild(wrap);
    state.pageEl = wrap;
    // 页面级触摸 / 点击 / 滑动事件（对应生成的根节点 ontouchstart / onclick / onswipe）
    try { wirePageEvents(wrap, page); } catch (eW) { /* ignore */ }

    // 解析生成的 UI 标记
    var tpl = document.createElement('template');
    tpl.innerHTML = page.ui || '<text>' + esc(page.title || '空空如也') + '</text>';
    Array.prototype.slice.call(tpl.content.childNodes).forEach(function (node) {
      convertNode(node, wrap, store, page);
    });

    refreshBindings();
  }

  // 渲染角色克隆体：数据里每个 <角色>_clones 存一组 {src,text,isText,x,y,cx,cy,l,t,w,h,z,rot,size,color}
  // 每次调用先清掉旧克隆体再重建，保证与数据一致
  function renderClones(wrap, store) {
    if (!wrap) return;
    Array.prototype.slice.call(wrap.querySelectorAll('.pv-clone')).forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    Object.keys(store || {}).forEach(function (k) {
      if (k.indexOf('_clones') < 0) return;
      var arr = store[k];
      if (!Array.isArray(arr)) return;
      arr.forEach(function (c) {
        if (!c) return;
        // 已隐藏的克隆体不渲染
        if (c.show === false) return;
        var node;
        if (c.isText) {
          node = el('div', 'pv-text pv-clone');
          node.textContent = String(c.text == null ? '' : c.text);
          node.style.textAlign = 'center';
          node.style.whiteSpace = 'pre-wrap';
          node.style.lineHeight = '1.2';
          if (c.size) node.style.fontSize = c.size + 'px';
          if (c.color) node.style.color = c.color;
        } else {
          node = document.createElement('img');
          node.className = 'pv-img pv-clone';
          node.src = resolveAssetUrl(c.src) || '/static/img/logo.png';
          node.onerror = function () { node.src = '/static/img/logo.png'; };
        }
        // 优先用克隆体自带的绝对坐标 l/t；旧数据没有时按 中心 + 偏移 − 半个宽高 换算
        var left = (c.l != null)
          ? Number(c.l) || 0
          : (Number(c.cx) || 0) + (Number(c.x) || 0) - (Number(c.w) || 0) / 2;
        var top = (c.t != null)
          ? Number(c.t) || 0
          : (Number(c.cy) || 0) + (Number(c.y) || 0) - (Number(c.h) || 0) / 2;
        node.style.position = 'absolute';
        node.style.left = left + 'px';
        node.style.top = top + 'px';
        if (c.w) node.style.width = c.w + 'px';
        if (c.h) node.style.height = c.h + 'px';
        if (c.z != null) node.style.zIndex = c.z;
        if (c.rot) node.style.transform = 'rotate(' + c.rot + 'deg)';
        node.style.pointerEvents = 'none';
        wrap.appendChild(node);
      });
    });
  }

  function buildCss(page) {
    var css =
      '.pv-page{width:100%;height:100%;position:relative;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:flex-start;gap:8px;padding:10px 0;overflow-y:auto;overflow-x:hidden;' +
      'scrollbar-width:none;font-family:inherit;}' +
      '.pv-page::-webkit-scrollbar{display:none;}' +
      '.pv-page.pv-gesture{touch-action:none;}' +
      '.pv-box{position:relative;}' +
      '.pv-editable{cursor:move;}' +
      '.pv-editable.pv-selected{outline:2px dashed #ff9f1a;outline-offset:2px;}' +
      '.pv-handle{position:absolute;width:14px;height:14px;border-radius:50%;' +
      'background:#ff9f1a;border:2px solid #fff;z-index:50;box-shadow:0 1px 4px rgba(0,0,0,.4);}' +
      '.pv-handle::after{content:"";position:absolute;left:3px;top:3px;right:3px;bottom:3px;' +
      'border-radius:50%;background:rgba(0,0,0,.18);}' +
      '.pv-edittip{position:absolute;left:0;top:0;z-index:60;background:rgba(43,35,64,.85);color:#fff;' +
      'font-size:10px;line-height:1.6;padding:2px 8px;border-radius:0 0 8px 0;pointer-events:none;}';
    (page.styles || []).forEach(function (s) {
      css += '.pv-' + s.sel + '{' + s.decls + '}';
    });
    return css;
  }

  function convertNode(node, parent, store, page) {
    if (node.nodeType === Node.TEXT_NODE) {
      var txt = node.textContent.trim();
      if (txt) {
        var span = el('span', null, interpolate(txt, store));
        span.dataset.bind = txt;
        parent.appendChild(span);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    var tag = node.tagName.toLowerCase();
    var cls = node.getAttribute('class');

    // 克隆体用 for 模板描述，预览器按数据自行渲染（见 renderClones），这里跳过
    if (node.getAttribute && node.getAttribute('for')) return;

    switch (tag) {
      case 'div': {
        var d = el('div');
        applyClass(d, cls);
        copyInlineSize(node, d);
        applyNodeStyle(d, node, store);
        parent.appendChild(d);
        Array.prototype.slice.call(node.childNodes).forEach(function (c) {
          convertNode(c, d, store, page);
        });
        break;
      }
      case 'text': {
      var t = el('div', 'pv-text');
      applyClass(t, cls);
      t.textContent = interpolate(node.textContent, store);
      t.dataset.bind = node.textContent;
      copyInlineSize(node, t);
      applyNodeStyle(t, node, store);
      markEditable(t, node);
      // 文本角色同样支持点击/长按（此前漏绑，导致「当角色被点击」对文本角色无效）
      var tClick = node.getAttribute('onclick');
      var tLong = node.getAttribute('onlongpress');
      if (tClick || tLong) t.classList.add('pv-clickable');
      wirePress(t, tClick, tLong, page);
      parent.appendChild(t);
      break;
    }
      // innerHTML 解析时浏览器会把 <image> 按 HTML 规范强制转成 <img>，
      // 因此这里必须同时匹配 img（coerced）与 image（少数组装的原始标记）
      case 'img':
      case 'image': {
        var img = document.createElement('img');
        img.className = 'pv-img';
        applyClass(img, cls);
        var rawSrcExpr = node.getAttribute('src') || '';
        var src = interpolate(rawSrcExpr, store);
        img._rawSrc = src;
        img.src = resolveAssetUrl(src) || '/static/img/logo.png';
        if (rawSrcExpr.indexOf('{{') >= 0) img.dataset.srcBind = rawSrcExpr;
        img.onerror = function () { img.src = '/static/img/logo.png'; };
      copyInlineSize(node, img);
      applyNodeStyle(img, node, store);
      markEditable(img, node);
      var imgClick = node.getAttribute('onclick');
        var imgLong = node.getAttribute('onlongpress');
        if (imgClick || imgLong) img.classList.add('pv-clickable');
        wirePress(img, imgClick, imgLong, page);
        parent.appendChild(img);
        break;
      }
      case 'stack': case 'scroll': {
        var box = el('div', 'pv-box');
        applyClass(box, cls);
        if (tag === 'scroll') box.style.overflow = 'auto';
        applyNodeStyle(box, node, store);
        parent.appendChild(box);
        Array.prototype.slice.call(node.childNodes).forEach(function (c) {
          convertNode(c, box, store, page);
        });
        break;
      }
      case 'swiper': {
        var swp = el('div', 'pv-swiper');
        applyClass(swp, cls);
        applyNodeStyle(swp, node, store);
        parent.appendChild(swp);
        Array.prototype.slice.call(node.childNodes).forEach(function (c) {
          convertNode(c, swp, store, page);
        });
        break;
      }
      case 'switch': {
        var swOn = truthyShow(interpolate(node.getAttribute('checked') || 'false', store));
        var swi = el('div', 'pv-switch' + (swOn ? ' on' : ''));
        applyClass(swi, cls);
        applyNodeStyle(swi, node, store);
        swi.appendChild(el('span', 'pv-switch-knob'));
        var swChange = (node.getAttribute('onchange') || '').trim();
        swi.classList.add('pv-clickable');
        swi.addEventListener('click', function () {
          if (!state.running) return;
          var next = !swi.classList.contains('on');
          swi.classList.toggle('on', next);
          if (swChange) callMethod(page.name, swChange, { checked: next });
        });
        parent.appendChild(swi);
        break;
      }
      case 'slider': {
        var sld = document.createElement('input');
        sld.type = 'range';
        sld.className = 'pv-slider';
        applyClass(sld, cls);
        sld.min = node.getAttribute('min') || '0';
        sld.max = node.getAttribute('max') || '100';
        sld.value = interpolate(node.getAttribute('value') || '50', store);
        applyNodeStyle(sld, node, store);
        var sldChange = (node.getAttribute('onchange') || '').trim();
        sld.addEventListener('change', function () {
          if (!state.running) return;
          if (sldChange) callMethod(page.name, sldChange, { progress: Number(sld.value) });
        });
        parent.appendChild(sld);
        break;
      }
      case 'button': {
        var b = el('div', 'pv-btn');
        applyClass(b, cls);
        b.textContent = node.textContent;
        copyInlineSize(node, b);
        applyNodeStyle(b, node, store);
        var clickEv = node.getAttribute('onclick');
        var longEv = node.getAttribute('onlongpress');
        wirePress(b, clickEv, longEv, page);
        parent.appendChild(b);
        break;
      }
      case 'input': {
      if ((node.getAttribute('type') || '').toLowerCase() === 'button') {
        var btn = el('div', 'pv-btn');
        applyClass(btn, cls);
        btn.textContent = node.getAttribute('value') || '按钮';
        copyInlineSize(node, btn);
        applyNodeStyle(btn, node, store);
        markEditable(btn, node);
        wirePress(btn, node.getAttribute('onclick'), node.getAttribute('onlongpress'), page);
        parent.appendChild(btn);
        break;
      }
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = node.getAttribute('placeholder') || '';
        applyClass(inp, cls);
        copyInlineSize(node, inp);
        var valAttr = node.getAttribute('value') || '';
        if (valAttr) {
          inp.value = interpolate(valAttr, store);
          inp.dataset.bindVal = valAttr;
        }
        applyNodeStyle(inp, node, store);
        var changeHandler = (node.getAttribute('onchange') || '').trim();
        inp.addEventListener('change', function () {
          if (!state.running) return;
          if (changeHandler) callMethod(page.name, changeHandler, { value: inp.value });
        });
        parent.appendChild(inp);
        break;
      }
      case 'progress': {
        var p = el('div', 'pv-progress-wrap');
        applyClass(p, cls);
        applyNodeStyle(p, node, store);
        var isArc = (node.getAttribute('type') === 'arc');
        var pct = parseFloat(interpolate(node.getAttribute('percent') || '0', store)) || 0;
        if (isArc) {
          p.classList.add('arc');
          p.appendChild(el('div', 'pv-progress-num', Math.round(pct) + '%'));
          p.style.setProperty('--pct', Math.max(0, Math.min(100, pct)));
        } else {
          var bar = el('div', 'pv-progress-bar');
          bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
          p.appendChild(bar);
        }
        p.dataset.pctBind = node.getAttribute('percent') || '';
        parent.appendChild(p);
        break;
      }
      default:
        parent.appendChild(el('span'));
    }
  }

  function applyClass(elm, cls) {
    if (!cls) return;
    cls.trim().split(/\s+/).forEach(function (c) {
      if (!c || c.indexOf('dbxc-') === 0) return;
      elm.classList.add('pv-' + c);
    });
  }

  // dbxc-名称 类 → 组件可编辑（拖动/缩放回写积木）
  function markEditable(target, node) {
    var cls = node.getAttribute('class') || '';
    var token = cls.split(/\s+/).filter(function (c) { return c.indexOf('dbxc-') === 0; })[0];
    if (!token) return;
    var name;
    try { name = decodeURIComponent(token.slice(5)); } catch (e) { name = token.slice(5); }
    if (!name) return;
    target.dataset.cname = name;
    var isImage = node.tagName.toLowerCase() === 'image' || node.tagName.toLowerCase() === 'img';
    target.dataset.ctype = isImage ? 'image'
      : (node.tagName.toLowerCase() === 'text' ? 'text' : 'button');
    target.classList.add('pv-editable');
  }

  function copyInlineSize(from, to) {
    var w = from.getAttribute('width'), h = from.getAttribute('height');
    if (w) to.style.width = /^\d+$/.test(w) ? w + 'px' : w;
    if (h) to.style.height = /^\d+$/.test(h) ? h + 'px' : h;
  }

  function truthyShow(v) {
    return v === true || v === 1 || v === 'true' || v === '1';
  }

  // 生成的 style="transform: translate({{x}}px,…) rotate(…)" 与 show="{{v}}" 属性绑定
  function applyNodeStyle(target, node, store) {
    var styleAttr = node.getAttribute('style') || '';
    if (styleAttr) {
      if (/\{\{/.test(styleAttr)) {
        target.dataset.styleBind = styleAttr;
        target.setAttribute('style', interpolate(styleAttr, store));
      } else {
        target.setAttribute('style', styleAttr);
      }
    }
    var showAttr = node.getAttribute('show');
    if (showAttr != null && showAttr !== '') {
      target.dataset.showBind = showAttr;
      target.style.display = truthyShow(interpolate(showAttr, store)) ? '' : 'none';
    }
  }

  // 点击 + 长按检测
  function wirePress(btn, clickEv, longEv, page) {
    var timer = null, pressed = false, longFired = false;
    btn.addEventListener('mousedown', pressStart);
    btn.addEventListener('touchstart', pressStart);
    btn.addEventListener('mouseup', pressCancel);
    btn.addEventListener('mouseleave', pressCancel);
    btn.addEventListener('touchend', pressCancel);

    function pressStart() {
      if (!state.running) { pressed = false; return; }
      if (state.__pvDragging) { pressed = false; return; }
      pressed = true;
      longFired = false;
      btn.classList.add('pressed');
      if (longEv) {
        timer = setTimeout(function () {
          timer = null;
          longFired = true;   // 长按已触发，松手时不再补发点击
          pressed = false;
          navigator.vibrate && navigator.vibrate(30);
          callMethod(page.name, longEv);
        }, 550);
      }
    }
    function pressCancel() {
      btn.classList.remove('pressed');
      if (timer) { clearTimeout(timer); timer = null; }
      if (pressed && clickEv && !longFired && !state.__pvDragging) {
        callMethod(page.name, clickEv);
      }
      pressed = false;
    }
  }

  // ------------------------------------------------------------------ //
  // 预览内组件编辑：点选组件 → 默认拖动移动；按 O 键切换为四边/四角自由缩放
  // ------------------------------------------------------------------ //
  var edit = { target: null, handles: [], hHolder: null, tip: null, intent: 'move' };
  // 8 个缩放手柄
  var HANDLES = [
    { dir: 'n',  cur: 'ns-resize' }, { dir: 's',  cur: 'ns-resize' },
    { dir: 'e',  cur: 'ew-resize' }, { dir: 'w',  cur: 'ew-resize' },
    { dir: 'ne', cur: 'nesw-resize' }, { dir: 'nw', cur: 'nwse-resize' },
    { dir: 'se', cur: 'nwse-resize' }, { dir: 'sw', cur: 'nesw-resize' }
  ];

  function ensureAbsolute(t) {
    if (getComputedStyle(t).position === 'absolute') return;
    var ol = t.offsetLeft, ot = t.offsetTop;
    t.style.position = 'absolute';
    t.style.left = ol + 'px';
    t.style.top = ot + 'px';
    t.style.margin = '0';
    // 同父容器内其它流式组件也一并转绝对、固定到当前屏幕位置，避免它们跳动
    var par = t.parentElement;
    if (par) {
      Array.prototype.forEach.call(par.children, function (o) {
        if (o === t || !o.classList || !o.dataset) return;
        if (!o.dataset.cname) return;
        if (getComputedStyle(o).position === 'absolute') return;
        o.style.position = 'absolute';
        o.style.left = o.offsetLeft + 'px';
        o.style.top = o.offsetTop + 'px';
        o.style.margin = '0';
      });
    }
  }

  function clearHandles() {
    edit.handles.forEach(function (h) { if (h.parentNode) h.parentNode.removeChild(h); });
    edit.handles = [];
  }

  function selectComponent(elm) {
    clearEditSel();
    edit.target = elm;
    elm.classList.add('pv-selected');
    ensureAbsolute(elm);
    updateEditOverlay();
  }

  function clearEditSel() {
    if (edit.target) edit.target.classList.remove('pv-selected');
    clearHandles();
    if (edit.tip && edit.tip.parentNode) edit.tip.parentNode.removeChild(edit.tip);
    edit.target = null; edit.tip = null; edit.hHolder = null;
  }

  function updateEditOverlay() {
    var t = edit.target;
    if (!t) return;
    // 提示条
    if (!edit.tip) { edit.tip = el('div', 'pv-edittip'); state.screenEl.appendChild(edit.tip); }
    edit.tip.textContent = '「' + t.dataset.cname + '」：拖动改位置｜拖四角/四边改大小';

    // 手柄一直显示：选中即可直接拖角缩放，不用再记快捷键
    var holder = t.offsetParent || state.screenEl;
    edit.hHolder = holder;
    clearHandles();
    var l = t.offsetLeft, to = t.offsetTop, w = t.offsetWidth, h = t.offsetHeight;
    var cx = l + w / 2, cy = to + h / 2;
    var pos = {
      n: [cx, to], s: [cx, to + h], e: [l + w, cy], w: [l, cy],
      ne: [l + w, to], nw: [l, to], se: [l + w, to + h], sw: [l, to + h]
    };
    HANDLES.forEach(function (def) {
      var hnd = el('div', 'pv-handle pv-h-' + def.dir);
      hnd.dataset.dir = def.dir;
      hnd.style.cursor = def.cur;
      hnd.style.left = (pos[def.dir][0] - 7) + 'px';
      hnd.style.top = (pos[def.dir][1] - 7) + 'px';
      hnd.style.right = 'auto'; hnd.style.bottom = 'auto';
      holder.appendChild(hnd);
      edit.handles.push(hnd);
    });
    syncHandles();
  }

  // 拖动过程中保持手柄贴在目标边缘
  function syncHandles() {
    var t = edit.target;
    if (!t || !edit.handles.length) return;
    var l = t.offsetLeft, to = t.offsetTop, w = t.offsetWidth, h = t.offsetHeight;
    var cx = l + w / 2, cy = to + h / 2;
    var pos = {
      n: [cx, to], s: [cx, to + h], e: [l + w, cy], w: [l, cy],
      ne: [l + w, to], nw: [l, to], se: [l + w, to + h], sw: [l, to + h]
    };
    edit.handles.forEach(function (hnd) {
      var p = pos[hnd.dataset.dir];
      hnd.style.left = (p[0] - 7) + 'px';
      hnd.style.top = (p[1] - 7) + 'px';
    });
  }

  function bindEditEvents() {
    var screen = state.screenEl;
    screen.addEventListener('pointerdown', function (e) {
      if (state.running) return;
      if (e.button != null && e.button !== 0) return;
      var handle = e.target.closest && e.target.closest('.pv-handle');
      var editable = e.target.closest && e.target.closest('.pv-editable');
      if (!handle && !editable) { clearEditSel(); return; }
      if (handle) {
        if (edit.target && handle.dataset.dir) beginDrag(e, 'resize', handle.dataset.dir);
      } else if (editable && editable.dataset.cname) {
        selectComponent(editable);
        beginDrag(e, 'move');
      }
      e.preventDefault();
    });

  }

  // 屏幕中心（坐标原点）：0,0 = 中心，X 向右、Y 向下；与代码生成器 ctx.center 同一套尺寸
  function panelCenter() {
    var s = screenSize();
    return { x: Math.round(s.w / 2), y: Math.round(s.h / 2) };
  }

  function beginDrag(e, mode, dir) {
    var t = edit.target;
    if (!t) return;
    var scale = state.editScale || 1;
    ensureAbsolute(t);
    var start = {
      x: e.clientX, y: e.clientY,
      left: t.offsetLeft, top: t.offsetTop,
      w: t.offsetWidth, h: t.offsetHeight
    };
    var moved = false;

    function onMove(ev) {
      var dx = (ev.clientX - start.x) / scale;
      var dy = (ev.clientY - start.y) / scale;
      if (!moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
        moved = true;
        state.__pvDragging = true;
      }
      if (!moved) return;
      if (mode === 'move') {
        t.style.left = Math.round(start.left + dx) + 'px';
        t.style.top = Math.round(start.top + dy) + 'px';
        syncHandles();
      } else {
        var MIN = 16;
        var nl = start.left, nt = start.top, nw = start.w, nh = start.h;
        if (dir.indexOf('e') >= 0) nw = start.w + dx;
        if (dir.indexOf('s') >= 0) nh = start.h + dy;
        if (dir.indexOf('w') >= 0) { nl = start.left + dx; nw = start.w - dx; }
        if (dir.indexOf('n') >= 0) { nt = start.top + dy; nh = start.h - dy; }
        if (nw < MIN) { if (dir.indexOf('w') >= 0) nl = start.left + start.w - MIN; nw = MIN; }
        if (nh < MIN) { if (dir.indexOf('n') >= 0) nt = start.top + start.h - MIN; nh = MIN; }
        t.style.left = Math.round(nl) + 'px';
        t.style.top = Math.round(nt) + 'px';
        t.style.width = Math.round(nw) + 'px';
        t.style.height = Math.round(nh) + 'px';
      }
      syncHandles();
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved && state.onPatch && t.dataset.cname) {
        var patch = {};
        var cen = panelCenter();
        // 与生成器同公式：(X,Y) 是组件中心相对屏幕中心的偏移（可为负），
        // left = 中心 + X − 宽/2；自适应宽高（无内联 width/height）时宽高按 0 参与换算
        var wl = parseFloat(t.style.width);
        var hl = parseFloat(t.style.height);
        wl = isNaN(wl) ? 0 : wl;
        hl = isNaN(hl) ? 0 : hl;
        if (mode === 'move') {
          patch.x = Math.round((parseFloat(t.style.left) || 0) - cen.x + wl / 2);
          patch.y = Math.round((parseFloat(t.style.top) || 0) - cen.y + hl / 2);
        } else {
          patch.x = Math.round((parseFloat(t.style.left) || start.left) - cen.x + wl / 2);
          patch.y = Math.round((parseFloat(t.style.top) || start.top) - cen.y + hl / 2);
          patch.w = Math.round(parseFloat(t.style.width) || start.w);
          patch.h = Math.round(parseFloat(t.style.height) || start.h);
        }
        try { state.onPatch(t.dataset.cname, patch); }
        catch (err) { log('回写积木失败：' + (err && err.message ? err.message : err), 'err'); }
      }
      setTimeout(function () { state.__pvDragging = false; }, 50);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ------------------------------------------------------------------ //
  // 数据绑定刷新
  // ------------------------------------------------------------------ //
  var refreshTimer = null;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshBindings, 40);
  }

  // 图片地址解析：/common/ 内置资源、/assets/ 用户上传资产
  function resolveAssetUrl(src) {
    if (!src) return '';
    if (src.indexOf('/common/') === 0) return '/static/img/logo.png';
    if (src.indexOf('/assets/') === 0) {
      return (state.assetBase || '') + '/' + src.slice('/assets/'.length);
    }
    return src;
  }

  function refreshBindings() {
    var page = findPage(state.current);
    if (!page || !state.screenEl) return;
    var store = state.stores[page.name] || {};

    // 动态图片（如背景图片）：数据里的路径变化后同步刷新
    state.screenEl.querySelectorAll('[data-src-bind]').forEach(function (elm) {
      var raw = interpolate(elm.dataset.srcBind, store);
      if (raw === elm._rawSrc) return;
      elm._rawSrc = raw;
      elm.src = resolveAssetUrl(raw) || '/static/img/logo.png';
    });

    state.screenEl.querySelectorAll('[data-bind]').forEach(function (elm) {
      elm.textContent = interpolate(elm.dataset.bind, store);
    });
    state.screenEl.querySelectorAll('[data-bind-val]').forEach(function (elm) {
      var v = interpolate(elm.dataset.bindVal, store);
      if (document.activeElement !== elm) elm.value = v;
    });
    state.screenEl.querySelectorAll('[data-pct-bind]').forEach(function (p) {
      var pct = parseFloat(interpolate(p.dataset.pctBind, store)) || 0;
      pct = Math.max(0, Math.min(100, pct));
      if (p.classList.contains('arc')) {
        p.style.setProperty('--pct', pct);
        var num = p.querySelector('.pv-progress-num');
        if (num) num.textContent = Math.round(pct) + '%';
      } else {
        var bar = p.querySelector('.pv-progress-bar');
        if (bar) bar.style.width = pct + '%';
      }
    });
    // 运动（transform）与显示/隐藏（show）绑定刷新
    state.screenEl.querySelectorAll('[data-style-bind]').forEach(function (elm) {
      elm.setAttribute('style', interpolate(elm.dataset.styleBind, store));
    });
    state.screenEl.querySelectorAll('[data-show-bind]').forEach(function (elm) {
      elm.style.display = truthyShow(interpolate(elm.dataset.showBind, store)) ? '' : 'none';
    });

    // 克隆体随数据变化重绘（数量、位置等）
    renderClones(state.pageEl || state.screenEl, store);
  }

  // ------------------------------------------------------------------ //
  // 特效
  // ------------------------------------------------------------------ //
  function showToast(msg, duration) {
    var old = state.screenEl.querySelector('.pv-toast');
    if (old) old.remove();
    var t = el('div', 'pv-toast', msg);
    state.screenEl.appendChild(t);
    setTimeout(function () {
      if (t.parentNode) {
        t.classList.add('bye');
        setTimeout(function () { t.remove(); }, 240);
      }
    }, Math.min(Math.max(duration || 1500, 500), 8000));
  }

  function shake(ms) {
    var f = state.root.querySelector('.pv-screen');
    if (!f) return;
    f.classList.remove('shake');
    void f.offsetWidth;
    f.classList.add('shake');
    setTimeout(function () { f.classList.remove('shake'); }, ms + 300);
  }

  function renderLog() {
    if (!state.logBoxEl) return;
    state.logBoxEl.innerHTML = '';
    state.logLines.slice(-7).forEach(function (line) {
      var row = el('div', 'pv-log ' + line.kind, line.msg);
      state.logBoxEl.appendChild(row);
    });
    state.logBoxEl.scrollTop = state.logBoxEl.scrollHeight;
  }

  // ------------------------------------------------------------------ //
  // 更新入口（编辑器每次重新生成后调用）
  // ------------------------------------------------------------------ //
  function update(pages, deviceType, assetBase, opts) {
    if (!state.root) return;
    var keepCurrent = state.current;
    var syncPage = !!(opts && opts.syncPage) ? (opts.syncPageName || null) : null;
    state.deviceType = deviceType || state.deviceType;
    if (opts && opts.designWidth) state.designWidth = opts.designWidth;
    if (assetBase) state.assetBase = assetBase;
    if (opts && typeof opts.onPatch === 'function') state.onPatch = opts.onPatch;
    pages = pages || [];
    state.pages = pages;
    state.root.className = 'pv-root pv-' + state.deviceType +
      (state.running ? ' running' : '');

    var sig = JSON.stringify(pagesSignature(pages));
    var changed = sig !== state._lastSig;

    if (changed) {
      // 结构或代码变化：重建数据与已编译方法，停止旧定时器
      clearTimers();
      state.stores = {};
      state.compiled = {};
      state.bcastHandlers = {};
      state.history = [];
    }
    state._lastSig = sig;

    // 运行模式不跟随编辑器切换；编辑模式 syncPage 时跳到指定页
    var target;
    if (!state.running && syncPage && findPage(syncPage)) {
      target = syncPage;
    } else {
      var exists = findPage(keepCurrent);
      target = exists ? keepCurrent : (state.pages[0] && state.pages[0].name);
    }
    showPage(target);
    resize();
  }

  function pagesSignature(pages) {
    // 方法体内容、data 初始值、UI 内容（含位置/大小）都要参与比对；
    // 只用 length 会漏掉同长度但内容变化（如坐标微调），导致预览不刷新
    return JSON.stringify((pages || []).map(function (p) {
      return [p.name, p.ui ? strHash(p.ui) : 0, p.methods || {}, p.data || {}, (p.styles || []).length];
    }));
  }
  function strHash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff; }
    return h;
  }

  function resize() {
    if (!state.root || !state.screenEl) return;
    var s = screenSize();
    var sw = s.w;
    var sh = s.h;
    state.screenEl.style.width = sw + 'px';
    state.screenEl.style.height = sh + 'px';
    // 可用空间：面板宽度、高度（减去日志区约 160px 与边距）
    var availW = Math.max(160, (state.root.clientWidth || 320) - 28);
    var availH = Math.max(240, (state.root.clientHeight || 520) - 80);
    var fit = Math.max(0.1, Math.min(availW / (sw + 6), availH / (sh + 6), 1));
    // 用户缩放：10% ~ 200%，100% 即原来的自适应大小
    var scale = fit * (state.zoom / 100);
    state.editScale = scale;
    if (state.stageEl) state.stageEl.style.transform = 'scale(' + scale + ')';
    if (state.stageBoxEl) {
      // 布局盒高 = 缩放后大小，保证居中不裁切、屏幕完整可见
      state.stageBoxEl.style.width = Math.round((sw + 6) * scale) + 'px';
      state.stageBoxEl.style.height = Math.round((sh + 6) * scale) + 'px';
    }
  }

  // 设置预览缩放百分比（10 ~ 200），返回实际生效的值
  function setZoom(pct) {
    var v = Number(pct);
    if (!isFinite(v)) return state.zoom;
    state.zoom = Math.max(10, Math.min(200, v));
    resize();
    return state.zoom;
  }

  function getZoom() {
    return state.zoom;
  }

  // ------------------------------------------------------------------ //
  // 运行模式：启动后纯交互（事件/定时器/跳转），禁用编辑拖拽
  // ------------------------------------------------------------------ //
  function setRunMode(on, startPage) {
    state.running = !!on;
    if (state.root) state.root.classList.toggle('running', state.running);
    clearEditSel();
    if (state.running) {
      // 全新启动：清空数据 / 已编译方法 / 定时器 / 广播，从指定页面开始
      clearTimers();
      state.stores = {};
      state.compiled = {};
      state.bcastHandlers = {};
      state.history = [];
      var target = findPage(startPage) ? startPage
                 : (state.pages[0] && state.pages[0].name);
      showPage(target || state.current);
      log('🚀 应用已启动' + (target ? '（从「' + target + '」开始）' : ''));
    } else {
      // 停止：清空定时器 / 数据 / 已编译方法，回到纯静态的编辑模式
      clearTimers();
      state.stores = {};
      state.compiled = {};
      state.bcastHandlers = {};
      state.history = [];
      log('⏹️ 已停止运行，回到编辑模式');
      if (state.current) showPage(state.current);
    }
  }

  return {
    mount: mount,
    update: update,
    resize: resize,
    setZoom: setZoom,
    getZoom: getZoom,
    setRunMode: setRunMode,
    getStore: function (pageName) {
      return state.stores[pageName || state.current] || null;
    },
    getCurrentPage: function () { return state.current; }
  };
})();
