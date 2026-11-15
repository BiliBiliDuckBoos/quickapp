export default function(global, globalThis, window, $app_exports$, $app_evaluate$) {
    var org_app_require = $app_require$;
    (function(global, globalThis, window, $app_exports$, $app_evaluate$) {
        var setTimeout = global.setTimeout;
        var setInterval = global.setInterval;
        var clearTimeout = global.clearTimeout;
        var clearInterval = global.clearInterval;
        var $app_require$1 = global.$app_require$ || org_app_require;
        var createPageHandler = function() {
            return (()=>{
                var __webpack_modules__ = {};
                var __webpack_module_cache__ = {};
                function __webpack_require__(moduleId) {
                    var cachedModule = __webpack_module_cache__[moduleId];
                    if (void 0 !== cachedModule) return cachedModule.exports;
                    var module = __webpack_module_cache__[moduleId] = {
                        exports: {}
                    };
                    __webpack_modules__[moduleId](module, module.exports, __webpack_require__);
                    return module.exports;
                }
                (()=>{
                    __webpack_require__.rv = ()=>"1.7.12";
                })();
                (()=>{
                    __webpack_require__.ruid = "bundler=rspack@1.7.12";
                })();
                var $app_style$ = [
                    [
                        [
                            [
                                0,
                                "page"
                            ]
                        ],
                        {
                            flexDirection: "column",
                            width: "100%",
                            height: "100%",
                            alignItems: "center",
                            justifyContent: "center"
                        }
                    ]
                ];
                var $app_script$ = function __scriptModule__(module, exports, $app_require$1) {
                    "use strict";
                    Object.defineProperty(exports, "__esModule", {
                        value: true
                    });
                    exports.default = void 0;
                    var _system = _interopRequireDefault($app_require$1("@app-module/system.app"));
                    function _interopRequireDefault(e) {
                        return e && e.__esModule ? e : {
                            default: e
                        };
                    }
                    var _default = exports.default = {
                        private: {
                            v1: [],
                            测试t_x: 0,
                            测试t_y: 0,
                            测试t_rot: 0,
                            测试t_show: true,
                            dbx_touch_down: 'false',
                            dbx_touch_x: 0,
                            dbx_touch_y: 0,
                            _loop2_on: false,
                            测试t_src: '',
                            测试t_ci: 0,
                            测试t_text: "测试text",
                            角色1_x: 0,
                            角色1_y: 0,
                            角色1_rot: 0,
                            角色1_show: true,
                            角色1_src: "/assets/costume-1794585837537.png",
                            角色1_ci: 0
                        },
                        dbx_on_touchstart (e) {
                            var t = e && e.touches && e.touches[0] ? e.touches[0] : null;
                            this.dbx_touch_down = "true";
                            if (t) {
                                this.dbx_touch_x = Math.round(t.clientX);
                                this.dbx_touch_y = Math.round(t.clientY);
                            }
                        },
                        dbx_on_touchmove (e) {
                            var t = e && e.touches && e.touches[0] ? e.touches[0] : null;
                            if (t) {
                                this.dbx_touch_x = Math.round(t.clientX);
                                this.dbx_touch_y = Math.round(t.clientY);
                            }
                        },
                        dbx_on_touchend (e) {
                            this.dbx_touch_down = "false";
                        },
                        onShow () {
                            var _l1 = (this.v1 || []).slice();
                            _l1.splice(Math.max(0, (Number(1) || 1) - 1), 0, 1);
                            this.v1 = _l1;
                            if (!this._loop2_on) {
                                this._loop2_on = true;
                                var _ft2 = this;
                                (function _loop2() {
                                    if ((Number(_ft2.dbx_touch_x) || 0) - 106 >= 6 + (Number(_ft2.测试t_x) || 0) - 91 && (Number(_ft2.dbx_touch_x) || 0) - 106 <= 6 + (Number(_ft2.测试t_x) || 0) - 91 + 182 && (Number(_ft2.dbx_touch_y) || 0) - 260 >= 67 + (Number(_ft2.测试t_y) || 0) - 36.5 && (Number(_ft2.dbx_touch_y) || 0) - 260 <= 67 + (Number(_ft2.测试t_y) || 0) - 36.5 + 73) _ft2.v1 = (_ft2.v1 || []).concat([
                                        (_ft2.v1 || [])[Math.max(0, (Number(1) || 1) - 1)] + 1
                                    ]);
                                    if ((_ft2.v1 || []).indexOf(3) >= 0) _system.default.terminate();
                                    setTimeout(_loop2, 32);
                                })();
                            }
                        },
                        onBackPress () {
                            _system.default.terminate();
                            return true;
                        }
                    };
                    const moduleOwn = exports.default || module.exports;
                    const accessors = [
                        'public',
                        'protected',
                        'private'
                    ];
                    if (moduleOwn.data && accessors.some(function(acc) {
                        return moduleOwn[acc];
                    })) throw new Error('页面VM对象中的属性data不可与"' + accessors.join(',') + '"同时存在，请使用private替换data名称');
                    if (!moduleOwn.data) {
                        moduleOwn.data = {};
                        moduleOwn._descriptor = {};
                        accessors.forEach(function(acc) {
                            const accType = typeof moduleOwn[acc];
                            if ('object' === accType) {
                                moduleOwn.data = Object.assign(moduleOwn.data, moduleOwn[acc]);
                                for(const name in moduleOwn[acc])moduleOwn._descriptor[name] = {
                                    access: acc
                                };
                            } else if ('function' === accType) console.warn('页面VM对象中的属性' + acc + '的值不能是函数，请使用对象');
                        });
                    }
                };
                var $app_template$ = function(vm) {
                    const _vm_ = vm || this;
                    return aiot.__ce__("div", {
                        __vm__: _vm_,
                        __opts__: {
                            classList: [
                                "page"
                            ],
                            style: {
                                position: "relative"
                            },
                            events: {
                                touchstart: function(evt) {
                                    return _vm_.dbx_on_touchstart(evt);
                                },
                                touchmove: function(evt) {
                                    return _vm_.dbx_on_touchmove(evt);
                                },
                                touchend: function(evt) {
                                    return _vm_.dbx_on_touchend(evt);
                                }
                            }
                        }
                    }, [
                        aiot.__ce__("text", {
                            __vm__: _vm_,
                            __opts__: {
                                classList: [
                                    "dbxsprite",
                                    "dbxc-%E6%B5%8B%E8%AF%95t"
                                ],
                                style: {
                                    position: "absolute",
                                    left: "21px",
                                    top: "290px",
                                    width: "182px",
                                    height: "73px",
                                    zIndex: 2,
                                    fontSize: "40px",
                                    color: "#333333",
                                    textAlign: "center",
                                    whiteSpace: "pre-wrap",
                                    lineHeight: 1.2
                                },
                                show: function() {
                                    return _vm_.测试t_show;
                                },
                                value: function() {
                                    return _vm_.测试t_text;
                                }
                            }
                        }, []),
                        aiot.__ce__("image", {
                            __vm__: _vm_,
                            __opts__: {
                                classList: [
                                    "dbxsprite",
                                    "dbxc-%E8%A7%92%E8%89%B21"
                                ],
                                src: function() {
                                    return _vm_.角色1_src;
                                },
                                style: {
                                    position: "absolute",
                                    left: "6px",
                                    top: "44px",
                                    width: "191px",
                                    height: "204px",
                                    zIndex: 1
                                },
                                show: function() {
                                    return _vm_.角色1_show;
                                }
                            }
                        }, [])
                    ]);
                };
                $app_exports$['entry'] = function($app_exports$) {
                    $app_script$({}, $app_exports$, $app_require$1);
                    $app_exports$.default.template = $app_template$;
                    $app_exports$.default.style = $app_style$;
                };
            })();
        };
        return createPageHandler();
    })(global, globalThis, window, $app_exports$, $app_evaluate$);
}
