// Duck Box —— Blockly 加载器（完全本地化，无需联网）
window.DBX_LOADER = (function () {
  'use strict';

  // 优先使用本地vendor，如果失败才尝试CDN（但国内环境通常CDN不稳定）
  var CDNS = [
    '/static/vendor/blockly',  // 本地资源，最高优先级
    'https://cdn.jsdelivr.net/npm/blockly@9.3.3',
    'https://gitee.com/mirrors/blockly/raw/master/',
    'https://registry.npmmirror.com/blockly/9.3.3/files',
    'https://unpkg.com/blockly@9.3.3'
  ];

  var coreFiles = [
    '/blockly_compressed.js',
    '/blocks_compressed.js',
    '/javascript_compressed.js',
    '/msg/zh-hans.js'
  ];
  
  // 检测网络连接状态
  function isOnline() {
    return navigator.onLine;
  }

  function load(path, checkGlobal) {
    return new Promise(function (resolve, reject) {
      var i = 0;
      function attempt() {
        if (i >= CDNS.length) {
          reject(new Error('所有加载源都已尝试失败，无法加载资源：' + path));
          return;
        }
        var base = CDNS[i++];
        var isLocal = base === '/static/vendor/blockly';
        var s = document.createElement('script');
        s.src = base + path;
        s.async = false;
        
        // 添加更详细的错误信息
        s.onload = function () {
          if (checkGlobal && typeof window[checkGlobal] === 'undefined') {
            console.warn('资源加载成功但全局变量缺失:', checkGlobal, '从', base);
            s.remove();
            attempt();
            return;
          }
          if (!DBX_LOADER.base || DBX_LOADER.base.indexOf('/vendor/') === 0) {
            DBX_LOADER.base = base;
            console.log('成功加载Blockly从:', base);
          }
          resolve();
        };
        
        s.onerror = function () {
          console.error('加载失败:', base + path, '尝试下一个源...');
          s.remove();
          attempt();
        };
        
        document.head.appendChild(s);
      }
      attempt();
    });
  }

  function loadLocal(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('加载失败：' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadAll() {
    return coreFiles.reduce(function (p, f, idx) {
      var check = (idx === 0) ? 'Blockly' : null;
      return p.then(function () { return load(f, check); });
    }, Promise.resolve());
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var booting = false;
  var booted = false;

  function boot() {
    if (booted || booting) {
      console.log('⏭️ Duck Box 已在启动中/启动完成，跳过重复启动');
      return;
    }
    booting = true;

    console.log('🦆 Duck Box 启动中...');
    console.log('本地vendor目录:', CDNS[0]);
    console.log('网络状态:', isOnline() ? '在线' : '离线');

    // 先尝试加载本地资源，无需网络检查
    console.log('📦 开始加载 Blockly 核心文件...');
    loadAll()
      .then(function () {
        console.log('✅ Blockly核心文件加载完成');
        return loadLocal('/static/js/blocks.js?v=52');
      })
      .then(function () {
        console.log('✅ blocks.js加载完成');
        return loadLocal('/static/js/preview.js?v=38');
      })
      .then(function () {
        console.log('✅ preview.js加载完成');
        return loadLocal('/static/js/editor.js?v=61');
      })
      .then(function () {
        console.log('✅ editor.js加载完成');
        console.log('🔍 检查 DBX_EDITOR...');

        return new Promise(function (resolve) {
          setTimeout(function () {
            if (window.DBX_EDITOR && typeof DBX_EDITOR.init === 'function') {
              console.log('🚀 初始化编辑器...');
              try {
                DBX_EDITOR.init();
                booted = true;
              } catch (e) {
                console.error('❌ 编辑器初始化异常:', e);
                throw e;
              }
              resolve();
            } else {
              console.error('❌ DBX_EDITOR 未就绪:', typeof window.DBX_EDITOR, window.DBX_EDITOR);
              throw new Error('编辑器脚本未就绪：DBX_EDITOR.init不存在');
            }
          }, 200);
        });
      })
      .then(function () {
        console.log('🎉 Duck Box 编辑器启动成功！');
      })
      .catch(function (e) {
        console.error('❌ 加载失败:', e);
        booting = false;
        var errorMsg = e.message || String(e);
        
        // 更详细的错误分析和建议
        var suggestions = '';
        if (errorMsg.includes('Failed to fetch') || errorMsg.includes('无法加载资源')) {
          suggestions = '<p>🔍 <strong>可能的原因和解决方案：</strong></p>' +
                       '<ul><li><strong>本地服务器问题：</strong>请确保Duck Box应用已正确启动</li>' +
                       '<li><strong>文件路径错误：</strong>检查static目录结构是否完整</li>' +
                       '<li><strong>网络问题：</strong>如果是首次使用，请确保网络连接正常</li>' +
                       '<li><strong>浏览器缓存：</strong>尝试清除浏览器缓存并重试</li></ul>';
        } else if (errorMsg.includes('编辑器脚本未就绪')) {
          suggestions = '<p>🔍 <strong>可能的原因：</strong></p>' +
                       '<ul><li>editor.js文件可能损坏或缺失</li>' +
                       '<li>blocks.js文件可能有问题</li>' +
                       '<li>请尝试重启应用</li>' +
                       '<li><strong>调试信息：</strong></p>' +
                       '<ul><li>DBX_EDITOR类型: ' + typeof window.DBX_EDITOR + '</li>' +
                       '<li>DBX_EDITOR.init: ' + (typeof window.DBX_EDITOR === 'object' ? typeof window.DBX_EDITOR.init : 'N/A') + '</li></ul></li></ul>';
        }
        
        document.body.innerHTML =
          '<div style="padding:48px;font-family:sans-serif;line-height:1.8;color:#2b2340">' +
          '<h2>🦆 Duck Box 加载失败</h2>' +
          '<p><strong>错误详情：</strong> ' + escapeHtml(errorMsg) + '</p>' +
          suggestions +
          '<p><strong>快速排查步骤：</strong></p>' +
          '<ol><li>重启应用并重试（最常见解决方案）</li>' +
          '<li>检查浏览器控制台是否有其他错误信息</li>' +
          '<li>如果使用的是本地开发服务器，确保端口配置正确</li>' +
          '<li>尝试使用不同的浏览器</li>' +
          '<li><strong>当前页面：</strong> ' + window.location.href + '</li></ol>' +
          '</div>';
      });
  }

  return { CDNS: CDNS, base: null, load: load, loadAll: loadAll, boot: boot };
})();
