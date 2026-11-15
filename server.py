# -*- coding: utf-8 -*-
"""
Duck Box —— 小米手环快应用积木编程器（后端服务）

职责：
1. 提供页面（主菜单 / 编辑器）与静态资源。
2. 项目的新建、保存、读取、删除与“最近项目”列表。
3. 将前端生成的 Vela 源码导出为 src 文件夹，并打包为 zip 供下载。

代码生成全部在前端（Blockly + Duck Box 自定义积木）完成，
后端只负责持久化与文件落盘，保持逻辑单一、不重复实现。
"""
import base64
import hashlib
import io
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import zipfile

from flask import Flask, jsonify, request, send_file

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")
STORAGE_DIR = os.path.join(BASE_DIR, "storage")
PROJECTS_DIR = os.path.join(STORAGE_DIR, "projects")
INDEX_FILE = os.path.join(STORAGE_DIR, "index.json")
TOOLS_DIR = os.path.join(BASE_DIR, "tools")
BUILD_SCRIPT = os.path.join(TOOLS_DIR, "mobile-build.js")
BUILD_TIMEOUT = 300  # 秒（首次构建要装工具链，比手机端宽松一点）

# 项目自定义快应用图标：存于 <项目目录>/icon.png，构建/导出时覆盖 src/common/logo.png。
# 官方文档里 manifest.icon 固定指向 /common/logo.png，且桌面图标为 128*128。
ICON_FILE = "icon.png"
ICON_MAX_PX = 128
ICON_MAX_BYTES = 512 * 1024

app = Flask(__name__, template_folder=TEMPLATE_DIR, static_folder=STATIC_DIR)


# --------------------------------------------------------------------------- #
# 存储工具
# --------------------------------------------------------------------------- #
def _ensure_dirs():
    os.makedirs(PROJECTS_DIR, exist_ok=True)


def _read_index():
    _ensure_dirs()
    if not os.path.exists(INDEX_FILE):
        return {"projects": []}
    try:
        with open(INDEX_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"projects": []}


def _write_index(index):
    _ensure_dirs()
    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)


def _slug(value):
    """把项目名转为安全的目录名。"""
    value = re.sub(r"[\\/:*?\"<>|.]", "", (value or "").strip())
    value = re.sub(r"\s+", "_", value)
    return value or "project"


def _project_path(pid):
    return os.path.join(PROJECTS_DIR, pid)


def _icon_path(pid):
    return os.path.join(_project_path(pid), ICON_FILE)


