# -*- coding: utf-8 -*-
"""
Duck Box —— 小米手环快应用积木编程器（启动入口）

双击或运行本文件即可启动：
1. 自动检测并安装所需 Python 依赖（使用中国大陆可访问的镜像源）。
2. 自动下载 Blockly 积木引擎到本地（离线可用，国内镜像回退）。
3. 启动本地服务并自动打开浏览器进入主菜单。
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

VENDOR_DIR = os.path.join(BASE_DIR, "static", "vendor", "blockly")

# 中国大陆可访问的 pip 镜像源（按优先级排列）
PIP_MIRRORS = [
    "https://pypi.tuna.tsinghua.edu.cn/simple",
    "https://mirrors.aliyun.com/pypi/simple/",
    "https://pypi.mirrors.ustc.edu.cn/simple",
    "https://mirrors.cloud.tencent.com/pypi/simple",
]

REQUIREMENTS = ["flask"]

# Blockly 前端引擎：本地缓存所需文件
BLOCKLY_VERSION = "9.3.3"
BLOCKLY_FILES = [
    "/blockly_compressed.js",
    "/blocks_compressed.js",
    "/javascript_compressed.js",
    "/msg/zh-hans.js",
    "/media/handclosed.cur",
    "/media/handopen.cur",
    "/media/sprites.png",
    "/media/sprites.svg",
]

CDN_MIRRORS = [
    "https://registry.npmmirror.com/blockly/%s/files" % BLOCKLY_VERSION,
    "https://cdn.jsdelivr.net/npm/blockly@%s" % BLOCKLY_VERSION,
    "https://unpkg.com/blockly@%s" % BLOCKLY_VERSION,
]


def log(msg):
    print("[Duck Box] %s" % msg)


# --------------------------------------------------------------------------- #
# 第 1 步：Python 依赖
# --------------------------------------------------------------------------- #
def ensure_pip_dependencies():
    import importlib.util

    missing = [name for name in REQUIREMENTS if importlib.util.find_spec(name) is None]

    if not missing:
        log("Python 依赖已就绪。")
        return True

    log("检测到缺少依赖：%s，正在自动安装（国内镜像）..." % ", ".join(missing))
    for mirror in PIP_MIRRORS:
        try:
            log("尝试镜像：%s" % mirror)
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "-i", mirror,
                 "--trusted-host", mirror.split("/")[2],
                 *missing],
            )
            log("安装完成。")
            return True
        except subprocess.CalledProcessError:
            log("该镜像安装失败，换一个试试...")
    # 所有镜像都失败，尝试默认源
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", *missing])
        return True
    except subprocess.CalledProcessError:
        log("自动安装依赖失败！请手动执行：pip install flask")
        return False


# --------------------------------------------------------------------------- #
# 第 2 步：Blockly 本地离线资源
# --------------------------------------------------------------------------- #
def _marker_file():
    return os.path.join(VENDOR_DIR, ".version")


def vendor_ready():
    marker = _marker_file()
    if not os.path.exists(marker):
        return False
    try:
        with open(marker, "r", encoding="utf-8") as f:
            return f.read().strip() == BLOCKLY_VERSION
    except OSError:
        return False


def _download(url, dest, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "DuckBox/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as f:
        shutil.copyfileobj(resp, f)


def ensure_blockly_vendor():
    """下载 Blockly 到 static/vendor，之后即可完全离线使用。"""
    if vendor_ready():
        log("积木引擎离线资源已就绪（%s）。" % BLOCKLY_VERSION)
        return True

    log("正在下载积木引擎 v%s（首次运行需要，之后完全离线）..." % BLOCKLY_VERSION)
    os.makedirs(VENDOR_DIR, exist_ok=True)

    for cdn in CDN_MIRRORS:
        ok = True
        try:
            log("尝试源：%s" % cdn)
            for rel in BLOCKLY_FILES:
                dest = os.path.join(VENDOR_DIR, *rel.strip("/").split("/"))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                _download(cdn + rel, dest)
        except Exception as e:  # noqa: BLE001 换源重试
            log("该源失败（%s），换一个试试..." % e)
            _cleanup_vendor()
            ok = False
        if ok and all(
            os.path.exists(os.path.join(VENDOR_DIR, *rel.strip("/").split("/")))
            for rel in BLOCKLY_FILES[:4]
        ):
            with open(_marker_file(), "w", encoding="utf-8") as f:
                f.write(BLOCKLY_VERSION)
            log("积木引擎已缓存到本地，下次启动秒开、无需联网。")
            return True
    log("在线资源全部不可用，将尝试浏览器端在线加载（需要网络）。")
    return True


def _cleanup_vendor():
    if os.path.exists(VENDOR_DIR):
        shutil.rmtree(VENDOR_DIR, ignore_errors=True)


# --------------------------------------------------------------------------- #
# 启动服务
# --------------------------------------------------------------------------- #
def find_free_port(start=8520, tries=50):
    for port in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("", port))  # 与服务端 0.0.0.0 绑定保持一致
                return port
            except OSError:
                continue
    return start


def lan_ip():
    """取本机局域网 IP（不会真正发包，仅用于选路由；失败回环）。"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def is_termux():
    """判断是否运行在 Android Termux（LS终端/其他 Linux 终端）。"""
    try:
        prefix = os.environ.get("PREFIX", "").lower()
        return "termux" in prefix or "com.termux" in prefix
    except Exception:  # noqa: BLE001
        return False


def open_browser(url):
    """打开浏览器：Termux 用 termux-open-url，其余平台用 webbrowser。"""
    if is_termux():
        try:
            subprocess.Popen(["termux-open-url", url])
            return
        except OSError:
            pass
    webbrowser.open(url, new=2)


def main():
    print("=" * 56)
    print("   Duck Box · 小米手环快应用积木编程器")
    print("   像搭积木一样，为小米手环制作快应用")
    print("=" * 56)

    if not ensure_pip_dependencies():
        input("按回车键退出...")
        sys.exit(1)

    try:
        ensure_blockly_vendor()
    except Exception as e:  # noqa: BLE001 资源下载失败不阻塞启动
        log("离线资源下载出错（不影响使用）：%s" % e)

    import server

    port = find_free_port()
    url = "http://127.0.0.1:%d/?_t=%d" % (port, int(time.time() * 1000))
    print("-" * 56)
    log("本机访问：%s" % url)
    ip = lan_ip()
    if ip != "127.0.0.1":
        log("局域网访问（手机/其他设备用浏览器打开）：%s:%d" % (ip, port))
        if sys.platform.startswith("win"):
            log("若其他设备打不开：请在 Windows 防火墙「专用网络」中允许 Python 接受传入连接。")
        elif sys.platform == "darwin":
            log("若其他设备打不开：请在系统设置 → 网络 → 防火墙中允许本程序接受传入连接。")
        else:
            log("若其他设备打不开：请放行 %d 端口（如需，开放系统防火墙入站规则）。" % port)
    log("正在打开浏览器，请勿关闭本窗口（关闭即退出 Duck Box）...")
    open_browser(url)
    server.run(port=port)


if __name__ == "__main__":
    main()
