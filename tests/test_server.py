"""Server fetch tests with a fake Yahoo response — no network.
Usage: python3 tests/test_server.py   (from the TradingPerformance folder)"""
import io, json, os, sys, tempfile, time
os.environ["TP_DATA_DIR"] = tempfile.mkdtemp()  # never touch your real data
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import server

DAY = 86400
now = int(time.time())
today0 = now - now % DAY + 14 * 3600 + 30 * 60  # 14:30 UTC session open
fails = 0

def fake(meta_extra, closes, ts, splits=None):
    payload = {"chart": {"result": [{
        "meta": dict({"gmtoffset": 0}, **meta_extra),
        "timestamp": ts, "indicators": {"quote": [{"close": closes}]},
        "events": {"splits": splits or {}}}]}}
    class R(io.BytesIO):
        def __enter__(self): return self
        def __exit__(self, *a): pass
    server.urllib.request.urlopen = lambda req, timeout=0: R(json.dumps(payload).encode())

def check(name, cond):
    global fails
    print(("  ok  " if cond else "FAIL  ") + name)
    fails += 0 if cond else 1

d = lambda t: time.strftime("%Y-%m-%d", time.gmtime(t))
# Market open: today's bar is replaced by the live price.
fake({"regularMarketPrice": 105.5, "regularMarketTime": now,
      "currentTradingPeriod": {"regular": {"start": now - 3600, "end": now + 3600}}},
     [100.0, 101.0], [now - 3600 - DAY, now - 1800])
rows, info = server.fetch_yahoo_history("XYZ", "2026-01-01")
check("live during market hours", info["live"] and rows[-1] == (d(now - 3600), 105.5))
check("previous close kept", rows[0][1] == 100.0)
# Market closed: the day's close stays.
fake({"regularMarketPrice": 101.0, "regularMarketTime": now - 7200,
      "currentTradingPeriod": {"regular": {"start": now - 30000, "end": now - 7200}}},
     [100.0, 101.0], [now - 2 * DAY, now - 7200])
rows, info = server.fetch_yahoo_history("XYZ", "2026-01-01")
check("closed market is not live", not info["live"] and rows[-1][1] == 101.0)
# 10:1 split: bars before it are multiplied back to traded prices.
fake({"currentTradingPeriod": {}}, [15.0, 150.0 / 10, 16.0],
     [now - 3 * DAY, now - 2 * DAY, now - DAY],
     {"1": {"date": now - DAY, "numerator": 10, "denominator": 1}})
rows, _ = server.fetch_yahoo_history("XYZ", "2026-01-01")
check("split un-adjusted", rows[0][1] == 150.0 and rows[-1][1] == 16.0)
# News RSS parsing (Google style: "Title - Publisher")
rss = b'''<rss><channel><item><title>Nvidia beats estimates - Reuters</title><link>https://x</link>
<pubDate>Mon, 23 Nov 2026 15:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source><description>&lt;a&gt;x&lt;/a&gt;</description></item></channel></rss>'''
items = server._parse_rss(rss, "Google News")
check("RSS parsed, publisher stripped from title", items[0]["title"] == "Nvidia beats estimates" and items[0]["source"] == "Reuters" and items[0]["published"].startswith("2026-11-23"))
old = dict(items[0], title="Old story", published="2020-01-01T00:00:00+00:00")
check("dedupe keeps recent only", len(server._dedupe_recent([items[0], dict(items[0]), old], 14, 60)) == 1)
# Outlook data: FRED CSV + Shiller CSV parsed, one failure reported, cache used on the next call.
import tempfile
server.OUTLOOK_DIR = tempfile.mkdtemp()
def fake_get(url, headers=None, **kw):
    if "fredgraph" in url:
        if "VIXCLS" in url: raise IOError("timed out")
        return b"observation_date,X\n2020-01-01,1.5\n2020-02-01,.\n2020-03-01,2.0\n"
    return b"Date,SP500,PE10\n2020-01-01,3000,30.5\n2020-02-01,3100,0\n"
server.http_get = fake_get
server.fetch_yahoo_history = lambda sym, start=None, range_="1mo": ([("2020-01-02", 10.0), ("2020-01-03", 11.0)], {"live": False})
res = server.fetch_outlook_data()
check("outlook: FRED rows parsed, missing values skipped", res["series"]["GS10"] == [["2020-01-01", 1.5], ["2020-03-01", 2.0]])
check("outlook: Shiller CAPE parsed, zeros dropped", res["series"]["PE10"] == [["2020-01-01", 30.5]])
check("outlook: S&P + 4 world markets", len(res["series"]["SPX"]) == 2 and len(res["markets"]) == 4)
check("outlook: failed series reported", "VIXCLS" in res["errors"] and "VIXCLS" not in res["series"])
server.http_get = lambda *a, **k: (_ for _ in ()).throw(IOError("offline"))
res2 = server.fetch_outlook_data()
check("outlook: cached copy used when offline", res2["series"]["GS10"] == res["series"]["GS10"])
print("%d failed" % fails)
sys.exit(1 if fails else 0)