def _png_dimensions(blob):
    """校验 PNG 头并返回 (宽, 高)；超过 128*128 或不是 PNG 时抛 ValueError。"""
    if len(blob) < 33 or blob[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("图标必须是 PNG 图片")
    if blob[12:16] != b"IHDR":
        raise ValueError("PNG 数据不完整")
    w, h = struct.unpack(">II", blob[16:24])
    if not (0 < w <= ICON_MAX_PX and 0 < h <= ICON_MAX_PX):
        raise ValueError("图标尺寸需在 %d*%d 及以内（当前 %d*%d）" %
                         (ICON_MAX_PX, ICON_MAX_PX, w, h))
    return w, h


def _ensure_icon(src_dir, pid=None):
    """把项目自定义图标（或默认小鸭 logo）写成 src/common/logo.png。

    manifest.icon 固定指向 /common/logo.png，所以换图标就是换这个文件。
    每次都覆盖写入，避免上一轮构建的旧图标残留。
    """
    icon = os.path.join(src_dir, "common", "logo.png")
    custom = _icon_path(pid) if pid else None
    source = custom if (custom and os.path.isfile(custom)) else os.path.join(STATIC_DIR, "img", "logo.png")
    if os.path.isfile(source):
        os.makedirs(os.path.dirname(icon), exist_ok=True)
        shutil.copyfile(source, icon)


_toolchain_ready = False
_toolchain_lock = threading.Lock()
_jsc_ready = False
_jsc_lock = threading.Lock()


def _ensure_toolchain():
    """确保 tools/ 下可用 aiot-toolkit（首次构建时自动 npm install）。"""
    global _toolchain_ready
    if _toolchain_ready:
        return
    with _toolchain_lock:
        if _toolchain_ready:
            return
        os.makedirs(TOOLS_DIR, exist_ok=True)
        pkg_file = os.path.join(TOOLS_DIR, "package.json")
        if not os.path.exists(pkg_file):
            with open(pkg_file, "w", encoding="utf-8") as f:
                json.dump({
                    "name": "duckbox-tools",
                    "private": True,
                    "version": "1.0.0",
                    "dependencies": {"aiot-toolkit": "^2.0.5"},
                }, f, ensure_ascii=False, indent=2)
        toolkit = os.path.join(TOOLS_DIR, "node_modules", "aiot-toolkit")
        if not os.path.isdir(toolkit):
            npm = shutil.which("npm") or "npm"
            proc = subprocess.run(
                "%s install --no-audit --no-fund" % npm if os.name == "nt"
                else [npm, "install", "--no-audit", "--no-fund"],
                cwd=TOOLS_DIR, shell=(os.name == "nt"),
                capture_output=True, text=True, timeout=900,
            )
            if proc.returncode != 0 or not os.path.isdir(toolkit):
                detail = ((proc.stderr or "") + "\n" + (proc.stdout or "")).strip()
                raise RuntimeError("安装 aiot-toolkit 失败" + (("：" + detail[-500:]) if detail else ""))
        if not os.path.exists(BUILD_SCRIPT):
            raise RuntimeError("缺少构建脚本 tools/mobile-build.js")
        _toolchain_ready = True


def _ensure_jsc_tool():
    """加密构建需要官方 @aiot-toolkit/jsc（把 js 转成 jsc 字节码）。
    首次开启时按需装到 tools/node_modules 并缓存，普通构建完全不受影响。"""
    global _jsc_ready
    jsc_dir = os.path.join(TOOLS_DIR, "node_modules", "@aiot-toolkit", "jsc")
    with _jsc_lock:
        # 也检查目录：万一被 npm install 重建依赖树时清掉，能自动补装
        if _jsc_ready and os.path.isdir(jsc_dir):
            return
        if not os.path.isdir(jsc_dir):
            npm = shutil.which("npm") or "npm"
            last = ""
            # 国内镜像优先，失败再回退官方源
            for registry in ("https://registry.npmmirror.com", "https://registry.npmjs.org"):
                args = [npm, "install", "@aiot-toolkit/jsc", "--no-save",
                        "--no-package-lock", "--no-audit", "--no-fund",
                        "--registry=" + registry]
                try:
                    proc = subprocess.run(
                        " ".join(args) if os.name == "nt" else args,
                        cwd=TOOLS_DIR, shell=(os.name == "nt"),
                        capture_output=True, text=True, timeout=600,
                    )
                except subprocess.TimeoutExpired:
                    last = "npm install 超时（600 秒）"
                    continue
                if proc.returncode == 0 and os.path.isdir(jsc_dir):
                    break
                last = ((proc.stderr or "") + "\n" + (proc.stdout or "")).strip()[-500:]
            else:
                raise RuntimeError(
                    "安装官方 @aiot-toolkit/jsc 失败（加密构建必需，请检查网络）：%s"
                    % (last or "npm 无输出"))
        _jsc_ready = True


def _ascii_stage_root():
    """挑一个纯 ASCII、可写的临时根目录。

    官方 jsc 可执行程序（win32_aiotjsc.exe）处理不了路径里的非 ASCII 字符，
    中文项目名会让它在「Generate jsc bytecode」阶段直接返回 1。加密构建因此
    不放在 <项目目录>/build-src 编译，而是先落到 ASCII 暂存目录。"""
    candidates = [
        os.environ.get("TMP", ""),
        os.environ.get("TEMP", ""),
        tempfile.gettempdir(),
    ]
    if os.name == "nt":
        root = os.environ.get("SystemRoot", r"C:\Windows")
        candidates += [os.path.join(root, "Temp"), r"C:\Windows\Temp",
                       os.path.splitdrive(os.path.abspath(BASE_DIR))[0] + os.sep]
    for item in candidates:
        if item and item.isascii() and os.path.isdir(item):
            try:
                probe = os.path.join(item, ".dbx-write-test")
                with open(probe, "w", encoding="utf-8") as f:
                    f.write("ok")
                os.remove(probe)
                return item
            except OSError:
                continue
    return tempfile.gettempdir()


def _jsc_stage_dir(pid):
    """加密构建的纯 ASCII 工程目录（pid 里可能带中文项目名，不能直接用）。"""
    digest = hashlib.md5(pid.encode("utf-8")).hexdigest()[:12]
    return os.path.join(_ascii_stage_root(), "duckbox-jsc-" + digest)


def _get_project_record(pid):
    index = _read_index()
    for p in index["projects"]:
        if p["id"] == pid:
            return p
    return None


def _valid_device_type(value):
    """设备型号白名单（band9 / band9pro / band10 / band10pro / watch）。"""
    ok = ("band", "watch", "band9", "band9pro", "band10", "band10pro")
    return value if value in ok else "band"


# --------------------------------------------------------------------------- #
# 页面路由
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/editor")
def editor():
    return app.send_static_file("editor.html")


# --------------------------------------------------------------------------- #
# 项目 API
# --------------------------------------------------------------------------- #
@app.route("/api/projects", methods=["GET"])
def list_projects():
    index = _read_index()
    projects = index.get("projects", [])
    projects.sort(key=lambda p: p.get("updatedAt", 0), reverse=True)
    return jsonify({"projects": projects})


@app.route("/api/projects", methods=["POST"])
def create_project():
    data = request.get_json(silent=True) or {}
    pid = str(int(time.time() * 1000)) + "_" + _slug(data.get("name", "project"))
    now = int(time.time() * 1000)

    device_type = _valid_device_type(data.get("deviceType"))
    try:
        design_width = int(data.get("designWidth") or 480)
    except (TypeError, ValueError):
        design_width = 480
    design_width = max(120, min(720, design_width))

    project = {
        "id": pid,
        "name": (data.get("name") or "未命名项目").strip(),
        "package": (data.get("package") or "com.duckbox.demo").strip(),
        "appName": (data.get("appName") or "DuckBox").strip()[:20],
        "deviceType": device_type,
        "designWidth": design_width,
        "createdAt": now,
        "updatedAt": now,
        "preview": "新项目",
    }
    index = _read_index()
    index.setdefault("projects", []).append(project)
    _write_index(index)

    # 初始化保存目录与空的积木 XML
    _ensure_dirs()
    path = _project_path(pid)
    os.makedirs(path, exist_ok=True)
    with open(os.path.join(path, "project.json"), "w", encoding="utf-8") as f:
        json.dump({"xml": "", "files": {}, "meta": project}, f, ensure_ascii=False, indent=2)

    return jsonify({"project": project})


@app.route("/api/projects/<pid>", methods=["GET"])
def get_project(pid):
    record = _get_project_record(pid)
    if not record:
        return jsonify({"error": "项目不存在"}), 404
    path = os.path.join(_project_path(pid), "project.json")
    data = {"xml": "", "files": {}, "meta": record, "pages": [], "globalVars": []}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                saved = json.load(f)
                data["xml"] = saved.get("xml", "")
                data["files"] = saved.get("files", {})
                data["meta"] = saved.get("meta", record)
                data["pages"] = saved.get("pages", [])
                data["globalVars"] = saved.get("globalVars", [])
        except (OSError, ValueError):
            pass
    return jsonify(data)


@app.route("/api/projects/<pid>", methods=["POST"])
def save_project(pid):
    record = _get_project_record(pid)
    if not record:
        return jsonify({"error": "项目不存在"}), 404
    data = request.get_json(silent=True) or {}
    path = _project_path(pid)
    os.makedirs(path, exist_ok=True)

    meta = dict(record)
    meta["updatedAt"] = int(time.time() * 1000)
    if data.get("name"):
        meta["name"] = str(data["name"]).strip()
    if data.get("package"):
        meta["package"] = str(data["package"]).strip()
    if data.get("appName"):
        meta["appName"] = str(data["appName"]).strip()[:20]
    if data.get("preview"):
        meta["preview"] = str(data["preview"])[:120]
    if data.get("deviceType"):
        meta["deviceType"] = _valid_device_type(data.get("deviceType"))
    if data.get("designWidth"):
        try:
            meta["designWidth"] = max(120, min(720, int(data["designWidth"])))
        except (TypeError, ValueError):
            pass

    payload = {
        "xml": data.get("xml", ""),
        "files": data.get("files", {}),
        "meta": meta,
        "pages": data.get("pages", []),
        "globalVars": data.get("globalVars", []),
    }
    with open(os.path.join(path, "project.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    # 更新索引
    index = _read_index()
    for p in index["projects"]:
        if p["id"] == pid:
            p.update(meta)
            break
    _write_index(index)

    return jsonify({"ok": True, "meta": meta})


@app.route("/api/projects/<pid>", methods=["DELETE"])
def delete_project(pid):
    record = _get_project_record(pid)
    if not record:
        return jsonify({"error": "项目不存在"}), 404
    index = _read_index()
    index["projects"] = [p for p in index["projects"] if p["id"] != pid]
    _write_index(index)

    path = _project_path(pid)
    if os.path.exists(path):
        for root, dirs, files in os.walk(path, topdown=False):
            for name in files:
                os.remove(os.path.join(root, name))
            for name in dirs:
                os.rmdir(os.path.join(root, name))
        os.rmdir(path)
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- #
# 图片资产：上传 / 列表 / 访问 / 删除（存于项目目录 assets/，导出时进 src/assets/）
# --------------------------------------------------------------------------- #
ALLOWED_IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}


def _assets_dir(pid):
    return os.path.join(_project_path(pid), "assets")


def _safe_asset_name(name):
    """清洗上传文件名：保留中文/字母/数字，替换危险字符。"""
    name = os.path.basename(name or "")
    root, ext = os.path.splitext(name)
    ext = ext.lower()
    if ext not in ALLOWED_IMG_EXT:
        return None
    root = re.sub(r"[\\/:*?\"<>|\s]+", "_", root).strip("._") or "image"
    return root + ext


def _unique_asset_path(directory, filename):
    root, ext = os.path.splitext(filename)
    candidate = os.path.join(directory, filename)
    i = 1
    while os.path.exists(candidate):
        candidate = os.path.join(directory, "%s-%d%s" % (root, i, ext))
        i += 1
    return candidate


@app.route("/api/projects/<pid>/assets", methods=["GET"])
def list_assets(pid):
    if not _get_project_record(pid):
        return jsonify({"error": "项目不存在"}), 404
    d = _assets_dir(pid)
    items = []
    if os.path.isdir(d):
        for name in sorted(os.listdir(d)):
            full = os.path.join(d, name)
            if os.path.isfile(full):
                items.append({
                    "name": name,
                    "url": "/api/projects/%s/assets/%s" % (pid, name),
                    "path": "/assets/" + name,
                    "size": os.path.getsize(full),
                })
    return jsonify({"assets": items})


@app.route("/api/projects/<pid>/assets", methods=["POST"])
def upload_assets(pid):
    if not _get_project_record(pid):
        return jsonify({"error": "项目不存在"}), 404
    files = request.files.getlist("file")
    if not files:
        return jsonify({"error": "没有收到文件"}), 400
    d = _assets_dir(pid)
    os.makedirs(d, exist_ok=True)
    saved = []
    for f in files:
        name = _safe_asset_name(f.filename)
        if not name:
            continue
        target = _unique_asset_path(d, name)
        f.save(target)
        saved.append({
            "name": os.path.basename(target),
            "url": "/api/projects/%s/assets/%s" % (pid, os.path.basename(target)),
            "path": "/assets/" + os.path.basename(target),
            "size": os.path.getsize(target),
        })
    if not saved:
        return jsonify({"error": "不支持的图片格式（仅 png/jpg/gif/webp/bmp）"}), 400
    return jsonify({"ok": True, "assets": saved})


@app.route("/api/projects/<pid>/assets/<path:name>")
def get_asset(pid, name):
    full = os.path.join(_assets_dir(pid), os.path.basename(name))
    if not os.path.isfile(full):
        return jsonify({"error": "图片不存在"}), 404
    return send_file(full)


@app.route("/api/projects/<pid>/assets/<path:name>", methods=["DELETE"])
def delete_asset(pid, name):
    full = os.path.join(_assets_dir(pid), os.path.basename(name))
    if os.path.isfile(full):
        os.remove(full)
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- #
# 快应用图标：每个项目单独存一份 icon.png（128*128 及以内）
# --------------------------------------------------------------------------- #
@app.route("/api/projects/<pid>/icon")
def get_project_icon(pid):
    if not _get_project_record(pid):
        return jsonify({"error": "项目不存在"}), 404
    custom = _icon_path(pid)
    source = custom if os.path.isfile(custom) else os.path.join(STATIC_DIR, "img", "logo.png")
    resp = send_file(source, mimetype="image/png")
    # 换图标后不能让浏览器继续用旧缓存
    resp.headers["Cache-Control"] = "no-store, max-age=0"
    return resp


@app.route("/api/projects/<pid>/icon", methods=["POST"])
def set_project_icon(pid):
    if not _get_project_record(pid):
        return jsonify({"error": "项目不存在"}), 404
    data = request.get_json(silent=True) or {}
    target = _icon_path(pid)

    # 恢复默认：删掉自定义图标，读接口会自动回落到内置 logo
    if data.get("reset"):
        if os.path.isfile(target):
            os.remove(target)
        return jsonify({"ok": True, "default": True})

    image = str(data.get("image") or "")
    m = re.match(r"^data:image/png;base64,([A-Za-z0-9+/=]+)$", image)
    if not m:
        return jsonify({"error": "图标数据格式不对（应为 PNG 图片）"}), 400
    try:
        blob = base64.b64decode(m.group(1), validate=True)
    except Exception:
        return jsonify({"error": "图标数据无法解码"}), 400
    if len(blob) > ICON_MAX_BYTES:
        return jsonify({"error": "图标文件过大"}), 400
    try:
        w, h = _png_dimensions(blob)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    os.makedirs(_project_path(pid), exist_ok=True)
    with open(target, "wb") as f:
        f.write(blob)
    return jsonify({"ok": True, "width": w, "height": h, "default": False})


# --------------------------------------------------------------------------- #
# 导出：写 src 目录 + 打包 zip
# --------------------------------------------------------------------------- #
@app.route("/api/projects/<pid>/export", methods=["POST"])
def export_project(pid):
    record = _get_project_record(pid)
    if not record:
        return jsonify({"error": "项目不存在"}), 404
    data = request.get_json(silent=True) or {}
    files = data.get("files", {})
    if not files:
        return jsonify({"error": "没有可导出的代码"}), 400

    path = _project_path(pid)
    src_dir = os.path.join(path, "src")

    # 清理旧的导出目录
    if os.path.exists(src_dir):
        for root, dirs, names in os.walk(src_dir, topdown=False):
            for n in names:
                os.remove(os.path.join(root, n))
            for n in dirs:
                os.rmdir(os.path.join(root, n))

    # 写入所有源码文件（files 的 key 形如 "src/manifest.json"）
    for rel, content in files.items():
        rel = rel.replace("\\", "/")
        # 只允许写到 src 目录内，防止路径穿越
        if not rel.startswith("src/"):
            rel = "src/" + rel
        target = os.path.join(path, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(content)

    # 打包 zip
    zip_path = os.path.join(path, "src.zip")

    # 把项目图片资产复制进 src/assets（vela_image 积木引用 /assets/xxx.png）
    assets_dir = _assets_dir(pid)
    if os.path.isdir(assets_dir):
        dst = os.path.join(src_dir, "assets")
        os.makedirs(dst, exist_ok=True)
        for name in os.listdir(assets_dir):
            src_file = os.path.join(assets_dir, name)
            if os.path.isfile(src_file):
                shutil.copyfile(src_file, os.path.join(dst, name))

    # 若未提供图标，则把 Duck Box 自带 logo 放到 common 目录作为默认图标
    _ensure_icon(src_dir, pid)

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, names in os.walk(src_dir):
            for name in names:
                full = os.path.join(root, name)
                arc = os.path.relpath(full, path)
                zf.write(full, arc)

    return jsonify({"ok": True, "path": src_dir, "download": "/api/projects/%s/download" % pid})


@app.route("/api/projects/<pid>/download")
def download_project(pid):
    zip_path = os.path.join(_project_path(pid), "src.zip")
    if not os.path.exists(zip_path):
        return jsonify({"error": "请先导出"}), 404
    return send_file(zip_path, as_attachment=True, download_name="src.zip")


# --------------------------------------------------------------------------- #
# 构建 RPK：写 build-src 工程 → node tools/mobile-build.js（aiot-toolkit）
# --------------------------------------------------------------------------- #
def _copy_assets(pid, src_dir):
    assets_dir = _assets_dir(pid)
    if not os.path.isdir(assets_dir):
        return
    dst = os.path.join(src_dir, "assets")
    os.makedirs(dst, exist_ok=True)
    for name in os.listdir(assets_dir):
        src_file = os.path.join(assets_dir, name)
        if os.path.isfile(src_file):
            shutil.copyfile(src_file, os.path.join(dst, name))


@app.route("/api/projects/<pid>/build", methods=["POST"])
def build_project(pid):
    record = _get_project_record(pid)
    if not record:
        return jsonify({"ok": False, "error": "项目不存在"}), 404
    data = request.get_json(silent=True) or {}
    files = data.get("files") or {}
    if not files:
        return jsonify({"ok": False, "error": "没有可构建的代码"}), 400
    # 加密构建开关（设置弹窗）：默认关闭；开启后按官方 --enable-jsc 把 JS 编译成 jsc
    jsc_enabled = bool(data.get("jsc"))

    try:
        _ensure_toolchain()
    except Exception as e:
        return jsonify({"ok": False, "error": "构建工具链准备失败：%s" % e})

    project_dir = _project_path(pid)
    native_build_dir = os.path.join(project_dir, "build-src")
    # 清掉上一轮产物，避免下载接口拿到旧 RPK
    if os.path.exists(native_build_dir):
        shutil.rmtree(native_build_dir, ignore_errors=True)
    # 加密构建改用纯 ASCII 暂存目录（官方 jsc 程序不支持中文路径）
    build_dir = _jsc_stage_dir(pid) if jsc_enabled else native_build_dir
    if os.path.exists(build_dir):
        shutil.rmtree(build_dir, ignore_errors=True)
    src_dir = os.path.join(build_dir, "src")
    os.makedirs(src_dir, exist_ok=True)

    base_abs = os.path.abspath(build_dir)
    for rel, content in files.items():
        rel = str(rel).replace("\\", "/")
        if not rel.startswith("src/"):
            rel = "src/" + rel
        target = os.path.abspath(os.path.join(build_dir, rel))
        if not target.startswith(base_abs + os.sep):
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(str(content))

    _copy_assets(pid, src_dir)
    _ensure_icon(src_dir, pid)

    with open(os.path.join(build_dir, "package.json"), "w", encoding="utf-8") as f:
        json.dump({
            "name": record.get("name", "duckbox-app"),
            "version": "1.0.0",
            "devDependencies": {"aiot-toolkit": "^2.0.5"},
        }, f, ensure_ascii=False, indent=2)

    # 后台线程执行构建，立即返回任务 ID，前端轮询结果
    # 避免长连接在 30~60 秒构建期间被浏览器/网络层断开（原同步模式会导致“网络错误”）
    # 结果文件放独立目录（与 build_src 隔离），避免读上次构建的残留
    task_id = str(int(time.time() * 1000))
    build_out_dir = os.path.join(project_dir, "build-out")
    os.makedirs(build_out_dir, exist_ok=True)
    result_file = os.path.join(build_out_dir, "build-result.json")
    state_file = os.path.join(build_out_dir, "build-state.json")
    # 删除上次构建残留，确保本轮结果干净
    for _old in (result_file, state_file):
        try:
            if os.path.exists(_old):
                os.remove(_old)
        except OSError:
            pass
    with open(state_file, "w", encoding="utf-8") as f:
        json.dump({"task": task_id, "status": "running", "startedAt": int(time.time()),
                   "jsc": jsc_enabled}, f, ensure_ascii=False)

    def _do_build():
        node = shutil.which("node") or "node"
        result = {"ok": False, "error": "构建未执行"}
        proc = None
        try:
            if jsc_enabled:
                # 放在后台线程里做：首次开启需联网安装官方 jsc 组件，不阻塞 HTTP 响应。
                # 组件只缓存在 tools 下，构建脚本会自己解析加载，不再往工程目录注入。
                _ensure_jsc_tool()
            # 用环境变量传开关，避免 Windows 下命令行参数引号转义问题
            env = os.environ.copy()
            env["DUCKBOX_ENABLE_JSC"] = "1" if jsc_enabled else "0"
            proc = subprocess.run(
                [node, BUILD_SCRIPT, build_dir, result_file],
                cwd=TOOLS_DIR, env=env, capture_output=True, text=True,
                timeout=BUILD_TIMEOUT,
            )
            # mobile-build.js 写出结果文件才读；否则用 node 的 stderr/stdout 兜底
            if os.path.exists(result_file):
                try:
                    with open(result_file, "r", encoding="utf-8") as f:
                        loaded = json.load(f)
                    if isinstance(loaded, dict):
                        result = loaded
                except (OSError, ValueError):
                    pass
            if not result.get("ok"):
                detail = ((proc.stderr or "") + "\n" + (proc.stdout or "")).strip()
                fallback = "构建脚本未返回结果" + (("\n" + detail[-800:]) if detail else "（node 无输出）")
                if not result.get("error") or result.get("error") == "构建未执行":
                    result = {"ok": False, "error": fallback}
            if result.get("ok") and result.get("rpkPath"):
                # 加密构建在 ASCII 暂存目录编译，把 RPK 放回项目目录，
                # 让原有的 /rpk 下载接口不需要改动就能取到最新产物。
                if jsc_enabled and os.path.abspath(build_dir) != os.path.abspath(native_build_dir):
                    dst_dir = os.path.join(native_build_dir, "dist")
                    os.makedirs(dst_dir, exist_ok=True)
                    dst = os.path.join(dst_dir, os.path.basename(result["rpkPath"]))
                    shutil.copyfile(result["rpkPath"], dst)
                    result["rpkPath"] = dst
                result["download"] = "/api/projects/%s/rpk" % pid
                result["jsc"] = bool(result.get("jsc", jsc_enabled))
                logs = result.get("logs") or []
                if isinstance(logs, list):
                    result["logs"] = logs[-6:]
            if not result.get("ok") and proc is not None and proc.returncode != 0:
                detail = ((proc.stderr or "") + "\n" + (proc.stdout or "")).strip()
                if detail and detail[:60] not in str(result.get("error", "")):
                    result["error"] = (str(result.get("error")) +
                                       ("\n" if result.get("error") else "") +
                                       detail[-500:])
        except subprocess.TimeoutExpired:
            result = {"ok": False, "error": "构建超时（超过 %d 秒）" % BUILD_TIMEOUT}
        except FileNotFoundError:
            result = {"ok": False, "error": "未找到 node，请先安装 Node.js 并加入 PATH"}
        except Exception:
            exc_info = sys.exc_info()
            exc = exc_info[1]
            tb_lines = traceback.format_exception(*exc_info)
            detail = "构建异常：%s" % (exc or "未知异常")
            if tb_lines:
                detail += "\n" + "".join(tb_lines).strip()
            result = {"ok": False, "error": detail}
        finally:
            # 暂存目录只是编译现场，RPK 已经复制回项目目录，用完即清
            if jsc_enabled and os.path.abspath(build_dir) != os.path.abspath(native_build_dir):
                shutil.rmtree(build_dir, ignore_errors=True)
        try:
            with open(result_file, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            with open(state_file, "w", encoding="utf-8") as f:
                json.dump({"task": task_id, "status": "done",
                           "finishedAt": int(time.time())}, f, ensure_ascii=False)
        except OSError:
            pass

    threading.Thread(target=_do_build, daemon=True).start()
    return jsonify({"ok": True, "task": task_id, "status": "running"})


@app.route("/api/projects/<pid>/build-status")
def build_status(pid):
    record = _get_project_record(pid)
    if not record:
        return jsonify({"ok": False, "error": "项目不存在"}), 404
    project_dir = _project_path(pid)
    build_out_dir = os.path.join(project_dir, "build-out")
    state_file = os.path.join(build_out_dir, "build-state.json")
    result_file = os.path.join(build_out_dir, "build-result.json")
    state = {"task": None, "status": "idle"}
    if os.path.exists(state_file):
        try:
            with open(state_file, "r", encoding="utf-8") as f:
                state = json.load(f)
        except (OSError, ValueError):
            pass
    if state.get("status") == "done" and os.path.exists(result_file):
        try:
            with open(result_file, "r", encoding="utf-8") as f:
                result = json.load(f)
        except (OSError, ValueError) as e:
            return jsonify({"ok": False, "task": state.get("task"),
                           "status": "done", "error": "读取构建结果失败：%s" % e})
        # 确保返回的 JSON 包含 status 字段，避免前端将无 status 的成功结果误判为"未找到任务"
        if isinstance(result, dict):
            result.setdefault("status", "done")
        return jsonify(result)
    return jsonify({"ok": False, "task": state.get("task"),
                   "status": state.get("status", "idle"), "pending": True})


@app.route("/api/projects/<pid>/rpk")
def download_rpk(pid):
    build_dir = os.path.join(_project_path(pid), "build-src")
    newest = None
    for root, _dirs, names in os.walk(build_dir):
        for name in names:
            if name.lower().endswith(".rpk"):
                full = os.path.join(root, name)
                if newest is None or os.path.getmtime(full) > os.path.getmtime(newest):
                    newest = full
    if not newest:
        return jsonify({"error": "请先构建"}), 404
    return send_file(newest, as_attachment=True, download_name=os.path.basename(newest))


# --------------------------------------------------------------------------- #
# 项目数据导出 / 导入（备份与迁移：积木、位置、代码、图片全部打包）
# --------------------------------------------------------------------------- #
@app.route("/api/projects/<pid>/export-data")
def export_project_data(pid):
    record = _get_project_record(pid)
    if not record:
        return jsonify({"error": "项目不存在"}), 404
    path = _project_path(pid)
    pages = []
    pj = os.path.join(path, "project.json")
    if os.path.exists(pj):
        try:
            with open(pj, "r", encoding="utf-8") as f:
                saved = json.load(f)
                pages = saved.get("pages", [])
        except (OSError, ValueError):
            pass
    assets = []
    d = _assets_dir(pid)
    if os.path.isdir(d):
        for name in sorted(os.listdir(d)):
            full = os.path.join(d, name)
            if os.path.isfile(full):
                with open(full, "rb") as f:
                    assets.append({
                        "name": name,
                        "data": base64.b64encode(f.read()).decode("ascii"),
                    })
    # 自定义应用图标也随项目一起导出（旧项目没有这个字段，导入时按默认处理）
    icon_data = ""
    custom_icon = _icon_path(pid)
    if os.path.isfile(custom_icon):
        with open(custom_icon, "rb") as f:
            icon_data = base64.b64encode(f.read()).decode("ascii")
    export = {
        "format": "duckbox-project",
        "version": 1,
        "project": {
            "name": record.get("name", "未命名项目"),
            "package": record.get("package", "com.duckbox.demo"),
            "appName": record.get("appName", "DuckBox"),
            "deviceType": record.get("deviceType", "band"),
            "designWidth": record.get("designWidth", 480),
            "pages": pages,
            "assets": assets,
            "icon": icon_data,
        },
    }
    raw = json.dumps(export, ensure_ascii=False, indent=2).encode("utf-8")
    fname = _slug(record.get("name", "project")) + ".duckbox.json"
    return send_file(io.BytesIO(raw), as_attachment=True,
                     download_name=fname, mimetype="application/json")


@app.route("/api/projects/import", methods=["POST"])
def import_project():
    data = request.get_json(silent=True) or {}
    if data.get("format") != "duckbox-project":
        return jsonify({"error": "不是有效的 Duck Box 项目文件"}), 400
    proj = data.get("project") or {}
    name = (proj.get("name") or "导入项目").strip() or "导入项目"
    pid = str(int(time.time() * 1000)) + "_" + _slug(name)
    now = int(time.time() * 1000)

    device_type = _valid_device_type(proj.get("deviceType"))
    try:
        design_width = int(proj.get("designWidth") or 480)
    except (TypeError, ValueError):
        design_width = 480
    design_width = max(120, min(720, design_width))

    project = {
        "id": pid,
        "name": name,
        "package": (proj.get("package") or "com.duckbox.demo").strip(),
        "appName": (proj.get("appName") or "DuckBox").strip()[:20],
        "deviceType": device_type,
        "designWidth": design_width,
        "createdAt": now,
        "updatedAt": now,
        "preview": "导入项目",
    }
    index = _read_index()
    index.setdefault("projects", []).append(project)
    _write_index(index)

    path = _project_path(pid)
    os.makedirs(path, exist_ok=True)
    pages = proj.get("pages", [])
    if not isinstance(pages, list):
        pages = []
    with open(os.path.join(path, "project.json"), "w", encoding="utf-8") as f:
        json.dump({"xml": "", "files": {}, "meta": project, "pages": pages},
                  f, ensure_ascii=False, indent=2)

    d = _assets_dir(pid)
    for a in (proj.get("assets", []) or []):
        asset_name = _safe_asset_name(a.get("name", ""))
        if not asset_name:
            continue
        try:
            raw = base64.b64decode(a.get("data", ""))
        except Exception:
            continue
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, asset_name), "wb") as f:
            f.write(raw)
    # 恢复自定义图标（格式 / 尺寸不合规就忽略，回落到默认小鸭）
    if proj.get("icon"):
        try:
            icon_raw = base64.b64decode(proj["icon"], validate=True)
            _png_dimensions(icon_raw)
            with open(_icon_path(pid), "wb") as f:
                f.write(icon_raw)
        except Exception:
            pass
    return jsonify({"ok": True, "project": project})


# --------------------------------------------------------------------------- #
# 启动
# --------------------------------------------------------------------------- #
def run(port=8520):
    _ensure_dirs()
    # 绑定 0.0.0.0：同一局域网内的手机 / 其他电脑都能用 IP 访问
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True, use_reloader=False)


if __name__ == "__main__":
    run()