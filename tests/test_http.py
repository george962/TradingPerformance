"""HTTP tests: static allowlist, Host/Origin checks, body cap, data folder.
Starts the real server on a free port with a temporary data folder — no network.
Usage: python3 tests/test_http.py   (from the TradingPerformance folder)"""
import http.client
import json
import os
import stat
import sys
import tempfile
import threading
import urllib.error

TMP = tempfile.mkdtemp()
os.environ["TP_DATA_DIR"] = os.path.join(TMP, "data")  # never touch your real data
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import server  # noqa: E402

fails = 0


def check(name, cond, detail=""):
    global fails
    print(("  ok  " if cond else "FAIL  ") + name + ("" if cond or not detail else " — %s" % detail))
    fails += 0 if cond else 1


httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
PORT = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
ORIGIN = "http://127.0.0.1:%d" % PORT


def req(method, path, body=None, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    h = {"Host": "127.0.0.1:%d" % PORT}
    if body is not None and not isinstance(body, bytes):
        body = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    c.request(method, path, body=body, headers=h)
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, data, r


print("--- data folder ---")
check("TP_DATA_DIR overrides the data folder", server.DATA_DIR == os.path.join(TMP, "data"))
check("data file lives outside the app folder", not server.DATA_FILE.startswith(server.HERE))
check("outlook cache lives in the data folder", server.OUTLOOK_DIR.startswith(server.DATA_DIR))
saved_env = os.environ.pop("TP_DATA_DIR")
default = server.user_data_dir()
os.environ["TP_DATA_DIR"] = saved_env
check("default folder is per-user, named for the app", default.endswith("TradingPerformance") and default.startswith(os.path.expanduser("~")))
if sys.platform == "darwin":
    check("macOS default is Application Support", "Library/Application Support" in default)

print("--- static files: allowlist only ---")
st, body, r = req("GET", "/")
check("/ serves the app", st == 200 and b"<!DOCTYPE html>" in body and "text/html" in r.getheader("Content-Type"))
for p in ("/app.js", "/engine.js", "/styles.css", "/outlook-worker.js", "/regime-table.json", "/sample/sample-data.json"):
    check("serves " + p, req("GET", p)[0] == 200)
for p in ("/server.py", "/tests/test_server.py", "/README.md", "/.git/config", "/.gitignore", "/data.json",
          "/tools/make-sample.js", "/../server.py", "/%2e%2e/server.py", "/sample/../server.py", "//etc/passwd",
          "/app.js/", "/APP.JS", "/sp500.json"):
    st = req("GET", p)[0]
    check("refuses " + p, st == 404, st)
check("nosniff + no framing headers", r.getheader("X-Content-Type-Options") == "nosniff" and r.getheader("X-Frame-Options") == "DENY")

print("--- Host header (DNS rebinding) ---")
check("other Host refused for pages", req("GET", "/", headers={"Host": "evil.example:%d" % PORT})[0] == 403)
check("other Host refused for the API", req("GET", "/api/load-data", headers={"Host": "evil.example:%d" % PORT})[0] == 403)
check("localhost Host accepted", req("GET", "/", headers={"Host": "localhost:%d" % PORT})[0] == 200)
check("wrong port refused", req("GET", "/", headers={"Host": "127.0.0.1:1"})[0] == 403)

print("--- Origin / cross-site requests ---")
st, body, _ = req("POST", "/api/save-data", {"transactions": [{"x": 1}], "files": ["a.csv"]}, {"Origin": ORIGIN})
check("same-origin save works", st == 200 and json.loads(body)["ok"])
check("data file written with owner-only permissions",
      os.path.exists(server.DATA_FILE) and (os.name == "nt" or stat.S_IMODE(os.stat(server.DATA_FILE).st_mode) == 0o600))
st, body, _ = req("GET", "/api/load-data", headers={"Sec-Fetch-Site": "same-origin"})
check("load returns what was saved", st == 200 and json.loads(body)["files"] == ["a.csv"])
check("other website: clear refused", req("POST", "/api/clear-data", {}, {"Origin": "https://evil.example"})[0] == 403)
check("other website: save refused", req("POST", "/api/save-data", {"transactions": []}, {"Origin": "https://evil.example"})[0] == 403)
check("Origin: null refused", req("POST", "/api/clear-data", {}, {"Origin": "null"})[0] == 403)
check("cross-site fetch metadata refused", req("GET", "/api/load-data", headers={"Sec-Fetch-Site": "cross-site"})[0] == 403)
check("form-style POST (text/plain) refused",
      req("POST", "/api/clear-data", b"{}", {"Content-Type": "text/plain", "Origin": ORIGIN})[0] == 415)
check("data survived the refused calls", os.path.exists(server.DATA_FILE))

print("--- bodies ---")
old = server.MAX_BODY
server.MAX_BODY = 1000
check("body over the cap refused (413)", req("POST", "/api/save-data", {"files": ["x" * 2000]})[0] == 413)
server.MAX_BODY = old
st, body, _ = req("POST", "/api/save-data", b"{not json", {"Content-Type": "application/json"})
check("bad JSON gives a readable 400", st == 400 and "bad request body" in json.loads(body)["error"])
st, body, _ = req("POST", "/api/nope", {})
check("unknown API endpoint is a JSON 404", st == 404 and json.loads(body)["error"] == "unknown endpoint")
st, body, _ = req("POST", "/api/clear-data", {}, {"Origin": ORIGIN})
check("same-origin clear works", st == 200 and not os.path.exists(server.DATA_FILE))

print("--- moving data.json out of the app folder ---")
legacy = os.path.join(TMP, "legacy-app", "data.json")
os.makedirs(os.path.dirname(legacy))
json.dump({"transactions": [1, 2, 3]}, open(legacy, "w"))
server.LEGACY_DATA_FILE = legacy
server.migrate_legacy_data()
check("old data.json moved to the data folder", not os.path.exists(legacy) and server.load_data()["transactions"] == [1, 2, 3])
json.dump({"transactions": []}, open(legacy, "w"))
server.migrate_legacy_data()
check("an existing data file is never overwritten", os.path.exists(legacy) and server.load_data()["transactions"] == [1, 2, 3])

print("--- readable errors ---")
fe = server.friendly_error
check("offline", "no internet" in fe(urllib.error.URLError(OSError("nodename nor servname provided"))))
check("timeout", fe(urllib.error.URLError("timed out")) == "timed out")
check("unknown symbol", "check the symbol" in fe(urllib.error.HTTPError("u", 404, "nf", {}, None)))
check("rate limited", "try again" in fe(urllib.error.HTTPError("u", 429, "x", {}, None)))
server.fetch_yahoo_history = lambda *a, **k: (_ for _ in ()).throw(urllib.error.URLError(OSError("offline")))
res = server.refresh_prices(["ABC"], None)
check("failed refresh names each symbol with a readable reason",
      set(res["errors"]) == {"^SPX", "^SP500TR", "ABC"} and all("no internet" in v for v in res["errors"].values()))

print("--- kept-alive connections ---")
c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
H = {"Host": "127.0.0.1:%d" % PORT, "Content-Type": "application/json"}
c.request("POST", "/api/clear-data", body=b"{}", headers=H); r1 = c.getresponse(); r1.read()
c.request("GET", "/api/load-data", headers={"Host": H["Host"]}); r2 = c.getresponse(); r2.read()
check("a body the endpoint ignores doesn't corrupt the next request", r1.status == 200 and r2.status == 200, (r1.status, r2.status))
c.request("POST", "/api/clear-data", body=b"{}", headers=dict(H, Origin="https://evil.example")); r3 = c.getresponse(); r3.read()
check("a refused request closes the connection", r3.status == 403 and r3.getheader("Connection") == "close")
c.close()

httpd.shutdown()
print("%d failed" % fails)
sys.exit(1 if fails else 0)
