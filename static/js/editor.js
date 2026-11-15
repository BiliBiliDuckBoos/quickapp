// Duck Box —— 编辑器交互逻辑（多页面 + 图片资产 + 动态下拉）
window.DBX_EDITOR = (function () {
  'use strict';

  var self = {
    pid: null,
    project: null,
    workspace: null,
    pages: [],          // [{ name, title, xml, sprites, backdrop }] 每页独立积木 + 角色 + 背景
    cur: 0,             // 当前编辑的页面下标
    selKind: 'backdrop',// 当前正在编辑的对象：'sprite' 角色 / 'backdrop' 背景
    barTab: 'sprite',   // 底部栏当前标签：'sprite' / 'backdrop'
    spriteSel: -1,      // 当前选中的角色下标（-1 = 未选）
    assets: [],         // [{ name, url, path, size }]
    gvars: [],          // 全局变量 / 列表 [{ name, type }]，所有页面 / 角色共享
    current: { files: {}, issues: [], pages: [] },
    dirty: false,
    panelOpen: true,
    restoring: false    // 程序化改动工作区时，暂停变更监听
  };

  // 新页面 / 新项目的初始积木（Scratch 风格，手环没有开始按钮：进入页面即执行）
  var PAGE_DEFAULT_XML =
    '<xml xmlns="https://developers.google.com/blockly/xml">' +
    '  <block type="vela_onready" x="40" y="40">' +
    '    <statement name="DO">' +
    '      <block type="sc_say">' +
    '        <value name="TEXT">' +
    '          <shadow type="text"><field name="TEXT">你好，Duck Box！</field></shadow>' +
    '        </value>' +
    '      </block>' +
    '    </statement>' +
    '  </block>' +
    '</xml>';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  function sanitizePageName(name) {
    var s = String(name || '').trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '');
    if (/^[0-9]/.test(s)) s = 'p' + s;
    return s || 'page';
  }

  // ------------------------------------------------------------------ //
  // 页面管理（页面栏）
  // ------------------------------------------------------------------ //
  // 每页有一个舞台：costumes 里每张背景都带自己的独立积木 xml。
  // bd.xml 始终镜像当前背景的积木，用于兼容旧存档 / 旧字段。
  function ensureBackdrop(pg) {
    if (!pg) {
      return { xml: '', costumes: [{ name: '背景1', image: '', xml: '' }], index: 0 };
    }
    if (!pg.backdrop || typeof pg.backdrop !== 'object') {
      pg.backdrop = { xml: typeof pg.xml === 'string' ? pg.xml : '', costumes: [], index: 0 };
    }
    var bd = pg.backdrop;
    var legacyXml = typeof bd.xml === 'string'
      ? bd.xml
      : (typeof pg.xml === 'string' ? pg.xml : '');
    if (!Array.isArray(bd.costumes)) bd.costumes = [];
    var hasAnyXml = bd.costumes.some(function (c) {
      return c && typeof c === 'object' && typeof c.xml === 'string' && c.xml;
    });
    bd.costumes = bd.costumes.map(function (c, i) {
      if (c && typeof c === 'object') {
        return {
          name: String(c.name || ('背景' + (i + 1))),
          image: String(c.image || ''),
          xml: typeof c.xml === 'string' ? c.xml : ''
        };
      }
      return { name: c ? costumeLabel(c) : ('背景' + (i + 1)), image: c || '', xml: '' };
    });
    if (!bd.costumes.length) {
      bd.costumes.push({ name: '背景1', image: '', xml: legacyXml });
    }
    var idx = Number(bd.index);
    bd.index = (idx >= 0 && idx < bd.costumes.length) ? idx : 0;
    // 旧数据只有 bd.xml：迁到当前背景，保证老项目脚本不丢
    if (legacyXml && !hasAnyXml) {
      var cur = bd.costumes[bd.index];
      if (cur && !cur.xml) cur.xml = legacyXml;
    }
    bd.xml = bd.costumes[bd.index] ? bd.costumes[bd.index].xml : '';
    return bd;
  }

  function targetXmlOf(pg, kind, index) {
    if (kind === 'backdrop') {
      var bd = ensureBackdrop(pg);
      var it = bd.costumes[bd.index];
      return (it && it.xml) || '';
    }
    var sp = (pg.sprites || [])[index];
    return (sp && sp.xml) || '';
  }

  function syncCurrentTarget() {
    if (!self.workspace || !self.pages.length) return;
    if (self.cur < 0 || self.cur >= self.pages.length) self.cur = 0;
    var pg = self.pages[self.cur];
    var xml = '';
    try {
      xml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(self.workspace));
    } catch (e) { return; }
    if (self.selKind === 'backdrop') {
      var bd = ensureBackdrop(pg);
      var it = bd.costumes[bd.index];
      if (it) it.xml = xml;
      bd.xml = xml;   // 镜像当前背景
      pg.xml = xml;   // 兼容旧字段（旧版本用 page.xml 保存脚本）
    } else {
      var sp = (pg.sprites || [])[self.spriteSel];
      if (sp) sp.xml = xml;
    }
    // 变量 / 列表全局化：把本工作区里的变量并入全局表，
    // 这样切到别的角色 / 页面也能在「变量 / 列表」下拉里选到
    try { collectGlobalsFromWorkspace(); } catch (eG) { /* ignore */ }
  }

  // 兼容旧调用：保存当前正在编辑对象（角色或背景）的积木
  function syncCurrentPage() { syncCurrentTarget(); }

  // 把某个对象（角色 / 背景）的独立积木载入工作区
  function loadTargetIntoWorkspace(kind, index, keepEmpty, keepCe) {
    var pg = self.pages[self.cur];
    if (!pg) return;
    if (ce && !keepCe) closeCostumeEditor();
    // 先刷新背景下拉选项，否则积木里的「背景换成」值会被当成非法值清空
    if (window.DBX && DBX.setBackdrops) {
      try {
        DBX.setBackdrops((ensureBackdrop(pg).costumes || []).map(function (c) { return c && c.name; }));
      } catch (eBd) { /* ignore */ }
    }
    self.restoring = true;
    try {
      self.workspace.clear();
      var xml = targetXmlOf(pg, kind, index);
      if (!xml || xml.indexOf('<block') < 0) {
        if (keepEmpty) {
          xml = '';
        } else if (kind === 'backdrop') {
          // 仅当该背景「从未被保存过积木」（xml 为 undefined/空）才注入默认积木；
          // 若用户删空后保存过（xml = 合法空 XML），保持为空，避免默认积木"复活"。
          var raw = targetXmlOf(pg, kind, index);
          var rawEmpty = (raw == null || String(raw).trim() === '')
            || String(raw).trim() === '</xml>' || String(raw).trim() === '<xml/>';
          if (rawEmpty) {
            xml = PAGE_DEFAULT_XML;
            // 只把默认积木载入当前工作区，不持久化到 costumes/bd.xml/pg.xml，
            // 由用户保存时才落盘，避免「删空保存后重开又出现默认积木」
          } else {
            xml = '';
          }
        } else {
          xml = '';
        }
      }
      if (xml) {
        // 先载入临时工作区刷新动态下拉选项（数据变量/组件/页面），
        // 否则载入时 BIND、TARGET 等下拉字段的值不在选项里会被清空
        try {
          var tmp = new Blockly.Workspace();
          Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(xml), tmp);
          DBX.updateOptions(tmp);
          tmp.dispose();
        } catch (eOpt) {
          console.warn('预载刷新下拉选项失败：', eOpt);
        }
        // 主载入 + fallback 全程防御：任何一块导致异常都不能冒泡，
        // 否则会触发 init 的 .catch 导致整页闪退回首页
        try {
          Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(xml), self.workspace);
        } catch (e1) {
          console.error('主载入积木失败：', e1);
          try {
            self.workspace.clear();
            if (kind === 'backdrop') {
              Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(PAGE_DEFAULT_XML), self.workspace);
            }
          } catch (e2) {
            console.error('默认页也载入失败：', e2);
            try { self.workspace.clear(); } catch (e3) { /* ignore */ }
          }
        }
        // 兜底：按下拉字段在 XML 里的原值强制恢复（防载入瞬间被清空）
        if (DBX.restoreDynamicFields) {
          try { DBX.restoreDynamicFields(self.workspace, xml); } catch (eR) { /* ignore */ }
        }
        try { syncFieldsFromLayout(); } catch (eS) { console.warn('回填布局失败：', eS); }
      }
      // 变量 / 列表全局通用：把这个目标缺失的全局变量补进工作区
      try { applyGlobalsToWorkspace(); } catch (eG) { /* ignore */ }
      self.workspace.scrollCenter();
    } finally {
      setTimeout(function () { self.restoring = false; }, 60);
    }
  }

  // 切页时默认落到「背景」（Scratch 里舞台是默认编辑对象）
  function loadPageIntoWorkspace(i, keepEmpty) {
    if (!self.pages[i]) return;
    self.cur = i;
    self.selKind = 'backdrop';
    self.barTab = 'backdrop';
    self.spriteSel = -1;
    loadTargetIntoWorkspace('backdrop', -1, keepEmpty);
  }

  function switchToPage(i) {
    if (i < 0 || i >= self.pages.length) return;
    // 正在运行时切页：自动退出运行模式，避免残留导致新页无法编辑
    if (running && $('btn-run') && $('btn-run').classList.contains('running')) {
      toggleRun();
    }
    if (i === self.cur && self.workspace.getAllBlocks(false).length) {
      renderPageBar();
      return;
    }
    syncCurrentPage();
    self.cur = i;
    self.spriteSel = -1;   // 角色属于页面，切页后重新选择
    loadPageIntoWorkspace(i, true);
    renderPageBar();
    refresh(true);
  }

  function addPage() {
    var base = 'page' + (self.pages.length + 1);
    var name = sanitizePageName(prompt('新页面的名字（可用中文，会作为文件名）：', base));
    if (!name) return;
    // 名字去重
    var exist = self.pages.some(function (p) { return p.name === name; });
    if (exist) { toast('已有同名页面：' + name); return; }
    syncCurrentPage();
    self.pages.push({
      name: name, title: name, xml: '', sprites: [],
      backdrop: { xml: '', costumes: [{ name: '背景1', image: '', xml: '' }], index: 0 }
    });
    self.cur = self.pages.length - 1;
    self.spriteSel = -1;
    loadPageIntoWorkspace(self.cur);
    renderPageBar();
    refresh(true);
    toast('已新建页面「' + name + '」');
  }

  function deletePage(i) {
    if (self.pages.length <= 1) { toast('至少保留一个页面'); return; }
    var pg = self.pages[i];
    if (!confirm('确定删除页面「' + pg.name + '」吗？该页所有积木都会被删除。')) return;
    self.pages.splice(i, 1);
    if (self.cur >= self.pages.length) self.cur = self.pages.length - 1;
    else if (self.cur > i) self.cur -= 1;
    else if (self.cur === i) { /* 停留原地 */ }
    loadPageIntoWorkspace(self.cur, true);
    renderPageBar();
    refresh(true);
    toast('已删除页面「' + pg.name + '」');
  }

  function renamePage(i) {
    var pg = self.pages[i];
    var name = sanitizePageName(prompt('重命名页面：', pg.name));
    if (!name || name === pg.name) return;
    var exist = self.pages.some(function (p) { return p.name === name; });
    if (exist) { toast('已有同名页面：' + name); return; }
    pg.name = name;
    pg.title = name;
    renderPageBar();
    refresh();
  }

  function renderPageBar() {
    var box = $('pagebar-tabs');
    if (!box) return;
    box.innerHTML = '';
    self.pages.forEach(function (pg, i) {
      var tab = el('div', 'pagebar-tab' + (i === self.cur ? ' active' : ''));
      tab.appendChild(el('span', 'pagebar-name', pg.name));
      var del = el('button', 'pagebar-del', '×');
      del.title = '删除此页面';
      del.setAttribute('data-del', String(i));
      tab.appendChild(del);
      tab.setAttribute('data-idx', String(i));
      tab.title = '点击切换到此页面';
      box.appendChild(tab);
    });

    box.querySelectorAll('.pagebar-tab').forEach(function (tab) {
      tab.addEventListener('click', function (e) {
        if (e.target.getAttribute && e.target.getAttribute('data-del') != null) return;
        switchToPage(Number(tab.getAttribute('data-idx')));
      });
      tab.addEventListener('dblclick', function () {
        renamePage(Number(tab.getAttribute('data-idx')));
      });
    });
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        deletePage(Number(b.getAttribute('data-del')));
      });
    });

    renderDrawer();
  }

  // 预览下方的页面抽屉：与顶部页面栏同步
  function renderDrawer() {
    var list = $('pv-drawer-list');
    if (!list) return;
    list.innerHTML = '';
    var title = $('pv-drawer-title');
    if (title) title.textContent = '页面列表（' + self.pages.length + '）';
    if (!self.pages.length) {
      list.appendChild(el('div', 'pv-drawer-empty', '还没有页面，点上面的「＋ 新建页面」创建'));
      return;
    }
    self.pages.forEach(function (pg, i) {
      var item = el('div', 'pv-drawer-item' + (i === self.cur ? ' active' : ''));
      item.setAttribute('data-idx', String(i));
      item.title = '点击切换到此页面（每页积木独立）';
      item.appendChild(el('span', 'pv-item-idx', String(i + 1)));
      item.appendChild(el('span', 'pv-item-name', pg.name));
      if (self.pages.length > 1) {
        var del = el('button', 'pv-item-del', '×');
        del.title = '删除此页面';
        del.setAttribute('data-del', String(i));
        item.appendChild(del);
      }
      list.appendChild(item);
    });
  }

  // ------------------------------------------------------------------ //
  // 旧项目迁移：单工作区里的 vela_page 积木 → 多页面
  // ------------------------------------------------------------------ //
  function migrateOldXml(xml) {
    if (!xml || !xml.trim()) return null;
    try {
      var dom = Blockly.Xml.textToDom(xml);
      var kids = Array.prototype.slice.call(dom.children || []);
      var pageBlocks = kids.filter(function (n) {
        return n.tagName === 'block' && n.getAttribute('type') === 'vela_page';
      });
      if (!pageBlocks.length) return null;
      var pages = pageBlocks.map(function (pb, idx) {
        var name = '', title = '';
        var inner = [];
        Array.prototype.slice.call(pb.children).forEach(function (c) {
          if (c.tagName === 'field') {
            var fn = c.getAttribute('name');
            if (fn === 'NAME') name = (c.textContent || '').trim();
            if (fn === 'TITLE') title = (c.textContent || '').trim();
          } else if (c.tagName === 'statement') {
            Array.prototype.slice.call(c.children).forEach(function (b) {
              inner.push(b);
            });
          }
        });
        var wrap = document.createElement('xml');
        wrap.setAttribute('xmlns', 'https://developers.google.com/blockly/xml');
        inner.forEach(function (b) { wrap.appendChild(b); });
        return {
          name: sanitizePageName(name || 'page' + (idx + 1)),
          title: title || name || 'page' + (idx + 1),
          xml: inner.length ? Blockly.Xml.domToText(wrap) : ''
        };
      });
      return pages.length ? pages : null;
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------ //
  // 生成 / 渲染
  // ------------------------------------------------------------------ //
  function gather() {
    syncCurrentPage();
    if (!self.pages.length) {
      return { pages: self.pages, result: { files: {}, issues: [], pages: [] } };
    }
    var meta = {
      package: ($('pkg-display').value || '').trim() ||
               (self.project && self.project.package) || 'com.duckbox.demo',
      appName: (self.project && self.project.appName) || 'DuckBox',
      deviceType: (self.project && self.project.deviceType) || 'band10',
      designWidth: (self.project && self.project.designWidth) || 0,
      globalVars: self.gvars || []
    };
    var pageInputs = self.pages.map(function (p) {
      var bd = ensureBackdrop(p);
      return {
        name: p.name, title: p.title,
        xml: (bd.xml && bd.xml.trim()) ? bd.xml : (p.xml || ''),
        backdrop: bd,
        sprites: p.sprites || []
      };
    });
    var result = DBX.generateProject(pageInputs, meta);
    self.current = result;
    return { pages: pageInputs, result: result };
  }

  function renderCode(files) {
    var box = $('codeView');
    if (!box) return;
    var order = ['src/manifest.json', 'src/app.ux', 'src/common/style.css', 'src/i18n/defaults.json'];
    var keys = Object.keys(files);
    keys.forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });

    var text = order.map(function (k) {
      if (!(k in files)) return '';
      return '// ══════════════ ' + k + ' ══════════════\n' + files[k];
    }).join('\n');
    box.textContent = text;
  }

  function renderIssues(issues) {
    var box = $('issueView');
    if (!box) return;
    box.innerHTML = '';
    var badgeText = { error: '✕', warning: '!', ok: '✓' };
    var errCount = 0;
    (issues || []).forEach(function (it) {
      if (it.sev === 'error') errCount++;
      var d = el('div', 'issue ' + it.sev);
      d.appendChild(el('span', 'badge', badgeText[it.sev] || '!'));
      d.appendChild(el('span', '', it.msg));
      box.appendChild(d);
    });
    var badge = $('issue-count');
    if (errCount > 0) {
      badge.textContent = String(errCount);
      badge.style.display = 'inline-block';
      // 徽标数字变化时小弹跳一下
      badge.classList.remove('show-pop');
      void badge.offsetWidth;
      badge.classList.add('show-pop');
    } else {
      badge.style.display = 'none';
      badge.classList.remove('show-pop');
    }
  }

  function assetBase() {
    return self.pid ? ('/api/projects/' + encodeURIComponent(self.pid) + '/assets') : '';
  }

  // ------------------------------------------------------------------ //
  // 预览旁的数据监视框：变量 / 列表实时值
  // ------------------------------------------------------------------ //
  function dataKey(name) {
    return (window.DBX && DBX.safeVarName) ? DBX.safeVarName(name) : String(name || '');
  }
  function dataValue(name) {
    if (!window.DBX_PREVIEW || !DBX_PREVIEW.getStore) return undefined;
    var cp = self.pages[self.cur];
    var pageName = (DBX_PREVIEW.getCurrentPage && DBX_PREVIEW.getCurrentPage()) ||
                   (cp ? cp.name : '');
    var store = DBX_PREVIEW.getStore(pageName);
    if (!store) return undefined;
    return store[dataKey(name)];
  }
  function formatScalar(v) {
    if (v === undefined) return '—';
    if (v === null) return '空';
    if (v === true) return '真';
    if (v === false) return '假';
    if (typeof v === 'number') return (Math.round(v * 1000) / 1000) + '';
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch (e) { return String(v); }
    }
    return String(v);
  }

  // ---------------- 全局变量 / 列表 ----------------
  // 目标：所有页面 / 角色 / 背景共享同一份变量与列表。
  // 做法：编辑器维护 self.gvars 作为权威清单；载入任何目标时把缺失的变量补进工作区，
  // 保存目标时把工作区里的变量并回清单。
  function globalsSeenMap() {
    var seen = {};
    (self.gvars || []).forEach(function (g) { seen[g.name + '|' + (g.type || '')] = true; });
    return seen;
  }
  function collectGlobalsFromWorkspace() {
    var ws = self.workspace;
    if (!ws || !ws.getAllVariables) return;
    var seen = globalsSeenMap();
    (ws.getAllVariables() || []).forEach(function (v) {
      var key = v.name + '|' + (v.type || '');
      if (seen[key]) return;
      seen[key] = true;
      self.gvars.push({ name: v.name, type: v.type || '' });
    });
  }
  // 从所有页面 / 所有目标的 XML 里收集变量声明，作为全局清单的种子（打开旧项目时用）
  function collectGlobalsFromPages() {
    var seen = globalsSeenMap();
    self.pages.forEach(function (p) {
      var bd = ensureBackdrop(p);
      var xmls = [];
      (bd.costumes || []).forEach(function (c) { if (c && c.xml) xmls.push(c.xml); });
      (p.sprites || []).forEach(function (s) { if (s && s.xml) xmls.push(s.xml); });
      xmls.forEach(function (xml) {
        try {
          var dom = Blockly.Xml.textToDom(xml);
          var vs = dom.getElementsByTagName('variable');
          for (var i = 0; i < vs.length; i++) {
            var nm = (vs[i].textContent || '').trim();
            var ty = vs[i].getAttribute('type') || '';
            var key = nm + '|' + ty;
            if (nm && !seen[key]) { seen[key] = true; self.gvars.push({ name: nm, type: ty }); }
          }
        } catch (e) { /* ignore */ }
      });
    });
  }
  // 把全局清单里缺失的变量补进当前工作区（不覆盖已有同名变量，避免 id 冲突）
  function applyGlobalsToWorkspace() {
    var ws = self.workspace;
    if (!ws) return;
    (self.gvars || []).forEach(function (g) {
      try {
        if (!ws.getVariable(g.name, g.type || '')) {
          ws.createVariable(g.name, g.type || '');
        }
      } catch (e) { /* ignore */ }
    });
  }
  function refreshToolboxForGlobals() {
    try {
      if (self.workspace && self.workspace.refreshToolboxSelection) {
        self.workspace.refreshToolboxSelection();
      }
    } catch (e) { /* ignore */ }
  }
  // 删除一个全局变量 / 列表：从所有页面 / 目标的 XML 里移除，并同步当前工作区与全局清单
  function deleteGlobalVar(name, type) {
    var t = type || '';
    self.pages.forEach(function (p) {
      var bd = ensureBackdrop(p);
      function fix(xml) {
        if (!xml || xml.indexOf('<variable') < 0) return xml;
        var tmp = new Blockly.Workspace();
        try {
          Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(xml), tmp);
          var v = tmp.getVariable(name, t);
          if (v) tmp.deleteVariableById(v.getId());
          var out = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(tmp));
          tmp.dispose();
          return out;
        } catch (e) { try { tmp.dispose(); } catch (e2) { /* ignore */ } return xml; }
      }
      (bd.costumes || []).forEach(function (c) { if (c && c.xml) c.xml = fix(c.xml); });
      (p.sprites || []).forEach(function (s) { if (s && s.xml) s.xml = fix(s.xml); });
    });
    var v = self.workspace && self.workspace.getVariable(name, t);
    if (v) { try { self.workspace.deleteVariableById(v.getId()); } catch (e) { /* ignore */ } }
    self.gvars = (self.gvars || []).filter(function (g) {
      return !(g.name === name && (g.type || '') === t);
    });
    self.dirty = true;
    refreshToolboxForGlobals();
    try { refresh(); } catch (e) { /* ignore */ }
  }

  function renderDataPanel() {
    var box = $('pv-data-body');
    if (!box) return;
    box.innerHTML = '';
    collectGlobalsFromWorkspace();

    // 列表的 type 必须是 'list'；其它（含空 type）都当普通变量
    var values = (self.gvars || []).filter(function (g) { return (g.type || '') !== 'list'; });
    var lists = (self.gvars || []).filter(function (g) { return (g.type || '') === 'list'; });

    if (!values.length && !lists.length) {
      box.appendChild(el('div', 'pv-data-empty', '还没有变量或列表\n在左侧「变量 / 列表」分类里建立'));
      return;
    }

    function group(title, arr, isList) {
      var g = el('div', 'pv-data-group');
      g.appendChild(el('div', 'pv-data-group-title', title + '（' + arr.length + '）'));
      if (!arr.length) {
        g.appendChild(el('div', 'pv-data-empty', '—'));
        return g;
      }
      arr.forEach(function (v) {
        var row = el('div', 'pv-data-row');
        var head = el('div', 'pv-data-row-head');
        head.appendChild(el('div', 'pv-data-name', v.name));
        var del = el('button', 'pv-data-del', '×');
        del.type = 'button';
        del.title = '删除这个' + (isList ? '列表' : '变量');
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          var label = (isList ? '列表「' : '变量「') + v.name + '」';
          if (!window.confirm('确定删除' + label + '吗？\n所有页面 / 角色里引用它的积木都会一并移除。')) return;
          deleteGlobalVar(v.name, v.type || '');
        });
        head.appendChild(del);
        row.appendChild(head);
        var val = dataValue(v.name);
        var valBox = el('div', 'pv-data-val' + (isList ? ' is-list' : ''));
        if (isList) {
          if (!Array.isArray(val) || !val.length) {
            valBox.textContent = Array.isArray(val) ? '(空列表)' : '—';
          } else {
            val.forEach(function (item, idx) {
              var chip = el('span', 'pv-data-item');
              chip.appendChild(el('i', 'pv-data-idx', String(idx + 1)));
              chip.appendChild(el('span', 'pv-data-item-text', formatScalar(item)));
              valBox.appendChild(chip);
            });
          }
        } else {
          valBox.textContent = formatScalar(val);
        }
        row.appendChild(valBox);
        g.appendChild(row);
      });
      return g;
    }

    box.appendChild(group('变量', values, false));
    box.appendChild(group('列表', lists, true));
  }

  function refresh(syncPage) {
    if (!self.workspace) return;
    // 角色顺序即层级：生成代码前先按当前顺序重排 layer
    var cpL = self.pages[self.cur];
    if (cpL) assignSpriteLayers(cpL.sprites);
    // 先把最新的页面 / 贴图 / 角色喂给下拉选项，再生成代码：
    // 否则新页面里的「角色」下拉会因选项里还没有该角色而被清空
    DBX.setPages(self.pages.map(function (p) { return p.name; }));
    DBX.setImages(self.assets);
    var cp = self.pages[self.cur];
    DBX.setSprites(cp ? (cp.sprites || []).map(function (s) { return s.name; }) : []);
    if (DBX.setBackdrops) {
      DBX.setBackdrops(cp ? (ensureBackdrop(cp).costumes || []).map(function (c) { return c && c.name; }) : []);
    }
    var g = gather();
    renderCode(g.result.files);
    renderIssues(g.result.issues);
    if (window.DBX_PREVIEW && $('pv-root')) {
      DBX_PREVIEW.update(g.result.pages,
        (self.project && self.project.deviceType) || 'band10',
        assetBase(),
        {
          designWidth: (self.project && self.project.designWidth) || 0,
          onPatch: onPreviewPatch,
          syncPage: !!syncPage,
          syncPageName: self.pages[self.cur] && self.pages[self.cur].name
        });
    }
    // 刷新动态下拉（数据 / 组件 / 页面 / 图片 / 角色）
    // 生成过程会按页面切换角色选项，这里恢复成「当前编辑页」的角色
    var cpNow = self.pages[self.cur];
    DBX.setSprites(cpNow ? (cpNow.sprites || []).map(function (s) { return s.name; }) : []);
    if (DBX.setBackdrops) {
      DBX.setBackdrops(cpNow ? (ensureBackdrop(cpNow).costumes || []).map(function (c) { return c && c.name; }) : []);
    }
    self.restoring = true;
    try { DBX.updateOptions(self.workspace); } catch (e) { /* ignore */ }
    setTimeout(function () { self.restoring = false; }, 60);
    try { renderSpriteBar(); } catch (eS) { console.warn('角色栏刷新失败：', eS); }
    try { renderDataPanel(); } catch (eD) { console.warn('数据面板刷新失败：', eD); }

    self.dirty = true;
    scheduleAutosave();
  }

  // 预览里拖动/缩放组件 → 回写组件积木的布局（位置 X/Y、宽高），
  // 存到积木的 `data` 属性（不出现在积木界面），随后的 refresh 重新生成代码与预览
  function layoutFieldName(b, k) {
    if (b.type === 'vela_image') return { x: 'X', y: 'Y', w: 'WIDTH', h: 'HEIGHT' }[k];
    return { x: 'X', y: 'Y', w: 'W', h: 'H' }[k];
  }
  // 预览里拖拽/缩放后，把布局实时写回积木字段（这样导出代码能看到，用户也能手改）
  function writeLayoutFields(b, layout) {
    ['x', 'y', 'w', 'h'].forEach(function (k) {
      var fn = layoutFieldName(b, k);
      var f = fn && b.getField(fn);
      if (!f) return;
      var val = (k === 'x' || k === 'y') ? Math.round(layout[k])
               : Math.max(0, Math.round(layout[k]));
      try { f.setValue(val); } catch (e) { /* ignore */ }
    });
  }
  // 页面载入后：把 block.data 里的真实布局回填到积木字段（旧项目字段默认是 0）
  function syncFieldsFromLayout() {
    if (!self.workspace || !window.DBX || !DBX.getLayout) return;
    self.workspace.getAllBlocks(false).forEach(function (b) {
      if (['vela_text', 'vela_image', 'vela_button', 'vela_button_param',
           'vela_progress', 'vela_switch', 'vela_slider', 'vela_div'].indexOf(b.type) < 0) return;
      var L = DBX.getLayout(b);
      if (L) writeLayoutFields(b, L);
    });
  }
  function onPreviewPatch(name, patch) {
    if (!self.workspace || !name) return;
    // 角色不是积木，拖动结果回写到当前页的 sprites 元数据
    var cp = self.pages[self.cur];
    var sprites = (cp && cp.sprites) || [];
    for (var s = 0; s < sprites.length; s++) {
      if (String(sprites[s].name || '').trim() !== name) continue;
      var sp = sprites[s];
      if ('x' in patch) sp.x = Math.round(+patch.x) || 0;
      if ('y' in patch) sp.y = Math.round(+patch.y) || 0;
      if ('w' in patch) sp.w = Math.max(1, Math.round(+patch.w));
      if ('h' in patch) sp.h = Math.max(1, Math.round(+patch.h));
      // 文本角色：预览里缩放时，字号跟着框高变化
      if (sp.text != null && ('w' in patch || 'h' in patch)) {
        sp.size = Math.max(8, Math.round(Math.min(sp.w, sp.h) * 0.55));
      }
      self.dirty = true;
      refresh();
      return;
    }
    var blocks = self.workspace.getAllBlocks(false);
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (['vela_text', 'vela_image', 'vela_button', 'vela_button_param',
           'vela_progress', 'vela_switch', 'vela_slider', 'vela_div'].indexOf(b.type) < 0) continue;
      if ((b.getFieldValue('NAME') || '').trim() !== name) continue;
      var changed = false;
      var layout = null;
      if (window.DBX && DBX.setLayout && ('x' in patch || 'y' in patch || 'w' in patch || 'h' in patch)) {
        layout = (DBX.getLayout ? DBX.getLayout(b) : null) || { x: 0, y: 0, w: 0, h: 0 };
        if ('x' in patch && Math.round(+patch.x) !== Math.round(layout.x)) { layout.x = Math.round(+patch.x); changed = true; }
        if ('y' in patch && Math.round(+patch.y) !== Math.round(layout.y)) { layout.y = Math.round(+patch.y); changed = true; }
        if ('w' in patch && Math.round(+patch.w) !== Math.round(layout.w)) { layout.w = Math.max(1, Math.round(+patch.w)); changed = true; }
        if ('h' in patch && Math.round(+patch.h) !== Math.round(layout.h)) { layout.h = Math.max(1, Math.round(+patch.h)); changed = true; }
        if (changed) {
          DBX.setLayout(b, layout);
          writeLayoutFields(b, layout);
        }
      }
      // 兼容旧的按字号缩放（文本 / 按钮字号积木）
      if ('size' in patch && (b.type === 'vela_text' || b.type === 'vela_button')) {
        b.setFieldValue(Math.max(8, patch.size), b.type === 'vela_text' ? 'SIZE' : 'FS');
        changed = true;
      }
      if (changed) {
        self.dirty = true;
        refresh();
      }
      return;
    }
    toast('没找到组件「' + name + '」对应的积木');
  }

  // ------------------------------------------------------------------ //
  // 启动 / 停止应用：启动后预览进入纯交互模式（禁用编辑拖拽），
  // 默认从当前正在编辑的页面开始运行
  // ------------------------------------------------------------------ //
  var running = false;
  function toggleRun() {
    running = !running;
    var btn = $('btn-run');
    if (running) {
      refresh();   // 确保最新积木已编译进预览
      var startName = self.pages[self.cur] && self.pages[self.cur].name;
      DBX_PREVIEW.setRunMode(true, startName);
      btn.textContent = '⏹ 停止';
      btn.classList.add('running');
      toast('应用已启动' + (startName ? '，从「' + startName + '」开始' : '') + '，自由试试吧');
    } else {
      DBX_PREVIEW.setRunMode(false);
      btn.textContent = '▶ 启动';
      btn.classList.remove('running');
      toast('已停止，回到编辑模式');
    }
  }

  // ------------------------------------------------------------------ //
  // 保存 / 导出
  // ------------------------------------------------------------------ //
  function save(silent, cb) {
    if (!self.workspace) { if (!silent) toast('编辑器尚未就绪'); if (cb) cb(false); return; }
    var g = gather();
    var payload = {
      xml: self.pages[self.cur] ? ensureBackdrop(self.pages[self.cur]).xml : '',
      pages: self.pages.map(function (p) {
        return {
          name: p.name, title: p.title, xml: p.xml,
          backdrop: ensureBackdrop(p),
          sprites: p.sprites || []
        };
      }),
      files: g.result.files,
      preview: previewText(g.result),
      globalVars: self.gvars || [],
      package: ($('pkg-display').value || '').trim(),
      // 应用名由「应用信息」弹窗修改，gather() 会把它写进 manifest.name
      appName: (self.project && self.project.appName) || 'DuckBox',
      deviceType: (self.project && self.project.deviceType) || 'band10',
      designWidth: (self.project && self.project.designWidth) || 0
    };
    // keepalive：页面关闭瞬间发出的请求也能送达，避免积木丢失
    fetch('/api/projects/' + encodeURIComponent(self.pid), {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok && data.meta) self.project = data.meta;
        self.dirty = false;
        if (!silent) toast('已保存');
        if (cb) cb(true);
      })
      .catch(function () {
        if (!silent) toast('保存失败');
        if (cb) cb(false);
      });
  }

  var autosaveTimer = null;
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      if (self.dirty) save(true);
    }, 8000);
  }

  function previewText(result) {
    var names = (result.pages || []).map(function (p) { return p.name; });
    return '页面：' + (names.join('、') || '无');
  }

  function exportProject() {
    save(true, function () {
      var g = gather();
      fetch('/api/projects/' + encodeURIComponent(self.pid) + '/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: g.result.files })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok) {
            toast('导出成功，正在下载 src.zip…');
            window.open(data.download, '_blank');
          } else {
            toast(data.error || '导出失败');
          }
        })
        .catch(function () { toast('导出失败'); });
    });
  }

  // 构建 RPK：POST 启动后台构建任务，随后轮询 build-status 获取结果（避免长连接被断链导致“网络错误”）
  function buildProject() {
    var btn = $('btn-build');
    // 「加密构建」开关在设置弹窗里，默认关闭；开启后走官方 jsc 编译
    var jsc = !!(window.DBX_SETTINGS && window.DBX_SETTINGS.jscEnabled &&
                 window.DBX_SETTINGS.jscEnabled());
    save(true, function () {
      var g = gather();
      if (btn) { btn.disabled = true; btn.textContent = '构建中…'; }
      toast(jsc ? '正在构建 RPK（JSC 加密），请稍候…'
                : '正在构建 RPK，请稍候（首次可能较慢）…');
      var restoreBtn = function () {
        if (btn) { btn.disabled = false; btn.textContent = '构建'; }
      };
      fetch('/api/projects/' + encodeURIComponent(self.pid) + '/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: g.result.files, jsc: jsc })
      })
        .then(function (r) { return r.json(); })
        .then(function (start) {
          if (!start.ok) {
            toast('构建失败：' + (start.error || '构建任务启动失败'));
            restoreBtn();
            return;
          }
          pollBuildStatus(0);
        })
        .catch(function (e) {
          toast('构建失败：' + (e && e.message ? e.message : '网络错误'));
          console.error('[build] 启动失败：', e);
          restoreBtn();
        });

      function pollBuildStatus(attempt) {
        attempt += 1;
        // 轮询间隔：前几次 1.5s，之后 2s，最多 300 次（约 9~10 分钟，覆盖首次装工具链的长耗时）
        fetch('/api/projects/' + encodeURIComponent(self.pid) + '/build-status')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.status === 'done') {
              if (data.ok) {
                toast('构建成功（' + Math.max(1, Math.round((data.size || 0) / 1024)) +
                      ' KB' + (data.jsc ? ' · JSC 加密' : '') + '），正在下载 rpk…');
                window.open(data.download, '_blank');
              } else {
                var detail = String(data.error || '未知错误');
                var lines = detail.split('\n').filter(function (l) { return l && l.trim(); });
                var errMsg = lines.length ? lines[0].slice(0, 200) : '未知错误';
                var logTail = (data.logs || []).slice(-4).join(' | ');
                toast('构建失败：' + errMsg + (logTail ? '\n' + logTail : ''));
                console.error('[build] 完整错误：\n' + detail +
                              '\n--- 日志 ---\n' + (data.logs || []).join('\n'));
              }
              restoreBtn();
            } else if (data.status === 'running') {
              var delay = attempt <= 3 ? 1500 : 2000;
              setTimeout(function () { pollBuildStatus(attempt); }, delay);
            } else {
              // 状态异常（无任务或 idle），视为失败
              toast('构建失败：未找到构建任务，请重试');
              restoreBtn();
            }
          })
          .catch(function () {
            // 单次轮询失败不立即报错，300 次内重试
            if (attempt < 300) {
              setTimeout(function () { pollBuildStatus(attempt); }, 3000);
            } else {
              toast('构建失败：网络错误（轮询超时）');
              restoreBtn();
            }
          });
      }
    });
  }

  // 导出整个项目数据（积木、位置、代码、图片打包成一个文件）
  function exportProjectData() {
    save(true, function (ok) {
      if (!ok) { toast('保存失败，无法导出'); return; }
      toast('正在打包项目数据…');
      window.open('/api/projects/' + encodeURIComponent(self.pid) + '/export-data', '_blank');
    });
  }

  // ------------------------------------------------------------------ //
  // 图片资产管理
  // ------------------------------------------------------------------ //
  function loadAssets(cb) {
    fetch('/api/projects/' + encodeURIComponent(self.pid) + '/assets')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        self.assets = (data.info && data.info.assets) || data.assets || [];
        renderSpriteBar();
        if (cb) cb();
      })
      .catch(function () { /* 静默 */ });
  }

  function uploadTemplateAssets(assets, done) {
    if (!assets || !assets.length) { if (done) done(); return; }
    var fd = new FormData();
    assets.forEach(function (a) {
      try {
        var bin = atob(a.data);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        fd.append('file', new Blob([bytes], { type: 'image/png' }), a.name);
      } catch (e) { /* 跳过损坏的资产 */ }
    });
    fetch('/api/projects/' + encodeURIComponent(self.pid) + '/assets', {
      method: 'POST',
      body: fd
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          (data.assets || []).forEach(function (a) {
            if (!self.assets.some(function (x) { return x.name === a.name; })) self.assets.push(a);
          });
          renderSpriteBar();
          if (window.DBX && DBX.setImages) {
            DBX.setImages(self.assets);
            try { DBX.updateOptions(self.workspace); } catch (e) { /* ignore */ }
          }
        }
        if (done) done();
      })
      .catch(function () { if (done) done(); });
  }

  // ------------------------------------------------------------------ //
  // 角色栏（预览屏幕下方）+ 造型编辑器
  // 角色属于「页面元数据」：不进积木，但生成时自动变成可被积木控制的 <image>。
  // ------------------------------------------------------------------ //
  function currentSprites() {
    var pg = self.pages[self.cur];
    if (!pg) return null;
    if (!Array.isArray(pg.sprites)) pg.sprites = [];
    return pg.sprites;
  }

  var BUILTIN_COSTUME = '/common/logo.png';

  function newSprite() {
    var sprites = currentSprites();
    if (!sprites) { toast('还没有页面，先新建页面'); return; }
    var base = '角色' + (sprites.length + 1);
    var name = (prompt('新角色的名字（可用中文）：', base) || '').trim();
    if (!name) return;
    if (sprites.some(function (s) { return s.name === name; })) {
      toast('已有同名角色：' + name);
      return;
    }
    // 先保存当前对象的积木，再新建角色
    syncCurrentTarget();
    sprites.push({
      name: name,
      costumes: [BUILTIN_COSTUME],
      costume: BUILTIN_COSTUME,
      x: 0, y: 0, w: 64, h: 64,
      visible: true,
      layer: 1,
      xml: ''              // 每个角色有自己独立的积木
    });
    self.barTab = 'sprite';
    self.selKind = 'sprite';
    self.spriteSel = sprites.length - 1;
    self.dirty = true;
    loadTargetIntoWorkspace('sprite', self.spriteSel, true);
    renderSpriteBar();
    refresh(true);
    toast('已新建角色「' + name + '」，右键角色可重命名或编辑造型');
  }

  // 新建「文本角色」：内容以纯文字写进代码（不生成图片），名字取文字前 3 个字
  function newTextSprite() {
    var sprites = currentSprites();
    if (!sprites) { toast('还没有页面，先新建页面'); return; }
    var text = prompt('要显示的文字：', '文本');
    if (text == null) return;
    text = String(text).replace(/\s+$/, '');
    if (!text) { toast('文字不能为空'); return; }
    var base = text.slice(0, 3) || '文本';
    var name = base, n = 2;
    while (sprites.some(function (s) { return s.name === name; })) {
      name = base + n;
      n++;
    }
    syncCurrentTarget();
    sprites.push({
      name: name,
      kind: 'text',
      text: text,
      x: 0, y: 0, w: 160, h: 44,
      size: 24,
      color: '#333333',
      visible: true,
      layer: 1,
      xml: ''
    });
    self.barTab = 'sprite';
    self.selKind = 'sprite';
    self.spriteSel = sprites.length - 1;
    self.dirty = true;
    loadTargetIntoWorkspace('sprite', self.spriteSel, true);
    renderSpriteBar();
    refresh(true);
    toast('已添加文本角色「' + name + '」，右键可编辑文本');
  }

  // 角色改名：同步更新引用它的积木下拉值，避免旧名字失效
  function renameSpriteRefs(oldName, newName) {
    if (oldName === newName) return;
    // 1) 当前工作区里已载入的积木
    if (self.workspace) {
      var types = ['vela_on_sprite_click', 'vela_sprite_costume', 'vela_sprite_nextcostume',
                   'vela_show', 'vela_hide', 'vela_motion_move', 'vela_motion_rotate', 'vela_motion_goto'];
      self.restoring = true;
      try {
        self.workspace.getAllBlocks(false).forEach(function (b) {
          if (types.indexOf(b.type) < 0) return;
          var f = b.getField('TARGET');
          if (!f) return;
          if ((f.getValue() || '').trim() !== oldName) return;
          try { f.setValue(newName); } catch (e) { /* ignore */ }
        });
      } finally {
        setTimeout(function () { self.restoring = false; }, 60);
      }
    }
    // 2) 其他角色 / 背景里保存的积木 XML（未载入工作区）
    var pg = self.pages[self.cur];
    if (!pg) return;
    var fixXml = function (xml) {
      return String(xml || '').replace(/(<field name="TARGET">)([^<]*)(<\/field>)/g,
        function (m, a, b, c) { return b.trim() === oldName ? a + newName + c : m; });
    };
    (pg.sprites || []).forEach(function (sp) { if (sp.xml) sp.xml = fixXml(sp.xml); });
    var bd = ensureBackdrop(pg);
    bd.costumes.forEach(function (c) { if (c.xml) c.xml = fixXml(c.xml); });
    if (bd.xml) bd.xml = fixXml(bd.xml);
    if (pg.xml) pg.xml = fixXml(pg.xml);
  }

  function deleteSprite(i) {
    var sprites = currentSprites();
    if (!sprites || !sprites[i]) return;
    if (!confirm('确定删除角色「' + sprites[i].name + '」吗？引用它的积木会失效。')) return;
    if (ce && ce.kind === 'sprite' && ce.index === i) closeCostumeEditor();
    sprites.splice(i, 1);
    if (self.selKind === 'sprite') {
      if (self.spriteSel >= sprites.length) self.spriteSel = sprites.length - 1;
      if (self.spriteSel < 0) {
        self.selKind = 'backdrop';
        self.spriteSel = -1;
        loadTargetIntoWorkspace('backdrop', -1, true);
      } else {
        loadTargetIntoWorkspace('sprite', self.spriteSel, true);
      }
    }
    self.dirty = true;
    renderSpriteBar();
    refresh(true);
  }

  // 选中角色：保存上一个对象的积木，再载入这个角色自己的积木
  function selectSprite(i) {
    var sprites = currentSprites();
    if (!sprites || !sprites[i]) return;
    if (self.selKind === 'sprite' && self.spriteSel === i) { renderSpriteBar(); return; }
    syncCurrentTarget();
    self.barTab = 'sprite';
    self.selKind = 'sprite';
    self.spriteSel = i;
    loadTargetIntoWorkspace('sprite', i, true);
    renderSpriteBar();
    refresh(true);
  }

  // ---------------- 背景（舞台）相关 ----------------
  function currentBackdrop() {
    var pg = self.pages[self.cur];
    return pg ? ensureBackdrop(pg) : null;
  }

  function selectBackdrop(idx) {
    var pg = self.pages[self.cur];
    if (!pg) return;
    var bd = ensureBackdrop(pg);
    if (idx < 0 || idx >= bd.costumes.length) idx = bd.index;
    if (self.selKind === 'backdrop' && bd.index === idx) { renderSpriteBar(); return; }
    syncCurrentTarget();
    bd.index = idx;
    self.barTab = 'backdrop';
    self.selKind = 'backdrop';
    self.spriteSel = -1;
    loadTargetIntoWorkspace('backdrop', -1, true);
    self.dirty = true;
    renderSpriteBar();
    refresh(true);
  }

  // 底部栏「角色 / 背景」标签切换：切过去后直接载入对应对象的独立积木
  function switchBarTab(kind) {
    if (kind !== 'backdrop') kind = 'sprite';
    if (self.barTab === kind && self.selKind === kind) { renderSpriteBar(); return; }
    syncCurrentTarget();
    self.barTab = kind;
    if (kind === 'backdrop') {
      self.selKind = 'backdrop';
      self.spriteSel = -1;
      loadTargetIntoWorkspace('backdrop', -1, true);
    } else {
      var sprites = currentSprites() || [];
      self.selKind = 'sprite';
      self.spriteSel = sprites.length ? Math.min(self.spriteSel < 0 ? 0 : self.spriteSel,
                                                 sprites.length - 1) : -1;
      loadTargetIntoWorkspace('sprite', self.spriteSel, true);
      if (self.spriteSel < 0) toast('还没有角色，点「＋」新建一个');
    }
    self.dirty = true;
    renderSpriteBar();
    refresh(true);
  }

  function newBackdrop() {
    var pg = self.pages[self.cur];
    if (!pg) { toast('还没有页面，先新建页面'); return; }
    var bd = ensureBackdrop(pg);
    var base = '背景' + (bd.costumes.length + 1);
    var name = (prompt('新背景的名字（可用中文）：', base) || '').trim();
    if (!name) return;
    if (bd.costumes.some(function (c) { return c.name === name; })) {
      toast('已有同名背景：' + name);
      return;
    }
    // 先保存当前背景的积木（此时 bd.index 还指向旧背景）
    syncCurrentTarget();
    bd.costumes.push({ name: name, image: '', xml: '' });
    bd.index = bd.costumes.length - 1;
    self.barTab = 'backdrop';
    self.selKind = 'backdrop';
    self.spriteSel = -1;
    loadTargetIntoWorkspace('backdrop', -1, true);
    self.dirty = true;
    renderSpriteBar();
    refresh(true);
    openBackdropCostumeEditor(bd.index);
    toast('已新建背景「' + name + '」，用画笔或上传图片设置背景');
  }

  function renameBackdrop(idx) {
    var bd = currentBackdrop();
    var it = bd && bd.costumes[idx];
    if (!it) return;
    var name = (prompt('背景名字：', it.name) || '').trim();
    if (!name || name === it.name) return;
    if (bd.costumes.some(function (c, i) { return i !== idx && c.name === name; })) {
      toast('已有同名背景：' + name);
      return;
    }
    var old = it.name;
    it.name = name;
    renameBackdropRefs(old, name);
    self.dirty = true;
    renderSpriteBar();
    refresh(true);
    toast('背景已重命名为「' + name + '」');
  }

  // 背景改名后同步「背景换成」积木里的下拉值
  function renameBackdropRefs(oldName, newName) {
    if (oldName === newName) return;
    if (self.workspace) {
      self.restoring = true;
      try {
        self.workspace.getAllBlocks(false).forEach(function (b) {
          if (b.type !== 'sc_backdrop') return;
          var f = b.getField('BACKDROP');
          if (!f) return;
          if ((f.getValue() || '').trim() !== oldName) return;
          try { f.setValue(newName); } catch (e) { /* ignore */ }
        });
      } finally {
        setTimeout(function () { self.restoring = false; }, 60);
      }
    }
    var pg = self.pages[self.cur];
    if (!pg) return;
    var fixXml = function (xml) {
      return String(xml || '').replace(/(<field name="BACKDROP">)([^<]*)(<\/field>)/g,
        function (m, a, b, c) { return b.trim() === oldName ? a + newName + c : m; });
    };
    (pg.sprites || []).forEach(function (sp) { if (sp.xml) sp.xml = fixXml(sp.xml); });
    var bd = ensureBackdrop(pg);
    bd.costumes.forEach(function (c) { if (c.xml) c.xml = fixXml(c.xml); });
    if (bd.xml) bd.xml = fixXml(bd.xml);
    if (pg.xml) pg.xml = fixXml(pg.xml);
  }

  function deleteBackdrop(idx) {
    var bd = currentBackdrop();
    if (!bd || !bd.costumes[idx]) return;
    if (bd.costumes.length <= 1) { toast('至少保留一个背景'); return; }
    if (!confirm('确定删除背景「' + bd.costumes[idx].name + '」吗？')) return;
    if (ce && ce.kind === 'backdrop' && ce.index === idx) closeCostumeEditor();
    bd.costumes.splice(idx, 1);
    if (bd.index >= bd.costumes.length) bd.index = bd.costumes.length - 1;
    else if (bd.index > idx) bd.index -= 1;
    if (self.selKind === 'backdrop') loadTargetIntoWorkspace('backdrop', -1, true);
    self.dirty = true;
    renderSpriteBar();
    refresh(true);
  }

  function findAsset(name) {
    for (var i = 0; i < self.assets.length; i++) {
      if (self.assets[i].name === name) return self.assets[i];
    }
    return null;
  }

  // 造型名 → 可显示的图片地址（内置小鸭映射到编辑器里的 logo）
  function costumeUrl(c) {
    if (c == null || c === '' || typeof c !== 'string') return '';
    if (c.charAt(0) === '/') {
      return c === BUILTIN_COSTUME ? '/static/img/logo.png' : c;
    }
    var a = findAsset(c);
    return a ? a.url : '';
  }

  // 取角色当前造型名：数字视为 costumes 下标；空串表示「空白造型」（编辑中，不回退）；
  // 仅当未设置（null/undefined）时才回退到第一个造型。
  function pickCostume(costume, costumes) {
    var list = Array.isArray(costumes) ? costumes : [];
    if (typeof costume === 'number') return list[costume] || list[0] || '';
    if (costume == null) return list[0] || '';
    return costume;
  }

  function costumeLabel(c) {
    if (!c) return '默认造型';
    if (c === BUILTIN_COSTUME) return '内置小鸭';
    var a = findAsset(c);
    return a ? a.name : c;
  }

  // ------------------------------------------------------------------ //
  // 右侧角色 / 背景栏（纵向、可收起、拖动排序；顺序在前 = 层级越高）
  // ------------------------------------------------------------------ //
  // 顺序即层级：列表最前面的角色显示在最上层，后面依次压在下层
  function assignSpriteLayers(sprites) {
    if (!Array.isArray(sprites)) return;
    var n = sprites.length;
    sprites.forEach(function (sp, i) {
      if (sp) sp.layer = n - i;
    });
  }

  // 生成属性输入框（统一样式与交互）
  function makePropInput(value, title) {
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.value = (value == null ? '' : String(value));
    inp.defaultValue = inp.value;
    inp.className = 'sprite-prop-input';
    if (title) inp.title = title;
    return inp;
  }

  // 输入框：阻止冒泡（避免点击输入框触发选中卡片），回车 / 失焦提交
  function bindPropInput(inp, apply) {
    inp.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    inp.addEventListener('click', function (e) { e.stopPropagation(); });
    inp.addEventListener('change', function () { apply(inp.value); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      else if (e.key === 'Escape') { inp.value = inp.defaultValue; inp.blur(); }
    });
  }

  function setSpriteNum(i, key, raw) {
    var sprites = currentSprites();
    var sp = sprites && sprites[i];
    if (!sp) return;
    var num = parseInt(raw, 10);
    if (isNaN(num)) { renderSpriteBar(); return; }
    if (key === 'w' || key === 'h') num = Math.max(1, num);
    if (Number(sp[key]) === num) return;
    sp[key] = num;
    // 文本角色：改宽 / 高时同步字号
    if (sp.text != null && (key === 'w' || key === 'h')) {
      sp.size = Math.max(8, Math.round(Math.min(Number(sp.w) || 1, Number(sp.h) || 1) * 0.55));
    }
    self.dirty = true;
    refresh(true);
  }

  // 「大小」：同时设置宽和高（等比方形）
  function setSpriteSize(i, raw) {
    var sprites = currentSprites();
    var sp = sprites && sprites[i];
    if (!sp) return;
    var num = parseInt(raw, 10);
    if (isNaN(num)) { renderSpriteBar(); return; }
    num = Math.max(1, num);
    if (Number(sp.w) === num && Number(sp.h) === num) return;
    sp.w = num;
    sp.h = num;
    if (sp.text != null) sp.size = Math.max(8, Math.round(num * 0.55));
    self.dirty = true;
    refresh(true);
  }

  function applySpriteName(i, raw) {
    var sprites = currentSprites();
    var sp = sprites && sprites[i];
    if (!sp) return;
    var name = String(raw || '').trim();
    if (!name || name === sp.name) { renderSpriteBar(); return; }
    if (sprites.some(function (s, k) { return k !== i && s.name === name; })) {
      toast('已有同名角色：' + name);
      renderSpriteBar();
      return;
    }
    var old = sp.name;
    sp.name = name;
    renameSpriteRefs(old, name);
    self.dirty = true;
    refresh(true);
  }

  function applyBackdropName(idx, raw) {
    var bd = currentBackdrop();
    var it = bd && bd.costumes[idx];
    if (!it) return;
    var name = String(raw || '').trim();
    if (!name || name === it.name) { renderSpriteBar(); return; }
    if (bd.costumes.some(function (c, k) { return k !== idx && c.name === name; })) {
      toast('已有同名背景：' + name);
      renderSpriteBar();
      return;
    }
    var old = it.name;
    it.name = name;
    renameBackdropRefs(old, name);
    self.dirty = true;
    refresh(true);
  }

  // 拖动卡片调整顺序（用拖动柄，避免和属性输入框冲突）
  function bindSpriteReorder(card, handle, strip, kind) {
    if (!handle) return;
    handle.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      var cards = Array.prototype.slice.call(strip.querySelectorAll('.sprite-card'));
      var from = cards.indexOf(card);
      if (from < 0) return;
      var moved = false;
      card.classList.add('dragging');
      var onMove = function (ev) {
        moved = true;
        var y = ev.clientY;
        var ref = null;
        for (var i = 0; i < cards.length; i++) {
          var c = cards[i];
          if (c === card) continue;
          var r = c.getBoundingClientRect();
          if (y < r.top + r.height / 2) { ref = c; break; }
        }
        if (ref) strip.insertBefore(card, ref);
        else strip.appendChild(card);
      };
      var onUp = function () {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        card.classList.remove('dragging');
        if (!moved) return;
        var newCards = Array.prototype.slice.call(strip.querySelectorAll('.sprite-card'));
        var to = newCards.indexOf(card);
        if (to >= 0 && to !== from) reorderSpriteItem(kind, from, to);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // 把 from 位置的条目移动到 to 位置，并保持当前选中项不变
  function reorderSpriteItem(kind, from, to) {
    var pg = self.pages[self.cur];
    if (!pg) return;
    if (kind === 'backdrop') {
      var bd = ensureBackdrop(pg);
      var arr = bd.costumes;
      if (!arr[from]) return;
      var selItem = arr[bd.index] || null;
      var item = arr.splice(from, 1)[0];
      arr.splice(to, 0, item);
      var ni = selItem ? arr.indexOf(selItem) : 0;
      bd.index = ni >= 0 ? ni : 0;
      self.dirty = true;
      renderSpriteBar();
      refresh(true);
      return;
    }
    var sprites = currentSprites();
    if (!sprites || !sprites[from]) return;
    var selSp = (self.spriteSel >= 0) ? sprites[self.spriteSel] : null;
    var movedSp = sprites.splice(from, 1)[0];
    sprites.splice(to, 0, movedSp);
    if (selSp) {
      var si = sprites.indexOf(selSp);
      if (si >= 0) self.spriteSel = si;
    }
    assignSpriteLayers(sprites);
    self.dirty = true;
    renderSpriteBar();
    refresh(true);
  }

  function renderSpriteBar() {
    var strip = $('sprite-strip');
    var pg = self.pages[self.cur];
    if (!strip || !pg) return;
    // 同步「角色 / 背景」标签高亮
    Array.prototype.slice.call(document.querySelectorAll('.sprite-bar-tab')).forEach(function (tab) {
      tab.classList.toggle('active', tab.getAttribute('data-tab') === self.barTab);
    });
    var addBtn = $('btn-sprite-add');
    if (addBtn) addBtn.title = self.barTab === 'backdrop' ? '新建背景' : '新建角色';
    strip.innerHTML = '';
    renderMiniRail(pg);
    if (self.barTab === 'backdrop') { renderBackdropCards(strip, pg); return; }
    var sprites = currentSprites();
    if (!sprites) return;
    assignSpriteLayers(sprites);
    if (!sprites.length) {
      strip.appendChild(el('div', 'sprite-empty', '点「＋」新建角色；按住卡片左侧的拖动柄可调整顺序（越靠上层级越高）'));
      return;
    }
    if (self.spriteSel >= sprites.length) self.spriteSel = sprites.length - 1;

    sprites.forEach(function (sp, i) {
      var active = self.selKind === 'sprite' && i === self.spriteSel;
      var card = el('div', 'sprite-card' + (active ? ' active' : ''));
      card.setAttribute('data-idx', String(i));

      // 顶部：拖动柄 + 缩略图 + 名称输入
      var top = el('div', 'sprite-card-top');
      var handle = el('span', 'sprite-drag-handle', '⋮⋮');
      handle.title = '按住拖动调整顺序（越靠上层级越高）';
      top.appendChild(handle);

      var thumb = el('div', 'sprite-card-thumb');
      if (sp.text != null) {
        // 文本角色：用 T 缩略图（内容存在代码里，没有图片）
        thumb.classList.add('text');
        thumb.textContent = 'T';
        thumb.title = String(sp.text);
      } else {
        var cu = pickCostume(sp.costume, sp.costumes);
        var url = costumeUrl(cu);
        if (url) {
          var im = document.createElement('img');
          im.src = url;
          im.alt = sp.name;
          thumb.appendChild(im);
        } else {
          thumb.textContent = '🖼';
        }
      }
      top.appendChild(thumb);

      var nameInp = makePropInput(sp.name, '角色名称（可直接修改）');
      nameInp.className = 'sprite-name-input';
      bindPropInput(nameInp, function (val) { applySpriteName(i, val); });
      top.appendChild(nameInp);
      card.appendChild(top);

      // 属性：X / Y / 宽 / 高 / 方向，直接编辑生效
      var props = el('div', 'sprite-card-props');
      var addProp = function (label, key, val, apply) {
        var wrap = el('label', 'sprite-prop');
        wrap.appendChild(el('span', '', label));
        var tip = key === 'x' ? 'X 坐标：0 = 屏幕中心，向右为正'
                : key === 'y' ? 'Y 坐标：0 = 屏幕中心，向下为正' : '';
        var inp = makePropInput(val, tip);
        bindPropInput(inp, apply);
        wrap.appendChild(inp);
        props.appendChild(wrap);
      };
      addProp('X', 'x', Math.round(Number(sp.x) || 0), function (v) { setSpriteNum(i, 'x', v); });
      addProp('Y', 'y', Math.round(Number(sp.y) || 0), function (v) { setSpriteNum(i, 'y', v); });
      addProp('宽', 'w', Math.round(Number(sp.w) || 0), function (v) { setSpriteNum(i, 'w', v); });
      addProp('高', 'h', Math.round(Number(sp.h) || 0), function (v) { setSpriteNum(i, 'h', v); });
      addProp('大小', 'size', Math.round(Number(sp.w) || 0), function (v) { setSpriteSize(i, v); });
      addProp('方向', 'rot', Math.round(Number(sp.rot) || 0), function (v) { setSpriteNum(i, 'rot', v); });
      card.appendChild(props);

      card.addEventListener('click', function (e) {
        if (!card.isConnected) return;
        if (e.target && e.target.closest && e.target.closest('input')) return;
        selectSprite(i);
      });
      card.addEventListener('contextmenu', function (e) {
        if (!card.isConnected) return;
        e.preventDefault();
        selectSprite(i);
        openSpriteMenu(i, e.clientX, e.clientY);
      });
      bindSpriteReorder(card, handle, strip, 'sprite');
      strip.appendChild(card);
    });
  }

  function renderBackdropCards(strip, pg) {
    var bd = ensureBackdrop(pg);
    bd.costumes.forEach(function (it, idx) {
      var active = self.selKind === 'backdrop' && idx === bd.index;
      var card = el('div', 'sprite-card bg' + (active ? ' active' : ''));
      card.setAttribute('data-idx', String(idx));

      var top = el('div', 'sprite-card-top');
      var handle = el('span', 'sprite-drag-handle', '⋮⋮');
      handle.title = '按住拖动调整顺序（越靠上层级越高）';
      top.appendChild(handle);

      var thumb = el('div', 'sprite-card-thumb');
      var url = costumeUrl(it.image);
      if (url) {
        var im = document.createElement('img');
        im.src = url;
        im.alt = it.name;
        thumb.appendChild(im);
      } else {
        thumb.textContent = '🖼';
      }
      top.appendChild(thumb);

      var nameInp = makePropInput(it.name, '背景名称（可直接修改）');
      nameInp.className = 'sprite-name-input';
      bindPropInput(nameInp, function (val) { applyBackdropName(idx, val); });
      top.appendChild(nameInp);
      card.appendChild(top);

      card.appendChild(el('div', 'sprite-prop-hint', '背景铺满整个屏幕'));

      card.addEventListener('click', function (e) {
        if (!card.isConnected) return;
        if (e.target && e.target.closest && e.target.closest('input')) return;
        selectBackdrop(idx);
      });
      card.addEventListener('contextmenu', function (e) {
        if (!card.isConnected) return;
        e.preventDefault();
        selectBackdrop(idx);
        openBackdropMenu(idx, e.clientX, e.clientY);
      });
      bindSpriteReorder(card, handle, strip, 'backdrop');
      strip.appendChild(card);
    });
  }

  // 收起状态下的迷你图标栏：显示当前背景 + 所有角色，点击直接切换，
  // 上下拖动调整顺序（角色顺序即图层，越靠上层级越高）
  function renderMiniRail(pg) {
    var rail = $('sprite-mini-rail');
    if (!rail || !pg) return;
    rail.innerHTML = '';

    var bd = ensureBackdrop(pg);
    bd.costumes.forEach(function (it, idx) {
      var active = self.selKind === 'backdrop' && idx === bd.index;
      var mini = el('div', 'sprite-mini bg' + (active ? ' active' : ''));
      mini.setAttribute('data-kind', 'backdrop');
      mini.setAttribute('data-idx', String(idx));
      mini.title = '背景：' + (it.name || '') + '（点击编辑，可上下拖动排序）';
      var url = costumeUrl(it.image);
      if (url) {
        var im = document.createElement('img');
        im.src = url;
        im.alt = it.name || '';
        mini.appendChild(im);
      } else {
        mini.textContent = '背';
      }
      mini.addEventListener('click', function () {
        if (mini.classList.contains('was-dragged')) return;
        selectBackdrop(idx);
      });
      bindMiniReorder(mini, rail, 'backdrop');
      rail.appendChild(mini);
    });

    rail.appendChild(el('div', 'sprite-mini-sep'));

    (pg.sprites || []).forEach(function (sp, i) {
      if (!sp) return;
      var active = self.selKind === 'sprite' && i === self.spriteSel;
      var mini = el('div', 'sprite-mini' + (active ? ' active' : ''));
      mini.setAttribute('data-kind', 'sprite');
      mini.setAttribute('data-idx', String(i));
      mini.title = '角色：' + sp.name + '（点击编辑，可上下拖动调整顺序 / 图层）';
      if (sp.text != null) {
        mini.classList.add('text');
        mini.textContent = 'T';
      } else {
        var cu = pickCostume(sp.costume, sp.costumes);
        var url = costumeUrl(cu);
        if (url) {
          var im = document.createElement('img');
          im.src = url;
          im.alt = sp.name;
          mini.appendChild(im);
        } else {
          mini.textContent = '🖼';
        }
      }
      mini.addEventListener('click', function () {
        if (mini.classList.contains('was-dragged')) return;
        selectSprite(i);
      });
      bindMiniReorder(mini, rail, 'sprite');
      rail.appendChild(mini);
    });
  }

  // 迷你图标上下拖动排序：只在同类型（背景 / 角色）之间交换位置
  function bindMiniReorder(mini, rail, kind) {
    mini.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var sel = '.sprite-mini[data-kind="' + kind + '"]';
      var minis = Array.prototype.slice.call(rail.querySelectorAll(sel));
      var from = minis.indexOf(mini);
      if (from < 0) return;
      var startY = e.clientY;
      var moved = false;

      var onMove = function (ev) {
        if (!moved && Math.abs(ev.clientY - startY) < 4) return;
        moved = true;
        mini.classList.add('dragging');
        var ref = null;
        for (var i = 0; i < minis.length; i++) {
          var c = minis[i];
          if (c === mini) continue;
          var r = c.getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) { ref = c; break; }
        }
        if (ref) {
          rail.insertBefore(mini, ref);
        } else {
          // 放到同类型最后一个之后（避免越过分隔线）
          var last = null;
          for (var j = minis.length - 1; j >= 0; j--) {
            if (minis[j] !== mini) { last = minis[j]; break; }
          }
          if (last) rail.insertBefore(mini, last.nextSibling);
          else rail.appendChild(mini);
        }
      };
      var onUp = function () {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        mini.classList.remove('dragging');
        if (!moved) return;
        var now = Array.prototype.slice.call(rail.querySelectorAll(sel));
        var to = now.indexOf(mini);
        // 拖动后屏蔽一次 click，避免误触发选中
        mini.classList.add('was-dragged');
        setTimeout(function () { mini.classList.remove('was-dragged'); }, 0);
        if (to >= 0 && to !== from) reorderSpriteItem(kind, from, to);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ---------------- 角色右键菜单 ----------------
  var spriteMenuEl = null;

  function openSpriteMenu(i, x, y) {
    closeSpriteMenu();
    var sprites = currentSprites();
    var sp = sprites && sprites[i];
    if (!sp) return;
    var menu = el('div', 'sprite-menu');
    var addItem = function (label, danger, fn) {
      var b = el('button', 'sprite-menu-item' + (danger ? ' danger' : ''), label);
      b.addEventListener('click', fn);
      menu.appendChild(b);
    };
    addItem('重命名角色', false, function () {
      closeSpriteMenu();
      renameSprite(i);
    });
    if (sp.text != null) {
      // 文本角色没有造型，改成编辑文字内容
      addItem('编辑文本', false, function () {
        closeSpriteMenu();
        var t = prompt('编辑文本内容：', String(sp.text || ''));
        if (t == null) return;
        t = String(t).replace(/\s+$/, '');
        if (!t) return;
        sp.text = t;
        self.dirty = true;
        refresh(true);
        toast('文本已更新');
      });
    } else {
      addItem('编辑造型', false, function () {
        closeSpriteMenu();
        openCostumeEditor(i);
      });
    }
    addItem('删除角色', true, function () {
      closeSpriteMenu();
      deleteSprite(i);
    });
    document.body.appendChild(menu);
    menu.style.left = Math.min(x, Math.max(8, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.min(y, Math.max(8, window.innerHeight - menu.offsetHeight - 8)) + 'px';
    spriteMenuEl = menu;
    setTimeout(function () {
      document.addEventListener('mousedown', onSpriteMenuDocDown);
    }, 0);
  }

  function openBackdropMenu(idx, x, y) {
    closeSpriteMenu();
    var bd = currentBackdrop();
    var it = bd && bd.costumes[idx];
    if (!it) return;
    var menu = el('div', 'sprite-menu');
    var addItem = function (label, danger, fn) {
      var b = el('button', 'sprite-menu-item' + (danger ? ' danger' : ''), label);
      b.addEventListener('click', fn);
      menu.appendChild(b);
    };
    addItem('重命名背景', false, function () {
      closeSpriteMenu();
      renameBackdrop(idx);
    });
    addItem('编辑造型', false, function () {
      closeSpriteMenu();
      openBackdropCostumeEditor(idx);
    });
    addItem('删除背景', true, function () {
      closeSpriteMenu();
      deleteBackdrop(idx);
    });
    document.body.appendChild(menu);
    menu.style.left = Math.min(x, Math.max(8, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.min(y, Math.max(8, window.innerHeight - menu.offsetHeight - 8)) + 'px';
    spriteMenuEl = menu;
    setTimeout(function () {
      document.addEventListener('mousedown', onSpriteMenuDocDown);
    }, 0);
  }

  function onSpriteMenuDocDown(e) {
    if (spriteMenuEl && spriteMenuEl.contains(e.target)) return;
    closeSpriteMenu();
  }

  function closeSpriteMenu() {
    if (spriteMenuEl && spriteMenuEl.parentNode) spriteMenuEl.parentNode.removeChild(spriteMenuEl);
    spriteMenuEl = null;
    document.removeEventListener('mousedown', onSpriteMenuDocDown);
  }

  function renameSprite(i) {
    var sprites = currentSprites();
    var sp = sprites && sprites[i];
    if (!sp) return;
    var name = (prompt('角色名字：', sp.name) || '').trim();
    if (!name || name === sp.name) return;
    if (sprites.some(function (s) { return s !== sp && s.name === name; })) {
      toast('已有同名角色：' + name);
      return;
    }
    var old = sp.name;
    sp.name = name;
    renameSpriteRefs(old, name);
    self.dirty = true;
    renderSpriteBar();
    refresh();
    toast('已重命名为「' + name + '」');
  }

  // ------------------------------------------------------------------ //
  // 造型编辑器（参考 Scratch 的造型编辑）
  // ------------------------------------------------------------------ //
  var ce = null;              // 当前造型编辑状态
  var ceCanvasBound = false;

  // 画板栏开关：打开时隐藏 Blockly 工作区，显示画板；关闭反之
  function openDrawer() {
    var ws = $('blocklyDiv');
    var dr = $('drawer-panel');
    var btn = $('btn-drawer');
    if (!dr) return;
    if (ws) ws.style.display = 'none';
    dr.style.display = 'flex';
    if (btn) btn.classList.add('active');
    // 打开画板后给 canvas 一次重绘机会，否则首次显示画布可能空白
    setTimeout(function () {
      try { Blockly.svgResize(self.workspace); } catch (e) { /* ignore */ }
    }, 80);
  }

  function closeDrawer() {
    var ws = $('blocklyDiv');
    var dr = $('drawer-panel');
    var btn = $('btn-drawer');
    if (!dr) return;
    dr.style.display = 'none';
    if (ws) ws.style.display = '';
    if (btn) btn.classList.remove('active');
    setTimeout(function () {
      try { Blockly.svgResize(self.workspace); } catch (e) { /* ignore */ }
      if (window.DBX_PREVIEW) DBX_PREVIEW.resize();
    }, 80);
  }

  function toggleDrawer() {
    var dr = $('drawer-panel');
    if (!dr) return;
    if (dr.style.display === 'flex') {
      if (ce) closeCostumeEditor();
      else closeDrawer();
    } else {
      openDrawer();
    }
  }

  // 打开造型编辑器：先打开画板栏（drawer-panel），再把 ce-panel 显示出来
  function showCostumePanel(state) {
    openDrawer();
    // 切换 tab 不再需要 —— ce-panel 已经在 drawer-panel 里
    var empty = $('drawer-empty');
    var cePanel = $('ce-panel');
    if (empty) empty.style.display = 'none';
    if (cePanel) cePanel.style.display = 'flex';
    ce = state;
    bindCostumeCanvas();
    renderCostumeEditor();
    // 打开画板后按可用空间自动缩放一次
    if (ceFitView) setTimeout(function () { try { ceFitView(); } catch (eF) { /* ignore */ } }, 60);
    // 更新画板栏标题
    var title = $('drawer-title');
    var sub = $('drawer-sub');
    if (ce.kind === 'backdrop') {
      var bd = ensureBackdrop(self.pages[self.cur]);
      var it = bd && bd.costumes[ce.index];
      if (title) title.textContent = '背景造型';
      if (sub) sub.textContent = '背景「' + (it ? it.name : '背景') + '」 · 切换到不同背景可编辑各自的造型';
    } else {
      var sp = (self.pages[self.cur].sprites || [])[ce.index];
      if (title) title.textContent = '角色造型';
      if (sub) sub.textContent = '角色「' + (sp ? sp.name : '') + '」';
    }
    // 恢复颜色/粗细到画板工具条（按钮绑定已在 bindCostumeCanvas 里）
    try {
      var col = $('ce-color'); if (col) col.value = ce.color || '#ff9f1a';
      var sz = $('ce-size'); if (sz) { sz.value = ce.size != null ? ce.size : 4; var sv = $('ce-size-val'); if (sv) sv.textContent = String(sz.value); }
    } catch (e) { /* ignore */ }
  }

  function openCostumeEditor(i) {
    var sprites = currentSprites();
    var sp = sprites && sprites[i];
    if (!sp) return;
    self.spriteSel = i;
    showCostumePanel({
      kind: 'sprite',
      index: i,
      costume: pickCostume(sp.costume, sp.costumes),
      canvas: null, ctx: null,
      drawing: false, lastX: 0, lastY: 0,
      loadToken: 0
    });
  }

  function openBackdropCostumeEditor(idx) {
    var pg = self.pages[self.cur];
    if (!pg) return;
    var bd = ensureBackdrop(pg);
    if (idx < 0 || idx >= bd.costumes.length) idx = bd.index;
    bd.index = idx;
    self.selKind = 'backdrop';
    self.spriteSel = -1;
    showCostumePanel({
      kind: 'backdrop',
      index: idx,
      costume: bd.costumes[idx].image || '',
      canvas: null, ctx: null,
      drawing: false, lastX: 0, lastY: 0,
      loadToken: 0
    });
  }

  // 当前造型编辑对象：角色对象，或背景对象（含 costumes 列表）
  function ceOwner() {
    if (!ce) return null;
    var pg = self.pages[self.cur];
    if (!pg) return null;
    if (ce.kind === 'backdrop') return ensureBackdrop(pg);
    return (pg.sprites || [])[ce.index] || null;
  }

  function ceBackdropItem() {
    var bd = ceOwner();
    return bd && bd.costumes ? bd.costumes[bd.index] : null;
  }

  function closeCostumeEditor() {
    ce = null;
    var cePanel = $('ce-panel');
    var empty = $('drawer-empty');
    if (cePanel) cePanel.style.display = 'none';
    if (empty) empty.style.display = '';
    // 只关闭画板栏（回到积木工作区），不切换 preview/code/issue 标签
    closeDrawer();
  }

  function bindCostumeCanvas() {
    if (ceCanvasBound) return;
    var canvas = $('ce-canvas');
    if (!canvas) return;
    ceCanvasBound = true;

    // —— 通用状态 ——
    var drawing = false;
    var lastPoint = null;
    var history = [];       // { snapshot, tool, ... } 撤销栈
    var redoStack = [];
    var toolState = {
      tool: 'brush',        // select / brush / eraser / fill / line / rect / ellipse / text
      color: '#ff9f1a',
      size: 4,
      zoom: 1,
      fg: '#ff9f1a',
      bg: '#ffffff',
      format: 'png',        // png = 支持透明；jpg = 无透明（橡皮擦成白色）
      quality: 0.72         // JPG 质量（0~1）
    };
    var strokeStart = null;  // 形状工具起点
    var tmpCanvas = null;    // 矩形/椭圆/直线绘制时的临时副本
    var canvasStackLimit = 30;

    // —— 辅助函数 ——
    function pushHistory() {
      if (!ce || !ce.canvas) return;
      try {
        var snap = ce.canvas.toDataURL();
        history.push({ snapshot: snap });
        if (history.length > canvasStackLimit) history.shift();
        redoStack = [];
      } catch (e) { /* ignore */ }
    }
    function applySnapshot(snap) {
      if (!ce || !ce.ctx) return;
      if (typeof clearSel === 'function') clearSel();
      var img = new Image();
      img.onload = function () {
        ce.ctx.clearRect(0, 0, ce.canvas.width, ce.canvas.height);
        ce.ctx.drawImage(img, 0, 0, ce.canvas.width, ce.canvas.height);
      };
      img.src = snap;
    }

    function setTool(tool) {
      // 切换到别的工具时，提交当前选区（已合成在画布上，只需去掉手柄）
      if (tool !== 'select' && typeof clearSel === 'function') clearSel();
      toolState.tool = tool;
      document.querySelectorAll('.ce-tool-btn[data-tool]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-tool') === tool);
      });
    }

    // 给鼠标位置返回 canvas 坐标
    function canvasPoint(e) {
      var canvas = ce.canvas || $('ce-canvas');
      var r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * canvas.width / Math.max(1, r.width),
        y: (e.clientY - r.top) * canvas.height / Math.max(1, r.height)
      };
    }

    // —— 选择工具：点选一块连通图案 → 拖动移动 / 拖角缩放 ——
    var sel = null;        // { base:ImageData, img:canvas, x,y,w,h }
    var selDrag = null;    // { mode:'move'|'resize', corner, sx, sy, box }
    var SEL_ALPHA = 8;
    var SEL_MAX_PIXELS = 900000;

    function selOverlay() { return $('ce-sel-overlay'); }

    function clearSel() {
      sel = null;
      selDrag = null;
      var ov = selOverlay();
      if (ov) {
        var oct = ov.getContext('2d');
        oct.clearRect(0, 0, ov.width || 1, ov.height || 1);
        ov.style.display = 'none';
      }
    }
    ceClearSel = clearSel;

    // 找出点击处相连的不透明像素区域（返回像素列表与包围盒）
    function findRegionAt(px, py) {
      if (!ce || !ce.ctx) return null;
      var cv = ce.canvas, c = ce.ctx;
      var w = cv.width, h = cv.height;
      px = Math.round(px); py = Math.round(py);
      if (px < 0 || py < 0 || px >= w || py >= h) return null;
      var img = c.getImageData(0, 0, w, h);
      var d = img.data;
      var start = py * w + px;
      if (d[start * 4 + 3] < SEL_ALPHA) return null;
      var visited = new Uint8Array(w * h);
      var stack = [start];
      var pixels = [];
      var minX = px, maxX = px, minY = py, maxY = py;
      var guard = 0;
      while (stack.length && guard < SEL_MAX_PIXELS) {
        var idx = stack.pop();
        guard++;
        if (visited[idx]) continue;
        visited[idx] = 1;
        if (d[idx * 4 + 3] < SEL_ALPHA) continue;
        var x = idx % w, y = (idx - x) / w;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        pixels.push(idx);
        if (x > 0) stack.push(idx - 1);
        if (x < w - 1) stack.push(idx + 1);
        if (y > 0) stack.push(idx - w);
        if (y < h - 1) stack.push(idx + w);
      }
      if (!pixels.length) return null;
      return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, pixels: pixels, img: img };
    }

    // 把点击处的图案「抬」成一个浮动选区，并从底图移除
    function liftSelection(px, py) {
      var cv = ce.canvas, c = ce.ctx;
      var reg = findRegionAt(px, py);
      if (!reg) { clearSel(); return false; }
      var w = cv.width;
      var d = reg.img.data;
      // 选区图像
      var sc = document.createElement('canvas');
      sc.width = reg.w; sc.height = reg.h;
      var sctx = sc.getContext('2d');
      var sdata = sctx.createImageData(reg.w, reg.h);
      var sd = sdata.data;
      for (var i = 0; i < reg.pixels.length; i++) {
        var gidx = reg.pixels[i];
        var gx = gidx % w, gy = (gidx - gx) / w;
        var si = ((gy - reg.y) * reg.w + (gx - reg.x)) * 4;
        var gi = gidx * 4;
        sd[si] = d[gi]; sd[si + 1] = d[gi + 1]; sd[si + 2] = d[gi + 2]; sd[si + 3] = d[gi + 3];
        d[gi] = 0; d[gi + 1] = 0; d[gi + 2] = 0; d[gi + 3] = 0;
      }
      sctx.putImageData(sdata, 0, 0);
      c.putImageData(reg.img, 0, 0);
      sel = { base: reg.img, img: sc, x: reg.x, y: reg.y, w: reg.w, h: reg.h };
      renderSel();
      return true;
    }

    function selCorners() {
      if (!sel) return [];
      return [
        { k: 'tl', x: sel.x, y: sel.y },
        { k: 'tr', x: sel.x + sel.w, y: sel.y },
        { k: 'bl', x: sel.x, y: sel.y + sel.h },
        { k: 'br', x: sel.x + sel.w, y: sel.y + sel.h }
      ];
    }

    function selHitTest(p) {
      if (!sel) return null;
      var cv = ce.canvas;
      var k = cv.width / Math.max(1, cv.clientWidth || cv.width);
      var th = Math.max(6, (sel.w || 1) / 18, (sel.h || 1) / 18);
      var cs = selCorners();
      for (var i = 0; i < cs.length; i++) {
        if (Math.abs(p.x - cs[i].x) <= th && Math.abs(p.y - cs[i].y) <= th) {
          return { mode: 'resize', corner: cs[i].k, k: k };
        }
      }
      if (p.x >= sel.x && p.x <= sel.x + sel.w && p.y >= sel.y && p.y <= sel.y + sel.h) {
        return { mode: 'move' };
      }
      return null;
    }

    function drawSelOverlay() {
      var ov = selOverlay();
      if (!ov || !sel) return;
      var cv = ce.canvas;
      if (ov.width !== cv.width || ov.height !== cv.height) {
        ov.width = cv.width;
        ov.height = cv.height;
      }
      ov.style.display = 'block';
      var oct = ov.getContext('2d');
      oct.clearRect(0, 0, ov.width, ov.height);
      var k = cv.width / Math.max(1, cv.clientWidth || cv.width);
      oct.strokeStyle = '#4c97ff';
      oct.lineWidth = Math.max(1, k);
      oct.setLineDash([6 * k, 4 * k]);
      oct.strokeRect(sel.x + k / 2, sel.y + k / 2, sel.w - k, sel.h - k);
      oct.setLineDash([]);
      var hs = Math.max(6, 9 * k);
      var cs = selCorners();
      oct.fillStyle = '#ffffff';
      oct.strokeStyle = '#4c97ff';
      oct.lineWidth = Math.max(1, 2 * k);
      for (var i = 0; i < cs.length; i++) {
        oct.fillRect(cs[i].x - hs / 2, cs[i].y - hs / 2, hs, hs);
        oct.strokeRect(cs[i].x - hs / 2, cs[i].y - hs / 2, hs, hs);
      }
    }

    function renderSel() {
      if (!sel) return;
      var c = ce.ctx;
      c.globalCompositeOperation = 'source-over';
      c.putImageData(sel.base, 0, 0);
      c.imageSmoothingEnabled = false;
      c.drawImage(sel.img, sel.x, sel.y, sel.w, sel.h);
      drawSelOverlay();
    }

    // —— 填充工具（Flood Fill）——
    function floodFill(x, y, fillColor) {
      if (!ce || !ce.ctx) return;
      var c = ce.ctx;
      var w = ce.canvas.width, h = ce.canvas.height;
      var imgData = c.getImageData(0, 0, w, h);
      var data = imgData.data;
      var idx = function (px, py) { return (py * w + px) * 4; };

      var startIdx = idx(Math.round(x), Math.round(y));
      var sr = data[startIdx], sg = data[startIdx + 1], sb = data[startIdx + 2], sa = data[startIdx + 3];
      var fr = parseInt(fillColor.slice(1, 3), 16);
      var fg = parseInt(fillColor.slice(3, 5), 16);
      var fb = parseInt(fillColor.slice(5, 7), 16);

      // 颜色相同就不填
      if (sr === fr && sg === fg && sb === fb && sa === 255) return;

      var stack = [[Math.round(x), Math.round(y)]];
      while (stack.length) {
        var cur = stack.pop();
        var cx = cur[0], cy = cur[1];
        if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
        var i = idx(cx, cy);
        if (data[i] !== sr || data[i + 1] !== sg || data[i + 2] !== sb || data[i + 3] !== sa) continue;
        data[i] = fr; data[i + 1] = fg; data[i + 2] = fb; data[i + 3] = 255;
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      c.putImageData(imgData, 0, 0);
    }

    // —— 形状绘制 ——
    function drawShape(kind, x0, y0, x1, y1, stroke) {
      if (!ce || !ce.ctx) return;
      var c = ce.ctx;
      var erasing = toolState.tool === 'eraser';
      if (erasing && toolState.format === 'jpg') {
        c.globalCompositeOperation = 'source-over';
        c.strokeStyle = toolState.bg || '#ffffff';
      } else {
        c.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
        c.strokeStyle = toolState.color;
      }
      c.lineWidth = toolState.size;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.fillStyle = toolState.bg;
      c.beginPath();
      if (kind === 'line') {
        c.moveTo(x0, y0); c.lineTo(x1, y1);
      } else if (kind === 'rect') {
        var rx = Math.min(x0, x1), ry = Math.min(y0, y1);
        var rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
        if (stroke) c.strokeRect(rx, ry, rw, rh);
        else c.fillRect(rx, ry, rw, rh);
        c.globalCompositeOperation = 'source-over';
        return;
      } else if (kind === 'ellipse') {
        var ex = (x0 + x1) / 2, ey = (y0 + y1) / 2;
        var erx = Math.abs(x1 - x0) / 2, ery = Math.abs(y1 - y0) / 2;
        c.ellipse(ex, ey, erx, ery, 0, 0, Math.PI * 2);
      }
      if (stroke) c.stroke();
      else c.fill();
      c.globalCompositeOperation = 'source-over';
    }

    // —— 自由笔触 ——
    function paintStroke(x0, y0, x1, y1) {
      if (!ce || !ce.ctx) return;
      var c = ce.ctx;
      var erasing = toolState.tool === 'eraser';
      // PNG：橡皮擦擦成透明；JPG：无透明，橡皮擦用白色（背景色）覆盖
      if (erasing && toolState.format === 'jpg') {
        c.globalCompositeOperation = 'source-over';
        c.strokeStyle = toolState.bg || '#ffffff';
      } else {
        c.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
        c.strokeStyle = toolState.color;
      }
      c.lineWidth = toolState.size;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
      c.globalCompositeOperation = 'source-over';
    }

    // —— 指针事件 ——
    canvas.addEventListener('pointerdown', function (e) {
      if (!ce) return;
      pushHistory();
      ce.canvas = canvas;
      ce.ctx = canvas.getContext('2d');
      drawing = true;
      var p = canvasPoint(e);
      lastPoint = p;

      if (toolState.tool === 'fill') {
        floodFill(p.x, p.y, toolState.color);
        drawing = false;
        return;
      }
      if (toolState.tool === 'text') {
        var txt = window.prompt('输入文字：', 'Aa');
        if (txt && ce.ctx) {
          ce.ctx.fillStyle = toolState.color;
          ce.ctx.font = 'bold ' + Math.max(12, toolState.size * 6) + 'px sans-serif';
          ce.ctx.textBaseline = 'top';
          ce.ctx.fillText(txt, p.x, p.y);
        }
        drawing = false;
        return;
      }
      if (toolState.tool === 'select') {
        drawing = false;
        var hit = selHitTest(p);
        if (hit && sel) {
          selDrag = {
            mode: hit.mode,
            corner: hit.corner || '',
            sx: p.x,
            sy: p.y,
            box: { x: sel.x, y: sel.y, w: sel.w, h: sel.h }
          };
          try { canvas.setPointerCapture(e.pointerId); } catch (errS) { /* ignore */ }
          return;
        }
        clearSel();
        liftSelection(p.x, p.y);
        return;
      }
      if (toolState.tool === 'line' || toolState.tool === 'rect' || toolState.tool === 'ellipse') {
        strokeStart = p;
        tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = canvas.width;
        tmpCanvas.height = canvas.height;
        tmpCanvas.getContext('2d').drawImage(canvas, 0, 0);
      } else {
        paintStroke(p.x, p.y, p.x, p.y);
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!ce) return;
      // 选择工具：拖动移动 / 缩放选区
      if (toolState.tool === 'select' && selDrag && sel) {
        var ps = canvasPoint(e);
        var dx = ps.x - selDrag.sx, dy = ps.y - selDrag.sy;
        if (selDrag.mode === 'move') {
          sel.x = Math.round(selDrag.box.x + dx);
          sel.y = Math.round(selDrag.box.y + dy);
        } else {
          var b = selDrag.box, nx = b.x, ny = b.y, nw = b.w, nh = b.h;
          if (selDrag.corner.indexOf('r') >= 0) nw = Math.max(4, b.w + dx);
          if (selDrag.corner.indexOf('l') >= 0) { nw = Math.max(4, b.w - dx); nx = b.x + (b.w - nw); }
          if (selDrag.corner.indexOf('b') >= 0) nh = Math.max(4, b.h + dy);
          if (selDrag.corner.indexOf('t') >= 0) { nh = Math.max(4, b.h - dy); ny = b.y + (b.h - nh); }
          sel.x = Math.round(nx); sel.y = Math.round(ny);
          sel.w = Math.round(nw); sel.h = Math.round(nh);
        }
        renderSel();
        return;
      }
      if (!drawing) return;
      var p = canvasPoint(e);
      if (toolState.tool === 'brush' || toolState.tool === 'eraser') {
        paintStroke(lastPoint.x, lastPoint.y, p.x, p.y);
      } else if (strokeStart && tmpCanvas) {
        // 形状预览：先恢复原始画布，再画临时形状
        var ctx = ce.ctx;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tmpCanvas, 0, 0);
        drawShape(toolState.tool, strokeStart.x, strokeStart.y, p.x, p.y, true);
      }
      lastPoint = p;
    });
    function stop() {
      // 选择工具：结束拖动，保留选区（画面已合成到画布上）
      if (toolState.tool === 'select' && selDrag) {
        selDrag = null;
        return;
      }
      if (!ce || !drawing) return;
      if (strokeStart) {
        var p2 = lastPoint || { x: strokeStart.x, y: strokeStart.y };
        drawShape(toolState.tool, strokeStart.x, strokeStart.y, p2.x, p2.y, true);
        strokeStart = null;
        tmpCanvas = null;
      }
      drawing = false;
    }
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('pointerleave', stop);

    // —— 工具按钮绑定 ——
    document.querySelectorAll('.ce-tool-btn[data-tool]').forEach(function (b) {
      b.addEventListener('click', function () { setTool(b.getAttribute('data-tool')); });
    });
    var color = $('ce-color');
    if (color) color.addEventListener('input', function () {
      toolState.color = color.value;
      toolState.fg = color.value;
      var fg = $('btn-ce-fg'); if (fg) fg.style.background = color.value;
    });
    var sizeRange = $('ce-size');
    if (sizeRange) sizeRange.addEventListener('input', function () {
      toolState.size = Number(sizeRange.value) || 4;
      var sizeVal = $('ce-size-val'); if (sizeVal) sizeVal.textContent = String(toolState.size);
    });
    var fg = $('btn-ce-fg');
    if (fg) fg.addEventListener('click', function () {
      toolState.color = toolState.fg;
      color.value = toolState.fg;
    });
    var bgSw = $('btn-ce-bg');
    if (bgSw) bgSw.addEventListener('click', function () {
      toolState.color = toolState.bg;
      color.value = toolState.bg;
    });

    // —— 画布分辨率 / PNG·JPG 格式 / 屏幕预览框 ——
    var frameEnabled = true;

    function deviceScreenOf() {
      var dt = (self.project && self.project.deviceType) || 'band10';
      if (window.DBX && DBX.deviceScreen) return DBX.deviceScreen(dt);
      return { w: 212, h: 520 };
    }

    function updateCanvasInputs() {
      var cv = (ce && ce.canvas) ? ce.canvas : $('ce-canvas');
      if (!cv) return;
      var wIn = $('ce-canvas-w'), hIn = $('ce-canvas-h');
      if (wIn) wIn.value = String(cv.width);
      if (hIn) hIn.value = String(cv.height);
    }

    // 在画布上叠一个「当前设备屏幕大小」的框，超出框＝会溢出屏幕
    function updateScreenFrame() {
      var frame = $('ce-screen-frame');
      var cv = (ce && ce.canvas) ? ce.canvas : $('ce-canvas');
      if (!frame || !cv) return;
      if (!frameEnabled) { frame.style.display = 'none'; return; }
      var scr = deviceScreenOf();
      // 用画布「显示尺寸」计算（画布可能被 CSS 最大尺寸缩小显示）
      var dw = cv.clientWidth || cv.width;
      var dh = cv.clientHeight || cv.height;
      var sc = Math.min(dw / scr.w, dh / scr.h) * 0.98;
      var fw = Math.max(1, Math.round(scr.w * sc));
      var fh = Math.max(1, Math.round(scr.h * sc));
      frame.style.display = 'block';
      frame.style.width = fw + 'px';
      frame.style.height = fh + 'px';
      frame.style.left = Math.round((dw - fw) / 2) + 'px';
      frame.style.top = Math.round((dh - fh) / 2) + 'px';
      var label = $('ce-screen-frame-label');
      if (label) label.textContent = '屏幕 ' + scr.w + '×' + scr.h;
    }
    ceUpdateScreenFrame = updateScreenFrame;

    // 改变画布分辨率：保留内容并等比拉伸到新尺寸
    function resizeCanvas(nw, nh) {
      var cv = (ce && ce.canvas) ? ce.canvas : $('ce-canvas');
      if (!cv) return;
      clearSel();
      nw = Math.max(8, Math.min(2048, Math.round(Number(nw) || 0)));
      nh = Math.max(8, Math.min(2048, Math.round(Number(nh) || 0)));
      if (!nw || !nh || (cv.width === nw && cv.height === nh)) {
        updateCanvasInputs(); updateScreenFrame(); return;
      }
      var tmp = document.createElement('canvas');
      tmp.width = cv.width; tmp.height = cv.height;
      tmp.getContext('2d').drawImage(cv, 0, 0);
      cv.width = nw; cv.height = nh;
      var c = cv.getContext('2d');
      c.clearRect(0, 0, nw, nh);
      if (toolState.format === 'jpg') { c.fillStyle = toolState.bg || '#ffffff'; c.fillRect(0, 0, nw, nh); }
      c.drawImage(tmp, 0, 0, nw, nh);
      if (ce) { ce.canvas = cv; ce.ctx = c; }
      updateCanvasInputs();
      updateScreenFrame();
      fitView();
    }

    function setFormat(f) {
      toolState.format = (f === 'jpg') ? 'jpg' : 'png';
      ceFormat = toolState.format;
      var stageEl = $('ce-canvas-stage');
      if (stageEl) {
        stageEl.classList.toggle('png', toolState.format === 'png');
        stageEl.classList.toggle('jpg', toolState.format === 'jpg');
      }
      var qw = $('ce-quality-wrap');
      if (qw) qw.style.display = (toolState.format === 'jpg') ? '' : 'none';
      var sel = $('ce-format');
      if (sel) sel.value = toolState.format;
      updateScreenFrame();
    }

    // 画布自适应缩放（打开画板时调用一次）
    function fitView() {
      var wrap = document.querySelector('.ce-canvas-wrap');
      var cv = (ce && ce.canvas) ? ce.canvas : $('ce-canvas');
      if (!wrap || !cv) return;
      var availW = Math.max(80, wrap.clientWidth - 96);
      var availH = Math.max(80, wrap.clientHeight - 52);
      var dw = cv.clientWidth || cv.width;
      var dh = cv.clientHeight || cv.height;
      var z = Math.min(availW / dw, availH / dh, 1);
      z = Math.max(0.25, Math.round(z * 100) / 100);
      applyZoom(Math.round(z * 100));
      updateScreenFrame();
    }
    ceFitView = fitView;

    // 绑定分辨率输入
    ['ce-canvas-w', 'ce-canvas-h'].forEach(function (id) {
      var inp = $(id);
      if (!inp) return;
      inp.addEventListener('change', function () {
        resizeCanvas($('ce-canvas-w').value, $('ce-canvas-h').value);
      });
    });
    var screenSizeBtn = $('btn-ce-screen-size');
    if (screenSizeBtn) screenSizeBtn.addEventListener('click', function () {
      var scr = deviceScreenOf();
      resizeCanvas(scr.w, scr.h);
      toast('画布已设为屏幕尺寸 ' + scr.w + '×' + scr.h);
    });
    var fmtSel = $('ce-format');
    if (fmtSel) fmtSel.addEventListener('change', function () { setFormat(fmtSel.value); });
    var qualityIn = $('ce-quality');
    if (qualityIn) qualityIn.addEventListener('change', function () {
      var q = parseInt(qualityIn.value, 10);
      if (isNaN(q)) q = 72;
      q = Math.max(30, Math.min(100, q));
      qualityIn.value = String(q);
      toolState.quality = q / 100;
      ceJpgQuality = toolState.quality;
    });
    var frameBtn = $('btn-ce-screen-frame');
    if (frameBtn) frameBtn.addEventListener('click', function () {
      frameEnabled = !frameEnabled;
      frameBtn.classList.toggle('active', frameEnabled);
      updateScreenFrame();
    });

    // 初始化格式 / 质量 / 分辨率显示
    if (qualityIn) toolState.quality = Math.max(0.3, Math.min(1, (parseInt(qualityIn.value, 10) || 72) / 100));
    setFormat(toolState.format);
    updateCanvasInputs();

    // —— 撤销 / 重做 ——
    var undoBtn = $('btn-ce-undo');
    if (undoBtn) undoBtn.addEventListener('click', function () {
      if (history.length < 2) return;
      var cur = history.pop();
      redoStack.push(cur);
      applySnapshot(history[history.length - 1].snapshot);
    });
    var redoBtn = $('btn-ce-redo');
    if (redoBtn) redoBtn.addEventListener('click', function () {
      if (!redoStack.length) return;
      var nxt = redoStack.pop();
      history.push(nxt);
      applySnapshot(nxt.snapshot);
    });

    // —— 清空 ——
    var clearBtn = $('btn-ce-clear');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      if (!ce) return;
      pushHistory();
      var c = ce.ctx, cv = ce.canvas;
      c.clearRect(0, 0, cv.width, cv.height);
      // JPG 无透明：清空后铺白底
      if (toolState.format === 'jpg') {
        c.fillStyle = toolState.bg || '#ffffff';
        c.fillRect(0, 0, cv.width, cv.height);
      }
    });

    // —— 缩放 ——
    var stage = $('ce-canvas-stage');
    var zoomRange = $('ce-zoom');
    var zoomIn = $('btn-ce-zoom-in');
    var zoomOut = $('btn-ce-zoom-out');
    var zoomReset = $('btn-ce-zoom-reset');
    function applyZoom(v) {
      toolState.zoom = v;
      if (zoomRange) zoomRange.value = v;
      if (stage) stage.style.transform = 'scale(' + (v / 100) + ')';
    }
    if (zoomRange) zoomRange.addEventListener('input', function () { applyZoom(Number(zoomRange.value)); });
    if (zoomIn) zoomIn.addEventListener('click', function () {
      applyZoom(Math.min(400, toolState.zoom + 10));
    });
    if (zoomOut) zoomOut.addEventListener('click', function () {
      applyZoom(Math.max(25, toolState.zoom - 10));
    });
    if (zoomReset) zoomReset.addEventListener('click', function () { applyZoom(100); });

    // Ctrl + 鼠标滚轮缩放画板（altKey 也兼容触控板的 pinch-to-zoom）
    if (stage) stage.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      e.preventDefault();
      var step = e.deltaY > 0 ? -10 : 10;
      applyZoom(Math.max(25, Math.min(400, toolState.zoom + step)));
    }, { passive: false });

    // —— 新建造型按钮 ——
    var newBlank = $('btn-ce-new-blank');
    if (newBlank) newBlank.addEventListener('click', function () {
      var owner = ceOwner();
      if (!owner || !ce) return;
      // 新建一个空白造型并立即设为当前（Scratch 行为：新增造型自动选中）
      var isBd = ce.kind === 'backdrop';
      if (isBd) {
        var it = { name: '背景' + (owner.costumes.length + 1), image: '', xml: '' };
        owner.costumes.push(it);
        owner.index = owner.costumes.length - 1;
        ce.index = owner.index;
        ce.costume = '';
      } else {
        owner.costumes.push('');
        owner.costume = '';
        ce.costume = '';
      }
      syncCurrentTarget();
      loadTargetIntoWorkspace(isBd ? 'backdrop' : 'sprite', isBd ? -1 : ce.index, true, true);
      ce.canvas = ce.canvas || $('ce-canvas');
      ce.ctx = ce.ctx || ce.canvas.getContext('2d');
      ce.ctx.clearRect(0, 0, ce.canvas.width, ce.canvas.height);
      var tip = $('ce-tip');
      if (tip) tip.textContent = '已新建空白造型，画好后点「保存到造型」上传';
      self.dirty = true;
      renderCostumeEditor();
      renderSpriteBar();
    });
    var newImport = $('btn-ce-new-paint');
    if (newImport) newImport.addEventListener('click', function () {
      ce._pendingImport = true;
      $('file-costume').click();
    });

    // —— 快捷键 ——
    document.addEventListener('keydown', function (e) {
      if (!ce) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault(); undoBtn && undoBtn.click();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' ||
                 (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault(); redoBtn && redoBtn.click();
      } else if (e.key === 'b' || e.key === 'B') { setTool('brush'); }
      else if (e.key === 'e' || e.key === 'E') { setTool('eraser'); }
      else if (e.key === 'f' || e.key === 'F') { setTool('fill'); }
      else if (e.key === 'v' || e.key === 'V') { setTool('select'); }
      else if (e.key === 'l' || e.key === 'L') { setTool('line'); }
      else if (e.key === 'r' || e.key === 'R') { setTool('rect'); }
      else if (e.key === 'o' || e.key === 'O') { setTool('ellipse'); }
    });

    // 暴露 pushHistory 供外部（比如 loadCostumeToCanvas 前调用）
    cePushHistory = pushHistory;
  }

  var cePushHistory = null;
  var ceFormat = 'png';       // 当前画布导出格式：png / jpg
  var ceJpgQuality = 0.72;    // JPG 质量
  var ceUpdateScreenFrame = null;  // 由 bindCostumeCanvas 注入
  var ceFitView = null;            // 由 bindCostumeCanvas 注入
  var ceClearSel = null;           // 由 bindCostumeCanvas 注入（清空选择工具选区）

  function renderCostumeEditor() {
    if (!ce) return;
    var owner = ceOwner();
    if (!owner) { closeCostumeEditor(); return; }
    var isBd = ce.kind === 'backdrop';

    // 更新画板标题下方的提示行
    var hint = $('ce-target-hint');
    if (hint) {
      if (isBd) {
        var bdItem = ceBackdropItem();
        hint.textContent = '背景 · 「' + ((bdItem && bdItem.name) || (owner.name || '背景')) + '」';
      } else {
        hint.textContent = '角色 · 「' + (owner.name || '') + '」';
      }
    }

    // 同步画布分辨率显示 + 屏幕预览框
    var cvEl = $('ce-canvas');
    if (cvEl) {
      var wi = $('ce-canvas-w'), hi = $('ce-canvas-h');
      if (wi) wi.value = String(cvEl.width);
      if (hi) hi.value = String(cvEl.height);
    }
    if (ceUpdateScreenFrame) ceUpdateScreenFrame();

    var box = $('ce-costumes');
    if (box) {
      box.innerHTML = '';      if (isBd) {
        owner.costumes.forEach(function (it, idx) {
          var chip = el('div', 'ce-costume-chip' + (idx === owner.index ? ' active' : ''));
          var url = costumeUrl(it.image);
          if (url) {
            var imB = document.createElement('img');
            imB.src = url;
            imB.alt = it.name;
            chip.appendChild(imB);
          } else {
            chip.appendChild(el('span', 'ce-cost-ph', '🖼'));
          }
          var delB = el('button', 'ce-chip-del', '×');
          delB.title = '删除这个背景';
          delB.addEventListener('click', function (e) {
            e.stopPropagation();
            removeBackdropCostume(idx);
          });
          chip.appendChild(delB);
          chip.title = it.name + '（双击可重命名）';
          chip.addEventListener('dblclick', function (e) {
            e.stopPropagation();
            var oldName = it.name;
            var name = (prompt('重命名背景造型：', oldName) || '').trim();
            if (!name || name === oldName) return;
            var dup = owner.costumes.some(function (x) { return x && x.name === name; });
            if (dup) { toast('已有同名背景造型：' + name); return; }
            it.name = name;
            renameBackdropRefs(oldName, name);
            self.dirty = true;
            renderCostumeEditor();
            renderSpriteBar();
            refresh(true);
            toast('背景造型已重命名为「' + name + '」');
          });
          chip.addEventListener('click', function (e) {
            if (e.target === delB) return;
            if (owner.index !== idx) {
              syncCurrentTarget();
              owner.index = idx;
              loadTargetIntoWorkspace('backdrop', -1, true, true);
            }
            ce.index = idx;
            ce.costume = it.image || '';
            self.dirty = true;
            renderCostumeEditor();
            renderSpriteBar();
            refresh(true);
          });
          box.appendChild(chip);
        });
      } else {
        var costumes = Array.isArray(owner.costumes) ? owner.costumes : [];
        if (!costumes.length) {
          box.appendChild(el('div', 'ce-cost-empty', '还没有造型，点「＋ 导入」或在画布上绘制'));
        }
        costumes.forEach(function (c, idx) {
          var chip = el('div', 'ce-costume-chip' + (c === ce.costume ? ' active' : ''));
          var url = costumeUrl(c);
          if (url) {
            var im = document.createElement('img');
            im.src = url;
            im.alt = costumeLabel(c);
            chip.appendChild(im);
          } else {
            chip.appendChild(el('span', 'ce-cost-ph', '🖼'));
          }
          var del = el('button', 'ce-chip-del', '×');
          del.title = '删除这个造型';
          del.addEventListener('click', function (e) {
            e.stopPropagation();
            removeCostume(owner, idx, c);
          });
          chip.appendChild(del);
          chip.title = costumeLabel(c);
          chip.addEventListener('dblclick', function (e) {
            e.stopPropagation();
            toast('角色造型名即图片文件名，暂不支持改名；可删除后重新导入');
          });
          chip.addEventListener('click', function (e) {
            if (e.target === del) return;
            ce.costume = c;
            owner.costume = c;
            self.dirty = true;
            renderCostumeEditor();
            renderSpriteBar();
            refresh();
          });
          box.appendChild(chip);
        });
      }
    }

    var tip = $('ce-tip');
    if (tip) {
      tip.textContent = isBd
        ? '画板工具：画笔/橡皮/填充/直线/矩形/椭圆/文字 · Ctrl+Z 撤销 · Ctrl+Y 重做。保存后替换当前背景。'
        : '画板工具：画笔/橡皮/填充/直线/矩形/椭圆/文字 · Ctrl+Z 撤销 · Ctrl+Y 重做。保存后添加到造型列表。';
    }

    var canvas = $('ce-canvas');
    if (canvas && canvas !== ce.canvas) {
      ce.canvas = canvas;
      ce.ctx = canvas.getContext('2d');
    }
    var current = isBd
      ? ((ceBackdropItem() && ceBackdropItem().image) || '')
      : pickCostume(ce.costume, owner.costumes);
    if (cePushHistory) cePushHistory();   // 载入图片前先记一笔
    loadCostumeToCanvas(current);
  }

  function loadCostumeToCanvas(costume) {
    if (!ce || !ce.canvas) return;
    if (ceClearSel) ceClearSel();
    var canvas = ce.canvas;
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var url = costumeUrl(costume);
    if (!url) return;
    var token = ++ce.loadToken;
    var img = new Image();
    img.onload = function () {
      if (!ce || token !== ce.loadToken) return;
      var sc = Math.min(w / img.width, h / img.height);
      var dw = Math.round(img.width * sc);
      var dh = Math.round(img.height * sc);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
    };
    img.src = url;
  }

  function removeCostume(sp, idx, costume) {
    if (!Array.isArray(sp.costumes)) return;
    sp.costumes.splice(idx, 1);
    if (sp.costume === costume) sp.costume = sp.costumes[0] || '';
    if (ce && ce.costume === costume) ce.costume = sp.costume;
    self.dirty = true;
    renderCostumeEditor();
    renderSpriteBar();
    refresh();
  }

  function removeBackdropCostume(idx) {
    var bd = ceOwner();
    if (!bd || !bd.costumes || !bd.costumes[idx]) return;
    if (bd.costumes.length <= 1) { toast('至少保留一个背景'); return; }
    // 先保存当前背景的积木
    syncCurrentTarget();
    bd.costumes.splice(idx, 1);
    if (bd.index >= bd.costumes.length) bd.index = bd.costumes.length - 1;
    else if (bd.index > idx) bd.index -= 1;
    // 工作区里还是被删背景的积木：换成新选中背景的积木（保持造型编辑面板打开）
    loadTargetIntoWorkspace('backdrop', -1, true, true);
    if (ce) {
      ce.index = bd.index;
      ce.costume = bd.costumes[bd.index].image || '';
    }
    self.dirty = true;
    renderCostumeEditor();
    renderSpriteBar();
    refresh(true);
  }

  function saveCanvasAsCostume() {
    if (!ce) return;
    var owner = ceOwner();
    if (!owner) return;
    var canvas = $('ce-canvas');
    if (!canvas || !canvas.toBlob) return;
    // 检查是否有空造型槽位（导入/绘制模式下的空槽位），有则填入当前槽位
    var hasEmptySlot = Array.isArray(owner.costumes) && owner.costumes.indexOf('') >= 0;
    var fmt = ceFormat === 'jpg' ? 'jpg' : 'png';
    var ext = fmt;

    function done(blob) {
      if (blob) uploadCostumeBlob(owner, blob, 'costume-' + Date.now() + '.' + ext, hasEmptySlot);
    }

    if (fmt === 'jpg') {
      // JPG 不支持透明：先合成到白底，再按质量压缩（画布小、质量适中 → 体积小）
      var src = document.createElement('canvas');
      src.width = canvas.width;
      src.height = canvas.height;
      var sc = src.getContext('2d');
      sc.fillStyle = '#ffffff';
      sc.fillRect(0, 0, src.width, src.height);
      sc.drawImage(canvas, 0, 0);
      src.toBlob(done, 'image/jpeg', Math.max(0.3, Math.min(1, ceJpgQuality || 0.72)));
    } else {
      canvas.toBlob(done, 'image/png');
    }
  }

  function uploadCostumeBlob(owner, blob, filename, asNewCostume) {
    var isBd = ce && ce.kind === 'backdrop';
    var bdIndex = ce ? ce.index : -1;
    var fd = new FormData();
    fd.append('file', blob, filename || 'costume.png');
    toast(isBd ? '正在保存背景…' : '正在保存造型…');
    fetch('/api/projects/' + encodeURIComponent(self.pid) + '/assets', {
      method: 'POST',
      body: fd
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok || !(data.assets || []).length) {
          toast(data.error || '保存失败');
          return;
        }
        var asset = data.assets[0];
        if (!self.assets.some(function (a) { return a.name === asset.name; })) self.assets.push(asset);
        if (isBd) {
          if (!owner.costumes) owner.costumes = [];
          if (asNewCostume) {
            // 导入：往当前背景槽位填图（槽位已存在）
            var itNew = owner.costumes[bdIndex];
            if (itNew) itNew.image = asset.name;
          } else {
            var it = owner.costumes[bdIndex];
            if (!it) { it = { name: '背景' + (owner.costumes.length + 1), image: '', xml: '' }; owner.costumes.push(it); }
            it.image = asset.name;
          }
          if (ce) ce.costume = asset.name;
          owner.costume = asset.name;
          toast('背景已保存');
        } else {
          if (!Array.isArray(owner.costumes)) owner.costumes = [];
          if (asNewCostume) {
            // 导入：填进当前空槽位（槽位已创建），替换第一个空字符串
            var fillIdx = owner.costumes.indexOf('');
            if (fillIdx >= 0) owner.costumes[fillIdx] = asset.name;
            owner.costume = asset.name;
            if (ce) ce.costume = asset.name;
          } else {
            owner.costumes.push(asset.name);
            owner.costume = asset.name;
            if (ce) ce.costume = asset.name;
          }
          toast('已保存为新造型');
        }
        self.dirty = true;
        if (ce) renderCostumeEditor();
        renderSpriteBar();
        refresh(true);
      })
      .catch(function () { toast('保存失败'); });
  }


  function setTab(name) {
    // 切换右侧面板标签时，顺便关闭画板栏（造型编辑器），避免布局冲突
    if (ce) closeCostumeEditor();
    else closeDrawer();
    ['preview', 'code', 'issue'].forEach(function (t) {
      $('tab-' + t).classList.toggle('active', t === name);
      // 代码是 <pre>，用 block 让它只占面板内区域（flex 会按内容撑宽）
      if (t === 'code') $('panel-' + t).style.display = (t === name) ? 'block' : 'none';
      else $('panel-' + t).style.display = (t === name) ? 'flex' : 'none';
    });
    if (name === 'preview') setTimeout(DBX_PREVIEW.resize, 30);
  }

  // ------------------------------------------------------------------ //
  // 初始化
  // ------------------------------------------------------------------ //
  function init() {
    var qs = new URLSearchParams(location.search);
    self.pid = qs.get('id');
    if (!self.pid) { location.href = '/'; return; }

    bindToolbar();

    try {
      DBX.defineBlocks();
    } catch (e) {
      console.error('积木定义失败:', e);
      showErrorPage('积木定义失败：' + e.message);
      return;
    }

    try {
      var injectOpts = {
        toolbox: DBX.toolbox,
        media: ((window.DBX_LOADER && DBX_LOADER.base) || '/static/vendor/blockly') + '/media/',
        renderer: 'duckbox',   // 自定义渲染器：圆顶帽子 + 窄连接槽（blocks.js 注册）
        trashcan: true,
        grid: { spacing: 26, length: 3,
          colour: (window.DBX_THEME && DBX_THEME.css ? DBX_THEME.css('dot', '#e8e0d0') : '#e8e0d0'),
          snap: true },
        zoom: { controls: true, wheel: true, startScale: 0.9, maxScale: 2, minScale: 0.4, scaleSpeed: 1.1 },
        move: { scrollbars: true, drag: true, wheelbars: true }
      };
      // Scratch 的配色主题（运动蓝 / 外观紫 / 事件黄 / 控制橙 / 侦测青 / 运算绿 / 变量橙 / 列表红）
      var theme = DBX.buildTheme ? DBX.buildTheme() : null;
      if (theme) injectOpts.theme = theme;
      self.workspace = Blockly.inject('blocklyDiv', injectOpts);
      // 注册「建立一个变量 / 建立一个列表」与变量、列表分类回调
      if (DBX.installToolbox) DBX.installToolbox(self.workspace);
      // 把「搜索积木」放进积木类型栏（分类列）的顶部
      try {
        var tbDiv = document.querySelector('.blocklyToolboxDiv');
        var searchEl = $('block-search');
        if (tbDiv && searchEl) {
          searchEl.classList.add('in-toolbox');
          tbDiv.insertBefore(searchEl, tbDiv.firstChild);
        }
      } catch (eTb) { /* ignore */ }
    } catch (e) {
      console.error('Blockly 工作区初始化失败:', e);
      showErrorPage('积木工作区初始化失败：' + e.message);
      return;
    }

    if (window.ResizeObserver) {
      new ResizeObserver(function () { Blockly.svgResize(self.workspace); })
        .observe($('blocklyDiv'));
    }

    // 数据框实时刷新：运行模式下变量 / 列表会不断变化，编辑模式下只显示初始值
    setInterval(function () {
      try { renderDataPanel(); } catch (e) { /* ignore */ }
    }, 500);

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(false); }
    });

    window.addEventListener('beforeunload', function () {
      if (self.dirty) { save(true); }
    });

    // 变更监听（节流；程序化载入时跳过）
    var timer = null;
    self.workspace.addChangeListener(function (ev) {
      if (self.restoring) return;
      if (!ev || ev.type === Blockly.Events.UI) return;
      // 积木下拉里 Blockly 自带的「删除变量「xxx」」也会删掉工作区的变量模型，
      // 但 self.gvars 是跨页面 / 角色的权威清单，只做并集、不会自动减项。
      // 不同步的话，切到别的角色时 applyGlobalsToWorkspace() 会把它重新建回来，
      // 表现为「删了列表，又冒出一个同名变量 / 列表」。
      // 载入目标时 workspace.clear() 同样会发 var_delete，靠 self.restoring 跳过。
      if (ev.type === (Blockly.Events.VAR_DELETE || 'var_delete') && ev.varName) {
        var delType = ev.varType || '';
        var nBefore = (self.gvars || []).length;
        self.gvars = (self.gvars || []).filter(function (g) {
          return !(g.name === ev.varName && (g.type || '') === delType);
        });
        if (self.gvars.length !== nBefore) self.dirty = true;
      }
      // 手动修改组件积木的位置/大小字段 → 同步到 block.data（供代码生成/预览）
      if (ev.type === Blockly.Events.CHANGE && ev.blockId && ev.name) {
        // 注意：Blockly CHANGE 事件的 ev.element 是 'field'/'input' 字符串而非积木对象，
        // 必须用 ev.blockId 到 workspace 里取真正的积木
        var eb = self.workspace.getBlockById(ev.blockId);
        if (!eb) return;
        var tn = eb.type;
        if ((tn === 'vela_text' || tn === 'vela_image' || tn === 'vela_button') &&
            (ev.name === 'X' || ev.name === 'Y' || ev.name === 'W' || ev.name === 'H' ||
             ev.name === 'WIDTH' || ev.name === 'HEIGHT')) {
          var gv = function (n, dflt) {
            var v = eb.getFieldValue(n);
            return (v == null || v === '') ? dflt : ((+v) || 0);
          };
          var L = (tn === 'vela_image')
            ? { x: gv('X', 0), y: gv('Y', 0), w: gv('WIDTH', 0), h: gv('HEIGHT', 0) }
            : { x: gv('X', 0), y: gv('Y', 0), w: gv('W', 0), h: gv('H', 0) };
          if (window.DBX && DBX.setLayout) DBX.setLayout(eb, L);
        }
      }
      clearTimeout(timer);
      timer = setTimeout(refresh, 180);
    });

    // 读取项目并初始化
    fetch('/api/projects/' + encodeURIComponent(self.pid))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { location.href = '/'; return; }
        self.project = data.meta || {};
        $('e-title').textContent = self.project.name || '未命名项目';
        $('pkg-display').value = self.project.package || 'com.duckbox.demo';
        // 顶栏显示项目自己的快应用图标（没自定义时后端回落到默认小鸭）
        var appIcon = $('app-icon-img');
        if (appIcon) {
          appIcon.src = '/api/projects/' + encodeURIComponent(self.pid) +
                        '/icon?t=' + Date.now();
        }
        try { if (typeof updateDeviceUI === 'function') updateDeviceUI(); } catch (eDU) { /* ignore */ }

        if (window.DBX_PREVIEW && $('pv-root')) {
          DBX_PREVIEW.mount($('pv-root'), {
            deviceType: self.project.deviceType || 'band10',
            designWidth: self.project.designWidth || 0,
            pages: [],
            assetBase: assetBase()
          });
        }

        // 页面来源优先级：新版多页面数据 > 旧版 vela_page 拆分 > 整包单页 > 默认
        var pages = null;
        if (data.pages && data.pages.length) {
          pages = data.pages.filter(function (p) { return p && p.name; });
        }
        if (!pages) pages = migrateOldXml(data.xml);
        if (!pages && data.xml && data.xml.trim()) {
          pages = [{ name: 'index', title: 'index', xml: data.xml }];
        }
        if (!pages) {
          pages = [{ name: 'index', title: 'index', xml: PAGE_DEFAULT_XML }];
        }
        self.pages = pages.map(function (p) {
          var pg = {
            name: sanitizePageName(p.name),
            title: p.title || p.name,
            xml: p.xml || '',
            sprites: Array.isArray(p.sprites) ? p.sprites : []
          };
          // 旧数据只有 page.xml：把它迁移成「背景」的积木
          pg.backdrop = (p.backdrop && typeof p.backdrop === 'object')
            ? p.backdrop
            : { xml: pg.xml, costumes: [{ name: '背景1', image: '' }], index: 0 };
          ensureBackdrop(pg);
          pg.sprites.forEach(function (sp) { if (typeof sp.xml !== 'string') sp.xml = ''; });
          return pg;
        });
        self.cur = 0;
        // 全局变量 / 列表：优先用项目里保存的清单，并与各页面 XML 里声明的变量取并集
        self.gvars = Array.isArray(data.globalVars) ? data.globalVars.slice() : [];
        try { collectGlobalsFromPages(); } catch (eGV) { console.warn('收集全局变量失败：', eGV); }
        try { loadPageIntoWorkspace(0); } catch (e) { console.error('载入首页失败:', e); }
        try { renderPageBar(); } catch (e) { console.error('渲染页面栏失败:', e); }

        try { setTab('preview'); } catch (e) { console.error('切换标签失败:', e); }
        loadAssets(function () {
          setTimeout(function () {
            try { refresh(); } catch (e) { console.error('刷新失败:', e); }
          }, 200);
        });
      })
      .catch(function (e) {
        // 打开项目出错时绝不留静默跳回首页（这就是“闪退”），改为就地提示
        console.error('加载项目失败:', e);
        try {
          showErrorPage('加载项目失败，请点左上角返回重试。\n' + (e && e.message ? e.message : String(e)));
        } catch (e2) {
          try {
            var b = $('blocklyDiv');
            if (b) b.innerHTML = '<div style="padding:24px;color:#c0392b">加载项目失败：' +
              (e && e.message ? (e.message) : String(e)) + '</div>';
          } catch (e3) { /* ignore */ }
        }
      });

    window.addEventListener('resize', function () {
      if (window.DBX_PREVIEW) DBX_PREVIEW.resize();
    });
  }

  function showErrorPage(message) {
    $('e-title').textContent = '加载出错';
    var box = $('blocklyDiv');
    if (box) {
      box.innerHTML = '<div style="padding:32px;font-family:sans-serif;line-height:1.8;color:#2b2340">' +
        '<h3>编辑器启动遇到问题</h3><p>' + String(message).replace(/</g, '&lt;') + '</p>' +
        '<p>请按 Ctrl+F5 强制刷新页面重试。</p></div>';
    }
  }

  function bindToolbar() {
    $('btn-back').addEventListener('click', function () { location.href = '/'; });
    $('btn-save').addEventListener('click', function () { save(false); });
    $('btn-export').addEventListener('click', exportProject);
    $('btn-export-data').addEventListener('click', exportProjectData);
    $('btn-build').addEventListener('click', buildProject);
    $('btn-add-page').addEventListener('click', addPage);

    // 预览下方：新建页面 / 页面抽屉 / 启动
    $('btn-new-page').addEventListener('click', addPage);
    $('pv-drawer-head').addEventListener('click', function () {
      $('pv-drawer').classList.toggle('collapsed');
    });
    $('pv-drawer-list').addEventListener('click', function (e) {
      var del = e.target.closest && e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        deletePage(Number(del.getAttribute('data-del')));
        return;
      }
      var item = e.target.closest && e.target.closest('.pv-drawer-item');
      if (item) switchToPage(Number(item.getAttribute('data-idx')));
    });
    $('btn-run').addEventListener('click', toggleRun);

    // 数据监视框：收起 / 展开（横向条，记住上次状态；展开后预览等组件自动上移）
    var pvData = $('pv-data');
    var pvDataBtn = $('btn-pv-data');
    if (pvData && pvDataBtn) {
      var stored = null;
      try { stored = localStorage.getItem('dbx.dataCollapsed'); } catch (e) { /* ignore */ }
      var setDataCollapsed = function (collapsed) {
        pvData.classList.toggle('collapsed', collapsed);
        pvDataBtn.title = collapsed ? '展开数据框' : '收起数据框';
        pvDataBtn.textContent = collapsed ? '▴' : '▾';
      };
      setDataCollapsed(stored === '1');
      pvDataBtn.addEventListener('click', function () {
        var collapsed = !pvData.classList.contains('collapsed');
        setDataCollapsed(collapsed);
        try { localStorage.setItem('dbx.dataCollapsed', collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
        // 数据框是 flex 子元素，展开/收起时父容器高度自动变化，
        // 触发预览区域 resize，使「启动」按钮、预览等组件跟着位移
        setTimeout(function () {
          if (window.DBX_PREVIEW && DBX_PREVIEW.resize) DBX_PREVIEW.resize();
        }, 280);
      });
    }

    // 预览大小：屏幕右侧竖向拉条（10% ~ 200%，100% 为默认大小）
    var zoomRange = $('pv-zoom-range');
    var zoomLabel = $('pv-zoom-label');
    if (zoomRange) {
      var applyZoom = function (v) {
        var pct = (window.DBX_PREVIEW && DBX_PREVIEW.setZoom)
          ? DBX_PREVIEW.setZoom(v) : Number(v);
        if (zoomLabel) zoomLabel.textContent = Math.round(pct) + '%';
      };
      zoomRange.addEventListener('input', function () { applyZoom(this.value); });
      applyZoom(zoomRange.value);
    }

    $('tab-preview').addEventListener('click', function () { setTab('preview'); });
    $('tab-code').addEventListener('click', function () { setTab('code'); });
    $('tab-issue').addEventListener('click', function () { setTab('issue'); });
    // 角色栏
    var spriteBar = $('sprite-bar');
    var spriteToggle = $('btn-sprite-toggle');

    // 角色 / 背景 标签
    Array.prototype.slice.call(document.querySelectorAll('.sprite-bar-tab')).forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchBarTab(tab.getAttribute('data-tab'));
      });
    });
    $('btn-sprite-add').addEventListener('click', function () {
      if (self.barTab === 'backdrop') newBackdrop();
      else newSprite();
    });
    var addTextBtn = $('btn-sprite-addtext');
    if (addTextBtn) addTextBtn.addEventListener('click', function () { newTextSprite(); });
    if (spriteBar && spriteToggle) {
      var storedSprite = null;
      try { storedSprite = localStorage.getItem('dbx.spriteCollapsed'); } catch (eS2) { /* ignore */ }
      var setSpriteCollapsed = function (collapsed) {
        spriteBar.classList.toggle('collapsed', collapsed);
        spriteToggle.title = collapsed ? '展开角色 / 背景栏' : '收起角色 / 背景栏';
        spriteToggle.textContent = collapsed ? '◂' : '▸';
      };
      setSpriteCollapsed(storedSprite === '1');
      spriteToggle.addEventListener('click', function () {
        var collapsed = !spriteBar.classList.contains('collapsed');
        setSpriteCollapsed(collapsed);
        try { localStorage.setItem('dbx.spriteCollapsed', collapsed ? '1' : '0'); } catch (eS3) { /* ignore */ }
        // 角色栏在编辑器底部：展开/收起后重新计算积木区与预览尺寸
        setTimeout(function () {
          try { Blockly.svgResize(self.workspace); } catch (e) { /* ignore */ }
          if (window.DBX_PREVIEW) DBX_PREVIEW.resize();
        }, 120);
      });
    }

    // —— 积木搜索：输入关键词 → 点击结果直接插入画布 ——
    (function bindBlockSearch() {
      var input = $('block-search-input');
      var box = $('block-search-results');
      if (!input || !box) return;
      var index = (window.DBX && DBX.searchIndex) ? DBX.searchIndex : [];
      function hide() { box.style.display = 'none'; box.innerHTML = ''; }
      function place() {
        var r = input.getBoundingClientRect();
        box.style.position = 'fixed';
        box.style.left = r.left + 'px';
        box.style.top = (r.bottom + 4) + 'px';
      }
      function insertBlock(type) {
        var ws = self.workspace;
        if (!ws) return;
        try { if (typeof closeDrawer === 'function') closeDrawer(); } catch (e0) { /* ignore */ }
        try {
          var b = ws.newBlock(type);
          b.initSvg();
          b.render();
          var m = ws.getMetrics();
          var x = m.viewLeft + m.viewWidth / 2 - 70;
          var y = m.viewTop + m.viewHeight / 2 - 40;
          b.moveBy(x, y);
          if (b.select) b.select();
          toast('已添加积木：' + type);
        } catch (e1) {
          toast('添加积木失败：' + e1.message);
        }
      }
      function render(q) {
        q = String(q || '').trim().toLowerCase();
        if (!q) { hide(); return; }
        var hits = index.filter(function (it) {
          return (it.text + ' ' + it.type + ' ' + it.cat + ' ' + it.tip).toLowerCase().indexOf(q) >= 0;
        }).slice(0, 40);
        box.innerHTML = '';
        if (!hits.length) {
          box.innerHTML = '<div class="toolbox-search-empty">没有找到相关积木</div>';
          place();
          box.style.display = 'block';
          return;
        }
        hits.forEach(function (it) {
          var row = document.createElement('div');
          row.className = 'toolbox-search-item';
          row.style.background = it.colour || '#5b6b8c';
          var txt = document.createElement('span');
          txt.className = 'bs-text';
          txt.textContent = it.text;
          var cat = document.createElement('span');
          cat.className = 'bs-cat';
          cat.textContent = it.cat;
          row.appendChild(txt);
          row.appendChild(cat);
          row.title = it.tip || it.text;
          row.addEventListener('mousedown', function (ev) {
            ev.preventDefault();
            insertBlock(it.type);
            input.value = '';
            hide();
          });
          box.appendChild(row);
        });
        place();
        box.style.display = 'block';
      }
      input.addEventListener('input', function () { render(input.value); });
      input.addEventListener('focus', function () { if (input.value.trim()) render(input.value); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { input.value = ''; hide(); input.blur(); }
      });
      document.addEventListener('mousedown', function (e) {
        var root = $('block-search');
        if (root && !root.contains(e.target)) hide();
      });
    })();

    // 预览旁：设备型号切换（可收起）
    var pvDeviceSelect = $('pv-device-select');
    var deviceLabels = {
      band9: '手环 9',
      band9pro: '手环 9 Pro',
      band10: '手环 10',
      band10pro: '手环 10 Pro'
    };
    var updateDeviceUI = function () {
      var dt = (self.project && self.project.deviceType) || 'band10';
      if (dt === 'watch') dt = 'band10'; // 已移除小米手表型号
      if (pvDeviceSelect) pvDeviceSelect.value = dt;
    };
    if (pvDeviceSelect) {
      updateDeviceUI();
      pvDeviceSelect.addEventListener('change', function () {
        var dt = pvDeviceSelect.value || 'band10';
        var scr = (window.DBX && DBX.deviceScreen) ? DBX.deviceScreen(dt) : null;
        if (!self.project) self.project = {};
        self.project.deviceType = dt;
        if (scr) self.project.designWidth = scr.w;
        updateDeviceUI();
        self.dirty = true;
        refresh(true);
        if (ceUpdateScreenFrame) ceUpdateScreenFrame();
        toast('已切换到 ' + (deviceLabels[dt] || dt) + (scr ? '（' + scr.w + '×' + scr.h + '）' : ''));
      });
    }

    // —— 预览网格（#）：网格 + 十字光标 + 坐标显示 ——
    var gridOn = false;
    var pvRootEl = $('pv-root');
    var gridLayer = $('pv-grid-overlay');
    var coordEl = $('pv-coord');
    var pvWrapEl = document.querySelector('.pv-screen-wrap');
    var gridBtn = $('pv-grid-toggle');
    function deviceScrNow() {
      var dt = (self.project && self.project.deviceType) || 'band10';
      return (window.DBX && DBX.deviceScreen) ? DBX.deviceScreen(dt) : { w: 212, h: 520 };
    }
    function gridTick() {
      if (!gridOn) return;
      var screen = pvRootEl ? pvRootEl.querySelector('.pv-screen') : null;
      if (screen && gridLayer && pvWrapEl) {
        var wr = pvWrapEl.getBoundingClientRect();
        var sr = screen.getBoundingClientRect();
        var scr = deviceScrNow();
        gridLayer.style.display = 'block';
        gridLayer.style.left = (sr.left - wr.left) + 'px';
        gridLayer.style.top = (sr.top - wr.top) + 'px';
        gridLayer.style.width = sr.width + 'px';
        gridLayer.style.height = sr.height + 'px';
        var cell = 40; // 每格 40 设备像素
        var sx = sr.width / Math.max(1, scr.w);
        var sy = sr.height / Math.max(1, scr.h);
        gridLayer.style.backgroundSize = (cell * sx) + 'px ' + (cell * sy) + 'px';
      }
      requestAnimationFrame(gridTick);
    }
    function setGrid(on) {
      gridOn = !!on;
      // 注意：preview.js 会重写 #pv-root 的 className，所以类挂在 wrap 上
      if (pvWrapEl) pvWrapEl.classList.toggle('show-grid', gridOn);
      if (gridBtn) gridBtn.classList.toggle('active', gridOn);
      if (!gridOn) {
        if (gridLayer) gridLayer.style.display = 'none';
        if (coordEl) coordEl.style.display = 'none';
      } else {
        requestAnimationFrame(gridTick);
      }
    }
    if (gridBtn) gridBtn.addEventListener('click', function () { setGrid(!gridOn); });
    if (pvRootEl) {
      pvRootEl.addEventListener('mousemove', function (e) {
        if (!gridOn || !coordEl || !pvWrapEl) return;
        var screen = pvRootEl.querySelector('.pv-screen');
        if (!screen) { coordEl.style.display = 'none'; return; }
        var sr = screen.getBoundingClientRect();
        if (e.clientX < sr.left || e.clientX > sr.right || e.clientY < sr.top || e.clientY > sr.bottom) {
          coordEl.style.display = 'none';
          return;
        }
        var scr = deviceScrNow();
        // 坐标原点 = 屏幕中心（与积木 / 生成代码一致）：左上角是 (-宽/2, -高/2)
        var x = Math.round((e.clientX - sr.left) / Math.max(1, sr.width) * scr.w - scr.w / 2);
        var y = Math.round((e.clientY - sr.top) / Math.max(1, sr.height) * scr.h - scr.h / 2);
        var wr = pvWrapEl.getBoundingClientRect();
        coordEl.style.display = 'block';
        coordEl.textContent = 'X ' + x + ' · Y ' + y;
        coordEl.style.left = Math.max(4, e.clientX - wr.left + 14) + 'px';
        coordEl.style.top = Math.max(4, e.clientY - wr.top + 12) + 'px';
      });
      pvRootEl.addEventListener('mouseleave', function () {
        if (coordEl) coordEl.style.display = 'none';
      });
    }

    // 画板栏开关按钮
    var drawerBtn = $('btn-drawer');
    if (drawerBtn) drawerBtn.addEventListener('click', toggleDrawer);
    var drawerClose = $('btn-drawer-close');
    if (drawerClose) drawerClose.addEventListener('click', function () {
      if (ce) closeCostumeEditor();
      else closeDrawer();
    });
    // Ctrl+Shift+D 切换画板
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        toggleDrawer();
      }
    });

    // 造型编辑器：保存按钮还需要绑定（clear/upload 已经在 bindCostumeCanvas 里绑定）
    $('btn-ce-save').addEventListener('click', saveCanvasAsCostume);
    $('file-costume').addEventListener('change', function () {
      var f = this.files && this.files[0];
      var pending = ce && ce._pendingImport;
      if (ce) ce._pendingImport = false;
      this.value = '';
      if (!f || !ce) return;
      var owner = ceOwner();
      if (!owner) return;
      if (pending) {
        // 「＋ 导入」：先创建一个新造型槽位，上传完成后直接填入
        var isBd = ce.kind === 'backdrop';
        var placeholder = isBd ? { name: '造型' + (owner.costumes.length + 1), image: '', xml: '' } : '';
        if (isBd) {
          owner.costumes.push(placeholder);
          owner.index = owner.costumes.length - 1;
          ce.index = owner.index;
          ce.costume = '';
        } else {
          owner.costumes.push(placeholder);
          owner.costume = '';
          ce.costume = '';
        }
        uploadCostumeBlob(owner, f, f.name, true);
      } else {
        uploadCostumeBlob(owner, f, f.name);
      }
    });

    $('btn-undo').addEventListener('click', function () { self.workspace.undo(false); });
    $('btn-redo').addEventListener('click', function () { self.workspace.undo(true); });
    $('btn-tidy').addEventListener('click', function () {
      self.workspace.cleanUp();
      toast('积木已整理');
    });

    var togglePanel = function () {
      self.panelOpen = !self.panelOpen;
      var body = document.querySelector('.editor-body');
      body.classList.toggle('panel-hidden', !self.panelOpen);
      // 收起 / 展开共用同一个按钮，只切换箭头与横向位置，垂直位置保持不变
      var btnPanel = $('btn-panel');
      if (btnPanel) {
        btnPanel.textContent = self.panelOpen ? '\u25c0' : '\u25b6';
        btnPanel.title = self.panelOpen ? '收起面板（可上下拖动调整位置）' : '展开面板（可上下拖动调整位置）';
      }
      var hide = $('btn-panel-hide');
      if (hide) {
        hide.textContent = self.panelOpen ? '\u2039' : '\u203a';
        hide.title = self.panelOpen ? '收起面板' : '展开面板';
      }
      setTimeout(function () {
        Blockly.svgResize(self.workspace);
        if (window.DBX_PREVIEW) DBX_PREVIEW.resize();
      }, 260);
    };
    $('btn-panel').addEventListener('click', togglePanel);
    $('btn-panel-hide').addEventListener('click', togglePanel);
    var panelToggleBtn = $('btn-panel-toggle');
    if (panelToggleBtn) panelToggleBtn.addEventListener('click', togglePanel);

    // 上下拖动调整收起/展开按钮位置：收起前后是同一个按钮，位置只记一个 key
    var makeVerticalDraggable = function (btn) {
      if (!btn) return;
      var startY = 0, startTop = 0, dragging = false;
      var storageKey = 'dbx.panelBtnTopPct';
      btn.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        var rect = btn.getBoundingClientRect();
        var bodyRect = btn.parentElement.getBoundingClientRect();
        startY = e.clientY;
        startTop = rect.top - bodyRect.top;
        dragging = true;
        btn.classList.add('dragging');
        e.preventDefault();
      });
      document.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        var dy = e.clientY - startY;
        var bodyRect = btn.parentElement.getBoundingClientRect();
        var btnH = btn.offsetHeight;
        var newTop = Math.max(-btnH / 2, Math.min(bodyRect.height - btnH / 2, startTop + dy));
        btn.style.top = newTop + 'px';
        btn.style.transform = 'none';
        try {
          var pct = (newTop + btnH / 2) / bodyRect.height * 100;
          localStorage.setItem(storageKey, String(Math.round(pct * 10) / 10));
        } catch (err) { /* ignore */ }
      });
      document.addEventListener('mouseup', function () {
        if (!dragging) return;
        dragging = false;
        btn.classList.remove('dragging');
      });
      try {
        var saved = localStorage.getItem(storageKey);
        if (saved && !isNaN(parseFloat(saved))) {
          var bodyRect2 = btn.parentElement.getBoundingClientRect();
          var topPx = parseFloat(saved) / 100 * bodyRect2.height - btn.offsetHeight / 2;
          btn.style.top = Math.max(0, topPx) + 'px';
          btn.style.transform = 'none';
        }
      } catch (err) { /* ignore */ }
    };
    makeVerticalDraggable($('btn-panel'));
    $('tpl-select').addEventListener('change', function () {
      var key = this.value;
      this.value = '';
      if (!key) return;
      var tpl = DBX.templates[key];
      if (!tpl || !tpl.pages) return;
      if (self.pages.length &&
          !confirm('载入示例会替换现有的全部页面与积木，确定继续吗？')) return;
      self.pages = tpl.pages.map(function (p) {
        var pg = {
          name: sanitizePageName(p.name),
          title: p.title || p.name,
          xml: p.xml || '',
          sprites: Array.isArray(p.sprites) ? p.sprites : []
        };
        pg.backdrop = (p.backdrop && typeof p.backdrop === 'object')
          ? p.backdrop
          : { xml: pg.xml, costumes: [{ name: '背景1', image: '' }], index: 0 };
        ensureBackdrop(pg);
        pg.sprites.forEach(function (sp) { if (typeof sp.xml !== 'string') sp.xml = ''; });
        return pg;
      });
      self.cur = 0;
      // 先上传模板自带资产，等图片下拉选项就绪后再加载积木，
      // 否则 XML 里的 /assets/wx.png 会被下拉框当成非法值回退成默认图
      var loadIt = function () {
        loadPageIntoWorkspace(0, true);
        renderPageBar();
        refresh(true);
        toast('示例「' + tpl.name + '」已载入，试试点击右侧屏幕');
      };
      if (tpl.assets && tpl.assets.length) {
        uploadTemplateAssets(tpl.assets, loadIt);
      } else {
        loadIt();
      }
    });

    $('pkg-display').addEventListener('change', function () { refresh(); });
  }

  // 供「应用信息」弹窗调用。改应用名必须走 save() 的完整 payload，
  // 单独 POST /api/projects/<pid> 会把 xml / files / pages 覆盖成空。
  return {
    init: init,
    save: save,
    toast: toast,
    getAppInfo: function () {
      return {
        pid: self.pid,
        appName: (self.project && self.project.appName) || 'DuckBox'
      };
    },
    setAppName: function (name, cb) {
      if (!self.project) self.project = {};
      self.project.appName = String(name).slice(0, 6);
      save(true, cb);
    }
  };
})();
