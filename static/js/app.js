// Duck Box 主菜单逻辑
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  function fmtTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function deviceLabel(p) {
    return p.deviceType === 'watch' ? '圆屏' : '方屏';
  }

  function loadProjects() {
    fetch('/api/projects')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var wrap = $('projects');
        var list = data.projects || [];
        if (!list.length) {
          wrap.innerHTML = '<div class="empty">还没有项目，点击「新建项目」开始创作吧！</div>';
          return;
        }
        wrap.innerHTML = list.map(function (p) {
          return '<div class="project-card" data-id="' + esc(p.id) + '">' +
            '<button class="p-del" title="删除" data-del="' + esc(p.id) + '">&times;</button>' +
            '<div class="p-head">' +
              '<img class="p-icon" alt="" src="/api/projects/' + encodeURIComponent(p.id) +
                '/icon?t=' + esc(p.updatedAt || 0) + '">' +
              '<div class="p-head-txt">' +
                '<div class="p-name">' + esc(p.name) + '</div>' +
                '<div class="p-appname">应用名：' + esc(p.appName || 'DuckBox') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="p-meta">' +
              '<span class="p-chip">' + esc(deviceLabel(p)) + '</span>' +
              '<span class="p-chip">w' + esc(p.designWidth || 480) + '</span>' +
            '</div>' +
            '<div class="p-time">更新于 ' + esc(fmtTime(p.updatedAt)) + '</div>' +
            '<div class="p-preview">' + esc(p.preview || '') + '</div>' +
          '</div>';
        }).join('');

        wrap.querySelectorAll('.project-card').forEach(function (card) {
          card.addEventListener('click', function (e) {
            if (e.target.getAttribute('data-del')) return;
            location.href = '/editor?id=' + encodeURIComponent(card.getAttribute('data-id'));
          });
        });
        wrap.querySelectorAll('[data-del]').forEach(function (b) {
          b.addEventListener('click', function (e) {
            e.stopPropagation();
            deleteProject(b.getAttribute('data-del'));
          });
        });
      })
      .catch(function () { toast('加载项目列表失败'); });
  }

  function deleteProject(pid) {
    if (!confirm('确定删除该项目吗？此操作不可恢复。')) return;
    fetch('/api/projects/' + encodeURIComponent(pid), { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function () { loadProjects(); toast('已删除'); })
      .catch(function () { toast('删除失败'); });
  }

  // 弹窗动画：开 → 淡入 + pop-in；关 → pop-out 后再隐藏
  function showMask(m) {
    m.classList.remove('closing');
    m.style.display = 'flex';
    // 强制回流，确保从 display:none 切换后淡入过渡能正常触发
    void m.offsetWidth;
    m.classList.add('open');
  }
  function hideMask(m) {
    if (m.style.display === 'none') return;
    m.classList.remove('open');
    m.classList.add('closing');
    clearTimeout(m._closeTimer);
    m._closeTimer = setTimeout(function () {
      m.style.display = 'none';
      m.classList.remove('closing');
    }, 170);
  }

  function openModal() {
    showMask($('modal'));
    setTimeout(function () { $('f-name').focus(); }, 120);
  }

  function closeModal() {
    hideMask($('modal'));
  }

  function createProject() {
    var name = $('f-name').value.trim();
    var pkg = $('f-package').value.trim() || 'com.duckbox.demo';
    var appName = $('f-appname').value.trim() || '小鸭子';
    // 设备型号改为创建后在编辑器里切换，这里用默认值
    var deviceType = 'band10';
    var designWidth = 212;
    if (!name) { toast('请先给项目起个名字吧'); return; }
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name, package: pkg, appName: appName,
        deviceType: deviceType, designWidth: Number(designWidth)
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.project) {
          location.href = '/editor?id=' + encodeURIComponent(data.project.id);
        } else {
          toast('创建失败');
        }
      })
      .catch(function () { toast('创建失败'); });
  }

  function importProject(file) {
    if (!file) return;
    toast('正在导入项目…');
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        toast('文件解析失败：不是有效的 JSON');
        return;
      }
      fetch('/api/projects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.project) {
            toast('导入成功，正在打开…');
            setTimeout(function () {
              location.href = '/editor?id=' + encodeURIComponent(res.project.id);
            }, 600);
          } else {
            toast(res.error || '导入失败');
          }
        })
        .catch(function () { toast('导入失败'); });
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file);
  }

  $('btn-new').addEventListener('click', openModal);
  $('btn-cancel').addEventListener('click', closeModal);
  $('btn-create').addEventListener('click', createProject);
  $('btn-import').addEventListener('click', function () { $('file-import').click(); });
  $('file-import').addEventListener('change', function () {
    importProject(this.files[0]);
    this.value = '';
  });
  $('btn-doc').addEventListener('click', function () {
    window.open('https://iot.mi.com/vela/quickapp/zh/guide/', '_blank');
  });
  $('btn-tip').addEventListener('click', function () {
    showMask($('tip-modal'));
  });
  var closeTip = function () { hideMask($('tip-modal')); };
  $('btn-tip-close').addEventListener('click', closeTip);
  $('tip-modal').addEventListener('click', function (e) {
    if (e.target === $('tip-modal')) closeTip();
  });
  $('modal').addEventListener('click', function (e) {
    if (e.target === $('modal')) closeModal();
  });

  loadProjects();
})();
