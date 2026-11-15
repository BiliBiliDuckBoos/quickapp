// Duck Box —— 积木定义 + 小米 Vela 快应用代码生成 + 校验
// 依赖：Blockly 已加载
// 页面由编辑器「页面栏」管理，每个页面独立的积木 XML；
// generateProject(pages) 用 headless workspace 逐页生成源码。

// ------------------------------------------------------------------ //
// 自定义渲染器 duckbox：基于 zelos 风格，实现
//   1. 帽子积木顶部圆顶（拱起弧线，左边缘拱起再落回）
//   2. 事件类积木的 statement 连接槽改到下方（C 嘴在下，垂直堆叠）
//   3. 连接槽窄化，帽子宽度适中
//   4. 积木文本颜色自动取底色反色，避免浅色积木看不清文字
// ------------------------------------------------------------------ //
(function registerDuckRenderer() {
  if (!window.Blockly || !Blockly.blockRendering || !Blockly.blockRendering.register) return;

  // 通过注册表找到 zelos 的 Renderer / Drawer 类（压缩后 Blockly.zelos 不可见）
function findZelos() {
  var Renderer = null, Drawer = null;
  try {
    if (window.Blockly && window.Blockly.zelos && window.Blockly.zelos.Renderer) {
      Renderer = window.Blockly.zelos.Renderer;
      if (Renderer.Drawer) Drawer = Renderer.Drawer;
    }
    if (!Renderer) {
      Renderer = Blockly.registry.getItem('renderer', 'zelos');
      if (Renderer && Renderer.Drawer) Drawer = Renderer.Drawer;
    }
  } catch (e) {
    console.warn('Failed to find zelos renderer:', e);
  }
  return { Renderer: Renderer, Drawer: Drawer };
}

  var zelos = findZelos();
  var Base = zelos.Renderer;
  if (!Base) return;

  // 圆顶帽子：c 曲线控制点在 18%/82%，形成明显拱起的圆顶
  var HAT_W = 80, HAT_H = 16;
  function domePath(w, h) {
    return ' c ' + (w * 0.18) + ',' + (-h) + ' ' + (w * 0.82) + ',' + (-h) + ' ' + w + ',0 ';
  }

  // 判定积木是否为「事件」类（C 嘴需要画在下方）
  function isEventBlock(block) {
    if (!block || !block.type) return false;
    return block.type.indexOf('vela_on') === 0 ||
           block.type === 'vela_broadcast_recv' ||
           block.type === 'vela_broadcast_send' ||
           block.type === 'sc_when_clone_start';
  }

  class DuckRenderer extends Base {
    constructor(name) {
      super(name || 'duckbox');
    }
    makeConstants_() {
      var c = super.makeConstants_();
      // 窄化连接槽
      c.NOTCH_WIDTH = 6;
      // 帽子尺寸
      c.START_HAT_WIDTH = HAT_W;
      c.START_HAT_HEIGHT = HAT_H;
      // 自定义帽子路径
      c.makeStartHat = function () {
        return {
          height: this.START_HAT_HEIGHT,
          width: this.START_HAT_WIDTH,
          path: domePath(this.START_HAT_WIDTH, this.START_HAT_HEIGHT)
        };
      };
      return c;
    }
    makeHighlightConstants_() {
      var hc = super.makeHighlightConstants_();
      hc.makeStartHat = function () {
        var w = this.START_HAT.width, h = this.START_HAT.height;
        return {
          path: function () { return domePath(w, h); }
        };
      };
      return hc;
    }
  }

  Blockly.blockRendering.register('duckbox', DuckRenderer);

  // ------------------------------------------------------------------ //
  // 文字颜色自动取反：FieldLabel 渲染时把文字颜色设为底色反色
  // ------------------------------------------------------------------ //
  function hexToInvert(hex) {
    if (typeof hex !== 'string') return '#000000';
    var m = hex.match(/^#?([0-9a-f]{6})$/i);
    if (!m) {
      // 可能是 rgb() / rgbb() 形式，尝试提取数字
      var mm = hex.match(/(\d+)/g);
      if (!mm || mm.length < 3) return '#000000';
      var r = +mm[0], g = +mm[1], b = +mm[2];
      var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return lum > 0.82 ? '#000000' : '#ffffff';
    }
    var ri = parseInt(m[1].substr(0, 2), 16);
    var gi = parseInt(m[1].substr(2, 2), 16);
    var bi = parseInt(m[1].substr(4, 2), 16);
    var lum = (0.299 * ri + 0.587 * gi + 0.114 * bi) / 255;
    return lum > 0.82 ? '#000000' : '#ffffff';
  }

  if (Blockly.FieldLabel && Blockly.FieldLabel.prototype) {
    var _flInit = Blockly.FieldLabel.prototype.init;
    Blockly.FieldLabel.prototype.init = function () {
      _flInit.call(this);
      try {
        var block = this.getSourceBlock && this.getSourceBlock();
        if (block && block.getColour) {
          var colour = block.getColour();
          var textColour = hexToInvert(colour);
          if (this.textElement_ && this.textElement_.style) this.textElement_.style.fill = textColour;
          if (this.textContent_ && this.textContent_.style) this.textContent_.style.fill = textColour;
          if (this.fieldGroup_ && this.fieldGroup_.style) this.fieldGroup_.style.fill = textColour;
        }
      } catch (e) {}
    };
    // 积木移动/重绘后也要重新上色
    var _flRender = Blockly.FieldLabel.prototype.render_;
    if (_flRender) {
      Blockly.FieldLabel.prototype.render_ = function () {
        _flRender.call(this);
        try {
          var block = this.getSourceBlock && this.getSourceBlock();
          if (block && block.getColour) {
            var t = hexToInvert(block.getColour());
            if (this.textElement_ && this.textElement_.style) this.textElement_.style.fill = t;
            if (this.textContent_ && this.textContent_.style) this.textContent_.style.fill = t;
          }
        } catch (e) {}
      };
    }
  }
})();

window.DBX = (function () {
  'use strict';

  // ------------------------------------------------------------------ //
  // 生成器兼容层（同时支持新旧版 Blockly API）
  // ------------------------------------------------------------------ //
  var J = Blockly.JavaScript;
  var F = (J && J.forBlock) ? J.forBlock : J;

  // 保存 Blockly 内置循环生成器：循环体里含「等待」时改用异步循环，
  // 否则循环会在同一帧里全部跑完，等待只延后了每轮后半段，看起来像“只执行一次”。
  var _builtinLoops = {
    repeat: F['controls_repeat_ext'],
    whileUntil: F['controls_whileUntil']
  };

  // 「等待」积木要把后续积木包进 setTimeout，这里协同 statementToCode 的循环：
  // 已经手动生成过的积木，外层循环再次取到它时直接返回空，避免重复生成
  var _origBlockToCode = J.blockToCode;
  if (typeof _origBlockToCode === 'function') {
    J.blockToCode = function (b) {
      if (ctx && ctx.skipIds && b && ctx.skipIds[b.id]) return '';
      return _origBlockToCode.apply(J, arguments);
    };
  }
  var ORDER = {
    ATOMIC: (J && J.ORDER_ATOMIC) || 0,
    NONE: (J && J.ORDER_NONE) || 99,
    ASSIGNMENT: (J && J.ORDER_ASSIGNMENT) || 3,
    ADDITION: (J && J.ORDER_ADDITION) || 1,
    MEMBER: (J && J.ORDER_MEMBER) || 18
  };

  // ------------------------------------------------------------------ //
  // 动态下拉选项（编辑器在 workspace / 页面 / 图片变化时刷新）
  // ------------------------------------------------------------------ //
  var options = {
    dataVars: [['（不绑定）', '']],
    components: [['（先给组件命名）', '']],
    targets: [['（先给组件命名或新建角色）', '']],
    pages: [['index', 'index']],
    images: [['（内置小鸭 Logo）', '/common/logo.png']],
    sprites: [],
    backdrops: [['（先添加背景）', '']]
  };

  var COMPONENT_TYPES = {
    vela_text: 1, vela_image: 1, vela_button: 1, vela_button_param: 1, vela_div: 1,
    vela_progress: 1, vela_switch: 1, vela_slider: 1
  };

  // 顶层积木里会输出 UI 标记（<template> 内容）的组件类型
  var UI_TOP_BLOCKS = {
    vela_text: 1, vela_image: 1, vela_button: 1, vela_button_param: 1, vela_div: 1,
    vela_progress: 1, vela_switch: 1, vela_slider: 1,
    vela_swiper: 1, vela_stack: 1, vela_scroll: 1
  };

  // 设备型号 → 屏幕分辨率（设计单位；新建项目时 designWidth 与设备宽度一致）
  // band / watch 为旧项目兼容值
  var DEVICE_SCREENS = {
    band9: { w: 192, h: 490 },
    band9pro: { w: 336, h: 480 },
    band10: { w: 212, h: 520 },
    band10pro: { w: 336, h: 480 },
    band: { w: 212, h: 520 },
    watch: { w: 336, h: 336 }
  };

  function deviceScreen(deviceType) {
    return DEVICE_SCREENS[String(deviceType || '').trim()] || DEVICE_SCREENS.band10;
  }

  // ------------------------------------------------------------------ //
  // 工具箱
  // ------------------------------------------------------------------ //
  var toolbox = {
    kind: 'categoryToolbox',
    contents: [
      { kind: 'category', name: '运动', colour: '#4C97FF', contents: [
        { kind: 'block', type: 'sc_motion_goto',
          inputs: {
            X: { shadow: { type: 'math_number', fields: { NUM: 0 } } },
            Y: { shadow: { type: 'math_number', fields: { NUM: 0 } } }
          } },
        { kind: 'block', type: 'sc_change_x',
          inputs: { DX: { shadow: { type: 'math_number', fields: { NUM: 10 } } } } },
        { kind: 'block', type: 'sc_change_y',
          inputs: { DY: { shadow: { type: 'math_number', fields: { NUM: 10 } } } } },
        { kind: 'sep' },
        { kind: 'block', type: 'sc_rotate_right',
          inputs: { ROT: { shadow: { type: 'math_number', fields: { NUM: 15 } } } } },
        { kind: 'block', type: 'sc_rotate_left',
          inputs: { ROT: { shadow: { type: 'math_number', fields: { NUM: 15 } } } } },
        { kind: 'sep' },
        { kind: 'block', type: 'sc_xpos' },
        { kind: 'block', type: 'sc_ypos' },
        { kind: 'block', type: 'sc_direction' }
      ]},
      { kind: 'category', name: '外观', colour: '#9966FF', contents: [
        { kind: 'block', type: 'sc_say',
          inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '你好！' } } } } },
        { kind: 'block', type: 'sc_say_secs',
          inputs: {
            TEXT: { shadow: { type: 'text', fields: { TEXT: '你好！' } } },
            SECS: { shadow: { type: 'math_number', fields: { NUM: 2 } } }
          } },
        { kind: 'sep' },
        { kind: 'block', type: 'sc_show' },
        { kind: 'block', type: 'sc_hide' },
        { kind: 'sep' },
        { kind: 'block', type: 'sc_costume' },
        { kind: 'block', type: 'sc_next_costume' },
        { kind: 'sep' },
        { kind: 'block', type: 'sc_backdrop' },
        { kind: 'block', type: 'sc_next_backdrop' },
        { kind: 'sep' },
        { kind: 'block', type: 'sc_costume_number' },
        { kind: 'block', type: 'sc_backdrop_number' }
      ]},
      { kind: 'category', name: '事件', colour: '#FFBF00', contents: [
        { kind: 'label', text: '帽子积木：程序从这里开始' },
        { kind: 'block', type: 'vela_onready' },
        { kind: 'block', type: 'vela_on_sprite_click' },
        { kind: 'block', type: 'sc_when_clone_start' },
        { kind: 'block', type: 'vela_broadcast_recv' },
        { kind: 'sep' },
        { kind: 'block', type: 'vela_broadcast_send' }
      ]},
      { kind: 'category', name: '控制', colour: '#FFAB19', contents: [
        { kind: 'block', type: 'vela_wait',
          inputs: { SECS: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
        { kind: 'sep' },
        { kind: 'block', type: 'controls_repeat_ext',
          inputs: { TIMES: { shadow: { type: 'math_number', fields: { NUM: 10 } } } } },
        { kind: 'block', type: 'controls_forever' },
        { kind: 'block', type: 'controls_whileUntil' },
        { kind: 'sep' },
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'controls_if', extraState: { hasElse: true } },
        { kind: 'block', type: 'controls_flow_statements' },
        { kind: 'sep' },
        { kind: 'block', type: 'sc_clone' },
        { kind: 'block', type: 'sc_delete_clone' },
        { kind: 'block', type: 'sc_delete_all_clones' },
        { kind: 'block', type: 'sc_delete_clones_of' }
      ]},
      { kind: 'category', name: '侦测', colour: '#5CB1D6', contents: [
        { kind: 'label', text: '角色 / 舞台' },
        { kind: 'block', type: 'sc_touching' },
        { kind: 'block', type: 'sc_leaving_stage' },
        { kind: 'block', type: 'sc_when_sprite_clicked' },
        { kind: 'block', type: 'sc_sprite_prop' },
        { kind: 'block', type: 'sc_distance_to' },
        { kind: 'sep' },
        { kind: 'label', text: '手指 / 触摸（手环屏幕）' },
        { kind: 'block', type: 'sc_when_stage_clicked' },
        { kind: 'block', type: 'sc_when_swipe' },
        { kind: 'block', type: 'sc_touch_down' },
        { kind: 'block', type: 'sc_touch_x' },
        { kind: 'block', type: 'sc_touch_y' },
        { kind: 'block', type: 'sc_swipe_dir' },
        { kind: 'sep' },
        { kind: 'label', text: '时间' },
        { kind: 'block', type: 'sc_timer' },
        { kind: 'block', type: 'sc_timer_reset' },
        { kind: 'block', type: 'sc_current_time' }
      ]},
      { kind: 'category', name: '运算', colour: '#59C059', contents: [
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_arithmetic' },
        { kind: 'block', type: 'math_single' },
        { kind: 'block', type: 'math_round' },
        { kind: 'block', type: 'math_random_int' },
        { kind: 'block', type: 'math_modulo' },
        { kind: 'block', type: 'math_number_property' },
        { kind: 'block', type: 'math_trig' },
        { kind: 'sep' },
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
        { kind: 'sep' },
        { kind: 'block', type: 'text' },
        { kind: 'block', type: 'sc_join' },
        { kind: 'block', type: 'text_join' },
        { kind: 'block', type: 'text_length' },
        { kind: 'block', type: 'text_isEmpty' },
        { kind: 'block', type: 'text_indexOf' },
        { kind: 'block', type: 'text_charAt' },
        { kind: 'block', type: 'text_getSubstring' }
      ]},
      { kind: 'category', name: '变量', colour: '#FF8C1A', custom: 'DBX_VARIABLES' },
      { kind: 'category', name: '列表', colour: '#FF661A', custom: 'DBX_LISTS' },
      { kind: 'category', name: '我的积木', colour: '#FF6680', custom: 'PROCEDURE' },
      { kind: 'category', name: '扩展', colour: '#26A69A', contents: [
        { kind: 'label', text: '小米手环扩展能力' },
        { kind: 'block', type: 'vela_toast',
          inputs: { MESSAGE: { shadow: { type: 'text', fields: { TEXT: '提示内容' } } } } },
        { kind: 'block', type: 'vela_vibrate' },
        { kind: 'block', type: 'vela_battery_get' },
        { kind: 'block', type: 'vela_log',
          inputs: { MESSAGE: { shadow: { type: 'text', fields: { TEXT: '日志内容' } } } } },
        { kind: 'sep' },
        { kind: 'block', type: 'vela_timer_every',
          inputs: { INTERVAL: { shadow: { type: 'math_number', fields: { NUM: 1000 } } } } },
        { kind: 'block', type: 'vela_timer_after',
          inputs: { DELAY: { shadow: { type: 'math_number', fields: { NUM: 500 } } } } },
        { kind: 'block', type: 'vela_timer_clear' },
        { kind: 'sep' },
        { kind: 'block', type: 'vela_storage_set' },
        { kind: 'block', type: 'vela_storage_get',
          inputs: { DEFAULT: { shadow: { type: 'text', fields: { TEXT: '' } } } } },
        { kind: 'sep' },
        { kind: 'block', type: 'vela_router_push' },
        { kind: 'block', type: 'vela_router_push_param' },
        { kind: 'block', type: 'vela_router_back' },
        { kind: 'block', type: 'vela_exit_app' },
        { kind: 'block', type: 'vela_swipe_exit_off' },
        { kind: 'sep' },
        { kind: 'label', text: '直接写 JS（谨慎使用）' },
        { kind: 'block', type: 'vela_raw_js' },
        { kind: 'block', type: 'vela_raw_value' }
      ]}
    ]
  };

  // ------------------------------------------------------------------ //
  // 自定义积木 JSON 定义
  // ------------------------------------------------------------------ //
  var blocks = [
    {
      type: 'vela_text',
      message0: '文本 名称 %1 内容 %2 绑定 %3 字号 %4 颜色 %5 背景 %6 位置 X=%7 Y=%8 宽=%9 高=%10 层级 %11',
      args0: [
        { type: 'field_input', name: 'NAME', text: '' },
        { type: 'field_input', name: 'CONTENT', text: '你好' },
        { type: 'field_dropdown', name: 'BIND', options: function () { return optionsFor('dataVars'); } },
        { type: 'field_number', name: 'SIZE', value: 20, min: 8, max: 96, precision: 1 },
        { type: 'field_colour', name: 'COLOR', colour: '#37b26c' },
        { type: 'field_dropdown', name: 'BACKGROUND', options: function () { return BG_OPTIONS; }, tooltip: '背景颜色；选"🚫 无背景"则不显示背景' },
        { type: 'field_number', name: 'X', value: 0, tooltip: '横坐标（px）：0=屏幕中心，向右为正、向左为负' },
        { type: 'field_number', name: 'Y', value: 0, tooltip: '纵坐标（px）：0=屏幕中心，向下为正、向上为负' },
        { type: 'field_number', name: 'W', value: 200, min: 0, tooltip: '宽度（0=自适应宽度）' },
        { type: 'field_number', name: 'H', value: 40, min: 0, tooltip: '高度（0=自适应高度）' },
        { type: 'field_number', name: 'LAYER', value: 0, min: 0, max: 999, precision: 1, tooltip: '层叠顺序，数字越大越靠前' }
      ],
      inputsInline: true,
      previousStatement: 'UI',
      nextStatement: 'UI',
      colour: '#0FBD8C',
      tooltip: '显示一段文字。「绑定」可自动选择已声明的数据；给文本起名后还能用显示/隐藏/移动控制它。位置与大小请到预览里直接拖动调整。'
    },
    {
      type: 'vela_image',
      message0: '图片 名称 %1 来源 %2 宽 %3 高 %4 圆角 %5 位置 X=%6 Y=%7 点击事件 %8 层级 %9',
      args0: [
        { type: 'field_input', name: 'NAME', text: '' },
        { type: 'field_dropdown', name: 'SRC', options: function () { return optionsFor('images'); } },
        { type: 'field_number', name: 'WIDTH', value: 80, min: 1 },
        { type: 'field_number', name: 'HEIGHT', value: 80, min: 1 },
        { type: 'field_number', name: 'RADIUS', value: 12, min: 0 },
        { type: 'field_number', name: 'X', value: 0, tooltip: '横坐标（px）：0=屏幕中心，向右为正、向左为负' },
        { type: 'field_number', name: 'Y', value: 0, tooltip: '纵坐标（px）：0=屏幕中心，向下为正、向上为负' },
        { type: 'field_input', name: 'EVENT', text: '' },
        { type: 'field_number', name: 'LAYER', value: 0, min: 0, max: 999, precision: 1, tooltip: '层叠顺序，数字越大越靠前' }
      ],
      inputsInline: true,
      previousStatement: 'UI',
      nextStatement: 'UI',
      colour: '#0FBD8C',
      tooltip: '显示一张图片（在右侧「角色/贴图」页上传贴图）。填「点击事件」后，可在「事件」分类里编写点击逻辑。位置与大小请到预览里直接拖动调整。'
    },
    {
      type: 'vela_button',
      message0: '按钮 名称 %1 文字 %2 行为 %3 目标 %4 传参 %5 背景色 %6 文字色 %7 字号 %8 位置 X=%9 Y=%10 宽=%11 高=%12 层级 %13',
      args0: [
        { type: 'field_input', name: 'NAME', text: '' },
        { type: 'field_input', name: 'LABEL', text: '按钮' },
        { type: 'field_dropdown', name: 'ACTION', options: [['触发事件', 'event'], ['导航页面', 'navigate']] },
        {
          type: 'field_input',
          name: 'TARGET',
          text: 'onTap',
          tooltip: '选择「触发事件」填事件名；选择「导航页面」填页面名'
        },
        {
          type: 'field_input',
          name: 'PARAM',
          text: '',
          tooltip: '可选：点击时传给事件的值（留空表示不带参数）。事件里用「当前点击参数」读取，如数字键盘填 0~9'
        },
        { type: 'field_dropdown', name: 'BG', options: function () { return BG_OPTIONS; }, tooltip: '按钮背景色；选"🚫 无背景"则透明' },
        { type: 'field_colour', name: 'FG', colour: '#37b26c' },
        { type: 'field_number', name: 'FS', value: 22, min: 10, max: 60, precision: 1 },
        { type: 'field_number', name: 'X', value: 0, tooltip: '横坐标（px）：0=屏幕中心，向右为正、向左为负' },
        { type: 'field_number', name: 'Y', value: 0, tooltip: '纵坐标（px）：0=屏幕中心，向下为正、向上为负' },
        { type: 'field_number', name: 'W', value: 120, min: 0, tooltip: '宽度（0=自适应宽度）' },
        { type: 'field_number', name: 'H', value: 44, min: 0, tooltip: '高度（0=自适应高度）' },
        { type: 'field_number', name: 'LAYER', value: 0, min: 0, max: 999, precision: 1, tooltip: '层叠顺序，数字越大越靠前' }
      ],
      inputsInline: true,
      previousStatement: 'UI',
      nextStatement: 'UI',
      colour: '#0FBD8C',
      tooltip: '按钮组件，支持触发事件或导航到指定页面。位置与大小请到预览里直接拖动调整。'
    },
    {
      type: 'vela_button_param',
      message0: '带参按钮 名称 %1 文字 %2 点击事件 %3 参数 %4 背景色 %5 文字色 %6 字号 %7 位置 X=%8 Y=%9 宽=%10 高=%11 层级 %12',
      args0: [
        { type: 'field_input', name: 'NAME', text: '' },
        { type: 'field_input', name: 'LABEL', text: '按键' },
        { type: 'field_input', name: 'EVENT', text: 'onKey', tooltip: '事件名，与「当带参按钮被点击」积木一致' },
        { type: 'field_input', name: 'PARAM', text: '7', tooltip: '点击时传给事件的值（数字或文字，如 7 / easy）' },
        { type: 'field_dropdown', name: 'BG', options: function () { return BG_OPTIONS; }, tooltip: '按钮背景色；选"🚫 无背景"则透明' },
        { type: 'field_colour', name: 'FG', colour: '#37b26c' },
        { type: 'field_number', name: 'FS', value: 22, min: 10, max: 60, precision: 1 },
        { type: 'field_number', name: 'X', value: 0, tooltip: '横坐标（px）：0=屏幕中心，向右为正、向左为负' },
        { type: 'field_number', name: 'Y', value: 0, tooltip: '纵坐标（px）：0=屏幕中心，向下为正、向上为负' },
        { type: 'field_number', name: 'W', value: 120, min: 0, tooltip: '宽度（0=自适应宽度）' },
        { type: 'field_number', name: 'H', value: 44, min: 0, tooltip: '高度（0=自适应高度）' },
        { type: 'field_number', name: 'LAYER', value: 0, min: 0, max: 999, precision: 1, tooltip: '层叠顺序，数字越大越靠前' }
      ],
      inputsInline: true,
      previousStatement: 'UI',
      nextStatement: 'UI',
      colour: '#0FBD8C',
      tooltip: '带参数按钮：点击时把「参数」传给事件（如数字键盘 0~9 各放一个）。事件用「当带参按钮被点击」积木编写，事件里用「当前点击参数」积木取到传入的值。'
    },
    {
      type: 'vela_div',
      message0: '容器 名称 %1 方向 %2 宽 %3 高 %4 背景色 %5 层级 %6',
      args0: [
        { type: 'field_input', name: 'NAME', text: '' },
        { type: 'field_dropdown', name: 'DIRECTION', options: [['纵向排列', 'column'], ['横向排列', 'row']] },
        { type: 'field_input', name: 'WIDTH', text: '100%' },
        { type: 'field_input', name: 'HEIGHT', text: 'auto' },
        { type: 'field_dropdown', name: 'BG', options: function () { return BG_OPTIONS; }, tooltip: '容器背景色；选"🚫 无背景"则透明' },
        { type: 'field_number', name: 'LAYER', value: 0, min: 0, max: 999, precision: 1, tooltip: '层叠顺序，数字越大越靠前' }
      ],
      message1: '子组件 %1',
      args1: [{ type: 'input_statement', name: 'CHILDREN', check: 'UI' }],
      previousStatement: 'UI',
      nextStatement: 'UI',
      colour: '#0FBD8C',
      tooltip: '容器 div，用来分组和布局其它组件，可嵌套。'
    },
    {
      type: 'vela_stack',
      message0: '层叠容器 宽 %1 高 %2',
      args0: [
        { type: 'field_input', name: 'WIDTH', text: '100%' },
        { type: 'field_input', name: 'HEIGHT', text: '200px' }
      ],
      message1: '子组件 %1',
      args1: [{ type: 'input_statement', name: 'CHILDREN', check: 'UI' }],
      previousStatement: 'UI',
      nextStatement: 'UI',
      colour: '#0FBD8C',
      tooltip: '层叠容器 stack，子组件按先后顺序层叠覆盖。'
    },
    {
      type: 'vela_scroll',
      message0: '滚动容器 方向 %1 高 %2',
      args0: [
        { type: 'field_dropdown', name: 'DIRECTION', options: [['纵向滚动', 'column'], ['横向滚动', 'row']] },
        { type: 'field_input', name: 'HEIGHT', text: '300px' }
      ],
      message1: '子组件 %1',
      args1: [{ type: 'input_statement', name: 'CHILDREN', check: 'UI' }],
      previousStatement: 'UI',
      nextStatement: 'UI',
      colour: '#0FBD8C',
      tooltip: '滚动容器 scroll，内容超出可滚动查看。'
    },
    {
      type: 'vela_swiper',
      message0: '轮播 Swiper 自动播放 %1 循环 %2 指示器 %3',
      args0: [
        { type: 'field_dropdown', name: 'AUTOPLAY', options: [['开', 'true'], ['关', 'false']] },
        { type: 'field_dropdown', name: 'LOOP', options: [['开', 'true'], ['关', 'false']] },
        { type: 'field_dropdown', name: 'INDICATOR', options: [['开', 'true'], ['关', 'false']] }
      ],
      message1: '子组件 %1',
      args1: [{ type: 'input_statement', name: 'ITEMS', check: 'UI' }],
      previousStatement: 'UI',
      nextStatement: 'UI',
      colour: '#0FBD8C',
      tooltip: '滑块视图组件，用于轮播图片或页面。'
    },
    {
      type: 'vela_progress',
      message0: '进度条 名称 %1 进度 %2 类型 %3 颜色 %4 位置 X=%5 Y=%6 宽=%7 高=%8 层级 %9',
      args0: [
        { type: 'field_input', name: 'NAME', text: '进度' },
        { type: 'input_value', name: 'PERCENT' },
        { type: 'field_dropdown', name: 'TYPE', options: [['横条', 'horizontal'], ['圆环', 'arc']] },
        { type: 'field_colour', name: 'COLOR', colour: '#0FBD8C' },
        { type: 'field_number', name: 'X', value: 0, tooltip: '横坐标（px）：0=屏幕中心' },
        { type: 'field_number', name: 'Y', value: 0, tooltip: '纵坐标（px）：0=屏幕中心' },
        { type: 'field_number', name: 'W', value: 200, min: 0 },
        { type: 'field_number', name: 'H', value: 20, min: 0 },
        { type: 'field_number', name: 'LAYER', value: 0, min: 0, max: 999, precision: 1 }
      ],
      inputsInline: true,
      previousStatement: 'UI',
      nextStatement: 'UI',
      colour: '#0FBD8C',
      tooltip: '显示进度条（0~100），进度可以接变量实现动态更新。'
    },
    {
      type: 'vela_switch',
      message0: '开关 名称 %1 初始状态 %2 位置 X=%3 Y=%4 宽=%5 高=%6 层级 %7',
      args0: [
        { type: 'field_input', name: 'NAME', text: '开关' },
        { type: 'field_dropdown', name: 'CHECKED', options: [['开', 'true'], ['关', 'false']] },
        { type: 'field_number', name: 'X', value: 0, tooltip: '横坐标（px）：0=屏幕中心' },
        { type: 'field_number', name: 'Y', value: 0, tooltip: '纵坐标（px）：0=屏幕中心' },
        { type: 'field_number', name: 'W', value: 80, min: 0 },
        { type: 'field_number', name: 'H', value: 40, min: 0 },
        { type: 'field_number', name: 'LAYER', value: 0, min: 0, max: 999, precision: 1 }
      ],
      previousStatement: 'UI',
      nextStatement: 'UI',
      colour: '#0FBD8C',
      tooltip: '开关组件，可绑定数据变量实现双向同步。'
    },
    {
      type: 'vela_slider',
      message0: '滑块 名称 %1 最小值 %2 最大值 %3 初始值 %4 位置 X=%5 Y=%6 宽=%7 高=%8 层级 %9',
      args0: [
        { type: 'field_input', name: 'NAME', text: '滑块' },
        { type: 'field_number', name: 'MIN', value: 0, min: 0, max: 1000 },
        { type: 'field_number', name: 'MAX', value: 100, min: 1, max: 1000 },
        { type: 'field_number', name: 'VALUE', value: 50, min: 0, max: 1000 },
        { type: 'field_number', name: 'X', value: 0, tooltip: '横坐标（px）：0=屏幕中心' },
        { type: 'field_number', name: 'Y', value: 0, tooltip: '纵坐标（px）：0=屏幕中心' },
        { type: 'field_number', name: 'W', value: 240, min: 0 },
        { type: 'field_number', name: 'H', value: 40, min: 0 },
        { type: 'field_number', name: 'LAYER', value: 0, min: 0, max: 999, precision: 1 }
      ],
      previousStatement: 'UI',
      nextStatement: 'UI',
      colour: '#0FBD8C',
      tooltip: '滑块组件，可绑定数据变量实现双向同步。'
    },

    // ---------------- 事件 ---------------- //
    {
      type: 'vela_onclick',
      hat: 'cap',
      message0: '当组件被点击 事件名 %1 参数名 %2',
      args0: [
        { type: 'field_input', name: 'EVENT', text: 'onTap' },
        { type: 'field_input', name: 'PARAM', text: '参数', tooltip: '事件里用来称呼传入值的名字；用「当前点击参数」积木取到按钮传入的值' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      nextStatement: 'Action',
      colour: '#FFBF00',
      tooltip: '事件名要与按钮/图片积木上填的事件名一致。'
    },
    {
      type: 'vela_onclick_param',
      hat: 'cap',
      message0: '当带参按钮被点击 事件名 %1 参数名 %2',
      args0: [
        { type: 'field_input', name: 'EVENT', text: 'onKey' },
        { type: 'field_input', name: 'PARAM', text: 'val', tooltip: '事件里用来称呼传入值的名字，如 val' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      nextStatement: 'Action',
      colour: 0,
      tooltip: '接收「带参按钮」的点击事件。事件名要与按钮积木上填的一致；事件里用「当前点击参数」积木取到按钮传入的值。'
    },
    {
      type: 'vela_click_param',
      message0: '当前点击参数',
      args0: [],
      output: null,
      colour: '#5CB1D6',
      tooltip: '在「当组件被点击」事件里使用，取到按钮传入的那个值（数字或文字）。'
    },
    {
      type: 'vela_onlongpress',
      hat: 'cap',
      message0: '当组件被长按 事件名 %1',
      args0: [
        { type: 'field_input', name: 'EVENT', text: 'onLong' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      nextStatement: 'Action',
      colour: '#FFBF00',
      tooltip: '长按事件。需要给按钮积木的事件名前加 long: 前缀来开启长按，例如 long:onLong。'
    },
    {
      type: 'vela_on_sprite_click',
      hat: 'cap',
      message0: '当角色 %1 被点击',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      nextStatement: 'Action',
      colour: '#FFBF00',
      tooltip: '点击舞台上的角色（在右侧「角色」面板里创建）时执行。'
    },
    {
      type: 'vela_onshow',
      hat: 'cap',
      message0: '当页面显示',
      args0: [],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      nextStatement: 'Action',
      colour: 0,
      tooltip: '每次页面显示时执行的动作。'
    },
    {
      type: 'vela_onhide',
      hat: 'cap',
      message0: '当页面隐藏',
      args0: [],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      nextStatement: 'Action',
      colour: 0,
      tooltip: '页面被隐藏时执行的动作，常用来暂停定时器。'
    },
    {
      type: 'vela_onready',
      hat: 'cap',
      message0: '当进入页面时',
      args0: [],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      nextStatement: 'Action',
      colour: '#FFBF00',
      tooltip: '进入这个页面时执行（每次进入页面都会执行，手环没有开始按钮）。'
    },
    {
      type: 'vela_broadcast_recv',
      hat: 'cap',
      message0: '当接收到广播 %1',
      args0: [
        { type: 'field_input', name: 'NAME', text: '开始' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      nextStatement: 'Action',
      colour: '#FFBF00',
      tooltip: '接收「发送广播」积木发出的同名广播（本页面内有效），收到后执行里面的动作。'
    },
    {
      type: 'vela_swipe_exit_off',
      hat: 'cap',
      message0: '关闭左滑退出',
      args0: [],
      colour: 0,
      tooltip: '页面设置：默认所有页面左滑都会退出快应用，把这块放进本页面后，左滑不再退出本页面。'
    },

    // ---------------- 动作 ---------------- //
    {
      type: 'vela_show',
      message0: '角色 %1 显示',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('targets'); } }
      ],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#9966FF',
      tooltip: '让指定名称的组件显示出来（组件要先在积木里填名称）。'
    },
    {
      type: 'vela_hide',
      message0: '角色 %1 隐藏 %2 秒后自动显示',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('targets'); } },
        { type: 'field_number', name: 'SECS', value: 0, min: 0, max: 60, precision: 0.5 }
      ],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#9966FF',
      tooltip: '隐藏指定组件。秒数填 0 表示一直隐藏，直到用「显示」积木恢复。'
    },
    {
      type: 'vela_motion_goto',
      message0: '角色 %1 移到 x: %2 y: %3',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('targets'); } },
        { type: 'input_value', name: 'X' },
        { type: 'input_value', name: 'Y' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#4C97FF',
      tooltip: '把对象移到相对舞台中心的位置：X 向右为正、Y 向下为正。'
    },
    {
      type: 'vela_motion_move',
      message0: '移动 %1 横向 %2 纵向 %3',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('targets'); } },
        { type: 'input_value', name: 'DX' },
        { type: 'input_value', name: 'DY' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#4C97FF',
      tooltip: '让对象相对当前位置移动，横向/纵向可填负数（如 -50 表示向左/向上）。'
    },
    {
      type: 'vela_motion_rotate',
      message0: '旋转 %1 角度 %2 度',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('targets'); } },
        { type: 'input_value', name: 'ROT' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#4C97FF',
      tooltip: '让组件相对当前角度继续旋转，正数顺时针、负数逆时针。角色请到「角色」面板调整。'
    },
    {
      type: 'vela_sprite_costume',
      message0: '角色 %1 换成造型 %2',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } },
        { type: 'field_dropdown', name: 'COSTUME', options: function () { return optionsFor('images'); } }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#9966FF',
      tooltip: '把角色换成指定的造型（贴图）。'
    },
    {
      type: 'vela_sprite_nextcostume',
      message0: '角色 %1 下一个造型',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#9966FF',
      tooltip: '切换到角色造型列表里的下一个造型，循环播放。'
    },
    {
      type: 'vela_broadcast_send',
      message0: '广播 %1',
      args0: [{ type: 'field_input', name: 'NAME', text: '开始' }],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FFBF00',
      tooltip: '发出一条广播，本页面所有「当接收到广播」的同名积木都会执行。'
    },
    {
      type: 'vela_router_push',
      message0: '跳转到页面 %1',
      args0: [
        { type: 'field_dropdown', name: 'PAGE', options: function () { return optionsFor('pages'); } }
      ],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FFBF00',
      tooltip: '跳转到指定页面（放进事件的「执行」里使用）。'
    },
    {
      type: 'vela_router_push_param',
      message0: '跳转到页面 %1 参数1名 %2 值 %3 参数2名 %4 值 %5 参数3名 %6 值 %7',
      args0: [
        { type: 'field_dropdown', name: 'PAGE', options: function () { return optionsFor('pages'); } },
        { type: 'field_input', name: 'K1', text: 'min' },
        { type: 'input_value', name: 'V1' },
        { type: 'field_input', name: 'K2', text: 'max' },
        { type: 'input_value', name: 'V2' },
        { type: 'field_input', name: 'K3', text: 'chances' },
        { type: 'input_value', name: 'V3' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FFBF00',
      tooltip: '跳转到指定页面并携带参数。目标页面里声明同名的数据变量，就能自动收到这些值（如 min/max/chances）。'
    },
    {
      type: 'vela_router_back',
      message0: '返回上一页',
      args0: [],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FFBF00',
      tooltip: '返回上一个页面。'
    },
    {
      type: 'vela_exit_app',
      message0: '退出快应用',
      args0: [],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FFBF00',
      tooltip: '退出整个快应用（放进事件的「执行」里使用，比如按钮点击后退出）。'
    },
    {
      type: 'vela_toast',
      message0: '弹出提示 %1 时长 %2 毫秒',
      args0: [
        { type: 'input_value', name: 'MESSAGE' },
        { type: 'field_number', name: 'DURATION', value: 1500, min: 500, max: 10000, precision: 100 }
      ],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#26A69A',
      tooltip: '在屏幕上短暂显示一条提示信息。'
    },
    {
      type: 'vela_vibrate',
      message0: '震动 %1',
      args0: [
        { type: 'field_dropdown', name: 'MODE', options: [['短震一下', 'short'], ['长震', 'long']] }
      ],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#26A69A',
      tooltip: '让手环震动一下（system.vibrator）。'
    },
    {
      type: 'vela_log',
      message0: '打印日志 %1',
      args0: [{ type: 'input_value', name: 'MESSAGE' }],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#26A69A',
      tooltip: '在调试控制台输出日志，方便排查问题。'
    },

    // ---------------- 数据 ---------------- //
    {
      type: 'vela_data',
      message0: '数据 %1 = %2',
      args0: [
        { type: 'field_input', name: 'NAME', text: '计数' },
        { type: 'input_value', name: 'VALUE' }
      ],
      previousStatement: null,
      nextStatement: null,
      colour: '#FF8C1A',
      tooltip: '声明一个页面数据（初始值）。之后文本积木的「绑定」下拉里就能选到它。'
    },
    {
      type: 'vela_raw_value',
      message0: '自定义表达式 %1',
      args0: [
        { type: 'field_multilinetext', name: 'CODE', text: '0' }
      ],
      output: null,
      colour: '#59C059',
      tooltip: '自己写一段 JS 表达式作为值使用，例如 (1 + 2) * 3 或 "你好"。'
    },
    {
      type: 'vela_raw_js',
      message0: '自定义代码 %1',
      args0: [
        { type: 'field_multilinetext', name: 'CODE', text: '' }
      ],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#26A69A',
      tooltip: '自己写 JS 代码，原样插入到所在的事件里执行（谨慎使用）。'
    },

    // ---------------- 系统接口 ---------------- //
    {
      type: 'vela_battery_get',
      message0: '获取电量 存入变量 %1',
      args0: [
        { type: 'field_input', name: 'VAR', text: '电量' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#5CB1D6',
      tooltip: '获取手环电量(0~100)存入变量，然后执行后面的动作。'
    },
    {
      type: 'vela_storage_set',
      message0: '保存数据 键 %1 值 %2',
      args0: [
        { type: 'field_input', name: 'KEY', text: '最高分' },
        { type: 'input_value', name: 'VALUE' }
      ],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#5CB1D6',
      tooltip: '把数据保存到手环本地存储，重启后仍在。'
    },
    {
      type: 'vela_storage_get',
      message0: '读取数据 键 %1 存入变量 %2 默认值 %3',
      args0: [
        { type: 'field_input', name: 'KEY', text: '最高分' },
        { type: 'field_input', name: 'VAR', text: '结果' },
        { type: 'input_value', name: 'DEFAULT' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#5CB1D6',
      tooltip: '读取本地存储的数据存入变量；不存在时使用默认值。'
    },

    // ---------------- 定时器 ---------------- //
    {
      type: 'vela_timer_every',
      message0: '每隔 %1 毫秒重复执行，定时器编号存到 %2',
      args0: [
        { type: 'input_value', name: 'INTERVAL' },
        { type: 'field_input', name: 'IDVAR', text: '定时器' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#26A69A',
      tooltip: '每隔一段时间重复执行一次里面的动作，可用「停止定时器」停止。'
    },
    {
      type: 'vela_timer_after',
      message0: '延迟 %1 毫秒',
      args0: [
        { type: 'input_value', name: 'DELAY' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#26A69A',
      tooltip: '延迟一段时间后执行一次里面的动作。'
    },
    {
      type: 'vela_timer_clear',
      message0: '停止定时器 %1',
      args0: [{ type: 'input_value', name: 'ID' }],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: 230,
      tooltip: '停止「每隔…重复执行」创建的定时器（传入保存的编号变量）。'
    },

    // ---------------- 扩展积木 ---------------- //
    {
      type: 'vela_wait',
      message0: '等待 %1 秒',
      args0: [{ type: 'input_value', name: 'SECS' }],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FFAB19',
      tooltip: '等待指定秒数后，再继续执行下面的积木（不会卡住手表画面）。'
    },
    {
      type: 'controls_forever',
      message0: '重复执行',
      args0: [],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: 'Action',
      nextStatement: null,
      colour: '#FFAB19',
      tooltip: '一直重复执行里面的动作，不会自己停下来（每次循环会让手表刷新画面）。'
    },
    {
      type: 'math_evenly_divisible',
      message0: '%1 能被 %2 整除',
      args0: [
        { type: 'input_value', name: 'DIVIDEND' },
        { type: 'input_value', name: 'DIVISOR' }
      ],
      inputsInline: true,
      output: 'Boolean',
      colour: 210,
      tooltip: '判断第一个数是否恰好被第二个数整除。'
    },
    {
      type: 'math_types',
      message0: '把 %1 转换为 %2 类型',
      args0: [
        { type: 'input_value', name: 'VALUE' },
        { type: 'field_dropdown', name: 'TYPE', options: [['字符串', 'STRING'], ['数值', 'NUMBER'], ['布尔', 'BOOLEAN']] }
      ],
      inputsInline: true,
      output: null,
      colour: 210,
      tooltip: '把内容转换成字符串、数值或布尔类型。'
    },
    {
      type: 'lists_push',
      message0: '添加 %1 到 %2 末尾',
      args0: [
        { type: 'input_value', name: 'VALUE' },
        { type: 'input_value', name: 'LIST' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: 260,
      tooltip: '把一个值添加到列表的末尾。'
    },
    {
      type: 'lists_insert',
      message0: '插入 %1 到 %2 %3 第 %4 项后面',
      args0: [
        { type: 'input_value', name: 'VALUE' },
        { type: 'input_value', name: 'LIST' },
        { type: 'field_dropdown', name: 'WHERE', options: [['正数', 'FROM_START'], ['倒数', 'FROM_END']] },
        { type: 'input_value', name: 'INDEX' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: 260,
      tooltip: '把一个值插入到列表指定项的后面。'
    },
    {
      type: 'lists_delete',
      message0: '删除 %1 %2 第 %3 项',
      args0: [
        { type: 'input_value', name: 'LIST' },
        { type: 'field_dropdown', name: 'WHERE', options: [['正数', 'FROM_START'], ['倒数', 'FROM_END']] },
        { type: 'input_value', name: 'INDEX' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: 260,
      tooltip: '删除列表的指定项。'
    },
    {
      type: 'lists_set',
      message0: '替换 %1 %2 第 %3 项为 %4',
      args0: [
        { type: 'input_value', name: 'LIST' },
        { type: 'field_dropdown', name: 'WHERE', options: [['正数', 'FROM_START'], ['倒数', 'FROM_END']] },
        { type: 'input_value', name: 'INDEX' },
        { type: 'input_value', name: 'VALUE' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: 260,
      tooltip: '替换列表的指定项。'
    },
    {
      type: 'lists_get',
      message0: '%1 %2 第 %3 项',
      args0: [
        { type: 'input_value', name: 'LIST' },
        { type: 'field_dropdown', name: 'WHERE', options: [['正数', 'FROM_START'], ['倒数', 'FROM_END']] },
        { type: 'input_value', name: 'INDEX' }
      ],
      inputsInline: true,
      output: null,
      colour: 260,
      tooltip: '获取列表的指定项。'
    },
    {
      type: 'lists_index',
      message0: '%1 中 %2 %3 的位置',
      args0: [
        { type: 'input_value', name: 'LIST' },
        { type: 'field_dropdown', name: 'WHICH', options: [['第一个', 'FIRST'], ['最后一个', 'LAST']] },
        { type: 'input_value', name: 'VALUE' }
      ],
      inputsInline: true,
      output: 'Number',
      colour: 260,
      tooltip: '返回某个值在列表中第一个/最后一个匹配的位置，找不到时返回 -1。'
    },
    {
      type: 'lists_includes',
      message0: '%1 中包含 %2',
      args0: [
        { type: 'input_value', name: 'LIST' },
        { type: 'input_value', name: 'VALUE' }
      ],
      inputsInline: true,
      output: 'Boolean',
      colour: 260,
      tooltip: '判断列表中是否包含指定项。'
    },

    // ---------------- Scratch 积木（运动 / 外观 / 侦测） ---------------- //
    {
      type: 'sc_motion_goto',
      message0: '角色 %1 移到 x: %2 y: %3',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } },
        { type: 'input_value', name: 'X' },
        { type: 'input_value', name: 'Y' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#4C97FF',
      tooltip: '把角色移到舞台坐标：x 向右为正、y 向下为正，0,0 是屏幕中心。'
    },
    {
      type: 'sc_change_x',
      message0: '角色 %1 将 x 坐标增加 %2',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } },
        { type: 'input_value', name: 'DX' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#4C97FF',
      tooltip: '让角色横向移动，正数向右、负数向左。'
    },
    {
      type: 'sc_change_y',
      message0: '角色 %1 将 y 坐标增加 %2',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } },
        { type: 'input_value', name: 'DY' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#4C97FF',
      tooltip: '让角色纵向移动，正数向下、负数向上。'
    },
    {
      type: 'sc_rotate_right',
      message0: '角色 %1 向右旋转 %2 度',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } },
        { type: 'input_value', name: 'ROT' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#4C97FF',
      tooltip: '顺时针旋转角色。'
    },
    {
      type: 'sc_rotate_left',
      message0: '角色 %1 向左旋转 %2 度',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } },
        { type: 'input_value', name: 'ROT' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#4C97FF',
      tooltip: '逆时针旋转角色。'
    },
    {
      type: 'sc_xpos',
      message0: '角色 %1 的 x 坐标',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } }
      ],
      output: 'Number',
      colour: '#4C97FF',
      tooltip: '读取角色的舞台 x 坐标。'
    },
    {
      type: 'sc_ypos',
      message0: '角色 %1 的 y 坐标',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } }
      ],
      output: 'Number',
      colour: '#4C97FF',
      tooltip: '读取角色的舞台 y 坐标。'
    },
    {
      type: 'sc_direction',
      message0: '角色 %1 的方向',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } }
      ],
      output: 'Number',
      colour: '#4C97FF',
      tooltip: '读取角色当前旋转角度。'
    },
    {
      type: 'sc_say',
      message0: '说 %1',
      args0: [{ type: 'input_value', name: 'TEXT' }],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#9966FF',
      tooltip: '在舞台顶部显示一句话，直到再次说话。'
    },
    {
      type: 'sc_say_secs',
      message0: '说 %1 %2 秒',
      args0: [
        { type: 'input_value', name: 'TEXT' },
        { type: 'input_value', name: 'SECS' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#9966FF',
      tooltip: '显示一句话，指定秒数后自动消失。'
    },
    {
      type: 'sc_show',
      message0: '角色 %1 显示',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } }
      ],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#9966FF',
      tooltip: '让角色显示出来。'
    },
    {
      type: 'sc_hide',
      message0: '角色 %1 隐藏',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } }
      ],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#9966FF',
      tooltip: '隐藏角色，之后可以用「显示」积木重新显示。'
    },
    {
      type: 'sc_costume',
      message0: '角色 %1 换成造型 %2',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } },
        { type: 'field_dropdown', name: 'COSTUME', options: function () { return optionsFor('images'); } }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#9966FF',
      tooltip: '把角色换成指定造型。'
    },
    {
      type: 'sc_next_costume',
      message0: '角色 %1 下一个造型',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#9966FF',
      tooltip: '切换到造型列表里的下一个造型。'
    },
    {
      type: 'sc_costume_number',
      message0: '角色 %1 的造型编号',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } }
      ],
      output: 'Number',
      colour: '#9966FF',
      tooltip: '读取当前造型的编号（从 1 开始）。'
    },
    {
      type: 'sc_backdrop',
      message0: '背景换成 %1',
      args0: [
        { type: 'field_dropdown', name: 'BACKDROP', options: function () { return optionsFor('backdrops'); } }
      ],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#9966FF',
      tooltip: '把舞台背景换成指定的那张背景（背景在底部栏「背景」里管理）。'
    },
    {
      type: 'sc_next_backdrop',
      message0: '下一个背景',
      args0: [],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#9966FF',
      tooltip: '切换到背景列表里的下一张背景。'
    },
    {
      type: 'sc_backdrop_number',
      message0: '背景编号',
      args0: [],
      output: 'Number',
      colour: '#9966FF',
      tooltip: '读取当前背景的编号（从 1 开始）。'
    },
    {
      type: 'sc_timer',
      message0: '计时器',
      args0: [],
      output: 'Number',
      colour: '#5CB1D6',
      tooltip: '从页面启动或上次重置开始算起的秒数。'
    },
    {
      type: 'sc_timer_reset',
      message0: '重置计时器',
      args0: [],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#5CB1D6',
      tooltip: '把计时器归零。'
    },
    {
      type: 'sc_current_time',
      message0: '当前 %1',
      args0: [{
        type: 'field_dropdown', name: 'UNIT',
        options: [
          ['年', 'YEAR'], ['月', 'MONTH'], ['日', 'DAY'],
          ['时', 'HOUR'], ['分', 'MINUTE'], ['秒', 'SECOND'], ['星期', 'WEEKDAY']
        ]
      }],
      output: 'Number',
      colour: '#5CB1D6',
      tooltip: '读取手环当前日期/时间（星期：1=周日，7=周六）。'
    },

    // ---------------- 侦测（Scratch 风格，适配手环触摸屏） ---------------- //
    {
      type: 'sc_touching',
      message0: '%1 碰到 %2 ?',
      args0: [
        { type: 'field_dropdown', name: 'SELF', options: function () { return optionsFor('sprites'); } },
        { type: 'field_dropdown', name: 'OTHER', options: function () { return optionsFor('spritesEdge'); } }
      ],
      inputsInline: true,
      output: 'Boolean',
      colour: '#5CB1D6',
      tooltip: '判断角色之间是否重叠，或角色是否碰到舞台边缘 / 手指。'
    },
    {
      type: 'sc_leaving_stage',
      message0: '%1 离开舞台 ?',
      args0: [
        { type: 'field_dropdown', name: 'SELF', options: function () { return optionsFor('sprites'); } }
      ],
      inputsInline: true,
      output: 'Boolean',
      colour: '#5CB1D6',
      tooltip: '角色完全移出屏幕时返回真。'
    },
    {
      type: 'sc_when_sprite_clicked',
      hat: 'cap',
      message0: '当 %1 被点击',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      nextStatement: 'Action',
      colour: '#5CB1D6',
      tooltip: '点击舞台上的这个角色时执行（与「事件」里的同名积木可叠加）。'
    },
    {
      type: 'sc_sprite_prop',
      message0: '%1 的 %2',
      args0: [
        { type: 'field_dropdown', name: 'SELF', options: function () { return optionsFor('sprites'); } },
        { type: 'field_dropdown', name: 'PROP', options: [
          ['X 坐标', 'x'], ['Y 坐标', 'y'], ['方向', 'dir'], ['大小', 'size'], ['造型编号', 'costume']
        ] }
      ],
      inputsInline: true,
      output: 'Number',
      colour: '#5CB1D6',
      tooltip: '读取角色的实时位置 / 方向 / 大小 / 造型编号。'
    },
    {
      type: 'sc_distance_to',
      message0: '%1 到 %2 的距离',
      args0: [
        { type: 'field_dropdown', name: 'SELF', options: function () { return optionsFor('sprites'); } },
        { type: 'field_dropdown', name: 'OTHER', options: function () { return optionsFor('sprites'); } }
      ],
      inputsInline: true,
      output: 'Number',
      colour: '#5CB1D6',
      tooltip: '两个角色中心点之间的像素距离。'
    },
    {
      type: 'sc_touch_down',
      message0: '手指按下 ?',
      args0: [],
      output: 'Boolean',
      colour: '#5CB1D6',
      tooltip: '手指正按在屏幕上时返回真。'
    },
    {
      type: 'sc_touch_x',
      message0: '手指 X',
      args0: [],
      output: 'Number',
      colour: '#5CB1D6',
      tooltip: '最近一次触摸点的屏幕 X 坐标（0 = 屏幕中心，向右为正）。'
    },
    {
      type: 'sc_touch_y',
      message0: '手指 Y',
      args0: [],
      output: 'Number',
      colour: '#5CB1D6',
      tooltip: '最近一次触摸点的屏幕 Y 坐标（0 = 屏幕中心，向下为正）。'
    },
    {
      type: 'sc_swipe_dir',
      message0: '滑动方向',
      args0: [],
      output: 'String',
      colour: '#5CB1D6',
      tooltip: '最近一次滑动的方向：left / right / up / down。'
    },
    {
      type: 'sc_when_stage_clicked',
      hat: 'cap',
      message0: '当舞台被点击',
      args0: [],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      nextStatement: 'Action',
      colour: '#5CB1D6',
      tooltip: '点击屏幕任意位置时执行。'
    },
    {
      type: 'sc_when_swipe',
      hat: 'cap',
      message0: '当手指向 %1 滑动',
      args0: [{
        type: 'field_dropdown', name: 'DIR', options: [
          ['任意方向', 'any'], ['左', 'left'], ['右', 'right'], ['上', 'up'], ['下', 'down']
        ]
      }],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      nextStatement: 'Action',
      colour: '#5CB1D6',
      tooltip: '手指在屏幕上快速滑动时执行，可按方向区分。'
    },
    {
      type: 'sc_join',
      message0: '%1 与 %2',
      args0: [
        { type: 'input_value', name: 'A' },
        { type: 'input_value', name: 'B' }
      ],
      inputsInline: true,
      output: 'String',
      colour: '#59C059',
      tooltip: '把两个内容拼成一段文字（可嵌套，用来组合多个数据）。'
    },

    // ---------------- Scratch 变量 / 列表 ---------------- //
    {
      type: 'sc_var_change',
      message0: '将 %1 增加 %2',
      args0: [
        { type: 'field_variable', name: 'VAR', variable: null },
        { type: 'input_value', name: 'VALUE' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FF8C1A',
      tooltip: '把变量按数值增加（负数就是减少）。'
    },
    {
      type: 'sc_list_add',
      message0: '将 %1 加入 %2',
      args0: [
        { type: 'input_value', name: 'VALUE' },
        { type: 'field_variable', name: 'LIST', variable: null, variableTypes: ['list'], defaultType: 'list' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FF661A',
      tooltip: '把一项加到列表末尾。'
    },
    {
      type: 'sc_list_clear',
      message0: '清空 %1',
      args0: [
        { type: 'field_variable', name: 'LIST', variable: null, variableTypes: ['list'], defaultType: 'list' }
      ],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FF661A',
      tooltip: '删除列表里的全部项目。'
    },
    {
      type: 'sc_list_delete',
      message0: '删除 %2 的第 %1 项',
      args0: [
        { type: 'input_value', name: 'INDEX' },
        { type: 'field_variable', name: 'LIST', variable: null, variableTypes: ['list'], defaultType: 'list' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FF661A',
      tooltip: '删除列表里指定位置的一项（从 1 开始）。'
    },
    {
      type: 'sc_list_insert',
      message0: '在 %2 的第 %1 项前插入 %3',
      args0: [
        { type: 'input_value', name: 'INDEX' },
        { type: 'field_variable', name: 'LIST', variable: null, variableTypes: ['list'], defaultType: 'list' },
        { type: 'input_value', name: 'VALUE' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FF661A',
      tooltip: '把一项插入到指定位置之前。'
    },
    {
      type: 'sc_list_replace',
      message0: '将 %2 的第 %1 项替换为 %3',
      args0: [
        { type: 'input_value', name: 'INDEX' },
        { type: 'field_variable', name: 'LIST', variable: null, variableTypes: ['list'], defaultType: 'list' },
        { type: 'input_value', name: 'VALUE' }
      ],
      inputsInline: true,
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FF661A',
      tooltip: '替换列表里指定位置的一项。'
    },
    {
      type: 'sc_list_item',
      message0: '%2 的第 %1 项',
      args0: [
        { type: 'input_value', name: 'INDEX' },
        { type: 'field_variable', name: 'LIST', variable: null, variableTypes: ['list'], defaultType: 'list' }
      ],
      inputsInline: true,
      output: null,
      colour: '#FF661A',
      tooltip: '读取列表指定位置的一项。'
    },
    {
      type: 'sc_list_index',
      message0: '%2 中第一个 %1 的编号',
      args0: [
        { type: 'input_value', name: 'VALUE' },
        { type: 'field_variable', name: 'LIST', variable: null, variableTypes: ['list'], defaultType: 'list' }
      ],
      inputsInline: true,
      output: 'Number',
      colour: '#FF661A',
      tooltip: '返回某一项在列表中的位置，找不到返回 0。'
    },
    {
      type: 'sc_list_length',
      message0: '%1 的长度',
      args0: [
        { type: 'field_variable', name: 'LIST', variable: null, variableTypes: ['list'], defaultType: 'list' }
      ],
      output: 'Number',
      colour: '#FF661A',
      tooltip: '列表里一共有多少项。'
    },
    {
      type: 'sc_list_contains',
      message0: '%1 包含 %2 ?',
      args0: [
        { type: 'field_variable', name: 'LIST', variable: null, variableTypes: ['list'], defaultType: 'list' },
        { type: 'input_value', name: 'VALUE' }
      ],
      inputsInline: true,
      output: 'Boolean',
      colour: '#FF661A',
      tooltip: '判断列表里是否包含某一项。'
    },

    // ---------------- 兼容旧项目（不在工具箱中） ---------------- //
    {
      type: 'vela_variable',
      message0: '变量 %1',
      args0: [
        { type: 'field_variable', name: 'VAR', variable: null }
      ],
      output: 'DATA',
      colour: 120,
      tooltip: '数据变量引用。'
    },
    {
      type: 'vela_text_with_var',
      message0: '文本（含变量） 内容 %1 字号 %2 颜色 %3 变量 %4',
      args0: [
        { type: 'field_input', name: 'CONTENT', text: '你好' },
        { type: 'field_number', name: 'SIZE', value: 20, min: 8, max: 96, precision: 1 },
        { type: 'field_colour', name: 'COLOR', colour: '#333333' },
        { type: 'field_variable', name: 'VAR', variable: 'TEXT_VARIABLE', text: '变量名' }
      ],
      previousStatement: 'UI',
      nextStatement: 'UI',
      colour: 120,
      tooltip: '显示一段文字，可以绑定页面数据变量。'
    },

    // ---------------- 克隆（Scratch 风格） ---------------- //
    {
      type: 'sc_when_clone_start',
      hat: 'cap',
      message0: '当作为克隆体启动时',
      args0: [],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      nextStatement: 'Action',
      colour: '#FFAB19',
      tooltip: '克隆体被创建时执行这里面的动作。'
    },
    {
      type: 'sc_clone',
      message0: '克隆 %1',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } }
      ],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FFAB19',
      tooltip: '复制一个角色成为克隆体。克隆体可以单独删除。'
    },
    {
      type: 'sc_delete_clone',
      message0: '删除此克隆体',
      args0: [],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FFAB19',
      tooltip: '删除最近创建的一个克隆体。'
    },
    {
      type: 'sc_delete_all_clones',
      message0: '删除所有克隆体',
      args0: [],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FFAB19',
      tooltip: '删除页面里所有角色的克隆体。'
    },
    {
      type: 'sc_delete_clones_of',
      message0: '删除 %1 的所有克隆体',
      args0: [
        { type: 'field_dropdown', name: 'TARGET', options: function () { return optionsFor('sprites'); } }
      ],
      previousStatement: 'Action',
      nextStatement: 'Action',
      colour: '#FFAB19',
      tooltip: '删除某个角色的全部克隆体。'
    }
  ];

  // ------------------------------------------------------------------ //
  // 全局生成上下文
  // ------------------------------------------------------------------ //
  var ctx = null;

  // 背景色统一选择器：可选的常用颜色 + “🚫 无背景”（空串表示不要背景）
  var BG_OPTIONS = [
    ['🚫 无背景', ''],
    ['白色', '#ffffff'],
    ['浅灰', '#f5f5f5'],
    ['黑色', '#000000'],
    ['深灰', '#4a4a4a'],
    ['红色', '#e05252'],
    ['橙色', '#ff9f1a'],
    ['黄色', '#ffcf3f'],
    ['绿色', '#37b26c'],
    ['蓝色', '#4f7df9'],
    ['紫色', '#7b63c9']
  ];
  var curPage = null;

  function resetCtx() {
    ctx = {
      imports: {},
      pages: [],
      usedVars: [],
      genErrors: [],
      styles: [],
      data: {},
      pageVars: {},
      scratchVars: {},
      methods: {},
      bcasts: [],
      uid: 0,
      usedMotion: false,
      movedVars: {},
      usedSay: false,
      center: null,
      procArgs: null,
      noSwipeExit: false,
      skipIds: {},
      sprites: [],
      backdrop: null,
      compBase: {},
      forever: null,
      waitAlias: ''
    };
    curPage = null;
  }

  function startPage(page) {
    curPage = page;
    ctx.styles = page.styles;
    ctx.data = page.data;
    ctx.methods = page.methods;
    ctx.pageVars = {};
    ctx.scratchVars = {};
    ctx.bcasts = page.bcasts;
    ctx.noSwipeExit = false;
    ctx.skipIds = {};
    ctx.sprites = Array.isArray(page.sprites) ? page.sprites : [];
    ctx.backdrop = page.backdrop || null;
    ctx.compBase = {};
    ctx.movedVars = {};
    ctx.forever = null;
    ctx.waitAlias = '';
    ctx.usedSay = false;
    ctx.clonedSprites = {};
  }

  function endPage() {
    if (!curPage) return;
    curPage.noSwipeExit = ctx.noSwipeExit;
    Object.keys(ctx.pageVars).forEach(function (v) {
      if (!(v in curPage.data)) curPage.data[v] = "''";
    });
    // Scratch 变量默认 0，列表默认空数组
    Object.keys(ctx.scratchVars).forEach(function (v) {
      if (!(v in curPage.data)) {
        curPage.data[v] = ctx.scratchVars[v] === 'list' ? '[]' : '0';
      }
    });
    curPage.content = assemblePage(curPage);
    ctx.pages.push(curPage);
    curPage = null;
  }

  function addModule(importName, featureName) {
    ctx.imports[importName] = featureName;
  }

  function indent(text, spaces) {
    var pad = new Array(spaces + 1).join(' ');
    return String(text).split('\n').map(function (l) { return l ? pad + l : l; }).join('\n');
  }

  function sanitizePageName(name) {
    var s = String(name || '').trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '');
    if (/^[0-9]/.test(s)) s = 'p' + s;
    return s || 'page';
  }

  function safeVarName(name) {
    var s = String(name || '').trim().replace(/[^A-Za-z0-9_$\u4e00-\u9fa5]/g, '_');
    if (!s) s = 'v';
    // Vela 快应用数据属性名不能以数字或 _ 开头：数字开头加字母前缀（不能加 _，否则真机拒绝）
    if (/^[0-9]/.test(s)) s = 'v' + s;
    return s;
  }

  function jsString(s) {
    return JSON.stringify(String(s));
  }

  // onclick="method('arg')"：Vela 事件绑定只认单引号字符串字面量（与手写源码一致），
  // 双引号会被模板引擎当作属性边界截断
  function jsArgString(s) {
    return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  }

  function recordVar(name) {
    ctx.pageVars[safeVarName(name)] = true;
  }

  // Scratch 变量/列表：记录类型，用于在数据区初始化（变量=0，列表=[]）
  function recordScratchVar(name, kind) {
    var v = safeVarName(name);
    ctx.scratchVars[v] = kind || 'value';
    return v;
  }

  function varNameOf(block, fieldName) {
    function modelName(m) {
      if (!m) return null;
      if (typeof m.getName === 'function') return m.getName();
      if (m.name != null) return String(m.name);
      return null;
    }
    try {
      var fv = block.getField(fieldName);
      if (fv && typeof fv.getVariable === 'function') {
        var n = modelName(fv.getVariable());
        if (n) return n;
      }
    } catch (e) { /* 继续尝试其它方式 */ }
    try {
      var m2 = modelName(Blockly.Variables.getVariable(block.workspace,
        block.getFieldValue(fieldName)));
      if (m2) return m2;
    } catch (e2) { /* 最终回退到字段值 */ }
    return block.getFieldValue(fieldName);
  }

  F['variables_get'] = function (block) {
    var name = varNameOf(block, 'VAR');
    // 函数参数是局部变量，直接用参数名，不挂到页面数据上
    if (ctx.procArgs && ctx.procArgs[safeVarName(name)]) {
      return [safeVarName(name), ORDER.ATOMIC];
    }
    recordScratchVar(name, 'value');
    return ['this.' + safeVarName(name), ORDER.ATOMIC];
  };
  F['variables_set'] = function (block) {
    var raw = varNameOf(block, 'VAR');
    var name = safeVarName(raw);
    var value = J.valueToCode(block, 'VALUE', ORDER.ASSIGNMENT) || 'null';
    if (ctx.procArgs && ctx.procArgs[name]) {
      return name + ' = ' + value + ';\n';
    }
    recordScratchVar(raw, 'value');
    return 'this.' + name + ' = ' + value + ';\n';
  };

  // ------------------------------------------------------------------ //
  // Scratch 积木代码生成（运动 / 外观 / 侦测 / 变量 / 列表）
  // ------------------------------------------------------------------ //
  function spriteBaseOf(name) {
    var key = String(name || '').trim();
    var list = ctx.sprites || [];
    for (var i = 0; i < list.length; i++) {
      var sp = list[i];
      if (sp && String(sp.name || '').trim() === key) {
        return { x: Number(sp.x) || 0, y: Number(sp.y) || 0 };
      }
    }
    var base = ctx.compBase[safeVarName(key)];
    return base || { x: 0, y: 0 };
  }

  function spriteTargetVars(block, field) {
    var name = block.getFieldValue(field || 'TARGET');
    var v = safeVarName(name);
    ensureComponentVars(v);
    ensureSpriteVars(v);
    return { name: name, v: v };
  }

  function ensureSayVars() {
    ctx.usedSay = true;
    if (!('dbx_say_text' in ctx.data)) ctx.data['dbx_say_text'] = "''";
    if (!('dbx_say_show' in ctx.data)) ctx.data['dbx_say_show'] = 'false';
  }

  // 克隆上下文：在「当作为克隆体启动时」里，对“所属角色”的运动 / 显示等操作
  // 应作用在刚创建的那个克隆体上，而不是原角色。
  function inCloneCtx(v) {
    return !!(ctx.cloneOwner && v === ctx.cloneOwner);
  }
  // 克隆体下标：克隆启动时先捕获到局部变量，
  // 这样等待 / 循环等异步回调里不会因为之后又新建了克隆体而指错对象
  function cloneIdxExpr(v) {
    return ctx.cloneIdx ? ctx.cloneIdx : 'Number(this.' + v + '_clone_idx)';
  }
  function spriteRead(v, field) {
    if (inCloneCtx(v)) {
      return '(Number((this.' + v + '_clones[' + cloneIdxExpr(v) + '] || {}).' + field + ') || 0)';
    }
    return '(Number(this.' + v + '_' + field + ') || 0)';
  }
  function spriteAssign(v, field, rhs) {
    if (inCloneCtx(v)) {
      var i = '_ci' + (++ctx.uid);
      // 位置/尺寸变化时同步刷新克隆体的绝对坐标 l/t（模板里直接使用 l/t 定位）
      var sync = (field === 'x' || field === 'y' || field === 'w' || field === 'h')
        ? '  _c.l = (Number(_c.cx) || 0) + (Number(_c.x) || 0) - (Number(_c.w) || 0) / 2;\n' +
          '  _c.t = (Number(_c.cy) || 0) + (Number(_c.y) || 0) - (Number(_c.h) || 0) / 2;\n'
        : '';
      return 'var ' + i + ' = ' + cloneIdxExpr(v) + ';\n' +
        'if (this.' + v + '_clones && this.' + v + '_clones[' + i + ']) {\n' +
        '  var _c = this.' + v + '_clones[' + i + '];\n' +
        '  _c.' + field + ' = ' + rhs + ';\n' +
        sync +
        '  this.' + v + '_clones = this.' + v + '_clones.slice();\n' +
        '}\n';
    }
    return 'this.' + v + '_' + field + ' = ' + rhs + ';\n';
  }

  F['sc_motion_goto'] = function (block) {
    var t = spriteTargetVars(block, 'TARGET');
    var base = spriteBaseOf(t.name);
    var x = J.valueToCode(block, 'X', ORDER.ASSIGNMENT) || '0';
    var y = J.valueToCode(block, 'Y', ORDER.ASSIGNMENT) || '0';
    // 需要 transform 才能让位移生效
    ctx.movedVars[t.v] = true;
    return spriteAssign(t.v, 'x', '(' + x + ') - ' + base.x) +
           spriteAssign(t.v, 'y', '(' + y + ') - ' + base.y);
  };
  F['sc_change_x'] = function (block) {
    var t = spriteTargetVars(block, 'TARGET');
    var dx = J.valueToCode(block, 'DX', ORDER.ASSIGNMENT) || '0';
    ctx.movedVars[t.v] = true;
    return spriteAssign(t.v, 'x', spriteRead(t.v, 'x') + ' + (' + dx + ')');
  };
  F['sc_change_y'] = function (block) {
    var t = spriteTargetVars(block, 'TARGET');
    var dy = J.valueToCode(block, 'DY', ORDER.ASSIGNMENT) || '0';
    ctx.movedVars[t.v] = true;
    return spriteAssign(t.v, 'y', spriteRead(t.v, 'y') + ' + (' + dy + ')');
  };
  F['sc_rotate_right'] = function (block) {
    var t = spriteTargetVars(block, 'TARGET');
    var rot = J.valueToCode(block, 'ROT', ORDER.ASSIGNMENT) || '0';
    ctx.movedVars[t.v] = true;
    return spriteAssign(t.v, 'rot', spriteRead(t.v, 'rot') + ' + (' + rot + ')');
  };
  F['sc_rotate_left'] = function (block) {
    var t = spriteTargetVars(block, 'TARGET');
    var rot = J.valueToCode(block, 'ROT', ORDER.ASSIGNMENT) || '0';
    ctx.movedVars[t.v] = true;
    return spriteAssign(t.v, 'rot', spriteRead(t.v, 'rot') + ' - (' + rot + ')');
  };
  F['sc_xpos'] = function (block) {
    var t = spriteTargetVars(block, 'TARGET');
    var base = spriteBaseOf(t.name);
    if (inCloneCtx(t.v)) return [spriteRead(t.v, 'x'), ORDER.ATOMIC];
    return ['((Number(this.' + t.v + '_x) || 0) + ' + base.x + ')', ORDER.ATOMIC];
  };
  F['sc_ypos'] = function (block) {
    var t = spriteTargetVars(block, 'TARGET');
    var base = spriteBaseOf(t.name);
    if (inCloneCtx(t.v)) return [spriteRead(t.v, 'y'), ORDER.ATOMIC];
    return ['((Number(this.' + t.v + '_y) || 0) + ' + base.y + ')', ORDER.ATOMIC];
  };
  F['sc_direction'] = function (block) {
    var t = spriteTargetVars(block, 'TARGET');
    return [spriteRead(t.v, 'rot'), ORDER.ATOMIC];
  };
  F['sc_say'] = function (block) {
    var text = J.valueToCode(block, 'TEXT', ORDER.ASSIGNMENT) || "''";
    ensureSayVars();
    return 'this.dbx_say_text = String(' + text + ');\n' +
           'this.dbx_say_show = true;\n';
  };
  F['sc_say_secs'] = function (block) {
    var text = J.valueToCode(block, 'TEXT', ORDER.ASSIGNMENT) || "''";
    var secs = J.valueToCode(block, 'SECS', ORDER.ASSIGNMENT) || '0';
    ensureSayVars();
    var alias = '_say' + (++ctx.uid);
    return 'this.dbx_say_text = String(' + text + ');\n' +
           'this.dbx_say_show = true;\n' +
           'var ' + alias + ' = this;\n' +
           'setTimeout(function () { ' + alias + '.dbx_say_show = false; }, Math.round((Number(' + secs + ') || 0) * 1000));\n';
  };
  F['sc_show'] = function (block) {
    var t = spriteTargetVars(block, 'TARGET');
    return spriteAssign(t.v, 'show', 'true');
  };
  F['sc_hide'] = function (block) {
    var t = spriteTargetVars(block, 'TARGET');
    return spriteAssign(t.v, 'show', 'false');
  };
  F['sc_costume'] = function (block) {
    if (F['vela_sprite_costume']) return F['vela_sprite_costume'](block);
    var t = spriteTargetVars(block, 'TARGET');
    var img = String(block.getFieldValue('COSTUME') || '');
    return spriteAssign(t.v, 'src', jsString(assetPath(img)));
  };
  F['sc_next_costume'] = function (block) {
    if (F['vela_sprite_nextcostume']) return F['vela_sprite_nextcostume'](block);
    var t = spriteTargetVars(block, 'TARGET');
    return 'this.' + t.v + '_ci = (Number(this.' + t.v + '_ci) || 0) + 1;\n';
  };
  F['sc_costume_number'] = function (block) {
    var t = spriteTargetVars(block, 'TARGET');
    return ['((Number(this.' + t.v + '_ci) || 0) + 1)', ORDER.ATOMIC];
  };
  // 背景（舞台）切换：图片放在页面最底层，由 dbx_bg_src / dbx_bg_ci 驱动
  F['sc_backdrop'] = function (block) {
    ensureBackdropVars();
    var name = String(block.getFieldValue('BACKDROP') || '').trim();
    var it = findBackdrop(name);
    if (!it) return '// 未选择背景\n';
    return 'this.dbx_bg_src = ' + jsString(assetPath(it.image)) + ';\n' +
           'this.dbx_bg_ci = ' + it.index + ';\n';
  };
  F['sc_next_backdrop'] = function () {
    ensureBackdropVars();
    var bd = ctx.backdrop;
    var list = (bd && Array.isArray(bd.costumes)) ? bd.costumes : [];
    var arr = '[' + (list.length
      ? list.map(function (it) { return jsString(assetPath(it && it.image)); }).join(', ')
      : '""') + ']';
    return 'this.dbx_bg_ci = ((Number(this.dbx_bg_ci) || 0) + 1) % ' +
           Math.max(1, list.length) + ';\n' +
           'this.dbx_bg_src = ' + arr + '[this.dbx_bg_ci];\n';
  };
  F['sc_backdrop_number'] = function () {
    ensureBackdropVars();
    return ['((Number(this.dbx_bg_ci) || 0) + 1)', ORDER.ATOMIC];
  };
  F['sc_timer'] = function () {
    if (!('dbx_timer_start' in ctx.data)) ctx.data['dbx_timer_start'] = 'Date.now()';
    return ['((Date.now() - (Number(this.dbx_timer_start) || Date.now())) / 1000)', ORDER.ATOMIC];
  };
  F['sc_timer_reset'] = function () {
    if (!('dbx_timer_start' in ctx.data)) ctx.data['dbx_timer_start'] = 'Date.now()';
    return 'this.dbx_timer_start = Date.now();\n';
  };
  F['sc_current_time'] = function (block) {
    var unit = block.getFieldValue('UNIT');
    var expr = 'new Date().getFullYear()';
    if (unit === 'MONTH') expr = '(new Date().getMonth() + 1)';
    else if (unit === 'DAY') expr = 'new Date().getDate()';
    else if (unit === 'HOUR') expr = 'new Date().getHours()';
    else if (unit === 'MINUTE') expr = 'new Date().getMinutes()';
    else if (unit === 'SECOND') expr = 'new Date().getSeconds()';
    else if (unit === 'WEEKDAY') expr = '(new Date().getDay() + 1)';
    return ['(' + expr + ')', ORDER.ATOMIC];
  };

  // ---------------- 侦测：角色 / 舞台 / 手指 ---------------- //
  // 角色边界（以屏幕中心为原点，与 Scratch 的 X/Y 一致）
  function spriteBoundsExpr(name) {
    var sp = findSprite(String(name || '').trim());
    if (!sp) return null;
    var v = safeVarName(sp.name);
    ensureComponentVars(v);
    var bx = Number(sp.x) || 0;
    var by = Number(sp.y) || 0;
    var w = Math.max(0, Math.round(Number(sp.w) || 0));
    var h = Math.max(0, Math.round(Number(sp.h) || 0));
    // 克隆体上下文里读的是克隆体自己的坐标 / 尺寸，而不是原角色
    var wE = inCloneCtx(v) ? '(' + spriteRead(v, 'w') + ')' : String(w);
    var hE = inCloneCtx(v) ? '(' + spriteRead(v, 'h') + ')' : String(h);
    var halfW = inCloneCtx(v) ? '(' + wE + ' / 2)' : String(w / 2);
    var halfH = inCloneCtx(v) ? '(' + hE + ' / 2)' : String(h / 2);
    var cxE = '((' + bx + ') + ' + spriteRead(v, 'x') + ')';
    var cyE = '((' + by + ') + ' + spriteRead(v, 'y') + ')';
    var left = '(' + cxE + ' - ' + halfW + ')';
    var top = '(' + cyE + ' - ' + halfH + ')';
    return {
      cx: cxE, cy: cyE,
      left: left, top: top, w: wE, h: hE,
      right: '(' + left + ' + ' + wE + ')',
      bottom: '(' + top + ' + ' + hE + ')'
    };
  }

  function stageSize() {
    return {
      w: (ctx.center && ctx.center.x) ? ctx.center.x * 2 : 0,
      h: (ctx.center && ctx.center.y) ? ctx.center.y * 2 : 0
    };
  }

  function ensureHitHelper() {
    var key = 'dbx_hit(ax, ay, aw, ah, bx, by, bw, bh)';
    if (!ctx.methods[key]) {
      ctx.methods[key] = 'return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;';
    }
  }

  function ensureTouchInfra() {
    if (curPage) curPage.needTouch = true;
    if (!('dbx_touch_down' in ctx.data)) ctx.data['dbx_touch_down'] = "'false'";
    if (!('dbx_touch_x' in ctx.data)) ctx.data['dbx_touch_x'] = '0';
    if (!('dbx_touch_y' in ctx.data)) ctx.data['dbx_touch_y'] = '0';
    if (!ctx.methods['dbx_on_touchstart(e)']) {
      ctx.methods['dbx_on_touchstart(e)'] =
        'var t = (e && e.touches && e.touches[0]) ? e.touches[0] : null;\n' +
        'this.dbx_touch_down = "true";\n' +
        'if (t) { this.dbx_touch_x = Math.round(t.clientX); this.dbx_touch_y = Math.round(t.clientY); }';
    }
    if (!ctx.methods['dbx_on_touchmove(e)']) {
      ctx.methods['dbx_on_touchmove(e)'] =
        'var t = (e && e.touches && e.touches[0]) ? e.touches[0] : null;\n' +
        'if (t) { this.dbx_touch_x = Math.round(t.clientX); this.dbx_touch_y = Math.round(t.clientY); }';
    }
    if (!ctx.methods['dbx_on_touchend(e)']) {
      ctx.methods['dbx_on_touchend(e)'] = 'this.dbx_touch_down = "false";';
    }
  }

  function ensureTapInfra() {
    if (curPage) curPage.needTap = true;
    if (!ctx.methods['dbx_on_tap(e)']) ctx.methods['dbx_on_tap(e)'] = '';
  }

  function ensureSwipeInfra() {
    if (curPage) curPage.needSwipe = true;
    if (!('dbx_swipe_dir' in ctx.data)) ctx.data['dbx_swipe_dir'] = "''";
    if (!ctx.methods['dbx_on_swipe(e)']) {
      ctx.methods['dbx_on_swipe(e)'] =
        'this.dbx_swipe_dir = (e && e.direction) ? e.direction : "";';
    }
  }

  F['sc_touching'] = function (block) {
    var selfName = block.getFieldValue('SELF');
    var other = block.getFieldValue('OTHER');
    var A = spriteBoundsExpr(selfName);
    if (!A) return ['false', ORDER.ATOMIC];
    if (other === '__edge__') {
      var ss = stageSize();
      if (!ss.w || !ss.h) return ['false', ORDER.ATOMIC];
      return ['(' + A.left + ' < ' + (-ss.w / 2) + ' || ' + A.right + ' > ' + (ss.w / 2) + ' || ' +
        A.top + ' < ' + (-ss.h / 2) + ' || ' + A.bottom + ' > ' + (ss.h / 2) + ')', ORDER.ATOMIC];
    }
    if (other === '__finger__') {
      var sf = stageSize();
      if (!sf.w || !sf.h) return ['false', ORDER.ATOMIC];
      ensureTouchInfra();
      var fx = '((Number(this.dbx_touch_x) || 0) - ' + (sf.w / 2) + ')';
      var fy = '((Number(this.dbx_touch_y) || 0) - ' + (sf.h / 2) + ')';
      return ['(' + fx + ' >= ' + A.left + ' && ' + fx + ' <= ' + A.right + ' && ' +
        fy + ' >= ' + A.top + ' && ' + fy + ' <= ' + A.bottom + ')', ORDER.ATOMIC];
    }
    var B = spriteBoundsExpr(other);
    if (!B) return ['false', ORDER.ATOMIC];
    ensureHitHelper();
    return ['this.dbx_hit(' + A.left + ', ' + A.top + ', ' + A.w + ', ' + A.h + ', ' +
      B.left + ', ' + B.top + ', ' + B.w + ', ' + B.h + ')', ORDER.ATOMIC];
  };

  F['sc_leaving_stage'] = function (block) {
    var A = spriteBoundsExpr(block.getFieldValue('SELF'));
    if (!A) return ['false', ORDER.ATOMIC];
    var ss = stageSize();
    if (!ss.w || !ss.h) return ['false', ORDER.ATOMIC];
    return ['(' + A.right + ' <= ' + (-ss.w / 2) + ' || ' + A.left + ' >= ' + (ss.w / 2) + ' || ' +
      A.bottom + ' <= ' + (-ss.h / 2) + ' || ' + A.top + ' >= ' + (ss.h / 2) + ')', ORDER.ATOMIC];
  };

  F['sc_when_sprite_clicked'] = function (block) {
    var target = String(block.getFieldValue('TARGET') || '').trim();
    var body = J.statementToCode(block, 'DO');
    if (!target) return '';
    addMethod(ctx.methods, 'onSprite_' + safeVarName(target), body);
    return '';
  };

  F['sc_sprite_prop'] = function (block) {
    var A = spriteBoundsExpr(block.getFieldValue('SELF'));
    if (!A) return ['0', ORDER.ATOMIC];
    var prop = block.getFieldValue('PROP');
    var sp = findSprite(String(block.getFieldValue('SELF') || '').trim());
    var v = sp ? safeVarName(sp.name) : '';
    if (!v) return ['0', ORDER.ATOMIC];
    if (prop === 'x') return [A.cx, ORDER.ATOMIC];
    if (prop === 'y') return [A.cy, ORDER.ATOMIC];
    if (prop === 'dir') return [spriteRead(v, 'rot'), ORDER.ATOMIC];
    if (prop === 'size') return [String(Math.max(0, Math.round(Number(sp.w) || 0))), ORDER.ATOMIC];
    if (prop === 'costume') return ['((' + spriteRead(v, 'ci') + ') + 1)', ORDER.ATOMIC];
    return ['0', ORDER.ATOMIC];
  };

  F['sc_distance_to'] = function (block) {
    var A = spriteBoundsExpr(block.getFieldValue('SELF'));
    var B = spriteBoundsExpr(block.getFieldValue('OTHER'));
    if (!A || !B) return ['0', ORDER.ATOMIC];
    return ['Math.round(Math.sqrt(Math.pow(' + A.cx + ' - ' + B.cx + ', 2) + Math.pow(' + A.cy + ' - ' + B.cy + ', 2)))', ORDER.ATOMIC];
  };

  F['sc_touch_down'] = function () {
    ensureTouchInfra();
    return ['(String(this.dbx_touch_down) === "true")', ORDER.ATOMIC];
  };
  F['sc_touch_x'] = function () {
    ensureTouchInfra();
    var ss = stageSize();
    // 与全项目坐标一致：0 = 屏幕中心，向右为正
    return ['((Number(this.dbx_touch_x) || 0) - ' + (ss.w / 2) + ')', ORDER.ATOMIC];
  };
  F['sc_touch_y'] = function () {
    ensureTouchInfra();
    var ss = stageSize();
    // 与全项目坐标一致：0 = 屏幕中心，向下为正
    return ['((Number(this.dbx_touch_y) || 0) - ' + (ss.h / 2) + ')', ORDER.ATOMIC];
  };
  F['sc_swipe_dir'] = function () {
    ensureSwipeInfra();
    return ['(this.dbx_swipe_dir || "")', ORDER.ATOMIC];
  };
  F['sc_when_stage_clicked'] = function (block) {
    var body = J.statementToCode(block, 'DO');
    ensureTapInfra();
    addMethod(ctx.methods, 'dbx_on_tap(e)', body);
    return '';
  };
  F['sc_when_swipe'] = function (block) {
    var dir = block.getFieldValue('DIR') || 'any';
    var body = J.statementToCode(block, 'DO');
    ensureSwipeInfra();
    var code = body;
    if (dir !== 'any') {
      code = 'if (e && e.direction === ' + jsString(dir) + ') {\n' + indent(body, 2) + '}';
    }
    addMethod(ctx.methods, 'dbx_on_swipe(e)', code);
    return '';
  };

  // 运算：A 与 B（拼接，可嵌套组合多个数据）
  F['sc_join'] = function (block) {
    var a = J.valueToCode(block, 'A', ORDER.NONE) || "''";
    var b = J.valueToCode(block, 'B', ORDER.NONE) || "''";
    return ['(String(' + a + ') + String(' + b + '))', ORDER.ATOMIC];
  };
  F['sc_var_change'] = function (block) {
    var raw = varNameOf(block, 'VAR');
    var name = safeVarName(raw);
    var value = J.valueToCode(block, 'VALUE', ORDER.ASSIGNMENT) || '0';
    if (ctx.procArgs && ctx.procArgs[name]) {
      return name + ' = (Number(' + name + ') || 0) + (' + value + ');\n';
    }
    recordScratchVar(raw, 'value');
    return 'this.' + name + ' = (Number(this.' + name + ') || 0) + (' + value + ');\n';
  };

  // 列表：全部用 JS 数组实现，改完后整体回写，便于预览监视面板刷新
  function scratchList(block) {
    var raw = varNameOf(block, 'LIST');
    return { name: raw, v: recordScratchVar(raw, 'list') };
  }
  function listIndexExpr(block) {
    var idx = J.valueToCode(block, 'INDEX', ORDER.NONE) || '1';
    return 'Math.max(0, (Number(' + idx + ') || 1) - 1)';
  }
  F['sc_list_add'] = function (block) {
    var L = scratchList(block);
    var val = J.valueToCode(block, 'VALUE', ORDER.NONE) || "''";
    return 'this.' + L.v + ' = (this.' + L.v + ' || []).concat([' + val + ']);\n';
  };
  F['sc_list_clear'] = function (block) {
    var L = scratchList(block);
    return 'this.' + L.v + ' = [];\n';
  };
  F['sc_list_delete'] = function (block) {
    var L = scratchList(block);
    var tmp = '_l' + (++ctx.uid);
    return 'var ' + tmp + ' = (this.' + L.v + ' || []).slice();\n' +
           tmp + '.splice(' + listIndexExpr(block) + ', 1);\n' +
           'this.' + L.v + ' = ' + tmp + ';\n';
  };
  F['sc_list_insert'] = function (block) {
    var L = scratchList(block);
    var val = J.valueToCode(block, 'VALUE', ORDER.NONE) || "''";
    var tmp = '_l' + (++ctx.uid);
    return 'var ' + tmp + ' = (this.' + L.v + ' || []).slice();\n' +
           tmp + '.splice(' + listIndexExpr(block) + ', 0, ' + val + ');\n' +
           'this.' + L.v + ' = ' + tmp + ';\n';
  };
  F['sc_list_replace'] = function (block) {
    var L = scratchList(block);
    var val = J.valueToCode(block, 'VALUE', ORDER.NONE) || "''";
    var tmp = '_l' + (++ctx.uid);
    return 'var ' + tmp + ' = (this.' + L.v + ' || []).slice();\n' +
           tmp + '.splice(' + listIndexExpr(block) + ', 1, ' + val + ');\n' +
           'this.' + L.v + ' = ' + tmp + ';\n';
  };
  F['sc_list_item'] = function (block) {
    var L = scratchList(block);
    return ['((this.' + L.v + ' || [])[' + listIndexExpr(block) + '])', ORDER.ATOMIC];
  };
  F['sc_list_index'] = function (block) {
    var L = scratchList(block);
    var val = J.valueToCode(block, 'VALUE', ORDER.NONE) || "''";
    return ['((this.' + L.v + ' || []).indexOf(' + val + ') + 1)', ORDER.ATOMIC];
  };
  F['sc_list_length'] = function (block) {
    var L = scratchList(block);
    return ['((this.' + L.v + ' || []).length)', ORDER.ATOMIC];
  };
  F['sc_list_contains'] = function (block) {
    var L = scratchList(block);
    var val = J.valueToCode(block, 'VALUE', ORDER.NONE) || "''";
    return ['((this.' + L.v + ' || []).indexOf(' + val + ') >= 0)', ORDER.ATOMIC];
  };

  // ------------------------------------------------------------------ //
  // 命名组件：位置 / 旋转 / 显示状态 全部用数据驱动
  // ------------------------------------------------------------------ //
  function ensureComponentVars(v) {
    if (!(v + '_x' in ctx.data)) ctx.data[v + '_x'] = '0';
    if (!(v + '_y' in ctx.data)) ctx.data[v + '_y'] = '0';
    if (!(v + '_rot' in ctx.data)) ctx.data[v + '_rot'] = '0';
    if (!(v + '_show' in ctx.data)) ctx.data[v + '_show'] = 'true';
  }
  // 角色额外的造型相关数据：图片路径 + 造型序号
  function ensureSpriteVars(v) {
    if (!(v + '_src' in ctx.data)) ctx.data[v + '_src'] = "''";
    if (!(v + '_ci' in ctx.data)) ctx.data[v + '_ci'] = '0';
  }
  // 克隆：每个角色一份克隆数组（对象列表），以及全局的创建顺序栈
  function ensureCloneVar(v) {
    if (!(v + '_clones' in ctx.data)) ctx.data[v + '_clones'] = '[]';
    if (!(v + '_clone_idx' in ctx.data)) ctx.data[v + '_clone_idx'] = '-1';
    ensureCloneOrder();
  }
  function ensureCloneOrder() {
    if (!('dbx_clone_order' in ctx.data)) ctx.data['dbx_clone_order'] = '[]';
  }

  // 组件在预览里拖动出的位置/尺寸，序列化进积木的 `data` 属性。
  // Blockly 会自动把 block.data 写进积木 XML 并随项目保存/恢复（无需可见字段）。
  function getLayout(block) {
    var l = { x: 0, y: 0, w: 0, h: 0 };
    var raw = block && block.data;
    if (raw && typeof raw === 'string' && raw.length) {
      try {
        var o = JSON.parse(raw);
        if (o) {
          l.x = (+o.x) || 0; l.y = (+o.y) || 0;
          l.w = (+o.w) || 0; l.h = (+o.h) || 0;
        }
      } catch (e) { /* 忽略坏数据 */ }
      return l;
    }
    // 新积木无 data 时，用积木字段里的宽高/坐标作为初始布局（保证可见、非 0）
    if (block) {
      var fv = function (n) {
        var v = block.getFieldValue(n);
        return (v == null || v === '') ? 0 : ((parseFloat(v) || 0));
      };
      if (block.type === 'vela_image') {
        l.w = fv('WIDTH'); l.h = fv('HEIGHT'); l.x = fv('X'); l.y = fv('Y');
      } else {
        l.w = fv('W'); l.h = fv('H'); l.x = fv('X'); l.y = fv('Y');
      }
    }
    return l;
  }
  function setLayout(block, l) {
    var data = { x: Math.round(l.x) || 0, y: Math.round(l.y) || 0,
                 w: Math.round(l.w) || 0, h: Math.round(l.h) || 0 };
    block.data = JSON.stringify(data);
    return data;
  }
  function blockLayout(block) {
    return getLayout(block);
  }

  function componentAttrs(rawName, x, y, layer, w, h, rot, extraStyle) {
    var v = rawName ? safeVarName(rawName) : '';
    var s = '';
    if (v) {
      ensureComponentVars(v);
      // 用 transform 移动 / 旋转（只对真正被移动过的对象输出，
      // 避免给所有组件写 translate(0px,0px) rotate(0deg) —— 手环 ferry 会断言崩溃）
      if (ctx.movedVars && ctx.movedVars[v]) {
        s += 'transform: translate({{' + v + '_x}}px, {{' + v + '_y}}px) rotate({{' + v + '_rot}}deg);';
      } else if (rot) {
        // 角色自带方向（静态旋转），只旋转该组件，不动其它组件
        s += 'transform: rotate(' + Math.round(rot) + 'deg);';
      }
    }
    // 所有组件统一定位为绝对定位，坐标原点在屏幕中心（0,0 = 正中），X 向右、Y 向下（可为负）。
    // (X,Y) 指组件中心点：left = 屏宽/2 + X − 宽/2（宽高未知=自适应时退化为左上角锚点）。
    // 不使用 flex 流式布局，彻底消除“位置跟随积木摆放顺序”的自动堆叠。
    var _cx = (ctx.center && ctx.center.x) || 0;
    var _cy = (ctx.center && ctx.center.y) || 0;
    var _ox = w ? Math.round(w / 2) : 0;
    var _oy = h ? Math.round(h / 2) : 0;
    s += 'position: absolute; left: ' + Math.round(_cx + (x || 0) - _ox) + 'px; top: ' +
      Math.round(_cy + (y || 0) - _oy) + 'px;';
    if (w || h) {
      s += (w ? ' width: ' + w + 'px;' : '') + (h ? ' height: ' + h + 'px;' : '');
    }
    if (layer) {
      s += ' z-index: ' + layer + ';';
    }
    if (extraStyle) s += extraStyle;
    return (s ? ' style="' + s + '"' : '') + (v ? ' show="{{' + v + '_show}}"' : '');
  }

  // 组件 class：uid 样式类 + 预览编辑标记（dbxc-名称，仅预览使用，真机无效类）
  function uiClass(cls, rawName) {
    return rawName ? cls + ' dbxc-' + encodeURIComponent(rawName.trim()) : cls;
  }

  // ------------------------------------------------------------------ //
  // 页面组装
  // ------------------------------------------------------------------ //
  function assembleImports() {
    var lines = [];
    if ('router' in ctx.imports) lines.push("import router from '@system.router'");
    if ('prompt' in ctx.imports) lines.push("import prompt from '@system.prompt'");
    if ('vibrator' in ctx.imports) lines.push("import vibrator from '@system.vibrator'");
    if ('battery' in ctx.imports) lines.push("import battery from '@system.battery'");
    if ('storage' in ctx.imports) lines.push("import storage from '@system.storage'");
    if ('app' in ctx.imports) lines.push("import app from '@system.app'");
    return lines;
  }

  function assemblePage(page) {
    Object.keys(ctx.pageVars).forEach(function (v) {
      if (!(v in page.data)) page.data[v] = "''";
    });

    var dataLines = Object.keys(page.data).map(function (k) {
      return '    ' + k + ': ' + page.data[k] + ',';
    });

    var methodNames = Object.keys(page.methods);
    var methodsText = methodNames.map(function (n) {
      var body = page.methods[n].trim() || '/* 空 */';
      // 带参方法：key 形如 onKey(val)，直接作为签名输出
      var sig = n.indexOf('(') >= 0 ? n : n + '()';
      return '  ' + sig + ' {\n' + indent(body, 4) + '\n  }';
    }).join(',\n\n');

    // 广播接收注册（onInit 生命周期里 $on）
    if (page.bcasts && page.bcasts.length) {
      // 多个角色 / 背景可能都接收同一个广播：同名事件只注册一次，避免重复执行
      var seenBc = {};
      var reg = page.bcasts.map(function (b) {
        var k = b.ev + '|' + b.method;
        if (seenBc[k]) return '';
        seenBc[k] = true;
        return '    this.$on(' + jsString(b.ev) + ', this.' + b.method + ');';
      }).filter(Boolean).join('\n');
      methodsText += (methodsText ? ',\n\n' : '') + '  onInit() {\n' + reg + '\n  }';
    }

    // 左滑返回手势：默认所有页面左滑直接退出快应用；
    // 页面里有「关闭左滑退出」积木时，左滑不退出（返回 true 拦截系统默认行为）
    if (page.noSwipeExit) {
      methodsText += (methodsText ? ',\n\n' : '') +
        '  onBackPress() {\n    return true;\n  }';
    } else {
      addModule('app', 'system.app');
      methodsText += (methodsText ? ',\n\n' : '') +
        '  onBackPress() {\n    app.terminate();\n    return true;\n  }';
    }

    var script = '<script>\n';
    var imports = assembleImports();
    if (imports.length) script += imports.join('\n') + '\n\n';
    script += '  export default {\n';
    script += '    private: {\n' + (dataLines.join('\n') || '') + '\n    },\n';
    if (methodsText) script += '\n' + methodsText + '\n';
    script += '  }\n';
    script += '</script>';

    var rootAttrs = ' style="position: relative;"';
    if (page.needTouch) {
      rootAttrs += ' ontouchstart="dbx_on_touchstart" ontouchmove="dbx_on_touchmove" ontouchend="dbx_on_touchend"';
    }
    if (page.needTap) rootAttrs += ' onclick="dbx_on_tap"';
    if (page.needSwipe) rootAttrs += ' onswipe="dbx_on_swipe"';
    var template = '<template>\n' +
      '  <div class="page"' + rootAttrs + '>\n' +
      (page.ui ? indent(page.ui.trim(), 4) : indent('<text>' + escHtml(page.title || '欢迎使用 Duck Box') + '</text>', 4)) +
      '\n  </div>\n' +
      '</template>';

    var style = '<style>\n' +
      '  .page {\n' +
      '    flex-direction: column;\n' +
      '    width: 100%;\n' +
      '    height: 100%;\n' +
      '    align-items: center;\n' +
      '    justify-content: center;\n' +
      '  }\n' +
      (page.styles.length ? '\n' + page.styles.map(function (s) {
        return '  .' + s.sel + ' {\n    ' + s.decls + '\n  }';
      }).join('\n') + '\n' : '') +
      '</style>';

    return template + '\n\n' + style + '\n\n' + script + '\n';
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function addMethod(methods, name, body) {
    if (!methods[name]) methods[name] = '';
    methods[name] += body;
  }

  // ------------------------------------------------------------------ //
  // 各积木的代码生成
  // ------------------------------------------------------------------ //
  F['vela_div'] = function (block) {
    var name = (block.getFieldValue('NAME') || '').trim();
    var dir = block.getFieldValue('DIRECTION');
    var w = String(block.getFieldValue('WIDTH') || 'auto').trim() || 'auto';
    var h = String(block.getFieldValue('HEIGHT') || 'auto').trim() || 'auto';
    var bg = block.getFieldValue('BG');
    var layer = Number(blockFieldValueDefault(block, 'LAYER', 0)) || 0;
    var children = J.statementToCode(block, 'CHILDREN');
    var cls = nextUid();
    addStyle(cls,
      'flex-direction: ' + dir + ';' +
      ' width: ' + cssSize(w) + '; height: ' + cssSize(h) + ';' +
      (bg ? ' background-color: ' + bg + ';' : '') +
      ' border-radius: 16px; padding: 12px; margin: 8px;');
    return '<div class="' + cls + '"' + componentAttrs(name, 0, 0, layer) + '>\n' + (children ? indent(children, 2) : '') + '</div>\n';
  };

  function cssSize(v) {
    v = String(v).trim();
    if (/^-?[0-9.]+$/.test(v)) return v + 'px';
    return v;
  }

  function nextUid() {
    return 'd' + (++ctx.uid);
  }

  function addStyle(sel, decls) {
    ctx.styles.push({ sel: sel, decls: decls });
  }

  function templateText(s) {
    return escHtml(String(s == null ? '' : s));
  }

  F['vela_text'] = function (block) {
    var name = (block.getFieldValue('NAME') || '').trim();
    var content = block.getFieldValue('CONTENT') || '';
    var bind = String(blockFieldValueDefault(block, 'BIND', '') || '').trim();
    var size = Number(block.getFieldValue('SIZE')) || 20;
    var color = block.getFieldValue('COLOR');
    var bg = (blockFieldValueDefault(block, 'BACKGROUND', '') || '').trim();
    var layer = Number(blockFieldValueDefault(block, 'LAYER', 0)) || 0;
    var L = blockLayout(block);
    var cls = nextUid();
    var bgDecl = (bg && bg.toLowerCase() !== 'transparent') ? ' background-color: ' + bg + ';' : '';
    addStyle(cls, 'font-size: ' + size + 'px;' + (color ? ' color: ' + color + ';' : ' color: #333333;') + bgDecl + ' padding: 8px 12px; border-radius: 8px;');

    // 绑定变量：自动追加 {{变量}}（内容里手写 {{}} 的仍然保留）
    var display = content;
    if (bind) {
      recordVar(bind);
      var bv = safeVarName(bind);
      display = content ? content + ' {{' + bv + '}}' : '{{' + bv + '}}';
    }
    var inner = /\{\{.*\}\}/.test(display) ? display : templateText(display);
    return '<text class="' + uiClass(cls, name) + '"' + componentAttrs(name, L.x, L.y, layer, L.w, L.h) + '>' + inner + '</text>\n';
  };

  F['vela_variable'] = function (block) {
    var varName = block.getFieldValue('VAR');
    return '{{' + safeVarName(varName) + '}}';
  };

  F['vela_image'] = function (block) {
    var name = (block.getFieldValue('NAME') || '').trim();
    var src = (block.getFieldValue('SRC') || '/common/logo.png').trim();
    var w = Number(block.getFieldValue('WIDTH')) || 80;
    var h = Number(block.getFieldValue('HEIGHT')) || 80;
    var r = Number(block.getFieldValue('RADIUS')) || 0;
    var ev = (block.getFieldValue('EVENT') || '').trim();
    var L = blockLayout(block);
    var layer = Number(blockFieldValueDefault(block, 'LAYER', 0)) || 0;
    var cls = nextUid();
    addStyle(cls, 'width: ' + w + 'px; height: ' + h + 'px;' + (r ? ' border-radius: ' + r + 'px;' : ''));
    var attrs = componentAttrs(name, L.x, L.y, layer, L.w, L.h);
    if (ev) attrs += ' onclick="' + escHtml(safeMethodName(ev)) + '"';
    return '<image class="' + uiClass(cls, name) + '" src="' + escHtml(src) + '"' + attrs + '></image>\n';
  };

  F['vela_button'] = function (block) {
    var name = (block.getFieldValue('NAME') || '').trim();
    var label = blockFieldValueDefault(block, 'LABEL', '按钮');
    var actionType = block.getFieldValue('ACTION') || 'event';
    var target = blockFieldValueDefault(block, 'TARGET', 'onTap');
    var bg = block.getFieldValue('BG');
    var fg = block.getFieldValue('FG');
    var fs = Number(blockFieldValueDefault(block, 'FS', 22)) || 22;
    var L = blockLayout(block);
    var layer = Number(blockFieldValueDefault(block, 'LAYER', 0)) || 0;

    var cls = nextUid();
    addStyle(cls,
      (bg ? ' background-color: ' + bg + ';' : '') +
      ' color: ' + (fg || '#ffffff') + ';' +
      ' border-radius: 12px; text-align: center;' +
      ' padding: ' + Math.max(4, Math.round(fs * 0.6)) + 'px ' + Math.max(10, Math.round(fs * 1.4)) + 'px; font-size: ' + fs + 'px; margin: 10px;');

    var attrs = componentAttrs(name, L.x, L.y, layer, L.w, L.h);

    // Vela 没有 <button> 组件，按钮统一用 <input type="button"> 实现
    if (actionType === 'navigate') {
      var pageName = sanitizePageName(target);
      var mName = 'goTo_' + pageName;
      addModule('router', 'system.router');
      addMethod(ctx.methods, mName, "router.push({ uri: '/" + pageName + "' });");
      return '<input type="button" class="' + uiClass(cls, name) + '" value="' + templateText(label) + '"' + attrs + ' onclick="' + mName + '"></input>\n';
    } else {
      var isLong = /^long:/i.test(target);
      var ev = isLong ? target.replace(/^long:/i, '') : target;
      var attr = isLong ? 'onlongpress' : 'onclick';
      // 可选传参：留空就是普通点击；填了就把字面量传给事件（同页面内用「当前点击参数」读取）
      var param = blockFieldValueDefault(block, 'PARAM', '').trim();
      var call = param
        ? safeMethodName(ev) + '(' + jsArgString(param) + ')'
        : safeMethodName(ev);
      return '<input type="button" class="' + uiClass(cls, name) + '" value="' + templateText(label) + '"' + attrs + ' ' + attr + '="' + escHtml(call) + '"></input>\n';
    }
  };

  F['vela_button_param'] = function (block) {
    var name = (block.getFieldValue('NAME') || '').trim();
    var label = blockFieldValueDefault(block, 'LABEL', '按键');
    var ev = (blockFieldValueDefault(block, 'EVENT', 'onKey') || 'onKey').trim();
    var param = blockFieldValueDefault(block, 'PARAM', '');
    var bg = block.getFieldValue('BG');
    var fg = block.getFieldValue('FG');
    var fs = Number(blockFieldValueDefault(block, 'FS', 22)) || 22;
    var L = blockLayout(block);
    var layer = Number(blockFieldValueDefault(block, 'LAYER', 0)) || 0;

    var cls = nextUid();
    addStyle(cls,
      (bg ? ' background-color: ' + bg + ';' : '') +
      ' color: ' + (fg || '#ffffff') + ';' +
      ' border-radius: 12px; text-align: center;' +
      ' padding: ' + Math.max(4, Math.round(fs * 0.6)) + 'px ' + Math.max(10, Math.round(fs * 1.4)) + 'px; font-size: ' + fs + 'px; margin: 10px;');

    var attrs = componentAttrs(name, L.x, L.y, layer, L.w, L.h);
    // 参数统一按字符串字面量传入（数字/文字都行），事件里用「当前点击参数」取到；
    // 用单引号字面量，Vela 真机才能正确解析（双引号会被当作属性边界截断）
    var arg = jsArgString(param);
    return '<input type="button" class="' + uiClass(cls, name) + '" value="' + templateText(label) + '"' + attrs + ' onclick="' + escHtml(safeMethodName(ev) + '(' + arg + ')') + '"></input>\n';
  };

  function blockFieldValueDefault(block, field, dflt) {
    var v = '';
    try { v = block.getFieldValue(field); } catch (e) { /* ignore */ }
    return (v === '' || v == null) ? dflt : v;
  }

  F['vela_progress'] = function (block) {
    var name = (block.getFieldValue('NAME') || '').trim();
    var percent = J.valueToCode(block, 'PERCENT', ORDER.NONE);
    var pType = block.getFieldValue('TYPE');
    var color = block.getFieldValue('COLOR');
    var L = blockLayout(block);
    var layer = Number(blockFieldValueDefault(block, 'LAYER', 0)) || 0;
    var cls = nextUid();
    addStyle(cls,
      'width: ' + (L.w || 200) + 'px; height: ' + (L.h || (pType === 'arc' ? 200 : 16)) + 'px; color: ' + color + ';' +
      (pType === 'arc' ? ' stroke-width: 24px;' : '') +
      ' background-color: rgba(255, 255, 255, 0.2);');
    var percentAttr = '';
    if (percent) {
      if (percent.indexOf('this.') === 0) {
        percentAttr = ' percent="{{' + percent.slice(5) + '}}"';
      } else {
        percentAttr = ' percent="' + percent.replace(/["']/g, '') + '"';
      }
    }
    var attrs = componentAttrs(name, L.x, L.y, layer, L.w, L.h);
    return '<progress class="' + uiClass(cls, name) + '" type="' + pType + '"' + percentAttr + attrs + '></progress>\n';
  };

  F['vela_switch'] = function (block) {
    var name = (block.getFieldValue('NAME') || '').trim();
    var checked = block.getFieldValue('CHECKED') === 'true';
    var L = blockLayout(block);
    var layer = Number(blockFieldValueDefault(block, 'LAYER', 0)) || 0;
    var cls = nextUid();
    addStyle(cls, 'width: ' + (L.w || 80) + 'px; height: ' + (L.h || 40) + 'px;');

    var bindAttr = '';
    if (name) {
      var v = safeVarName(name);
      // 真机上 {{v}} 必须先在 data 里声明，否则开关状态显示为 undefined
      if (!(v in ctx.data)) ctx.data[v] = checked ? 'true' : 'false';
      bindAttr = ' checked="{{' + v + '}}" onchange="onSwitch_' + v + '"';
      addMethod(ctx.methods, 'onSwitch_' + v, 'this.' + v + ' = e.checked;');
    } else {
      bindAttr = checked ? ' checked="true"' : '';
    }

    var attrs = componentAttrs(name, L.x, L.y, layer, L.w, L.h);
    return '<switch class="' + uiClass(cls, name) + '"' + bindAttr + attrs + '></switch>\n';
  };

  F['vela_slider'] = function (block) {
    var name = (block.getFieldValue('NAME') || '').trim();
    var min = Number(block.getFieldValue('MIN')) || 0;
    var max = Number(block.getFieldValue('MAX')) || 100;
    var value = Number(block.getFieldValue('VALUE')) || 50;
    var L = blockLayout(block);
    var layer = Number(blockFieldValueDefault(block, 'LAYER', 0)) || 0;
    var cls = nextUid();
    addStyle(cls, 'width: ' + (L.w || 240) + 'px; height: ' + (L.h || 40) + 'px;');

    // 绑定变量时 value 只用 {{v}}，避免同一个 value 属性出现两次导致真机异常
    var valueAttr = ' value="{{' + safeVarName(name) + '}}"';
    if (name) {
      var v = safeVarName(name);
      if (!(v in ctx.data)) ctx.data[v] = String(value);
      addMethod(ctx.methods, 'onSlider_' + v, 'this.' + v + ' = e.progress;');
    } else {
      valueAttr = ' value="' + value + '"';
    }

    var attrs = componentAttrs(name, L.x, L.y, layer, L.w, L.h);
    return '<slider class="' + uiClass(cls, name) + '"' + valueAttr + ' min="' + min + '" max="' + max + '"' +
      (name ? ' onchange="onSlider_' + safeVarName(name) + '"' : '') + attrs + '></slider>\n';
  };

  F['vela_onclick'] = function (block) {
    var ev = (blockFieldValueDefault(block, 'EVENT', 'onTap') || 'onTap').trim().replace(/^long:/i, '');
    var param = (blockFieldValueDefault(block, 'PARAM', '参数') || '参数').trim();
    // 统一带一个参数签名：没传参的按钮进来时参数为 undefined；
    // 这样「当前点击参数」在任何点击事件里都能取到值
    var prev = ctx.paramName;
    ctx.paramName = param;
    var body = J.statementToCode(block, 'DO');
    ctx.paramName = prev;
    addMethod(ctx.methods, safeMethodName(ev) + '(' + param + ')', body);
    return '';
  };

  F['vela_onclick_param'] = function (block) {
    var ev = (blockFieldValueDefault(block, 'EVENT', 'onKey') || 'onKey').trim();
    var param = (blockFieldValueDefault(block, 'PARAM', 'val') || 'val').trim();
    // 生成事件体前记录参数名，「当前点击参数」积木据此输出同名变量
    var prev = ctx.paramName;
    ctx.paramName = param;
    var body = J.statementToCode(block, 'DO');
    ctx.paramName = prev;
    // 方法 key 形如 onKey(val)，assemblePage 会输出带参签名
    addMethod(ctx.methods, safeMethodName(ev) + '(' + param + ')', body);
    return '';
  };

  F['vela_click_param'] = function (block) {
    return [ctx.paramName || 'param', ORDER.ATOMIC];
  };

  F['vela_onlongpress'] = function (block) {
    var ev = (blockFieldValueDefault(block, 'EVENT', 'onLong') || 'onLong').trim().replace(/^long:/i, '');
    var body = J.statementToCode(block, 'DO');
    addMethod(ctx.methods, safeMethodName(ev), body);
    return '';
  };

  function safeMethodName(n) {
    var s = safeVarName(n);
    return /^[0-9]/.test(s) ? 'ev_' + s : s;
  }

  F['vela_onshow'] = function (block) {
    addMethod(ctx.methods, 'onShow', J.statementToCode(block, 'DO'));
    return '';
  };

  F['vela_onhide'] = function (block) {
    addMethod(ctx.methods, 'onHide', J.statementToCode(block, 'DO'));
    return '';
  };

  F['vela_onready'] = function (block) {
    // 手环没有「开始按钮」：进入页面即执行，挂在 onShow 上（每次进入页面都会触发）
    addMethod(ctx.methods, 'onShow', J.statementToCode(block, 'DO'));
    return '';
  };

  F['vela_data'] = function (block) {
    var raw = (block.getFieldValue('NAME') || '').trim();
    if (!raw) return '';
    var name = safeVarName(raw);
    recordVar(raw);
    var val = J.valueToCode(block, 'VALUE', ORDER.NONE) || "''";
    ctx.data[name] = val;
    return '';
  };

  F['vela_router_push'] = function (block) {
    addModule('router', 'system.router');
    var page = sanitizePageName(block.getFieldValue('PAGE'));
    return "router.push({ uri: '/" + page + "' });\n";
  };

  F['vela_router_push_param'] = function (block) {
    addModule('router', 'system.router');
    var page = sanitizePageName(block.getFieldValue('PAGE'));
    var pairs = [];
    ['1', '2', '3'].forEach(function (n) {
      var k = (block.getFieldValue('K' + n) || '').trim();
      var v = J.valueToCode(block, 'V' + n, ORDER.NONE);
      if (k && v) pairs.push(safeVarName(k) + ': ' + v);
    });
    var params = pairs.length ? ', params: { ' + pairs.join(', ') + ' }' : '';
    return "router.push({ uri: '/" + page + "'" + params + " });\n";
  };

  F['vela_router_back'] = function () {
    addModule('router', 'system.router');
    return 'router.back();\n';
  };

  F['vela_exit_app'] = function () {
    addModule('app', 'system.app');
    return 'app.terminate();\n';
  };

  F['vela_swipe_exit_off'] = function () {
    // 页面级设置：本页面关闭「左滑退出快应用」
    ctx.noSwipeExit = true;
    return '';
  };

  F['vela_toast'] = function (block) {
    addModule('prompt', 'system.prompt');
    var msg = J.valueToCode(block, 'MESSAGE', ORDER.NONE) || "''";
    var d = Number(blockFieldValueDefault(block, 'DURATION', 1500)) || 1500;
    return 'prompt.showToast({ message: String(' + msg + '), duration: ' + d + ' });\n';
  };

  F['vela_vibrate'] = function (block) {
    addModule('vibrator', 'system.vibrator');
    var mode = block.getFieldValue('MODE');
    return "vibrator.vibrate({ mode: '" + mode + "' });\n";
  };

  F['vela_log'] = function (block) {
    var msg = J.valueToCode(block, 'MESSAGE', ORDER.NONE) || "''";
    return 'console.log("[DuckBox]", ' + msg + ');\n';
  };

  F['vela_battery_get'] = function (block) {
    addModule('battery', 'system.battery');
    var varName = safeVarName(blockFieldValueDefault(block, 'VAR', '电量'));
    recordVar(blockFieldValueDefault(block, 'VAR', '电量'));
    var body = J.statementToCode(block, 'DO');
    var inner = 'this.' + varName + ' = Math.round((ret.level || 0) * 100);\n' + body;
    return 'var _t = this;\n' +
      'battery.getStatus({ success: function (ret) {\n' +
      indent(inner.replace(/\bthis\./g, '_t.'), 2) +
      '} });\n';
  };

  F['vela_storage_set'] = function (block) {
    addModule('storage', 'system.storage');
    var key = blockFieldValueDefault(block, 'KEY', 'key');
    var value = J.valueToCode(block, 'VALUE', ORDER.NONE) || "''";
    return 'storage.set({ key: ' + jsString(key) + ', value: String(' + value + ') });\n';
  };

  F['vela_storage_get'] = function (block) {
    addModule('storage', 'system.storage');
    var key = blockFieldValueDefault(block, 'KEY', 'key');
    var varName = safeVarName(blockFieldValueDefault(block, 'VAR', '结果'));
    recordVar(blockFieldValueDefault(block, 'VAR', '结果'));
    var dflt = J.valueToCode(block, 'DEFAULT', ORDER.NONE) || "''";
    var body = J.statementToCode(block, 'DO');
    var inner2 = 'this.' + varName + ' = data;\n' + body;
    return 'var _t = this;\n' +
      'storage.get({ key: ' + jsString(key) + ', default: String(' + dflt + '), success: function (data) {\n' +
      indent(inner2.replace(/\bthis\./g, '_t.'), 2) +
      '} });\n';
  };

  F['vela_timer_every'] = function (block) {
    var interval = J.valueToCode(block, 'INTERVAL', ORDER.NONE) || '1000';
    var idVar = safeVarName(blockFieldValueDefault(block, 'IDVAR', '定时器'));
    recordVar(blockFieldValueDefault(block, 'IDVAR', '定时器'));
    var body = J.statementToCode(block, 'DO');

    if (!(idVar in ctx.data)) ctx.data[idVar] = 'null';

    return 'var _t = this;\n' +
      'if (this.' + idVar + ') {\n' +
      '  clearInterval(this.' + idVar + ');\n' +
      '  this.' + idVar + ' = null;\n' +
      '}\n' +
      'this.' + idVar + ' = setInterval(function () {\n' +
      (body ? indent(body.replace(/\bthis\./g, '_t.'), 2) : '') +
      '}, ' + interval + ');\n';
  };

  F['vela_timer_after'] = function (block) {
    var delay = J.valueToCode(block, 'DELAY', ORDER.NONE) || '500';
    var body = J.statementToCode(block, 'DO');
    return 'var _t = this;\n' +
      'setTimeout(function () {\n' +
      (body ? indent(body.replace(/\bthis\./g, '_t.'), 2) : '') +
      '}, ' + delay + ');\n';
  };

  F['vela_timer_clear'] = function (block) {
    var idVar = safeVarName(blockFieldValueDefault(block, 'ID', '定时器'));
    recordVar(blockFieldValueDefault(block, 'ID', '定时器'));

    return 'if (this.' + idVar + ') {\n' +
      '  clearInterval(this.' + idVar + ');\n' +
      '  this.' + idVar + ' = null;\n' +
      '}\n';
  };

  F['vela_swiper'] = function (block) {
    var autoplay = block.getFieldValue('AUTOPLAY') === 'true';
    var loop = block.getFieldValue('LOOP') === 'true';
    var indicator = block.getFieldValue('INDICATOR') === 'true';
    var items = J.statementToCode(block, 'ITEMS');

    var cls = nextUid();
    addStyle(cls, 'width: 100%; height: 200px; border-radius: 12px; margin: 8px;');

    var props = [];
    if (autoplay) props.push('autoplay="true"');
    if (loop) props.push('loop="true"');
    if (indicator) props.push('indicator="true"');

    return '<swiper class="' + cls + '"' + (props.length ? ' ' + props.join(' ') : '') + '>\n' +
      (items ? indent(items, 2) : '') + '</swiper>\n';
  };

  F['vela_stack'] = function (block) {
    var w = cssSize(String(block.getFieldValue('WIDTH') || '100%').trim() || '100%');
    var h = cssSize(String(block.getFieldValue('HEIGHT') || '200px').trim() || '200px');
    var children = J.statementToCode(block, 'CHILDREN');
    var cls = nextUid();
    addStyle(cls, 'width: ' + w + '; height: ' + h + '; margin: 8px;');
    return '<stack class="' + cls + '">\n' + (children ? indent(children, 2) : '') + '</stack>\n';
  };

  F['vela_scroll'] = function (block) {
    var dir = block.getFieldValue('DIRECTION');
    var h = cssSize(String(block.getFieldValue('HEIGHT') || '300px').trim() || '300px');
    var children = J.statementToCode(block, 'CHILDREN');
    var cls = nextUid();
    addStyle(cls, 'width: 100%; height: ' + h + '; margin: 8px;');
    var dirAttr = dir === 'row' ? ' scroll-x="true"' : ' scroll-y="true"';
    return '<scroll class="' + cls + '"' + dirAttr + '>\n' + (children ? indent(children, 2) : '') + '</scroll>\n';
  };

  F['vela_text_with_var'] = function (block) {
    var content = block.getFieldValue('CONTENT') || '';
    var size = Number(block.getFieldValue('SIZE')) || 20;
    var color = block.getFieldValue('COLOR');
    var varName = safeVarName(block.getFieldValue('VAR') || '');

    var cls = nextUid();
    addStyle(cls, 'font-size: ' + size + 'px;' + (color ? ' color: ' + color + ';' : ''));

    if (varName) {
      recordVar(block.getFieldValue('VAR'));
      if (!(varName in ctx.data)) ctx.data[varName] = "''";
      var inner = content.replace(/\{\{.*\}\}/, '{{' + varName + '}}');
      return '<text class="' + cls + '" data-var="' + varName + '">' + inner + '</text>\n';
    } else {
      var inner2 = /\{\{.*\}\}/.test(content) ? content : templateText(content);
      return '<text class="' + cls + '">' + inner2 + '</text>\n';
    }
  };

  // ------------------------------------------------------------------ //
  // 显示 / 隐藏 / 运动 / 广播 / 自定义代码
  // ------------------------------------------------------------------ //
  F['vela_show'] = function (block) {
    var target = String(block.getFieldValue('TARGET') || '').trim();
    if (!target) return '// 未选择组件\n';
    var v = safeVarName(target);
    ensureComponentVars(v);
    return 'this.' + v + '_show = true;\n';
  };

  F['vela_hide'] = function (block) {
    var target = String(block.getFieldValue('TARGET') || '').trim();
    if (!target) return '// 未选择组件\n';
    var v = safeVarName(target);
    ensureComponentVars(v);
    var secs = Number(block.getFieldValue('SECS')) || 0;
    var code = 'this.' + v + '_show = false;\n';
    if (secs > 0) {
      code += 'var _t = this; setTimeout(function () { _t.' + v + '_show = true; }, ' + Math.round(secs * 1000) + ');\n';
    }
    return code;
  };

  F['vela_motion_move'] = function (block) {
    var target = String(block.getFieldValue('TARGET') || '').trim();
    if (!target) return '// 未选择组件\n';
    var v = safeVarName(target);
    ensureComponentVars(v);
    var dx = J.valueToCode(block, 'DX', ORDER.NONE) || '0';
    var dy = J.valueToCode(block, 'DY', ORDER.NONE) || '0';
    return 'this.' + v + '_x = (Number(this.' + v + '_x) || 0) + (' + dx + ');\n' +
           'this.' + v + '_y = (Number(this.' + v + '_y) || 0) + (' + dy + ');\n';
  };

  F['vela_motion_rotate'] = function (block) {
    var target = String(block.getFieldValue('TARGET') || '').trim();
    if (!target) return '// 未选择组件\n';
    var v = safeVarName(target);
    ensureComponentVars(v);
    var deg = J.valueToCode(block, 'ROT', ORDER.NONE) || '0';
    return 'this.' + v + '_rot = (Number(this.' + v + '_rot) || 0) + (' + deg + ');\n';
  };

  F['vela_broadcast_send'] = function (block) {
    var name = (block.getFieldValue('NAME') || '').trim() || '广播';
    var m = 'onBroadcast_' + safeMethodName(name);
    // 真机不支持同页面 $on/$broadcast，直接调用接收方法即可（接收方块在同一页面内）
    return 'if (this.' + m + ') { this.' + m + '(); }\n';
  };

  F['vela_broadcast_recv'] = function (block) {
    var name = (block.getFieldValue('NAME') || '').trim() || '广播';
    var body = J.statementToCode(block, 'DO');
    var m = 'onBroadcast_' + safeMethodName(name);
    addMethod(ctx.methods, m, body);
    ctx.bcasts.push({ ev: name, method: m });
    return '';
  };

  F['vela_raw_js'] = function (block) {
    var code = String(block.getFieldValue('CODE') || '');
    if (!code.trim()) return '';
    return code + '\n';
  };

  F['vela_raw_value'] = function (block) {
    var code = String(block.getFieldValue('CODE') || '').trim();
    return [code || 'null', ORDER.ATOMIC];
  };

  // ------------------------------------------------------------------ //
  // 角色 / 造型 / 等待
  // ------------------------------------------------------------------ //
  function findSprite(name) {
    var list = ctx.sprites || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].name || '') === String(name)) return list[i];
    }
    return null;
  }
  function findBackdrop(name) {
    var bd = ctx.backdrop;
    if (!bd || !Array.isArray(bd.costumes)) return null;
    for (var i = 0; i < bd.costumes.length; i++) {
      var it = bd.costumes[i];
      if (it && String(it.name || '') === String(name)) {
        return { index: i, name: it.name, image: it.image || '' };
      }
    }
    return null;
  }
  function ensureBackdropVars() {
    if (!('dbx_bg_src' in ctx.data)) ctx.data['dbx_bg_src'] = "''";
    if (!('dbx_bg_ci' in ctx.data)) ctx.data['dbx_bg_ci'] = '0';
  }
  function isSpriteTarget(name) {
    return !!findSprite(name);
  }
  function assetPath(name) {
    var s = String(name || '').trim();
    if (!s) return '';
    return s.charAt(0) === '/' ? s : '/assets/' + s;
  }

  // 生成角色图片：角色是「页面元数据」，不在积木里手动搭建。
  // 位置 / 尺寸 / 层级 / 显示 / 造型全部用数据变量驱动，
  // 这样「运动」「外观」积木可以直接控制它，预览里也能拖动。
  function emitSprites(page) {
    var list = ctx.sprites || [];
    list.forEach(function (sp) {
      if (!sp || !sp.name) return;
      var name = String(sp.name).trim();
      var v = safeVarName(name);
      ensureComponentVars(v);
      ensureSpriteVars(v);

      // 文本角色：内容直接以文字写进代码（不是图片），体积更小
      var isText = (sp.text != null && sp.text !== undefined);
      if (isText) {
        ctx.data[v + '_text'] = jsString(String(sp.text == null ? '' : sp.text));
        if (sp.visible === false) ctx.data[v + '_show'] = 'false';
      } else {
        var rawCostumes = Array.isArray(sp.costumes) ? sp.costumes : [];
        var costumes = rawCostumes.filter(function (c) { return !!c; });
        var cur = sp.costume;
        // 数字＝costumes 下标；空串＝空白造型（编辑中，不回退）；未设置＝第一个造型
        var curName = '';
        if (typeof cur === 'number') curName = rawCostumes[cur] || '';
        else if (cur == null) curName = rawCostumes[0] || '';
        else curName = cur;
        if (curName) ctx.data[v + '_src'] = jsString(assetPath(curName));
        var ci = costumes.map(function (c) { return assetPath(c); }).indexOf(assetPath(curName));
        ctx.data[v + '_ci'] = String(ci >= 0 ? ci : 0);
        // 没有造型（如正在绘制空白造型）时隐藏角色，避免预览回退成默认小鸭
        if (sp.visible === false || !curName) ctx.data[v + '_show'] = 'false';
      }

      var w = Math.round(Number(sp.w) || 0);
      var h = Math.round(Number(sp.h) || 0);
      var layer = Math.round(Number(sp.layer) || 0);
      var x = Math.round(Number(sp.x) || 0);
      var y = Math.round(Number(sp.y) || 0);
      // 方向（旋转角度）：右侧角色栏可直接编辑；仅给该角色单独加旋转，
      // 不放进 movedVars，避免把其它角色的 translate(0,0) rotate(0) 也写进去
      var rot = Math.round(Number(sp.rot) || 0);
      if (rot) ctx.data[v + '_rot'] = String(rot);
      var hasClick = !!ctx.methods['onSprite_' + v];

      if (isText) {
        var tSize = Math.max(8, Math.round(Number(sp.size) || 20));
        var tColor = sp.color || '#333333';
        var tExtra = 'font-size: ' + tSize + 'px; color: ' + tColor +
          '; text-align: center; white-space: pre-wrap; line-height: 1.2;';
        page.ui += '<text class="' + uiClass('dbxsprite', name) + '"' +
          componentAttrs(name, x, y, layer, w, h, rot, tExtra) +
          (hasClick ? ' onclick="onSprite_' + v + '"' : '') +
          '>{{' + v + '_text}}</text>\n';
      } else {
        page.ui += '<image class="' + uiClass('dbxsprite', name) + '"' +
          ' src="{{' + v + '_src}}"' +
          componentAttrs(name, x, y, layer, w, h, rot) +
          (hasClick ? ' onclick="onSprite_' + v + '"' : '') +
          '></image>\n';
      }

      // 克隆体渲染：用 for 指令把 v_clones 数组里的每个克隆体画出来
      if (ctx.clonedSprites && ctx.clonedSprites[v]) {
        ensureCloneVar(v);
        if (isText) {
          page.ui += '<text class="dbxclone" for="{{c in ' + v + '_clones}}" ' +
            'show="{{c.show}}"' +
            ' style="position: absolute; left: {{c.l}}px; top: {{c.t}}px; ' +
            'font-size: {{c.size}}px; ' +
            'color: {{c.color}}; text-align: center; white-space: pre-wrap;">{{c.text}}</text>\n';
        } else {
          page.ui += '<image class="dbxclone" for="{{c in ' + v + '_clones}}" ' +
            'show="{{c.show}}" src="{{c.src}}" style="position: absolute; left: {{c.l}}px; top: {{c.t}}px;' +
            (w ? ' width: ' + w + 'px;' : '') + (h ? ' height: ' + h + 'px;' : '') +
            ' z-index: {{c.z}};"></image>\n';
        }
      }
    });
  }

  // 角色「说」气泡：Scratch 的说话框固定显示在舞台顶部，
  // 用数据变量驱动文本和显示状态，不在积木里生成任何界面组件。
  function emitSay(page) {
    if (!ctx.usedSay) return;
    var sw = (ctx.center && ctx.center.x) ? ctx.center.x * 2 : 0;
    var w = sw > 0 ? Math.max(120, sw - 16) : 180;
    var cls = nextUid();
    addStyle(cls,
      'position: absolute;' +
      ' left: 8px; top: 34px;' +
      ' width: ' + w + 'px;' +
      ' min-height: 24px;' +
      ' padding: 5px 8px;' +
      ' border-radius: 10px;' +
      ' background-color: #fdfbf5;' +
      ' border: 1px solid #d9d2c5;' +
      ' flex-direction: column;' +
      ' align-items: center;' +
      ' justify-content: center;' +
      ' z-index: 40;');
    page.ui = '<div class="' + cls + '" show="{{dbx_say_show}}">\n' +
      '  <text style="font-size: 14px; color: #3b3b3b; text-align: center;">{{dbx_say_text}}</text>\n' +
      '</div>\n' + page.ui;
  }

  // 背景（舞台）：全屏底层图片，位于所有组件与角色下方。
  // 图片路径由数据变量 dbx_bg_src 驱动，「背景换成 / 下一个背景」积木可运行时切换。
  function emitBackdrop(page) {
    var bd = ctx.backdrop;
    if (!bd || !Array.isArray(bd.costumes) || !bd.costumes.length) return;
    var anyImage = bd.costumes.some(function (it) { return it && it.image; });
    if (!anyImage) return;
    ensureBackdropVars();
    var idx = Number(bd.index);
    if (!(idx >= 0 && idx < bd.costumes.length)) idx = 0;
    var it = bd.costumes[idx];
    var src = (it && it.image) ? assetPath(it.image) : '';
    if (!src) {
      // 当前背景还没贴图：退到第一张有图的背景，避免舞台上出现破图
      for (var i = 0; i < bd.costumes.length; i++) {
        if (bd.costumes[i] && bd.costumes[i].image) {
          idx = i;
          src = assetPath(bd.costumes[i].image);
          break;
        }
      }
    }
    ctx.data['dbx_bg_src'] = jsString(src);
    ctx.data['dbx_bg_ci'] = String(idx);
    var cw = (ctx.center && ctx.center.x) ? ctx.center.x * 2 : 0;
    var ch = (ctx.center && ctx.center.y) ? ctx.center.y * 2 : 0;
    var cls = nextUid();
    addStyle(cls,
      'position: absolute;' +
      ' left: 0px; top: 0px;' +
      (cw ? ' width: ' + cw + 'px;' : '') +
      (ch ? ' height: ' + ch + 'px;' : '') +
      ' z-index: 0;');
    page.ui = '<image class="' + cls + '" src="{{dbx_bg_src}}"></image>\n' + page.ui;
  }

  F['vela_motion_goto'] = function (block) {
    var target = String(block.getFieldValue('TARGET') || '').trim();
    if (!target) return '// 未选择对象\n';
    var v = safeVarName(target);
    ensureComponentVars(v);
    var x = J.valueToCode(block, 'X', ORDER.NONE) || '0';
    var y = J.valueToCode(block, 'Y', ORDER.NONE) || '0';
    var sp = findSprite(target);
    var base = sp ? { x: (Number(sp.x) || 0), y: (Number(sp.y) || 0) }
                  : (ctx.compBase[v] || { x: 0, y: 0 });
    return 'this.' + v + '_x = (' + x + ') - (' + base.x + ');\n' +
           'this.' + v + '_y = (' + y + ') - (' + base.y + ');\n';
  };

  F['vela_on_sprite_click'] = function (block) {
    var target = String(block.getFieldValue('TARGET') || '').trim();
    var body = J.statementToCode(block, 'DO');
    if (!target) return '';
    addMethod(ctx.methods, 'onSprite_' + safeVarName(target), body);
    return '';
  };

  // ---------------- 克隆积木代码生成 ----------------
  F['sc_when_clone_start'] = function (block) {
    // 该帽子属于当前目标（角色）；克隆启动时只对这个角色的克隆体生效
    var ownerV = ctx.currentTargetVar;
    // 积木放在背景 / 舞台工作区时，从同一工作区的「克隆」积木推断所属角色
    if (!ownerV) {
      try {
        var all = block.workspace ? block.workspace.getAllBlocks(false) : [];
        for (var i = 0; i < all.length; i++) {
          if (all[i].type !== 'sc_clone' && all[i].type !== 'sc_delete_clones_of') continue;
          var t = String(all[i].getFieldValue('TARGET') || '').trim();
          if (t) { ownerV = safeVarName(t); break; }
        }
      } catch (e) { /* ignore */ }
    }
    var prev = ctx.cloneOwner;
    var prevIdx = ctx.cloneIdx;
    ctx.cloneOwner = ownerV || prev || null;
    // 克隆启动时把「我是第几个克隆体」捕获成局部变量，
    // 循环 / 等待等异步回调里即使之后又新建了克隆体也不会操作错对象
    var idxVar = null;
    if (ownerV) {
      idxVar = '_cdx' + (++ctx.uid);
      ctx.cloneIdx = idxVar;
    }
    var body = J.statementToCode(block, 'DO');
    ctx.cloneOwner = prev;
    ctx.cloneIdx = prevIdx;
    if (idxVar) {
      body = 'var ' + idxVar + ' = Number(this.' + ownerV + '_clone_idx);\n' + body;
    }
    if (ownerV) addMethod(ctx.methods, 'onCloneStart_' + ownerV, body);
    else addMethod(ctx.methods, 'onCloneStart', body);
    return '';
  };
  // 收集当前页所有角色的克隆数组清空语句（供「删除所有克隆体」用）
  function clearAllClonesCode() {
    var lines = ['this.dbx_clone_order = [];'];
    (ctx.sprites || []).forEach(function (sp) {
      if (!sp || !sp.name) return;
      var v = safeVarName(sp.name);
      ensureCloneVar(v);
      lines.push('this.' + v + '_clones = [];');
      lines.push('this.' + v + '_clone_idx = -1;');
    });
    if (ctx.backdrop) { /* 背景不克隆 */ }
    return lines.join('\n') + '\n';
  }
  F['sc_clone'] = function (block) {
    var target = String(block.getFieldValue('TARGET') || '').trim();
    if (!target) return '// 未选择角色\n';
    var v = safeVarName(target);
    ensureComponentVars(v);
    ensureSpriteVars(v);
    ensureCloneVar(v);
    if (ctx.clonedSprites) ctx.clonedSprites[v] = true;
    var sp = findSprite(target) || {};
    var isText = (sp.text != null && sp.text !== undefined) ? 'true' : 'false';
    var w = Math.round(Number(sp.w) || 0);
    var h = Math.round(Number(sp.h) || 0);
    var layer = Math.round(Number(sp.layer) || 0);
    var tSize = Math.max(8, Math.round(Number(sp.size) || 20));
    var tColor = sp.color || '#333333';
    var cx = (ctx.center && ctx.center.x) || 0;
    var cy = (ctx.center && ctx.center.y) || 0;
    return 'this.' + v + '_clones = (this.' + v + '_clones || []).concat([{\n' +
      '  x: Number(this.' + v + '_x) || 0, y: Number(this.' + v + '_y) || 0,\n' +
      '  cx: ' + cx + ', cy: ' + cy + ', w: ' + w + ', h: ' + h + ',\n' +
      '  l: ' + Math.round(cx - w / 2) + ' + (Number(this.' + v + '_x) || 0),\n' +
      '  t: ' + Math.round(cy - h / 2) + ' + (Number(this.' + v + '_y) || 0),\n' +
      '  rot: Number(this.' + v + '_rot) || 0, show: true, z: ' + (layer + 1) + ',\n' +
      '  ci: Number(this.' + v + '_ci) || 0,\n' +
      '  src: this.' + v + '_src || \'\', text: this.' + v + '_text || \'\', isText: ' + isText + ',\n' +
      '  size: ' + tSize + ', color: ' + jsString(tColor) + '\n' +
      '}]);\n' +
      'this.dbx_clone_order = (this.dbx_clone_order || []).concat([\'' + v + '\']);\n' +
      'this.' + v + '_clone_idx = this.' + v + '_clones.length - 1;\n' +
      'if (this.onCloneStart_' + v + ') this.onCloneStart_' + v + '();\n' +
      'else if (this.onCloneStart) this.onCloneStart();\n';
  };
  F['sc_delete_clone'] = function () {
    ensureCloneOrder();
    return 'var _o = this.dbx_clone_order || [];\n' +
      'if (_o.length) {\n' +
      '  var _last = _o[_o.length - 1];\n' +
      '  this[_last + \'_clones\'] = (this[_last + \'_clones\'] || []).slice(0, -1);\n' +
      '  this[_last + \'_clone_idx\'] = this[_last + \'_clones\'].length - 1;\n' +
      '  this.dbx_clone_order = _o.slice(0, -1);\n' +
      '}\n';
  };
  F['sc_delete_all_clones'] = function () {
    return clearAllClonesCode();
  };
  F['sc_delete_clones_of'] = function (block) {
    var target = String(block.getFieldValue('TARGET') || '').trim();
    if (!target) return '// 未选择角色\n';
    var v = safeVarName(target);
    ensureCloneVar(v);
    if (ctx.clonedSprites) ctx.clonedSprites[v] = true;
    return 'this.' + v + '_clones = [];\n' +
      'this.' + v + '_clone_idx = -1;\n' +
      'this.dbx_clone_order = (this.dbx_clone_order || []).filter(function (x) { return x !== \'' + v + '\'; });\n';
  };

  F['vela_sprite_costume'] = function (block) {
    var target = String(block.getFieldValue('TARGET') || '').trim();
    var costume = String(block.getFieldValue('COSTUME') || '').trim();
    if (!target) return '// 未选择角色\n';
    var v = safeVarName(target);
    ensureSpriteVars(v);
    if (inCloneCtx(v)) ensureCloneVar(v);
    var code = spriteAssign(v, 'src', jsString(assetPath(costume)));
    if (costume) {
      var sp = findSprite(target);
      var idx = sp && Array.isArray(sp.costumes) ? sp.costumes.map(function (c) { return assetPath(c); }).indexOf(assetPath(costume)) : -1;
      if (idx >= 0) code += spriteAssign(v, 'ci', String(idx));
    }
    return code;
  };

  F['vela_sprite_nextcostume'] = function (block) {
    var target = String(block.getFieldValue('TARGET') || '').trim();
    if (!target) return '// 未选择角色\n';
    var v = safeVarName(target);
    ensureSpriteVars(v);
    if (inCloneCtx(v)) ensureCloneVar(v);
    var sp = findSprite(target);
    var list = (sp && Array.isArray(sp.costumes) && sp.costumes.length)
      ? sp.costumes.map(function (c) { return jsString(assetPath(c)); })
      : ['""'];
    var arr = '[' + list.join(', ') + ']';
    if (inCloneCtx(v)) {
      var i = '_ci' + (++ctx.uid);
      return 'var ' + i + ' = ' + cloneIdxExpr(v) + ';\n' +
        'if (this.' + v + '_clones && this.' + v + '_clones[' + i + ']) {\n' +
        '  var _c = this.' + v + '_clones[' + i + '];\n' +
        '  _c.ci = ((Number(_c.ci) || 0) + 1) % ' + list.length + ';\n' +
        '  _c.src = ' + arr + '[_c.ci];\n' +
        '  this.' + v + '_clones = this.' + v + '_clones.slice();\n' +
        '}\n';
    }
    return 'this.' + v + '_ci = (Number(this.' + v + '_ci) || 0) + 1;\n' +
           'if (this.' + v + '_ci >= ' + list.length + ') this.' + v + '_ci = 0;\n' +
           'this.' + v + '_src = ' + arr + '[this.' + v + '_ci];\n';
  };

  F['vela_wait'] = function (block) {
    var secs = J.valueToCode(block, 'SECS', ORDER.NONE) || '1';
    var delay = 'Math.round((Number(' + secs + ') || 0) * 1000)';
    var next = block.getNextBlock ? block.getNextBlock() : null;
    if (!next) return 'setTimeout(function () { }, ' + delay + ');\n';
    var alias = '_wt' + (++ctx.uid);
    // 嵌套「等待」时，内层不能再写 `this`（延时回调里的 this 已经丢了），
    // 而是从外层捕获的别名继续传递
    var outer = ctx.waitAlias || '';
    ctx.waitAlias = alias;
    var rest = '';
    var ids = [];
    var b = next;
    while (b) {
      ids.push(b.id);
      rest += J.blockToCode(b) || '';
      b = b.getNextBlock();
    }
    ctx.waitAlias = outer;
    ids.forEach(function (id) { ctx.skipIds[id] = true; });
    var capture = outer
      ? 'var ' + alias + ' = ' + outer + ';\n'
      : 'var ' + alias + ' = this;\n';
    return capture + 'setTimeout(function () {\n' +
      indent(rest.replace(/\bthis\./g, alias + '.')
                   .replace(/=\s*this;/g, '= ' + alias + ';'), 2) +
      '}, ' + delay + ');\n';
  };

  // ------------------------------------------------------------------ //
  // 扩展积木生成
  // ------------------------------------------------------------------ //
  F['controls_forever'] = function (block) {
    var id = ++ctx.uid;
    var alias = '_ft' + id;        // 组件引用（延时回调里 this 会丢）
    var loop = '_loop' + id;       // 循环函数名
    var prevForever = ctx.forever;
    var selfRef = prevForever ? prevForever.alias : 'this';
    var prevAlias = ctx.waitAlias;
    ctx.forever = { alias: alias, fn: loop };
    ctx.waitAlias = alias;
    var info = scanLoopBody(block);
    var body = J.statementToCode(block, 'DO');
    ctx.forever = prevForever;
    ctx.waitAlias = prevAlias;
    if (!body.trim()) return '';
    body = indent(body.replace(/\bthis\./g, alias + '.')
                       .replace(/=\s*this;/g, '= ' + alias + ';'), 2);
    // 声明循环开关，避免在真机上动态加属性
    if (!((loop + '_on') in ctx.data)) ctx.data[loop + '_on'] = 'false';
    // 真机上 while(true) 会卡死渲染线程（画面不再刷新、点按无响应）。
    // 用「执行一次 → setTimeout 32ms 再执行」的自调用函数，让 ferry 有机会刷新 UI。
    // 用闭包而不是单独方法，循环内部声明的局部变量仍可被循环体访问。
    return 'if (!' + selfRef + '.' + loop + '_on) {\n' +
      selfRef + '.' + loop + '_on = true;\n' +
      'var ' + alias + ' = ' + selfRef + ';\n' +
      '(function ' + loop + '() {\n' +
        body +
    'setTimeout(' + loop + ', ' +
      (info.waitExprs.length ? '(' + info.waitExprs.join(' + ') + ') + 32' : '32') + ');\n' +
      '})();\n' +
    '}\n';
  };

  // 扫描循环体：是否含「等待」积木（含嵌套），并收集等待时长表达式
  function scanLoopBody(block) {
    // 递归扫描：等待积木可能嵌套在 if/else 或更深的循环里，都要识别，
    // 否则外层循环仍会生成同步 for，等待只延后了后半段，看起来“只执行一次”。
    var res = { wait: false, flow: false, waitExprs: [] };
    var stack = [];
    try { stack = (block.getChildren ? block.getChildren(true) : []) || []; } catch (e) { /* ignore */ }
    var seen = {};
    while (stack.length) {
      var cur = stack.pop();
      if (!cur || !cur.type) continue;
      if (cur === block) continue; // 跳过循环体本身
      if (seen[cur.id]) continue;
      seen[cur.id] = true;
      if (cur.type === 'vela_wait') {
        res.wait = true;
        var secs = J.valueToCode(cur, 'SECS', ORDER.NONE) || '1';
        res.waitExprs.push('Math.round((Number(' + secs + ') || 0) * 1000)');
      } else if (cur.type === 'controls_flow_statements') {
        res.flow = true;
      }
      var kids = [];
      try { kids = (cur.getChildren ? cur.getChildren(true) : []) || []; } catch (e) { /* ignore */ }
      for (var i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
    return res;
  }

  // 循环体含「等待」的「重复 N 次」：改成 setTimeout 驱动的异步循环，
  // 每一轮等本轮所有等待结束后再开始下一轮（否则 N 轮会挤在同一帧，看起来只执行一次）。
  F['controls_repeat_ext'] = function (block) {
    var info = scanLoopBody(block);
    var orig = _builtinLoops.repeat;
    if (!info.wait || info.flow) return orig ? orig.call(block, block) : '';

    var id = ++ctx.uid;
    var self = '_rs' + id;
    var fn = '_rp' + id;
    var n = '_rn' + id;
    var times = (J.valueToCode(block, 'TIMES', ORDER.NONE) || '0').replace(/\bthis\./g, self + '.');
    var prevAlias = ctx.waitAlias;
    ctx.waitAlias = self;
    var body = J.statementToCode(block, 'DO');
    ctx.waitAlias = prevAlias;

    return 'var ' + self + ' = this;\n' +
      '(function ' + fn + '(' + n + ') {\n' +
      'if (!(' + n + ' < (' + times + '))) return;\n' +
      indent(body.replace(/\bthis\./g, self + '.')
                 .replace(/=\s*this;/g, '= ' + self + ';'), 2) +
      'setTimeout(function () { ' + fn + '(' + n + ' + 1); }, (' +
        (info.waitExprs.length ? info.waitExprs.join(' + ') : '0') + ') + 16);\n' +
      '})(0);\n';
  };

  // 同上：带「等待」的「重复执行直到 / 当」也改成异步循环，
  // 否则等待里改变的量在循环条件里读不到，会直接卡死。
  F['controls_whileUntil'] = function (block) {
    var info = scanLoopBody(block);
    var orig = _builtinLoops.whileUntil;
    if (!info.wait || info.flow) return orig ? orig.call(block, block) : '';

    var until = block.getFieldValue('MODE') === 'UNTIL';
    var id = ++ctx.uid;
    var self = '_ws' + id;
    var fn = '_wl' + id;
    var n = '_wn' + id;
    var cond = (J.valueToCode(block, 'BOOL', ORDER.NONE) || 'false').replace(/\bthis\./g, self + '.');
    var prevAlias = ctx.waitAlias;
    ctx.waitAlias = self;
    var body = J.statementToCode(block, 'DO');
    ctx.waitAlias = prevAlias;
    var stop = until ? '!!(' + cond + ')' : '!(' + cond + ')';

    return 'var ' + self + ' = this;\n' +
      '(function ' + fn + '(' + n + ') {\n' +
      'if (' + stop + ') return;\n' +
      indent(body.replace(/\bthis\./g, self + '.')
                 .replace(/=\s*this;/g, '= ' + self + ';'), 2) +
      'setTimeout(function () { ' + fn + '(' + n + ' + 1); }, (' +
        (info.waitExprs.length ? info.waitExprs.join(' + ') : '0') + ') + 16);\n' +
      '})(0);\n';
  };

  // 「停止 / 跳过」积木：在「重复执行」里不能直接 break（循环体是函数），
  // 否则真机编译直接报语法错误
  function nearestLoopType(block) {
    var p = block.getSurroundParent ? block.getSurroundParent() : null;
    while (p) {
      if (p.type === 'controls_forever' || p.type === 'controls_repeat_ext' ||
          p.type === 'controls_for' || p.type === 'controls_forEach' ||
          p.type === 'controls_whileUntil') return p.type;
      p = p.getSurroundParent ? p.getSurroundParent() : null;
    }
    return '';
  }

  F['controls_flow_statements'] = function (block) {
    var flow = block.getFieldValue('FLOW');
    var forever = ctx.forever;
    if (nearestLoopType(block) === 'controls_forever' && forever) {
      if (flow === 'CONTINUE') {
        return 'setTimeout(' + forever.fn + ', 32);\nreturn;\n';
      }
      return forever.alias + '.' + forever.fn + '_on = false;\nreturn;\n';
    }
    return flow === 'CONTINUE' ? 'continue;\n' : 'break;\n';
  };

  F['math_evenly_divisible'] = function (block) {
    var a = J.valueToCode(block, 'DIVIDEND', ORDER.NONE) || '0';
    var b = J.valueToCode(block, 'DIVISOR', ORDER.NONE) || '1';
    return ['(' + a + ' % ' + b + ' === 0)', ORDER.NONE];
  };

  F['math_types'] = function (block) {
    var v = J.valueToCode(block, 'VALUE', ORDER.NONE) || "''";
    var t = block.getFieldValue('TYPE');
    var fn = t === 'STRING' ? 'String' : (t === 'NUMBER' ? 'Number' : 'Boolean');
    return [fn + '(' + v + ')', ORDER.MEMBER];
  };

  function listRef(block) {
    return J.valueToCode(block, 'LIST', ORDER.MEMBER) || '[]';
  }
  function listPos(block, key, listCode, isEnd) {
    var i = J.valueToCode(block, key, ORDER.NONE) || '1';
    return isEnd ? '(' + listCode + '.length - ' + i + ')' : '(' + i + ' - 1)';
  }

  F['lists_push'] = function (block) {
    var v = J.valueToCode(block, 'VALUE', ORDER.NONE) || "''";
    return listRef(block) + '.push(' + v + ');\n';
  };

  F['lists_insert'] = function (block) {
    var l = listRef(block);
    var v = J.valueToCode(block, 'VALUE', ORDER.NONE) || "''";
    var pos = block.getFieldValue('WHERE') === 'FROM_END'
      ? listPos(block, 'INDEX', l, true) + ' + 1'
      : listPos(block, 'INDEX', l, false) + ' + 1';
    return l + '.splice(' + pos + ', 0, ' + v + ');\n';
  };

  F['lists_delete'] = function (block) {
    var l = listRef(block);
    var pos = listPos(block, 'INDEX', l, block.getFieldValue('WHERE') === 'FROM_END');
    return l + '.splice(' + pos + ', 1);\n';
  };

  F['lists_set'] = function (block) {
    var l = listRef(block);
    var pos = listPos(block, 'INDEX', l, block.getFieldValue('WHERE') === 'FROM_END');
    var v = J.valueToCode(block, 'VALUE', ORDER.ASSIGNMENT) || "''";
    return l + '[' + pos + '] = ' + v + ';\n';
  };

  F['lists_get'] = function (block) {
    var l = listRef(block);
    var pos = listPos(block, 'INDEX', l, block.getFieldValue('WHERE') === 'FROM_END');
    return [l + '[' + pos + ']', ORDER.MEMBER];
  };

  F['lists_index'] = function (block) {
    var l = listRef(block);
    var v = J.valueToCode(block, 'VALUE', ORDER.NONE) || "''";
    var fn = block.getFieldValue('WHICH') === 'LAST' ? 'lastIndexOf' : 'indexOf';
    return [l + '.' + fn + '(' + v + ')', ORDER.MEMBER];
  };

  F['lists_includes'] = function (block) {
    var l = listRef(block);
    var v = J.valueToCode(block, 'VALUE', ORDER.NONE) || "''";
    return ['(' + l + '.indexOf(' + v + ') !== -1)', ORDER.NONE];
  };

  // ------------------------------------------------------------------ //
  // 函数（过程）积木生成：函数体挂为页面方法，调用走 this.方法名(...)
  // ------------------------------------------------------------------ //
  function procSignature(block) {
    var args = (block.arguments_ || []).map(function (a) { return safeVarName(a[0]); });
    var name = safeMethodName(block.getFieldValue('NAME') || '我的函数');
    return { name: name, args: args };
  }
  function withProcArgs(args, gen) {
    var prev = ctx.procArgs;
    ctx.procArgs = {};
    args.forEach(function (a) { ctx.procArgs[a] = true; });
    try { return gen(); } finally { ctx.procArgs = prev; }
  }

  F['procedures_defnoreturn'] = function (block) {
    var sig = procSignature(block);
    var body = withProcArgs(sig.args, function () {
      return J.statementToCode(block, 'STACK');
    });
    addMethod(ctx.methods, sig.name + (sig.args.length ? '(' + sig.args.join(', ') + ')' : ''), body);
    return '';
  };

  F['procedures_defreturn'] = function (block) {
    var sig = procSignature(block);
    var body = withProcArgs(sig.args, function () {
      var b = J.statementToCode(block, 'STACK');
      var ret = J.valueToCode(block, 'RETURN', ORDER.NONE);
      if (ret) b += '  return ' + ret + ';\n';
      return b;
    });
    addMethod(ctx.methods, sig.name + (sig.args.length ? '(' + sig.args.join(', ') + ')' : ''), body);
    return '';
  };

  F['procedures_callnoreturn'] = function (block) {
    var name = safeMethodName(block.getFieldValue('NAME') || '');
    var args = (block.arguments_ || []).map(function (a, i) {
      return J.valueToCode(block, 'ARG' + i, ORDER.NONE) || 'null';
    });
    return 'this.' + name + '(' + args.join(', ') + ');\n';
  };

  F['procedures_callreturn'] = function (block) {
    var name = safeMethodName(block.getFieldValue('NAME') || '');
    var args = (block.arguments_ || []).map(function (a, i) {
      return J.valueToCode(block, 'ARG' + i, ORDER.NONE) || 'null';
    });
    return ['this.' + name + '(' + args.join(', ') + ')', ORDER.MEMBER];
  };

  // ------------------------------------------------------------------ //
  // 总入口：多页面生成全部源码文件
  // pages: [{ name, title, xml }]
  // ------------------------------------------------------------------ //
  function generateProject(pages, meta) {
    resetCtx();
    meta = meta || {};
    // 屏幕中心作为坐标原点：0,0 = 正中，X 向右、Y 向下（可为负）。
    // 设计屏 = 按 designWidth 与设备屏幕宽高比等比换算（designWidth=设备宽时即设备分辨率），
    // 中心 = 设计屏宽/2、设计屏高/2，与预览 panelCenter 使用同一套尺寸
    var _scr = deviceScreen(meta.deviceType);
    var _dw = parseInt(meta.designWidth, 10) || _scr.w;
    var _dh = Math.round(_dw * (_scr.h / _scr.w));
    ctx.center = { x: Math.round(_dw / 2), y: Math.round(_dh / 2) };

    var issues = [];
    var pageList = (pages || []).filter(function (p) { return p && p.name; });

    // 页面名去重
    var usedNames = {};
    pageList.forEach(function (pg) {
      var n = sanitizePageName(pg.name);
      var base = n, i = 2;
      while (usedNames[n]) { n = base + i; i++; }
      usedNames[n] = true;
      pg._safeName = n;
    });

    pageList.forEach(function (pg) {
      var bd = (pg.backdrop && typeof pg.backdrop === 'object') ? pg.backdrop : null;
      var page = {
        name: pg._safeName,
        title: pg.title || pg.name,
        ui: '', styles: [], data: {}, methods: {}, bcasts: [],
        sprites: Array.isArray(pg.sprites) ? pg.sprites : [],
        backdrop: bd
      };
      startPage(page);
      // 全局变量 / 列表：所有页面共享同一份声明，每页都注入初始值，
      // 这样在任意角色 / 页面里建的变量都能在所有页面使用
      (meta.globalVars || []).forEach(function (gv) {
        var gk = safeVarName(gv && gv.name);
        if (!gk || (gk in page.data)) return;
        page.data[gk] = ((gv && gv.type) === 'list') ? '[]' : '0';
      });
      ctx.compBase = {};

      // 每个「目标」（背景 + 每个角色）都有独立的积木 XML，依次生成到同一页面；
      // 同名方法（如广播接收 onBroadcast_x）会追加 body，实现广播跨角色/背景接收。
      var targets = [];
      var stageXml = '';
      if (bd && Array.isArray(bd.costumes) && bd.costumes.length) {
        var bci = Number(bd.index);
        if (!(bci >= 0 && bci < bd.costumes.length)) bci = 0;
        var bc = bd.costumes[bci];
        if (bc && typeof bc.xml === 'string' && bc.xml.trim()) stageXml = bc.xml;
      }
      if (!stageXml && bd && typeof bd.xml === 'string') stageXml = bd.xml;
      if (!stageXml) stageXml = pg.xml || '';
      if (stageXml && stageXml.indexOf('<block') >= 0) targets.push({ xml: stageXml, owner: null });
      page.sprites.forEach(function (sp) {
        if (sp && typeof sp.xml === 'string' && sp.xml.indexOf('<block') >= 0) targets.push({ xml: sp.xml, owner: sp.name });
      });
      if (!targets.length) {
        targets.push({ xml: '<xml xmlns="https://developers.google.com/blockly/xml"></xml>', owner: null });
      }
      // 预扫描整页积木：找出真正被「移动 / 旋转」积木控制的对象，
      // 只给它们输出 transform（与积木摆放顺序无关，也避免给所有组件写 0 值 transform）
      ctx.movedVars = ctx.movedVars || {};
      try {
        var motionRe = /type="(?:vela_motion_move|vela_motion_rotate|vela_motion_goto|sc_rotate_right|sc_rotate_left|sc_motion_goto|sc_change_x|sc_change_y)"[\s\S]{0,300}?<field name="TARGET">([^<]*)<\/field>/g;
        targets.forEach(function (tgt) {
          var mm;
          motionRe.lastIndex = 0;
          while ((mm = motionRe.exec(tgt.xml || ''))) {
            var nm = String(mm[1] || '').trim();
            if (nm) ctx.movedVars[safeVarName(nm)] = true;
          }
        });
      } catch (e0) { /* ignore */ }
      var workspaces = [];
      targets.forEach(function (tgt) {
        var xmlText = tgt.xml;
        var hw = null;
        // 记录当前目标（角色），供「当作为克隆体启动时」判断它属于哪个角色
        ctx.currentTargetVar = tgt.owner ? safeVarName(tgt.owner) : null;
      try {
        hw = new Blockly.Workspace();
        Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(xmlText), hw);
        // 刷新动态下拉选项并恢复 XML 里的字段值，
        // 否则 BIND/SRC/TARGET 等下拉字段在解析时会被清空成默认值
        try {
          setSprites((page.sprites || []).map(function (s) { return s.name; }));
          setBackdrops(((page.backdrop && page.backdrop.costumes) || []).map(function (c) {
            return c && c.name;
          }));
          updateOptions(hw);
        } catch (e) { console.warn('gen updateOptions err:', e); }
        // 记录组件初始位置，「移到 X Y」用它做偏移，保证绝对定位准确
        // compBase 在外层初始化：多个目标的组件位置合并到同一页面
        hw.getAllBlocks(false).forEach(function (b) {
          if (['vela_text', 'vela_image', 'vela_button', 'vela_button_param',
               'vela_progress', 'vela_switch', 'vela_slider', 'vela_div'].indexOf(b.type) < 0) return;
          var nm = (b.getFieldValue && b.getFieldValue('NAME')) || '';
          if (!nm) return;
          // 以 block.data 里的真实布局为准（拖拽后字段可能还没同步），
          // 保证「移到 X Y」的偏移基准与组件实际位置一致
          var lay = getLayout(b);
          ctx.compBase[safeVarName(nm)] = {
            x: Number(lay.x) || 0,
            y: Number(lay.y) || 0
          };
        });
        try { restoreDynamicFields(hw, xmlText); } catch (e) { console.warn('gen restore err:', e); }
        // 左栏建立但还没用到的变量 / 列表也要有初始值，数据监视框才能显示 0 / 空列表
        try {
          hw.getAllVariables().forEach(function (v) {
            var key = safeVarName(v.name);
            if (key in page.data) return;
            page.data[key] = (String(v.type || '') === 'list') ? '[]' : '0';
          });
        } catch (e) { /* ignore */ }
        // 顶层积木分两类：UI 组件（输出 <template> 标记）和散落的语句积木。
        // 语句积木（如直接拖到画布上的「克隆」）不能塞进 <template>，
        // 统一收进 onShow，否则会生成非法 .ux 文件。
        var uiCode = '', strayCode = '';
        try { if (J.init) J.init(hw); } catch (e0) { /* 兼容不同 Blockly 版本 */ }
        hw.getTopBlocks(true).forEach(function (b) {
          var c = J.blockToCode(b) || '';
          if (Array.isArray(c)) c = c[0];
          if (!c) return;
          if (UI_TOP_BLOCKS[b.type]) { uiCode += c; return; }
          if (b.previousConnection || b.nextConnection) strayCode += c;
        });
        // Blockly 会把变量声明（var xxx;）拼在代码头部，不属于 UI 标记，剥掉
        uiCode = uiCode.replace(/^var [^;\n]*;\s*/, '');
        if (uiCode) page.ui += uiCode;
        if (strayCode) addMethod(ctx.methods, 'onShow', strayCode);
        workspaces.push(hw);
      } catch (e) {
        if (hw) { try { hw.dispose(); } catch (e2) { /* ignore */ } }
        ctx.genErrors.push('页面「' + page.name + '」生成代码出错：' +
          (e && e.message ? e.message : e));
      }
        ctx.currentTargetVar = null;
      });

      // 背景铺在最底层 → 角色图片 → 说话气泡
      emitBackdrop(page);
      emitSprites(page);
      emitSay(page);

      endPage();
      workspaces.forEach(function (hw) {
        try { issues = issues.concat(validatePage(hw, page, pageList)); } catch (e) { /* ignore */ }
        try { hw.dispose(); } catch (e) { /* ignore */ }
      });
    });

    // 多个目标可能报出同样的提醒（如舞台为空），去重
    var seenIssue = {};
    issues = issues.filter(function (it) {
      var k = it.sev + '|' + it.msg;
      if (seenIssue[k]) return false;
      seenIssue[k] = true;
      return true;
    });

    var pkg = (meta.package || 'com.duckbox.demo').trim();
    var appName = (meta.appName || 'DuckBox').slice(0, 6);
    var designWidth = _dw;
    var resultPages = ctx.pages;

    var files = {};
    files['src/app.ux'] = appUx();
    files['src/common/style.css'] = commonCss();
    files['src/i18n/defaults.json'] = '{}\n';
    files['src/manifest.json'] = JSON.stringify(
      buildManifest(pkg, appName, designWidth, resultPages), null, 2) + '\n';

    resultPages.forEach(function (p) {
      files['src/' + p.name + '/' + p.name + '.ux'] = p.content;
    });

    issues = issues.concat(ctx.genErrors.map(function (m) {
      return { sev: 'error', msg: m };
    }));

    if (!issues.length) {
      issues.push({ sev: 'ok', msg: '太棒了！没有发现任何问题，可以导出源码了' });
    }

    return {
      files: files,
      issues: issues,
      pages: resultPages.map(function (p) {
        return {
          name: p.name, title: p.title, ui: p.ui,
          styles: p.styles, data: p.data, methods: p.methods,
          sprites: p.sprites
        };
      })
    };
  }

  function buildManifest(pkg, appName, designWidth, pages) {
    var features = [];
    Object.keys(ctx.imports).sort().forEach(function (k) {
      var f = ctx.imports[k];
      if (features.indexOf(f) < 0) features.push(f);
    });

    var routerPages = {};
    pages.forEach(function (p) {
      routerPages[p.name] = { component: p.name, path: '/' + p.name };
    });

    var manifest = {
      package: pkg,
      name: appName,
      versionName: '1.0.0',
      versionCode: 1,
      minPlatformVersion: 1000,
      icon: '/common/logo.png',
      deviceTypeList: ['watch'],
      config: { logLevel: 'log', designWidth: designWidth },
      router: {
        entry: pages.length ? pages[0].name : '',
        pages: routerPages
      }
    };
    if (features.length) manifest.features = features.map(function (f) { return { name: f }; });
    return manifest;
  }

  function appUx() {
    return '<script>\n' +
      '  /**\n' +
      '   * 应用入口（由 Duck Box 自动生成）\n' +
      '   */\n' +
      '  export default {\n' +
      '    onCreate() {},\n' +
      '    onDestroy() {}\n' +
      '  }\n' +
      '</script>\n';
  }

  function commonCss() {
    return '/* 公共样式（由 Duck Box 自动生成） */\n' +
      '.duck-card {\n  background-color: #ffffff;\n  border-radius: 24px;\n}\n';
  }

  // ------------------------------------------------------------------ //
  // 校验（逐页进行，ws 为该页的 headless workspace）
  // ------------------------------------------------------------------ //
  function validatePage(ws, page, allPages) {
    var issues = [];
    var all = ws.getAllBlocks(false);
    var pname = page.name;

    var pageNames = {};
    allPages.forEach(function (p) { pageNames[sanitizePageName(p.name)] = true; });

    // 组件与事件配对
    var uiBlocks = all.filter(function (b) { return COMPONENT_TYPES[b.type]; });
    var evBlocks = all.filter(function (b) {
      return b.type === 'vela_onclick' || b.type === 'vela_onclick_param' || b.type === 'vela_onlongpress';
    });

    var needClick = {};   // 事件名 -> true（按钮/图片声明了）
    var needLong = {};
    uiBlocks.forEach(function (b) {
      if (b.type === 'vela_button') {
        var action = b.getFieldValue('ACTION') || 'event';
        var raw = (b.getFieldValue('TARGET') || '').trim();
        if (action === 'navigate') {
          var navTarget = sanitizePageName(raw);
          if (!pageNames[navTarget]) {
            issues.push({ sev: 'error', msg: '页面「' + pname + '」的按钮想导航到「' + navTarget + '」，但工程里没有这个页面！' });
          }
          return;
        }
        if (!raw) {
          issues.push({ sev: 'warning', msg: '页面「' + pname + '」里有按钮没填事件名，点了不会有反应。' });
          return;
        }
        if (/^long:/i.test(raw)) {
          needLong[raw.replace(/^long:/i, '')] = true;
        } else {
          needClick[raw] = true;
        }
      } else if (b.type === 'vela_button_param') {
        var pev = (b.getFieldValue('EVENT') || '').trim();
        if (!pev) {
          issues.push({ sev: 'warning', msg: '页面「' + pname + '」里有带参按钮没填事件名，点了不会有反应。' });
        } else {
          needClick[pev] = true;
        }
      } else if (b.type === 'vela_image') {
        var ev = (b.getFieldValue('EVENT') || '').trim();
        if (ev) needClick[ev] = true;
      }
    });

    var hasClick = {};
    var hasLong = {};
    evBlocks.forEach(function (e) {
      var ev = (e.getFieldValue('EVENT') || '').trim().replace(/^long:/i, '');
      if (!ev) return;
      if (e.type === 'vela_onlongpress') hasLong[ev] = true;
      else hasClick[ev] = true;
    });

    Object.keys(needClick).forEach(function (ev) {
      if (!hasClick[ev]) {
        issues.push({ sev: 'warning', msg: '页面「' + pname + '」的事件「' + ev + '」还没有对应的「当组件被点击」积木。' });
      }
    });
    Object.keys(needLong).forEach(function (ev) {
      if (!hasLong[ev]) {
        issues.push({ sev: 'warning', msg: '页面「' + pname + '」的长按事件「' + ev + '」还没有对应的「当组件被长按」积木。' });
      }
    });
    Object.keys(hasClick).forEach(function (ev) {
      if (!needClick[ev]) {
        issues.push({ sev: 'error', msg: '页面「' + pname + '」的点击事件「' + ev + '」找不到对应的按钮/图片！请检查组件上的事件名是否一致。' });
      }
    });

    // 空 UI 提醒（本页有角色 / 说话框就不算空）
    if (!uiBlocks.length && !(page.sprites || []).length && !ctx.usedSay) {
      issues.push({ sev: 'warning', msg: '页面「' + pname + '」的舞台上是空的，建议拖入角色或使用「说」积木。' });
    }

    // 运动 / 显示隐藏必须选组件
    var motionTypes = {
      vela_show: '显示', vela_hide: '隐藏',
      vela_motion_move: '移动', vela_motion_rotate: '旋转',
      vela_motion_goto: '移到',
      vela_sprite_costume: '换成造型', vela_sprite_nextcostume: '下一个造型',
      sc_motion_goto: '移到', sc_change_x: '将 x 增加', sc_change_y: '将 y 增加',
      sc_rotate_right: '右转', sc_rotate_left: '左转',
      sc_show: '显示', sc_hide: '隐藏',
      sc_costume: '换成造型', sc_next_costume: '下一个造型'
    };
    all.forEach(function (b) {
      var label = motionTypes[b.type];
      if (!label) return;
      var t = String(b.getFieldValue('TARGET') || '').trim();
      if (!t) {
        issues.push({ sev: 'error', msg: '页面「' + pname + '」有「' + label + '」积木没选对象。请先给组件起名或在「角色」面板新建角色，再在下拉里选择。' });
      }
    });

    // 角色相关检查：角色必须存在于本页；点击事件必须绑定到真实角色
    var spriteNames = {};
    (page.sprites || []).forEach(function (sp) {
      if (sp && sp.name) spriteNames[String(sp.name).trim()] = true;
    });
    all.forEach(function (b) {
      if (b.type === 'vela_on_sprite_click' || b.type === 'vela_sprite_costume' ||
          b.type === 'vela_sprite_nextcostume') {
        var t = String(b.getFieldValue('TARGET') || '').trim();
        if (t && !spriteNames[t]) {
          issues.push({ sev: 'error', msg: '页面「' + pname + '」的「' + (BLOCK_LABELS[b.type] || b.type) + '」选了角色「' + t + '」，但本页没有这个角色。' });
        }
      }
    });
    // 角色没有造型时图片是空白：提前提醒，避免真机上看起来“什么都没显示”
    (page.sprites || []).forEach(function (sp) {
      if (sp && sp.name && !(Array.isArray(sp.costumes) && sp.costumes.length)) {
        issues.push({ sev: 'warning', msg: '角色「' + sp.name + '」还没有造型（贴图），可能不会显示。请到「角色」面板添加造型。' });
      }
    });

    // 跳转目标是否存在
    all.forEach(function (b) {
      if (b.type === 'vela_router_push' || b.type === 'vela_router_push_param') {
        var target = sanitizePageName(b.getFieldValue('PAGE'));
        if (!pageNames[target]) {
          issues.push({ sev: 'error', msg: '页面「' + pname + '」想跳转到「' + target + '」，但工程里没有这个页面！' });
        }
      }
    });

    // 广播发送 / 接收配对
    var sendNames = {};
    var recvNames = {};
    all.forEach(function (b) {
      if (b.type === 'vela_broadcast_send') sendNames[(b.getFieldValue('NAME') || '').trim()] = true;
      if (b.type === 'vela_broadcast_recv') recvNames[(b.getFieldValue('NAME') || '').trim()] = true;
    });
    Object.keys(sendNames).forEach(function (n) {
      if (!recvNames[n]) {
        issues.push({ sev: 'warning', msg: '页面「' + pname + '」发送的广播「' + n + '」在本页面没有接收者。' });
      }
    });

    // 顶层散落的动作积木（没放进任何事件里，运行时不会执行）
    all.forEach(function (b) {
      var label = BLOCK_LABELS[b.type];
      var isAction = b.type === 'vela_show' || b.type === 'vela_hide' ||
        b.type === 'vela_motion_move' || b.type === 'vela_motion_rotate' ||
        b.type === 'vela_motion_goto' ||
        b.type === 'vela_sprite_costume' || b.type === 'vela_sprite_nextcostume' ||
        b.type === 'vela_wait' ||
        b.type === 'vela_broadcast_send' || b.type === 'vela_toast' ||
        b.type === 'vela_vibrate' || b.type === 'vela_log' ||
        b.type === 'vela_router_push' || b.type === 'vela_router_push_param' ||
        b.type === 'vela_router_back' || b.type === 'vela_exit_app' ||
        b.type === 'vela_timer_every' || b.type === 'vela_timer_after' ||
        b.type === 'vela_timer_clear' || b.type === 'vela_battery_get' ||
        b.type === 'vela_storage_set' || b.type === 'vela_storage_get' ||
        b.type === 'vela_raw_js' || b.type === 'variables_set';
      if (isAction && !b.getParent()) {
        issues.push({ sev: 'warning', msg: '页面「' + pname + '」有一块「' + label + '」放在最外层，没有拼进任何事件里，它不会执行哦。' });
      }
    });

    return issues;
  }

  // ------------------------------------------------------------------ //
  // 积木名称表（校验提示用）
  // ------------------------------------------------------------------ //
  var BLOCK_LABELS = {
    vela_text: '文本', vela_image: '图片', vela_button: '按钮', vela_button_param: '带参按钮', vela_div: '容器',
    vela_progress: '进度条', vela_switch: '开关', vela_slider: '滑块',
    vela_onclick: '点击事件', vela_onclick_param: '带参点击事件', vela_onlongpress: '长按事件',
    vela_show: '显示', vela_hide: '隐藏',
    vela_motion_move: '移动', vela_motion_rotate: '旋转', vela_motion_goto: '移到',
    vela_on_sprite_click: '当角色被点击', vela_sprite_costume: '换成造型', vela_sprite_nextcostume: '下一个造型',
    vela_wait: '等待',
    vela_broadcast_send: '发送广播', vela_broadcast_recv: '接收广播',
    vela_router_push: '跳转页面', vela_router_push_param: '跳转页面(带参数)', vela_router_back: '返回上一页',
    vela_exit_app: '退出快应用', vela_swipe_exit_off: '关闭左滑退出',
    vela_toast: '提示', vela_vibrate: '震动', vela_log: '打印日志',
    vela_data: '数据', vela_raw_js: '自定义代码', vela_raw_value: '自定义表达式',
    vela_timer_every: '定时执行', vela_timer_after: '延迟执行', vela_timer_clear: '停止定时器',
    vela_battery_get: '获取电量', vela_storage_set: '保存数据', vela_storage_get: '读取数据',
    variables_set: '设置变量', variables_get: '取变量值',
    controls_if: '如果', controls_repeat_ext: '重复', controls_whileUntil: '循环',
    controls_forever: '重复执行', controls_flow_statements: '跳出循环',
    vela_onready: '当页面启动', vela_on_sprite_click: '当角色被点击',
    // 运动 / 外观 / 侦测 / 运算（搜索用）
    sc_motion_goto: '移到 XY', sc_change_x: '改变 X', sc_change_y: '改变 Y',
    sc_rotate_right: '向右旋转', sc_rotate_left: '向左旋转',
    sc_xpos: 'X 坐标', sc_ypos: 'Y 坐标', sc_direction: '方向',
    sc_say: '说', sc_say_secs: '说 2 秒', sc_show: '显示', sc_hide: '隐藏',
    sc_costume: '换成造型', sc_next_costume: '下一个造型',
    sc_backdrop: '换成背景', sc_next_backdrop: '下一个背景',
    sc_costume_number: '造型编号', sc_backdrop_number: '背景编号',
    sc_timer: '计时器', sc_timer_reset: '重置计时器', sc_current_time: '当前时间',
    sc_touching: '碰到角色或舞台边缘', sc_leaving_stage: '离开舞台',
    sc_when_sprite_clicked: '当角色被点击', sc_sprite_prop: '角色属性',
    sc_distance_to: '到角色的距离', sc_touch_down: '手指按下',
    sc_touch_x: '手指 X', sc_touch_y: '手指 Y', sc_swipe_dir: '滑动方向',
    sc_when_stage_clicked: '当舞台被点击', sc_when_swipe: '当手指滑动',
    sc_join: '与（拼接文字）',
    math_number: '数字', math_arithmetic: '加减乘除', math_single: '数学函数',
    math_round: '四舍五入', math_random_int: '随机数', math_modulo: '取余',
    math_number_property: '数字属性', math_trig: '三角函数',
    logic_compare: '比较', logic_operation: '与 / 或', logic_negate: '不成立',
    logic_boolean: '真 / 假', text: '文本', text_join: '连接文本',
    text_length: '文本长度', text_isEmpty: '文本为空', text_indexOf: '文本位置',
    text_charAt: '文本第几位', text_getSubstring: '截取文本'
  };

  // ------------------------------------------------------------------ //
  // 旧版「页面」积木（兼容读取老项目，不在工具箱中）
  // ------------------------------------------------------------------ //
  F['vela_page'] = function (block) {
    var ui = J.statementToCode(block, 'UI') || '';
    J.statementToCode(block, 'EVENTS');
    return ui;
  };

  function defineCompatPageBlock() {
    if (Blockly.Blocks['vela_page']) return;
    Blockly.Blocks['vela_page'] = {
      init: function () {
        this.appendDummyInput()
          .appendField('旧版页面')
          .appendField(new Blockly.FieldTextInput('index'), 'NAME')
          .appendField('标题')
          .appendField(new Blockly.FieldTextInput('首页'), 'TITLE');
        this.appendStatementInput('UI').setCheck('UI').appendField('界面');
        this.appendStatementInput('EVENTS').appendField('事件');
        this.setColour(290);
        this.setTooltip('旧版项目的页面积木，仅用于兼容读取。新页面请用顶部「页面栏」添加。');
      }
    };
  }

  // Blockly 内置变量积木的 field_variable 默认不限类型
  // （getVariableTypes_() 返回 ['list','']，下拉里连「列表」都能选）。
  // 一旦变量积木引用了 list 模型，删除该列表时这些积木会被
  // deleteVariableById 一并清掉，看上去就是「删列表把变量也弄坏了」。
  // 这里只从变量积木的下拉里隐藏 list 类型，不改 variableTypes：
  // 因为 typeIsAllowed_() 也用它做校验，硬改会让旧项目里曾误选列表的
  // XML 载入时被 Blockly 静默替换成默认变量、连带丢掉其它变量声明。
  function isolateVariableTypes() {
    ['variables_get', 'variables_set', 'sc_var_change'].forEach(function (type) {
      var def = Blockly.Blocks[type];
      if (!def || !def.init || def.__dbxVarTyped) return;
      var orig = def.init;
      def.init = function () {
        orig.call(this);
        var f = this.getField && this.getField('VAR');
        if (!f || f.__dbxHideLists || typeof f.getOptions !== 'function') return;
        var origGetOptions = f.getOptions;
        f.getOptions = function () {
          var opts = origGetOptions.call(this) || [];
          var block = typeof this.getSourceBlock === 'function' ? this.getSourceBlock() : null;
          var wsRef = block && block.workspace;
          if (!wsRef || typeof wsRef.getVariableById !== 'function') return opts;
          return opts.filter(function (o) {
            var model = wsRef.getVariableById(o && o[1]);
            return !(model && (model.type || '') === 'list');
          });
        };
        f.__dbxHideLists = true;
      };
      def.__dbxVarTyped = true;
    });
  }

  function defineBlocks() {
    Blockly.defineBlocksWithJsonArray(blocks);
    defineCompatPageBlock();
    isolateVariableTypes();
  }

  // Scratch 配色主题：运算符/数学/文字统一绿色，循环橙色，事件黄色，
  // 变量橙色、列表红色、自制积木粉色，和 Scratch 3 保持一致。
  var duckTheme = null;
  function buildTheme() {
    if (duckTheme) return duckTheme;
    try {
      if (!Blockly.Theme || !Blockly.Theme.defineTheme) return null;
      duckTheme = Blockly.Theme.defineTheme('duckbox-scratch', {
        base: (Blockly.Themes && Blockly.Themes.Classic) || null,
        blockStyles: {
          logic_blocks: { colourPrimary: '#59C059', colourSecondary: '#4aa64a', colourTertiary: '#3c8f3c' },
          math_blocks: { colourPrimary: '#59C059', colourSecondary: '#4aa64a', colourTertiary: '#3c8f3c' },
          text_blocks: { colourPrimary: '#59C059', colourSecondary: '#4aa64a', colourTertiary: '#3c8f3c' },
          loop_blocks: { colourPrimary: '#FFAB19', colourSecondary: '#ffab19', colourTertiary: '#c87d09' },
          logic_ternary_blocks: { colourPrimary: '#59C059', colourSecondary: '#4aa64a', colourTertiary: '#3c8f3c' },
          variable_blocks: { colourPrimary: '#FF8C1A', colourSecondary: '#ff8c1a', colourTertiary: '#d06a0d' },
          variable_dynamic_blocks: { colourPrimary: '#FF8C1A', colourSecondary: '#ff8c1a', colourTertiary: '#d06a0d' },
          list_blocks: { colourPrimary: '#FF661A', colourSecondary: '#ff661a', colourTertiary: '#d05014' },
          procedure_blocks: { colourPrimary: '#FF6680', colourSecondary: '#ff6680', colourTertiary: '#d04a62' },
          colour_blocks: { colourPrimary: '#FF6680', colourSecondary: '#ff6680', colourTertiary: '#d04a62' }
        }
      });
      return duckTheme;
    } catch (e) {
      console.warn('Scratch 主题创建失败，使用默认配色：', e);
      duckTheme = null;
      return null;
    }
  }

  // ------------------------------------------------------------------ //
  // 变量 / 列表分类：Scratch 式「建立一个变量 / 一个列表」按钮
  // ------------------------------------------------------------------ //
  function flyoutButton(text, key) {
    var b = document.createElement('button');
    b.setAttribute('text', text);
    b.setAttribute('callbackkey', key);
    return b;
  }
  function flyoutVariableField(name, model) {
    var f = document.createElement('field');
    f.setAttribute('name', name);
    f.setAttribute('id', model.getId());
    f.setAttribute('variabletype', model.type || '');
    f.textContent = model.name;
    return f;
  }
  function flyoutBlock(type, fields) {
    var b = document.createElement('block');
    b.setAttribute('type', type);
    (fields || []).forEach(function (f) { b.appendChild(f); });
    return b;
  }
  function refreshToolbox(ws) {
    try { if (ws.refreshToolboxSelection) ws.refreshToolboxSelection(); } catch (e) { /* ignore */ }
  }

  function installToolbox(ws) {
    if (!ws || typeof ws.registerToolboxCategoryCallback !== 'function') return;
    // Blockly 9.x 只有 getAllVariables()；老版的 getVariables() 已被移除。
    // 之前这里直接调 getVariables()，点「变量」分类时回调抛 TypeError，
    // flyout 被中断 —— 表现就是变量快捷栏怎么点都展开不了。
    function allVars(workspace) {
      try {
        // 项目固定使用 Blockly 9.3.3：只认 getAllVariables()
        return workspace.getAllVariables() || [];
      } catch (e) { /* 单个变量异常也不能让分类打不开 */ return []; }
    }
    function listsOf(workspace) {
      try {
        if (typeof workspace.getVariablesOfType === 'function') {
          return workspace.getVariablesOfType('list') || [];
        }
      } catch (e) { /* ignore */ }
      return allVars(workspace).filter(function (v) { return v && (v.type || '') === 'list'; });
    }
    // 新建变量 / 列表：只建立数据，不往画布塞积木块（可在已有积木的下拉里切换到它）
    function createVar(type) {
      var isList = (type === 'list');
      var name = window.prompt(isList ? '新列表的名字：' : '新变量的名字：', '');
      if (name == null) return;
      name = String(name).trim();
      if (!name) return;
      // 变量和列表最终都写进同一个页面数据属性（safeVarName(名字)），
      // 同名会互相覆盖，删除时也会互相牵连，所以从建立时就禁止重名。
      var clash = allVars(ws).some(function (v) { return v && v.name === name; });
      if (clash) {
        window.alert('已经有同名的变量或列表「' + name + '」了，请换一个名字。\n' +
                     '变量和列表共用同一个数据名，不能重名。');
        return;
      }
      try {
        if (!ws.getVariable(name, type || '')) ws.createVariable(name, type || '');
      } catch (e) { /* ignore */ }
      refreshToolbox(ws);
    }
    ws.registerButtonCallback('DBX_CREATE_VARIABLE', function () { createVar(''); });
    ws.registerButtonCallback('DBX_CREATE_LIST', function () { createVar('list'); });
    ws.registerToolboxCategoryCallback('DBX_VARIABLES', function (workspace) {
      // 只放一套通用积木：变量通过下拉框切换，新建数据无需再单独加积木
      var out = [flyoutButton('建立一个变量', 'DBX_CREATE_VARIABLE')];
      try {
        var vars = allVars(workspace).filter(function (v) {
          // 仅普通变量（type 为空）。列表 type='list'，归入「列表」分类
          return v && (v.type || '') === '';
        });
        if (vars.length) {
          var v = vars[0];
          ['variables_get', 'variables_set', 'sc_var_change'].forEach(function (type) {
            var b = flyoutBlock(type);
            b.appendChild(flyoutVariableField('VAR', v));
            out.push(b);
          });
        }
      } catch (e) {
        console.warn('变量分类生成失败：', e);
      }
      return out;
    });
    ws.registerToolboxCategoryCallback('DBX_LISTS', function (workspace) {
      // 只放一套通用积木：列表通过下拉框切换
      var out = [flyoutButton('建立一个列表', 'DBX_CREATE_LIST')];
      try {
        var lists = listsOf(workspace);
        if (lists.length) {
          var v = lists[0];
          ['sc_list_add', 'sc_list_delete', 'sc_list_insert', 'sc_list_replace',
           'sc_list_item', 'sc_list_index', 'sc_list_length', 'sc_list_contains',
           'sc_list_clear'].forEach(function (type) {
            var b = flyoutBlock(type);
            b.appendChild(flyoutVariableField('LIST', v));
            out.push(b);
          });
        }
      } catch (e) {
        console.warn('列表分类生成失败：', e);
      }
      return out;
    });
  }

  // ------------------------------------------------------------------ //
  // 动态下拉：编辑器在数据 / 组件 / 页面 / 图片变化时刷新
  // ------------------------------------------------------------------ //
  var DYNAMIC_FIELDS = [
    { type: 'vela_text', field: 'BIND', key: 'dataVars' },
    { type: 'vela_image', field: 'SRC', key: 'images' },
    { type: 'vela_show', field: 'TARGET', key: 'targets' },
    { type: 'vela_hide', field: 'TARGET', key: 'targets' },
    { type: 'vela_motion_move', field: 'TARGET', key: 'targets' },
    { type: 'vela_motion_rotate', field: 'TARGET', key: 'targets' },
    { type: 'vela_motion_goto', field: 'TARGET', key: 'targets' },
    { type: 'vela_on_sprite_click', field: 'TARGET', key: 'sprites' },
    { type: 'sc_clone', field: 'TARGET', key: 'sprites' },
    { type: 'sc_delete_clones_of', field: 'TARGET', key: 'sprites' },
    { type: 'vela_sprite_costume', field: 'TARGET', key: 'sprites' },
    { type: 'vela_sprite_costume', field: 'COSTUME', key: 'images' },
    { type: 'vela_sprite_nextcostume', field: 'TARGET', key: 'sprites' },
    { type: 'sc_motion_goto', field: 'TARGET', key: 'sprites' },
    { type: 'sc_change_x', field: 'TARGET', key: 'sprites' },
    { type: 'sc_change_y', field: 'TARGET', key: 'sprites' },
    { type: 'sc_rotate_right', field: 'TARGET', key: 'sprites' },
    { type: 'sc_rotate_left', field: 'TARGET', key: 'sprites' },
    { type: 'sc_xpos', field: 'TARGET', key: 'sprites' },
    { type: 'sc_ypos', field: 'TARGET', key: 'sprites' },
    { type: 'sc_direction', field: 'TARGET', key: 'sprites' },
    { type: 'sc_show', field: 'TARGET', key: 'sprites' },
    { type: 'sc_hide', field: 'TARGET', key: 'sprites' },
    { type: 'sc_touching', field: 'SELF', key: 'sprites' },
    { type: 'sc_touching', field: 'OTHER', key: 'spritesEdge' },
    { type: 'sc_leaving_stage', field: 'SELF', key: 'sprites' },
    { type: 'sc_when_sprite_clicked', field: 'TARGET', key: 'sprites' },
    { type: 'sc_sprite_prop', field: 'SELF', key: 'sprites' },
    { type: 'sc_distance_to', field: 'SELF', key: 'sprites' },
    { type: 'sc_distance_to', field: 'OTHER', key: 'sprites' },
    { type: 'sc_costume', field: 'TARGET', key: 'sprites' },
    { type: 'sc_costume', field: 'COSTUME', key: 'images' },
    { type: 'sc_next_costume', field: 'TARGET', key: 'sprites' },
    { type: 'sc_costume_number', field: 'TARGET', key: 'sprites' },
    { type: 'sc_backdrop', field: 'BACKDROP', key: 'backdrops' },
    { type: 'vela_router_push', field: 'PAGE', key: 'pages' },
    { type: 'vela_router_push_param', field: 'PAGE', key: 'pages' }
  ];

  var EMPTY_OPTIONS = {
    dataVars: [['（不绑定）', '']],
    components: [['（先给组件命名）', '']],
    targets: [['（先给组件命名或新建角色）', '']],
    pages: [['index', 'index']],
    images: [['（内置小鸭 Logo）', '/common/logo.png']],
    sprites: [['（先新建角色）', '']],
    spritesEdge: [['（先新建角色）', ''], ['舞台边缘', '__edge__'], ['手指', '__finger__']],
    backdrops: [['（先添加背景）', '']]
  };

  function optionsFor(key) {
    var arr = options[key];
    if (!arr || !arr.length) return EMPTY_OPTIONS[key].slice();
    return arr;
  }

  // 把工作区里所有动态下拉框的选项换成实时数据
  function refreshDynamicDropdowns(ws) {
    if (!ws || !ws.getAllBlocks) return;
    ws.getAllBlocks(false).forEach(function (b) {
      DYNAMIC_FIELDS.forEach(function (spec) {
        if (spec.type !== b.type) return;
        var f = b.getField(spec.field);
        if (!f) return;
        f.menuGenerator_ = function () { return optionsFor(spec.key); };
        // 必须清掉 Blockly 的选项缓存，否则 getOptions(true) 仍返回旧选项，
        // 后续 setValue 校验时会把合法值当成非法值静默丢弃
        f.generatedOptions_ = null;
        var list = optionsFor(spec.key);
        var cur = f.getValue();
        var still = !cur || list.some(function (o) { return o[1] === cur; });
        if (!still && list.length) {
          try { f.setValue(list[0][1]); } catch (e) { /* ignore */ }
        }
        try { f.forceRerender(); } catch (e) { /* ignore */ }
      });
    });
  }

  function setPages(names) {
    options.pages = (names || []).filter(Boolean).map(function (n) { return [n, n]; });
  }

  function setImages(list) {
    var arr = [['（内置小鸭 Logo）', '/common/logo.png']];
    (list || []).forEach(function (a) {
      if (a && a.name) {
        var p = a.path || a.url;
        if (p) arr.push([a.name, p]);
      }
    });
    options.images = arr;
  }

  // 扫描当前工作区：已声明的数据 + 有名字的组件
  function scanWorkspace(ws) {
    var vars = [];
    var comps = [];
    if (!ws || !ws.getAllBlocks) return { vars: vars, comps: comps };
    ws.getAllBlocks(false).forEach(function (b) {
      if (b.type === 'vela_data') {
        var v = (b.getFieldValue('NAME') || '').trim();
        if (v && vars.indexOf(v) < 0) vars.push(v);
      }
      if (COMPONENT_TYPES[b.type]) {
        var n = (b.getFieldValue('NAME') || '').trim();
        if (n && comps.indexOf(n) < 0) comps.push(n);
      }
    });
    return { vars: vars, comps: comps };
  }

  // 编辑器每次刷新时调用：扫描工作区 + 刷新全部动态下拉框
  function updateOptions(ws, spriteNames) {
    if (spriteNames && spriteNames.length) setSprites(spriteNames);
    var scanned = scanWorkspace(ws);
    options.dataVars = [['（不绑定）', '']].concat(
      scanned.vars.map(function (v) { return [v, v]; }));
    var comps = scanned.comps.map(function (c) { return [c + '（组件）', c]; });
    var sprites = (options.sprites || []).map(function (s) {
      return [s[0] + '（角色）', s[1]];
    });
    options.targets = [['（先给组件命名或新建角色）', '']].concat(comps, sprites);
    refreshDynamicDropdowns(ws);
  }

  function setSprites(names) {
    options.sprites = (names || []).filter(Boolean).map(function (n) {
      return [n, n];
    });
    options.spritesEdge = [['舞台边缘', '__edge__'], ['手指', '__finger__']].concat(options.sprites);
    if (!options.sprites.length) options.spritesEdge.unshift(['（先新建角色）', '']);
  }

  // 背景下拉：当前页面里所有背景（造型）的名字
  function setBackdrops(names) {
    var arr = (names || []).filter(Boolean).map(function (n) { return [n, n]; });
    options.backdrops = arr.length ? arr : [['（先添加背景）', '']];
  }

  // 载入 XML 后兜底：按下拉字段在 XML 里的原值强制恢复
  // （若载入瞬间选项尚未刷新，Blockly 会丢弃下拉字段值）
  function restoreDynamicFields(ws, xmlText) {
    if (!ws || !xmlText || !ws.getAllBlocks) return;
    var dom;
    try { dom = Blockly.Xml.textToDom(xmlText); } catch (e) { return; }
    var byType = {};
    ws.getAllBlocks(false).forEach(function (b) {
      (byType[b.type] = byType[b.type] || []).push(b);
    });
    var counters = {};
    var nodes = dom.querySelectorAll('block');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var type = n.getAttribute('type');
      // 一个积木可能有多个动态下拉字段（如「换成造型」的 TARGET + COSTUME）
      var specs = [];
      for (var s = 0; s < DYNAMIC_FIELDS.length; s++) {
        if (DYNAMIC_FIELDS[s].type === type) specs.push(DYNAMIC_FIELDS[s]);
      }
      if (!specs.length) continue;
      // 计数必须对同类型所有块递增（无论是否含目标字段），
      // 否则 XML 顺序与工作区顺序错位，BIND/SRC 会被恢复到错误的块上
      counters[type] = counters[type] || 0;
      var live = (byType[type] || [])[counters[type]];
      counters[type] += 1;
      if (!live) continue;
      var kids = n.children || [];
      for (var si = 0; si < specs.length; si++) {
        var spec = specs[si];
        var val = null;
        for (var k = 0; k < kids.length; k++) {
          if (kids[k].tagName === 'field' && kids[k].getAttribute('name') === spec.field) {
            val = kids[k].textContent;
            break;
          }
        }
        if (val == null) continue;
        var f = live.getField(spec.field);
        if (!f || f.getValue() === val) continue;
        var list = optionsFor(spec.key);
        var has = list.some(function (o) { return o[1] === val; });
        if (!has) {
          // 临时把目标值并入选项，绕过"值不可用"检查
          f.menuGenerator_ = function () {
            return [[val, val]].concat(optionsFor(spec.key));
          };
        }
        // 清掉 Blockly 选项缓存，否则 setValue 校验仍用旧选项而静默失败
        f.generatedOptions_ = null;
        try { f.setValue(val); } catch (e) { /* ignore */ }
        f.menuGenerator_ = function () { return optionsFor(spec.key); };
        try { f.forceRerender(); } catch (e) { /* ignore */ }
      }
    }
  }

  // ------------------------------------------------------------------ //
  // 示例模板（多页面结构）
  // ------------------------------------------------------------------ //
  var templates = {
    counter: {
      name: '计数器',
      pages: [{
        name: 'index', title: '计数器',
        xml: '<xml xmlns="https://developers.google.com/blockly/xml">' +
          '<variables><variable id="v_count">计数</variable></variables>' +
          '<block type="vela_data" x="40" y="40"><field name="NAME">计数</field>' +
          '<value name="VALUE"><block type="math_number"><field name="NUM">0</field></block></value></block>' +
          '<block type="vela_text" x="40" y="140"><field name="NAME">计数文本</field>' +
          '<field name="CONTENT">点击了：</field><field name="BIND">计数</field>' +
          '<field name="SIZE">24</field><field name="COLOR">#37b26c</field></block>' +
          '<block type="vela_button" x="40" y="260"><field name="NAME">加一按钮</field>' +
          '<field name="LABEL">点我 +1</field><field name="ACTION">event</field>' +
          '<field name="TARGET">onTap</field><field name="BG">#37b26c</field>' +
          '<field name="FG">#37b26c</field></block>' +
          '<block type="vela_onclick" x="40" y="400"><field name="EVENT">onTap</field>' +
          '<statement name="DO"><block type="variables_set"><field name="VAR" id="v_count">计数</field>' +
          '<value name="VALUE"><block type="math_arithmetic"><field name="OP">ADD</field>' +
          '<value name="A"><block type="variables_get"><field name="VAR" id="v_count">计数</field></block></value>' +
          '<value name="B"><block type="math_number"><field name="NUM">1</field></block></value>' +
          '</block></value><next><block type="vela_vibrate"><field name="MODE">short</field></block></next>' +
          '</block></statement></block>' +
          '</xml>'
      }]
    },
    stopwatch: {
      name: '秒表',
      pages: [{
        name: 'index', title: '秒表',
        xml: '<xml xmlns="https://developers.google.com/blockly/xml">' +
          '<variables>' +
          '<variable id="v_sec">秒数</variable>' +
          '<variable id="v_timer">定时器</variable>' +
          '</variables>' +
          '<block type="vela_data" x="40" y="40"><field name="NAME">秒数</field>' +
          '<value name="VALUE"><block type="math_number"><field name="NUM">0</field></block></value></block>' +
          '<block type="vela_data" x="40" y="140"><field name="NAME">定时器</field>' +
          '<value name="VALUE"><block type="logic_null"></block></value></block>' +
          '<block type="vela_text" x="320" y="40"><field name="NAME">秒表文本</field>' +
          '<field name="CONTENT">已走：</field><field name="BIND">秒数</field>' +
          '<field name="SIZE">30</field><field name="COLOR">#e05252</field></block>' +
          '<block type="vela_button" x="320" y="160"><field name="NAME">开始按钮</field>' +
          '<field name="LABEL">开始</field><field name="ACTION">event</field>' +
          '<field name="TARGET">onStart</field><field name="BG">#37b26c</field>' +
          '<field name="FG">#37b26c</field></block>' +
          '<block type="vela_button" x="320" y="300"><field name="NAME">归零按钮</field>' +
          '<field name="LABEL">归零</field><field name="ACTION">event</field>' +
          '<field name="TARGET">onReset</field><field name="BG">#ff9f1a</field>' +
          '<field name="FG">#37b26c</field></block>' +
          '<block type="vela_onclick" x="640" y="40"><field name="EVENT">onStart</field>' +
          '<statement name="DO"><block type="vela_timer_every">' +
          '<value name="INTERVAL"><block type="math_number"><field name="NUM">1000</field></block></value>' +
          '<field name="IDVAR">定时器</field>' +
          '<statement name="DO"><block type="variables_set"><field name="VAR" id="v_sec">秒数</field>' +
          '<value name="VALUE"><block type="math_arithmetic"><field name="OP">ADD</field>' +
          '<value name="A"><block type="variables_get"><field name="VAR" id="v_sec">秒数</field></block></value>' +
          '<value name="B"><block type="math_number"><field name="NUM">1</field></block></value>' +
          '</block></value></block></statement></block></statement></block>' +
          '<block type="vela_onclick" x="640" y="320"><field name="EVENT">onReset</field>' +
          '<statement name="DO"><block type="vela_timer_clear">' +
          '<value name="ID"><block type="variables_get"><field name="VAR" id="v_timer">定时器</field></block></value>' +
          '<next><block type="variables_set"><field name="VAR" id="v_sec">秒数</field>' +
          '<value name="VALUE"><block type="math_number"><field name="NUM">0</field></block></value>' +
          '</block></next></block></statement></block>' +
          '</xml>'
      }]
    },
    guess: {
      name: '猜数游戏',
      assets: [
        { name: 'wx.png', data: 'iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAAAAXNSR0IArs4c6QAAAARzQklUCAgICHwIZIgAAAAJcEhZcwAAD3QAAA90AcyR0lUAACAASURBVHic7Zx5fBRV1ve/t6q6s3STEEgCYQmyBoIE3EY2URRGYUZxnkcdVAQ/4wjOOKCv4jIIqAg4OvgIjKPg4wIMCiLOwMOIqIijIMgosoTVsAhhMwmBkDSk09113j8qdelKd0B938/713v0fkjfuvdW1alz7/md5V4lIsL/p59MxocffohS6geXnj17egbIzc2lZcuWAJw+fdrTds+ePQk3LCoq0tfbtGnzgx5y5MiRuk+PHj0AePPNN1FKceTIEQBM00x41rq6uvOOu3PnTpRSzJkzB4D27dv/KF6sWLECyx2sffv2XHzxxee94Ycffqj//u677yguLqauro7U1FRPuwEDBpCRkUEwGCQajbJq1So6d+5MQUEBAwYMoF27dgAEAgH++c9/6n4DBw7UdUopXZ+dnc3QoUP54IMPdF2bNm34xS9+wRdffEEgEGDIkCEAuBNKKcWHH36IaZqeZxsyZIi+VlFRwdChQ/XzAKSkpHDddddxvom5ZcsWjh075vxYtWqVADJu3Di5EDVr1kyKiopEROSvf/2rAAJIixYtRESkqqpKANmyZYvuc+rUKQFk4sSJCeMdPnxYjwHI7t27pX5J8ZQFCxZINBoVwzDk4osv9ozRunVrASQWiyWM7/f7E8aqq6sTEZFAICCFhYWe9hdddJHk5eVdkA+//vWvBZD/+Z//EYsG9B//8R/4fD79WynFlClT6NKli/4NMHjwYBYtWsTo0aOpqqrijjvuIBKJADBhwgSaNm2KUgrLsli4cCF79+7lrrvuApzpNm/ePH2P0aNH079/f2bOnMmZM2c81wD69u2LYRi88cYbZGZmArB27VrmzZvHxIkT8fv9jB492iN9SilisRi5ublMmzaNb7/9lj//+c+NSlVD2r9/v27vvrNlWcyePdvbsKEENvxigHzxxRdaAnv27CkiIrZti23bkpOTI4AopXSJ75uZmSm2bcuUKVN0O5/PpyVQKSXz588X27ala9euopRK+OLuvdwiIvL666+LUkoOHz4stm2LaZoJ9wakU6dOIiLy+eefi1LKI4Hdu3fX44mItGvXTkvghg0bEsZKSUlJkEBDfqISfuWVVzAMg/Lyclq0aIFt27rEK5qqqioMw2Dy5MkAbN26VS/urVu3xrZtVq9ejWEYLFu2DNu2E+41cuRIDMPAMAyKiooA+M1vfoNt21x55ZUYhkFdXd15Jeyqq67Ctm3P7NqxYweGYWgl8mNJKUXCFP6p1HD6KKUSFmK3vrGHSdbnQveKr4vv615r2KZhXbLfP4aM/xuDfP/991iWRbNmzQDYtGkT0WhUr5sAEydOJBqNJtX08+fPJxqNMmzYMCzLSihvvfWWbrt9+3Ysy2L06NGeMfx+P48++igAU6dOJRqNEo1G2b17NwCff/65Hs80TUKh0E9+33hKkMAxY8ZgGJqviIjGefFUWFjImDFjmD9/PkopPc1effVVbrnlFpo1a8Ztt93G999/DziK44033uA///M/yczM5I033iAQCHD77bfz+eefs3fvXk6ePIlt29xzzz0eaXKla/78+TRt2pSbb76Zfv36eZ7Htm26d+/O5ZdfTiwW429/+5tHKPbs2YNt24wcOTJByuM/tEvNmzfnzjvv1PcHR4kk0AcffCCAPPDAAxdU382aNZNevXp56rKzszWMcSHL1q1bE/o+88wzAkhxcbFEIhEBpHXr1iIiMmLECL1QJ1MiIiLRaFSUUo3CGEDGjx8vIiITJkxIqgyJgzHJKF6JnI9cJbJixQqxpJ6777//PqWlpYkcrielFDU1Nfr3qlWreO2115g1axYiwi233IJlWSxdupRZs2ZRVVXFX/7yFzIyMhg1ahSFhYUsXbqUF198kerqat59913Onj3LrbfeSp8+fRg2bBgPPPCABqh///vfWbRoEQBjx45NkLhPPvmEOXPmMH36dNLT07ntttsSnnnRokWUl5czbtw4CgsLeeqppxg5cqSW0LKyMh5++GHuvfdeBg8eDMCpU6f49a9/3SgfADZs2KB5wsqVKxv9WsmKC2NcIF1RUSHHjx/XkEVEpKioSAD59ttv5eTJkx4gXVhYKJZlicg5IP3WW2+JiEhBQYGWwKlTpyYAaaWU9OjRQ0REXnvtNQHk8OHDIiKilJJHHnlERESeeOIJLW0lJSUCyNVXXy0iIj6fTwAJhUKyY8cOAWTOnDkiIpKfn/+jeLFixQrhgvLaCMVbIm5JxkAR8WAt27alrq5OlFLSunVrsW1b7rzzTo3h4qdwPO5zGei2afh3NBqVP//5z2IYhr4W/7f7u66uTmKxmASDQTEMw8PAWCyWtESj0aTFtu1zlsiBAwfYsWMHv/zlL4lEInz00UdJxTcjI4OrrrpK/x48eLDGVunp6YCDudq0aUN6ejqRSISPP/6YTp060aVLF9atW0dVVZUHUhQVFVFZWcnnn39OKBRi1apVCfd18WEwGKRfv34cPnyYHTt2cPXVV5OSksLq1asJh8MMHjyYkpIS9u/fz7XXXutRiACrV6/Gsiyi0Sjp6en06dOH6upqPv74Y8CxhQcMGEBVVRVfffWV7jdw4ECUUqxZs4YePXrQokUL54L7tV988UVxf1ZWVjYqtq4ScSWwvLz8vJLqjuVO4e7du+uxXCXiUpcuXS44bVwl8uqrrwogR44cERERwzD0FHaVSDgcTngedwrHjzVmzBhd16pVKxFJtERCoZDU1tYKIIsXL9bjWfv372fp0qWsW7dOczs1NZVHHnlES8nbb7/N0aNH+cMf/kAwGGTGjBl6IX355ZcJBAJJcaRSijNnziTUG4bBuHHjME2TWbNmccMNN1BQUMDIkSMpLy9HRPj6669Zv349ANdffz2dO3fmr3/9a8JYb775JpmZmdx///2kpaXx0ksv8fXXXwOOtZSdnc2dd97JkSNHWLZsGffcc4+GW5WVlbrN7373O8CBKnPmzCEUCnHfffexYMECzpw5w+uvv47P52PMmDEcOHCAuXPnOh6glStXeuzYhuuPbdvSt29fUUrJiRMn5Jtvvklq87qlMZt44sSJYtu2dO/e3WMLE6dE4mnatGl6nIULF2pvjKtE5s6d67lfLBaT559/3nNfpZR06dJFbNuWNWvWaFvYtm0JBAK679y5c/U7u/Z5nz59RESkVatWekzXFh4+fLgopeT9998XbNuWSCSii4jIyZMnxbIsXdatWyfRaFSys7Plsssuk0gkIrNnz06qROLH6tSpk2cBtyxLtm3bpu/jMvDtt99OYGAsFtPjuK6qSCQi0WjUw8DS0lKN7WKxmNTV1cnjjz+up93OnTvF5/PJddddJ5FIRHw+n1iWJVVVVVJXV6eViohIhw4dJD8/38OLSCQidXV1kp6erhkYjUb1h7Bcl5PrCIgnESEWi2lL4Hy2bLzp5fZxf8eTaZq6zr23iBCNRrVXORqNYhhGQt/4tu74hmFoJeY6HOIVR7x97Y4XjUY9zxr/vvH9kv0djUa9de4Xf/HFF8UwDI8EbN26VUuPYRhSUVEhmzZtSoAHLVq00CpfRKRXr15iGIbs2bMnARIkk7Tbb79dt7dtWwzDkCeeeCKhrYhIcXGxGIYhY8aMSTqeyDklYhiGFBQUSDQa1W3jcWBxcbGYpimvvvqqfpZDhw6JaZrSr18/ERFp06aNmKap39U0TV1Wrlx5DsaIiJbAaDTKpk2b2LdvHwDdunUjGAxSXFzMoUOHPJJ66aWXkpub6/nq3bp1w+fzsXfvXkKhEJdccom+tmPHDmpra7nsssuIRCJs27aNzMxMevXqxb59+6iursa2bY4fP84333wDOOGGrKwswFFwPXv2pG3btp57btmyhRYtWpCXl0deXh69evUCoEWLFmzfvp1gMEjHjh1pSO5siZfgWCxGTU0NxcXFXHTRRTRt2lTzaMeOHV6Jdb/aCy+80CiMWb9+vYiIZGVlJax754MxnTp1kqysLE9dYWFhghJZtGiRiDQOY5IpmYZkGIY8+uijCfV79uwRQAYOHJgggdu2bRNAK5H4Z3LLsWPH9DUXxrjl/fffF+vf//43Tz31FN999x0AQ4cOJSUlhZUrV/Ldd9/x+9//XnN8yZIl7N69m7Fjx3LjjTfyu9/9jjFjxnD27FnAAdJLly7V7V977TXtPF20aBF/+9vftLt/6NChBAIBVq5cyYcffsiCBQt0hK0hPf/88yxcuNBTN2TIEMaOHcuIESOorKxM6ogFx2m7cuVKLcErVqzAtm2GDx9O06ZNWblyJZ9++ilDhw4FHKC+cuVK3d/td/PNNxMOhwF4/PHHGTBgAJdddhn885//TPjirtS4a6ArgSIimzZtEkDuv/9+EXG8MW4/15RLRq43ZseOHVJXV+cB0q5348eUMWPGiIgDM9y6ZBLYGKWnp2tINHr06EbBfXx7t40HSLucHjduHM8++yyBQEBz/+KLLyYUCumwZevWrWnXrh2hUCipb+z06dMEg0E2btxI9+7dATh58iT5+fk89NBDVFdXk56erjXf0aNHycjI0BIMjnY7ffp0gj/Qtm2aNWtGt27d2LBhA36/H4Ddu3cjIjqIdSFq3rw5sViMvXv3EgwGPdeKi4tp27YtAF999RXXX3+9vrZ3717Nh3geaS4cPXpUI3+Xzpw5w8aNG7n88svJzMzk8ssvJxgM8uWXX9KmTRvtiPT7/fTt25dYLMbatWs900lEqKmpwbZt/cC2bTNgwAB9vSE1fDG3T//+/bnooovIyMjQ9U2aNAGcyJ0b392+fTunT5+mT58+CUytrq4mEono6N7GjRspKysDHH9AJBLhkksuITU1lc6dO+tn3L9/v/5oHTt21N73/+Mp3Lx5c2nZsqWIiHZdbdu2TbevqKjw2ML/L6hv374XtIXjlUh8aWwKp6WlJZ/CrVu35q677mLnzp1s2rSJu+66S8dyDx065Pl677zzDiUlJQCUlJSwcOFCwuEw0WiUhQsXEolEGDFiBGvXrmXr1q0MGzaMlJQU7rzzTh2pKyvewf6PPkHFbAylUAAKTAwUAgoUYCmFUS89BmAqVf/8CkERAyIiRIEYgu3zU3DzL8ls08rzzKdPn2bFihUeSXbfJRwOc8cdd+hry5cvT5D89957j3A47AHcX3zxBbFYjGuuuQYl4syhF154gfHjxyMinDx58pyIAuvXr6dPnz5kZWVx6tSphJu41LRpU06ePElRURHFxcWUlJTQqVMnT5sXmreD0BmHKQiGAoXCj0IpwVAKn3IY6KtnoB8bBRgKRBQxMQgjnI3ZnBXFWRHOiE2/yY9xzROP0K9fP9avX084HObAgQN07do16fMWFRWxdetW/Ts/Px/btjl8+LCua9mypY7rNKSVK1diNKxMSUnRvq4ePXoQDofp3bs3AGVlZXz55ZcA3H///dTV1dG8efOEgTdt2kQ4HObGG28kLy/Pc82oq8NQgqXAD/hQpAI+ZZMKpCpIA1IRUrFJxcaHIkWBKQrEBmIoWxymil0voRA7WwucW1czMjK45ZZbqK2t1Xk1tbW11NbWat9lQzp69ChpaWm6fPXVV5w9e5a0tDRSUlI4e/asLtdff/05JeLz+TzaxU3TiEQi+m9wkHsgENDBbKm3kdPT00lLSyMUCpGWlqZtVMuyCIVC+P1+fD4fpjjT1bRtLAN8CAqFTxlYKCwUPsPGJwqzfv1XImCDUjYohdRPZSUCAkoJljiTGxxrxWWQa1mAg1Pd50pLS9Nata6ujmg0SkpKCmlpafo93akrcc7f1NRU6urqdL2WwHHjxlFTU0NNTY0OLhUXFxMMBj3FbdelSxeCwSCVlZW0aNGCmpoadu7cSTAY1ObOtm3b2LJlC8FgkClTpgBgKfCJ4DMUFjamUviVItVW+IEUBSli4Dcc6fS5zFUKU5z1UNkKs/7DmfX1CsFwVlTWrFlDKBQiFAqxZMkSAoEAM2bMIBQKacdDRUUFGzduBJygVSAQ4NNPP9X9Pv30U8AxI9PT0z1Qa+TIkaSnp/Pxxx8nxoUrKio4ffq0Z2pWVVURjUbJysoiEAhQWVnpCUzbtk1lZSVVVVWAs3CfPHlSQ4V48onCUIJPgSkWPpz1zlLgUw4TffUKxP26AjhLv4ltO1NWAdiOZCmUI4n1DAyHw9pqcCOJ0WiU06dPeyCQbduEQiFM06RJkyaEQiFqamo8MCoYDGqPTkpKCtXV1ViWRTAYdDw6DV8wJyeHrKwsKisrdV3fvn3ZsGED+/fvZ+/evQnrXllZmaeuf//+gAM+XUPcJUM54NMSA1OBTzmS5lcKnxL8StVrYANVDxFtJdgIiBAzFIbtKpz6NgqUcrkKTz/9NM8++6znvp999hmZmZnU1dVpKdy+fTs9e/Zk7ty5vPzyyxpEx4d39+7dq3VCOBwmNTWVd955R5uWxtq1a+nduzd/+ctfGvKSkpIS+vTpw/bt2wH4+c9/zm9+8xtPm1WrVukkyWAwyIYNG7TX49Zbb2X48OGsX79ep2K4mtdQ4kgfjjLxKyHFMPDVFz+CXznFJ4IJGChMUShsxHY0MoCyHelz18DNmzcnvItL1157LQMGDNASCjBjxgyuvvpqysvLKS8v5+qrr/b4AMAJK/z85z/XH2jgwIF89dVXWKdOnWLjxo2eSJtLZ86c0VoX8ESpXLriiiu0w8CyLHr37q0X4s2bN5OdnU2fPn10e4WjRCwczemscYJfGaQohaUcPGgqE+oZgtgIEFWCCDiTW1AC4kpevUIBzgu13NhPPK4rKSnR+BacPBr9vPVQau3atXod3LlzJzt37qSyshJr0KBBlJaW8tZbb9G2bVtKS0sTzJ9ly5Zx6aWXeurmzZvH5MmTKSoqIicnh4MHD1JTU0O7du2YP38+HTp0QEQSUmwtBWY98yzqp7BS+JWBDxNTOcxTgO2aecrAFojYddiOqxSp/0+JA7DjDcI+ffp4PjxAv379WLBgAQUFBdqr7GrXqVOnMnz4cE/d5s2bue222+jduzemaVJbW4vf79ezERzfgKWU0tlKhw8fpk2bNti2zbFjx6ioqACcRPK2bdvqLKzmzZtrN08kEsG2bfLz8zl16hSHDh1CKUVKSgpAQlzWBCwUJoKFYCl3yhr4DDCVgaVMRCDqfkfbmcJpyqJWbBxQVW+yUC+VSpD6D98wZxscmNaYwyEnJ4eOHTtqyW3atCnl5eWAYx+7pJQiOzvbM6b10UcfMWzYMM+AVVVVtGrlNYkACgoK6Ny5s2cq79q1y2O1AFxzzTX67+zsbP0wAIZSmIYrfSam4WA/0xB8hqGnMCgQh/kRw4aYjeFYeihR9QadwwxR4kimRw699K9//Ssp6I+niy++GKUUpaWlSZ0c4XDY866rVq1KtET+P/04stq3b8/YsWN1xUsvvUQsFuMPf/gDFRUVLF68WIv96NGjyc3N9Qzw3//939qCcRfZ22+/XX9t0zR56aWXuOKKK5x0XMBAHGAM+ACfMjDNeuwXF/kzovWxChzJddwhUq8vHFiDiseA3ul53333cfr0ad5+++0fxIxRo0Y16lMcPXo0Sinmzp3rZWCPHj08medKKY0Dt2zZwuLFi/W1559/PmHgxx9/PKFuwoQJOhO1oqKCnJwcJk6cyJVXXolZD4MVgk8ZzpQ2BdMwMJXCMOoBiYBRr39U1A3gODyz66eqjato3OKl2bNns2/fvh/MwGnTpjV6bebMmQkMVEph/etf/+LBBx/k7rvv5sEHH0zaedSoUR47GdDr2qeffkpmZqZnzXBx4LBhw6iqquLrr7/WTgVLKUcCDQcs+wyFaTprn2kamMrAXc5cIK3qgbLtals55/ZS9RKodQoOtPryyy89XvMrr7xS5zIC3HDDDdpyeu655zxbK1yveEPy+/188cUXTJo0iTVr1jjvU1VVxdatW8/tvIkjwzAIBALs27dPOxFcch0MnTp1olmzZqSnpyMinDlzRptIxcXFVFdX07VrV43+FZBiWBrKmIaNaVj1Rq4C5di0NmC7sWsEW4QINjEBQSFiO21wrRS73hyBtLQ0evTowdmzZwmHw6Snp9O8eXN69OihnQxff/21vnb8+HGOHz+ulyAXx7o2sIjoa3379vVo4vMqkaKiImpqarjiiisAOHLkiHY4vPDCCwC0bdtWS9ypU6c8jocDBw5QUVFBMBjkmWeecb4YCqPehDMNwTRMlOGIm1ggpkJMhY3trHUCUWxi9ZIjYmAbjkM1vU0e1y18jT+cLeOhcCW9H3Vm0NSpUwkEAgQCAYYPH04oFOLBBx8kEAh4PEtFRUXaeRAKhWjVqhVt2rTx1LnMat68eQLacN6nnqLRKKFQiEAgQHp6usdZkJKSQiAQ0GAyLS0Ny7K0RDbmWwO0q8uNJxjKwBIDwwDDAGUamJbheFKUY1nYthBT54C0ADGcNS+KEFGKa1YvI7d/byIinLXDEAMz3YeNsG7dOjp06EBZWZmWJnc2xXtkGlJKSsoPyuA3TVO79NSyZcvk5ptv1heTeaQ3bNhA7969adq0KQUFBdoN1JAa9gMHpLpBG4BPstqTQoRUyyDFFFJMhc9UKENhGVa9ohAidTbRmOODOVsX5WzM5kwsRq2tuHTZ27S8/jqWl21mxJ652ESwAcHgt83781K3UQ0Vsia/36+lsFevXgl2c2lpKfn5+Un7pqametxaAFbfvn1ZvXq1XlwHDhxIMBjUGZvgpGqAk/jtSt2yZct45ZVXgHP2omsixVPiphaphzJgmCamqVA+A6PeqrBth4FiCNGow8CIOPGPCAp/pw60vP46Pjv9Lbfv/gu2ciCOjaN0yqLVlNQeo3NqS9Z8+ql2kvTq1Ysnn3xSP8fixYvJyclJyqgfQ1ZOTg7XXXedrhg8eDBZWVmeQIxL1157rf67tLS00TTgC5GpFJZlYplg+AwM7XpWgO38X880qJ+2AhFRBNvlYyPcvGkGYsLAtAL+VfMtT7e/kZtze/O7PW/ws39P4eBVMzFNk2XLlgEkJHredNNNenr/n5D1ySefcP/993Pvvffy8MMPs2vXLkKhkCcQEy9FPXr0YMmSJYwYMUJvDSgvL9d7hBsa8Q2dCYZpoURQSlCG4TgIlQLT0RhKVL1mhVj9baMIESCCgN+HiFCLoJTBxM7DWBhoxdTv3ueqTdM4zRmUUoRjdVx++eUsX748wVQF+NnPfkZhYSHvvPMOU6ZM4b333gMcZREfaIqnSCSik5YA5syZg1VdXc2ePXu046Br166cPHky6W5zv99Ps2bNqKurIxAI0KFDB8CJ1Pt8PlJTUxOicO6NDcPANE06TniI8hdexDANlN9xyRh+04mt2ACCMmPYdgyp9zjFDIVtOR7kmopyTGUwOu8aXitfze07XsVScCR6GgMbpaAwNY/mvgDKUnTo0EFv74r/qNu3b9fK5MiRI2zbtg3TNMnPz9cbGuMpFotRW1vL1q1bHeVRv2/Gk952ISovL2f37t3a0+JSXl4edXV1VFVVaW3bkCZOnMgzzzxD2//1e9r+r98nbfNjaEaX4XxVs5ctZw6ew4sCeVYm87vdh4HBtdddy/Hjxz3QxfVdJkMOpaWlCVFEl5o0aaIVyOLFi7n11lsBUP/4xz/kV7/6FY899hh/+tOfmDRpErW1tcyYMYNWrVrp5GtwQoKGYXiYNH36dJo2bcrRo0d1v2QUi8USlExGRgaPPPKI/j1z5kxOnDihMWMy+v7771m4cCEPP/ww00v+jmGZxAzHwZptpXNHi/4ErVQmPvEE06dPJzs7m/vuuy9hnD/96U9kZ2fz29/+VktovJe6bdu2ng2N7paNJ598UkcjR40aBf/4xz8EkMcff1zqg+y6XHrppZ70hoyMDLnyyis9dVlZWT9of5mbnRVfGqZRdOrUyZMlm4y2bdum7xezbbHF3cTj/Hvo0CG58cYbf1CGl1vcDNX4TC83Q9WltLQ0SU1NFRGR2267TQD5+OOPxSoqKmL27NlOrlsDKi0tZdy4cYCjSJ5++mkikQgPPPCArps0aZJO8ElG1dXVTJ48mYyMDF588UXAkcbx48dTVVXFQw89pNuOHj26UZDrUl5eHuPHj0+IsGVlNUNEtH0Ljo1bUVHh2Yj93HPPaSfvkSNHmDlzJkuXLqWkpCSp/evS1KlTk1+I57Jt2/oLJNuqUFVVJV9++aXnWmVl5Xklxt1HF59cFA6Hk0pCSUnJecc6HyXbdlFXVyc7d+5MqHPpm2++aVQqG0pgPMVLoGbgs88+qzu72VluJtaGDRtERKRJkyYJU/hC1JCB8Wm8jWVCiYg+Y6Gx8vDDD4vIuWkXvx/vj3/8YwKzGlJaWppeotwEy6NHj563vTuF48k6c+YM5eXl541kuZSfn6+1lBs8BwcWuLGU0tJSWrVq5dl60K5dO5RSHDx4kJycHL1YZ2dnc/DgQXJzcz2g9uDBg57nyc7OJj09nUOHDuHz+cjLy8M0TQ4dOuSJrlVVVekzGvLz8zl8+DCpqalJNWvbtm11vDcrK4v8/PwEjQ3O+TQN4zoe+vvf/57wdV0J/Prrrz0SGE/xG23cRf3EiRMCyPbt2xPau0pkz549us5N6F6xYoWui8ViCc/zzjvvJGx3nTFjhqeNbdv6HtOnTxcRJxew4dkw56O8vLyEe7tJ9I1KYK9evfSpFVKPBV2Y0tCOHT9+PC1btmT8+PGNfxEciOC69DMyMpgyZQqDBg0iEAjw2muvAY53OzMzU++7++yzz3jssce0M2LQoEE6kN2zZ08Mw9DQI54mTJig0y8GDhzItGnTCIfDTJw4kSeffBLbtpk0aRKdO3dm5MiRut8zzzyjYdVNN92klWhmZqZ2LIuItv2Ted7dRo1SQwls0qSJ9O7dW0TOL4Hxxc1edalz587i9/s9db/85S+1EnElcPLkyeeVFlcC3d2a8RS/BrqbqocMGeJpSay9+AAAB+ZJREFUE59x6sKYvLw8adeu3Xnv25C0JTJ37lwNM1yKB5bg5P250hlvC588eZJu3bqRnp7Orl27dPtBgwbpNeqVV15h9uzZHDx4UEv6999/zzXXXKMTGm+44Qa9dr788sssWbIEgP/6r//SZ2Pt2bOHX/3qV9x0003s2rWL2267Tefx3HfffRp2geMwbdu2LTt37mTLli0UFhaybds2LMti8+bNOlvVXSM/++wzjh8/TmFhoR5j/fr1NG3alEsuuQTbttm6dSsPPvggH330Ea+//rpjyokIJ06c4Ntvv9Wim4zcpGtwFl43uH7s2DF2795Ns2bNPE4In8+nGXjixAl9BIn7EeKPJQH0zihwglGufR5/VkM4HGbXrl384he/oGvXrhw4cICjR4/qPvG0e/duDMOgW7dufPfdd+zatUu/W0FBQdL38/v9HiFwp/mePXt036NHj7Jr1y7Hw/Pee+8JIBMmTNBi2XCnUvwUduvOd1iZu6n6wIEDuu6HWiIN21youFM4Hge6SkREZPv27UlxoDuF47fnJsO+yZSIiwNXr14tVrt27bj77rs9uS9+v59Ro0ZpjruOxzvuuEMb1E2aNGHBggUMHz68UQcCOLHi9957D9u2GTFiBMuXL6e6uhpwfHTxh+pUV1ejlNKJ3/EzQURYtGiR3uW0a9euRrOwtm7dqsOx8fnOAEuXLtUHk7njXnHFFdqz5FJ5eTlr1qxh+fLlNGnShFgspuGM+1xORPAn0qxZsxq1ROIl8OjRox4g3blz5/NKlGmaSe8XiUREKaWP33v++ecblcAfW1wlEk9r165NaOdK4K233iqAfPLJJ2Jt27aNefPmXXCXj3u9Xbt2jB07lv79+zNjxgymT59OkyZNmDx5MmfPnmXSpEkcP348of+aNWuora3lnnvuARxYkJmZycSJE3njjTc86w44h0O4Hu8RI0bohf3YsWM8+uij/Pvf/064x6BBg7Ria0i7d+/mzTffPO87Tps2DcuyeOyxx3Td5MmTSU9PZ9KkSUSjUR5//HF69OjBZZdd5kQjly5d+qO+lrsV3qWsrCx9UIO70cYt8RLolm+//Vbbwu4aOHTo0AQJfOqpp3TdkiVLtAQ2fJ54CXzyyScbnTHvv//+BSWwZcuWGsa4EnjixAkR8cKeJUuW6HE1A//4xz96tus3LNFoVILBoGbg7NmzxbIsPah7PAA4Rz9FIhGxbdszhd1t9CIidXV1+veQIUMSGOhu33e35LsM7NGjh4TDYZk+fXoCA03TFL/fL36/X3w+n+d+sVhMwuGw59SOhgwMh8N6d5PLQL/fLykpKXLq1Cmpra2V2tpaz0ZvjQPdLfY7duxImM7t27cnLS3NU2/bNtFolIKCAu0ul/rFNT09Hcuy2Lt3r4YYJ06coKSkhI4dO+rN2D6fLyEEICIeaOOSu+grpfD7/eTk5NC1a1cOHjzI6dOnKSgo0NAnJycnIbx65swZjhw5khSiHT9+3BPCcFPcwLGZTdOktLQ0QVm2adMG3n33XQH0FvuGXweQL7/8UkREgsGg9O3bV0REZs6cKYCcPHmy0WnTrl27hLGSTeF4CbxQcZWIS/HemKeffloAefbZZxOeJdmewB9SKioqREQkNTU14dqaNWvOSeBPPT9w9erVNG/enIEDB+q69evXU1NTQ21tbUL79evXa8AcDof55JNPaNOmjQ6Ziojeo+FS9+7dNZRq3779T3pOV/IaHmImIuzbt4/vv/+eyy+/HNu2+eabb8jIyKCwsDDptl43HygjI+OcBLowgx8pgXDutB+XCgsLf9RX/uCDD3TfaDSacP3dd99tVMrjJdBVPMkkcMWKFQLJfYT33nuvgLO9/8CBAwJI//79PW3iJTBeifzkDNXRo0dTVlZGZmYmx48fJzc3V5t669ato6yszFPivRk+n4+ysrJG468AjzzyiO67bNkycnNzyc3N1enDs2bNIjc3V0OmFi1aICKUlZVRXV1Nbm6uNhVzc3OZN28eZWVlSUMGL7zwAmVlZToXvKysjEmTJul75ubmevwCv/3tb8nNzWXdunU//QxVdzOeUgrbtikvL9fGuWsjx1N8apxSipycnPOeNJ6enq6nbTgc1vmIrhP37Nmzntxr9++cnBz9PODYsuXl5YTD4UZTOZo0aeKJ6+Tk5JCenu4ZP57c2EkkEoElS5YIIJMmTdJTqCF8cd3l8VN41qxZGrbk5eV5ThVyyT0JSMR7ElEoFBLLsvQpQUOGDNEwKDU11XNaUbJnEjkXgjh06JCGO0899ZT4fD6ZPn26nqrucXvLly8Xn8+n6zMyMsTn8zVa4iEaOPEgF+a4xXP83aFDh1i7dq2WkHhyf8diMf13y5YtufLKK9m4cSORSISNGzfi8/n42c9+pvv17NlTww/3TJbNmzcTCoW44ooryMnJ8ZxG5JJlWRw+fDjpKR7u/V2YYVmWnpatW7fmkksu8YQUlFL4fD6aNWtGz549df+Gu1Dd5/X5fPqYgnhos2PHDlJTUz1n4ADnJPCHlobRqqZNm+przZs3b3Sxd6ljx44JDtXrr7/eA8hFvJbI+cr5AkHno2Sw5Pjx4/p6Mls4LS0tYRzr4osv5rnnnkv40o1Rw/0jro0IXDCmC05YIN6/B3D33Xd7Mr/AyQT7IdlT54tJn4+mTZuWkCkRv0vzoosuSuBLsuDS/waWrqdhjZWogQAAAABJRU5ErkJggg==' },
        { name: 'zfb.png', data: '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' }
      ],
      pages: [{
        name: 'select-mode', title: '选择难度',
        xml: '<xml xmlns="https://developers.google.com/blockly/xml">' +
          '<block type="vela_text" x="40" y="40"><field name="NAME">标题</field>' +
          '<field name="CONTENT">猜数游戏</field><field name="SIZE">26</field>' +
          '<field name="COLOR">#37b26c</field><field name="X">0</field><field name="Y">-195</field></block>' +
          '<block type="vela_button_param" x="40" y="140"><field name="NAME">简单模式</field>' +
          '<field name="LABEL">简单模式 0~50</field><field name="EVENT">onEasy</field><field name="PARAM">easy</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">16</field>' +
          '<field name="X">0</field><field name="Y">-115</field><field name="W">170</field><field name="H">44</field></block>' +
          '<block type="vela_button_param" x="40" y="240"><field name="NAME">普通模式</field>' +
          '<field name="LABEL">普通模式 0~50</field><field name="EVENT">onNormal</field><field name="PARAM">normal</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">16</field>' +
          '<field name="X">0</field><field name="Y">-45</field><field name="W">170</field><field name="H">44</field></block>' +
          '<block type="vela_button_param" x="40" y="340"><field name="NAME">困难模式</field>' +
          '<field name="LABEL">困难模式 0~100</field><field name="EVENT">onHard</field><field name="PARAM">hard</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">16</field>' +
          '<field name="X">0</field><field name="Y">25</field><field name="W">170</field><field name="H">44</field></block>' +
          '<block type="vela_button_param" x="40" y="440"><field name="NAME">地狱模式</field>' +
          '<field name="LABEL">地狱模式 0~250</field><field name="EVENT">onHell</field><field name="PARAM">hell</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">16</field>' +
          '<field name="X">0</field><field name="Y">95</field><field name="W">170</field><field name="H">44</field></block>' +
          '<block type="vela_button" x="40" y="540"><field name="NAME">关于按钮</field>' +
          '<field name="LABEL">关于</field><field name="ACTION">event</field>' +
          '<field name="TARGET">goToAbout</field><field name="BG">#a5d6a7</field>' +
          '<field name="FG">#37b26c</field><field name="FS">15</field>' +
          '<field name="X">0</field><field name="Y">180</field><field name="W">110</field><field name="H">38</field></block>' +
          '<block type="vela_onclick_param" x="340" y="40"><field name="EVENT">onEasy</field><field name="PARAM">val</field>' +
          '<statement name="DO"><block type="vela_router_push_param">' +
          '<field name="PAGE">game</field><field name="K1">min</field>' +
          '<value name="V1"><block type="math_number"><field name="NUM">0</field></block></value>' +
          '<field name="K2">max</field>' +
          '<value name="V2"><block type="math_number"><field name="NUM">50</field></block></value>' +
          '<field name="K3">chances</field>' +
          '<value name="V3"><block type="math_number"><field name="NUM">30</field></block></value>' +
          '</block></statement></block>' +
          '<block type="vela_onclick_param" x="340" y="140"><field name="EVENT">onNormal</field><field name="PARAM">val</field>' +
          '<statement name="DO"><block type="vela_router_push_param">' +
          '<field name="PAGE">game</field><field name="K1">min</field>' +
          '<value name="V1"><block type="math_number"><field name="NUM">0</field></block></value>' +
          '<field name="K2">max</field>' +
          '<value name="V2"><block type="math_number"><field name="NUM">50</field></block></value>' +
          '<field name="K3">chances</field>' +
          '<value name="V3"><block type="math_number"><field name="NUM">20</field></block></value>' +
          '</block></statement></block>' +
          '<block type="vela_onclick_param" x="340" y="240"><field name="EVENT">onHard</field><field name="PARAM">val</field>' +
          '<statement name="DO"><block type="vela_router_push_param">' +
          '<field name="PAGE">game</field><field name="K1">min</field>' +
          '<value name="V1"><block type="math_number"><field name="NUM">0</field></block></value>' +
          '<field name="K2">max</field>' +
          '<value name="V2"><block type="math_number"><field name="NUM">100</field></block></value>' +
          '<field name="K3">chances</field>' +
          '<value name="V3"><block type="math_number"><field name="NUM">10</field></block></value>' +
          '</block></statement></block>' +
          '<block type="vela_onclick_param" x="340" y="340"><field name="EVENT">onHell</field><field name="PARAM">val</field>' +
          '<statement name="DO"><block type="vela_router_push_param">' +
          '<field name="PAGE">game</field><field name="K1">min</field>' +
          '<value name="V1"><block type="math_number"><field name="NUM">0</field></block></value>' +
          '<field name="K2">max</field>' +
          '<value name="V2"><block type="math_number"><field name="NUM">250</field></block></value>' +
          '<field name="K3">chances</field>' +
          '<value name="V3"><block type="math_number"><field name="NUM">10</field></block></value>' +
          '</block></statement></block>' +
          '<block type="vela_onclick" x="340" y="440"><field name="EVENT">goToAbout</field>' +
          '<statement name="DO"><block type="vela_router_push">' +
          '<field name="PAGE">about</field></block></statement></block>' +
          '</xml>'
      }, {
        name: 'game', title: '猜数游戏',
        xml: '<xml xmlns="https://developers.google.com/blockly/xml">' +
          '<variables>' +
          '<variable id="v_input">input</variable>' +
          '<variable id="v_gameOver">gameOver</variable>' +
          '</variables>' +
          '<block type="vela_data" x="40" y="40"><field name="NAME">min</field>' +
          '<value name="VALUE"><block type="math_number"><field name="NUM">0</field></block></value></block>' +
          '<block type="vela_data" x="40" y="120"><field name="NAME">max</field>' +
          '<value name="VALUE"><block type="math_number"><field name="NUM">50</field></block></value></block>' +
          '<block type="vela_data" x="40" y="200"><field name="NAME">chances</field>' +
          '<value name="VALUE"><block type="math_number"><field name="NUM">30</field></block></value></block>' +
          '<block type="vela_data" x="40" y="280"><field name="NAME">input</field>' +
          '<value name="VALUE"><block type="text"><field name="TEXT"></field></block></value></block>' +
          '<block type="vela_data" x="40" y="360"><field name="NAME">message</field>' +
          '<value name="VALUE"><block type="text"><field name="TEXT">请输入数字</field></block></value></block>' +
          '<block type="vela_data" x="40" y="440"><field name="NAME">targetNumber</field>' +
          '<value name="VALUE"><block type="math_number"><field name="NUM">0</field></block></value></block>' +
          '<block type="vela_data" x="40" y="520"><field name="NAME">gameOver</field>' +
          '<value name="VALUE"><block type="logic_boolean"><field name="BOOL">FALSE</field></block></value></block>' +
          '<block type="vela_text" x="320" y="40"><field name="NAME">范围文本</field>' +
          '<field name="CONTENT">范围: {{min}}~{{max}}</field><field name="SIZE">13</field>' +
          '<field name="COLOR">#37b26c</field><field name="X">0</field><field name="Y">-215</field></block>' +
          '<block type="vela_text" x="320" y="120"><field name="NAME">剩余文本</field>' +
          '<field name="CONTENT">剩余: {{chances}}次</field><field name="SIZE">13</field>' +
          '<field name="COLOR">#37b26c</field><field name="X">0</field><field name="Y">-185</field></block>' +
          '<block type="vela_text" x="320" y="200"><field name="NAME">显示文本</field>' +
          '<field name="CONTENT"></field><field name="BIND">input</field><field name="SIZE">26</field>' +
          '<field name="COLOR">#37b26c</field><field name="BACKGROUND">#ffffff</field>' +
          '<field name="X">0</field><field name="Y">-130</field><field name="W">150</field><field name="H">40</field></block>' +
          '<block type="vela_text" x="320" y="300"><field name="NAME">消息文本</field>' +
          '<field name="CONTENT"></field><field name="BIND">message</field><field name="SIZE">14</field>' +
          '<field name="COLOR">#37b26c</field><field name="X">0</field><field name="Y">-80</field></block>' +
          '<block type="vela_button_param" x="600" y="40"><field name="NAME">键7</field>' +
          '<field name="LABEL">7</field><field name="EVENT">pressKey</field><field name="PARAM">7</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">19</field>' +
          '<field name="X">-55</field><field name="Y">-20</field><field name="W">56</field><field name="H">42</field></block>' +
          '<block type="vela_button_param" x="600" y="120"><field name="NAME">键8</field>' +
          '<field name="LABEL">8</field><field name="EVENT">pressKey</field><field name="PARAM">8</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">19</field>' +
          '<field name="X">0</field><field name="Y">-20</field><field name="W">56</field><field name="H">42</field></block>' +
          '<block type="vela_button_param" x="600" y="200"><field name="NAME">键9</field>' +
          '<field name="LABEL">9</field><field name="EVENT">pressKey</field><field name="PARAM">9</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">19</field>' +
          '<field name="X">55</field><field name="Y">-20</field><field name="W">56</field><field name="H">42</field></block>' +
          '<block type="vela_button_param" x="600" y="280"><field name="NAME">键4</field>' +
          '<field name="LABEL">4</field><field name="EVENT">pressKey</field><field name="PARAM">4</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">19</field>' +
          '<field name="X">-55</field><field name="Y">45</field><field name="W">56</field><field name="H">42</field></block>' +
          '<block type="vela_button_param" x="600" y="360"><field name="NAME">键5</field>' +
          '<field name="LABEL">5</field><field name="EVENT">pressKey</field><field name="PARAM">5</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">19</field>' +
          '<field name="X">0</field><field name="Y">45</field><field name="W">56</field><field name="H">42</field></block>' +
          '<block type="vela_button_param" x="600" y="440"><field name="NAME">键6</field>' +
          '<field name="LABEL">6</field><field name="EVENT">pressKey</field><field name="PARAM">6</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">19</field>' +
          '<field name="X">55</field><field name="Y">45</field><field name="W">56</field><field name="H">42</field></block>' +
          '<block type="vela_button_param" x="600" y="520"><field name="NAME">键1</field>' +
          '<field name="LABEL">1</field><field name="EVENT">pressKey</field><field name="PARAM">1</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">19</field>' +
          '<field name="X">-55</field><field name="Y">110</field><field name="W">56</field><field name="H">42</field></block>' +
          '<block type="vela_button_param" x="600" y="600"><field name="NAME">键2</field>' +
          '<field name="LABEL">2</field><field name="EVENT">pressKey</field><field name="PARAM">2</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">19</field>' +
          '<field name="X">0</field><field name="Y">110</field><field name="W">56</field><field name="H">42</field></block>' +
          '<block type="vela_button_param" x="600" y="680"><field name="NAME">键3</field>' +
          '<field name="LABEL">3</field><field name="EVENT">pressKey</field><field name="PARAM">3</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">19</field>' +
          '<field name="X">55</field><field name="Y">110</field><field name="W">56</field><field name="H">42</field></block>' +
          '<block type="vela_button" x="600" y="760"><field name="NAME">清空键</field>' +
          '<field name="LABEL">C</field><field name="ACTION">event</field><field name="TARGET">clearInput</field>' +
          '<field name="BG">#a5d6a7</field><field name="FG">#37b26c</field><field name="FS">16</field>' +
          '<field name="X">-55</field><field name="Y">175</field><field name="W">56</field><field name="H">42</field></block>' +
          '<block type="vela_button_param" x="600" y="840"><field name="NAME">键0</field>' +
          '<field name="LABEL">0</field><field name="EVENT">pressKey</field><field name="PARAM">0</field>' +
          '<field name="BG">#ffffff</field><field name="FG">#37b26c</field><field name="FS">19</field>' +
          '<field name="X">0</field><field name="Y">175</field><field name="W">56</field><field name="H">42</field></block>' +
          '<block type="vela_button" x="600" y="920"><field name="NAME">确定键</field>' +
          '<field name="LABEL">确定</field><field name="ACTION">event</field><field name="TARGET">checkGuess</field>' +
          '<field name="BG">#a5d6a7</field><field name="FG">#37b26c</field><field name="FS">16</field>' +
          '<field name="X">55</field><field name="Y">175</field><field name="W">56</field><field name="H">42</field></block>' +
          '<block type="vela_button" x="600" y="1000"><field name="NAME">返回按钮</field>' +
          '<field name="LABEL">返回</field><field name="ACTION">event</field><field name="TARGET">goBack</field>' +
          '<field name="BG">#a5d6a7</field><field name="FG">#37b26c</field><field name="FS">15</field>' +
          '<field name="X">0</field><field name="Y">235</field><field name="W">100</field><field name="H">36</field></block>' +
          '<block type="vela_onready" x="1000" y="40">' +
          '<statement name="DO"><block type="vela_raw_js">' +
          '<field name="CODE">this.min = Number(this.min);\nthis.max = Number(this.max);\nthis.chances = Number(this.chances);\nthis.targetNumber = Math.floor(Math.random() * (this.max + 1));\nthis.input = \'\';\nthis.message = \'请输入数字\';\nthis.gameOver = false;</field>' +
          '</block></statement></block>' +
          '<block type="vela_onclick_param" x="1000" y="260"><field name="EVENT">pressKey</field><field name="PARAM">val</field>' +
          '<statement name="DO"><block type="controls_if">' +
          '<value name="IF0"><block type="logic_negate">' +
          '<value name="BOOL"><block type="variables_get"><field name="VAR" id="v_gameOver">gameOver</field></block></value>' +
          '</block></value>' +
          '<statement name="DO0"><block type="controls_if">' +
          '<value name="IF0"><block type="logic_compare"><field name="OP">LT</field>' +
          '<value name="A"><block type="text_length">' +
          '<value name="VALUE"><block type="vela_click_param"></block></value>' +
          '</block></value>' +
          '<value name="B"><block type="math_number"><field name="NUM">4</field></block></value>' +
          '</block></value>' +
          '<statement name="DO0"><block type="variables_set"><field name="VAR" id="v_input">input</field>' +
          '<value name="VALUE"><block type="text_join">' +
          '<mutation items="2"></mutation>' +
          '<value name="ADD0"><block type="variables_get"><field name="VAR" id="v_input">input</field></block></value>' +
          '<value name="ADD1"><block type="vela_click_param"></block></value>' +
          '</block></value></block></statement></block></statement></block></statement></block>' +
          '<block type="vela_onclick" x="1000" y="420"><field name="EVENT">clearInput</field>' +
          '<statement name="DO"><block type="variables_set"><field name="VAR" id="v_input">input</field>' +
          '<value name="VALUE"><block type="text"><field name="TEXT"></field></block></value>' +
          '</block></statement></block>' +
          '<block type="vela_onclick" x="1000" y="520"><field name="EVENT">checkGuess</field>' +
          '<statement name="DO"><block type="vela_raw_js">' +
          '<field name="CODE">if (this.gameOver) return;\nif (this.input === \'\') { this.message = \'请输入数字\'; return; }\nvar guess = Number(this.input);\nif (guess &lt; this.min || guess > this.max) {\n  this.message = \'请输入\' + this.min + \'~\' + this.max + \'之间的数字\';\n  this.input = \'\';\n  return;\n}\nif (guess === this.targetNumber) {\n  this.message = \'恭喜你猜对了！\';\n  this.gameOver = true;\n} else if (guess &lt; this.targetNumber) {\n  this.chances = this.chances - 1;\n  if (this.chances &lt;= 0) {\n    this.message = \'游戏结束！正确答案是\' + this.targetNumber;\n    this.gameOver = true;\n  } else {\n    this.message = \'小了\';\n    this.input = \'\';\n  }\n} else {\n  this.chances = this.chances - 1;\n  if (this.chances &lt;= 0) {\n    this.message = \'游戏结束！正确答案是\' + this.targetNumber;\n    this.gameOver = true;\n  } else {\n    this.message = \'大了\';\n    this.input = \'\';\n  }\n}</field>' +
          '</block></statement></block>' +
          '<block type="vela_onclick" x="1000" y="620"><field name="EVENT">goBack</field>' +
          '<statement name="DO"><block type="vela_router_back"></block></statement></block>' +
          '</xml>'
      }, {
        name: 'about', title: '关于',
        xml: '<xml xmlns="https://developers.google.com/blockly/xml">' +
          '<block type="vela_text" x="40" y="40"><field name="NAME">标题</field>' +
          '<field name="CONTENT">关于</field><field name="SIZE">26</field>' +
          '<field name="COLOR">#37b26c</field><field name="X">0</field><field name="Y">-195</field></block>' +
          '<block type="vela_text" x="40" y="140"><field name="NAME">作者文本</field>' +
          '<field name="CONTENT">作者：B站DuckBoos</field><field name="SIZE">15</field>' +
          '<field name="COLOR">#37b26c</field><field name="X">0</field><field name="Y">-120</field></block>' +
          '<block type="vela_text" x="40" y="220"><field name="NAME">版本文本</field>' +
          '<field name="CONTENT">版本：1.0.0 测试版</field><field name="SIZE">15</field>' +
          '<field name="COLOR">#37b26c</field><field name="X">0</field><field name="Y">-85</field></block>' +
          '<block type="vela_text" x="40" y="300"><field name="NAME">支持文本</field>' +
          '<field name="CONTENT">若您喜欢这款游戏，能否赞赏一下作者，给我点个关注也行啊</field>' +
          '<field name="SIZE">13</field><field name="COLOR">#37b26c</field>' +
          '<field name="X">0</field><field name="Y">-35</field><field name="W">170</field><field name="H">0</field></block>' +
          '<block type="vela_image" x="40" y="380"><field name="NAME">微信赞赏</field>' +
          '<field name="SRC">/assets/wx.png</field><field name="WIDTH">80</field><field name="HEIGHT">80</field>' +
          '<field name="X">-45</field><field name="Y">110</field></block>' +
          '<block type="vela_image" x="40" y="460"><field name="NAME">支付宝赞赏</field>' +
          '<field name="SRC">/assets/zfb.png</field><field name="WIDTH">80</field><field name="HEIGHT">80</field>' +
          '<field name="X">45</field><field name="Y">110</field></block>' +
          '<block type="vela_button" x="40" y="540"><field name="NAME">返回按钮</field>' +
          '<field name="LABEL">返回</field><field name="ACTION">event</field><field name="TARGET">goBack</field>' +
          '<field name="BG">#a5d6a7</field><field name="FG">#37b26c</field><field name="FS">15</field>' +
          '<field name="X">0</field><field name="Y">200</field><field name="W">100</field><field name="H">36</field></block>' +
          '<block type="vela_onclick" x="340" y="40"><field name="EVENT">goBack</field>' +
          '<statement name="DO"><block type="vela_router_back"></block></statement></block>' +
          '</xml>'
      }]
    }
  };

  // ------------------------------------------------------------------ //
  // 示例模板（Scratch 积木版，覆盖上面的旧版界面组件模板）
  // 全部用「当 ▶ 被点击 / 当角色被点击 / 说 / 变量 / 计时器」搭建，
  // 不再出现文本、按钮等旧界面组件积木。
  // ------------------------------------------------------------------ //
  templates.counter = {
    name: '计数器',
    pages: [{
      name: 'index', title: '计数器',
      sprites: [{ name: '小鸭', costumes: ['/common/logo.png'], costume: 0,
                 x: 0, y: -30, w: 90, h: 90, layer: 0, visible: true }],
      xml: '<xml xmlns="https://developers.google.com/blockly/xml">' +
        '<variables><variable id="v_count">计数</variable></variables>' +
        '<block type="vela_onready" x="40" y="40"><statement name="DO">' +
          '<block type="sc_var_change"><field name="VAR" id="v_count">计数</field>' +
          '<value name="VALUE"><block type="math_number"><field name="NUM">0</field></block></value>' +
          '<next><block type="sc_say"><value name="TEXT"><shadow type="text">' +
            '<field name="TEXT">点一下小鸭试试</field></shadow></value></block></next>' +
        '</block></statement></block>' +
        '<block type="vela_on_sprite_click" x="40" y="240"><field name="TARGET">小鸭</field>' +
        '<statement name="DO"><block type="sc_var_change">' +
          '<field name="VAR" id="v_count">计数</field>' +
          '<value name="VALUE"><block type="math_number"><field name="NUM">1</field></block></value>' +
          '<next><block type="sc_say"><value name="TEXT"><block type="text_join">' +
            '<mutation items="2"></mutation>' +
            '<value name="ADD0"><block type="text"><field name="TEXT">点了 </field></block></value>' +
            '<value name="ADD1"><block type="variables_get"><field name="VAR" id="v_count">计数</field></block></value>' +
          '</block></value></block></next>' +
        '</block></statement></block>' +
        '</xml>'
    }]
  };

  templates.stopwatch = {
    name: '秒表',
    pages: [{
      name: 'index', title: '秒表',
      sprites: [],
      xml: '<xml xmlns="https://developers.google.com/blockly/xml">' +
        '<block type="vela_onready" x="40" y="40"><statement name="DO">' +
          '<block type="sc_timer_reset"><next><block type="controls_forever">' +
            '<statement name="DO"><block type="sc_say"><value name="TEXT">' +
              '<block type="text_join"><mutation items="2"></mutation>' +
                '<value name="ADD0"><block type="text"><field name="TEXT">已走 </field></block></value>' +
                '<value name="ADD1"><block type="sc_timer"></block></value>' +
              '</block></value></block></statement></block></next></block>' +
        '</block></statement></block>' +
        '</xml>'
    }]
  };

  templates.guess = {
    name: '打招呼',
    pages: [{
      name: 'index', title: '打招呼',
      sprites: [{ name: '小鸭', costumes: ['/common/logo.png'], costume: 0,
                 x: 0, y: 10, w: 90, h: 90, layer: 0, visible: true }],
      xml: '<xml xmlns="https://developers.google.com/blockly/xml">' +
        '<block type="vela_onready" x="40" y="40"><statement name="DO">' +
          '<block type="sc_say"><value name="TEXT"><shadow type="text">' +
            '<field name="TEXT">你好，我是 Duck Box！</field></shadow></value></block>' +
        '</block></statement></block>' +
        '<block type="vela_on_sprite_click" x="40" y="200"><field name="TARGET">小鸭</field>' +
        '<statement name="DO"><block type="sc_say_secs">' +
          '<value name="TEXT"><shadow type="text"><field name="TEXT">你好呀！</field></shadow></value>' +
          '<value name="SECS"><shadow type="math_number"><field name="NUM">2</field></shadow></value>' +
        '</block></statement></block>' +
        '</xml>'
    }]
  };

  // 积木搜索索引：来自工具箱里的静态分类，拼上定义里的 message0 / tooltip
  function buildSearchIndex() {
    var defs = {};
    (blocks || []).forEach(function (d) {
      if (d && d.type) defs[d.type] = d;
    });
    var out = [];
    var seen = {};
    (toolbox.contents || []).forEach(function (cat) {
      if (!cat || cat.kind !== 'category' || !Array.isArray(cat.contents)) return;
      cat.contents.forEach(function (it) {
        if (!it || it.kind !== 'block') return;
        if (seen[it.type]) return;
        seen[it.type] = true;
        var d = defs[it.type] || {};
        var msg = String(d.message0 || BLOCK_LABELS[it.type] || it.type)
          .replace(/%\d+\s*/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        out.push({
          type: it.type,
          cat: cat.name,
          colour: cat.colour || '#5b6b8c',
          text: msg || it.type,
          tip: String(d.tooltip || '')
        });
      });
    });
    return out;
  }

  return {
    toolbox: toolbox,
    blocks: blocks,
    defineBlocks: defineBlocks,
    buildTheme: buildTheme,
    installToolbox: installToolbox,
    safeVarName: safeVarName,
    generateProject: generateProject,
    deviceScreen: deviceScreen,
    setPages: setPages,
    setImages: setImages,
    setSprites: setSprites,
    setBackdrops: setBackdrops,
    updateOptions: updateOptions,
    restoreDynamicFields: restoreDynamicFields,
    searchIndex: buildSearchIndex(),
    templates: templates,
    getLayout: getLayout,
    setLayout: setLayout
  };
})();