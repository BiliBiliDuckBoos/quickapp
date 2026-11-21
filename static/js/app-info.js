// Duck Box 桌面版 —— 项目内「应用信息」：修改快应用名称与图标
// 与设置弹窗共用 theme.css 里的 .dbx-set-* 朴素桌面风格。
// 图标统一由前端 Canvas 处理成 PNG，长边不超过 128，后端再做一次尺寸校验。
(function () {
  'use strict';

  var MAX = 128;
  var pid = '';
  try {
    var m = /(?:^|[?&])id=([^&]*)/.exec(window.location.search || '');
    pid = m ? decodeURIComponent(m[1]) : '';
  } catch (e) { /* 忽略畸形 id */ }

  var mask = null;
  var nameInput = null;
  var preview = null;
  var sizeText = null;
  var errText = null;
  var fileInput = null;
  var currentName = '';
  var pendingImage = null;   // 待保存的 PNG dataURL
  var pendingReset = false;  // 是否恢复默认图标
  var busy = false;

  function bridge() { return window.DBX_EDITOR || null; }
  function iconUrl() {
    return '/api/projects/' + encodeURIComponent(pid) + '/icon?t=' + Date.now();
  }
  function toast(msg) {
    var b = bridge();
    if (b && typeof b.toast === 'function') b.toast(msg);
  }
  function showError(msg) {
    if (!errText) return;
    errText.textContent = msg || '';
    errText.hidden = !msg;
  }
  function setBusy(on) {
    busy = !!on;
    var btn = mask && mask.querySelector('[data-act="save"]');
    if (btn) { btn.disabled = busy; btn.textContent = busy ? '保存中…' : '保存'; }
  }

  function buildDialog() {
    var el = document.createElement('div');
    el.className = 'dbx-set-mask';
    el.id = 'dbx-app-mask';
    el.hidden = true;
    el.innerHTML =
      '<div class="dbx-set-dlg" role="dialog" aria-modal="true" aria-label="应用信息">' +
        '<div class="dbx-set-head">' +
          '<span class="dbx-set-title">应用信息</span>' +
          '<button type="button" class="dbx-set-x" data-act="close" aria-label="关闭">&times;</button>' +
        '</div>' +
        '<div class="dbx-set-body">' +
          '<div class="dbx-set-label">应用名称</div>' +
          '<input type="text" class="dbx-app-name" id="dbx-app-name" maxlength="6" ' +
                 'spellcheck="false" autocomplete="off" placeholder="例如：小鸭子">' +
          '<p class="dbx-set-note dbx-app-hint">显示在手环桌面图标下，最多 6 个字；' +
             '保存后写入 <code>manifest.name</code>。</p>' +

          '<div class="dbx-set-label dbx-set-label-2">应用图标</div>' +
          '<div class="dbx-app-iconrow">' +
            '<div class="dbx-app-preview"><img id="dbx-app-preview" alt="应用图标预览"></div>' +
            '<div class="dbx-app-side">' +
              '<button type="button" class="dbx-btn" id="dbx-app-pick">选择图片…</button>' +
              '<button type="button" class="dbx-btn" id="dbx-app-reset">恢复默认</button>' +
              '<div class="dbx-app-size" id="dbx-app-size"></div>' +
            '</div>' +
          '</div>' +
          '<input type="file" id="dbx-app-file" accept="image/*" hidden>' +
          '<p class="dbx-set-note dbx-app-hint">PNG / JPG / GIF 等均可，自动等比缩放到 ' +
             MAX + '×' + MAX + ' 及以内；构建 RPK 时写入 ' +
             '<code>src/common/logo.png</code>。</p>' +
          '<p class="dbx-app-error" id="dbx-app-error" hidden></p>' +
        '</div>' +
        '<div class="dbx-set-foot">' +
          '<button type="button" class="dbx-btn" data-act="close">取消</button>' +
          '<button type="button" class="dbx-btn dbx-btn-primary" data-act="save">保存</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    mask = el;
    nameInput = el.querySelector('#dbx-app-name');
    preview = el.querySelector('#dbx-app-preview');
    sizeText = el.querySelector('#dbx-app-size');
    errText = el.querySelector('#dbx-app-error');
    fileInput = el.querySelector('#dbx-app-file');

    el.addEventListener('click', function (e) {
      if (e.target === el) { close(); return; }
      var node = e.target;
      while (node && node !== el && (!node.getAttribute || !node.getAttribute('data-act'))) {
        node = node.parentNode;
      }
      var act = node && node.getAttribute ? node.getAttribute('data-act') : null;
      if (act === 'close') close();
      else if (act === 'save') save();
    });
    el.querySelector('#dbx-app-pick').addEventListener('click', function () {
      if (!busy) fileInput.click();
    });
    el.querySelector('#dbx-app-reset').addEventListener('click', function () {
      if (busy) return;
      pendingImage = null;
      pendingReset = true;
      preview.src = '/static/img/logo.png?t=' + Date.now();
      sizeText.textContent = '默认图标 128×128';
      showError('');
    });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (f) processImage(f);
    });
  }

  // 读取图片 → 等比缩放到 128 以内 → 输出 PNG dataURL（不改原图比例、不放大）
  function processImage(file) {
    if (!/^image\//.test(file.type || '')) { showError('请选择图片文件'); return; }
    var reader = new FileReader();
    reader.onerror = function () { showError('图片读取失败'); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { showError('这个图片格式无法读取'); };
      img.onload = function () {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) { showError('图片尺寸无效'); return; }
        var scale = Math.min(1, MAX / Math.max(w, h));
        var nw = Math.max(1, Math.round(w * scale));
        var nh = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement('canvas');
        canvas.width = nw; canvas.height = nh;
        var ctx = canvas.getContext('2d');
        if (!ctx) { showError('浏览器不支持图片处理'); return; }
        ctx.drawImage(img, 0, 0, nw, nh);
        var data;
        try { data = canvas.toDataURL('image/png'); }
        catch (e) { showError('图片转换失败：' + e.message); return; }
        pendingImage = data;
        pendingReset = false;
        preview.src = data;
        sizeText.textContent = (w === nw && h === nh)
          ? ('当前 ' + nw + '×' + nh)
          : ('原图 ' + w + '×' + h + ' → 保存为 ' + nw + '×' + nh);
        showError('');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function uploadIcon(body) {
    return fetch('/api/projects/' + encodeURIComponent(pid) + '/icon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || '图标保存失败');
        return data;
      });
  }

  function refreshTopbarIcon() {
    var img = document.getElementById('app-icon-img');
    if (img) img.src = iconUrl();
  }

  function finish() {
    setBusy(false);
    pendingImage = null;
    pendingReset = false;
    refreshTopbarIcon();
    toast('应用信息已保存');
    close();
  }

  function save() {
    if (busy) return;
    var b = bridge();
    if (!b || typeof b.setAppName !== 'function' || typeof b.getAppInfo !== 'function') {
      showError('编辑器尚未就绪，请稍后再试');
      return;
    }
    var name = (nameInput.value || '').trim().slice(0, 6);
    if (!name) { showError('应用名称不能为空'); return; }
    showError('');
    setBusy(true);

    var iconJob;
    if (pendingReset) iconJob = uploadIcon({ reset: true });
    else if (pendingImage) iconJob = uploadIcon({ image: pendingImage });
    else iconJob = Promise.resolve(null);

    iconJob.then(function () {
      if (name === currentName) { finish(); return; }
      // 走编辑器完整保存：只 POST appName 会把积木 / 源码覆盖掉
      b.setAppName(name, function (ok) {
        if (!ok) { setBusy(false); showError('应用名称保存失败，请重试'); return; }
        currentName = name;
        finish();
      });
    }).catch(function (e) {
      setBusy(false);
      showError(e && e.message ? e.message : '保存失败');
    });
  }

  function open() {
    if (!mask) buildDialog();
    var b = bridge();
    currentName = (b && typeof b.getAppInfo === 'function')
      ? String(b.getAppInfo().appName || 'DuckBox') : 'DuckBox';
    nameInput.value = currentName;
    pendingImage = null;
    pendingReset = false;
    showError('');
    setBusy(false);
    sizeText.textContent = '当前图标 ' + MAX + '×' + MAX + ' 及以内';
    preview.onload = function () {
      if (pendingImage || pendingReset) return;
      sizeText.textContent = '当前图标 ' +
        (preview.naturalWidth || MAX) + '×' + (preview.naturalHeight || MAX);
    };
    preview.src = iconUrl();
    mask.hidden = false;
    nameInput.focus();
    nameInput.select();
  }

  function close() {
    if (mask) mask.hidden = true;
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && mask && !mask.hidden && !busy) close();
  });

  function ready() {
    var btn = document.getElementById('btn-app-info');
    if (btn) btn.addEventListener('click', open);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();

  window.DBX_APP_INFO = { open: open, close: close, pid: pid, max: MAX };
})();
