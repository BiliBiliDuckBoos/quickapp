# -*- coding: utf-8 -*-
"""验证图片资产 API：上传 → 列表 → 预览访问 → 删除"""
import io
import json
import sys
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8520"
PID = "1787540810087_多页面测试"

logo = open(r"d:\work\MiBandQAPP\duckbox\static\img\logo.png", "rb").read()
boundary = "----duckboxtest1234"
body = io.BytesIO()
body.write(("--%s\r\n" % boundary).encode())
body.write(b'Content-Disposition: form-data; name="file"; filename="duck.png"\r\n')
body.write(b"Content-Type: image/png\r\n\r\n")
body.write(logo)
body.write(("\r\n--%s--\r\n" % boundary).encode())
data = body.getvalue()

url = "%s/api/projects/%s/assets" % (BASE, urllib.parse.quote(PID))
req = urllib.request.Request(url, data=data, method="POST",
                             headers={"Content-Type": "multipart/form-data; boundary=" + boundary})
up = json.loads(urllib.request.urlopen(req).read())
print("UPLOAD:", json.dumps(up, ensure_ascii=False))

lst = json.loads(urllib.request.urlopen(url).read())
print("LIST:", json.dumps(lst, ensure_ascii=False))

name = lst["assets"][0]["name"]
img_url = "%s/api/projects/%s/assets/%s" % (BASE, urllib.parse.quote(PID), urllib.parse.quote(name))
raw = urllib.request.urlopen(img_url).read()
print("FETCH asset ok, bytes =", len(raw), "match_logo =", raw == logo)

del_url = "%s/api/projects/%s/assets/%s" % (BASE, urllib.parse.quote(PID), urllib.parse.quote("不存在.png"))
req2 = urllib.request.Request(del_url, method="DELETE")
print("DELETE missing:", urllib.request.urlopen(req2).read().decode())
